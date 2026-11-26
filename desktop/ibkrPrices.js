import Decimal from "decimal.js";
import { day, resolveAsset } from "./ledger.js";
import { tMain } from "./i18n/index.js";

// Stored source names stay fixed; preview labels name them in the active language.
const SOURCE_KEYS = {
  "IBKR 成交报表折算率": "source.ibkrExecFx",
  "IBKR 成交报表收盘价": "source.ibkrExecClose",
  "IBKR 结单报价": "source.ibkrQuote",
  "IBKR 结单汇率": "source.ibkrFx",
  "IBKR 每日报表汇率": "source.ibkrDailyFx",
  "IBKR 每日报表反向汇率": "source.ibkrDailyInvFx",
};

// Prices belong to the reporting account. A trade price or an FX execution price is never a closing mark.
export function ibkrReportPrices(db, account, report, trades, checked, write) {
  const quotes = new Map();
  const warnings = new Set();
  const previous = db.prepare("SELECT price FROM sp_broker_prices WHERE account=? AND asset=? AND day=? AND source=?");
  const save = db.prepare("INSERT OR REPLACE INTO sp_broker_prices(account,asset,day,source,price,priority) VALUES(?,?,?,?,?,?)");
  const withdraw = db.prepare("DELETE FROM sp_broker_prices WHERE account=? AND asset=? AND day=? AND source=?");
  function add(id, date, value, source, priority, label, format, currency) {
    if (!id || !date || !(Number(value) > 0 && Number.isFinite(Number(value)))) return;
    const key = JSON.stringify([id, day(date), source]);
    const price = new Decimal(value).toFixed();
    const quote = quotes.get(key);
    if (quote && quote.price !== price) {
      quote.price = null;
      warnings.add(tMain("ibkr.price.mismatch", { date, label }));
    } else if (!quote) quotes.set(key, { id, date, price, source, priority, label, format, currency });
  }
  function fx(ccy, date, value, source, priority) {
    if (/^[A-Z]{3}$/.test(ccy) && ccy !== "AUD")
      add("FX:" + ccy + "/AUD", date, value, source, priority, tMain("ibkr.price.fxLabel", { currency: ccy }), "rate");
  }
  function listing(row, mic) {
    const id = row.assetId || resolveAsset(db, { symbol: row.symbol, exchangeMic: mic }, row.currency, false);
    if (id) return id;
    if (!write && checked.some(c => c.isValid && c.symbol === row.symbol && c.currency === row.currency && (!mic || c.exchangeMic === mic)))
      return JSON.stringify([row.symbol, row.currency, mic]);
    return null;
  }
  for (const row of trades) {
    const e = row.metadata?.ibkrExecution;
    if (!e?.reportDate || e.reportDate !== e.tradeDate) continue;
    if (e.baseCurrency === "AUD")
      fx(e.currency, e.reportDate, e.fxRateToBase, "IBKR 成交报表折算率", 20);
    if (e.closePrice && row.symbol)
      add(listing(row, row.exchangeMic), e.reportDate, e.closePrice, "IBKR 成交报表收盘价", 20, tMain("ibkr.price.closeLabel", { symbol: row.symbol }), "price", row.currency);
  }
  const statement = report.statement;
  for (const row of statement?.positions || []) {
    add(listing(row, row.mic), statement.date, row.price, "IBKR 结单报价", 30, tMain("ibkr.price.posLabel", { symbol: row.symbol }), "price", row.currency);
    if (statement.base === "AUD") fx(row.currency, statement.date, row.fxToBase, "IBKR 结单汇率", 30);
  }
  for (const r of report.audit?.conversionRates || []) {
    if (r.to === "AUD") fx(r.from, r.day, r.rate, "IBKR 每日报表汇率", 35);
    else if (r.from === "AUD") fx(r.to, r.day, new Decimal(1).div(r.rate).toFixed(), "IBKR 每日报表反向汇率", 34);
  }
  const edits = [];
  for (const q of quotes.values()) {
    const args = [account, q.id, q.date, q.source];
    const before = previous.get(...args)?.price ?? null;
    if (q.price === null ? before === null : before !== null && new Decimal(before).eq(q.price)) continue;
    edits.push({ label: tMain("ibkr.price.editLabel", { date: q.date, label: q.label, source: tMain(SOURCE_KEYS[q.source]) }), format: q.format, before, after: q.price, currency: q.currency });
    if (write) {
      if (q.price === null) withdraw.run(...args);
      else save.run(...args, q.price, q.priority);
    }
  }
  return { edits, warnings: [...warnings] };
}
