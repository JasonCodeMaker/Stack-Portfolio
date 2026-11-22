import Decimal from "decimal.js";
import { ALLOCATION, day, dayOf, hasTable, json, preference } from "./ledger.js";
import { normalizeHolding, buildPortfolioModel } from "./allocation/domain/portfolio";
import { buildExposureModel } from "./allocation/domain/exposure";
import { EtfCache } from "./allocation/storage/etfCache";
import { getSnapshotStatus } from "./allocation/domain/etf";
import { loadAllocationSettings, reconcileAccountSelection } from "./allocation/storage/settings";
import { loadRebalanceSettings } from "./allocation/storage/rebalance";
import { closingDay, marketFor, shiftDay } from "./marketDays.js";

const D = (n) => new Decimal(n ?? 0);
const iso = (d) => d.toISOString().slice(0, 10);
export const live = (e) => !["DRAFT", "CANCELLED", "CANCELED", "VOID"].includes(String(e.status).toUpperCase());
function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}
export function last(rows, date) {
  if (!rows?.length) return null;
  let a = 0,
    b = rows.length;
  while (a < b) {
    const mid = (a + b) >>> 1;
    if (rows[mid].day <= date) a = mid + 1;
    else b = mid;
  }
  return a ? rows[a - 1] : null;
}
export function loadBook(db) {
  const events = db
    .prepare("SELECT * FROM sp_events ORDER BY day,id")
    .all()
    .map((r) => ({
      current: json(r.data, {}),
      original: r.original ? json(r.original, {}) : null,
      changed: r.original !== r.data,
      day: r.day,
      account: r.account,
    }));
  // Older books also stored fills here. Only quotes can mark a position to market.
  // A completed daily close supersedes a Twelve Data intraday reading from the same session.
  const prices = db.prepare(`SELECT * FROM sp_prices WHERE source <> '成交价'
    ORDER BY asset, day,
      CASE WHEN source='Twelve Data' AND asset NOT LIKE 'FX:%' THEN 11 ELSE priority END, source`).all();
  const anchors = db.prepare("SELECT * FROM sp_anchors ORDER BY account,day").all();
  if (preference(db, "app", "migration")) includeMigratedFxFees(anchors, events);
  const brokerValues = hasTable(db, "sp_broker_values")
    ? db
        .prepare("SELECT * FROM sp_broker_values ORDER BY account,day")
        .all()
        .map((r) => ({ ...json(r.data, {}), day: r.day, account: r.account, source: r.source }))
    : [];
  const archived = db.prepare("SELECT * FROM sp_archive ORDER BY account,day").all();
  const accounts = db
    .prepare("SELECT * FROM sp_accounts ORDER BY rowid")
    .all()
    .map((r) => ({ ...r, isActive: Boolean(r.active), isArchived: !r.active, trackingMode: r.mode }));
  const assets = new Map(
    db
      .prepare("SELECT * FROM sp_assets")
      .all()
      .map((a) => [a.id, a]),
  );
  const dates = [
    ...new Set([...events.map((r) => r.day), ...anchors.map((r) => r.day), ...archived.map((r) => r.day)]),
  ].sort();
  const latest =
    [dates.at(-1), ...prices.map((r) => r.day), ...brokerValues.map((r) => r.day)]
      .filter(Boolean)
      .sort()
      .at(-1) || iso(new Date());
  const issues = db.prepare("SELECT * FROM sp_checks").all();
  return {
    db,
    accounts,
    assets,
    events,
    byAccount: groupBy(events, "account"),
    prices: groupBy(prices, "asset"),
    anchors: groupBy(anchors, "account"),
    brokerValues: groupBy(brokerValues, "account"),
    archived: groupBy(archived, "account"),
    dates,
    latest,
    issues,
  };
}
function price(book, id, date) {
  return last(book.prices.get(id), date);
}
export function rate(book, ccy, date) {
  if (ccy === "AUD") return { price: "1", day: date, source: "AUD" };
  const direct = price(book, "FX:" + ccy + "/AUD", date),
    inv = price(book, "FX:AUD/" + ccy, date);
  if (direct && (!inv || direct.day >= inv.day)) return direct;
  if (inv) return { ...inv, price: D(1).div(inv.price).toString() };
  return null;
}
export function posting(e) {
  const amount = D(e.amount).abs(),
    units = D(e.quantity).abs(),
    cost = D(e.unitPrice).mul(units),
    fees = D(e.fee).abs().plus(D(e.tax).abs());
  switch (e.activityType) {
    case "BUY":
      return { units, cash: cost.plus(fees).neg() };
    case "SELL":
      return { units: units.neg(), cash: cost.minus(fees) };
    case "DIVIDEND":
    case "INTEREST":
    case "DEPOSIT":
    case "CREDIT":
      return { cash: amount.minus(fees) };
    case "FEE":
    case "TAX":
    case "WITHDRAWAL":
    case "DEBIT":
      return { cash: amount.plus(fees).neg() };
    case "TRANSFER_IN":
    case "TRANSFER_OUT": {
      const sign = e.activityType === "TRANSFER_IN" ? 1 : -1;
      return e.assetId && !units.isZero()
        ? { units: units.mul(sign), cash: fees.neg() }
        : { cash: amount.mul(sign).minus(fees) };
    }
    default:
      return null;
  }
}
function add(map, key, value) {
  if (key && value) map.set(key, (map.get(key) || D(0)).plus(value));
}
// Some Wealthfolio snapshots carry gross FX transfers. Correct only when the
// original postings plus those exact fees independently reproduce the saved balance.
function includeMigratedFxFees(anchors, events) {
  const byAccount = groupBy(
    events.flatMap((e) => (e.original && live(e.original) ? [e.original] : [])),
    "accountId",
  );
  const fxFee = (e) =>
    e.metadata?.brokerSync?.broker === "ibkr" &&
    e.metadata?.fx &&
    e.metadata?.flow?.is_external === false &&
    ["TRANSFER_IN", "TRANSFER_OUT"].includes(e.activityType) &&
    D(e.fee).gt(0);
  for (const [id, accountAnchors] of groupBy(anchors, "account")) {
    const rows = byAccount.get(id) || [];
    if (!rows.some(fxFee)) continue;
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const balances = new Map(),
      fees = new Map(),
      incomplete = new Set();
    let index = 0;
    for (const anchor of accountAnchors) {
      while (index < rows.length && dayOf(rows[index].date) <= anchor.day) {
        const e = rows[index++],
          p = posting(e);
        if (p) add(balances, e.currency, p.cash);
        else incomplete.add(e.currency);
        if (fxFee(e)) add(fees, e.currency, D(e.fee));
      }
      const cash = json(anchor.cash, {});
      for (const [ccy, fee] of fees) {
        if (cash[ccy] == null || incomplete.has(ccy)) continue;
        const net = balances.get(ccy) || D(0);
        if (D(cash[ccy]).minus(net.plus(fee)).abs().lt("0.000001")) cash[ccy] = net.toFixed();
      }
      anchor.cash = JSON.stringify(cash);
    }
  }
}
function balances(anchor) {
  const amounts = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, D(v)]));
  return { holdings: amounts(json(anchor?.positions, {})), cash: amounts(json(anchor?.cash, {})), warnings: [] };
}
function applyPosting(state, e, sign) {
  if (!live(e)) return;
  const post = posting(e);
  if (!post) {
    state.warnings.push(`流水 ${e.activityType} 需要核对`);
    return;
  }
  if (post.units) add(state.holdings, e.assetId, post.units.mul(sign));
  add(state.cash, e.currency, post.cash.mul(sign));
}
export function positions(book, acc, date) {
  const anchor = last(book.anchors.get(acc.id), date);
  const state = balances(anchor);
  for (const entry of book.byAccount.get(acc.id) || []) {
    const { original, current } = entry;
    if (original && dayOf(original.date) <= date && (!anchor || dayOf(original.date) > anchor.day))
      applyPosting(state, original, 1);
    if (!entry.changed) continue;
    if (original && dayOf(original.date) <= date) applyPosting(state, original, -1);
    if (entry.day <= date) applyPosting(state, current, 1);
  }
  return state;
}
// Walk the same original ledger and correction overlay once for a series of daily closes.
export function positionHistory(book, acc) {
  const entries = book.byAccount.get(acc.id) || [];
  const anchors = book.anchors.get(acc.id) || [];
  const originals = [], edits = [];
  for (const { original, current, changed, day } of entries) {
    if (original) originals.push({ day: dayOf(original.date), event: original });
    if (!changed) continue;
    if (original) edits.push({ day: dayOf(original.date), event: original, sign: -1 });
    edits.push({ day, event: current, sign: 1 });
  }
  const byDay = (a, b) => a.day.localeCompare(b.day);
  originals.sort(byDay);
  edits.sort(byDay);
  let base = balances(), delta = balances(), anchorAt = 0, originalAt = 0, editAt = 0;
  return (date) => {
    let anchor;
    while (anchors[anchorAt]?.day <= date) anchor = anchors[anchorAt++];
    if (anchor) {
      base = balances(anchor);
      while (originals[originalAt]?.day <= anchor.day) originalAt++;
    }
    while (originals[originalAt]?.day <= date) applyPosting(base, originals[originalAt++].event, 1);
    while (edits[editAt]?.day <= date) {
      const edit = edits[editAt++];
      applyPosting(delta, edit.event, edit.sign);
    }
    const result = { holdings: new Map(base.holdings), cash: new Map(base.cash), warnings: [...base.warnings, ...delta.warnings] };
    for (const key of ["holdings", "cash"])
      for (const [id, amount] of delta[key]) add(result[key], id, amount);
    return result;
  };
}
function snapshot(book, acc, date, overrides = {}, pos = positions(book, acc, date)) {
  const rows = [],
    warnings = [...new Set(pos.warnings)];
  const sum = { cash: D(0), securities: D(0) },
    complete = { cash: true, securities: true };
  const broker = last(book.brokerValues?.get(acc.id), date);
  const marks = new Map(),
    matched = new Set();
  let quantitiesAgree = Boolean(broker);
  const active = [...pos.holdings].filter(([, qty]) => !qty.isZero());
  for (const item of broker?.positions || []) {
    if (D(item.quantity).isZero()) continue;
    const matches = active.filter(([id]) => {
      const a = book.assets.get(id);
      return (
        a?.symbol.toUpperCase() === item.symbol &&
        a.currency === item.currency &&
        (!item.mic || a.mic === item.mic)
      );
    });
    if (matches.length !== 1) {
      quantitiesAgree = false;
      continue;
    }
    const [id, qty] = matches[0];
    if (matched.has(id) || qty.minus(item.quantity).abs().gt("0.00000001")) quantitiesAgree = false;
    matched.add(id);
    if (item.price != null && D(item.price).gt(0)) marks.set(id, item);
  }
  quantitiesAgree = quantitiesAgree && matched.size === active.length;
  function row(assetId, quantity, asset, ccy, q, isCash) {
    if (quantity.isZero()) return;
    const mark = marks.get(assetId);
    if (mark && (!q || q.day <= broker.day))
      q = { price: mark.price, day: broker.day, source: broker.source };
    let fx = rate(book, ccy, date);
    if (mark?.fx && (!fx || fx.day <= broker.day))
      fx = { price: mark.fx, day: broker.day, source: broker.source };
    const local = q ? quantity.mul(q.price) : null,
      aud = local && fx ? local.mul(fx.price) : null;
    const kind = isCash ? "cash" : "securities";
    if (aud) sum[kind] = sum[kind].plus(aud);
    else {
      complete[kind] = false;
      warnings.push((asset?.symbol || ccy) + (q ? " 缺少汇率" : " 缺少报价"));
    }
    const profile = asset
      ? {
          id: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          mic: asset.mic,
          instrumentKey: asset.instrument_key,
          instrumentType: asset.kind,
          currency: ccy,
          metadata: json(asset.metadata, {}),
        }
      : null;
    const item = normalizeHolding(
      {
        id: acc.id + ":" + assetId,
        holdingType: isCash ? "cash" : "security",
        instrument: asset ? { id: asset.id, symbol: asset.symbol, name: asset.name } : undefined,
        quantity: quantity.toNumber(),
        localCurrency: ccy,
        marketValue: { local: local?.toNumber() ?? null, base: aud?.toNumber() ?? null },
        asOfDate: q?.day || null,
      },
      acc,
      profile,
      fx && ccy === "USD"
        ? { pair: "USD/AUD", rate: D(fx.price).toNumber(), fetchedAt: fx.day, provider: "wealthfolio" }
        : null,
      asset && (overrides[asset.id] || overrides[asset.instrument_key]),
    );
    if (!isCash && !item.etfKey && asset?.kind === "ETF") throw Error("无法识别 ETF");
    rows.push({
      ...item,
      rawQuantity: quantity.toFixed(),
      price: q?.price ?? null,
      quoteSource: q?.source || "",
      quoteObservedAt: q?.source === "Webull AU" ? broker?.observedAt : null,
      // Older than the previous completed session of the listing's own market.
      stale: Boolean(!isCash && q && q.day < closingDay(shiftDay(date, -1), marketFor(asset))),
      fx: fx?.price || null,
      fxDate: fx?.day || null,
      fxSource: fx?.source || "",
      assetId,
    });
  }
  for (const [id, qty] of pos.holdings) {
    const a = book.assets.get(id);
    row(id, qty, a, a?.currency || acc.currency, price(book, id, date), false);
  }
  for (const [code, qty] of pos.cash)
    row("cash:" + code, qty, null, code, { price: "1", day: date, source: "账户现金" }, true);
  const cashPending = book.issues.some((issue) => issue.account === acc.id && issue.day <= date);
  for (const issue of book.issues)
    if (issue.account === acc.id && issue.day <= date && !warnings.includes(issue.reason)) {
      complete.cash = false;
      warnings.push(issue.reason);
    }
  if (cashPending) for (const r of rows.filter((r) => r.type === "cash")) r.issue = "账本现金待同日结单核实";
  if (pos.warnings.length) {
    complete.cash = false;
    complete.securities = false;
  }
  const sameDay = broker?.day === date;
  const cashAgrees =
    sameDay &&
    [...new Set([...pos.cash.keys(), ...Object.keys(broker.cash)])].every((c) =>
      (pos.cash.get(c) || D(0))
        .minus(broker.cash[c] ?? 0)
        .abs()
        .lt("0.005"),
    );
  const useBroker = cashAgrees && quantitiesAgree && !pos.warnings.length;
  if (sameDay && !useBroker) warnings.push("券商快照与本地现金或持仓数量有差异");
  const cash =
    useBroker && broker.cashTotal != null
      ? Number(broker.cashTotal)
      : complete.cash
        ? sum.cash.toNumber()
        : null;
  const holdingsEstimate = complete.securities ? sum.securities.toNumber() : null;
  const nonCashFromNav = useBroker && broker.securities == null && cash != null;
  const securities = nonCashFromNav
    ? D(broker.nav).minus(cash).toNumber()
    : useBroker && broker.securities != null
      ? Number(broker.securities)
      : holdingsEstimate;
  const total = useBroker
    ? Number(broker.nav)
    : cash != null && securities != null
      ? D(cash).plus(securities).toNumber()
      : null;
  return {
    id: acc.id,
    name: acc.name,
    rows,
    warnings,
    cash,
    securities,
    total,
    valuationSource: useBroker ? broker.source : null,
    nonCashFromNav,
    holdingsEstimate,
    observedAt: useBroker ? broker.observedAt : null,
    unrealized: useBroker && broker.unrealized != null ? Number(broker.unrealized) : null,
    approximatePnl: useBroker && broker.approximatePnl,
    known: total ?? (cashPending ? D(0) : sum.cash).plus(sum.securities).toNumber(),
  };
}
export const accountSnapshot = snapshot;
function combined(book, selected, date, settings) {
  const accounts = selected.map((a) => snapshot(book, a, date, settings.typeOverrides));
  const sum = (key) =>
    accounts.some((a) => a[key] === null) ? null : accounts.reduce((n, a) => n.plus(a[key]), D(0)).toNumber();
  return {
    accounts,
    rows: accounts.flatMap((a) => a.rows),
    cash: sum("cash"),
    securities: sum("securities"),
    total: sum("total"),
    known: sum("known"),
  };
}
export function pairedTransferGroups(events) {
  const transfers = new Map();
  for (const e of events)
    if (e.group && ["TRANSFER_IN", "TRANSFER_OUT"].includes(e.activityType)) {
      if (!transfers.has(e.group)) transfers.set(e.group, new Set());
      transfers.get(e.group).add(e.activityType);
    }
  return new Set([...transfers].filter(([, types]) => types.size === 2).map(([group]) => group));
}
export function isExternalFlow(e, internal) {
  return ["DEPOSIT", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"].includes(e.activityType) &&
    !(e.metadata?.fx && e.metadata?.flow?.is_external === false) &&
    !(e.activityType.startsWith("TRANSFER") && internal.has(e.group));
}
export function flowValue(book, e, usable = () => true) {
  let amount = D(e.amount).abs(), ccy = e.currency;
  const date = dayOf(e.date);
  if (e.assetId && D(e.quantity).abs().gt(0) && e.activityType.startsWith("TRANSFER")) {
    const quote = price(book, e.assetId, date);
    if (!quote || !usable(quote, e.assetId, date)) return null;
    amount = D(e.quantity).abs().mul(quote.price);
    ccy = book.assets.get(e.assetId)?.currency || ccy;
  }
  const fx = rate(book, ccy, date);
  if (!fx || !usable(fx, "FX", date)) return null;
  return amount.mul(fx.price).mul(["WITHDRAWAL", "TRANSFER_OUT"].includes(e.activityType) ? -1 : 1);
}
// Dated external flows in AUD after `from` and up to `to`, or null when one cannot be valued.
export function flowList(book, ids, from, to) {
  const selected = new Set(ids);
  const events = book.events.map((r) => r.current)
    .filter((e) => live(e) && selected.has(e.accountId) && dayOf(e.date) > from && dayOf(e.date) <= to);
  const internal = pairedTransferGroups(events);
  const flows = [];
  for (const e of events) {
    if (!isExternalFlow(e, internal)) continue;
    const value = flowValue(book, e);
    if (value === null) return null;
    flows.push({ day: dayOf(e.date), value });
  }
  return flows;
}
export function externalFlows(book, ids, from, to) {
  return flowList(book, ids, from, to)?.reduce((sum, f) => sum.plus(f.value), D(0)).toNumber() ?? null;
}
// Gain over a period, and that gain as a share of the money at work in it: the opening value
// plus everything brought in. The whole history read this way gives the lifetime rate, so the
// two figures agree; a withdrawal cannot inflate either.
export function periodResult(startValue, endValue, flows) {
  if (startValue == null || endValue == null || !flows) return null;
  let net = D(0),
    capital = D(startValue);
  for (const f of flows) {
    net = net.plus(f.value);
    if (f.value.gt(0)) capital = capital.plus(f.value);
  }
  const gain = D(endValue).minus(startValue).minus(net);
  return {
    start: Number(startValue),
    flows: net.toNumber(),
    gain: gain.toNumber(),
    rate: capital.gt(0) ? gain.div(capital).toNumber() : null,
  };
}
// The first day on which any of the accounts has a record.
function firstRecord(book, accounts) {
  return accounts
    .flatMap((a) => [book.byAccount, book.anchors, book.archived].map((rows) => rows.get(a.id)?.[0]?.day))
    .filter(Boolean)
    .sort()[0];
}
// Money brought in and taken out after `from` and up to `to`: external flows, and an opening
// balance recorded before any activity, which arrives on its own day. Null when one cannot be valued.
function contributions(book, accounts, from, to) {
  const flows = flowList(book, accounts.map((a) => a.id), from, to);
  if (!flows) return null;
  for (const a of accounts) {
    const anchor = book.anchors.get(a.id)?.[0],
      firstEvent = book.byAccount.get(a.id)?.[0]?.day;
    if (!anchor || anchor.day <= from || anchor.day > to || (firstEvent && anchor.day >= firstEvent)) continue;
    const opening = snapshot(book, a, anchor.day).total;
    if (opening == null) return null;
    flows.push({ day: anchor.day, value: D(opening) });
  }
  return flows;
}
// Money put in and taken out since tracking began, against what the accounts are worth now.
// The rate divides the gain by everything ever contributed, so a withdrawal cannot inflate it.
function lifetimeResult(book, accounts, date, total) {
  if (total == null || accounts.some((a) => a.mode !== "TRANSACTIONS")) return null;
  const flows = contributions(book, accounts, "", date);
  if (!flows) return null;
  let contributed = D(0),
    withdrawn = D(0);
  const since = flows.map((f) => f.day).sort()[0] || null;
  for (const f of flows)
    if (f.value.isNegative()) withdrawn = withdrawn.minus(f.value);
    else contributed = contributed.plus(f.value);
  const invested = contributed.minus(withdrawn),
    gain = D(total).minus(invested);
  return {
    since,
    contributed: contributed.toNumber(),
    withdrawn: withdrawn.toNumber(),
    invested: invested.toNumber(),
    gain: gain.toNumber(),
    rate: contributed.gt(0) ? gain.div(contributed).toNumber() : null,
  };
}
const emptyLot = () => ({ units: D(0), local: D(0), aud: D(0), known: true, audKnown: true });
// Average cost of the units still held, replayed from the account's own trades. A lot whose
// history cannot explain the quantity held today reports no cost.
export function costBasis(book, acc, date) {
  const lots = new Map();
  const lot = (id) => {
    if (!lots.has(id)) lots.set(id, emptyLot());
    return lots.get(id);
  };
  function acquire(id, units, unit, extra, on, currency) {
    const l = lot(id),
      ccy = book.assets.get(id)?.currency;
    l.units = l.units.plus(units);
    if (!unit || !unit.gt(0) || !ccy || (currency && currency !== ccy)) {
      l.known = false;
      return;
    }
    const cost = units.mul(unit).plus(extra);
    l.local = l.local.plus(cost);
    const fx = rate(book, ccy, on);
    if (fx) l.aud = l.aud.plus(cost.mul(fx.price));
    else l.audKnown = false;
  }
  // Within a trading day, keep execution order even when the Flex reporting clock crossed midnight.
  const time = (e) => Date.parse(e.metadata?.ibkrReportedDateTime ? e.metadata.ibkrReportedDateTime + "Z" : e.date);
  const inflow = (e) => Number(["BUY", "TRANSFER_IN"].includes(e.activityType));
  const entries = book.byAccount.get(acc.id) || [];
  const events = entries
    .map((r) => r.current)
    .filter((e) => live(e) && e.assetId && dayOf(e.date) <= date && !D(e.quantity).isZero())
    .sort((a, b) => dayOf(a.date).localeCompare(dayOf(b.date)) || time(a) - time(b) || inflow(b) - inflow(a));
  const anchor = book.anchors.get(acc.id)?.[0];
  if (anchor && anchor.day <= date && !(entries[0]?.day <= anchor.day))
    for (const [id, quantity] of Object.entries(json(anchor.positions, {}))) {
      const quote = price(book, id, anchor.day);
      acquire(id, D(quantity), quote?.day === anchor.day ? D(quote.price) : null, D(0), anchor.day);
    }
  for (const e of events) {
    const units = D(e.quantity).abs(),
      on = dayOf(e.date);
    if (e.activityType === "BUY")
      acquire(e.assetId, units, D(e.unitPrice), D(e.fee).abs().plus(D(e.tax).abs()), on, e.currency);
    else if (e.activityType === "TRANSFER_IN") {
      const quote = D(e.unitPrice).gt(0) ? { price: e.unitPrice } : price(book, e.assetId, on);
      acquire(e.assetId, units, quote ? D(quote.price) : null, D(0), on);
    } else if (["SELL", "TRANSFER_OUT"].includes(e.activityType)) {
      const l = lot(e.assetId);
      const left = l.units.minus(units);
      if (left.lt("-0.00000001")) l.known = false;
      if (left.lte("0.00000001")) lots.set(e.assetId, { ...emptyLot(), known: l.known && !left.lt("-0.00000001") });
      else {
        const kept = left.div(l.units);
        l.local = l.local.mul(kept);
        l.aud = l.aud.mul(kept);
        l.units = left;
      }
    }
  }
  return lots;
}
export function storageContext(db, scope) {
  const statement = db.prepare("INSERT OR REPLACE INTO sp_prefs VALUES(?,?,?)");
  return {
    api: {
      storage: {
        get: async (k) => preference(db, scope, k),
        set: async (k, v) => {
          statement.run(scope, k, v);
        },
        delete: async (k) => {
          db.prepare("DELETE FROM sp_prefs WHERE scope=? AND key=?").run(scope, k);
        },
      },
    },
  };
}
export function periodStart(end, period, earliest) {
  const e = new Date(end + "T00:00:00Z");
  if (period === "all") return earliest || end;
  if (period === "ytd") return [end.slice(0, 4), "01", "01"].join("-");
  const months = period === "3m" ? 3 : 1,
    n = e.getUTCDate();
  e.setUTCDate(1);
  e.setUTCMonth(e.getUTCMonth() - months);
  e.setUTCDate(Math.min(n, new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate()));
  return iso(e);
}
function asStored(book, accounts, date) {
  let total = D(0);
  for (const a of accounts) {
    const row = last(book.archived.get(a.id), date);
    if (
      !row ||
      row.day !== date ||
      row.base !== "AUD" ||
      row.total == null ||
      /missing|incomplete|unavailable/i.test(row.status)
    )
      return null;
    total = total.plus(row.total);
  }
  return accounts.length ? total.toNumber() : null;
}
export async function dashboard(db, options = {}) {
  const book = loadBook(db),
    ctx = storageContext(db, ALLOCATION),
    raw = await loadAllocationSettings(ctx);
  const active = book.accounts.filter((a) => a.isActive);
  const reconciled = reconcileAccountSelection(raw, active);
  const settings = reconciled.settings,
    selected = options.ids?.length
      ? active.filter((a) => options.ids.includes(a.id))
      : reconciled.selectedAccounts;
  const ids = selected.map((a) => a.id),
    date = options.date ? day(options.date) : book.latest,
    period = options.period || "1m";
  const requested = periodStart(date, period, book.dates[0]);
  // A period reaching back before the first record, as the whole history does, starts from
  // nothing on the eve of that record: everything brought in since counts as money put in.
  const opened = firstRecord(book, selected);
  const fromOpening = Boolean(opened) && opened <= date && (requested < opened || period === "all");
  const start = fromOpening ? shiftDay(opened, -1) : requested;
  const shownFrom = fromOpening ? opened : start;
  const net = (accounts, to) =>
    contributions(book, accounts, start, to)?.reduce((sum, f) => sum.plus(f.value), D(0)).toNumber() ?? null;
  const current = combined(book, selected, date, settings);
  const hasHistory = fromOpening || (book.dates.length > 0 && start >= book.dates[0]);
  const startValue = hasHistory ? combined(book, selected, start, settings).total : null;
  const incompleteFlows = book.issues.some((issue) => ids.includes(issue.account) && issue.day <= date);
  const flows = incompleteFlows ? null : net(selected, date);
  const pnl =
    current.total != null && startValue != null && flows != null
      ? D(current.total).minus(startValue).minus(flows).toNumber()
      : null;
  const result = (accounts, total, opening) => {
    const accountIds = accounts.map((a) => a.id);
    if (book.issues.some((issue) => accountIds.includes(issue.account) && issue.day <= date))
      return { period: null, lifetime: null };
    return {
      period: periodResult(opening, total, contributions(book, accounts, start, date)),
      lifetime: lifetimeResult(book, accounts, date, total),
    };
  };
  const overall = result(selected, current.total, startValue);
  for (const view of current.accounts) {
    const acc = selected.find((a) => a.id === view.id);
    view.result = result(
      [acc],
      view.total,
      hasHistory ? snapshot(book, acc, start, settings.typeOverrides).total : null,
    );
    const lots = costBasis(book, acc, date);
    for (const row of view.rows) {
      const l = lots.get(row.assetId);
      if (row.type === "cash" || !l?.known || l.units.minus(row.rawQuantity).abs().gt("0.000001") || !l.local.gt(0))
        continue;
      row.costLocal = l.local.toNumber();
      row.averageCost = l.local.div(l.units).toNumber();
      if (row.nativeValue != null) row.gainLocal = D(row.nativeValue).minus(l.local).toNumber();
      if (l.audKnown && l.aud.gt(0)) {
        row.costAud = l.aud.toNumber();
        if (row.audValue != null) {
          row.gainAud = D(row.audValue).minus(l.aud).toNumber();
          row.gainRate = D(row.audValue).div(l.aud).minus(1).toNumber();
        }
      }
    }
  }
  const span = Date.parse(date) - Date.parse(shownFrom),
    days = Math.max(1, Math.ceil(span / 86400000)),
    steps = Math.min(52, days);
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const d = iso(new Date(Date.parse(shownFrom) + Math.round((days * i) / steps) * 86400000));
    const value = hasHistory || d >= book.dates[0] ? combined(book, selected, d, settings).total : null,
      flow = net(selected, d);
    const unresolved = book.issues.some((issue) => ids.includes(issue.account) && issue.day <= d);
    return {
      date: d,
      value,
      basis: startValue == null || flow == null || unresolved ? null : D(startValue).plus(flow).toNumber(),
    };
  });
  const portfolio = buildPortfolioModel(current.rows, ids);
  if (current.total == null) {
    portfolio.totalAud = null;
    portfolio.incomplete = true;
    portfolio.instrumentAllocation.forEach((r) => (r.weight = null));
  }
  const records = await new EtfCache(ctx).list(),
    snapshots = new Map(records.filter((r) => r.snapshot).map((r) => [r.etfKey, r.snapshot]));
  const exposure = buildExposureModel({
    holdings: current.rows,
    snapshots,
    totalAud: portfolio.totalAud,
    aliases: settings.aliases,
  });
  const etfData = portfolio.etfs.map((asset) => {
    const record = records.find((r) => r.etfKey === asset.etfKey),
      snapshot = record?.snapshot ?? null;
    return {
      asset: { ...asset, providerSymbol: settings.providerIdentities[asset.etfKey] },
      snapshot,
      version: record?.version,
      status: record?.invalid ? "Invalid" : snapshot ? getSnapshotStatus(snapshot) : "Missing",
      resolvedWeight: snapshot?.weightSum || 0,
    };
  });
  return {
    selected: ids,
    date,
    start: shownFrom,
    fromOpening,
    period,
    startValue,
    flows,
    pnl,
    result: overall,
    points,
    ...current,
    accounts: book.accounts,
    byAccount: current.accounts,
    portfolio,
    exposure,
    settings,
    etfData,
    targets: await loadRebalanceSettings(ctx),
    instrumentTargets: json(preference(db, ALLOCATION, "targets.instruments.v1"), null),
    originalValue: asStored(book, selected, date),
    issues: current.accounts.flatMap((a) =>
      a.warnings.map((reason) => ({ account: a.name, id: a.id, reason })),
    ),
    batches: db
      .prepare("SELECT * FROM sp_batches ORDER BY created DESC LIMIT 25")
      .all()
      .map((r) => ({ ...r, data: json(r.data, {}) })),
    migration: json(preference(db, "app", "migration"), null),
  };
}
