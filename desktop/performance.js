import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { day } from "./ledger.js";
import { flowValue, isExternalFlow, posting, rate } from "./flows.js";
import { canonicalIdentity } from "./allocation/domain/identifiers";
import { reviewDates } from "./reviewMarket.js";
import { reviewBook, summarizePeriod, valuation } from "./periodSummary.js";
import { attributedAsset, gainBreakdown } from "./gainBreakdown.js";

const D = (n) => new Decimal(n);

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
        reference: e.sourceRecordId || e.comment || e.id,
        comment: e.comment,
      });
  }
  return rows.reverse();
}

// A security earns its change in marked value plus its net cash postings, less
// securities brought in from outside. Start-day trades are in the opening close.
export function periodContributions(context, from, to, gain) {
  const groups = new Map(),
    keys = new Map(),
    cash = new Map();
  function entry(key, label, kind) {
    if (!groups.has(key))
      groups.set(key, {
        key,
        label,
        kind,
        value: D(0),
        units: D(0),
        ending: D(0),
        known: true,
        sold: false,
        events: [],
      });
    return groups.get(key);
  }
  function add(row, value) {
    if (value == null) row.known = false;
    else row.value = row.value.plus(value);
  }
  function currencyBalance(code) {
    if (!cash.has(code)) cash.set(code, { units: D(0), value: D(0), known: true });
    return cash.get(code);
  }
  for (const [date, sign] of [
    [from, -1],
    [to, 1],
  ]) {
    for (const h of valuation(context, date, true).rows) {
      const key = JSON.stringify([h.key, h.currency]);
      const row = h.cash ? currencyBalance(h.currency) : entry(key, h.symbol, "security");
      if (!h.cash) {
        keys.set(h.assetId, key);
        row.assetId = h.assetId;
        row.listing = [context.book.assets.get(h.assetId)?.mic, h.currency].filter(Boolean).join(" · ");
        if (sign === 1) row.ending = row.ending.plus(h.quantity);
      }
      row.units = row.units.plus(D(h.quantity).mul(sign));
      add(row, h.value == null ? null : D(h.value).mul(sign));
    }
  }
  // Postings use the latest rate and quote on or before their day, as the valuations do.
  for (const [date, events] of context.byDay) {
    if (date <= from || date > to) continue;
    for (const e of events) {
      const p = posting(e);
      if (!p) continue;
      const fx = rate(context.book, e.currency, date, e.accountId);
      const convert = (v) => (v.isZero() ? D(0) : fx ? v.mul(fx.price) : null);
      const fees = D(e.fee ?? 0)
        .abs()
        .plus(D(e.tax ?? 0).abs());
      const transfer = e.activityType.startsWith("TRANSFER");
      const internal = transfer && context.groups.has(e.group) && !e.metadata?.fx;
      const external = isExternalFlow(e, context.groups);
      const receipt = {
        id: e.id,
        date,
        account: e.accountId,
        type: e.activityType,
        reference: e.sourceRecordId || e.comment || e.id,
        currency: e.currency,
        quantity: e.quantity,
        price: e.unitPrice,
        amount: e.amount,
        fee: e.fee,
        tax: e.tax,
      };
      // A paired cash transfer stays in the combined portfolio, including while in transit.
      const cashPosting = internal && !p.units ? fees.neg() : p.cash;
      const balance = currencyBalance(e.currency);
      balance.units = balance.units.minus(cashPosting);
      const cashAud = convert(cashPosting);
      add(balance, cashAud == null ? null : cashAud.neg());
      const assetId = attributedAsset(context.book, e);
      if (assetId) {
        const a = context.book.assets.get(assetId);
        const key =
          keys.get(assetId) ||
          JSON.stringify([
            (a && canonicalIdentity(a).key) || "asset:" + assetId,
            a?.currency || e.currency,
          ]);
        const row = entry(key, a?.symbol || e.assetSymbol, "security");
        row.assetId ??= assetId;
        row.listing = [a?.mic, a?.currency || e.currency].filter(Boolean).join(" · ");
        row.events.push(receipt);
        if (!internal && p.units) row.units = row.units.minus(p.units);
        if (e.activityType === "SELL") row.sold = true;
        add(row, cashAud);
        if (external && p.units) {
          const flow = flowValue(context.book, e);
          add(row, flow == null ? null : flow.neg());
        }
      } else {
        const amount = external || internal ? fees.neg() : cashPosting;
        if (amount.isZero()) continue;
        const label = e.metadata?.fx
          ? "换汇差额及费用"
          : external || internal
            ? "划转费用"
            : e.activityType === "INTEREST"
              ? "现金利息"
              : "待归属";
        const row = entry(label, label, "account");
        add(row, convert(amount));
        row.events.push(receipt);
      }
    }
  }
  for (const [code, balance] of cash) {
    if (code === "AUD" || !balance.known || !balance.units.abs().lt("0.000001") || balance.value.isZero())
      continue;
    add(entry("fx:" + code, code + " 现金汇率变动", "account"), balance.value);
  }
  const rows = [...groups.values()]
    .map((r) => ({
      key: r.key,
      label: r.label,
      listing: r.listing,
      assetId: r.assetId,
      kind: r.kind,
      events: r.events,
      gain: r.known && r.units.abs().lt("0.000001") ? r.value.toNumber() : null,
      closed: r.sold && r.ending.isZero(),
    }));
  const remainder = rows.reduce((left, row) => left.minus(row.gain ?? 0), D(gain));
  if (remainder.abs().gte("0.005"))
    rows.push({
      key: "unreconciled",
      label: "尚待核对的估值或流水差额",
      kind: "account",
      events: [],
      gain: remainder.toNumber(),
    });
  rows.sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity));
  return { from, to, rows };
}
export function reviewDay(db, { ids, date }) {
  date = day(date);
  const context = reviewBook(db, ids);
  const { total, cash, problems, rows } = valuation(context, date, true);
  return { date, total, cash, cashWeight: total > 0 && cash != null ? cash / total : null, problems, rows };
}
export function portfolioReview(db, args) {
  const context = reviewBook(db, args.ids);
  const to = day(args.to || context.book.latest);
  reviewDates(args.from || to, to);
  const summary = summarizePeriod(context, { to, period: args.period || "1m", from: args.from });
  const { period, origin, points } = summary;
  const metrics = {
    portfolio: {
      totalReturn: summary.twr,
      annualised: summary.annualised,
      maxDrawdown: summary.drawdown?.depth ?? null,
      drawdown: summary.drawdown,
      asOf: summary.asOf,
    },
    ...summary.benchmarks,
  };
  const money =
    summary.gain == null
      ? null
      : { start: summary.startValue, end: summary.endValue, flows: summary.netFlow, gain: summary.gain };
  const fxQuotes = ["FX:USD/AUD", "FX:AUD/USD"].flatMap((id) => context.book.prices.get(id) || []);
  const fxDates = fxQuotes.map((q) => q.day).sort();
  const fetchable = /收盘价|汇率|点位/;
  return {
    ids: context.ids,
    accountNames: Object.fromEntries(context.accounts.map(({ account }) => [account.id, account.name])),
    from: period.from,
    to,
    base: period.base,
    measuredDays: summary.measuredDays,
    requested: period.requested,
    period,
    origin,
    earliest: summary.earliest,
    commonStart: summary.commonStart,
    commonEnd: summary.commonEnd,
    points,
    metrics,
    money,
    hasQuarter: summary.hasQuarter,
    drawdownSeries: summary.drawdownSeries,
    benchmarkDrawdowns: summary.benchmarkDrawdowns,
    contributions: money ? periodContributions(context, origin, summary.valuedThrough, money.gain) : null,
    breakdown: gainBreakdown(context, summary),
    // Days after the latest valued close still wait for a quote, an FX rate or an index level.
    needsData: summary.outages.some((o) => o.to >= origin && fetchable.test(o.reason)),
    outages: summary.outages,
    fx: { first: fxDates[0], last: fxDates.at(-1), sources: [...new Set(fxQuotes.map((q) => q.source))] },
    series: summary.series,
    intervals: summary.intervals,
    events: eventRows(context, period.from, to),
    missingAssets: summary.missingAssets,
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
