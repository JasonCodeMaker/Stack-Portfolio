import Decimal from "decimal.js";
import { ALLOCATION, day, dayOf, hasTable, json, preference } from "./ledger.js";
import { normalizeHolding, buildPortfolioModel } from "../src/domain/portfolio";
import { buildExposureModel } from "../src/domain/exposure";
import { EtfCache } from "../src/storage/etfCache";
import { getSnapshotStatus } from "../src/domain/etf";
import { loadAddonSettings, reconcileAccountSelection } from "../src/storage/settings";
import { loadRebalanceSettings } from "../src/storage/rebalance";

const D = (n) => new Decimal(n ?? 0);
const iso = (d) => d.toISOString().slice(0, 10);
const live = (e) => !["DRAFT", "CANCELLED", "CANCELED", "VOID"].includes(String(e.status).toUpperCase());
function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}
function last(rows, date) {
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
  const prices = db.prepare("SELECT * FROM sp_prices ORDER BY asset,day,priority,source").all();
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
export function positions(book, acc, date) {
  const anchor = last(book.anchors.get(acc.id), date);
  const amounts = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, D(v)]));
  const holdings = amounts(json(anchor?.positions, {})),
    cash = amounts(json(anchor?.cash, {}));
  const warnings = [];
  function apply(e, sign) {
    if (!live(e)) return;
    const post = posting(e);
    if (!post) {
      warnings.push(`流水 ${e.activityType} 需要核对`);
      return;
    }
    if (post.units) add(holdings, e.assetId, post.units.mul(sign));
    add(cash, e.currency, post.cash.mul(sign));
  }
  for (const entry of book.byAccount.get(acc.id) || []) {
    const { original, current } = entry;
    if (original && dayOf(original.date) <= date && (!anchor || dayOf(original.date) > anchor.day))
      apply(original, 1);
    if (!entry.changed) continue;
    if (original && dayOf(original.date) <= date) apply(original, -1);
    if (entry.day <= date) apply(current, 1);
  }
  return { holdings, cash, warnings };
}
function snapshot(book, acc, date, overrides = {}) {
  const pos = positions(book, acc, date),
    rows = [],
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
export function externalFlows(book, ids, from, to) {
  const selected = new Set(ids),
    events = book.events
      .map((r) => r.current)
      .filter((e) => live(e) && selected.has(e.accountId) && dayOf(e.date) > from && dayOf(e.date) <= to);
  const transfers = new Map();
  for (const e of events)
    if (e.group && ["TRANSFER_IN", "TRANSFER_OUT"].includes(e.activityType)) {
      if (!transfers.has(e.group)) transfers.set(e.group, new Set());
      transfers.get(e.group).add(e.activityType);
    }
  let sum = D(0);
  for (const e of events) {
    if (!["DEPOSIT", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT"].includes(e.activityType)) continue;
    if (e.metadata?.fx && e.metadata?.flow?.is_external === false) continue;
    if (e.group && transfers.get(e.group)?.size === 2 && e.activityType.startsWith("TRANSFER")) continue;
    let amount = D(e.amount).abs(),
      ccy = e.currency;
    if (e.assetId && D(e.quantity).abs().gt(0) && e.activityType.startsWith("TRANSFER")) {
      const quote = price(book, e.assetId, dayOf(e.date));
      if (!quote) return null;
      amount = D(e.quantity).abs().mul(quote.price);
      ccy = book.assets.get(e.assetId)?.currency || ccy;
    }
    const fx = rate(book, ccy, dayOf(e.date));
    if (!fx) return null;
    sum = sum.plus(
      amount.mul(fx.price).mul(["WITHDRAWAL", "TRANSFER_OUT"].includes(e.activityType) ? -1 : 1),
    );
  }
  return sum.toNumber();
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
function periodStart(end, period, earliest) {
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
    raw = await loadAddonSettings(ctx);
  const active = book.accounts.filter((a) => a.isActive);
  const reconciled = reconcileAccountSelection(raw, active);
  const settings = reconciled.settings,
    selected = options.ids?.length
      ? active.filter((a) => options.ids.includes(a.id))
      : reconciled.selectedAccounts;
  const ids = selected.map((a) => a.id),
    date = options.date ? day(options.date) : book.latest,
    period = options.period || "1m";
  const start = periodStart(date, period, book.dates[0]);
  const current = combined(book, selected, date, settings);
  const hasHistory = book.dates.length > 0 && start >= book.dates[0];
  const startValue = hasHistory ? combined(book, selected, start, settings).total : null;
  const incompleteFlows = book.issues.some((issue) => ids.includes(issue.account) && issue.day <= date);
  const flows = incompleteFlows ? null : externalFlows(book, ids, start, date);
  const pnl =
    current.total != null && startValue != null && flows != null
      ? D(current.total).minus(startValue).minus(flows).toNumber()
      : null;
  const span = Date.parse(date) - Date.parse(start),
    days = Math.max(1, Math.ceil(span / 86400000)),
    steps = Math.min(52, days);
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const d = iso(new Date(Date.parse(start) + Math.round((days * i) / steps) * 86400000));
    const value = hasHistory || d >= book.dates[0] ? combined(book, selected, d, settings).total : null,
      flow = externalFlows(book, ids, start, d);
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
    start,
    period,
    startValue,
    flows,
    pnl,
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
