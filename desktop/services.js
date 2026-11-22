import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { parseCsvRows } from "./allocation/domain/etf";
import { runSync, sourceKey, importedKeysStorageKey, resetImportedKeysForMappings } from "./brokers/syncEngine";
import { parseIbkrFlexReport, fetchIbkrFlexReport } from "./brokers/ibkrFlex";
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
  money,
  preference,
  putPref,
  resolveAsset,
  saveEvent,
  savePrice,
  transaction,
} from "./ledger.js";
import { loadBook, positions, accountSnapshot, storageContext } from "./flows.js";
import { recordIdentity, ibkrHistoryPlan, applyIbkrHistoryPlan } from "./ibkrHistory.js";
import { saveBrokerValue } from "./ledger.js";
import { activityEdits, valuationEdits } from "./importChanges.js";
import { EtfCache } from "./allocation/storage/etfCache";
import { loadAllocationSettings } from "./allocation/storage/settings";
import { createProviders, resolveEtfHoldings } from "./allocation/services/etf/providers";

const D = (x) => new Decimal(x ?? 0);
const networkHosts = new Set([
  "api.webull.com.au",
  "www.interactivebrokers.com.au",
  "api.twelvedata.com",
  "query1.finance.yahoo.com",
  "fred.stlouisfed.org",
  "www.alphavantage.co",
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
      throw Error("数据源地址不受支持。");
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
      if (n > 32 * 1024 * 1024) throw Error("数据源响应过大。");
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
  throw Error("成交日期须为 YYYY-MM-DD 或 DD/MM/YYYY。");
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
    throw Error("CSV 缺少证券、买卖方向、成交数量、成交价或成交日期列。");
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
        throw Error("订单未完全成交");
      const side = value("side").toUpperCase(),
        symbol = value("symbol").toUpperCase(),
        market = value("market").toUpperCase();
      const ccy =
        value("ccy") ||
        (/ASX|AUSTRALIA|^AU$/.test(market) ? "AUD" : /NYSE|NASDAQ|^US$/.test(market) ? "USD" : "");
      if (!value("id")) throw Error("缺少可核对的券商记录编号");
      const type = /^(B|BUY|买入)$/.test(side) ? "BUY" : /^(S|SELL|卖出)$/.test(side) ? "SELL" : null;
      if (!type || !symbol) throw Error("无法识别证券或买卖方向");
      const qty = cellNumber(value("qty")),
        price = cellNumber(value("price"));
      if (D(qty).lte(0) || D(price).lte(0)) throw Error("成交数量和价格必须大于零");
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
    audit: { warnings: ["成交文件须与同日现金余额及资金流水一并核对。"] },
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
      throw Error("请核对证券、数量和成交价。");
    if (!["BUY", "SELL"].includes(row.activityType) && row.amount == null && !row.quantity)
      throw Error("券商记录缺少金额或转入转出的证券数量。");
    for (const k of ["quantity", "unitPrice", "fee", "tax", "amount"])
      if (row[k] != null) money(row[k], true);
  } catch (e) {
    errors.validation = [e.message];
  }
  return { ...row, isValid: !Object.keys(errors).length, errors };
}
function nativeEvent(db, v, id) {
  const assetId = resolveAsset(db, v.asset, v.currency);
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
    if (!prior) throw Error("找不到对应的 IBKR 流水。");
    const before = JSON.parse(prior);
    const oldDay = day(before.date), tradeDay = day(date);
    if (oldDay === tradeDay) return before;
    if (oldDay !== day(reportedDateTime)) throw Error("流水日期与原始报表时间不符，请核对结单。");
    const after = { ...before, date, metadata: { ...before.metadata, ibkrReportedDateTime: reportedDateTime } };
    saveEvent(db, after);
    db.prepare("INSERT INTO sp_corrections VALUES(?,?,?,?,?,?)").run(
      randomUUID(), id, new Date().toISOString(), "按 IBKR Flex 原始成交编号核实交易日", prior, JSON.stringify(after),
    );
    const [from, to] = [oldDay, tradeDay].sort();
    db.prepare(`INSERT OR IGNORE INTO sp_checks(account,day,reason)
      SELECT account,day,'成交交易日已更正，请复核该日结单' FROM sp_statements
      WHERE account=? AND day>=? AND day<?`).run(after.accountId, from, to);
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
        .filter((e) => !e.metadata?.supersededBy && !history?.superseded.has(e.id))
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
        updated.push(v.metadata?.ibkrReportedDateTime
          ? correctIbkrTradeDate(db, v.id, v.activityDate, v.metadata.ibkrReportedDateTime)
          : saveEvent(db, nativeEvent(db, v, v.id)));
      }
      return { created, updated, createdMappings, deleted: [], errors: [] };
    },
  };
}
export function amendEvent(db, args) {
  const row = db.prepare("SELECT data FROM sp_events WHERE id=? AND account=?").get(args.id, args.account);
  if (!row) throw Error("找不到要更正的流水。");
  const before = json(row.data, {}),
    reason = String(args.reason || "").trim();
  if (!reason) throw Error("请输入原始凭证或更正依据。");
  if (args.prior !== row.data) throw Error("流水已经变更，请重新加载并核对。");
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
    throw Error("此类历史流水须先核对其专属业务规则。");
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
    if (D(after.quantity).lte(0) || D(after.unitPrice).lte(0)) throw Error("数量和价格必须大于零。");
  } else if (before.assetId && D(before.quantity).gt(0)) after.quantity = money(args.quantity, true);
  else {
    after.amount = money(args.amount, true);
    if (D(after.amount).lte(0)) throw Error("金额必须大于零。");
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
      "流水已更正，请重新核对受影响的结单",
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

function splitConflicts(db, acc, report, history) {
  const exists = new Map(), storedById = new Map();
  for (const { data } of db.prepare("SELECT data FROM sp_events WHERE account=?").all(acc)) {
    const e = json(data, {});
    storedById.set(e.id, e);
    const id = recordIdentity(e);
    if (id && !e.metadata?.supersededBy && !history?.superseded.has(e.id)) exists.set(id, e);
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
    if (history?.blocked.has(id)) {
      problems.push({ ...activityDetail(r), reason: history.blocked.get(id) });
      continue;
    }
    if (!r.brokerRecordId || /^fallback-[a-f0-9]+(?:$|:)/i.test(r.brokerRecordId)) {
      problems.push({ ...activityDetail(r), reason: "缺少可靠的券商记录编号，请核对原始凭证" });
      continue;
    }
    if (opening && dayOf(r.date) <= opening) {
      problems.push({ ...activityDetail(r), reason: "记录落在已确认的期初余额之内" });
      continue;
    }
    if (counts.get(id) > 1) {
      problems.push({ ...activityDetail(r), reason: "文件中券商编号重复，请核对" });
      continue;
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
      problems.push({ ...detail, edits: activityEdits(activityDetail(prior), detail), reason: "券商记录与账本不同，请核对原始凭证。" });
      continue;
    }
    active.push(r);
  }
  return { active, problems, storedById };
}

function checkReason(errors) {
  if (!errors?.migration) return Object.values(errors || {}).flat().join(" ");
  const reason = errors.migration.join(" ");
  if (reason.includes("trade date correction")) return "无法凭原始成交编号和明细核实交易日，请核对券商结单。";
  if (reason.includes("edited by the user")) return "本地已手工修改，请对照券商记录核实。";
  if (reason.includes("no longer exists")) return "找不到原来关联的流水，请核对交易记录。";
  if (reason.includes("different broker record")) return "原关联指向另一笔券商流水，请核对来源。";
  return "有多笔可能对应的流水，请核对原始凭证。";
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

function statementPrices(db, statement, checked, write) {
  const changes = new Map();
  const previous = db.prepare("SELECT day,price FROM sp_prices WHERE asset=? AND day<=? AND source=? ORDER BY day DESC LIMIT 1");
  function add(asset, price, source, label, format, ccy) {
    if (!asset || !(Number(price) > 0)) return;
    const old = previous.get(asset, statement.date, source);
    const different = !old || !D(old.price).eq(price);
    if (!different && old.day === statement.date) return;
    const edit = different ? { label, format, before: old?.price ?? null, after: price, currency: ccy } : null;
    changes.set(JSON.stringify([asset, source]), { asset, price, source, edit });
  }
  for (const r of statement.positions || []) {
    let id = resolveAsset(db, { symbol: r.symbol, exchangeMic: r.mic }, r.currency, false);
    // A new fill creates its security during confirmation, after the read-only preview.
    if (!write && !id && checked.some((v) => v.isValid && v.symbol === r.symbol && v.currency === r.currency &&
      (!r.mic || !v.exchangeMic || r.mic === v.exchangeMic))) id = JSON.stringify([r.symbol, r.currency, r.mic]);
    add(id, r.price, "IBKR 结单报价", r.symbol + " 持仓报价", "price", r.currency);
    if (statement.base === "AUD" && r.currency !== "AUD")
      add("FX:" + currency(r.currency) + "/AUD", r.fxToBase, "IBKR 结单汇率", r.currency + "/AUD 汇率", "rate");
  }
  if (write)
    for (const { asset, price, source } of changes.values())
      savePrice(db, asset, statement.date, price, source, 30);
  return [...changes.values()].flatMap((p) => p.edit ? [p.edit] : []);
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
    for (const { event, reason } of history?.superseded.values() || [])
      rows.push({ ...activityDetail(event), status: "void", reason });
    const previousValue = lastBrokerValue(db, accountId, report.valuation?.date);
    const valueChange = report.valuation ? saveBrokerValue(db, accountId, report.valuation, Boolean(commit)) : null;
    const amountEdits = valueChange === "value" ? valuationEdits(previousValue, report.valuation) : [];
    const priceEdits = broker === "ibkr" && report.statement
      ? statementPrices(db, report.statement, result.checked, Boolean(commit)) : [];
    const summary = {
      source,
      broker,
      account: accountId,
      imported: result.imported,
      updated: result.updated,
      repaired,
      added: result.valid,
      duplicate: result.alreadyImported + result.duplicates,
      unknown: problems,
      invalid: result.invalid,
      audit: report.audit || {},
      statement: report.statement || report.valuation,
      previousValue,
      valueChange,
      prices: priceEdits.length,
      amountEdits,
      priceEdits,
      rows,
    };
    if (commit) {
      if (result.imported || result.updated || repaired || problems.length || result.invalid) {
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
            noStartingBalance ||
            (broker === "webull" && (source.toLowerCase().includes("csv") || report.audit?.warnings?.length)))
        ) {
          db.prepare("INSERT OR REPLACE INTO sp_checks VALUES(?,?,?)").run(
            accountId,
            latest,
            problems.length || result.invalid
              ? "导入含待核对记录，请核对同日结单及资金流水"
              : "成交已导入，现金余额与期间资金流水待结单核对",
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
  if (opening && date <= opening) throw Error("这笔流水落在已确认的期初余额之内。");
  if (!supported.includes(type)) throw Error("不支持的流水类型。");
  const sourceId = String(args.reference || "").trim();
  if (!sourceId) throw Error("请输入可追溯的结单编号或凭证编号。");
  const id = "manual:" + a.id + ":" + sourceId;
  if (db.prepare("SELECT 1 FROM sp_events WHERE id=?").get(id)) throw Error("这份凭证已经入账。");
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
      if (!String(args.symbol || "").trim()) throw Error("请输入证券代码。");
      e.assetSymbol = String(args.symbol).trim().toUpperCase();
      e.assetId = resolveAsset(
        db,
        {
          symbol: e.assetSymbol,
          exchangeMic: args.mic,
          name: args.name,
          instrumentType: args.kind || "EQUITY",
        },
        ccy,
      );
      e.quantity = money(args.quantity, true);
      e.unitPrice = money(args.price, true);
      e.fee = money(args.fee || 0, true);
      if (D(e.quantity).lte(0) || D(e.unitPrice).lte(0)) throw Error("数量和成交价必须大于零。");
    } else {
      e.amount = money(args.amount, true);
      if (D(e.amount).lte(0)) throw Error("金额必须大于零。");
    }
    if (type.startsWith("TRANSFER_")) e.group = String(args.group || "").trim() || null;
    saveEvent(db, e);
    db.prepare(
      "INSERT OR REPLACE INTO sp_checks(account,day,reason) SELECT account,day,'结单期间新增了流水，请重新核对' FROM sp_statements WHERE account=? AND day>=?",
    ).run(a.id, date);
    return id;
  });
}
export function compareStatement(db, args, commit = false) {
  const book = loadBook(db),
    a = account(db, args.account),
    date = day(args.date),
    input = args.cash || {},
    cashEntries = Object.entries(input);
  if (!cashEntries.length) throw Error("请填写结单上的分币种现金余额。");
  const pos = positions(book, a, date),
    result = [];
  for (const c of new Set([...pos.cash.keys(), ...Object.keys(input)])) {
    const expected = input[c] == null ? null : D(money(input[c])),
      actual = pos.cash.get(c) || D(0);
    result.push({
      label: c + " 现金",
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
    for (const v of args.positions) {
      const sym = String(v.symbol).toUpperCase();
      const matches = held.filter(
        ({ asset }) =>
          asset?.symbol.toUpperCase() === sym &&
          (!v.currency || asset.currency === v.currency) &&
          (!v.mic || asset.mic === v.mic),
      );
      if (matches.length > 1) {
        pos.warnings.push(sym + " 对应多个上市证券，请在数量后填写币种与交易所。");
        continue;
      }
      const key = matches[0]?.id || [sym, v.currency, v.mic].filter(Boolean).join(":");
      if (!labels.has(key)) labels.set(key, sym);
      map.set(key, (map.get(key) || D(0)).plus(money(v.quantity)));
    }
    for (const s of new Set([...map.keys(), ...actual.keys()])) {
      const observed = actual.get(s) || D(0),
        expected = map.get(s) || D(0);
      result.push({
        label: labels.get(s) + " 数量",
        expected: expected.toFixed(),
        actual: observed.toFixed(),
        delta: observed.minus(expected).toFixed(),
      });
    }
  }
  if (args.nav != null && (args.base == null || args.base === "AUD")) {
    const view = accountSnapshot(book, a, date),
      expected = D(money(args.nav)),
      quoted = view.rows.every(
        (r) =>
          r.audValue != null &&
          (r.type === "cash" || r.priceUpdatedAt === date) &&
          (r.localCurrency === "AUD" || r.fxDate === date),
      );
    const actual = quoted ? view.rows.reduce((n, r) => n.plus(r.audValue), D(0)) : null;
    result.push({
      label: "总资产 AUD",
      expected: expected.toFixed(),
      actual: actual?.toFixed() ?? null,
      delta: actual ? actual.minus(expected).toFixed() : null,
    });
    if (!quoted) pos.warnings.push("请补齐与结单同日的报价及澳元汇率，再比较总资产。");
  }
  const ok =
    !pos.warnings.length &&
    result.every(
      (r) =>
        r.delta !== null &&
        D(r.delta)
          .abs()
          .lte(r.label.endsWith("数量") ? "0.00000001" : "0.005"),
    );
  if (commit) {
    if (!ok || !args.flowsReviewed) throw Error("请先核齐差异，并确认期间资金流水齐全。");
    transaction(db, () => {
      db.prepare("INSERT INTO sp_statements VALUES(?,?,?,?,?)").run(
        randomUUID(),
        a.id,
        date,
        String(args.source || "月结单"),
        JSON.stringify({ result, flowsReviewed: true }),
      );
      db.prepare("DELETE FROM sp_checks WHERE account=? AND day<=?").run(a.id, date);
    });
  }
  return { ok, rows: result, warnings: pos.warnings };
}

export function recordAccountValue(db, args, withinTransaction = false) {
  if (args.nav == null || !Array.isArray(args.positions)) throw Error("请填写券商总资产及完整持仓。");
  const save = () => {
    const comparison = compareStatement(db, { ...args, nav: null });
    if (!comparison.ok) throw Error("保存券商估值前，请先核齐各币种现金和持仓数量。");
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
export async function brokerReport(db, broker, secrets) {
  if (broker === "ibkr") {
    const queryId = preference(db, BROKER, "ibkr.flex-query-id"),
      token = await secrets.get("ibkr.flex-token");
    if (!queryId || !token) throw Error("请先保存 IBKR Query ID 和 Flex Token。");
    return withIbkrStatement(await fetchIbkrFlexReport(network, { queryId, token }, "australia"));
  }
  const { appKey, appSecret, accessToken, accountId } = await webullCredentials(db, secrets);
  if (!appKey || !appSecret || !accessToken || !accountId) throw Error("请先连接并选择 Webull AU 券商账户。");
  const credentials = { appKey, appSecret, accessToken, accountId };
  const report = await fetchWebullReport(network, credentials);
  try {
    const value = await fetchWebullAccountValue(network, credentials);
    report.valuation = { ...value, nav: D(value.cashTotal).plus(value.securities).toFixed() };
    report.statement = report.valuation;
  } catch {
    report.audit.warnings.push("Webull 本次未提供完整的账户估值。");
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
  if (!creds.appKey || !creds.appSecret) throw Error("请先保存 Webull App Key 与 App Secret。");
  let token = creds.accessToken
    ? await checkWebullToken(network, creds, creds.accessToken)
    : await createWebullToken(network, creds);
  if (["INVALID", "EXPIRED"].includes(token.status)) token = await createWebullToken(network, creds);
  const saved = token.token || creds.accessToken;
  if (!saved) throw Error("Webull 未返回授权令牌。");
  await secrets.set("webull.access-token", saved);
  if (token.status !== "NORMAL") return { status: token.status || "待确认", accounts: [] };
  return { status: "已连接", accounts: await listWebullAccounts(network, { ...creds, accessToken: saved }) };
}
export function resetSync(db, broker, id) {
  return resetImportedKeysForMappings(syncHost(db), { ibkr: "", webull: "", [broker]: id });
}
export async function refreshFund(db, asset, secrets) {
  const ctx = storageContext(db, ALLOCATION);
  ctx.api.network = network;
  const settings = await loadAllocationSettings(ctx),
    cache = new EtfCache(ctx),
    current = await cache.get(asset.etfKey);
  if (current?.snapshot?.sourceMode === "manual")
    throw Error("此基金使用手工成分。切换数据源前请先导出并停用当前成分表。");
  const providers = createProviders(ctx, { alphaVantageApiKey: await secrets.get("alphaVantage.apiKey") });
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
  if (!result.snapshot || result.failureReason) throw Error(result.failureReason || "数据源未返回有效成分。");
  return cache.save(result.snapshot, { expectedVersion: current?.version });
}
