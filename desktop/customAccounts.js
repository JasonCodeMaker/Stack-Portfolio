import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { BROKER, CUSTOM_ACCOUNT, account, createAccount, day, json, money, preference, putPref, resolveAsset, saveEvent, transaction } from "./ledger.js";
import { live } from "./flows.js";
import { tMain } from "./i18n/index.js";

const columns = [
  "record_id", "date", "type", "currency", "symbol", "mic", "asset_kind", "quantity",
  "unit_price", "amount", "fee", "transfer_group", "to_currency", "to_amount", "note",
];
export const customCsvHeader = columns.join(",");
const ordinaryCashTypes = ["DEPOSIT", "WITHDRAWAL", "DIVIDEND", "INTEREST", "FEE", "TAX"];
const assetKinds = ["EQUITY", "ETF"];
const transferTypes = ["TRANSFER_IN", "TRANSFER_OUT"];
const tradeTypes = ["BUY", "SELL"];
const supported = new Set([...tradeTypes, ...ordinaryCashTypes, ...transferTypes, "FX_CONVERSION"]);
const upper = (value) => String(value ?? "").trim().toUpperCase();

function invalid(field, key, params) {
  throw Object.assign(Error(tMain("custom.error." + key, params)), { field });
}

export function createCustomAccount(db, { name, currency, brokerName = "" }) {
  if (!["AUD", "USD"].includes(currency)) invalid("currency", "accountCurrency");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120)
    invalid("name", "accountName");
  if (typeof brokerName !== "string" || brokerName.trim().length > 120)
    invalid("brokerName", "brokerName");
  return transaction(db, () => {
    const id = createAccount(db, name, currency);
    putPref(db, CUSTOM_ACCOUNT, id, brokerName.trim());
    return id;
  });
}

export function customAccount(db, id) {
  const row = account(db, id);
  if (!row.active || row.mode !== "TRANSACTIONS" || preference(db, CUSTOM_ACCOUNT, row.id) === null)
    invalid("account", "account");
  return row;
}

export function deleteCustomAccount(db, id) {
  return transaction(db, () => {
    const { id: accountId } = account(db, id);
    if (preference(db, CUSTOM_ACCOUNT, accountId) === null) invalid("account", "deleteAccountType");
    removeAccount(db, accountId);
  });
}

// Deletes any account with its records. A broker account also loses its binding, its saved credentials and
// any import mapping that pointed at it; the shared broker credentials stay for other accounts.
export function deleteLedgerAccount(db, id) {
  return transaction(db, () => {
    const { id: accountId } = account(db, id);
    for (const scope of ["broker-account", "broker-account-credentials"]) putPref(db, scope, accountId, null);
    for (const broker of ["ibkr", "webull"])
      if (preference(db, BROKER, "local-account." + broker) === accountId) putPref(db, BROKER, "local-account." + broker, null);
    putPref(db, BROKER, "webull.funds." + accountId, null);
    removeAccount(db, accountId);
  });
}

// The account's records, opening date, listing choices and the account row; runs inside the caller's transaction.
function removeAccount(db, accountId) {
  db.prepare("DELETE FROM sp_corrections WHERE event IN (SELECT id FROM sp_events WHERE account=?)").run(accountId);
  for (const table of [
    "sp_events", "sp_anchors", "sp_holding_evidence", "sp_broker_prices", "sp_archive",
    "sp_statements", "sp_broker_values", "sp_checks", "sp_batches",
  ]) db.prepare("DELETE FROM " + table + " WHERE account=?").run(accountId);
  db.prepare(`DELETE FROM sp_prefs
    WHERE (scope IN (?, 'opening-date') AND key=?)
      OR (scope='listing-choice' AND CASE WHEN json_valid(key) THEN json_extract(key, '$[0]') END=?)`)
    .run(CUSTOM_ACCOUNT, accountId, accountId);
  db.prepare("DELETE FROM sp_accounts WHERE id=?").run(accountId);
}

function csvRows(text) {
  const rows = [];
  let cells = [], value = "", state = "plain", line = 1, start = 1;
  const cell = () => {
    cells.push(value);
    value = "";
    state = "plain";
  };
  const row = () => {
    cell();
    if (cells.length > 1 || cells[0].trim()) rows.push({ line: start, cells });
    cells = [];
  };
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      line++;
      if (state === "quoted") {
        value += "\n";
      } else {
        row();
        start = line;
      }
    } else if (state === "quoted") {
      if (char !== '"') value += char;
      else if (text[i + 1] === '"') {
        value += char;
        i++;
      } else state = "closed";
    } else if (char === ",") {
      cell();
    } else if (char === '"' && state === "plain" && !value) {
      state = "quoted";
    } else if (char === '"' || state === "closed") {
      invalid("CSV", "csvSyntax", { line });
    } else {
      value += char;
    }
  }
  if (state === "quoted") invalid("CSV", "csvSyntax", { line: start });
  row();
  return rows;
}

function decimal(value, field, optional = false) {
  const text = String(value ?? "").trim();
  if (!text && optional) return "0";
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) || (!optional && !new Decimal(text).gt(0)))
    invalid(field, optional ? "fee" : "positive");
  return money(text, true);
}

function recordInput(raw, opening) {
  const values = Object.fromEntries(columns.map((key) => [key, String(raw[key] ?? "").trim()]));
  const { record_id, date, type, note } = values;
  if (!record_id) invalid("record_id", "reference");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid("date", "date");
  try { day(date); } catch { invalid("date", "date"); }
  if (opening && date <= opening) invalid("date", "opening");
  if (!supported.has(type)) invalid("type", "type");
  const currency = upper(values.currency);
  if (!/^[A-Z]{3}$/.test(currency)) invalid("currency", "currency");
  const input = { record_id, date, type, currency, note: note.replace(/\r\n?/g, "\n") };
  const trade = tradeTypes.includes(type), fx = type === "FX_CONVERSION";
  const usesListing = trade || (type === "DIVIDEND" && Boolean(values.symbol));
  if (usesListing) {
    input.symbol = upper(values.symbol);
    input.mic = upper(values.mic);
    input.asset_kind = upper(values.asset_kind);
    if (!input.symbol) invalid("symbol", "symbol");
    if (input.asset_kind && !assetKinds.includes(input.asset_kind)) invalid("asset_kind", "assetKind");
  }
  if (trade) {
    input.quantity = decimal(values.quantity, "quantity");
    input.unit_price = decimal(values.unit_price, "unit_price");
  } else {
    input.amount = decimal(values.amount, "amount");
  }
  if (fx || trade) input.fee = decimal(values.fee, "fee", true);
  if (transferTypes.includes(type)) input.transfer_group = customTransferGroup(values.transfer_group);
  if (fx) {
    input.to_currency = upper(values.to_currency);
    if (!/^[A-Z]{3}$/.test(input.to_currency)) invalid("to_currency", "currency");
    if (input.to_currency === currency) invalid("to_currency", "sameCurrency");
    input.to_amount = decimal(values.to_amount, "to_amount");
  }
  for (const key of columns) {
    if (values[key] && !Object.hasOwn(input, key)) invalid(key, "unused");
  }
  return input;
}

function matchListing(db, input, planned, preferredId) {
  if (!input.symbol) return null;
  const key = JSON.stringify([input.symbol, input.currency]);
  if (!planned.has(key)) {
    const listings = db.prepare("SELECT * FROM sp_assets WHERE upper(symbol)=? AND currency=?").all(input.symbol, input.currency);
    planned.set(key, listings);
  }
  const listings = planned.get(key);
  const matches = listings.filter((asset) => !input.mic || input.mic === upper(asset.mic));
  const preferred = preferredId && preferredId !== "new" ? matches.find((asset) => asset.id === preferredId) : null;
  if (preferredId && preferredId !== "new" && !preferred) invalid("symbol", "listingMismatch");
  if (!preferred && matches.length > 1) invalid("mic", "ambiguous");
  const asset = preferred ?? matches[0];
  if (asset) {
    if (tradeTypes.includes(input.type) && !assetKinds.includes(asset.kind)) invalid("symbol", "unsupportedListing");
    if (input.asset_kind && assetKinds.includes(asset.kind) && input.asset_kind !== asset.kind)
      invalid("asset_kind", "listingMismatch");
    input.mic = upper(asset.mic);
    input.asset_kind = assetKinds.includes(asset.kind) ? asset.kind : "";
    return asset;
  }
  if (input.type === "DIVIDEND") invalid("symbol", "existingListing");
  if (!input.mic) invalid("mic", "newMic");
  if (!/^[A-Z0-9]{4}$/.test(input.mic)) invalid("mic", "mic");
  if (!input.asset_kind) invalid("asset_kind", "assetKind");
  const newAsset = { symbol: input.symbol, currency: input.currency, mic: input.mic, kind: input.asset_kind };
  listings.push(newAsset);
  return newAsset;
}

const primaryId = (accountId, reference) => "custom:" + accountId + ":" + reference;
const fxLegId = (id) => "fx-in:" + id;

export function customTransferGroup(value) {
  const group = String(value ?? "").trim();
  if (group.startsWith("custom-fx:")) invalid("transfer_group", "transfer");
  return group;
}

export function transferMembers(db, group) {
  if (!group) return [];
  return db.prepare(`SELECT data FROM sp_events
    WHERE json_extract(data,'$.group')=? AND json_extract(data,'$.activityType') IN ('TRANSFER_IN','TRANSFER_OUT')`)
    .all(group).map((row) => json(row.data, {}))
    .filter((event) => live(event) && !event.metadata?.supersededBy);
}

export function validateTransferPair(event, candidates) {
  if (candidates.length > 1 || candidates.some((other) =>
    other.metadata?.fx || other.assetId || other.activityType === event.activityType || other.accountId === event.accountId ||
    other.currency !== event.currency || !new Decimal(other.amount ?? 0).eq(event.amount),
  )) invalid("transfer_group", "transfer");
}

function makeEvents(accountId, input, source, asset) {
  const id = primaryId(accountId, input.record_id);
  const event = {
    id, accountId, date: input.date, activityType: input.type, currency: input.currency,
    sourceSystem: source, sourceRecordId: input.record_id, comment: input.note,
    status: "POSTED", isUserModified: source === "MANUAL", metadata: { customRecord: input },
  };
  if (asset) {
    event.assetId = asset.id;
    event.assetSymbol = input.symbol;
  }
  if (input.quantity) {
    event.quantity = input.quantity;
    event.unitPrice = input.unit_price;
  }
  if (input.fee) event.fee = input.fee;
  if (input.amount) event.amount = input.amount;
  if (input.transfer_group) event.group = input.transfer_group;
  if (input.type !== "FX_CONVERSION") return [event];
  event.activityType = "TRANSFER_OUT";
  event.group = "custom-fx:" + id;
  event.metadata.flow = { is_external: false };
  event.metadata.fx = {
    sourceCurrency: input.currency, destinationCurrency: input.to_currency,
    sourceAmount: input.amount, destinationAmount: input.to_amount,
  };
  return [event, {
    ...event, id: fxLegId(id), activityType: "TRANSFER_IN", currency: input.to_currency, amount: input.to_amount,
    fee: "0", metadata: { ...event.metadata, customFxIncoming: true },
  }];
}

function markStatements(db, accountId, from, key) {
  db.prepare(`INSERT OR REPLACE INTO sp_checks(account,day,reason)
    SELECT account,day,? FROM sp_statements WHERE account=? AND day>=?`)
    .run(tMain(key), accountId, from);
}

function post(db, accountId, input, source, asset) {
  if (asset && !asset.id) {
    asset.id = resolveAsset(db, {
      symbol: asset.symbol, name: asset.name, exchangeMic: asset.mic, instrumentType: asset.kind, requireMarketMatch: true,
    }, asset.currency);
  }
  const events = makeEvents(accountId, input, source, asset);
  for (const event of events) saveEvent(db, event, true);
  markStatements(db, accountId, input.date, "svc.manual.checkAdded");
  return events[0].id;
}

function originalReference(db, accountId, input, seen) {
  const stored = db.prepare("SELECT original FROM sp_events WHERE id=? AND account=?")
    .get(primaryId(accountId, input.record_id), accountId);
  const original = stored ? json(stored.original, {}).metadata?.customRecord : seen?.get(input.record_id);
  if (!stored && !original) return null;
  // Missing listing fields refer to the original match, even if the catalog changes later.
  const compared = input.symbol && original?.symbol ? {
    ...input, mic: input.mic || original.mic, asset_kind: input.asset_kind || original.asset_kind,
  } : input;
  if (JSON.stringify(compared) === JSON.stringify(original)) return original;
  invalid("record_id", "conflict", { reference: input.record_id });
}

export function importCustomCsv(db, id, text, commit = false) {
  function inspect() {
    const { id: accountId } = customAccount(db, id);
    const opening = preference(db, "opening-date", accountId);
    const rawRows = csvRows(text);
    const header = rawRows.shift();
    if (header?.cells.length !== columns.length || header.cells.join(",") !== customCsvHeader) invalid("CSV", "header");
    if (!rawRows.length) invalid("CSV", "empty");
    const planned = new Map(), seen = new Map(), stagedGroups = new Map(), ready = [];
    const summary = { new: 0, duplicate: 0, invalid: 0, imported: 0, rows: [] };
    const normalized = rawRows.map(({ line, cells }) => {
      try {
        if (cells.length !== columns.length) invalid("CSV", "columnCount");
        return { line, input: recordInput(Object.fromEntries(columns.map((key, i) => [key, cells[i]])), opening) };
      } catch (error) {
        if (!error.field) throw error;
        return { line, error, reference: cells[0] };
      }
    });
    // Seed intended listings before resolving dividends or rows that omit an already specified MIC.
    for (const row of normalized) {
      if (row.input?.mic && row.input.asset_kind && tradeTypes.includes(row.input.type)) {
        try { matchListing(db, { ...row.input }, planned); } catch (error) { if (!error.field) throw error; }
      }
    }
    for (const { line, input, error, reference } of normalized) {
      const preview = { line, reference: input?.record_id ?? reference, date: input?.date, type: input?.type };
      try {
        if (error) throw error;
        const original = originalReference(db, accountId, input, seen);
        const asset = original ? null : matchListing(db, input, planned);
        preview.status = original ? "duplicate" : "new";
        const { symbol, mic, currency, quantity, unit_price, amount, fee, to_currency, to_amount } = original ?? input;
        preview.values = { symbol, mic, currency, quantity, unit_price, amount, fee, to_currency, to_amount };
        if (preview.status === "new") {
          const group = input.transfer_group;
          if (group) {
            const event = makeEvents(accountId, input, "CUSTOM_CSV")[0];
            const members = stagedGroups.get(group) ?? transferMembers(db, group);
            validateTransferPair(event, members);
            stagedGroups.set(group, [...members, event]);
          }
          seen.set(input.record_id, input);
          ready.push({ input, asset });
        }
      } catch (problem) {
        if (!problem.field) throw problem;
        Object.assign(preview, { status: "invalid", field: problem.field, message: problem.message });
      }
      summary.rows.push(preview);
      summary[preview.status]++;
    }
    if (commit && !summary.invalid) {
      for (const { input, asset } of ready) post(db, accountId, input, "CUSTOM_CSV", asset);
      summary.imported = ready.length;
    }
    return summary;
  }
  return commit ? transaction(db, inspect) : inspect();
}

export function addCustomManual(db, args) {
  return transaction(db, () => {
    const { id } = customAccount(db, args.account);
    const input = recordInput({
      record_id: String(args.reference ?? "").trim() || randomUUID(), date: args.date, type: args.type,
      currency: args.currency, symbol: args.symbol, mic: args.mic, asset_kind: args.kind,
      quantity: args.quantity, unit_price: args.price, amount: args.amount, fee: args.fee,
      transfer_group: args.group, to_currency: args.toCurrency, to_amount: args.toAmount, note: args.note,
    }, preference(db, "opening-date", id));
    if (originalReference(db, id, input)) invalid("record_id", "duplicate");
    const asset = matchListing(db, input, new Map(), args.assetId);
    if (asset && !asset.id) {
      const name = String(args.name ?? "").trim();
      if (name.length > 120) invalid("name", "securityName");
      asset.name = name;
    }
    if (input.transfer_group)
      validateTransferPair(makeEvents(id, input, "MANUAL", asset)[0], transferMembers(db, input.transfer_group));
    return post(db, id, input, "MANUAL", asset);
  });
}

export function amendCustomActivity(db, args) {
  return transaction(db, () => {
    const { id: accountId } = customAccount(db, args.account);
    const find = db.prepare("SELECT data FROM sp_events WHERE id=? AND account=?");
    const row = find.get(args.id, accountId);
    if (!row || row.data !== args.prior) throw Error(tMain("svc.amendChangedReload"));
    const before = json(row.data, {});
    const saved = before.metadata?.customRecord;
    if (!saved || before.metadata?.customFxIncoming || !live(before)) throw Error(tMain("svc.activityAlreadyInactive"));
    const reason = String(args.reason ?? "").trim();
    if (!reason) invalid("reason", "reason");
    const changed = { ...saved, date: args.date, note: args.note };
    if (tradeTypes.includes(saved.type)) Object.assign(changed, { quantity: args.quantity, unit_price: args.price, fee: args.fee });
    else changed.amount = args.amount;
    if (saved.type === "FX_CONVERSION") {
      Object.assign(changed, {
        currency: args.currency ?? saved.currency, to_currency: args.toCurrency,
        to_amount: args.toAmount, fee: args.fee,
      });
    }
    const input = recordInput(changed, preference(db, "opening-date", accountId));
    const asset = before.assetId ? { id: before.assetId } : null;
    const events = makeEvents(accountId, input, before.sourceSystem, asset);
    if (input.transfer_group)
      validateTransferPair(events[0], transferMembers(db, input.transfer_group).filter((event) => event.id !== before.id));
    const audit = db.prepare("INSERT INTO sp_corrections VALUES(?,?,?,?,?,?)");
    for (const event of events) {
      const prior = find.get(event.id, accountId);
      if (!prior || !live(json(prior.data, {}))) throw Error(tMain("svc.amendChangedReload"));
      const after = { ...event, isUserModified: true };
      saveEvent(db, after);
      audit.run(randomUUID(), event.id, new Date().toISOString(), reason, prior.data, JSON.stringify(after));
    }
    markStatements(db, accountId, [before.date, input.date].sort()[0], "svc.amendCheckNeeded");
    return before.id;
  });
}
