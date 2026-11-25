import Decimal from "decimal.js";
import { tMain } from "./i18n/index.js";

function sameNumber(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return new Decimal(a).eq(b);
}

function compareNumber(edits, label, before, after, format, currency, oldCurrency = currency) {
  if (!sameNumber(before, after))
    edits.push({ label, before: before ?? null, after: after ?? null, format, currency, oldCurrency });
}

export function activityEdits(before, after) {
  const edits = [];
  for (const [key, label] of [
    ["date", tMain("edit.date")],
    ["type", tMain("edit.type")],
    ["symbol", tMain("edit.symbol")],
    ["currency", tMain("edit.currency")],
  ]) {
    const value = (row) => key === "date" ? String(row.date || "").slice(0, 10) : row[key] || null;
    if (value(before) !== value(after)) edits.push({ label, before: value(before), after: value(after), format: key });
  }
  compareNumber(edits, tMain("edit.quantity"), before.quantity, after.quantity, "quantity");
  compareNumber(edits, tMain("edit.price"), before.unitPrice, after.unitPrice, "price", after.currency, before.currency);
  if (!["BUY", "SELL"].includes(after.type) || !["BUY", "SELL"].includes(before.type))
    compareNumber(edits, tMain("edit.amount"), before.amount, after.amount, "money", after.currency, before.currency);
  for (const [key, label] of [["fee", tMain("edit.fee")], ["tax", tMain("edit.tax")]])
    compareNumber(edits, label, before[key] ?? 0, after[key] ?? 0, "money", after.currency, before.currency);
  return edits;
}

function positionsBySecurity(positions, exchanges, currencies) {
  const result = new Map();
  for (const p of positions) {
    const code = p.symbol.trim().toUpperCase(), market = p.mic || "";
    const qualify = exchanges.get(code + "/" + p.currency).size > 1;
    const key = JSON.stringify([code, p.currency, qualify ? market : ""]);
    const fx = p.fxToBase ?? p.fx ?? null, prior = result.get(key);
    if (prior) {
      prior.quantity = new Decimal(prior.quantity).plus(p.quantity).toFixed();
      if (!sameNumber(prior.price, p.price)) prior.price = null;
      if (!sameNumber(prior.fx, fx)) prior.fx = null;
    } else {
      const venue = [currencies.get(code).size > 1 ? p.currency : null, qualify ? market : null].filter(Boolean).join(" / ");
      result.set(key, { name: venue ? code + " (" + venue + ")" : code, currency: p.currency,
        quantity: p.quantity, price: p.price ?? null, fx });
    }
  }
  for (const [key, p] of result) if (new Decimal(p.quantity).isZero()) result.delete(key);
  return result;
}

export function valuationEdits(previous, current) {
  const edits = [];
  const audCash = (v) => v?.cashTotal ?? (Object.keys(v?.cash || {}).length === 1 ? v.cash.AUD : null);
  const nav = current.nav ?? new Decimal(current.cashTotal).plus(current.securities).toFixed();
  compareNumber(edits, tMain("edit.nav"), previous?.nav, nav, "money", current.base);
  compareNumber(edits, tMain("edit.cash"), audCash(previous), audCash(current), "money", current.base);
  compareNumber(edits, tMain("edit.securities"), previous?.securities, current.securities, "money", current.base);
  compareNumber(edits, tMain("edit.unrealized"), previous?.unrealized, current.unrealized, "money", current.base);
  if (previous?.unrealized != null && current.unrealized != null &&
      Boolean(previous.approximatePnl) !== Boolean(current.approximatePnl))
    edits.push({
      label: tMain("edit.pnlPrecision"),
      before: previous.approximatePnl ? tMain("edit.approx") : tMain("edit.exact"),
      after: current.approximatePnl ? tMain("edit.approx") : tMain("edit.exact"),
    });

  const currencies = new Set([...Object.keys(previous?.cash || {}), ...Object.keys(current.cash)]);
  for (const c of currencies) {
    if (currencies.size === 1 && c === "AUD" &&
        sameNumber(previous?.cash?.AUD, audCash(previous)) && sameNumber(current.cash.AUD, audCash(current))) continue;
    compareNumber(edits, tMain("edit.cashCcy", { currency: c }), previous?.cash?.[c], current.cash[c], "money", c);
  }

  const before = previous?.positions || [], after = current.positions;
  const exchanges = new Map(), securityCurrencies = new Map();
  for (const p of [...before, ...after]) {
    const code = p.symbol.trim().toUpperCase(), key = code + "/" + p.currency;
    if (!securityCurrencies.has(code)) securityCurrencies.set(code, new Set());
    securityCurrencies.get(code).add(p.currency);
    if (!exchanges.has(key)) exchanges.set(key, new Set());
    if (p.mic) exchanges.get(key).add(p.mic);
  }
  const saved = positionsBySecurity(before, exchanges, securityCurrencies);
  const incoming = positionsBySecurity(after, exchanges, securityCurrencies);
  for (const key of new Set([...saved.keys(), ...incoming.keys()])) {
    const old = saved.get(key), fresh = incoming.get(key), p = fresh || old;
    compareNumber(edits, tMain("edit.posQty", { name: p.name }), old?.quantity ?? (previous ? 0 : null), fresh?.quantity ?? 0, "quantity");
    if (!fresh) continue;
    compareNumber(edits, tMain("edit.posQuote", { name: p.name }), old?.price, fresh.price, "price", p.currency);
    compareNumber(edits, tMain("edit.posFx", { name: p.name }), old?.fx, fresh.fx, "rate");
  }
  return edits;
}
