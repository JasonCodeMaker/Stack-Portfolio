const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const { createBook, migrate, copyBook, putPref, preference } = require("../out/ledger.cjs");
const { dashboard } = require("../out/flows.cjs");
const { seedDemo, demoCsv, demoXml } = require("../out/demo.cjs");
const {
  batch,
  combinedBatch,
  compareStatement,
  addManual,
  amendEvent,
  parseWebullCsv,
  detailedIbkr,
} = require("../out/services.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-book-")),
    book = path.join(dir, "portfolio.sqlite");
  let db = createBook(book);
  t.after(() => {
    if (db.isOpen !== false)
      try {
        db.close();
      } catch {}
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    fs.rmdirSync(dir);
  });
  return { dir, book, db };
}
test("sample reconciliation updates holdings, external cashflow and P&L exactly once", async (t) => {
  const { db, dir, book } = fixture(t);
  await seedDemo(db);
  let d = await dashboard(db);
  assert.equal(d.total, null);
  assert.equal(d.etfData.filter((e) => e.snapshot).length, 2);
  const w = "demo-webull",
    report = parseWebullCsv(demoCsv);
  assert.equal((await batch(db, w, "webull", report, "sample.csv")).added, 1);
  assert.equal((await batch(db, w, "webull", report, "sample.csv", true)).imported, 1);
  assert.equal((await batch(db, w, "webull", report, "sample.csv", true)).duplicate, 1);
  const evidence = {
    account: w,
    date: "2026-10-30",
    cash: { AUD: "7600" },
    positions: [
      { symbol: "A200", quantity: "200" },
      { symbol: "BHP", quantity: "150" },
    ],
    flowsReviewed: true,
  };
  assert.equal(compareStatement(db, evidence).ok, false);
  addManual(db, {
    account: w,
    date: "2026-10-28",
    type: "DEPOSIT",
    currency: "AUD",
    amount: "1000",
    reference: "DEMO-PL-1028",
  });
  compareStatement(db, evidence, true);
  d = await dashboard(db);
  assert.deepEqual([d.total, d.securities, d.cash, d.flows, d.pnl], [128400, 114800, 13600, 1000, 3200]);
  assert.equal((await dashboard(db, { ids: ["demo-ibkr"] })).flows, -1000);
  assert.equal((await dashboard(db, { ids: [w] })).flows, 2000);
  assert.throws(
    () =>
      addManual(db, {
        account: w,
        date: "2026-10-28",
        type: "DEPOSIT",
        currency: "AUD",
        amount: "1000",
        reference: "DEMO-PL-1028",
      }),
    /已经入账/,
  );
  const dest = path.join(dir, "backup.db");
  copyBook(book, dest);
  const restored = createBook(dest);
  try {
    assert.equal((await dashboard(restored)).pnl, 3200);
  } finally {
    restored.close();
  }
});
test("IBKR Flex preview, import and repeat preserve broker identity", async (t) => {
  const { db } = fixture(t);
  await seedDemo(db);
  const r = detailedIbkr(demoXml);
  assert.equal(r.statement.positions.length, 2);
  assert.equal(r.statement.date, "2026-10-30");
  assert.equal((await batch(db, "demo-ibkr", "ibkr", r, "statement.xml", true)).imported, 1);
  assert.equal((await batch(db, "demo-ibkr", "ibkr", r, "statement.xml", true)).duplicate, 1);
  const d = await dashboard(db, { ids: ["demo-ibkr"] });
  assert.equal(d.total, 83700);
  assert.equal(compareStatement(db, { account: "demo-ibkr", ...r.statement }).ok, true);
});
test("an unknown CSV row and changed broker amount remain pending", async (t) => {
  const { db } = fixture(t);
  await seedDemo(db);
  const emptyId = parseWebullCsv(demoCsv.replace("WB-DEMO-173,", " ,"));
  assert.equal(emptyId.unknown.length, 1);
  await batch(db, "demo-webull", "webull", parseWebullCsv(demoCsv), "sample.csv", true);
  const changed = await batch(
    db,
    "demo-webull",
    "webull",
    parseWebullCsv(demoCsv.replace(",10,44.00", ",15,44.00")),
    "correction.csv",
    true,
  );
  assert.equal(changed.unknown.length, 1);
  assert.equal(changed.imported, 0);
});
test("migration leaves original data intact and preserves decimal text, source IDs and preferences", async (t) => {
  const { dir } = fixture(t),
    source = path.join(dir, "wealth.db"),
    dest = path.join(dir, "target.sqlite"),
    s = new DatabaseSync(source);
  s.exec(`CREATE TABLE accounts(id,name,currency,is_active,tracking_mode);INSERT INTO accounts VALUES('a','Broker','AUD',1,'TRANSACTIONS');
    CREATE TABLE activities(id,account_id,activity_type,activity_date,currency,amount,source_record_id,is_user_modified);
    INSERT INTO activities VALUES('ev','a','DEPOSIT','2026-10-01','AUD','1234.567890123456789','broker-id',1);
    CREATE TABLE assets(id,display_code);CREATE TABLE addon_storage(addon_id,key,value);
    INSERT INTO addon_storage VALUES('portfolio-xray','rebalance.v1','{"schemaVersion":1,"tolerance":0.01,"targets":{"strategy:cash":1}}');`);
  s.close();
  const original = fs.readFileSync(source);
  const summary = migrate(source, dest);
  assert.equal(summary.activities, 1);
  assert.equal(summary.allocation, 1);
  const db = createBook(dest);
  try {
    const e = JSON.parse(db.prepare("SELECT data FROM sp_events").get().data);
    assert.equal(e.amount, "1234.567890123456789");
    assert.equal(e.isUserModified, true);
    assert.equal(e.sourceRecordId, "broker-id");
    assert.equal((await dashboard(db)).targets.tolerance, 0.01);
  } finally {
    db.close();
  }
  assert.deepEqual(fs.readFileSync(source), original);
  assert.throws(() => migrate(source, dest), /存在/);
});
test("a matched transfer changes external cash flow only when the scope crosses an account boundary", async (t) => {
  const { db } = fixture(t);
  await seedDemo(db);
  for (const id of ["demo-ibkr", "demo-webull"])
    db.prepare("UPDATE sp_anchors SET day='2026-09-16' WHERE account=?").run(id);
  db.prepare("UPDATE sp_prices SET day='2026-09-16' WHERE day='2026-09-30'").run();
  db.prepare("DELETE FROM sp_prices WHERE day>'2026-09-16'").run();
  const all = await dashboard(db, { date: "2026-10-16" }),
    one = await dashboard(db, { date: "2026-10-16", ids: ["demo-webull"] });
  assert.deepEqual([all.flows, all.pnl, one.flows, one.pnl], [0, 0, 1000, 0]);
});
test("a dual-broker batch rolls back both accounts when the second account is invalid", async (t) => {
  const { db } = fixture(t);
  await seedDemo(db);
  const first = { account: "demo-ibkr", broker: "ibkr", report: detailedIbkr(demoXml), source: "IBKR XML" };
  const second = {
    account: "unknown",
    broker: "webull",
    report: parseWebullCsv(demoCsv),
    source: "Webull CSV",
  };
  await assert.rejects(() => combinedBatch(db, [first, second], true));
  assert.equal((await batch(db, first.account, first.broker, first.report, first.source)).added, 1);
  second.account = "demo-webull";
  assert.equal((await combinedBatch(db, [first, second], true)).imported, 2);
  assert.equal((await combinedBatch(db, [first, second], true)).duplicate, 2);
});
test("manual corrections keep their original identity, evidence and protection against re-import", async (t) => {
  const { db } = fixture(t);
  await seedDemo(db);
  const a = "demo-webull";
  await batch(db, a, "webull", parseWebullCsv(demoCsv), "Webull.csv", true);
  const row = db
    .prepare("SELECT * FROM sp_events WHERE account=? AND json_extract(data,'$.activityType')='BUY'")
    .get(a);
  const args = {
    id: row.id,
    account: a,
    prior: row.data,
    reason: "corrected broker receipt",
    date: "2026-10-27",
    quantity: "12",
    price: "44",
    fee: "0",
  };
  amendEvent(db, args);
  assert.throws(() => amendEvent(db, args), /重新加载/);
  await batch(db, a, "webull", parseWebullCsv(demoCsv), "Webull.csv", true);
  const e = JSON.parse(db.prepare("SELECT data FROM sp_events WHERE id=?").get(row.id).data);
  assert.equal(e.quantity, "12");
  assert.equal(e.sourceRecordId, "WB-DEMO-173");
  assert.equal(e.isUserModified, true);
  assert.equal(db.prepare("SELECT reason FROM sp_corrections WHERE event=?").get(row.id).reason, args.reason);
});
