const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomBytes } = require("node:crypto");
const { createBook, putPref, createAccount, resolveAsset } = require("../out/ledger.cjs");
const { loadBook, positions, externalFlows } = require("../out/flows.cjs");
const {
  addManual, amendEvent, createCustomAccount, customCsvHeader, deleteActivity, deleteCustomAccount, importCustomCsv,
} = require("../out/services.cjs");

const sample = `
record_id,date,type,currency,symbol,mic,asset_kind,quantity,unit_price,amount,fee,transfer_group,to_currency,to_amount,note
dep-001,2026-11-02,DEPOSIT,AUD,,,,,,1000,,,,,Bank deposit
fx-001,2026-11-03,FX_CONVERSION,AUD,,,,,,300,2,,USD,195,AUD to USD
trade-001,2026-11-04,BUY,USD,AAPL,XNAS,EQUITY,1,180,,1,,,,Buy one share
`.trim();

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-custom-"));
  const db = createBook(path.join(dir, "portfolio.sqlite"), Buffer.from("raw:" + randomBytes(32).toString("hex")));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const custom = (name = "Custom account") => createCustomAccount(db, { name, currency: "AUD", brokerName: "Example" });
  return { db, custom };
}

function balances(db, id) {
  const book = loadBook(db);
  const account = book.accounts.find((item) => item.id === id);
  const { cash, holdings } = positions(book, account, "2026-11-09");
  return {
    cash: Object.fromEntries([...cash].map(([currency, amount]) => [currency, amount.toNumber()])),
    holdings: [...holdings].map(([asset, qty]) => [book.assets.get(asset).symbol, qty.toNumber()]),
  };
}

test("custom CSV and manual entry share ledger positions, cash and reference identity", (t) => {
  const { db, custom } = fixture(t);
  const imported = custom(), manual = custom("Second account");
  const plan = importCustomCsv(db, imported, sample);
  assert.deepEqual([plan.new, plan.duplicate, plan.invalid, plan.imported], [3, 0, 0, 0]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sp_events").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sp_assets").get().n, 0);
  assert.equal(importCustomCsv(db, imported, sample, true).imported, 3);
  assert.equal(importCustomCsv(db, imported, sample, true).duplicate, 3);

  const currency = "AUD";
  addManual(db, { account: manual, currency, reference: "dep-001", date: "2026-11-02", type: "DEPOSIT", amount: "1000", note: "Bank deposit" });
  const fxId = addManual(db, { account: manual, currency, reference: "fx-001", date: "2026-11-03",
    type: "FX_CONVERSION", amount: "300", fee: "2", toCurrency: "USD", toAmount: "195", note: "AUD to USD" });
  addManual(db, { account: manual, currency: "USD", reference: "trade-001", date: "2026-11-04",
    type: "BUY", symbol: "AAPL", mic: "XNAS", kind: "EQUITY", quantity: "1", price: "180", fee: "1", note: "Buy one share" });

  for (const id of [imported, manual]) {
    assert.deepEqual(balances(db, id), { cash: { AUD: 698, USD: 14 }, holdings: [["AAPL", 1]] });
    assert.equal(externalFlows(loadBook(db), [id], "2026-11-01", "2026-11-09"), 1000);
  }
  assert.equal(loadBook(db).accounts.find((item) => item.id === manual).brokerName, "Example");
  assert.equal(importCustomCsv(db, manual, sample, true).duplicate, 3);

  const find = db.prepare("SELECT data FROM sp_events WHERE id=?");
  amendEvent(db, { id: fxId, account: manual, prior: find.get(fxId).data, reason: "Statement correction",
    date: "2026-11-03", note: "AUD to USD", amount: "310", fee: "3", toCurrency: "USD", toAmount: "200" });
  assert.deepEqual(balances(db, manual).cash, { AUD: 687, USD: 19 });
  assert.equal(importCustomCsv(db, manual, sample, true).duplicate, 3);
  deleteActivity(db, { id: fxId, account: manual, prior: find.get(fxId).data, deleteGroup: true });
  assert.deepEqual(balances(db, manual).cash, { AUD: 1000, USD: -181 });
  assert.equal(importCustomCsv(db, manual, sample, true).duplicate, 3);
});

test("an invalid CSV leaves all rows untouched and opening dates guard both entry paths", (t) => {
  const { db, custom } = fixture(t);
  const id = custom();
  const rows = sample.split("\n");
  const fresh = rows[1].replace("dep-001", "dep-002");
  const conflictFile = [rows[0], rows[1], rows[1].replace("1000", "999"), fresh].join("\n");
  const conflict = importCustomCsv(db, id, conflictFile, true);
  assert.equal(conflict.invalid, 1);
  assert.equal(conflict.rows[1].field, "record_id");
  assert.equal(conflict.imported, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sp_events").get().n, 0);

  const windowsCsv = "\uFEFF" + rows[0] + "\r\n" + rows[1].replace("Bank deposit", '"Bank, ""transfer""\r\nreceived"');
  assert.equal(importCustomCsv(db, id, windowsCsv, true).imported, 1);
  assert.throws(() => importCustomCsv(db, id, rows[0] + '\n"broken'), { field: "CSV" });

  const openingId = custom("Existing holdings");
  putPref(db, "opening-date", openingId, "2026-11-02");
  assert.equal(importCustomCsv(db, openingId, [customCsvHeader, fresh].join("\n"), true).rows[0].field, "date");
  assert.throws(() => addManual(db, { account: openingId, type: "DEPOSIT", date: "2026-11-02", currency: "AUD", amount: "1" }), { field: "date" });
  assert.ok(addManual(db, { account: openingId, type: "DEPOSIT", date: "2026-11-03", currency: "AUD", amount: "1" }));
});

test("paired custom and existing account transfers cancel only in their shared scope", (t) => {
  const { db, custom } = fixture(t);
  const from = custom(), to = createAccount(db, "Existing account");
  const details = { date: "2026-11-05", currency: "AUD", amount: "500", group: "move-1" };
  addManual(db, { ...details, account: from, type: "TRANSFER_OUT" });
  assert.throws(() => addManual(db, { ...details, account: to, type: "TRANSFER_IN", amount: "501", reference: "wrong" }), { field: "transfer_group" });
  addManual(db, { ...details, account: to, type: "TRANSFER_IN", reference: "incoming" });
  const book = loadBook(db);
  assert.equal(externalFlows(book, [from], "2026-11-04", "2026-11-06"), -500);
  assert.equal(externalFlows(book, [to], "2026-11-04", "2026-11-06"), 500);
  assert.equal(externalFlows(book, [from, to], "2026-11-04", "2026-11-06"), 0);
});

test("booked CSV references keep their original listing when the symbol later becomes ambiguous", (t) => {
  const { db, custom } = fixture(t);
  const id = custom();
  assert.equal(importCustomCsv(db, id, sample, true).imported, 3);
  const row = sample.split("\n")[3].replace("trade-001", "trade-002").replace("XNAS,EQUITY", ",");
  const withoutListing = [customCsvHeader, row].join("\n");
  assert.equal(importCustomCsv(db, id, withoutListing, true).imported, 1);
  addManual(db, { account: id, reference: "other-listing", date: "2026-11-05", type: "BUY",
    currency: "USD", mic: "XNYS", kind: "EQUITY", symbol: "AAPL", name: "Alternate listing", quantity: "1", price: "150" });
  assert.equal(db.prepare("SELECT name FROM sp_assets WHERE symbol='AAPL' AND mic='XNYS'").get().name, "Alternate listing");
  assert.equal(importCustomCsv(db, id, withoutListing, true).duplicate, 1);
  const conflicting = [customCsvHeader, row.replace(",,,1,", ",XNYS,EQUITY,1,")].join("\n");
  assert.equal(importCustomCsv(db, id, conflicting, true).rows[0].field, "record_id");
});

test("custom trade entry rejects known instruments outside stock and ETF scope", (t) => {
  const { db, custom } = fixture(t);
  const id = custom();
  const assetId = resolveAsset(db, { symbol: "BOND1", exchangeMic: "XNAS", instrumentType: "BOND" }, "USD");
  assert.throws(() => addManual(db, { account: id, date: "2026-11-05", type: "BUY",
    currency: "USD", mic: "XNAS", symbol: "BOND1", assetId, quantity: "1", price: "150" }), { field: "symbol" });
  const row = sample.split("\n")[3].replace("AAPL,XNAS,EQUITY", "BOND1,XNAS,");
  const result = importCustomCsv(db, id, [customCsvHeader, row].join("\n"), true);
  assert.equal(result.rows[0].field, "symbol");
  assert.equal(result.imported, 0);
});

test("existing exchange aliases work for manual trades and CSV replay", (t) => {
  const { db, custom } = fixture(t);
  const id = custom();
  const assetId = resolveAsset(db, { symbol: "AAPL", exchangeMic: "NASDAQ", instrumentType: "EQUITY" }, "USD");
  addManual(db, { account: id, assetId, reference: "trade-001", date: "2026-11-04", type: "BUY",
    currency: "USD", mic: "NASDAQ", symbol: "AAPL", quantity: "1", price: "180", fee: "1", note: "Buy one share" });
  const row = sample.split("\n")[3].replace("XNAS,EQUITY", ",");
  assert.equal(importCustomCsv(db, id, [customCsvHeader, row].join("\n"), true).duplicate, 1);
  assert.throws(() => addManual(db, { account: id, date: "2026-11-06", type: "BUY", currency: "USD",
    mic: "NASDAQ", kind: "EQUITY", symbol: "NEW", quantity: "1", price: "180" }), { field: "mic" });
});

test("deleting a custom account removes its ledger history and preserves the other transfer entry", (t) => {
  const { db, custom } = fixture(t);
  const removed = custom("To delete"), kept = createAccount(db, "Existing account");
  const asset = resolveAsset(db, { symbol: "AAPL", exchangeMic: "XNAS", instrumentType: "EQUITY" }, "USD");
  const date = "2026-11-05";
  putPref(db, "opening-date", removed, "2026-11-01");
  db.prepare("INSERT INTO sp_anchors VALUES (?,?,?,?)").run(removed, "2026-11-01", "{}", '{"AUD":"500"}');
  db.prepare("INSERT INTO sp_holding_evidence(account,asset,day,quantity,reported,reference) VALUES (?,?,?,?,?,?)")
    .run(removed, asset, date, "1", 1, "statement");
  db.prepare("INSERT INTO sp_statements VALUES (?,?,?,?,?)").run("statement", removed, date, "manual", "{}");
  db.prepare("INSERT INTO sp_checks VALUES (?,?,?)").run(removed, date, "review");
  const choice = JSON.stringify([removed, "manual", "record", "AAPL", "USD", "XNAS"]);
  putPref(db, "listing-choice", choice, asset);
  const deposit = addManual(db, { account: removed, date, type: "DEPOSIT", amount: "100", currency: "AUD" });
  const prior = db.prepare("SELECT data FROM sp_events WHERE id=?").get(deposit).data;
  amendEvent(db, { id: deposit, account: removed, prior, reason: "Document update", date, amount: "120" });
  addManual(db, { account: removed, date, currency: "AUD", type: "TRANSFER_OUT", group: "linked", amount: "40" });
  const transfer = addManual(db, { account: kept, date, currency: "AUD", type: "TRANSFER_IN",
    group: "linked", amount: "40", reference: "peer" });
  assert.equal(externalFlows(loadBook(db), [removed, kept], "2026-11-02", "2026-11-06"), 120);

  deleteCustomAccount(db, removed);
  const book = loadBook(db);
  assert.deepEqual(book.accounts.map((account) => account.id), [kept]);
  assert.equal(book.assets.get(asset).symbol, "AAPL");
  const surviving = db.prepare("SELECT id FROM sp_events").all().map((row) => row.id);
  assert.deepEqual(surviving, [transfer]);
  assert.equal(externalFlows(book, [kept], "2026-11-02", "2026-11-06"), 40);
  for (const table of ["sp_anchors", "sp_holding_evidence", "sp_statements", "sp_checks", "sp_corrections"])
    assert.equal(db.prepare("SELECT count(*) AS n FROM " + table).get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sp_prefs WHERE key IN (?,?)").get(removed, choice).n, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("account deletion rejects built-in accounts and rolls back an interrupted custom deletion", (t) => {
  const { db, custom } = fixture(t);
  const kept = createAccount(db, "Existing account");
  const id = custom();
  const entry = addManual(db, { account: id, date: "2026-11-05", type: "DEPOSIT", amount: "100", currency: "AUD" });
  assert.throws(() => deleteCustomAccount(db, kept), { field: "account" });
  db.exec("CREATE TRIGGER block_account_delete BEFORE DELETE ON sp_accounts BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  assert.throws(() => deleteCustomAccount(db, id), /blocked/);
  const book = loadBook(db);
  assert.deepEqual(book.accounts.map((account) => account.id), [kept, id]);
  assert.equal(book.accounts[1].custom, true);
  assert.equal(db.prepare("SELECT id FROM sp_events WHERE id=?").get(entry).id, entry);
});
