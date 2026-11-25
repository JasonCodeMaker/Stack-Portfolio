// The gain breakdown of ADR 0005: a period's investment gain split into unrealised change,
// realised gain, dividends and interest, fees and FX, each itemised by security; and the
// cumulative realised gain and dividends of each holding on the holdings page.
import Decimal from "decimal.js";
import { canonicalIdentity } from "./allocation/domain/identifiers";
import { flowValue, isExternalFlow, last, live, posting, rate, replayLots } from "./flows.js";
import { dayOf } from "./ledger.js";
import { valuation } from "./periodSummary.js";
import { tMain } from "./i18n/index.js";

const D = (n) => new Decimal(n ?? 0);
const partKeys = ["unrealised", "realised", "income", "fees", "fx"];
const partList = () => partKeys.map((p) => [p, tMain("bd." + p)]);

// Dividend withholding and borrowing interest arrive as their own tax and fee records.
const withholding = (e) => /withholding|dividend|股息|预扣/i.test(e.comment || "");
const borrowing = (e) => /interest|利息/i.test(e.comment || "");
const conversion = (e) => Boolean(e.metadata?.fx) || /\bFX\b|换汇/i.test(e.comment || "");

// The linked security, or for dividend withholding the single listing in the record's
// currency whose ticker opens its description, as in "AAPL(US0378331005) Cash Dividend …".
export function attributedAsset(book, e) {
  if (e.assetId || e.activityType !== "TAX" || !withholding(e)) return e.assetId;
  const ticker = /^([A-Z0-9.]+)\s*[(\s]/.exec(e.comment || "")?.[1];
  const matches = ticker
    ? [...book.assets.values()].filter((a) => a.symbol?.toUpperCase() === ticker && a.currency === e.currency)
    : [];
  return matches.length === 1 ? matches[0].id : null;
}

// What a record adds to 分红与利息 and 费用, in its own currency, with the security it belongs to
// or, for cash-level records, the row it is listed under.
function shares(book, e) {
  const fees = D(e.fee).abs().plus(D(e.tax).abs()),
    amount = D(e.amount).abs();
  const charge = amount.plus(fees).neg();
  switch (e.activityType) {
    case "BUY":
    case "SELL":
      return [{ part: "fees", asset: e.assetId, amount: fees.neg() }];
    case "DIVIDEND":
    case "INTEREST":
      return [
        {
          part: "income",
          asset: e.assetId,
          label: e.activityType === "INTEREST" ? tMain("bd.cashInterest") : tMain("bd.unattributedDiv"),
          amount: amount.minus(D(e.tax).abs()),
        },
        { part: "fees", asset: e.assetId, label: tMain("bd.accountFees"), amount: D(e.fee).abs().neg() },
      ];
    case "FEE":
      return borrowing(e)
        ? [{ part: "income", label: tMain("bd.borrowInterest"), amount: charge }]
        : [{ part: "fees", asset: e.assetId, label: conversion(e) ? tMain("bd.fxFee") : tMain("bd.accountFees"), amount: charge }];
    case "TAX":
      return withholding(e)
        ? [{ part: "income", asset: attributedAsset(book, e), label: tMain("bd.divWithholding"), amount: charge }]
        : [{ part: "fees", asset: e.assetId, label: conversion(e) ? tMain("bd.fxFee") : tMain("bd.tradeTax"), amount: charge }];
    case "CREDIT":
      return [{ part: "fees", label: tMain("bd.otherAdjustments"), amount: amount.minus(fees) }];
    case "DEBIT":
      return [{ part: "fees", label: tMain("bd.otherAdjustments"), amount: charge }];
    case "DEPOSIT":
    case "WITHDRAWAL":
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return [{ part: "fees", label: conversion(e) ? tMain("bd.fxFee") : tMain("bd.transferFees"), amount: fees.neg() }];
    default:
      return [];
  }
}

// A unit cost for units without cost evidence: the latest close on or before their day, or
// else the first close after it (ADR 0005: the first market value that can be put on them).
const firstValue = (book) => (id, on) => {
  const quotes = book.prices.get(id);
  const q = last(quotes, on) || quotes?.find((r) => r.day > on);
  return q && D(q.price).gt(0) ? D(q.price) : null;
};

// The five parts of the investment gain over (origin, valuedThrough] of a period summary.
// Realised and unrealised exclude trading fees, which are counted once under 费用; 汇率 is the
// remainder, so the parts always add up to the gain.
export function gainBreakdown(context, summary) {
  if (summary?.gain == null) return null;
  const parts = partList();
  const { book } = context,
    from = summary.origin,
    to = summary.valuedThrough;
  const groups = new Map(),
    keys = new Map();
  function group(key, label, kind, listing) {
    if (!groups.has(key))
      groups.set(key, {
        key,
        label,
        kind,
        listing,
        price: D(0),
        ...Object.fromEntries(parts.map(([p]) => [p, D(0)])),
      });
    return groups.get(key);
  }
  function security(id, symbol, currency) {
    const a = book.assets.get(id);
    const key =
      keys.get(id) ||
      JSON.stringify([(a && canonicalIdentity(a).key) || "asset:" + id, a?.currency || currency]);
    const row = group(key, a?.symbol || symbol, "security", [a?.mic, a?.currency || currency].filter(Boolean).join(" · "));
    row.assetId ??= id;
    return row;
  }
  const convert = (amount, currency, date, account) => {
    if (amount.isZero()) return D(0);
    const fx = rate(book, currency, date, account);
    return fx ? amount.mul(fx.price) : D(0);
  };
  const replay = (date) =>
    new Map(
      context.accounts.map(({ account }) => [
        account.id,
        replayLots(book, account, date, { fees: false, fallback: firstValue(book) }),
      ]),
    );
  const atEnd = replay(to);
  // Unrealised gain at each end: market value less cost, both at that day's rate. Securities in
  // transit between accounts carry no cost and add only to the change in market value.
  for (const [date, sign, lots] of [
    [from, -1, replay(from)],
    [to, 1, atEnd],
  ])
    for (const h of valuation(context, date, true).rows) {
      if (h.cash) continue;
      const key = JSON.stringify([h.key, h.currency]);
      keys.set(h.assetId, key);
      const row = security(h.assetId, h.symbol, h.currency);
      row.assetId = h.assetId;
      const value = D(h.value ?? 0);
      row.price = row.price.plus(value.mul(sign));
      const lot = lots.get(h.accountId)?.lots.get(h.assetId);
      if (!lot?.known || !lot.units.gt(0)) continue;
      const cost = convert(lot.local.div(lot.units).mul(h.quantity), h.currency, date, h.accountId);
      row.unrealised = row.unrealised.plus(value.minus(cost).mul(sign));
    }
  const within = (date) => date > from && date <= to;
  for (const [date, events] of context.byDay) {
    if (!within(date)) continue;
    for (const e of events) {
      const p = posting(e);
      if (!p) continue;
      if (e.assetId && ["BUY", "SELL"].includes(e.activityType)) {
        const trade = D(e.unitPrice).mul(D(e.quantity).abs());
        const row = security(e.assetId, e.assetSymbol, e.currency);
        row.price = row.price.plus(convert(e.activityType === "SELL" ? trade : trade.neg(), e.currency, date, e.accountId));
      }
      // Securities brought in from outside are not a gain; matched transfers stay in the portfolio.
      if (e.assetId && p.units && isExternalFlow(e, context.groups)) {
        const row = security(e.assetId, e.assetSymbol, e.currency);
        row.price = row.price.minus(flowValue(book, e) ?? 0);
      }
      for (const s of shares(book, e)) {
        if (s.amount.isZero()) continue;
        const row = s.asset ? security(s.asset, e.assetSymbol, e.currency) : group(s.label, s.label, "account");
        row[s.part] = row[s.part].plus(convert(s.amount, e.currency, date, e.accountId));
      }
    }
  }
  for (const [account, { sales, transfers }] of atEnd) {
    for (const { event: e, day, cost } of sales) {
      if (!within(day)) continue;
      const a = book.assets.get(e.assetId),
        currency = a?.currency || e.currency;
      const proceeds = D(e.unitPrice).mul(D(e.quantity).abs());
      const row = security(e.assetId, e.assetSymbol, currency);
      row.realised = row.realised.plus(convert(proceeds.minus(cost ?? proceeds), currency, day, account));
    }
    // A security moved in or out carries its unrealised gain at that day's value with it.
    for (const { event: e, day, cost } of transfers) {
      const value = within(day) && cost != null ? flowValue(book, e) : null;
      if (value == null) continue;
      const currency = book.assets.get(e.assetId)?.currency || e.currency;
      const carried = value.abs().minus(convert(cost, currency, day, account));
      const row = security(e.assetId, e.assetSymbol, currency);
      row.unrealised = row.unrealised.plus(e.activityType === "TRANSFER_IN" ? carried.neg() : carried);
    }
  }
  const rows = [...groups.values()];
  for (const r of rows) if (r.kind === "security") r.fx = r.price.minus(r.realised).minus(r.unrealised);
  const totals = Object.fromEntries(parts.map(([p]) => [p, rows.reduce((n, r) => n.plus(r[p]), D(0))]));
  // Foreign cash revalued at new rates, and what the rates leave over, close the identity.
  const fx = D(summary.gain).minus(totals.unrealised).minus(totals.realised).minus(totals.income).minus(totals.fees);
  group("foreign-cash", tMain("bd.foreignCash"), "account").fx = fx.minus(totals.fx);
  totals.fx = fx;
  return {
    from,
    to,
    gain: summary.gain,
    parts: Object.fromEntries(parts.map(([p]) => [p, totals[p].toNumber()])),
    items: parts.map(([part, label]) => ({
      key: part,
      label,
      value: totals[part].toNumber(),
      rows: [...groups.values()]
        .filter((r) => r[part].abs().gte("0.005"))
        .map(({ key, label, kind, listing, assetId, ...r }) => ({ key, label, kind, listing, assetId, value: r[part].toNumber() }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    })),
  };
}

// Each security's realised gain and dividends from the account's first record through `date`,
// in AUD at the sale and pay dates. Realised gain counts cost with buy fees and proceeds after
// sell fees; a sale of units without cost evidence adds none.
export function cumulativeIncome(book, acc, date) {
  const out = new Map();
  const entry = (id) => {
    if (!out.has(id)) out.set(id, { realised: D(0), dividends: D(0) });
    return out.get(id);
  };
  const aud = (amount, currency, day) => {
    const fx = rate(book, currency, day, acc.id);
    return fx ? amount.mul(fx.price) : D(0);
  };
  for (const { event: e, day, cost } of replayLots(book, acc, date).sales) {
    if (cost == null) continue;
    const currency = book.assets.get(e.assetId)?.currency || e.currency;
    const proceeds = D(e.unitPrice)
      .mul(D(e.quantity).abs())
      .minus(D(e.fee).abs())
      .minus(D(e.tax).abs());
    entry(e.assetId).realised = entry(e.assetId).realised.plus(aud(proceeds.minus(cost), currency, day));
  }
  for (const { current: e } of book.byAccount.get(acc.id) || []) {
    const day = dayOf(e.date);
    if (!live(e) || day > date) continue;
    for (const s of shares(book, e))
      if (s.part === "income" && s.asset && !s.amount.isZero())
        entry(s.asset).dividends = entry(s.asset).dividends.plus(aud(s.amount, e.currency, day));
  }
  return out;
}
