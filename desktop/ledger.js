import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import {
  openDatabase, checkIntegrity, isPlainDatabase, encryptedCopy, publishFile,
  lockForReplacement, assertNoJournal,
} from "./bookStorage.cjs";
import { day, dayOf } from "./periods.js";
import { tMain } from "./i18n/index.js";

// Existing ledgers and Wealthfolio migrations use these preference scopes.
export const ALLOCATION = "portfolio-xray";
export const BROKER = "broker-sync";
export { day, dayOf } from "./periods.js";
export function money(value, nonnegative = false) {
  if (value === "" || value == null) throw Error(tMain("ledger.missingAmountOrQty"));
  const n = new Decimal(value);
  if (!n.isFinite() || (nonnegative && n.isNegative())) throw Error(tMain("ledger.invalidAmountOrQty"));
  return n.toFixed();
}
export function currency(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw Error(tMain("ledger.invalidCurrency"));
  return code;
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export const json = (text, fallback) => (text == null || text === "" ? fallback : JSON.parse(text));
export const hasTable = (db, name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
const schema = `
CREATE TABLE IF NOT EXISTS sp_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sp_accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL, active INTEGER NOT NULL, mode TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sp_assets(id TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, mic TEXT NOT NULL, kind TEXT NOT NULL, instrument_key TEXT, metadata TEXT);
CREATE INDEX IF NOT EXISTS sp_assets_symbol ON sp_assets(symbol,currency,mic);
CREATE TABLE IF NOT EXISTS sp_events(id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES sp_accounts(id), day TEXT NOT NULL, data TEXT NOT NULL, original TEXT);
CREATE INDEX IF NOT EXISTS sp_events_account ON sp_events(account,day);
CREATE TABLE IF NOT EXISTS sp_anchors(account TEXT NOT NULL, day TEXT NOT NULL, positions TEXT NOT NULL, cash TEXT NOT NULL, PRIMARY KEY(account,day));
CREATE TABLE IF NOT EXISTS sp_holding_evidence(id INTEGER PRIMARY KEY, account TEXT NOT NULL REFERENCES sp_accounts(id), asset TEXT NOT NULL REFERENCES sp_assets(id), day TEXT NOT NULL, quantity TEXT NOT NULL, reported INTEGER NOT NULL, local_cost TEXT, aud_cost TEXT, reference TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sp_evidence_account ON sp_holding_evidence(account,asset,day);
CREATE TABLE IF NOT EXISTS sp_prices(asset TEXT NOT NULL, day TEXT NOT NULL, price TEXT NOT NULL, source TEXT NOT NULL, priority INTEGER NOT NULL, PRIMARY KEY(asset,day,source));
CREATE TABLE IF NOT EXISTS sp_broker_prices(account TEXT NOT NULL REFERENCES sp_accounts(id), asset TEXT NOT NULL, day TEXT NOT NULL, price TEXT NOT NULL, source TEXT NOT NULL, priority INTEGER NOT NULL, PRIMARY KEY(account,asset,day,source));
CREATE INDEX IF NOT EXISTS sp_prices_date ON sp_prices(asset,day);
CREATE TABLE IF NOT EXISTS sp_live_prices(asset TEXT PRIMARY KEY, observed INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sp_live_fx(bucket INTEGER PRIMARY KEY, observed INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sp_archive(account TEXT NOT NULL, day TEXT NOT NULL, total TEXT, cash TEXT, invested TEXT, base TEXT, status TEXT, PRIMARY KEY(account,day));
CREATE TABLE IF NOT EXISTS sp_prefs(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,key));
CREATE TABLE IF NOT EXISTS sp_statements(id TEXT PRIMARY KEY, account TEXT NOT NULL, day TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sp_broker_values(account TEXT NOT NULL REFERENCES sp_accounts(id), day TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account,day));
CREATE TABLE IF NOT EXISTS sp_checks(account TEXT NOT NULL, day TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(account,day));
CREATE TABLE IF NOT EXISTS sp_batches(id TEXT PRIMARY KEY, account TEXT NOT NULL, created TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sp_corrections(id TEXT PRIMARY KEY, event TEXT NOT NULL, created TEXT NOT NULL, reason TEXT NOT NULL, prior TEXT NOT NULL, amended TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sp_benchmark_levels(series TEXT NOT NULL, day TEXT NOT NULL, level REAL NOT NULL CHECK(level > 0), source TEXT NOT NULL, PRIMARY KEY(series,day));
CREATE TABLE IF NOT EXISTS sp_review_notes(id TEXT PRIMARY KEY, created TEXT NOT NULL, data TEXT NOT NULL);
`;
export function createBook(filename, key) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = openDatabase(filename, key);
  try {
    if (hasTable(db, "sp_meta") && db.prepare("SELECT value FROM sp_meta WHERE key='version'").get()?.value !== "1")
      throw Error(tMain("ledger.newerVersionRequired"));
    transaction(db, () => {
      const scopeOldQuotes = hasTable(db, "sp_prices") && !hasTable(db, "sp_broker_prices");
      db.exec(schema);
      if (scopeOldQuotes) migrateIbkrQuotes(db);
      db.prepare("INSERT OR IGNORE INTO sp_meta VALUES('version','1')").run();
    });
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

// 1.4.0 stored statement quotes without an account column. Only attribute them where the old book proves an owner.
function migrateIbkrQuotes(db) {
  const old = db.prepare("SELECT * FROM sp_prices WHERE source IN ('IBKR 结单报价','IBKR 结单汇率')").all();
  if (!old.length) return;
  const accounts = db.prepare(`SELECT id AS account FROM sp_accounts WHERE id IN (
    SELECT account FROM sp_broker_values WHERE source='IBKR Flex'
    UNION SELECT account FROM sp_batches WHERE json_extract(data,'$.broker')='ibkr'
    UNION SELECT account FROM sp_events WHERE json_extract(data,'$.sourceSystem')='IBKR'
      OR json_extract(data,'$.metadata.brokerSync.broker')='ibkr')`).all();
  const insert = db.prepare("INSERT OR IGNORE INTO sp_broker_prices VALUES(?,?,?,?,?,?)");
  if (accounts.length === 1) {
    for (const r of old) insert.run(accounts[0].account,r.asset,r.day,r.price,r.source,r.priority);
    return;
  }
  const statements = db.prepare(`SELECT account, day, data, 'AUD' AS base FROM sp_broker_values WHERE source='IBKR Flex'
    UNION ALL SELECT account, json_extract(data,'$.statement.date'),json_extract(data,'$.statement'),json_extract(data,'$.statement.base')
      FROM sp_batches WHERE account IN (SELECT id FROM sp_accounts) AND json_extract(data,'$.broker')='ibkr' AND json_type(data,'$.statement')='object'`).all();
  for (const s of statements) {
    if (!s.day) continue;
    const statement = json(s.data, {});
    for (const p of statement.positions || []) {
      const asset = listingMatch(db, { account:s.account, symbol:p.symbol, currency:p.currency, mic:p.mic }).match;
      if (asset && Number(p.price) > 0) insert.run(s.account,asset.id,s.day,money(p.price),"IBKR 结单报价",30);
      const fx = p.fxToBase ?? p.fx;
      if (s.base === "AUD" && p.currency && p.currency !== "AUD" && Number(fx) > 0)
        insert.run(s.account,"FX:"+p.currency+"/AUD",s.day,money(fx),"IBKR 结单汇率",30);
    }
  }
}
export function preference(db, scope, key) {
  return db.prepare("SELECT value FROM sp_prefs WHERE scope=? AND key=?").get(scope, key)?.value ?? null;
}
export function putPref(db, scope, key, value) {
  if (value == null) db.prepare("DELETE FROM sp_prefs WHERE scope=? AND key=?").run(scope, key);
  else db.prepare("INSERT OR REPLACE INTO sp_prefs VALUES(?,?,?)").run(scope, key, String(value));
}
export function knownSources(folder) {
  const paths = [path.join(folder, "app.db")],
    profiles = path.join(folder, "profiles");
  if (existsSync(profiles))
    for (const dir of readdirSync(profiles, { withFileTypes: true }))
      if (dir.isDirectory()) paths.push(path.join(profiles, dir.name, "app.db"));
  return paths.filter(existsSync);
}
function rowCount(db, table) {
  return hasTable(db, table) ? db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n : 0;
}
export function inspectSource(file, key = null) {
  const db = openDatabase(file, key, { readonly: true, existing: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF");
    if (!["accounts", "activities", "assets"].every((t) => hasTable(db, t)))
      throw Error(tMain("ledger.selectWealthfolioDb"));
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE lower(name) GLOB 'sp_*' LIMIT 1").get())
      throw Error(tMain("ledger.alreadyStockPortfolioDb"));
    const count = (scope) =>
      hasTable(db, "addon_storage")
        ? db.prepare("SELECT COUNT(*) n FROM addon_storage WHERE addon_id=?").get(scope).n
        : 0;
    const summary = {
      accounts: rowCount(db, "accounts"),
      activities: rowCount(db, "activities"),
      assets: rowCount(db, "assets"),
      snapshots: rowCount(db, "holdings_snapshots"),
      valuations: rowCount(db, "daily_account_valuation"),
      quotes: rowCount(db, "quotes"),
      allocation: count(ALLOCATION),
      broker: count(BROKER),
    };
    summary.invalidFunds = 0;
    if (summary.allocation) {
      const pref = db.prepare("SELECT value FROM addon_storage WHERE addon_id=? AND key=?");
      const index = pref.get(ALLOCATION, "etf.index.v1")?.value;
      if (index) {
        try {
          for (const entry of Object.values(JSON.parse(index))) {
            const key = [...entry.etfKey]
              .map((c) => (/[A-Za-z0-9]/.test(c) ? c : "_x" + c.codePointAt(0).toString(16) + "_"))
              .join("");
            let snapshot = "";
            for (let i = 0; i < entry.chunkCount; i++) {
              const item = pref.get(ALLOCATION, "etf.snapshot.v1." + key + "." + entry.version + "." + i);
              if (!item) {
                snapshot = "";
                break;
              }
              snapshot += item.value;
            }
            try {
              if (!JSON.parse(snapshot).holdings?.length) summary.invalidFunds++;
            } catch {
              summary.invalidFunds++;
            }
          }
        } catch {
          summary.invalidFunds++;
        }
      }
    }
    return summary;
  } finally {
    db.close();
  }
}
export function savePrice(db, asset, date, price, source, priority = 20) {
  const value = money(price, true);
  if (new Decimal(value).lte(0)) throw Error(tMain("ledger.quotePositive"));
  db.prepare("INSERT OR REPLACE INTO sp_prices VALUES(?,?,?,?,?)").run(
    asset,
    day(date),
    value,
    source,
    priority,
  );
}
export function account(db, id) {
  const row = db.prepare("SELECT * FROM sp_accounts WHERE id=?").get(String(id));
  if (!row) throw Error(tMain("ledger.accountNotFound"));
  return row;
}
export function createAccount(db, name, ccy = "AUD") {
  name = String(name).trim();
  if (!name || name.length > 120) throw Error(tMain("ledger.accountNameInvalid"));
  const id = randomUUID();
  db.prepare("INSERT INTO sp_accounts VALUES(?,?,?,?,?)").run(id, name, currency(ccy), 1, "TRANSACTIONS");
  return id;
}
export function listingMatch(db, { account: accountId, source, record, symbol, currency: ccy, mic }) {
  const ticker = String(symbol || "")
    .trim()
    .toUpperCase();
  const code = ccy ? currency(ccy) : "";
  const market = String(mic || "")
    .trim()
    .toUpperCase();
  const candidates = db
    .prepare(
      `SELECT id,symbol,name,currency,mic,kind FROM sp_assets
    WHERE upper(symbol)=? AND (?='' OR currency=?) AND (?='' OR upper(mic)=?) ORDER BY name,mic,currency`,
    )
    .all(ticker, code, code, market, market);
  const key = JSON.stringify([accountId, source, record, ticker, code, market]);
  const prior = candidates.length > 1 && preference(db, "listing-choice", key);
  return {
    key,
    candidates,
    match: candidates.length === 1 ? candidates[0] : candidates.find((r) => r.id === prior),
  };
}
export function rememberListing(db, args) {
  account(db, args.account);
  if (!args.source || !args.record) throw Error(tMain("ledger.selectSourceRecord"));
  const { candidates, key } = listingMatch(db, args);
  if (!candidates.some((r) => r.id === args.assetId)) throw Error(tMain("ledger.listingRecordMismatch"));
  putPref(db, "listing-choice", key, args.assetId);
}
export function resolveAsset(db, asset, ccy, create = true) {
  if (!asset?.symbol) return null;
  const symbol = String(asset.symbol).trim().toUpperCase(),
    code = currency(asset.quoteCcy || ccy),
    mic = String(asset.exchangeMic || "").toUpperCase();
  const found = db.prepare("SELECT * FROM sp_assets WHERE upper(symbol)=? AND currency=?").all(symbol, code);
  if (!mic && found.length > 1) throw Error(tMain("ledger.specifyListing", { symbol }));
  const exact = found.find((a) => a.mic === mic);
  if (exact) return exact.id;
  if (found.length === 1 && (!mic || (!found[0].mic && !asset.requireMarketMatch))) return found[0].id;
  if (!create) return null;
  const id = randomUUID();
  db.prepare("INSERT INTO sp_assets VALUES(?,?,?,?,?,?,?,?)").run(
    id,
    symbol,
    asset.name || symbol,
    code,
    mic,
    asset.instrumentType || "EQUITY",
    mic ? mic + ":" + symbol : null,
    "{}",
  );
  return id;
}
export function importedEvent(r, byAsset) {
  const asset = byAsset.get(r.asset_id);
  return {
    id: r.id,
    accountId: r.account_id,
    activityType: r.activity_type_override || r.activity_type,
    subtype: r.subtype,
    date: r.activity_date,
    assetId: r.asset_id,
    assetSymbol: asset?.symbol || "",
    quantity: r.quantity,
    unitPrice: r.unit_price,
    amount: r.amount,
    fee: r.fee,
    tax: r.tax,
    fxRate: r.fx_rate,
    currency: r.currency,
    comment: r.notes || "",
    metadata: json(r.metadata, {}),
    sourceSystem: r.source_system,
    sourceRecordId: r.source_record_id,
    group: r.source_group_id,
    isUserModified: Boolean(r.is_user_modified),
    needsReview: Boolean(r.needs_review),
    status: r.status || "POSTED",
  };
}
export function saveEvent(db, event, original = null) {
  const data = JSON.stringify(event);
  db.prepare(
    "INSERT INTO sp_events VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account=excluded.account,day=excluded.day,data=excluded.data",
  ).run(event.id, event.accountId, day(event.date), data, original === true ? data : original);
  return event;
}
export function saveBrokerValue(db, accountId, input, write = true) {
  const date = day(input.date),
    source = String(input.source || "").trim();
  if (
    !source ||
    input.base !== "AUD" ||
    !Array.isArray(input.positions) ||
    !Object.keys(input.cash || {}).length
  )
    throw Error(tMain("ledger.brokerValueFields"));
  const cash = Object.fromEntries(Object.entries(input.cash).map(([c, n]) => [currency(c), money(n)]));
  const positions = input.positions.map((p) => {
    const symbol = String(p.symbol || "")
      .trim()
      .toUpperCase();
    if (!symbol) throw Error(tMain("ledger.brokerValueMissingSymbol"));
    return {
      symbol,
      currency: currency(p.currency),
      quantity: money(p.quantity),
      mic: p.mic || null,
      price: p.price == null ? null : money(p.price, true),
      fx: p.fxToBase == null ? null : money(p.fxToBase, true),
    };
  });
  const cashTotal = input.cashTotal == null ? null : money(input.cashTotal),
    securities = input.securities == null ? null : money(input.securities);
  if (input.nav == null && (cashTotal == null || securities == null)) throw Error(tMain("ledger.brokerValueMissingNav"));
  const nav = input.nav == null ? new Decimal(cashTotal).plus(securities).toFixed() : money(input.nav);
  const data = {
    cash,
    positions,
    cashTotal,
    securities,
    nav,
    observedAt: input.observedAt || null,
    unrealized: input.unrealized == null ? null : money(input.unrealized),
    approximatePnl: input.approximatePnl === true,
  };
  const previous = db
    .prepare("SELECT source,data FROM sp_broker_values WHERE account=? AND day=?")
    .get(accountId, date);
  const prior = previous && json(previous.data, {});
  if (data.observedAt && prior?.observedAt > data.observedAt) return null;
  const sameValue = previous?.source === source && isDeepStrictEqual({ ...prior, observedAt: data.observedAt }, data);
  if (sameValue && prior.observedAt === data.observedAt) return null;
  if (write)
    db.prepare("INSERT OR REPLACE INTO sp_broker_values VALUES(?,?,?,?)").run(accountId, date, source, JSON.stringify(data));
  return sameValue ? "time" : "value";
}
function loadLegacy(db, source) {
  function* read(table) {
    if (hasTable(source, table)) yield* source.prepare(`SELECT * FROM "${table}"`).iterate();
  }
  const accounts = db.prepare("INSERT INTO sp_accounts VALUES(?,?,?,?,?)");
  for (const r of read("accounts"))
    accounts.run(
      r.id,
      r.name,
      r.currency,
      Number(Boolean(r.is_active) && !r.is_archived),
      r.tracking_mode || "TRANSACTIONS",
    );
  const assets = db.prepare("INSERT INTO sp_assets VALUES(?,?,?,?,?,?,?,?)"),
    fxAssets = new Map();
  for (const r of read("assets")) {
    const symbol = r.instrument_symbol || r.display_code || r.id,
      mic = r.instrument_exchange_mic || "";
    assets.run(
      r.id,
      symbol,
      r.name || symbol,
      r.quote_ccy || "AUD",
      mic,
      r.instrument_type || r.kind || "UNKNOWN",
      r.instrument_key || null,
      r.metadata || "{}",
    );
    const pair = String(r.instrument_key || r.id).match(/^FX:([A-Z]{3})\/?([A-Z]{3})$/i);
    if (pair) fxAssets.set(r.id, `FX:${pair[1].toUpperCase()}/${pair[2].toUpperCase()}`);
    else if (/FX|FOREX/i.test(r.instrument_type || "") && /^[A-Z]{3}$/.test(symbol))
      fxAssets.set(r.id, `FX:${symbol}/${r.quote_ccy}`);
  }
  const byAsset = new Map(
    db
      .prepare("SELECT id,symbol FROM sp_assets")
      .all()
      .map((a) => [a.id, a]),
  );
  for (const r of read("activities")) saveEvent(db, importedEvent(r, byAsset), true);
  const anchors = db.prepare("INSERT OR REPLACE INTO sp_anchors VALUES(?,?,?,?)");
  for (const r of read("holdings_snapshots")) {
    const positions = {};
    for (const [id, pos] of Object.entries(json(r.positions, {})))
      positions[id] = money(typeof pos === "object" ? pos.quantity : pos);
    anchors.run(r.account_id, day(r.snapshot_date), JSON.stringify(positions), r.cash_balances || "{}");
  }
  const archive = db.prepare("INSERT OR REPLACE INTO sp_archive VALUES(?,?,?,?,?,?,?)");
  for (const r of read("daily_account_valuation"))
    archive.run(
      r.account_id,
      day(r.valuation_date),
      r.total_value_base ?? null,
      r.cash_balance_base ?? null,
      r.investment_market_value_base ?? null,
      r.base_currency || "AUD",
      r.value_status || "",
    );
  const prices = db.prepare("INSERT OR REPLACE INTO sp_prices VALUES(?,?,?,?,?)");
  for (const r of read("quotes")) {
    if (r.close == null || !(Number(r.close) > 0)) continue;
    prices.run(
      fxAssets.get(r.asset_id) || r.asset_id,
      day(r.day || r.timestamp),
      String(r.close),
      r.source || "Wealthfolio",
      10,
    );
  }
  for (const r of read("addon_storage"))
    if ([ALLOCATION, BROKER].includes(r.addon_id)) putPref(db, r.addon_id, r.key, r.value);
  for (const r of read("app_settings"))
    if (["base_currency", "language", "timezone"].includes(r.setting_key))
      putPref(db, "legacy", r.setting_key, r.setting_value);
}
export function backupMode(db) {
  // Additive tables are created when an older backup is opened.
  const addedTables = new Set(["sp_broker_values", "sp_broker_prices", "sp_benchmark_levels", "sp_review_notes", "sp_holding_evidence"]);
  const requiredTables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)]
    .map((match) => match[1]).filter((name) => !addedTables.has(name));
  if (!requiredTables.every((t) => hasTable(db, t)) ||
      db.prepare("SELECT value FROM sp_meta WHERE key='version'").get()?.value !== "1")
    throw Error(tMain("ledger.unsupportedBackup"));
  if (db.prepare(`SELECT 1 FROM sqlite_schema WHERE
      (type IN ('trigger','view') AND (lower(name) GLOB 'sp_*' OR lower(tbl_name) GLOB 'sp_*'))
      OR (lower(name) GLOB 'sp_*' AND upper(sql) LIKE 'CREATE VIRTUAL TABLE%') LIMIT 1`).get())
    throw Error(tMain("ledger.unsupportedObjects"));
  return preference(db, "app", "demo") === "1" ? "demo" : "real";
}

export function protectOldBook(file, key) {
  if (!isPlainDatabase(file)) return;
  let src = openDatabase(file, null, { existing: true });
  try {
    backupMode(src);
    lockForReplacement(src);
    checkIntegrity(src);
    publishFile(file, (stage) => {
      encryptedCopy(src, stage, key);
      src.close();
      src = null;
      assertNoJournal(file);
    });
  } finally {
    src?.close();
  }
}
export function migrate(source, destination, key) {
  inspectSource(source);
  if (existsSync(destination)) throw Error(tMain("ledger.realExistsNoOverwrite"));
  mkdirSync(path.dirname(destination), { recursive: true });
  return publishFile(destination, (stage) => {
    const legacy = openDatabase(source, null, { readonly: true, existing: true });
    try {
      encryptedCopy(legacy, stage, key);
    } finally {
      legacy.close();
    }
    const summary = inspectSource(stage, key);
    const reader = openDatabase(stage, key, { readonly: true, existing: true });
    let db;
    try {
      db = createBook(stage, key);
      transaction(db, () => {
        loadLegacy(db, reader);
        for (const [table, name] of [
          ["sp_accounts", "accounts"], ["sp_events", "activities"], ["sp_assets", "assets"],
        ])
          if (rowCount(db, table) !== summary[name]) throw Error(tMain("ledger.migrationCountMismatch"));
        putPref(db, "app", "migration", JSON.stringify({ ...summary, at: new Date().toISOString() }));
      });
      checkIntegrity(db);
    } finally {
      reader.close();
      db?.close();
    }
    return summary;
  });
}
