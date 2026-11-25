import Decimal from "decimal.js";
import { marketCloseTime, marketFor, marketSession, shiftDay, closingDay } from "./marketDays.js";

const D = (value) => new Decimal(value);
const latestDatedQuote = (quotes, date, market) =>
  quotes?.findLast((q) => q.day <= date && closingDay(q.day, market) === q.day);

export function listingQuote(live, asset, fallback) {
  const market = marketFor(asset);
  if (["Webull AU", "Twelve Data"].includes(fallback?.source)) fallback = null;
  if (!["US", "ASX"].includes(market))
    return fallback && { ...fallback, status: "uncovered" };
  const session = marketSession(live.now, market);
  const closes = live.historical.prices.get(asset.id);
  const close = latestDatedQuote(closes, session.completed, market);
  const awaitingClose = market === "ASX" && session.phase === "closed" &&
    session.completed === session.date && close?.day !== session.completed;
  const datedFallback = fallback && fallback.day <= session.completed && closingDay(fallback.day, market) === fallback.day;
  const candidate = datedFallback && (!close || fallback.day > close.day) ? fallback : close;
  if (!candidate) return null;
  const priorDay = closingDay(shiftDay(candidate.day, -1), market);
  const priorClose = latestDatedQuote(closes, priorDay, market);
  const status = awaitingClose ? "awaiting-close" :
    candidate === close && close.day === session.completed ? "close" : "old";
  return {
    ...candidate, status, market, closedAt: marketCloseTime(candidate.day, market),
    previousClose: priorClose?.day === priorDay ? priorClose : null,
  };
}

export function fxTranslation(accounts, quote, baseline, portfolioValue) {
  const factor = quote && baseline ? D(quote.price).minus(baseline.price) : null;
  const impact = (usd) => usd == null ? null : usd.isZero() ? 0 : factor?.mul(usd).toNumber() ?? null;
  const rows = accounts.map((account) => {
    const usd = account.rows.filter((row) => row.localCurrency === "USD");
    const stocks = usd.filter((row) => row.type !== "cash");
    const holdings = stocks.some((row) => row.price == null) ? null :
      stocks.reduce((amount, row) => amount.plus(D(row.price).mul(row.rawQuantity)), D(0));
    const cash = account.cashUnverified ? null : usd.filter((row) => row.type === "cash")
      .reduce((amount, row) => amount.plus(row.rawQuantity), D(0));
    return {
      id: account.id, name: account.name, holdings: holdings?.toNumber() ?? null, cash: cash?.toNumber() ?? null,
      holdingsImpact: impact(holdings), cashImpact: impact(cash),
      impact: holdings != null && cash != null ? impact(holdings.plus(cash)) : null,
    };
  });
  const exposureUsd = rows.some((row) => row.holdings == null || row.cash == null) ? null :
    rows.reduce((sum, row) => sum.plus(row.holdings).plus(row.cash), D(0)).toNumber();
  const exposureAud = exposureUsd === 0 ? 0 : exposureUsd != null && quote ? D(exposureUsd).mul(quote.price) : null;
  return {
    quote, baseline, date: baseline?.day ?? null, accounts: rows,
    exposureUsd,
    exposureShare: exposureAud != null && portfolioValue > 0 ? D(exposureAud).div(portfolioValue).toNumber() : null,
    sensitivity: exposureAud == null ? null : D(exposureAud).abs().mul(0.01).toNumber(),
    rateChange: factor == null ? null : factor.div(baseline.price).toNumber(),
    impact: rows.some((row) => row.impact == null) ? null : rows.reduce((total, row) => total.plus(row.impact), D(0)).toNumber(),
  };
}

function sumChanges(changes) {
  const sum = (field) => changes.some((change) => change[field] == null) ? null :
    changes.reduce((total, change) => total.plus(change[field]), D(0));
  const price = sum("price"), fx = sum("fx");
  return { price: price?.toNumber() ?? null, fx: fx?.toNumber() ?? null,
    total: price != null && fx != null ? price.plus(fx).toNumber() : null };
}

export function recentCloseChanges(accounts, rates) {
  for (const account of accounts) {
    const closes = new Map();
    const changes = account.rows.map((row) => {
      const cash = row.type === "cash";
      const quote = row.marketQuote;
      if (quote?.closedAt != null)
        closes.set(quote.closedAt, { market: quote.market, day: quote.day, at: quote.closedAt });
      const pair = rates.get(row.localCurrency);
      const before = pair?.previous?.price;
      const latest = pair?.latest?.price;
      const units = D(row.rawQuantity);
      const price = cash ? D(0) : quote?.previousClose && before != null
        ? D(quote.price).minus(quote.previousClose.price).mul(units).mul(before) : null;
      // Value the stock move at the previous rate, then apply the rate change to its latest market value.
      const fx = row.localCurrency === "AUD" ? D(0) :
        latest != null && before != null && row.price != null && !(cash && account.cashUnverified)
          ? D(latest).minus(before).mul(row.price).mul(units) : null;
      row.recentCloseChange = price != null && fx != null ? price.plus(fx).toNumber() : null;
      return { price, fx };
    });
    account.recentCloseChange = { ...sumChanges(changes), closes: [...closes.values()].sort((a, b) => b.at - a.at) };
  }
  return sumChanges(accounts.map((account) => account.recentCloseChange));
}
