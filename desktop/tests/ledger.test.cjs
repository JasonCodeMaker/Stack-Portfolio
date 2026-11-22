const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const { createBook, migrate, putPref, preference } = require("../out/ledger.cjs");
const { encryptedCopy } = require("../bookStorage.cjs");
const key = Buffer.from("raw:" + require("node:crypto").randomBytes(32).toString("hex"));
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
  const db = createBook(book, key);
  t.after(() => {
    if (db.open) db.close();
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
  encryptedCopy(db, dest, key);
  const restored = createBook(dest, key);
  try {
    assert.equal((await dashboard(restored)).pnl, 3200);
  } finally {
    restored.close();
  }
});
test("holdings, allocation and gains use the latest eligible quote, including in pre-fix books", async (t) => {
  const { db } = fixture(t);
  const { createAccount, resolveAsset, savePrice } = require("../out/ledger.cjs");
  const account = createAccount(db, "IBKR", "USD");
  const asset = resolveAsset(db, { symbol: "ORCL", exchangeMic: "XNYS" }, "USD");
  const trade = { account, type: "BUY", currency: "USD", symbol: "ORCL", mic: "XNYS" };
  const friday = "2026-11-20", saturday = "2026-11-21";
  addManual(db, { account, date: friday, type: "DEPOSIT", currency: "USD", amount: 2000, reference: "deposit" });
  addManual(db, { ...trade, date: friday, price: 120, quantity: 8, reference: "first" });
  const fill = { broker: "ibkr", brokerRecordId: "fill-2", date: saturday, activityType: "BUY",
    currency: "USD", symbol: "ORCL", exchangeMic: "XNYS", unitPrice: 107, quantity: 2 };
  await batch(db, account, "ibkr", { activities: [fill] }, "Flex", true);
  savePrice(db, "FX:USD/AUD", friday, "1.5", "结单汇率");
  savePrice(db, asset, friday, "101.19", "Yahoo Finance 日收盘", 12);
  savePrice(db, asset, friday, "105", "Twelve Data", 25);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sp_prices WHERE source='成交价'").get().n, 0);
  // Earlier versions persisted every execution as a quote, even on non-market days.
  savePrice(db, asset, saturday, "107", "成交价", 1);
  savePrice(db, asset, "2026-11-23", "110", "手工报价", 40);
  const view = (date) => dashboard(db, { ids: [account], date });
  const d = await view(saturday);
  const row = d.rows.find((r) => r.assetId === asset);
  assert.deepEqual([row.price, row.quoteSource, row.priceUpdatedAt, row.rawQuantity],
    ["101.19", "Yahoo Finance 日收盘", friday, "10"]);
  assert.deepEqual([row.nativeValue, row.costLocal, row.gainLocal, row.gainAud], [1011.9, 1174, -162.1, -243.15]);
  assert.equal(d.securities, 1517.85);
  assert.equal(d.portfolio.instrumentAllocation.find((r) => r.label === "ORCL").valueAud, d.securities);
  assert.equal((await view("2026-11-23")).rows.find((r) => r.assetId === asset).price, "110");

  db.prepare("DELETE FROM sp_prices WHERE asset=? AND day=? AND source=?").run(asset, friday, "Yahoo Finance 日收盘");
  assert.equal((await view(saturday)).rows.find((r) => r.assetId === asset).price, "105");
  db.prepare("DELETE FROM sp_prices WHERE asset=? AND source=?").run(asset, "Twelve Data");
  const missing = await view(saturday);
  const unquoted = missing.rows.find((r) => r.assetId === asset);
  assert.deepEqual([unquoted.price, unquoted.priceUpdatedAt, unquoted.nativeValue, unquoted.gainAud, missing.securities],
    [null, null, null, undefined, null]);
  assert.equal(unquoted.costLocal, 1174);
});

test("Flex repairs a verified cross-midnight date once without changing the fill or overwriting edits", async (t) => {
  const { db } = fixture(t);
  const { createAccount } = require("../out/ledger.cjs");
  const account = createAccount(db, "IBKR", "USD");
  const xml = `<FlexStatement><Trades><Trade symbol="ORCL" currency="USD" assetCategory="STK"
    listingExchange="NYSE" ibExecID="E1" tradeID="T1" buySell="BUY" quantity="2" tradePrice="107"
    dateTime="20261121;021639" tradeDate="20261120" /></Trades></FlexStatement>`;
  const report = detailedIbkr(xml);
  const old = detailedIbkr(xml.replace('tradeDate="20261120"', ""));
  const apply = (r, commit) => batch(db, account, "ibkr", r, "Flex", commit);
  await apply(old, true);
  const event = () => db.prepare("SELECT id,day,data FROM sp_events WHERE account=?").get(account);
  const before = event();
  const preview = await apply(report, false);
  assert.deepEqual(preview.rows.map((r) => [r.status, r.edits?.map((e) => e.label)]), [["update", ["日期"]]]);
  assert.equal(event().day, "2026-11-21");
  const conflict = await apply(detailedIbkr(xml.replace('tradePrice="107"', 'tradePrice="207"')), false);
  assert.equal(conflict.rows[0].status, "review");
  assert.equal((await apply(report, true)).updated, 1);
  assert.equal((await apply(report, true)).duplicate, 1);
  assert.deepEqual([event().day, event().id], ["2026-11-20", before.id]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sp_corrections WHERE event=?").get(before.id).n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sp_events").get().n, 1);
  const corrected = JSON.parse(event().data);
  assert.deepEqual([corrected.quantity, corrected.unitPrice], ["2", "107"]);
  const other = createAccount(db, "Edited", "USD");
  await batch(db, other, "ibkr", old, "Flex", true);
  const edited = db.prepare("SELECT * FROM sp_events WHERE account=?").get(other);
  amendEvent(db, { account: other, id: edited.id, prior: edited.data, date: edited.day,
    reason: "Broker confirmation", quantity: "2", price: "108", fee: "0" });
  await batch(db, other, "ibkr", report, "Flex", true);
  const kept = db.prepare("SELECT day,data FROM sp_events WHERE id=?").get(edited.id);
  assert.deepEqual([kept.day, JSON.parse(kept.data).unitPrice], ["2026-11-21", "108"]);
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

test("average cost preserves reported fill order across midnight within a Flex trading day", async (t) => {
  const { db } = fixture(t);
  const { createAccount } = require("../out/ledger.cjs");
  const account = createAccount(db, "IBKR", "USD");
  const trades = [
    ["20261120;235500", "BUY", 2, 107], ["20261121;021639", "SELL", 1, 110], ["20261121;031500", "BUY", 1, 99],
  ].map(([time, side, qty, price], i) => `<Trade symbol="ORCL" tradeID="T${i}" currency="USD" assetCategory="STK"
    listingExchange="NYSE" dateTime="${time}" tradeDate="20261120" buySell="${side}" quantity="${qty}" tradePrice="${price}" />`);
  await batch(db, account, "ibkr", detailedIbkr("<FlexStatement>" + trades.join("") + "</FlexStatement>"), "Flex", true);
  const row = (await dashboard(db, { ids: [account], date: "2026-11-20" })).rows.find((r) => r.ticker === "ORCL");
  assert.deepEqual([row.rawQuantity, row.averageCost, row.price], ["2", 103, null]);
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
  assert.deepEqual(changed.rows.map((r) => [r.status, r.symbol, r.quantity, r.unitPrice]), [["review", "BHP", 15, 44]]);
  assert.deepEqual(changed.rows[0].edits.map((e) => [e.label, Number(e.before), Number(e.after)]), [["数量", 10, 15]]);
});

test("preview omits booked rows and keeps new and unresolved records by broker identity", async (t) => {
  const { db } = fixture(t);
  const { createAccount, saveBrokerValue } = require("../out/ledger.cjs");
  const id = createAccount(db, "Flex account");
  const deposit = { broker: "ibkr", brokerRecordId: "wire-a", activityType: "DEPOSIT", date: "2025-04-01", amount: 100, currency: "AUD" };
  const withdrawal = { ...deposit, brokerRecordId: "wire-b", activityType: "WITHDRAWAL", amount: 60 };
  const returned = { ...deposit, brokerRecordId: "wire-c", date: "2025-04-02", amount: 60 };
  const invalid = { ...deposit, brokerRecordId: "", amount: 30 };
  await batch(db, id, "ibkr", { activities: [deposit, withdrawal] }, "Flex", true);
  saveBrokerValue(db, id, {
    date: "2025-04-04", source: "手工结单", base: "AUD", cash: { AUD: "40" }, cashTotal: "40", nav: "40", positions: [],
  });
  db.exec("PRAGMA query_only=ON");
  const result = await batch(db, id, "ibkr", {
    activities: [deposit, returned, withdrawal, invalid], statement: { date: "2025-04-03", cash: {} },
  }, "Flex");
  assert.deepEqual(result.rows.map((r) => [r.type, r.amount, r.status]), [
    ["DEPOSIT", 60, "new"], ["DEPOSIT", 30, "review"],
  ]);
  assert.equal(result.duplicate, 2);
  assert.deepEqual(result.amountEdits, []);
  assert.equal(result.valueChange, null);
  assert.equal(result.previousValue.date, "2025-04-04");
  assert.equal(result.previousValue.nav, "40");
  assert.equal(result.statement.nav, undefined);
  assert.equal(result.prices, 0);
});

test("a revised broker record already booked under the same revision still exposes a changed amount", async (t) => {
  const { db } = fixture(t);
  const { createAccount } = require("../out/ledger.cjs");
  const id = createAccount(db, "Funding");
  const original = { broker: "ibkr", brokerRecordId: "wire-only", importRevision: "cash-v2", activityType: "DEPOSIT",
    date: "2025-03-18", currency: "AUD", amount: 120 };
  await batch(db, id, "ibkr", { activities: [original] }, "Flex", true);
  const same = await batch(db, id, "ibkr", { activities: [original] }, "Flex");
  assert.deepEqual(same.rows, []);
  const changed = await batch(db, id, "ibkr", { activities: [{ ...original, amount: 150 }] }, "Flex");
  assert.equal(changed.rows[0].status, "review");
  assert.deepEqual(changed.rows[0].edits.map((e) => [e.label, Number(e.before), e.after]), [["金额", 120, 150]]);
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
  const summary = migrate(source, dest, key);
  assert.equal(summary.activities, 1);
  assert.equal(summary.allocation, 1);
  const db = createBook(dest, key);
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
  assert.throws(() => migrate(source, dest, key), /存在/);
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

test("a migrated IBKR fill with a local timestamp and booked amount is linked without another cash posting", async (t) => {
  const { db } = fixture(t);
  const { createAccount, resolveAsset, saveEvent } = require("../out/ledger.cjs");
  const { loadBook, positions } = require("../out/flows.cjs");
  const id = createAccount(db, "Test", "AUD");
  const assetId = resolveAsset(db, { symbol: "ABC", exchangeMic: "XASX" }, "AUD");
  const row = {
    broker: "ibkr",
    brokerRecordId: "exec-A",
    activityType: "BUY",
    currency: "AUD",
    symbol: "ABC",
    exchangeMic: "XASX",
    quantity: 2,
    unitPrice: 30,
    fee: 1,
    date: "2025-03-11T01:12:00Z",
    comment: "IBKR Flex trade 91001",
  };
  const old = {
    ...row,
    id: "prior",
    accountId: id,
    date: "2025-03-11T00:00:00Z",
    amount: "60",
    assetId,
    assetSymbol: "ABC",
    sourceSystem: "MANUAL",
    isUserModified: true,
    status: "POSTED",
  };
  saveEvent(db, old, true);
  const report = { activities: [row] };
  const linked = await batch(db, id, "ibkr", report, "Flex");
  assert.equal(linked.added, 0);
  assert.equal(linked.rows[0].status, "link");
  assert.equal((await batch(db, id, "ibkr", report, "Flex", true)).imported, 0);
  saveEvent(db, {
    ...old,
    id: "extra",
    amount: null,
    date: row.date,
    isUserModified: false,
    sourceSystem: "IBKR",
    sourceRecordId: "exec-A",
  });
  const tax = {
    broker: "ibkr",
    brokerRecordId: "tax-A",
    activityType: "TAX",
    date: row.date,
    comment: "ABC CASH DIVIDEND - US TAX",
    amount: 0.5,
    currency: "AUD",
    symbol: "",
    importRevision: "cash-semantics-v2",
  };
  saveEvent(db, { ...tax, id: "levy", accountId: id, sourceSystem: "IBKR", sourceRecordId: "tax-A" }, true);
  saveEvent(
    db,
    { ...tax, id: "legacy-income", accountId: id, activityType: "DIVIDEND", sourceSystem: "MANUAL" },
    true,
  );
  const fresh = { ...row, brokerRecordId: "exec-B", comment: "IBKR Flex trade 91002" };
  const input = { activities: [row, fresh, tax] };
  const before = db.prepare("SELECT data FROM sp_events WHERE id='extra'").get().data;
  const preview = await batch(db, id, "ibkr", input, "Flex");
  assert.equal(preview.repaired, 2);
  assert.equal(db.prepare("SELECT data FROM sp_events WHERE id='extra'").get().data, before);
  const first = await batch(db, id, "ibkr", input, "Flex", true);
  assert.equal(first.imported, 1);
  assert.equal(first.repaired, 2);
  assert.equal((await batch(db, id, "ibkr", input, "Flex", true)).repaired, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM sp_corrections").get().n, 2);
  assert.equal(positions(loadBook(db), { id }, "2025-03-11").cash.get("AUD").toFixed(), "-122.5");
});

test("migrated FX fees are charged once when a legacy cash snapshot included the gross transfer", (t) => {
  const { db } = fixture(t);
  const { createAccount, saveEvent, putPref } = require("../out/ledger.cjs");
  const { loadBook, positions } = require("../out/flows.cjs");
  const id = createAccount(db, "Test", "AUD");
  putPref(db, "app", "migration", "{}");
  const day = "2025-04-23",
    event = { accountId: id, date: day, currency: "AUD", status: "POSTED" };
  saveEvent(db, { ...event, id: "fund", activityType: "DEPOSIT", amount: "100" }, true);
  saveEvent(
    db,
    {
      ...event,
      id: "conversion",
      activityType: "TRANSFER_OUT",
      amount: "20",
      fee: "2",
      metadata: { brokerSync: { broker: "ibkr", recordId: "fx-out" }, flow: { is_external: false }, fx: {} },
    },
    true,
  );
  const get = () => positions(loadBook(db), { id }, day).cash.get("AUD").toFixed();
  const anchor = db.prepare("INSERT OR REPLACE INTO sp_anchors VALUES(?,?,?,?)");
  anchor.run(id, day, "{}", '{"AUD":"80"}');
  assert.equal(get(), "78");
  anchor.run(id, day, "{}", '{"AUD":"78"}');
  assert.equal(get(), "78");
  anchor.run(id, day, "{}", '{"AUD":"300"}');
  assert.equal(get(), "300");
});

test("a dated Webull snapshot values matched local holdings with broker marks even during a duplicate-only sync", async (t) => {
  const { db } = fixture(t);
  const { createAccount, resolveAsset, savePrice } = require("../out/ledger.cjs");
  const { accountSnapshot, loadBook } = require("../out/flows.cjs");
  const id = createAccount(db, "Webull", "AUD"),
    other = createAccount(db, "Other", "AUD"),
    day = "2025-04-23";
  const a = resolveAsset(db, { symbol: "ABC", exchangeMic: "XASX" }, "AUD");
  for (const key of [id, other])
    db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(
      key,
      day,
      JSON.stringify({ [a]: "2" }),
      '{"AUD":"12"}',
    );
  savePrice(db, a, day, "11", "YAHOO", 10);
  const observation = {
    date: day,
    source: "Webull AU",
    base: "AUD",
    cash: { AUD: "12" },
    positions: [{ symbol: "ABC", currency: "AUD", quantity: "2", price: "10" }],
    cashTotal: "12",
    securities: "20",
    nav: "32",
    unrealized: "-3",
  };
  const report = { activities: [], valuation: observation, statement: observation };
  const view = (key) => accountSnapshot(loadBook(db), { id: key, currency: "AUD" }, day);
  const first = await batch(db, id, "webull", report, "Webull", false);
  assert.equal(first.previousValue, null);
  assert.equal(first.valueChange, "value");
  assert.ok(first.amountEdits.some((e) => e.label === "现金余额" && e.before === null && e.after === "12"));
  assert.equal(view(id).total, 34);
  await batch(db, id, "webull", report, "Webull", true);
  assert.equal((await batch(db, id, "webull", report, "Webull")).valueChange, null);
  const again = { ...observation, observedAt: day + "T10:00:00Z" };
  const timeOnly = { activities: [], valuation: again, statement: again };
  assert.equal((await batch(db, id, "webull", timeOnly, "Webull")).valueChange, "time");
  assert.deepEqual((await batch(db, id, "webull", timeOnly, "Webull")).amountEdits, []);
  assert.equal((await batch(db, id, "webull", timeOnly, "Webull", true)).valueChange, "time");
  const stale = { ...again, observedAt: day + "T09:00:00Z" };
  assert.equal((await batch(db, id, "webull", { activities: [], valuation: stale }, "Webull")).valueChange, null);
  const fresh = { ...observation, observedAt: day + "T12:00:00Z", cashTotal: "0", cash: { AUD: "0" }, nav: "20" };
  const updated = await batch(db, id, "webull", { activities: [], valuation: fresh, statement: fresh }, "Webull");
  assert.equal(updated.valueChange, "value");
  assert.equal(updated.previousValue.nav, "32");
  assert.equal(updated.statement.cashTotal, "0");
  assert.deepEqual(updated.amountEdits.map(({ label, before, after }) => [label, before, after]),
    [["账户总额", "32", "20"], ["现金余额", "12", "0"]]);
  const nextDay = { ...again, date: "2025-04-24", cashTotal: "12.000", positions: [{ ...again.positions[0], quantity: "2.0" }] };
  assert.deepEqual((await batch(db, id, "webull", { activities: [], valuation: nextDay }, "Webull")).amountEdits, []);
  const holding = { ...again, observedAt: day + "T13:00:00Z", positions: [{ symbol: "XYZ", currency: "AUD", quantity: "4", price: "5" }] };
  const onlyHoldings = await batch(db, id, "webull", { activities: [], valuation: holding }, "Webull");
  assert.deepEqual(onlyHoldings.amountEdits.map(({ label, before, after }) => [label, before, after]),
    [["ABC 持仓数量", "2", 0], ["XYZ 持仓数量", 0, "4"], ["XYZ 持仓报价", null, "5"]]);
  assert.deepEqual([view(id).cash, view(id).securities, view(id).total], [12, 20, 32]);
  assert.equal(view(other).total, 34);
  db.prepare("UPDATE sp_anchors SET cash=? WHERE account=?").run('{"AUD":"13"}', id);
  assert.notEqual(view(id).total, 32);
});

test("a broker page NAV requires independently matched cash and holdings and keeps approximate P&L separate", (t) => {
  const { db } = fixture(t);
  const { createAccount, resolveAsset, savePrice } = require("../out/ledger.cjs");
  const { recordAccountValue } = require("../out/services.cjs");
  const { loadBook, accountSnapshot } = require("../out/flows.cjs");
  const id = createAccount(db, "Test", "AUD"),
    day = "2025-04-23";
  const assetId = resolveAsset(db, { symbol: "ABC", exchangeMic: "XASX" }, "AUD");
  db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(
    id,
    day,
    JSON.stringify({ [assetId]: "2" }),
    '{"AUD":"12"}',
  );
  savePrice(db, assetId, day, "11", "YAHOO", 10);
  const input = {
    account: id,
    date: day,
    cash: { AUD: "12" },
    positions: [{ symbol: "ABC", quantity: "2", currency: "AUD" }],
    nav: "32",
    unrealized: "-3",
    approximatePnl: true,
  };
  assert.throws(() => recordAccountValue(db, { ...input, cash: { AUD: "13" } }), /核齐/);
  assert.throws(() => recordAccountValue(db, { ...input, positions: [] }), /核齐/);
  recordAccountValue(db, input);
  const view = accountSnapshot(loadBook(db), { id, currency: "AUD" }, day);
  assert.deepEqual(
    [
      view.total,
      view.cash,
      view.securities,
      view.nonCashFromNav,
      view.holdingsEstimate,
      view.unrealized,
      view.approximatePnl,
    ],
    [32, 12, 20, true, 22, -3, true],
  );
  assert.equal(accountSnapshot(loadBook(db), { id, currency: "AUD" }, "2025-04-24").valuationSource, null);
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
