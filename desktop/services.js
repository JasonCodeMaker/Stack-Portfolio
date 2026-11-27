import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { parseCsvRows } from "./allocation/domain/etf";
import { runSync, sourceKey, importedKeysStorageKey, resetImportedKeysForMappings } from "./brokers/syncEngine";
import { IbkrFlexAttemptsError, parseIbkrFlexReport, fetchIbkrFlexReport } from "./brokers/ibkrFlex";
import { WEBULL_FUNDS_ID_PREFIX } from "./brokers/webullFunds";
import {
  fetchWebullReport,
  fetchWebullAccountValue,
  checkWebullToken,
  createWebullToken,
  listWebullAccounts,
} from "./brokers/webullOpenApi";
import {
  ALLOCATION,
  BROKER,
  account,
  currency,
  day,
  dayOf,
  json,
  listingMatch,
  money,
  preference,
  putPref,
  resolveAsset,
  saveEvent,
  transaction,
} from "./ledger.js";
import { loadBook, live, positions, accountSnapshot, storageContext } from "./flows.js";
import { attributedAsset } from "./gainBreakdown.js";
import { recordIdentity, ibkrHistoryPlan, applyIbkrHistoryPlan, enrichIbkrExecutions, mergeIbkrExecution } from "./ibkrHistory.js";
import { ibkrReportPrices } from "./ibkrPrices.js";
import { tMain } from "./i18n/index.js";
import { saveBrokerValue } from "./ledger.js";
import { activityEdits, valuationEdits } from "./importChanges.js";
import { EtfCache } from "./allocation/storage/etfCache";
import { loadAllocationSettings } from "./allocation/storage/settings";
import { createProviders, resolveEtfHoldings } from "./allocation/services/etf/providers";

const D = (x) => new Decimal(x ?? 0);
const networkHosts = new Set([
  "api.webull.com.au",
  "www.interactivebrokers.com.au",
  "query1.finance.yahoo.com",
  "fred.stlouisfed.org",
  "www.ishares.com",
  "dng-api.invesco.com",
  "www.betashares.com.au",
]);
export const network = {
  // The desktop shell supplies Chromium's network stack. It follows the system proxy and
  // reaches public data hosts on which Node's own fetch stalls inside Electron.
  browserFetch: null,
  async request(request) {
    const url = new URL(request.url);
    if (
      url.protocol !== "https:" ||
      !networkHosts.has(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      throw Error(tMain("svc.unsupportedHost"));
    const method = request.method || "GET";
    let res = null;
    // Only anonymous public downloads take this path; signed broker calls keep their exact headers.
    if (network.browserFetch && method === "GET" && !request.headers && request.body == null) {
      try {
        res = await network.browserFetch(url.toString(), {
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        res = null;
      }
    }
    res ??= await fetch(url, {
      method,
      headers: request.headers,
      body: request.body ?? undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const chunks = [];
    let n = 0;
    for await (const c of res.body || []) {
      n += c.length;
      if (n > 32 * 1024 * 1024) throw Error(tMain("svc.responseTooLarge"));
      chunks.push(c);
    }
    return {
      status: res.status,
      body: Buffer.concat(chunks).toString("utf8"),
      headers: Object.fromEntries(res.headers),
    };
  },
};
const cleanHeader = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
function exportedDate(raw) {
  const s = String(raw).trim(),
    iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return day([iso[1], iso[2].padStart(2, "0"), iso[3].padStart(2, "0")].join("-"));
  const au = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (au) return day([au[3], au[2].padStart(2, "0"), au[1].padStart(2, "0")].join("-"));
  throw Error(tMain("svc.tradeDateFormat"));
}
function cellNumber(value) {
  return money(
    String(value)
      .replace(/(?:US|AU)?\$|,/gi, "")
      .trim(),
    true,
  );
}
export function parseWebullCsv(text) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, "")),
    header = rows.shift()?.map(cleanHeader) || [];
  const activities = [],
    unknown = [],
    dates = [];
  function column(...names) {
    return (
      names
        .map(cleanHeader)
        .map((n) => header.indexOf(n))
        .find((i) => i >= 0) ?? -1
    );
  }
  const cols = {
    id: column("Trade ID", "Execution ID", "Order ID", "Order No", "Order Number"),
    symbol: column("Symbol", "Ticker", "Stock Code"),
    side: column("Side", "Action", "Direction"),
    qty: column("Filled Quantity", "Filled Qty", "Filled", "Executed Quantity", "Quantity"),
    price: column(
      "Average Price",
      "Avg Price",
      "Avg Filled Price",
      "Filled Price",
      "Execution Price",
      "Price",
    ),
    date: column("Filled Time", "Filled Date", "Trade Date", "Execution Time", "Executed Time", "Date"),
    ccy: column("Currency", "Currency Code"),
    market: column("Exchange", "Market"),
    fee: column("Commission", "Total Fees", "Fees"),
    name: column("Name", "Security Name"),
    status: column("Status", "Order Status"),
  };
  if ([cols.symbol, cols.side, cols.qty, cols.price, cols.date].some((i) => i < 0))
    throw Error(tMain("svc.csvMissingColumns"));
  rows.forEach((row, i) => {
    const value = (k) => (row[cols[k]] || "").trim();
    if (!row.some(Boolean)) return;
    try {
      const date = exportedDate(value("date"));
      dates.push(date);
      if (
        value("status") &&
        !/^(filled|fully filled|executed|completed|已成交|全部成交)$/i.test(value("status"))
      )
        throw Error(tMain("svc.orderNotFilled"));
      const side = value("side").toUpperCase(),
        symbol = value("symbol").toUpperCase(),
        market = value("market").toUpperCase();
      const ccy =
        value("ccy") ||
        (/ASX|AUSTRALIA|^AU$/.test(market) ? "AUD" : /NYSE|NASDAQ|^US$/.test(market) ? "USD" : "");
      if (!value("id")) throw Error(tMain("svc.missingBrokerId"));
      const type = /^(B|BUY|买入)$/.test(side) ? "BUY" : /^(S|SELL|卖出)$/.test(side) ? "SELL" : null;
      if (!type || !symbol) throw Error(tMain("svc.unknownSideOrSymbol"));
      const qty = cellNumber(value("qty")),
        price = cellNumber(value("price"));
      if (D(qty).lte(0) || D(price).lte(0)) throw Error(tMain("svc.qtyPricePositive"));
      activities.push({
        broker: "webull",
        brokerRecordId: value("id"),
        activityType: type,
        symbol,
        symbolName: value("name") || symbol,
        date,
        currency: currency(ccy),
        quantity: Number(qty),
        unitPrice: Number(price),
        fee: value("fee") ? Number(cellNumber(value("fee"))) : 0,
        exchangeMic:
          { NASDAQ: "XNAS", NYSE: "XNYS", ASX: "XASX", AU: "XASX" }[market] ||
          (/^X[A-Z]{3}$/.test(market) ? market : undefined),
      });
    } catch (e) {
      unknown.push({ line: i + 2, date: value("date"), symbol: value("symbol"), reason: e.message });
    }
  });
  return {
    activities,
    unknown,
    lastDate: dates.sort().at(-1),
    audit: { warnings: [tMain("svc.csvCashWarning")] },
  };
}
export function detailedIbkr(text) {
  return withIbkrStatement(parseIbkrFlexReport(text));
}
function withIbkrStatement(report) {
  const audit = report.audit,
    date = audit.period?.to;
  const valuation =
    date &&
    audit.baseCurrency === "AUD" &&
    audit.reportedNavBase != null &&
    Object.keys(audit.endingCashByCurrency || {}).length &&
    Array.isArray(audit.statementPositions)
      ? {
          date,
          source: "IBKR Flex",
          base: "AUD",
          cash: audit.endingCashByCurrency,
          positions: audit.statementPositions,
          nav: audit.reportedNavBase,
        }
      : null;
  return {
    ...report,
    valuation,
    unknown: [],
    statement: date
      ? {
          date,
          cash: audit.endingCashByCurrency,
          positions: audit.statementPositions,
          nav: audit.reportedNavBase,
          base: audit.baseCurrency,
        }
      : null,
  };
}
export function validActivity(row) {
  const errors = {};
  try {
    day(row.date);
    currency(row.currency);
    if (
      ["BUY", "SELL"].includes(row.activityType) &&
      (!row.symbol || D(row.quantity).lte(0) || D(row.unitPrice).lte(0))
    )
      throw Error(tMain("svc.checkSymbolQtyPrice"));
    if (!["BUY", "SELL"].includes(row.activityType) && row.amount == null && !row.quantity)
      throw Error(tMain("svc.missingAmountOrTransferQty"));
    for (const k of ["quantity", "unitPrice", "fee", "tax", "amount"])
      if (row[k] != null) money(row[k], true);
  } catch (e) {
    errors.validation = [e.message];
  }
  return { ...row, isValid: !Object.keys(errors).length, errors };
}
function nativeEvent(db, v, id) {
  const saved = v.asset && listingMatch(db, { account:v.accountId, source:v.sourceSystem?.toLowerCase(), record:v.sourceRecordId,
    symbol:v.asset.symbol, currency:v.asset.quoteCcy || v.currency, mic:v.asset.exchangeMic }).match;
  const assetId = saved?.id || resolveAsset(db, v.asset, v.currency);
  const n = (k) => (v[k] == null ? null : money(v[k]));
  return {
    id,
    accountId: v.accountId,
    assetId,
    assetSymbol: v.asset?.symbol || "",
    activityType: v.activityType,
    subtype: v.subtype ?? null,
    date: v.activityDate,
    quantity: n("quantity"),
    unitPrice: n("unitPrice"),
    amount: n("amount"),
    fee: n("fee"),
    tax: n("tax"),
    fxRate: n("fxRate"),
    currency: v.currency,
    comment: v.comment || "",
    sourceSystem: v.sourceSystem,
    sourceRecordId: v.sourceRecordId,
    group: v.sourceGroupId,
    metadata: v.metadata || {},
    status: "POSTED",
  };
}
// A verified Flex date repair moves the original posting with its quantities, fees and edits intact.
export function correctIbkrTradeDate(db, id, date, reportedDateTime) {
  const apply = () => {
    const prior = db.prepare("SELECT data FROM sp_events WHERE id=?").get(id)?.data;
    if (!prior) throw Error(tMain("svc.ibkrMissingActivity"));
    const before = JSON.parse(prior);
    const oldDay = day(before.date), tradeDay = day(date);
    if (oldDay === tradeDay) return before;
    if (oldDay !== day(reportedDateTime)) throw Error(tMain("svc.ibkrDateMismatch"));
    const after = { ...before, date, metadata: { ...before.metadata, ibkrReportedDateTime: reportedDateTime } };
    saveEvent(db, after);
    db.prepare("INSERT INTO sp_corrections VALUES(?,?,?,?,?,?)").run(
      randomUUID(), id, new Date().toISOString(), tMain("svc.ibkrDateVerifyReason"), prior, JSON.stringify(after),
    );
    const [from, to] = [oldDay, tradeDay].sort();
    db.prepare(`INSERT OR IGNORE INTO sp_checks(account,day,reason)
      SELECT account,day,? FROM sp_statements
      WHERE account=? AND day>=? AND day<?`).run(tMain("svc.ibkrDateCorrected"), after.accountId, from, to);
    return after;
  };
  return db.inTransaction ? apply() : transaction(db, apply);
}
export function syncHost(db, history) {
  const key = importedKeysStorageKey();
  return {
    checkImport: async (rows) => rows.map(validActivity),
    getActivities: async (id) =>
      db
        .prepare("SELECT data FROM sp_events WHERE account=?")
        .all(id)
        .map((r) => json(r.data, {}))
        .filter((e) => !e.metadata?.deletedByUser && !e.metadata?.supersededBy && !history?.superseded.has(e.id))
        .map((e) =>
          history?.aliases.has(e.id)
            ? {
                ...e,
                isUserModified: true,
                metadata: {
                  ...e.metadata,
                  brokerSync: { broker: "ibkr", recordId: history.aliases.get(e.id) },
                },
              }
            : e,
        ),
    loadImportedKeys: async () => new Set(json(preference(db, BROKER, key), [])),
    saveImportedKeys: async (keys) => putPref(db, BROKER, key, JSON.stringify([...keys].sort())),
    updatePortfolio: async () => {},
    saveActivities: async (creates, updates = []) => {
      const created = [],
        updated = [],
        createdMappings = [];
      for (const v of creates) {
        const id = randomUUID(),
          e = nativeEvent(db, v, id);
        saveEvent(db, e);
        created.push(e);
        createdMappings.push({ tempId: v.id, activityId: id });
      }
      for (const v of updates) {
        if (v.metadata?.ibkrReportedDateTime) {
          updated.push(correctIbkrTradeDate(db, v.id, v.activityDate, v.metadata.ibkrReportedDateTime));
        } else {
          const event = nativeEvent(db, v, v.id);
          if (v.sourceSystem === "IBKR") {
            const prior = db.prepare("SELECT data FROM sp_events WHERE id=?").get(v.id);
            const receipt = prior && JSON.parse(prior.data).metadata?.ibkrExecution;
            if (receipt) event.metadata.ibkrExecution = mergeIbkrExecution(receipt, event.metadata.ibkrExecution);
          }
          updated.push(saveEvent(db, event));
        }
      }
      return { created, updated, createdMappings, deleted: [], errors: [] };
    },
  };
}
export function securityHistory(db, { accountIds, assetIds, through, limit }) {
  const date = day(through);
  if (!Array.isArray(accountIds) || !accountIds.length || !Array.isArray(assetIds) || !assetIds.length) return [];
  const assets = new Map(db.prepare("SELECT id,symbol,currency FROM sp_assets").all().map((a) => [a.id, a]));
  const wanted = new Set(assetIds);
  const candidates = db.prepare(`
    SELECT data FROM sp_events
    WHERE account IN (SELECT value FROM json_each(?)) AND day <= ?
      AND (json_extract(data,'$.assetId') IN (SELECT value FROM json_each(?))
        OR (json_extract(data,'$.activityType') = 'TAX' AND coalesce(json_extract(data,'$.assetId'),'') = ''))
    ORDER BY day DESC, json_extract(data,'$.date') DESC, id
  `).iterate(JSON.stringify(accountIds), date, JSON.stringify(assetIds));
  const events = [];
  for (const { data } of candidates) {
    const event = json(data, {});
    if (!live(event) || event.metadata?.supersededBy || !wanted.has(attributedAsset({ assets }, event))) continue;
    events.push(event);
    if (events.length === limit) break;
  }
  return events;
}

export function deleteActivity(db, args) {
  return transaction(db, () => {
    const row = db.prepare("SELECT data FROM sp_events WHERE id=? AND account=?").get(args.id, args.account);
    if (!row) throw Error(tMain("svc.amendNotFound"));
    if (args.prior !== row.data) throw Error(tMain("svc.amendChangedReload"));
    const current = json(row.data, {});
    if (!live(current) || current.metadata?.supersededBy) throw Error(tMain("svc.activityAlreadyInactive"));

    const related = current.group && current.activityType.startsWith("TRANSFER_");
    if (related && args.deleteGroup !== true) throw Error(tMain("svc.activityGroupConfirmation"));
    const rows = related
      ? db.prepare(`SELECT data FROM sp_events
        WHERE json_extract(data,'$.group')=? AND json_extract(data,'$.activityType') IN ('TRANSFER_IN','TRANSFER_OUT')`)
        .all(current.group)
      : [row];
    const correction = db.prepare("INSERT INTO sp_corrections VALUES(?,?,?,?,?,?)");
    const check = db.prepare("INSERT OR REPLACE INTO sp_checks VALUES(?,?,?)");
    const created = new Date().toISOString();
    for (const { data } of rows) {
      const before = json(data, {});
      if (!live(before) || before.metadata?.supersededBy) continue;
      const after = { ...before, status: "VOID", metadata: { ...before.metadata, deletedByUser: true } };
      saveEvent(db, after);
      correction.run(randomUUID(), after.id, created, tMain("svc.activityDeleted"), data, JSON.stringify(after));
      check.run(after.accountId, dayOf(after.date), tMain("svc.amendCheckNeeded"));
    }
    return current.id;
  });
}

export function amendEvent(db, args) {
  const row = db.prepare("SELECT data FROM sp_events WHERE id=? AND account=?").get(args.id, args.account);
  if (!row) throw Error(tMain("svc.amendNotFound"));
  const before = json(row.data, {}),
    reason = String(args.reason || "").trim();
  if (!reason) throw Error(tMain("svc.amendNeedReason"));
  if (args.prior !== row.data) throw Error(tMain("svc.amendChangedReload"));
  if (before.metadata?.deletedByUser) throw Error(tMain("svc.activityAlreadyInactive"));
  if (
    ![
      "BUY",
      "SELL",
      "DEPOSIT",
      "WITHDRAWAL",
      "DIVIDEND",
      "INTEREST",
      "FEE",
      "TAX",
      "TRANSFER_IN",
      "TRANSFER_OUT",
    ].includes(before.activityType)
  )
    throw Error(tMain("svc.amendUnsupportedType"));
  const after = {
    ...before,
    date: day(args.date) === dayOf(before.date) ? before.date : day(args.date),
    comment: String(args.note || ""),
    isUserModified: true,
    needsReview: false,
  };
  if (["BUY", "SELL"].includes(before.activityType)) {
    after.quantity = money(args.quantity, true);
    after.unitPrice = money(args.price, true);
    after.fee = money(args.fee || 0, true);
    if (D(after.quantity).lte(0) || D(after.unitPrice).lte(0)) throw Error(tMain("svc.amendQtyPricePositive"));
  } else if (before.assetId && D(before.quantity).gt(0)) after.quantity = money(args.quantity, true);
  else {
    after.amount = money(args.amount, true);
    if (D(after.amount).lte(0)) throw Error(tMain("svc.amendAmountPositive"));
  }
  return transaction(db, () => {
    saveEvent(db, after);
    db.prepare("INSERT INTO sp_corrections VALUES(?,?,?,?,?,?)").run(
      randomUUID(),
      after.id,
      new Date().toISOString(),
      reason,
      row.data,
      JSON.stringify(after),
    );
    db.prepare("INSERT OR REPLACE INTO sp_checks VALUES(?,?,?)").run(
      after.accountId,
      [dayOf(after.date), dayOf(before.date)].sort()[0],
      tMain("svc.amendCheckNeeded"),
    );
    return after.id;
  });
}
function activityDetail(r) {
  return {
    date: r.date, type: r.activityType, symbol: r.symbol || r.assetSymbol, quantity: r.quantity,
    currency: r.currency, amount: r.amount, unitPrice: r.unitPrice, fee: r.fee, tax: r.tax,
    exchange: Boolean(r.metadata?.fx),
  };
}

function depositKey(record) {
  return JSON.stringify([dayOf(record.date), record.currency, D(record.amount).toString()]);
}

function splitConflicts(db, acc, report, history) {
  const exists = new Map(), storedById = new Map(), priorDeposits = new Map();
  for (const { data } of db.prepare("SELECT data FROM sp_events WHERE account=?").all(acc)) {
    const e = json(data, {});
    storedById.set(e.id, e);
    const id = recordIdentity(e);
    if (id && !e.metadata?.supersededBy && !history?.superseded.has(e.id)) exists.set(id, e);
    if (report.webullFundsStatus === "loaded" && live(e) && !e.metadata?.supersededBy &&
        e.activityType === "DEPOSIT" && !e.sourceRecordId?.startsWith(WEBULL_FUNDS_ID_PREFIX)) {
      const key = depositKey(e);
      priorDeposits.set(key, (priorDeposits.get(key) || 0) + 1);
    }
  }
  const active = [],
    problems = [...(report.unknown || [])],
    counts = new Map();
  for (const r of report.activities) {
    const id = r.broker + ":" + r.brokerRecordId;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const opening = preference(db, "opening-date", acc);
  const recorded = new Set(json(preference(db, BROKER, importedKeysStorageKey()), []));
  for (const r of report.activities) {
    const id = r.broker + ":" + r.brokerRecordId,
      prior = exists.get(id);
    if (prior?.metadata?.deletedByUser) continue;
    if (history?.blocked.has(id)) {
      problems.push({ ...activityDetail(r), reason: history.blocked.get(id) });
      continue;
    }
    if (!r.brokerRecordId || /^fallback-[a-f0-9]+(?:$|:)/i.test(r.brokerRecordId)) {
      problems.push({ ...activityDetail(r), reason: tMain("svc.missingReliableId") });
      continue;
    }
    if (opening && dayOf(r.date) <= opening) {
      problems.push({ ...activityDetail(r), reason: tMain("svc.withinOpeningBalance") });
      continue;
    }
    if (counts.get(id) > 1) {
      problems.push({ ...activityDetail(r), reason: tMain("svc.duplicateIdInFile") });
      continue;
    }
    if (!prior && r.broker === "webull" && r.brokerRecordId.startsWith(WEBULL_FUNDS_ID_PREFIX)) {
      const key = depositKey(r);
      const unmatched = priorDeposits.get(key) || 0;
      if (unmatched > 0) {
        priorDeposits.set(key, unmatched - 1);
        problems.push({ ...activityDetail(r), reason: tMain("svc.webullFundsSameDeposit") });
        continue;
      }
    }
    const native = prior?.sourceSystem === r.broker.toUpperCase() && prior.metadata?.brokerSync?.recordId === r.brokerRecordId;
    const changed =
      prior &&
      (!r.importRevision || (native && recorded.has(sourceKey(r, acc)))) &&
      !prior.isUserModified &&
      (prior.activityType !== r.activityType ||
        prior.currency !== r.currency ||
        (native && (dayOf(prior.date) !== dayOf(r.date) ||
          (prior.assetSymbol || "").toUpperCase() !== (r.symbol || "").toUpperCase())) ||
        (["BUY", "SELL"].includes(r.activityType)
          ? ["quantity", "unitPrice", "fee", "tax"]
          : ["quantity", "amount", "fee", "tax"]
        ).some((k) => !D(prior[k]).eq(D(r[k]))));
    if (changed) {
      const detail = activityDetail(r);
      problems.push({ ...detail, edits: activityEdits(activityDetail(prior), detail), reason: tMain("svc.diffFromLedger") });
      continue;
    }
    active.push(r);
  }
  return { active, problems, storedById };
}

function checkReason(errors) {
  if (!errors?.migration) return Object.values(errors || {}).flat().join(" ");
  const reason = errors.migration.join(" ");
  if (reason.includes("trade date correction")) return tMain("svc.mig.dateVerifyFailed");
  if (reason.includes("edited by the user")) return tMain("svc.mig.userEdited");
  if (reason.includes("no longer exists")) return tMain("svc.mig.missingLinked");
  if (reason.includes("different broker record")) return tMain("svc.mig.linkedOther");
  return tMain("svc.mig.multipleMatches");
}

function importRows(active, problems, result, accountId, storedById) {
  const byLine = new Map(result.checked.map((row) => [row.lineNumber, row]));
  const byKey = new Map(result.candidates.map((c) => [c.sourceKey, c]));
  const rows = [];
  for (const r of active) {
    const candidate = byKey.get(sourceKey(r, accountId));
    if (!candidate) continue;
    const checked = byLine.get(candidate.activity.lineNumber);
    const detail = activityDetail(r);
    let status = "new";
    let edits;
    if (!checked.isValid) status = "review";
    else if (checked.duplicateOfId) {
      const prior = storedById.get(checked.duplicateOfId);
      edits = !candidate.preserveExisting && prior ? activityEdits(activityDetail(prior), detail) : [];
      status = edits.length ? "update" : "link";
    }
    rows.push({ ...detail, status, edits, reason: checkReason(checked.errors) });
  }
  return rows.concat(problems.map((row) => ({ ...row, status: "review" })));
}

function lastBrokerValue(db, accountId, through) {
  const row = db.prepare(
    "SELECT day,source,data FROM sp_broker_values WHERE account=? AND (? IS NULL OR day<=?) ORDER BY day DESC LIMIT 1",
  ).get(accountId, through || null, through || null);
  if (!row) return null;
  return { ...json(row.data, {}), date: row.day, source: row.source, base: "AUD" };
}
export async function batch(db, accountId, broker, report, source, commit = false) {
  account(db, accountId);
  const ownTransaction = commit === true;
  if (ownTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    const choices = [];
    const match = (r, record, mic, ccy) => {
      if (!r.symbol || !record || /^fallback-[a-f0-9]+(?:$|:)/i.test(record)) return r;
      const input = { account: accountId, source: broker, record, symbol: r.symbol, currency: ccy, mic };
      const lookup = listingMatch(db, input);
      if (lookup.candidates.length < 2) return r;
      if (lookup.match)
        return {
          ...r,
          assetId: lookup.match.id,
          mic: lookup.match.mic,
          exchangeMic: lookup.match.mic,
          currency: r.currency || lookup.match.currency,
        };
      choices.push({ ...input, candidates: lookup.candidates });
      return null;
    };
    const matchedStatements = new Map();
    const matchStatement = (s) => {
      if (!s?.positions) return s;
      if (!matchedStatements.has(s))
        matchedStatements.set(s, {
          ...s,
          positions: s.positions
            .map((r, i) =>
              match(r, JSON.stringify(["statement", s.date, i, r.symbol, r.quantity]), r.mic, r.currency),
            )
            .filter(Boolean),
        });
      return matchedStatements.get(s);
    };
    report = {
      ...report,
      activities: report.activities
        .map((r) => match(r, r.brokerRecordId, r.exchangeMic, r.quoteCcy || r.currency))
        .filter(Boolean),
      statement: matchStatement(report.statement),
      valuation: matchStatement(report.valuation),
    };
    if (commit && choices.length) throw Error(tMain("svc.confirmListingFirst"));
    const history = broker === "ibkr" ? ibkrHistoryPlan(db, accountId, report.activities) : null;
    const { active, problems, storedById } = splitConflicts(db, accountId, report, history);
    const repaired = history?.superseded.size || 0;
    if (commit && repaired) applyIbkrHistoryPlan(db, history);
    const result = await runSync(
      { fetch: async () => active },
      syncHost(db, history),
      { ibkr: "", webull: "", [broker]: accountId },
      !commit,
    );
    const rows = importRows(active, problems, result, accountId, storedById);
    const invalidLines = new Set(result.checked.filter(r => !r.isValid).map(r => r.lineNumber));
    const rejected = new Set(result.candidates.filter(c => invalidLines.has(c.activity.lineNumber)).map(c => c.sourceKey));
    const accepted = active.filter(r => !rejected.has(sourceKey(r, accountId)));
    const evidence = history ? enrichIbkrExecutions(db, accountId, accepted, storedById, history, Boolean(commit)) : [];
    for (const { record, previous, next } of evidence) {
      const edits = [];
      if (next.fxRateToBase && previous?.fxRateToBase !== next.fxRateToBase)
        edits.push({
          label: tMain("svc.editFxRate", { from: next.currency, to: next.baseCurrency }),
          before: previous?.fxRateToBase,
          after: next.fxRateToBase,
          format: "rate",
        });
      rows.push({
        ...activityDetail(record),
        status: "evidence",
        edits,
        reason: next.pair ? tMain("svc.evidenceFxEvidence") : tMain("svc.evidenceBrokerFill"),
      });
    }
    for (const { event, reason } of history?.superseded.values() || [])
      rows.push({ ...activityDetail(event), status: "void", reason });
    const previousValue = lastBrokerValue(db, accountId, report.valuation?.date);
    const valueChange = report.valuation
      ? saveBrokerValue(db, accountId, report.valuation, Boolean(commit))
      : null;
    const amountEdits = valueChange === "value" ? valuationEdits(previousValue, report.valuation) : [];
    const prices = history ? ibkrReportPrices(db, accountId, report, accepted, result.checked, Boolean(commit)) : { edits: [], warnings: [] };
    const priceEdits = prices.edits;
    const summary = {
      source,
      broker,
      account: accountId,
      imported: result.imported,
      updated: result.updated,
      repaired,
      enriched: evidence.length,
      added: result.valid,
      duplicate: result.alreadyImported + result.duplicates,
      unknown: problems,
      invalid: result.invalid,
      audit: { ...report.audit, warnings: [...(report.audit?.warnings || []), ...prices.warnings] },
      priceWarnings: prices.warnings,
      webullFundsStatus: report.webullFundsStatus,
      statement: report.statement || report.valuation,
      previousValue,
      valueChange,
      prices: priceEdits.length,
      amountEdits,
      priceEdits,
      rows,
      choices: [
        ...new Map(choices.map((c) => [JSON.stringify([c.record, c.symbol, c.currency]), c])).values(),
      ],
    };
    if (commit) {
      if (result.imported || result.updated || repaired || evidence.length || priceEdits.length || problems.length || result.invalid) {
        const { previousValue: _previous, ...batchRecord } = summary;
        db.prepare("INSERT INTO sp_batches VALUES(?,?,?,?,?)").run(
          randomUUID(),
          accountId,
          new Date().toISOString(),
          source,
          JSON.stringify(batchRecord),
        );
        const latest = [
          ...report.activities.map((a) => dayOf(a.date)),
          report.lastDate,
          report.statement?.date,
        ]
          .filter(Boolean)
          .sort()
          .at(-1);
        const noStartingBalance = !db
          .prepare("SELECT 1 FROM sp_anchors WHERE account=? LIMIT 1")
          .get(accountId);
        if (
          latest &&
          (problems.length ||
            result.invalid ||
            (noStartingBalance && (result.imported || result.updated || repaired)) ||
            (broker === "webull" && (source.toLowerCase().includes("csv") || report.audit?.warnings?.length)))
        ) {
          db.prepare("INSERT OR REPLACE INTO sp_checks VALUES(?,?,?)").run(
            accountId,
            latest,
            problems.length || result.invalid
              ? tMain("svc.check.importNeedsReview")
              : tMain("svc.check.tradesImported"),
          );
        }
      }
      if (ownTransaction) db.exec("COMMIT");
    }
    return summary;
  } catch (e) {
    if (ownTransaction) db.exec("ROLLBACK");
    throw e;
  }
}
export async function combinedBatch(db, parts, commit = false) {
  if (commit) db.exec("BEGIN IMMEDIATE");
  try {
    const reports = [];
    for (const p of parts)
      reports.push(await batch(db, p.account, p.broker, p.report, p.source, commit ? "nested" : false));
    const sum = (k) => reports.reduce((n, r) => n + r[k], 0);
    const summary = {
      source: "IBKR + Webull AU",
      broker: "both",
      reports,
      imported: sum("imported"),
      updated: sum("updated"),
      repaired: sum("repaired"),
      added: sum("added"),
      duplicate: sum("duplicate"),
      invalid: sum("invalid"),
      unknown: reports.flatMap((r) => r.unknown),
      audit: { warnings: reports.flatMap((r) => r.audit?.warnings || []) },
    };
    if (commit) db.exec("COMMIT");
    return summary;
  } catch (e) {
    if (commit) db.exec("ROLLBACK");
    throw e;
  }
}
function manualAsset(db, args) {
  if (!String(args.symbol || "").trim()) throw Error(tMain("svc.manual.needSymbol"));
  const { match, candidates } = listingMatch(db, {
    ...args,
    source: "manual",
    record: args.reference,
    currency: args.currency,
    mic: args.mic,
  });
  if (args.assetId && args.assetId !== "new") {
    if (!candidates.some((c) => c.id === args.assetId)) throw Error(tMain("svc.manual.listingMismatch"));
    return args.assetId;
  }
  if (match) return match.id;
  if (candidates.length > 1) throw Error(tMain("svc.manual.chooseMarket"));
  return resolveAsset(
    db,
    {
      symbol: args.symbol,
      exchangeMic: args.mic,
      name: args.name,
      instrumentType: args.kind || "EQUITY",
      requireMarketMatch: args.assetId === "new",
    },
    args.currency,
  );
}
export function recordHolding(db, args) {
  const a = account(db, args.account),
    date = day(args.date);
  const reference = String(args.reference || "").trim();
  if (!reference) throw Error(tMain("svc.manual.needCostRef"));
  return transaction(db, () => {
    const asset = args.symbol ? manualAsset(db, args) : args.assetId;
    const profile = db.prepare("SELECT currency FROM sp_assets WHERE id=?").get(asset);
    if (!profile) throw Error(tMain("err.assetNotFound"));
    const quantity = money(args.quantity, true);
    const old = db
      .prepare(
        "SELECT * FROM sp_holding_evidence WHERE account=? AND asset=? AND day=? ORDER BY id DESC LIMIT 1",
      )
      .get(a.id, asset, date);
    const sameQuantity = old && D(old.quantity).eq(quantity);
    if (args.costOnly) {
      const held = positions(loadBook(db), a, date).holdings.get(asset);
      if (!held?.eq(quantity)) throw Error(tMain("svc.manual.qtyChanged"));
    }
    const optional = (value) => (value == null || value === "" ? null : money(value, true));
    const local = optional(args.localCost),
      aud = optional(args.audCost);
    if (args.costOnly && aud == null && local == null) throw Error(tMain("svc.manual.needTotalCost"));
    if (profile.currency === "AUD" && local != null && aud != null && !D(local).eq(aud))
      throw Error(tMain("svc.manual.audCostMatch"));
    const localCost =
      local ?? (profile.currency === "AUD" ? aud : null) ?? (sameQuantity ? old.local_cost : null);
    const audCost =
      aud ?? (profile.currency === "AUD" ? local : null) ?? (sameQuantity ? old.aud_cost : null);
    const reported = Number(!args.costOnly);
    if (
      sameQuantity &&
      old.reported === reported &&
      old.local_cost === localCost &&
      old.aud_cost === audCost &&
      old.reference === reference
    )
      return asset;
    db.prepare(
      "INSERT INTO sp_holding_evidence(account,asset,day,quantity,reported,local_cost,aud_cost,reference) VALUES(?,?,?,?,?,?,?,?)",
    ).run(a.id, asset, date, quantity, reported, localCost, audCost, reference);
    return asset;
  });
}
export function addManual(db, args) {
  const a = account(db, args.account),
    date = day(args.date),
    type = String(args.type),
    ccy = currency(args.currency);
  const supported = [
    "DEPOSIT",
    "WITHDRAWAL",
    "BUY",
    "SELL",
    "DIVIDEND",
    "INTEREST",
    "FEE",
    "TAX",
    "TRANSFER_IN",
    "TRANSFER_OUT",
  ];
  const opening = preference(db, "opening-date", a.id);
  if (opening && date <= opening) throw Error(tMain("svc.manual.inOpening"));
  if (!supported.includes(type)) throw Error(tMain("svc.manual.unsupportedType"));
  const sourceId = String(args.reference || "").trim();
  if (!sourceId) throw Error(tMain("svc.manual.needReference"));
  const id = "manual:" + a.id + ":" + sourceId;
  if (db.prepare("SELECT 1 FROM sp_events WHERE id=?").get(id)) throw Error(tMain("svc.manual.duplicate"));
  return transaction(db, () => {
    const e = {
      id,
      accountId: a.id,
      date,
      activityType: type,
      currency: ccy,
      sourceSystem: "MANUAL",
      sourceRecordId: sourceId,
      isUserModified: true,
      comment: String(args.note || ""),
      status: "POSTED",
    };
    if (type === "BUY" || type === "SELL") {
      if (!String(args.symbol || "").trim()) throw Error(tMain("svc.manual.needSymbol"));
      e.assetSymbol = String(args.symbol).trim().toUpperCase();
      e.assetId = manualAsset(db, args);
      e.quantity = money(args.quantity, true);
      e.unitPrice = money(args.price, true);
      e.fee = money(args.fee || 0, true);
      if (D(e.quantity).lte(0) || D(e.unitPrice).lte(0)) throw Error(tMain("svc.manual.positiveQtyPrice"));
    } else {
      if (type === "DIVIDEND" && args.symbol) {
        e.assetId = manualAsset(db, args);
        e.assetSymbol = String(args.symbol).trim().toUpperCase();
      }
      e.amount = money(args.amount, true);
      if (D(e.amount).lte(0)) throw Error(tMain("svc.manual.positiveAmount"));
    }
    if (type.startsWith("TRANSFER_")) e.group = String(args.group || "").trim() || null;
    saveEvent(db, e);
    db.prepare(
      "INSERT OR REPLACE INTO sp_checks(account,day,reason) SELECT account,day,? FROM sp_statements WHERE account=? AND day>=?",
    ).run(tMain("svc.manual.checkAdded"), a.id, date);
    return id;
  });
}
export function compareStatement(db, args, commit = false) {
  const book = loadBook(db),
    a = account(db, args.account),
    date = day(args.date),
    input = args.cash || {},
    cashEntries = Object.entries(input);
  if (!cashEntries.length) throw Error(tMain("svc.compare.needCash"));
  const pos = positions(book, a, date, false),
    result = [],
    choices = [];
  for (const c of new Set([...pos.cash.keys(), ...Object.keys(input)])) {
    const expected = input[c] == null ? null : D(money(input[c])),
      actual = pos.cash.get(c) || D(0);
    result.push({
      label: tMain("cash.currency", { currency: c }),
      expected: expected?.toFixed() ?? null,
      actual: actual.toFixed(),
      delta: expected == null ? null : actual.minus(expected).toFixed(),
    });
  }
  if (args.positions != null) {
    const map = new Map();
    const actual = new Map();
    const held = [...pos.holdings]
      .filter(([, qty]) => !qty.isZero())
      .map(([id, qty]) => ({ id, qty, asset: book.assets.get(id) }));
    const labels = new Map();
    for (const { id, qty, asset } of held) {
      actual.set(id, qty);
      labels.set(id, (asset?.symbol || id) + (asset?.mic ? " · " + asset.mic : ""));
    }
    for (const [index, v] of args.positions.entries()) {
      const sym = String(v.symbol).toUpperCase();
      const input = {
        account: a.id,
        source: args.source || tMain("imports.brokerStatementSource"),
        record: JSON.stringify([date, index, sym, v.quantity]),
        symbol: sym,
        currency: v.currency,
        mic: v.mic,
      };
      const { match, candidates } = listingMatch(db, input);
      if (!match && candidates.length > 1) {
        choices.push({ ...input, candidates });
        continue;
      }
      const key = match?.id || [sym, v.currency, v.mic].filter(Boolean).join(":");
      if (!labels.has(key)) labels.set(key, sym + (match?.mic ? " · " + match.mic : ""));
      map.set(key, (map.get(key) || D(0)).plus(money(v.quantity)));
    }
    for (const s of new Set([...map.keys(), ...actual.keys()])) {
      const observed = actual.get(s) || D(0),
        expected = map.get(s) || D(0);
      result.push({
        label: tMain("svc.compare.qtyLabel", { label: labels.get(s) }),
        symbol: book.assets.get(s)?.symbol || labels.get(s),
        expected: expected.toFixed(),
        actual: observed.toFixed(),
        delta: observed.minus(expected).toFixed(),
      });
    }
  }
  if (args.nav != null && (args.base == null || args.base === "AUD")) {
    const view = accountSnapshot(book, a, date, {}, pos),
      expected = D(money(args.nav)),
      quoted = view.rows.every(
        (r) =>
          r.audValue != null &&
          (r.type === "cash" || r.priceUpdatedAt === date) &&
          (r.localCurrency === "AUD" || r.fxDate === date),
      );
    const actual = quoted ? view.rows.reduce((n, r) => n.plus(r.audValue), D(0)) : null;
    result.push({
      label: tMain("svc.compare.navLabel"),
      expected: expected.toFixed(),
      actual: actual?.toFixed() ?? null,
      delta: actual ? actual.minus(expected).toFixed() : null,
    });
    if (!quoted) pos.warnings.push(tMain("svc.compare.needQuotesForNav"));
  }
  const ok =
    !choices.length &&
    !pos.warnings.length &&
    result.every(
      (r) =>
        r.delta !== null &&
        D(r.delta)
          .abs()
          .lte(r.symbol ? "0.00000001" : "0.005"),
    );
  if (commit) {
    if (!ok || !args.flowsReviewed) throw Error(tMain("svc.confirm.notAligned"));
    transaction(db, () => {
      db.prepare("INSERT INTO sp_statements VALUES(?,?,?,?,?)").run(
        randomUUID(),
        a.id,
        date,
        String(args.source || tMain("imports.brokerStatementSource")),
        JSON.stringify({ result, flowsReviewed: true }),
      );
      db.prepare("DELETE FROM sp_checks WHERE account=? AND day<=?").run(a.id, date);
    });
  }
  return { ok, rows: result, warnings: pos.warnings, choices };
}

export function recordAccountValue(db, args, withinTransaction = false) {
  if (args.nav == null || !Array.isArray(args.positions)) throw Error(tMain("svc.recordNav.needFields"));
  const save = () => {
    const comparison = compareStatement(db, { ...args, nav: null });
    if (!comparison.ok) throw Error(tMain("svc.recordNav.alignFirst"));
    const book = loadBook(db),
      a = account(db, args.account),
      date = day(args.date);
    const held = [...positions(book, a, date).holdings].filter(([, q]) => !q.isZero());
    const entries = held.map(([id, quantity]) => {
      const asset = book.assets.get(id);
      return { symbol: asset.symbol, currency: asset.currency, mic: asset.mic, quantity: quantity.toFixed() };
    });
    const onlyAud = Object.entries(args.cash).every(([c, value]) => c === "AUD" || D(value).isZero());
    saveBrokerValue(db, a.id, {
      date,
      base: "AUD",
      source: "券商账户页面（手工核对）",
      cash: args.cash,
      positions: entries,
      cashTotal: onlyAud ? args.cash.AUD || "0" : null,
      nav: args.nav,
      unrealized: args.unrealized,
      approximatePnl: args.approximatePnl,
      observedAt: new Date().toISOString(),
    });
    return true;
  };
  return withinTransaction ? save() : transaction(db, save);
}
export async function brokerReport(db, broker, secrets, bound) {
  if (broker === "ibkr") {
    const {queryId, token} = bound || {queryId: preference(db, BROKER, "ibkr.flex-query-id"), token: await secrets.get("ibkr.flex-token")};
    if (!queryId || !token) throw Error(tMain("svc.ibkrNeedCreds"));
    try {
      return withIbkrStatement(await fetchIbkrFlexReport(network, { queryId, token }, "australia"));
    } catch (error) {
      if (error instanceof IbkrFlexAttemptsError) throw Error(tMain("svc.ibkrTooManyFailedAttempts"));
      throw error;
    }
  }
  const { appKey, appSecret, accessToken, accountId } = bound || await webullCredentials(db, secrets);
  if (!appKey || !appSecret || !accessToken || !accountId) throw Error(tMain("svc.webullNeedCreds"));
  const credentials = { appKey, appSecret, accessToken, accountId };
  const report = await fetchWebullReport(network, credentials);
  try {
    const value = await fetchWebullAccountValue(network, credentials);
    report.valuation = { ...value, nav: D(value.cashTotal).plus(value.securities).toFixed() };
    report.statement = report.valuation;
  } catch {
    report.audit.warnings.push(tMain("svc.webullNoValuation"));
  }
  return report;
}
async function webullCredentials(db, secrets) {
  return {
    appKey: preference(db, BROKER, "webull.app-key"),
    appSecret: await secrets.get("webull.app-secret"),
    accessToken: await secrets.get("webull.access-token"),
    accountId: preference(db, BROKER, "webull.api-account-id"),
  };
}
export async function connectWebull(db, secrets) {
  const creds = await webullCredentials(db, secrets);
  return authorizeWebull(creds, (value)=>secrets.set("webull.access-token", value));
}
export async function authorizeWebull(creds, saveToken) {
  if (!creds.appKey || !creds.appSecret) throw Error(tMain("svc.webullSaveCredsFirst"));
  let token = creds.accessToken
    ? await checkWebullToken(network, creds, creds.accessToken)
    : await createWebullToken(network, creds);
  if (["INVALID", "EXPIRED"].includes(token.status)) token = await createWebullToken(network, creds);
  const saved = token.token || creds.accessToken;
  if (!saved) throw Error(tMain("svc.webullNoToken"));
  await saveToken(saved);
  if (token.status !== "NORMAL") return { connected: false, status: token.status || tMain("svc.webullPending"), accounts: [] };
  return { connected: true, status: tMain("svc.webullConnected"), accounts: await listWebullAccounts(network, { ...creds, accessToken: saved }) };
}
export function resetSync(db, broker, id) {
  return resetImportedKeysForMappings(syncHost(db), { ibkr: "", webull: "", [broker]: id });
}
export async function refreshFund(db, asset) {
  const ctx = storageContext(db, ALLOCATION);
  ctx.api.network = network;
  const settings = await loadAllocationSettings(ctx),
    cache = new EtfCache(ctx),
    current = await cache.get(asset.etfKey);
  if (current?.snapshot?.sourceMode === "manual")
    throw Error(tMain("svc.fundManualLocked"));
  const providers = createProviders(ctx);
  const result = await resolveEtfHoldings(
    { ...asset, providerSymbol: settings.providerIdentities[asset.etfKey] },
    providers,
    {
      mode: settings.providerModes[asset.etfKey] || "auto",
      pinnedProvider: settings.pinnedProviders[asset.etfKey],
      cached: current?.snapshot,
      force: true,
    },
  );
  if (!result.snapshot || result.failureReason) throw Error(result.failureReason || tMain("svc.fundNoHoldings"));
  return cache.save(result.snapshot, { expectedVersion: current?.version });
}
