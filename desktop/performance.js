import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { day, dayOf } from "./ledger.js";
import {
  accountSnapshot,
  flowValue,
  isExternalFlow,
  last,
  live,
  loadBook,
  pairedTransferGroups,
  periodStart,
  positionHistory,
  positions,
  posting,
  rate,
} from "./flows.js";
import { closingDay, marketFor, shiftDay } from "./marketDays.js";
import { benchmarks, reviewDates } from "./reviewMarket.js";

const D = (n) => new Decimal(n);
const seriesIds = ["portfolio", ...benchmarks.map((b) => b.id)];

function reviewBook(db, ids) {
  const book = loadBook(db);
  const selected = book.accounts.filter((a) => ids?.includes(a.id));
  if (!selected.length || selected.length !== new Set(ids).size) throw Error("请选择有效的复盘账户。");
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
    const first = [anchor, firstEvent && dayOf(firstEvent.date)].filter(Boolean).sort()[0];
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

function valuation(context, date, detail = false) {
  const { book, accounts, transit } = context;
  const problems = new Set(),
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
    const s = accountSnapshot(book, account, date, {}, pos);
    const unresolved = book.issues.find((i) => i.account === account.id && i.day <= date);
    if (unresolved) ledgerGap(account.name + " · " + unresolved.reason);
    for (const warning of pos.warnings) ledgerGap(warning);
    if (s.total == null) for (const warning of s.warnings) problems.add(warning);
    if (s.warnings.includes("券商快照与本地现金或持仓数量有差异"))
      ledgerGap(account.name + " · 券商估值待对账");
    let cashFresh = true;
    for (const r of s.rows) {
      const asset = book.assets.get(r.assetId);
      const priceMissing =
        r.type !== "cash" && (!r.price || r.priceUpdatedAt < closingDay(date, marketFor(asset)));
      const fxMissing = !r.fx || r.fxDate < closingDay(date, "FX");
      if (priceMissing && asset) missingAssets.add(asset.id);
      const reason = [
        priceMissing && r.ticker + " 缺少收盘价",
        fxMissing && r.localCurrency + " 缺少同期汇率",
      ]
        .filter(Boolean)
        .join("、");
      if (!s.valuationSource && reason) problems.add(reason);
      if (r.type === "cash" && fxMissing) cashFresh = false;
      if (detail)
        rows.push({
          account: account.name,
          symbol: r.ticker,
          quantity: r.rawQuantity,
          currency: r.localCurrency,
          value: reason ? null : r.audValue,
          priceDate: r.priceUpdatedAt,
          fxDate: r.fxDate,
          reason,
          cash: r.type === "cash",
        });
    }
    if (s.total == null) problems.add(account.name + " · 估值不完整");
    else total = total.plus(s.total);
    if (s.cash == null || unresolved || (!cashFresh && !s.valuationSource)) cashKnown = false;
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
    flowsKnown,
    rows,
    missingAssets,
  };
}

function dayFlows(context, date) {
  let deposit = D(0),
    withdrawal = D(0);
  for (const e of context.byDay.get(date) || []) {
    if (!isExternalFlow(e, context.groups)) continue;
    const v = flowValue(
      context.book,
      e,
      (quote, id) =>
        quote.day >= closingDay(date, id === "FX" ? "FX" : marketFor(context.book.assets.get(id))),
    );
    if (v == null) return null;
    if (v.isNegative()) withdrawal = withdrawal.minus(v);
    else deposit = deposit.plus(v);
  }
  return { deposit, withdrawal };
}

// With no external flows, endpoint NAVs suffice to link across a missing close.
// The intervening point and any drawdown which depends on it remain unavailable.
function timeWeightedSeries() {
  let wealth = null,
    previous = null,
    gap = false;
  return (nav, flows, first) => {
    if (first) {
      wealth = nav > 0 ? D(1) : null;
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

// The deepest fall from a peak between two points. Any unvalued close in between withholds it.
function drawdown(points, id, first = 0, end = points.length - 1) {
  let peak = 1,
    worst = 0;
  if (end <= first) return null;
  for (const p of points.slice(first, end + 1)) {
    if (p[id] == null) return null;
    const level = 1 + p[id];
    peak = Math.max(peak, level);
    worst = Math.min(worst, level / peak - 1);
  }
  return worst;
}
function underperformance(points, id) {
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

function eventRows(context, from, to) {
  const rows = [];
  const names = new Map(context.accounts.map(({ account }) => [account.id, account.name]));
  for (const [date, events] of context.byDay) {
    if (date < from || date > to) continue;
    for (const e of events)
      rows.push({
        id: e.id,
        date,
        account: names.get(e.accountId),
        type: e.activityType,
        symbol: context.book.assets.get(e.assetId)?.symbol || e.assetSymbol,
        currency: e.currency,
        quantity: e.quantity,
        amount: e.amount,
        price: e.unitPrice,
        fee: e.fee,
        comment: e.comment,
      });
  }
  return rows.reverse();
}
export function reviewDay(db, { ids, date }) {
  date = day(date);
  const context = reviewBook(db, ids);
  const { total, cash, problems, rows } = valuation(context, date, true);
  return { date, total, cash, cashWeight: total > 0 && cash != null ? cash / total : null, problems, rows };
}
export function portfolioReview(db, args) {
  const context = reviewBook(db, args.ids);
  const earliest = context.accounts
    .map((a) => a.first)
    .filter(Boolean)
    .sort()[0];
  const to = day(args.to || context.book.latest);
  const suggested = periodStart(to, args.period || "1m", earliest);
  const requested = args.from || (earliest > to ? to : earliest > suggested ? earliest : suggested);
  reviewDates(requested, to);
  const days = [];
  for (let date = requested; date <= to; date = shiftDay(date, 1)) {
    const view = valuation(context, date);
    days.push({ date, view, flows: view.flowsKnown ? dayFlows(context, date) : null });
  }
  // Every curve is measured from the first close at which the whole portfolio can be valued.
  // A preset period opens there; a hand-picked start is kept and its earlier days stay blank.
  const origin = days.find((d) => d.view.total > 0)?.date || requested;
  const from = args.from ? requested : origin;
  const series = benchmarks.map((b) => {
    const rows = db
      .prepare("SELECT day,level,source FROM sp_benchmark_levels WHERE series=? ORDER BY day")
      .all(b.id);
    return {
      ...b,
      rows,
      source: rows.at(-1)?.source || b.source,
      first: rows[0]?.day,
      last: rows.at(-1)?.day,
    };
  });
  const points = [],
    outages = [],
    openGaps = new Map(),
    assets = new Set(),
    bases = {};
  const fxQuotes = ["FX:USD/AUD", "FX:AUD/USD"].flatMap((id) => context.book.prices.get(id) || []);
  const fxDates = fxQuotes.map((q) => q.day).sort();
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
  for (const { date, view, flows } of days) {
    if (date < from) continue;
    for (const id of view.missingAssets) assets.add(id);
    const measured = date >= origin;
    const portfolio = measured ? twr(view.total, flows, date === origin) : null;
    const flow = flows ? flows.deposit.minus(flows.withdrawal).toNumber() : null;
    const point = { date, portfolio, value: view.total, flow, gaps: {} };
    const issue =
      view.problems.join("、") ||
      (!measured && "组合在该日没有可估值的资产") ||
      (!flows && date !== origin && "外部划转缺少同日报价或汇率") ||
      (portfolio == null && "起点净值或资金划转前后的估值不足，请缩短区间");
    recordGap("portfolio", issue, date);
    const fx = rate(context.book, "USD", date);
    const fxValid = fx && fx.day >= closingDay(date, "FX");
    let allLevels = view.total > 0;
    for (const b of series) {
      const latest = last(b.rows, date);
      const known = latest && latest.day >= closingDay(date, "US");
      const audLevel = known && fxValid ? D(latest.level).mul(fx.price) : null;
      if (date === origin) bases[b.id] = audLevel;
      point[b.id] = measured && audLevel && bases[b.id] ? audLevel.div(bases[b.id]).minus(1).toNumber() : null;
      point.gaps[b.id] = portfolio != null && point[b.id] != null ? portfolio - point[b.id] : null;
      recordGap(
        b.id,
        !known
          ? "缺少总回报指数收盘点位"
          : !fxValid
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
  // Results are stated as of the latest close which can be valued, so a session that has not
  // closed yet, or a quote still to arrive, leaves the period's earlier results in place.
  const first = Math.max(
    0,
    points.findIndex((p) => p.date === origin),
  );
  const lastValued = (id) => {
    const i = points.findLastIndex((p) => p[id] != null);
    return i > first ? i : -1;
  };
  const own = lastValued("portfolio");
  const metrics = {
    portfolio: {
      totalReturn: own < 0 ? null : points[own].portfolio,
      maxDrawdown: drawdown(points, "portfolio", first, own),
      asOf: own < 0 ? null : points[own].date,
    },
  };
  for (const { id } of benchmarks) {
    // Portfolio and benchmark are compared on the latest close both can be measured at.
    const shared = points.findLastIndex((p) => p.gaps[id] != null);
    const i = shared > first ? shared : lastValued(id);
    metrics[id] = {
      totalReturn: i < 0 ? null : points[i][id],
      maxDrawdown: drawdown(points, id, first, i),
      gap: shared > first ? points[shared].gaps[id] : null,
      portfolioReturn: shared > first ? points[shared].portfolio : null,
      asOf: i < 0 ? null : points[i].date,
    };
  }
  let net = D(0),
    netKnown = own >= 0;
  for (const p of points.slice(first + 1, own + 1)) {
    if (p.flow == null) netKnown = false;
    else net = net.plus(p.flow);
  }
  const opened = points[first]?.value,
    closed = own < 0 ? null : points[own].value;
  const money =
    netKnown && opened != null && closed != null
      ? {
          start: opened,
          end: closed,
          flows: net.toNumber(),
          gain: D(closed).minus(opened).minus(net).toNumber(),
        }
      : null;
  const fetchable = /收盘价|汇率|点位/;
  return {
    ids: context.ids,
    from,
    to,
    requested,
    origin,
    earliest,
    commonStart,
    commonEnd,
    points,
    metrics,
    money,
    // Days after the latest valued close still wait for a quote, an FX rate or an index level.
    needsData: outages.some((o) => o.to >= origin && fetchable.test(o.reason)),
    outages,
    fx: { first: fxDates[0], last: fxDates.at(-1), sources: [...new Set(fxQuotes.map((q) => q.source))] },
    series: series.map(({ rows, ...meta }) => meta),
    intervals: benchmarks.flatMap((b) => underperformance(points, b.id)),
    events: eventRows(context, from, to),
    missingAssets: [...assets],
  };
}

export function saveReviewNote(db, review, text, id = randomUUID()) {
  const body = String(text || "").trim();
  if (!body || body.length > 8000) throw Error("请输入 1 至 8000 字的复盘笔记。");
  const { ids, from, to, metrics } = review;
  if (typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id)) throw Error("笔记编号无效。");
  const prior = db.prepare("SELECT data FROM sp_review_notes WHERE id=?").get(id);
  if (prior) {
    const saved = JSON.parse(prior.data);
    if (
      saved.text === body &&
      saved.from === from &&
      saved.to === to &&
      JSON.stringify(saved.ids) === JSON.stringify(ids)
    )
      return saved;
    throw Error("此笔记已保存，请新建笔记。");
  }
  const note = {
    id,
    created: new Date().toISOString(),
    text: body,
    ids,
    from,
    to,
    benchmarks: review.series.map((b) => b.id),
    metrics,
  };
  db.prepare("INSERT INTO sp_review_notes(id,created,data) VALUES(?,?,?)").run(
    note.id,
    note.created,
    JSON.stringify(note),
  );
  return note;
}
export function reviewNotes(db) {
  return db
    .prepare("SELECT data FROM sp_review_notes ORDER BY created DESC,id")
    .all()
    .map((r) => JSON.parse(r.data));
}
