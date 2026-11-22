import Decimal from "decimal.js";
import { ALLOCATION, BROKER, day, dayOf, hasTable, json, preference } from "./ledger.js";
import { normalizeHolding, buildPortfolioModel } from "./allocation/domain/portfolio";
import { buildExposureModel } from "./allocation/domain/exposure";
import { EtfCache } from "./allocation/storage/etfCache";
import { getSnapshotStatus } from "./allocation/domain/etf";
import { loadAllocationSettings, reconcileAccountSelection } from "./allocation/storage/settings";
import { loadRebalanceSettings } from "./allocation/storage/rebalance";
import { closingDay, marketFor, shiftDay } from "./marketDays.js";
import { closeBook, reviewContext, summarizePeriod } from "./periodSummary.js";
import { cumulativeIncome, gainBreakdown } from "./gainBreakdown.js";

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
  const prices = db.prepare(`SELECT * FROM sp_prices WHERE source NOT IN ('成交价','IBKR 结单报价','IBKR 结单汇率')
    ORDER BY asset, day,
      CASE WHEN source='Twelve Data' AND asset NOT LIKE 'FX:%' THEN 11 ELSE priority END, source`).all();
  const brokerPrices = hasTable(db, "sp_broker_prices")
    ? db.prepare("SELECT * FROM sp_broker_prices ORDER BY account,asset,day,priority,source").all() : [];
  const anchors = db.prepare("SELECT * FROM sp_anchors ORDER BY account,day").all();
  const evidence = db.prepare(`SELECT e.*, (SELECT reference FROM sp_holding_evidence q
    WHERE q.account=e.account AND q.asset=e.asset AND q.day=e.day AND q.reported=1 AND q.quantity=e.quantity
    ORDER BY q.id DESC LIMIT 1) AS quantityReference FROM sp_holding_evidence e JOIN
    (SELECT max(id) id FROM sp_holding_evidence GROUP BY account, asset, day) latest USING(id)
    ORDER BY account,day,id`).all();
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
  const statements = db.prepare("SELECT DISTINCT account,day FROM sp_statements ORDER BY account,day").all();
  const dates = [
    ...new Set([...events, ...anchors, ...archived, ...evidence, ...statements].map((r) => r.day)),
  ].sort();
  const latest =
    [dates.at(-1), ...prices.map((r) => r.day), ...brokerPrices.map((r) => r.day), ...brokerValues.map((r) => r.day)]
      .filter(Boolean)
      .sort()
      .at(-1) || iso(new Date());
  const issues = db.prepare("SELECT * FROM sp_checks").all();
  const book = {
    db,
    statements: groupBy(statements, "account"),
    cashUnknown: new Map(),
    accounts,
    assets,
    events,
    byAccount: groupBy(events, "account"),
    prices: groupBy(prices, "asset"),
    brokerPrices: new Map([...groupBy(brokerPrices, "account")].map(([id, rows]) => [id, groupBy(rows, "asset")])),
    anchors: groupBy(anchors, "account"),
    brokerValues: groupBy(brokerValues, "account"),
    archived: groupBy(archived, "account"),
    dates,
    latest,
    issues,
    evidence: groupBy(evidence, "account"),
    reported: new Map(),
    quantityGaps: [],
  };
  // Compare each report with the independent ledger at that close. Rebuilding this
  // difference on load lets a later import explain shares without adding them twice.
  for (const [id, records] of book.evidence) {
    const history = positionHistory(book, { id }, false);
    const anchors = book.anchors.get(id) || [];
    const byAsset = new Map(),
      differences = new Map();
    const timeline = [...anchors.map(({ day }) => ({ day, anchor: true })), ...records].sort(
      (a, b) => a.day.localeCompare(b.day) || Number(!!b.anchor) - Number(!!a.anchor),
    );
    for (const r of timeline) {
      if (r.anchor) {
        if (differences.size) book.quantityGaps.push({ account: id, day: r.day });
        differences.clear();
        continue;
      }
      const raw = history(r.day).holdings.get(r.asset) || D(0);
      const offset = differences.get(r.asset) || D(0);
      if (!r.quantityReference) {
        r.applies = raw.plus(offset).eq(r.quantity);
        continue;
      }
      r.ledgerQuantity = raw.toFixed();
      const difference = D(r.quantity).minus(raw);
      r.difference = difference.toFixed();
      if (!difference.eq(offset)) book.quantityGaps.push({ account: id, day: r.day });
      if (difference.isZero()) differences.delete(r.asset);
      else differences.set(r.asset, difference);
      if (!byAsset.has(r.asset)) byAsset.set(r.asset, []);
      byAsset.get(r.asset).push(r);
    }
    book.reported.set(id, byAsset);
    const firstReport = records.find((r) => r.quantityReference);
    if (firstReport) {
      const funded = (book.byAccount.get(id) || []).find(
        ({ current: e }) =>
          live(e) && ["DEPOSIT", "TRANSFER_IN", "CREDIT"].includes(e.activityType) && !e.assetId,
      );
      const baseline = [
        anchors[0]?.day,
        book.statements.get(id)?.[0]?.day,
        funded?.day <= firstReport.day ? funded.day : null,
      ]
        .filter(Boolean)
        .sort()[0];
      book.cashUnknown.set(id, { from: firstReport.day, until: baseline });
    }
  }
  return book;
}
function price(book, id, date) {
  return last(book.prices.get(id), date);
}
function accountQuote(book, account, id, date, market, fallback) {
  const quote = last(book.brokerPrices?.get(account)?.get(id), date);
  if (!quote) return fallback;
  // A weekend timestamp on public FX is not a later trading session than Friday's broker quote.
  if (!fallback || quote.day > fallback.day ||
      (quote.day >= closingDay(fallback.day, market) && !(fallback.priority >= 40))) return quote;
  return fallback;
}
export function rate(book, ccy, date, account) {
  if (ccy === "AUD") return { price: "1", day: date, source: "AUD" };
  const direct = price(book, "FX:" + ccy + "/AUD", date),
    inv = price(book, "FX:AUD/" + ccy, date);
  const market = direct && (!inv || direct.day >= inv.day) ? direct
    : inv ? { ...inv, price: D(1).div(inv.price).toString() } : null;
  return account ? accountQuote(book, account, "FX:" + ccy + "/AUD", date, "FX", market) : market;
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
function includeReported(book, accountId, date, state) {
  const anchor = last(book.anchors.get(accountId), date);
  state.evidence = new Map();
  for (const [asset, reports] of book.reported?.get(accountId) || []) {
    const r = last(reports, date);
    if (!r || (anchor && anchor.day > r.day)) continue;
    add(state.holdings, asset, D(r.difference));
    state.evidence.set(asset, r);
  }
  return state;
}
export function positions(book, acc, date, reported = true) {
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
  return reported ? includeReported(book, acc.id, date, state) : state;
}
// Walk the same original ledger and correction overlay once for a series of daily closes.
export function positionHistory(book, acc, reported = true) {
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
    return reported ? includeReported(book, acc.id, date, result) : result;
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
    if (item.price != null || item.fx != null) marks.set(id, item);
  }
  quantitiesAgree = quantitiesAgree && matched.size === active.length;
  function row(assetId, quantity, asset, ccy, q, isCash) {
    if (quantity.isZero()) return;
    const mark = marks.get(assetId);
    if (mark?.price != null && D(mark.price).gt(0) && (!q || q.day <= broker.day))
      q = { price: mark.price, day: broker.day, source: broker.source };
    let fx = rate(book, ccy, date, acc.id);
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
      audValue: aud?.toNumber() ?? null,
      identityKey: item.identityKey || "asset:" + assetId,
      evidence: pos.evidence?.get(assetId) || null,
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
    row(id, qty, a, a?.currency || acc.currency, accountQuote(book, acc.id, id, date, marketFor(a), price(book, id, date)), false);
  }
  for (const [code, qty] of pos.cash)
    row("cash:" + code, qty, null, code, { price: "1", day: date, source: "账户现金" }, true);
  const gap = book.cashUnknown.get(acc.id);
  const needsCash = gap && gap.from <= date && (!gap.until || gap.until > date);
  if (needsCash) {
    complete.cash = false;
    warnings.push("已记录股数，现金余额待结单核对");
  }
  const cashPending = needsCash || book.issues.some((issue) => issue.account === acc.id && issue.day <= date);
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
  const securities = complete.securities ? sum.securities.toNumber() : null;
  const itemizedTotal = complete.securities && complete.cash
    ? sum.securities.plus(sum.cash).toNumber() : null;
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
    itemizedCash: complete.cash ? sum.cash.toNumber() : null,
    securities,
    total,
    valuationSource: useBroker ? broker.source : null,
    itemizedTotal,
    valuationDifference: useBroker && itemizedTotal != null ? D(broker.nav).minus(itemizedTotal).toNumber() : null,
    observedAt: useBroker ? broker.observedAt : null,
    unrealized: useBroker && broker.unrealized != null ? Number(broker.unrealized) : null,
    approximatePnl: useBroker && broker.approximatePnl,
    known: total ?? (cashPending ? D(0) : sum.cash).plus(sum.securities).toNumber(),
  };
}
export const accountSnapshot = snapshot;

function summarizeHoldings(rows) {
  const groups = Map.groupBy(
    rows.filter((r) => r.type !== "cash"),
    (r) => JSON.stringify([r.identityKey, r.localCurrency]),
  );
  const securities = [];
  let knownGain = D(0),
    count = 0;
  for (const [key, holdings] of groups) {
    const { ticker, name, type, mic, localCurrency } = holdings[0];
    const total = (field) =>
      holdings.every((h) => h[field] != null)
        ? holdings.reduce((n, h) => n.plus(h[field]), D(0)).toNumber()
        : null;
    const gain = total("gainAud"),
      value = total("audValue"),
      cost = total("costAud");
    if (gain != null) {
      knownGain = knownGain.plus(gain);
      count++;
    }
    securities.push({
      key,
      ticker,
      name,
      type,
      mic,
      localCurrency,
      value,
      gain,
      cost,
      quantity: holdings.reduce((n, h) => n.plus(h.rawQuantity), D(0)).toFixed(),
      rowIds: holdings.map((r) => r.id),
    });
  }
  securities.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return { securities, count, gain: count || !securities.length ? knownGain.toNumber() : null };
}
function combined(book, selected, date, settings) {
  const accounts = selected.map((a) => snapshot(book, a, date, settings.typeOverrides));
  const sum = (key) =>
    accounts.some((a) => a[key] == null) ? null : accounts.reduce((n, a) => n.plus(a[key]), D(0)).toNumber();
  const itemizedTotal = sum("itemizedTotal"), total = sum("total");
  return {
    accounts,
    rows: accounts.flatMap((a) => a.rows),
    cash: sum("cash"),
    itemizedCash: sum("itemizedCash"),
    securities: sum("securities"),
    total,
    itemizedTotal,
    valuationDifference: accounts.some(a => a.valuationSource) && total != null && itemizedTotal != null
      ? D(total).minus(itemizedTotal).toNumber() : null,
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
    const quote = accountQuote(book, e.accountId, e.assetId, date, marketFor(book.assets.get(e.assetId)), price(book, e.assetId, date));
    if (!quote || !usable(quote, e.assetId, date)) return null;
    amount = D(e.quantity).abs().mul(quote.price);
    ccy = book.assets.get(e.assetId)?.currency || ccy;
  }
  const fx = rate(book, ccy, date, e.accountId);
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
// Money brought in and taken out after `from` and up to `to`: external flows, and an opening
// balance recorded before any activity, which arrives on its own day. Null when one cannot be valued.
function contributions(book, accounts, from, to) {
  if (book.quantityGaps.some((r) => r.day > from && r.day <= to && accounts.some((a) => a.id === r.account))) return null;
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
// Opening balances and external flows in, less external flows out, from the first record
// through `to`. Null unless every account keeps its transactions and they can all be valued.
function lifetimeFlows(book, accounts, to) {
  if (accounts.some((a) => a.mode !== "TRANSACTIONS")) return null;
  if (book.issues.some((issue) => accounts.some((a) => a.id === issue.account) && issue.day <= to)) return null;
  return contributions(book, accounts, "", to);
}
export function netContribution(book, accounts, to) {
  return lifetimeFlows(book, accounts, to)?.reduce((sum, f) => sum.plus(f.value), D(0)).toNumber() ?? null;
}
// Money put in and taken out since tracking began, against what the accounts are worth now.
function lifetimeResult(book, accounts, date, total) {
  if (total == null) return null;
  const flows = lifetimeFlows(book, accounts, date);
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
  };
}
const emptyLot = () => ({ units: D(0), local: D(0), aud: D(0), known: true, audKnown: true });
// Average cost of the units still held, replayed from the account's own trades. A lot whose
// history cannot explain the quantity held today reports no cost.
export function costBasis(book, acc, date) {
  return replayLots(book, acc, date).lots;
}
// The average-cost replay behind costBasis, with the cost given up by each sale and security
// transfer out and the cost taken on by each security transfer in (null where unknown).
// `fees: false` leaves trading fees out of cost; `fallback(assetId, day)` supplies a unit cost
// in the trading currency for units that arrive without cost evidence.
export function replayLots(book, acc, date, { fees = true, fallback } = {}) {
  const lots = new Map(),
    sales = [],
    transfers = [];
  const lot = (id) => {
    if (!lots.has(id)) lots.set(id, emptyLot());
    return lots.get(id);
  };
  function acquire(id, units, unit, extra, on, currency, execution) {
    const l = lot(id),
      ccy = book.assets.get(id)?.currency;
    l.units = l.units.plus(units);
    if (!unit || !unit.gt(0) || !ccy || (currency && currency !== ccy)) {
      unit = fallback?.(id, on);
      extra = D(0);
      if (!unit) {
        l.known = false;
        l.audKnown = false;
        return null;
      }
    }
    const cost = units.mul(unit).plus(extra);
    l.local = l.local.plus(cost);
    const brokerRate = ccy !== "AUD" && execution?.baseCurrency === "AUD" && execution.currency === ccy &&
      execution.tradeDate === on && Number.isFinite(Number(execution.fxRateToBase)) && Number(execution.fxRateToBase) > 0
      ? execution.fxRateToBase : null;
    const fx = brokerRate ? { price: brokerRate, source: "IBKR 逐笔成交报表汇率" } : rate(book, ccy, on, acc.id);
    if (fx) {
      l.aud = l.aud.plus(cost.mul(fx.price));
      if (ccy !== "AUD") {
        const source = fx.source?.startsWith("IBKR") ? fx.source : "买入日行情汇率";
        l.fxSource = !l.fxSource || l.fxSource === source ? source : "按各笔买入凭据与当日汇率折算";
      }
    }
    else l.audKnown = false;
    return cost;
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
      acquire(id, D(quantity), null, D(0), anchor.day);
    }
  const records = (book.evidence?.get(acc.id) || []).filter((r) => r.day <= date);
  let at = 0;
  function applyEvidence(through) {
    while (at < records.length && records[at].day <= through) {
      const r = records[at++];
      if (r.applies === false) continue;
      const l = lot(r.asset);
      if (!l.units.eq(r.quantity)) {
        if (!r.quantityReference && r.local_cost == null && r.aud_cost == null) continue;
        Object.assign(l, emptyLot(), { units: D(r.quantity), known: false, audKnown: false, receipt: null });
        const unit = fallback?.(r.asset, r.day);
        if (unit) Object.assign(l, { local: D(r.quantity).mul(unit), known: true });
      }
      const local = r.local_cost ?? (book.assets.get(r.asset)?.currency === "AUD" ? r.aud_cost : null);
      if (local != null || r.aud_cost != null) {
        l.receipt = { day: r.day, reference: r.reference };
        if (local == null) l.receipt.historicalAud = r.aud_cost;
      }
      if (local != null) Object.assign(l, { local: D(local), known: true });
      if (r.aud_cost != null) Object.assign(l, { aud: D(r.aud_cost), audKnown: true });
    }
  }
  for (const e of events) {
    const units = D(e.quantity).abs(),
      on = dayOf(e.date);
    if (records[at]?.day < on) applyEvidence(shiftDay(on, -1));
    if (e.activityType === "BUY")
      acquire(e.assetId, units, D(e.unitPrice), fees ? D(e.fee).abs().plus(D(e.tax).abs()) : D(0), on, e.currency, e.metadata?.ibkrExecution);
    else if (e.activityType === "TRANSFER_IN") {
      transfers.push({ event: e, day: on, cost: acquire(e.assetId, units, D(e.unitPrice), D(0), on) });
    } else if (["SELL", "TRANSFER_OUT"].includes(e.activityType)) {
      const l = lot(e.assetId);
      const left = l.units.minus(units);
      const cost = l.known && !left.lt("-0.00000001") ? l.local.mul(units).div(l.units) : null;
      (e.activityType === "SELL" ? sales : transfers).push({ event: e, day: on, cost });
      if (left.lt("-0.00000001"))
        lots.set(e.assetId, { ...emptyLot(), units: left, known: false, audKnown: false });
      else if (left.lte("0.00000001")) lots.set(e.assetId, emptyLot());
      else {
        const kept = left.div(l.units);
        l.local = l.local.mul(kept);
        l.aud = l.aud.mul(kept);
        l.units = left;
      }
    }
  }
  applyEvidence(date);
  return { lots, sales, transfers };
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
export function targetScope(db, ids) {
  const active = db.prepare("SELECT id FROM sp_accounts WHERE active=1").all().map((a) => a.id);
  const selected = [...new Set(ids ?? active)].sort();
  if (!selected.every((id) => active.includes(id))) throw Error("配置目标的账户范围已改变。");
  return selected.length === active.length ? ALLOCATION : ALLOCATION + ".targets." + JSON.stringify(selected);
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
  // Period figures come from the engine the return review uses, on daily closes.
  const closes = ids.length ? closeBook(db) : null;
  const measure = (context) => summarizePeriod(context, { to: date, period, from: options.from });
  const summarize = (accountIds) => (closes && date ? measure(reviewContext(closes, accountIds)) : null);
  const context = closes && date ? reviewContext(closes, ids) : null;
  const summary = context && measure(context);
  // The same breakdown as the return review shows for this period.
  const breakdown = context && gainBreakdown(context, summary);
  const current = combined(book, selected, date, settings);
  // The period figures stand as of the engine's latest valued close, as on the review page.
  const result = (accounts, total, s) => ({
    period:
      s?.gain == null
        ? null
        : { start: s.startValue, flows: s.netFlow, end: s.endValue, gain: s.gain, twr: s.twr, annualised: s.annualised, asOf: s.valuedThrough },
    lifetime: lifetimeResult(book, accounts, date, total),
  });
  const overall = result(selected, current.total, summary);
  const flows = overall.period?.flows ?? null,
    pnl = overall.period?.gain ?? null;
  for (const view of current.accounts) {
    const acc = selected.find((a) => a.id === view.id);
    view.balanceDate = [book.byAccount, book.anchors, book.brokerValues, book.evidence, book.archived, book.statements]
      .map((data) => last(data.get(acc.id), date)?.day).filter(Boolean).sort().at(-1) || null;
    view.result = result([acc], view.total, ids.length > 1 ? summarize([acc.id]) : summary);
    const lots = costBasis(book, acc, date);
    for (const row of view.rows) {
      const l = lots.get(row.assetId);
      if (row.type === "cash" || !l || l.units.minus(row.rawQuantity).abs().gt("0.000001") || !l.units.gt(0))
        continue;
      row.costReceipt = l.receipt;
      if (!l.known) continue;
      row.costLocal = l.local.toNumber();
      row.averageCost = l.local.div(l.units).toNumber();
      // Open positions use the same reporting rate for cost, market value and unrealised gain.
      if (row.fx != null) row.costAud = l.local.mul(row.fx).toNumber();
      if (row.price == null) continue;
      const gain = D(row.rawQuantity).mul(row.price).minus(l.local);
      row.gainLocal = gain.toNumber();
      if (row.fx != null) {
        row.gainAud = gain.mul(row.fx).toNumber();
        row.gainRate = l.local.gt(0) ? gain.div(l.local).toNumber() : null;
      }
    }
  }
  // Daily closes from the eve of the period, with the opening value plus net flows to date.
  let basis = null;
  const points = (summary?.points || []).map((p) => {
    if (p.date === summary.origin) basis = p.value == null ? null : D(p.value);
    else if (p.date > summary.origin && basis) basis = p.flow == null ? null : basis.plus(p.flow);
    return { date: p.date, value: p.value, basis: p.date < summary.origin || !basis ? null : basis.toNumber() };
  });
  const daily = new Set(["points", "outages", "intervals"]);
  const periodFigures = summary && Object.fromEntries(Object.entries(summary).filter(([k]) => !daily.has(k)));
  const portfolio = buildPortfolioModel(current.rows, ids);
  // A reconciled same-day broker NAV can supply the denominator even when
  // an individual price is missing. Only fully valued listings get a weight.
  const unpriced = new Set(current.rows.filter((r) => r.audValue == null).map((r) => r.identityKey));
  portfolio.totalAud = current.rows.some((r) => r.status === "unsupported-position") ? null : current.total;
  portfolio.incomplete ||= portfolio.totalAud == null;
  for (const row of portfolio.instrumentAllocation)
    row.weight = portfolio.totalAud > 0 && !unpriced.has(row.key) ? row.valueAud / portfolio.totalAud : null;
  const scope = targetScope(db, ids);
  const readTargets = async (scope) => ({
    strategy: await loadRebalanceSettings(storageContext(db, scope)),
    instruments: json(preference(db, scope, "targets.instruments.v1"), { schemaVersion: 1, tolerance: 0.05, targets: {} }),
  });
  const targets = await readTargets(scope);
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
    brokerAccounts: Object.fromEntries(
      ["ibkr", "webull"].map((b) => {
        const saved = preference(db, BROKER, "local-account." + b);
        const matches = active.filter(
          (a) => a.mode === "TRANSACTIONS" && (b === "ibkr" ? /ibkr|interactive/i : /webull/i).test(a.name),
        );
        return [
          b,
          active.find((a) => a.id === saved && a.mode === "TRANSACTIONS")?.id ||
            (matches.length === 1 ? matches[0].id : ""),
        ];
      }),
    ),
    date,
    start: summary?.period.from ?? date,
    fromOpening: summary?.fromOpening ?? false,
    period,
    startValue: overall.period?.start ?? null,
    flows,
    pnl,
    // The shared period summary (see periodSummary.js) without its daily rows.
    summary: periodFigures,
    breakdown,
    result: overall,
    points,
    ...current,
    accounts: book.accounts,
    byAccount: current.accounts,
    holdings: summarizeHoldings(current.rows),
    quantityReports: [...book.reported].flatMap(([account, assets]) =>
      [...assets].flatMap(([asset, reports]) =>
        reports
          .filter((r) => r.day <= date)
          .map((r) => ({
            account,
            asset,
            symbol: book.assets.get(asset)?.symbol,
            day: r.day,
            quantity: r.quantity,
            ledgerQuantity: r.ledgerQuantity,
            difference: r.difference,
            reference: r.quantityReference,
          })),
      ),
    ),

    portfolio,
    exposure,
    settings,
    etfData,
    targets: targets.strategy,
    instrumentTargets: targets.instruments,
    globalTargets: scope === ALLOCATION ? null : await readTargets(ALLOCATION),
    listings: [...book.assets.values()].map(({ id, symbol, name, currency, mic, kind }) => ({
      id,
      symbol,
      name,
      currency,
      mic,
      kind,
    })),
    originalValue: asStored(book, selected, date),
    issues: current.accounts.flatMap((a) =>
      a.warnings.map((reason) => {
        const row = a.rows.find(
          (r) => reason === r.ticker + " 缺少报价" || reason === r.ticker + " 缺少汇率",
        );
        return {
          account: a.name,
          id: a.id,
          reason,
          rowId: row?.id,
          action: row && (row.price ? "fx" : "price"),
        };
      }),
    ),
    batches: db
      .prepare("SELECT * FROM sp_batches ORDER BY created DESC LIMIT 25")
      .all()
      .map((r) => ({ ...r, data: json(r.data, {}) })),
    migration: json(preference(db, "app", "migration"), null),
  };
}
