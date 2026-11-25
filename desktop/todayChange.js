// 今日变动 on the net-value basis of ADR 0005: the investment gain of one day, from the previous
// close to the latest close at which the whole portfolio can be valued, in AUD. The portfolio,
// each account and each security row use the same two closes, so the amounts add up; a security
// row's 涨跌幅 is instead the price change of its listing in the trading currency.
import Decimal from "decimal.js";
import { canonicalIdentity, preferUsListingKey, usListingKey } from "./allocation/domain/identifiers";
import { securityType } from "./allocation/domain/portfolio";
import { last } from "./flows.js";
import { closingDay, marketFor, shiftDay } from "./marketDays.js";
import { dayFlows, reviewContext, timeWeightedSeries, valuation } from "./periodSummary.js";
import { periodContributions } from "./performance.js";

const D = (n) => new Decimal(n);
// How far back to look for the latest valued close and the one before it.
const lookback = 31;
const securityKey = (identity, currency) => JSON.stringify([identity, currency]);

// A day is a close when a market of something held that day has a session: the listing's
// exchange for a security, the FX market for foreign cash, weekdays for AUD cash alone.
function isClose(context, view, date) {
  const markets = new Set();
  for (const r of view.rows)
    if (!r.cash) markets.add(marketFor(context.book.assets.get(r.assetId)));
    else if (r.currency !== "AUD") markets.add("FX");
  if (!markets.size) markets.add("WEEKDAY");
  return [...markets].some((m) => closingDay(date, m) === date);
}

// Closes on or before `date`, latest first, with their detailed valuation.
function* closesBefore(context, date) {
  const floor = shiftDay(date, -lookback);
  for (let d = date; d >= floor; d = shiftDay(d, -1)) {
    const view = valuation(context, d, true);
    if (isClose(context, view, d)) yield { date: d, view };
  }
}

// Compare both weights across the whole selected portfolio, including cash. All accounts
// holding the same listing share one numerator even when the ledger has separate asset IDs.
export function addPriorWeights(context, date, securities, currentTotal) {
  const closes = closesBefore(context, date);
  closes.next();
  const prior = closes.next().value?.view;
  if (!(prior?.total > 0 && currentTotal > 0)) return;
  const values = new Map();
  for (const row of prior.rows) {
    if (row.cash) continue;
    const key = securityKey(row.key, row.currency);
    const old = values.get(key);
    values.set(key, row.value == null || old === null ? null : (old ?? D(0)).plus(row.value));
  }
  for (const security of securities) {
    const previous = values.get(security.key);
    if (previous === null || security.value == null) continue;
    security.newPosition = previous === undefined;
    security.weightChangePp = D(security.value).div(currentTotal)
      .minus((previous ?? D(0)).div(prior.total)).mul(100).toNumber();
  }
}

// The latest close on or before the valuation date valued on its own closes and rates (as the
// period engine states its results), or else the latest valued close, and the close before it.
function changeDays(context, date) {
  let latest = null,
    carried = null,
    previous = null;
  for (const close of closesBefore(context, date)) {
    if (latest) {
      previous = close.date;
      break;
    }
    if (close.view.total == null) continue;
    if (!close.view.stale.length) latest = close.date;
    else carried ??= close;
  }
  if (latest) return { latest, previous };
  if (!carried) return null;
  const earlier = closesBefore(context, shiftDay(carried.date, -1)).next().value;
  return { latest: carried.date, previous: earlier?.date ?? null };
}

// The gain from the close of `from` to the close of `to`, net of external flows in between,
// with the time-weighted return chained day by day as the period engine does.
function measure(context, from, to) {
  const start = valuation(context, from).total;
  const chain = timeWeightedSeries();
  chain(start, null, true);
  let net = D(0),
    flowsKnown = true,
    end = null,
    twr = null;
  for (let d = shiftDay(from, 1); d <= to; d = shiftDay(d, 1)) {
    const view = valuation(context, d);
    const flows = view.flowsKnown ? dayFlows(context, d) : null;
    twr = chain(view.total, flows, false);
    if (flows) net = net.plus(flows.deposit).minus(flows.withdrawal);
    else flowsKnown = false;
    end = view.total;
  }
  const known = start != null && end != null && flowsKnown;
  return {
    date: to,
    previous: from,
    startValue: start,
    endValue: end,
    flow: flowsKnown ? net.toNumber() : null,
    change: known ? D(end).minus(start).minus(net).toNumber() : null,
    twr,
  };
}

// The close of a listing on its latest session on or before `date`, against its previous
// session's close, in the trading currency.
export function priceChange(book, assetId, date) {
  const quotes = book.prices.get(assetId),
    market = marketFor(book.assets.get(assetId));
  const close = last(quotes, closingDay(date, market));
  const prior = close && last(quotes, closingDay(shiftDay(close.day, -1), market));
  if (!prior) return null;
  return {
    date: close.day,
    previous: prior.day,
    close: Number(close.price),
    previousClose: Number(prior.price),
    change: D(close.price).div(prior.price).minus(1).toNumber(),
  };
}

export function asxQuoteChange(book, closes, row) {
  const { assetId, price, priceUpdatedAt: date, quoteSource } = row;
  if (row.localCurrency !== "AUD" || marketFor(book.assets.get(assetId)) !== "ASX") return undefined;
  if (!date || price == null || closingDay(date, "ASX") !== date) return null;

  // A broker snapshot dates the account reading. Check the mark against a dated market quote.
  if (["Webull AU", "券商账户页面（手工核对）"].includes(quoteSource)) {
    const quote = last(book.prices.get(assetId), date);
    if (quote?.day !== date || !D(quote.price).toDecimalPlaces(4).eq(D(price).toDecimalPlaces(4))) return null;
  }
  const previous = closingDay(shiftDay(date, -1), "ASX");
  const prior = last(closes.prices.get(assetId), previous);
  if (prior?.day !== previous) return null;

  return {
    date,
    previousClose: Number(prior.price),
    price: Number(price),
    change: D(price).div(prior.price).minus(1).toNumber(),
    amount: D(price).minus(prior.price).mul(row.rawQuantity).toNumber(),
  };
}

// Each security's share of the day's change (ADR 0003 contributions over one day), followed by
// the account-level items such as cash interest and the cash rate move.
function securityChanges(context, day) {
  if (day.change == null) return null;
  const assets = new Map();
  for (const date of [day.previous, day.date])
    for (const r of valuation(context, date, true).rows)
      if (!r.cash) assets.set(securityKey(r.key, r.currency), r.assetId);
  return periodContributions(context, day.previous, day.date, day.change).rows.map((r) => {
    const assetId = r.kind === "security" ? assets.get(r.key) : null;
    return {
      key: r.key,
      label: r.label,
      listing: r.listing,
      kind: r.kind,
      change: r.gain,
      closed: Boolean(r.closed),
      priceChange: assetId ? priceChange(context.book, assetId, day.date) : null,
    };
  });
}

function changeOn(context, days) {
  const day = days.previous ? measure(context, days.previous, days.latest) : null;
  return day && { ...day, securities: securityChanges(context, day) };
}

// The daily change of the selected accounts as of the valuation date, from a close book: the
// portfolio's, and each account's over the portfolio's two closes.
export function todayChange(book, ids, date) {
  const context = reviewContext(book, ids);
  const days = changeDays(context, date);
  if (!days?.previous) return null;
  const portfolio = changeOn(context, days);
  const accounts = Object.fromEntries(
    ids.map((id) => [id, ids.length === 1 ? portfolio : changeOn(reviewContext(book, [id]), days)]),
  );
  return { ...portfolio, accounts };
}

// Weight directly held listings by value. For ETF-only exposure, use a known listing
// when the exposure identifies exactly one security in the ledger.
function companyChange(row, holdings, listings, book, date) {
  let weighted = D(0),
    weight = D(0);
  for (const source of row.sources) {
    if (source.kind !== "direct") continue;
    const holding = holdings.get(source.holdingId);
    const change = holding && priceChange(book, holding.assetId, date)?.change;
    if (change == null || !(source.amountAud > 0)) continue;
    weighted = weighted.plus(D(change).mul(source.amountAud));
    weight = weight.plus(source.amountAud);
  }
  if (weight.gt(0)) return weighted.div(weight).toNumber();
  if (row.type !== "stock" || row.sources.some((source) => source.kind === "direct")) return null;
  const matches = listings.get(row.key);
  return matches?.length === 1 ? priceChange(book, matches[0].id, date)?.change ?? null : null;
}

// Puts the daily change on the dashboard's accounts, holding rows, merged holdings and exposure.
export function applyTodayChange(today, book, { accounts, holdings, exposure }) {
  const rowChange = (rows, key) => {
    const r = rows?.find((s) => s.key === key);
    return r ? { change: r.change, priceChange: r.priceChange } : null;
  };
  for (const view of accounts) {
    view.today = today?.accounts[view.id] ?? null;
    for (const row of view.rows)
      if (row.type !== "cash") row.today = rowChange(view.today?.securities, securityKey(row.identityKey, row.localCurrency));
  }
  for (const s of holdings.securities) s.today = rowChange(today?.securities, s.key);
  if (!today) return null;
  const { accounts: _, ...portfolio } = today;
  const byId = new Map(accounts.flatMap((a) => a.rows).map((r) => [r.id, r]));
  const stocks = [...book.assets.values()].filter((a) => securityType({ ...a, instrumentType: a.kind }) === "stock");
  const listings = Map.groupBy(stocks, (asset) => {
    const key = canonicalIdentity(asset).key;
    return usListingKey(asset) ?? (key && preferUsListingKey(key));
  });
  portfolio.companies = Object.fromEntries(
    exposure.rows.map((row) => [row.key, companyChange(row, byId, listings, book, today.date)]),
  );
  return portfolio;
}
