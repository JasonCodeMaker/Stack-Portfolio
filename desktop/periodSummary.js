// The period summary engine shared by the overview and the return review: one set of period
// figures (valuations, external flows, investment gain, time-weighted return, annualised
// return, drawdown and underperformance) measured on daily closes as ADR 0002 describes. A
// missing close or rate carries the latest known one forward (spec §5.1), and results are
// stated as of the latest close valued on its own data.
import Decimal from "decimal.js";
import { day, dayOf } from "./ledger.js";
import {
  accountSnapshot,
  flowValue,
  isExternalFlow,
  last,
  live,
  loadBook,
  netContribution,
  pairedTransferGroups,
  positionHistory,
  positions,
  posting,
  rate,
} from "./flows.js";
import { closingDay, marketFor, shiftDay } from "./marketDays.js";
import { benchmarks } from "./reviewMarket.js";

import { annualise, daysBetween, resolvePeriod } from "./periods.js";
export { annualise, daysBetween, periodPresets, resolvePeriod } from "./periods.js";

const D = (n) => new Decimal(n);

// The ledger with daily closes only, plus the benchmark index levels, without open checks.
export function closeBook(db) {
  const book = loadBook(db);
  // Live broker observations and intraday quotes cannot supply a daily close.
  for (const [id, prices] of book.prices)
    book.prices.set(
      id,
      prices.filter((q) => !["Webull AU", "Twelve Data"].includes(q.source)),
    );
  for (const [id, values] of book.brokerValues)
    book.brokerValues.set(
      id,
      values.filter((v) => !["Webull AU", "券商账户页面（手工核对）"].includes(v.source)),
    );
  // An open reconciliation check stays on the imports page; analysis values the local ledger.
  book.issues = [];
  const levels = db.prepare("SELECT day,level,source FROM sp_benchmark_levels WHERE series=? ORDER BY day");
  book.benchmarks = benchmarks.map((b) => {
    const rows = levels.all(b.id);
    return { ...b, rows, source: rows.at(-1)?.source || b.source, first: rows[0]?.day, last: rows.at(-1)?.day };
  });
  return book;
}

// The selected accounts of a close book, with what daily valuation needs to know about each.
export function reviewContext(book, ids) {
  const selected = book.accounts.filter((a) => ids?.includes(a.id));
  if (!selected.length || selected.length !== new Set(ids).size) throw Error("请选择有效的复盘账户。");
  const events = book.events
    .filter((r) => ids.includes(r.account))
    .map((r) => r.current)
    .filter(live);
  const groups = pairedTransferGroups(events);
  const paired = Map.groupBy(
    events.filter((e) => groups.has(e.group) && e.activityType.startsWith("TRANSFER") && !e.metadata?.fx),
    (e) => e.group,
  );
  const transit = [];
  for (const legs of paired.values()) {
    legs.sort((a, b) => dayOf(a.date).localeCompare(dayOf(b.date)));
    const first = legs[0],
      from = dayOf(first.date),
      to = dayOf(legs.at(-1).date);
    if (from === to) continue;
    const units = (e) => D(e.assetId ? (e.quantity ?? 0) : (e.amount ?? 0)).abs();
    const matched =
      legs.length === 2 &&
      first.assetId === legs[1].assetId &&
      first.currency === legs[1].currency &&
      units(first).eq(units(legs[1]));
    const amount = first.activityType === "TRANSFER_OUT" ? units(first) : units(first).neg();
    transit.push({ from, to, matched, asset: first.assetId, currency: first.currency, amount });
  }
  const byDay = Map.groupBy(events, (e) => dayOf(e.date));
  const accounts = selected.map((account) => {
    const anchor = book.anchors.get(account.id)?.[0]?.day;
    const firstEvent = events.find((e) => e.accountId === account.id);
    const first = [anchor, firstEvent && dayOf(firstEvent.date), book.evidence.get(account.id)?.[0]?.day].filter(Boolean).sort()[0];
    // A first deposit can open an empty account during a combined review. A
    // non-zero opening balance cannot appear as an overnight investment gain.
    // Records of the opening day carry no reliable order, so the day counts as funded when
    // it holds an inflow and every balance after it is covered.
    const opening = events.filter((e) => e.accountId === account.id && dayOf(e.date) === first);
    const covered = (amounts) => [...amounts.values()].every((n) => n.gt("-0.005"));
    const closing = first && positions(book, account, first);
    const funded =
      opening.some((e) => ["DEPOSIT", "TRANSFER_IN"].includes(e.activityType)) &&
      covered(closing.cash) &&
      covered(closing.holdings);
    // A snapshot of the opening day is a balance carried in from elsewhere unless that
    // day's own records produce exactly the same cash and holdings.
    const carried = () => {
      const replayed = { cash: new Map(), holdings: new Map() };
      for (const e of opening) {
        const post = posting(e);
        if (!post) return true;
        const units = post.units && (replayed.holdings.get(e.assetId) || D(0)).plus(post.units);
        if (units) replayed.holdings.set(e.assetId, units);
        replayed.cash.set(e.currency, (replayed.cash.get(e.currency) || D(0)).plus(post.cash));
      }
      return ["cash", "holdings"].some((kind) =>
        [...new Set([...replayed[kind].keys(), ...closing[kind].keys()])].some((k) =>
          (replayed[kind].get(k) || D(0))
            .minus(closing[kind].get(k) || D(0))
            .abs()
            .gte("0.000001"),
        ),
      );
    };
    const needsOpening = first && (!funded || (anchor === first && carried()));
    const archivedBalance = book.archived
      .get(account.id)
      ?.find((r) => r.total != null && Number(r.total) !== 0)?.day;
    return { account, first, needsOpening, archivedBalance, history: positionHistory(book, account) };
  });
  return { book, accounts, byDay, groups, transit, ids: selected.map((a) => a.id) };
}

export function reviewBook(db, ids) {
  return reviewContext(closeBook(db), ids);
}

// The portfolio's value at one day's close. A price or exchange rate older than that close is
// carried forward and reported in `stale`; one never recorded leaves the total unknown.
export function valuation(context, date, detail = false) {
  const { book, accounts, transit } = context;
  const problems = new Set(),
    stale = new Set(),
    rows = [],
    missingAssets = new Set();
  let total = D(0),
    cash = D(0),
    cashKnown = true,
    flowsKnown = true;
  function ledgerGap(reason) {
    problems.add(reason);
    cashKnown = false;
    flowsKnown = false;
  }
  function include(account, pos) {
    // An open reconciliation check, or a broker snapshot that disagrees with the ledger, is a
    // defect to fix on the imports page; the day is still valued from the local ledger (spec §5.1).
    const s = accountSnapshot(book, account, date, {}, pos);
    for (const warning of pos.warnings) ledgerGap(warning);
    if (s.total == null) for (const warning of s.warnings) problems.add(warning);
    let cashKnownHere = true;
    for (const r of s.rows) {
      const asset = book.assets.get(r.assetId);
      // A missing close or rate carries the latest known one forward (spec §5.1). Only a
      // security or currency that has never had one leaves the valuation unknown.
      const priceMissing = r.type !== "cash" && !r.price,
        fxMissing = !r.fx;
      const priceStale = r.type !== "cash" && !priceMissing && r.priceUpdatedAt < closingDay(date, marketFor(asset));
      const fxStale = !fxMissing && r.fxDate < closingDay(date, "FX");
      if ((priceMissing || priceStale) && asset) missingAssets.add(asset.id);
      const describe = (price, fx) =>
        [price && r.ticker + " 缺少收盘价", fx && r.localCurrency + " 缺少同期汇率"].filter(Boolean).join("、");
      const reason = describe(priceMissing, fxMissing),
        carried = describe(priceStale, fxStale);
      if (!s.valuationSource && reason) problems.add(reason);
      if (!s.valuationSource && carried) stale.add(carried);
      if (r.type === "cash" && fxMissing) cashKnownHere = false;
      if (detail)
        rows.push({
          account: account.name,
          assetId: r.assetId,
          key: r.identityKey || r.assetId,
          symbol: r.ticker,
          quantity: r.rawQuantity,
          currency: r.localCurrency,
          value: reason ? null : r.audValue,
          priceDate: r.priceUpdatedAt,
          fxDate: r.fxDate,
          reason,
          carried,
          cash: r.type === "cash",
        });
    }
    if (s.total == null) problems.add(account.name + " · 估值不完整");
    else total = total.plus(s.total);
    if (s.cash == null || (!cashKnownHere && !s.valuationSource)) cashKnown = false;
    else cash = cash.plus(s.cash);
  }
  for (const { account, first, needsOpening, archivedBalance, history } of accounts) {
    if (account.mode !== "TRANSACTIONS") ledgerGap(account.name + " · 缺少可核实的交易及资金流水");
    if (needsOpening && date < first) ledgerGap(account.name + " · 早于已知期初余额或首笔流水");
    if (archivedBalance <= date && (!first || date < first))
      ledgerGap(account.name + " · 历史净值缺少可核实的持仓或现金流水");
    include(account, detail ? positions(book, account, date) : history(date));
  }
  const inTransit = { cash: new Map(), holdings: new Map(), warnings: [] };
  for (const t of transit) {
    if (date < t.from || date >= t.to) continue;
    if (!t.matched) ledgerGap("跨日内部划转数量或币种待核实");
    else {
      const amounts = t.asset ? inTransit.holdings : inTransit.cash,
        key = t.asset || t.currency;
      amounts.set(key, (amounts.get(key) || D(0)).plus(t.amount));
    }
  }
  if (inTransit.cash.size || inTransit.holdings.size)
    include({ id: "@transit", name: "账户间在途" }, inTransit);
  return {
    total: problems.size ? null : total.toNumber(),
    cash: cashKnown ? cash.toNumber() : null,
    problems: [...problems],
    // Closes and rates carried forward from an earlier day; the valuation still stands.
    stale: [...stale],
    flowsKnown,
    rows,
    missingAssets,
  };
}

// External money in and out on one day, in AUD. Matched transfers between the selected
// accounts are internal and left out.
export function dayFlows(context, date) {
  if (context.book.quantityGaps.some((r) => r.day === date && context.ids.includes(r.account))) return null;
  let deposit = D(0),
    withdrawal = D(0);
  for (const e of context.byDay.get(date) || []) {
    if (!isExternalFlow(e, context.groups)) continue;
    // Valued at the latest quote and rate on or before the day, like the holdings.
    const v = flowValue(context.book, e);
    if (v == null) return null;
    if (v.isNegative()) withdrawal = withdrawal.minus(v);
    else deposit = deposit.plus(v);
  }
  return { deposit, withdrawal };
}

// The time-weighted return chain: deposits arrive at the start of a day, withdrawals leave at
// its end. A chain may open on an empty portfolio, the eve of its first record.
// With no external flows, endpoint NAVs suffice to link across a missing close.
// The intervening point and any drawdown which depends on it remain unavailable.
function timeWeightedSeries() {
  let wealth = null,
    previous = null,
    gap = false;
  return (nav, flows, first) => {
    if (first) {
      wealth = nav != null && nav >= 0 ? D(1) : null;
    } else if (!flows || (nav != null && nav < 0)) {
      wealth = null;
    } else if (nav == null) {
      if (!flows.deposit.isZero() || !flows.withdrawal.isZero()) wealth = null;
      gap = true;
    } else if (wealth != null) {
      const base = D(previous).plus(flows.deposit),
        end = D(nav).plus(flows.withdrawal);
      if (gap && !flows.deposit.isZero()) wealth = null;
      else if (base.gt(0)) wealth = wealth.mul(end).div(base);
      else if (!end.isZero()) wealth = null;
    }
    if (nav != null) {
      previous = nav;
      gap = false;
    }
    return nav == null || wealth == null ? null : wealth.minus(1).toNumber();
  };
}

// The deepest fall from a peak between two points: its depth, the last close at the peak, the
// lowest close and the first close back at the peak (null while not recovered), with the fall
// from the running peak on every close. Any unvalued close in between withholds it.
function drawdown(points, id, first = 0, end = points.length - 1) {
  if (end <= first) return null;
  let peak = 1,
    peakDate = points[first].date,
    worst = { depth: 0, peak: null, trough: null, level: 1 },
    recovery = null;
  const series = [];
  for (const p of points.slice(first, end + 1)) {
    if (p[id] == null) return null;
    const level = 1 + p[id];
    if (level >= peak) {
      if (worst.trough && !recovery && level >= worst.level - 1e-12) recovery = p.date;
      peak = level;
      peakDate = p.date;
    }
    const depth = level / peak - 1;
    series.push({ date: p.date, drawdown: depth });
    if (depth < worst.depth) {
      worst = { depth, peak: peakDate, trough: p.date, level: peak };
      recovery = null;
    }
  }
  return { depth: worst.depth, peak: worst.peak, trough: worst.trough, recovery, series };
}

// Intervals in which the portfolio trails one benchmark: from the first close with a negative
// return gap to the close at which the gap is back to zero or above.
export function underperformance(points, id) {
  const intervals = [];
  let current = null,
    priorKnown = true,
    previousDay = null;
  for (const p of points) {
    const gap = p.gaps[id];
    if (gap == null) {
      if (current) current.status = "interrupted";
      current = null;
    } else if (gap < -1e-12) {
      if (!current) {
        current = {
          id,
          from: p.date,
          to: p.date,
          baseline: priorKnown && previousDay ? previousDay : p.date,
          startKnown: priorKnown,
          status: "open",
          worst: gap,
        };
        intervals.push(current);
      }
      current.to = p.date;
      current.worst = Math.min(current.worst, gap);
    } else if (current) {
      current.to = p.date;
      current.status = "recovered";
      current = null;
    }
    priorKnown = gap != null;
    previousDay = p.date;
  }
  return intervals;
}

// The longest underperformance interval by calendar days, the earliest on a tie.
function longest(intervals) {
  let best = null;
  for (const { from, to, status, worst } of intervals) {
    const days = daysBetween(from, to) + 1;
    if (!best || days > best.days) best = { from, to, days, status, worst };
  }
  return best;
}

export function summarizePeriod(context, { to, period, from }) {
  const { book } = context;
  const earliest = context.accounts
    .map((a) => a.first)
    .filter(Boolean)
    .sort()[0];
  const range = resolvePeriod({ to, period, from, earliest });
  const opening = earliest && shiftDay(earliest, -1);
  const days = [];
  for (let date = range.base; date <= range.to; date = shiftDay(date, 1)) {
    const view = valuation(context, date);
    days.push({ date, view, flows: view.flowsKnown ? dayFlows(context, date) : null });
  }
  // Gains are measured from the close before the period, or from the first later close at which
  // the whole portfolio can be valued. On the eve of the first record nothing is held yet.
  const origin =
    days.find((d) => d.view.total > 0 || (d.date === opening && d.view.total === 0))?.date || range.base;
  const series = book.benchmarks || [];
  const points = [],
    outages = [],
    openGaps = new Map(),
    assets = new Set(),
    bases = {};
  const twr = timeWeightedSeries();
  let commonStart = null,
    commonEnd = null;
  function recordGap(id, reason, date) {
    const prior = openGaps.get(id);
    if (!reason) openGaps.delete(id);
    else if (prior?.reason === reason) prior.to = date;
    else {
      const outage = { id, reason, from: date, to: date };
      openGaps.set(id, outage);
      outages.push(outage);
    }
  }
  // Whether each close was valued on that day's own closes and rates, not carried ones.
  const fresh = { portfolio: [] };
  for (const b of series) fresh[b.id] = [];
  for (const { date, view, flows } of days) {
    for (const id of view.missingAssets) assets.add(id);
    const measured = date >= origin;
    const portfolio = measured ? twr(view.total, flows, date === origin) : null;
    const flow = flows ? flows.deposit.minus(flows.withdrawal).toNumber() : null;
    const point = { date, portfolio, value: view.total, flow, gaps: {} };
    fresh.portfolio.push(view.total != null && !view.stale.length);
    const issue =
      view.problems.join("、") ||
      view.stale.join("、") ||
      (!measured && "组合在该日没有可估值的资产") ||
      (!flows && date !== origin && "外部划转缺少同日报价或汇率") ||
      (portfolio == null && "起点净值或资金划转前后的估值不足，请缩短区间");
    recordGap("portfolio", issue, date);
    // Index levels and the USD rate carry forward like the holdings' closes.
    const fx = rate(book, "USD", date);
    const fxFresh = fx && fx.day >= closingDay(date, "FX");
    let allLevels = view.total > 0;
    for (const b of series) {
      const latest = last(b.rows, date);
      const levelFresh = latest && latest.day >= closingDay(date, "US");
      const audLevel = latest && fx ? D(latest.level).mul(fx.price) : null;
      if (date === origin) bases[b.id] = audLevel;
      point[b.id] = measured && audLevel && bases[b.id] ? audLevel.div(bases[b.id]).minus(1).toNumber() : null;
      point.gaps[b.id] = portfolio != null && point[b.id] != null ? portfolio - point[b.id] : null;
      fresh[b.id].push(Boolean(levelFresh && fxFresh));
      recordGap(
        b.id,
        !levelFresh
          ? "缺少总回报指数收盘点位"
          : !fxFresh
            ? "缺少同期美元兑澳元汇率"
            : measured && !bases[b.id]
              ? "所选起点缺少指数点位或汇率"
              : null,
        date,
      );
      allLevels = allLevels && audLevel != null;
    }
    if (allLevels) {
      commonStart ??= date;
      commonEnd = date;
    }
    points.push(point);
  }
  // Results are stated as of the latest close valued on its own closes and rates, so a session
  // that has not closed yet, or a quote still to arrive, leaves the period's results in place.
  // When no later close has them all, results run through the latest close with carried values.
  const first = Math.max(
    0,
    points.findIndex((p) => p.date === origin),
  );
  const latestIndex = (known, ...ids) => {
    const i = points.findLastIndex((p, j) => known(p) && ids.every((id) => fresh[id][j]));
    if (i > first) return i;
    const carried = points.findLastIndex(known);
    return carried > first ? carried : -1;
  };
  // A period is annualised over its calendar days, or from a later first valued close.
  const measuredDays = daysBetween(origin > range.from ? origin : range.from, range.to) + 1;
  const own = latestIndex((p) => p.portfolio != null, "portfolio");
  const path = own < 0 ? null : drawdown(points, "portfolio", first, own);
  const twrValue = own < 0 ? null : points[own].portfolio;
  const quarter = resolvePeriod({ to: range.to, period: "3m" }).from;
  const intervals = series.flatMap((b) => underperformance(points.slice(0, own + 1), b.id));
  const versus = {};
  for (const { id } of series) {
    // Portfolio and benchmark are compared on the latest close both can be measured at.
    const shared = latestIndex((p) => p.gaps[id] != null, "portfolio", id);
    const i = shared >= 0 ? shared : latestIndex((p) => p[id] != null, id);
    const totalReturn = i < 0 ? null : points[i][id];
    versus[id] = {
      totalReturn,
      annualised: annualise(totalReturn, measuredDays),
      maxDrawdown: i < 0 ? null : (drawdown(points, id, first, i)?.depth ?? null),
      gap: shared >= 0 ? points[shared].gaps[id] : null,
      portfolioReturn: shared >= 0 ? points[shared].portfolio : null,
      asOf: i < 0 ? null : points[i].date,
      longestUnderperformance: longest(intervals.filter((r) => r.id === id)),
    };
  }
  // A break in the return chain can prevent a time-weighted return while both
  // endpoints and every external flow still support an absolute AUD result.
  const endIndex = latestIndex((p) => p.value != null, "portfolio");
  let net = D(0),
    netKnown = endIndex > first;
  for (const p of points.slice(first + 1, endIndex + 1)) {
    if (p.flow == null) netKnown = false;
    else net = net.plus(p.flow);
  }
  const opened = points[first]?.value,
    closed = endIndex < 0 ? null : points[endIndex].value;
  const money = netKnown && opened != null && closed != null;
  return {
    ids: context.ids,
    period: range,
    earliest: earliest || null,
    origin,
    fromOpening: origin === opening,
    asOf: own < 0 ? null : points[own].date,
    valuedThrough: money ? points[endIndex].date : null,
    measuredDays,
    startValue: money ? opened : null,
    endValue: money ? closed : null,
    netFlow: money ? net.toNumber() : null,
    gain: money ? D(closed).minus(opened).minus(net).toNumber() : null,
    cumulativeNetFlow: netContribution(book, context.accounts.map((a) => a.account), range.to),
    twr: twrValue,
    annualised: annualise(twrValue, measuredDays),
    drawdown: path && { depth: path.depth, peak: path.peak, trough: path.trough, recovery: path.recovery },
    drawdownSeries: path && range.from <= quarter ? path.series : null,
    benchmarks: versus,
    points,
    commonStart,
    commonEnd,
    outages,
    missingAssets: [...assets],
    series: series.map(({ rows, ...meta }) => meta),
    intervals,
  };
}

// The period summary of the selected accounts. `period` is a preset (mtd, 3m, ytd, 1y, all);
// `from` instead gives a custom first day. `to` is the valuation date, the period's last day.
export function periodSummary(db, { ids, to, period, from }) {
  const context = reviewBook(db, ids);
  return summarizePeriod(context, { to: to || context.book.latest, period, from });
}
