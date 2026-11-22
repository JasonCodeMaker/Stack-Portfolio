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

test("IBKR enriches a booked fill without changing its cash, uses separate execution and valuation rates, and isolates accounts", async (t) => {
  const { db } = fixture(t);
  const { createAccount, savePrice, saveBrokerValue } = require("../out/ledger.cjs");
  const ib = createAccount(db, "IBKR"), other = createAccount(db, "Other");
  const friday = "2026-11-20", saturday = "2026-11-21";
  const xml = (evidence) => `<FlexStatement fromDate="20261120" toDate="20261120" baseCurrency="AUD"><Trades>
    <Trade assetCategory="STK" symbol="XYZ" listingExchange="NYSE" currency="USD" ibExecID="fill1" tradeID="1"
      buySell="BUY" quantity="2" tradePrice="10" ibCommission="-1" tradeDate="20261120" reportDate="20261120"
      ${evidence ? 'fxRateToBase="1.5" closePrice="12"' : ''}/>
    <Trade assetCategory="CASH" symbol="AUD.USD" currency="USD" ibExecID="fx1" buySell="SELL"
      quantity="-35" tradePrice="0.6" proceeds="21" ibCommission="0" ibCommissionCurrency="AUD" tradeDate="20261120"
      reportDate="20261120" ${evidence ? 'fxRateToBase="1.5" notes="AFx"' : ''}/></Trades>
    ${evidence ? '<ConversionRates><ConversionRate reportDate="20261120" fromCurrency="USD" toCurrency="AUD" rate="1.52"/></ConversionRates>' : ''}
    </FlexStatement>`;
  for (const account of [ib, other]) {
    db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(account, "2026-11-19", "{}", '{"AUD":"0"}');
    addManual(db, { account, date: friday, type: "DEPOSIT", currency: "AUD", amount: 40, reference: "funds" });
  }
  const run = (source, write = false) => batch(db, ib, "ibkr", detailedIbkr(source), "Flex", write);
  await run(xml(false), true);
  const event = () => JSON.parse(db.prepare("SELECT data FROM sp_events WHERE account=? AND json_extract(data,'$.activityType')='BUY'").get(ib).data);
  const old = event();
  // A local annotation and stable ID must survive enrichment of a previously imported row.
  db.prepare("UPDATE sp_events SET data=? WHERE id=?").run(JSON.stringify({ ...old, comment: "local note", isUserModified: true }), old.id);
  savePrice(db, old.assetId, friday, "13", "Yahoo Finance 日收盘", 12);
  savePrice(db, "FX:USD/AUD", friday, "1.6", "YAHOO", 10);
  savePrice(db, "FX:AUD/USD", saturday, "0.625", "Yahoo Finance", 6);
  const view = (id, date = saturday) => dashboard(db, { ids: [id], date });
  assert.equal((await view(ib)).holdings.securities[0].cost, 33.6);
  const preview = await run(xml(true));
  assert.equal(preview.added, 0);
  assert.ok(preview.rows.some(r => r.status === "evidence"));
  assert.equal((await view(ib)).holdings.securities[0].cost, 33.6);
  await run(xml(true), true);
  assert.deepEqual([event().id, event().comment, event().isUserModified], [old.id, "local note", true]);
  assert.deepEqual([event().quantity, event().unitPrice, event().fee], [old.quantity, old.unitPrice, old.fee]);
  const d = await view(ib), h = d.rows.find(r => r.assetId === old.assetId);
  assert.deepEqual([h.rawQuantity, h.costAud, h.audValue, h.gainAud, d.cash], ["2", 31.92, 36.48, 4.56, 5]);
  assert.deepEqual([Number(h.fx), h.fxDate, h.priceUpdatedAt, Number(h.price)], [1.52, friday, friday, 12]);
  assert.match(h.fxSource, /IBKR/);
  const exchange = db.prepare("SELECT data FROM sp_events WHERE account=? AND json_extract(data,'$.activityType')='TRANSFER_OUT'").get(ib);
  assert.equal(JSON.parse(exchange.data).metadata.ibkrExecution.autoFx, true);
  const again = await run(xml(true), true);
  assert.deepEqual([again.imported, again.rows.length, again.priceEdits.length], [0, 0, 0]);
  addManual(db, { account:other, date:friday, type:"BUY", symbol:"XYZ", mic:"XNYS", currency:"USD", quantity:1, price:10, reference:"buy" });
  const second = (await view(other)).rows.find(r=>r.assetId === old.assetId);
  assert.deepEqual([Number(second.fx), Number(second.price), second.costAud], [1.6, 13, 16]);
  saveBrokerValue(db, ib, { date:saturday, base:"AUD", nav:"44", cashTotal:"5", cash:{AUD:"5",USD:"0"},
    positions:[{symbol:"XYZ",mic:"XNYS",currency:"USD",quantity:"2"}], source:"券商账户页面（手工核对）" });
  const reconciled = await view(ib);
  assert.deepEqual([reconciled.total, reconciled.securities, reconciled.itemizedTotal, reconciled.valuationDifference], [44,36.48,41.48,2.52]);
  // A narrower export in a different base must preserve the verified historical AUD receipt.
  await run(xml(true).replace('baseCurrency="AUD"', 'baseCurrency="EUR"').replaceAll('fxRateToBase="1.5"', 'fxRateToBase="0.82"'), true);
  assert.equal(event().metadata.ibkrExecution.fxRateToBase, "1.5");
  assert.equal((await view(ib)).holdings.securities[0].cost, 31.92);
  const conflict = xml(true).replace("</ConversionRates>", '<ConversionRate reportDate="20261120" fromCurrency="USD" toCurrency="AUD" rate="1.55"/></ConversionRates>');
  assert.equal((await run(conflict)).priceWarnings.length, 1);
  assert.equal(Number((await view(ib)).rows.find(r=>r.assetId===old.assetId).fx), 1.52);
  await run(conflict, true);
  assert.equal(Number((await view(ib)).rows.find(r=>r.assetId===old.assetId).fx), 1.5);
  savePrice(db, "FX:USD/AUD", "2026-11-23", "1.62", "Yahoo Finance", 10);
  assert.equal(Number((await view(ib, "2026-11-23")).rows.find(r=>r.assetId===old.assetId).fx),1.62);
});

test("upgrading a book scopes legacy IBKR quotes without sharing them with a second broker", (t) => {
  const { db, book } = fixture(t);
  const { createAccount, savePrice, saveBrokerValue } = require("../out/ledger.cjs");
  const { loadBook, rate } = require("../out/flows.cjs");
  const ib = createAccount(db, "IBKR"), other = createAccount(db, "other broker");
  const date = "2026-11-20";
  saveBrokerValue(db, ib, { source:"IBKR Flex", date, base:"AUD", nav:"10", cash:{AUD:"10"}, positions:[] });
  savePrice(db, "FX:USD/AUD", date, "1.5", "IBKR 结单汇率", 30);
  savePrice(db, "FX:USD/AUD", date, "1.6", "Yahoo Finance", 10);
  db.exec("DROP TABLE sp_broker_prices");
  db.close();
  for (let opening = 0; opening < 2; opening++) {
    const upgraded = createBook(book, key);
    try {
      const loaded = loadBook(upgraded);
      assert.equal(rate(loaded, "USD", date, ib).price, "1.5");
      assert.equal(rate(loaded, "USD", date, other).price, "1.6");
      assert.equal(upgraded.prepare("SELECT count(*) AS n FROM sp_broker_prices").get().n, 1);
    } finally { upgraded.close(); }
  }
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
      view.itemizedTotal,
      view.valuationDifference,
      view.unrealized,
      view.approximatePnl,
    ],
    [32, 12, 22, 34, -2, -3, true],
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

test("dated share evidence reconciles independent fills, retains receipts and never supplies a purchase price", async (t) => {
  const { db } = fixture(t);
  const { createAccount, savePrice } = require("../out/ledger.cjs");
  const { recordHolding } = require("../out/services.cjs");
  const account = createAccount(db, "Broker");
  const on = "2026-10-16";
  const holding = {
    account,
    date: on,
    symbol: "IVV",
    mic: "XASX",
    currency: "AUD",
    quantity: "10",
    reference: "shares-10",
  };
  const asset = recordHolding(db, holding);
  savePrice(db, asset, on, 110, "结单市价");
  const view = () => dashboard(db, { ids: [account], date: on });
  let d = await view();
  assert.equal(d.total, null);
  assert.deepEqual(
    [d.securities, d.cash, d.holdings.gain, d.holdings.securities[0].cost],
    [1100, null, null, null],
  );
  addManual(db, {
    account,
    type: "DEPOSIT",
    date: "2026-10-10",
    currency: "AUD",
    amount: 1000,
    reference: "funds",
  });
  const buy = { ...holding, type: "BUY", date: "2026-10-12", price: "80" };
  addManual(db, { ...buy, quantity: 8, reference: "buy-eight" });
  d = await view();
  const comparison = { account, date: on, cash: { AUD: 360 }, positions: [{ symbol: "IVV", quantity: 10 }] };
  assert.equal(d.holdings.securities[0].quantity, "10");
  assert.equal(d.holdings.securities[0].cost, null);
  assert.equal(d.quantityReports[0].difference, "2");
  assert.equal(compareStatement(db, comparison).rows.find((r) => r.symbol === "IVV").delta, "-2");
  addManual(db, { ...buy, quantity: 2, reference: "buy-two" });
  d = await view();
  assert.equal(d.quantityReports[0].difference, "0");
  assert.deepEqual([d.holdings.securities[0].quantity, d.holdings.gain, d.cash], ["10", 300, 200]);
  assert.ok(compareStatement(db, { ...comparison, cash: { AUD: 200 } }).ok);
  const receipt = {
    ...holding,
    assetId: asset,
    costOnly: true,
    audCost: "810",
    reference: "documented-cost",
  };
  recordHolding(db, receipt);
  recordHolding(db, receipt);
  assert.equal((await view()).holdings.gain, 290);
  assert.equal(db.prepare("SELECT count(*) n FROM sp_holding_evidence").get().n, 2);
  addManual(db, { ...buy, type: "SELL", date: "2026-10-20", quantity: 10, reference: "sell" });
  assert.equal((await dashboard(db)).holdings.securities.length, 0);
  assert.equal((await dashboard(db)).quantityReports[0].reference, "shares-10");
});

test("a foreign holding needs native cost evidence to translate a legacy AUD-only receipt", async (t) => {
  const { db } = fixture(t);
  const { createAccount, savePrice } = require("../out/ledger.cjs");
  const { recordHolding } = require("../out/services.cjs");
  const account = createAccount(db, "Broker");
  const holding = { account, date: "2026-11-19", symbol: "ABC", mic: "XNYS", currency: "USD", quantity: "10" };
  const asset = recordHolding(db, { ...holding, audCost: "140", reference: "historical AUD cost" });
  const date = "2026-11-20";
  savePrice(db, asset, date, 10, "close");
  savePrice(db, "FX:USD/AUD", date, 1.6, "close");
  const view = () => dashboard(db, { ids: [account], date });
  const legacy = (await view()).rows.find(r => r.assetId === asset);
  assert.deepEqual([legacy.audValue, legacy.costAud, legacy.gainAud, legacy.costReceipt.historicalAud],
    [160, undefined, undefined, "140"]);
  recordHolding(db, { ...holding, assetId: asset, localCost: "100", costOnly: true, reference: "USD cost on statement" });
  const d = await view(), row = d.rows.find(r => r.assetId === asset);
  assert.deepEqual([row.costLocal, row.costAud, row.gainAud, row.gainRate, d.holdings.gain], [100, 160, 0, 0, 0]);
});

test("coverage counts securities by listing across accounts and does not net unrelated tickers", async (t) => {
  const { db } = fixture(t);
  const { createAccount, savePrice, resolveAsset, ALLOCATION, putPref } = require("../out/ledger.cjs");
  const { recordHolding } = require("../out/services.cjs");
  const { targetScope } = require("../out/flows.cjs");
  const a = createAccount(db, "IBKR"),
    b = createAccount(db, "Webull"),
    date = "2026-10-16";
  for (const [account, symbol, mic, quantity, cost] of [
    [a, "ONE", "XASX", 8, 480],
    [b, "ONE", "XASX", 2, 120],
    [a, "ONE", "XNYS", 3, 100],
    [b, "IVV", "XASX", 2, null],
  ]) {
    const id = recordHolding(db, {
      account,
      date,
      symbol,
      mic,
      currency: "AUD",
      quantity,
      audCost: cost,
      reference: mic + symbol,
    });
    savePrice(db, id, date, 100, "statement");
  }
  const d = await dashboard(db, { ids: [a, b], date });
  assert.equal(d.holdings.securities.length, 3);
  assert.equal(d.holdings.count, 2);
  assert.equal(d.holdings.gain, 600);
  assert.equal(d.securities, 1500);
  const merged = d.holdings.securities.find((r) => r.ticker === "ONE" && r.mic === "XASX");
  assert.deepEqual([merged.quantity, merged.gain, merged.rowIds.length], ["10", 400, 2]);
  assert.equal((await dashboard(db, { ids: [a, b], date, period: "ytd" })).holdings.gain, 600);
  assert.equal(targetScope(db, [b, a]), ALLOCATION);
  const key = "targets.instruments.v1";
  putPref(
    db,
    ALLOCATION,
    key,
    JSON.stringify({ schemaVersion: 1, tolerance: 0.05, targets: { "mic:XASX:IVV": 0.45 } }),
  );
  const one = await dashboard(db, { ids: [b], date });
  assert.equal(one.globalTargets.instruments.targets["mic:XASX:IVV"], 0.45);
  assert.deepEqual(one.instrumentTargets.targets, {});
});

test("legacy individual targets roll up to stocks and cash for their original account scope", async (t) => {
  const { db } = fixture(t);
  const { ALLOCATION, createAccount } = require("../out/ledger.cjs");
  await seedDemo(db);
  const old = { "mic:ARCX:IVV": 0.45, "mic:XNAS:AAPL": 0.25, "mic:XASX:BHP": 0.10, "cash:AUD": 0.15, "cash:USD": 0.05 };
  putPref(db, ALLOCATION, "targets.instruments.v1", JSON.stringify({ tolerance: 0.02, targets: old }));
  const view = (ids) => dashboard(db, { ids, date: "2026-10-30" });
  const first = await view("all");
  assert.deepEqual(first.targets.targets, { "mic:ARCX:IVV": 0.45, "strategy:individual-stocks": 0.35, "strategy:cash": 0.2 });
  assert.equal(first.targets.tolerance, 0.02);
  assert.deepEqual(first.instrumentTargets.targets, old);
  createAccount(db, "新增账户");
  assert.deepEqual((await view("all")).targets.targets, {});
  assert.deepEqual((await view(first.selected)).targets, first.targets);
});

test("an ambiguous import is confirmed for that broker record and account only", async (t) => {
  const { db } = fixture(t);
  const { createAccount, resolveAsset, rememberListing, listingMatch } = require("../out/ledger.cjs");
  const account = createAccount(db, "IBKR"),
    account2 = createAccount(db, "IBKR 2");
  const ny = resolveAsset(db, { symbol: "ABC", exchangeMic: "XNYS", name: "ABC New York" }, "USD");
  resolveAsset(db, { symbol: "ABC", exchangeMic: "XNAS", name: "ABC Nasdaq" }, "USD");
  const fill = {
    broker: "ibkr",
    brokerRecordId: "trade-123",
    date: "2026-10-16",
    activityType: "BUY",
    currency: "USD",
    symbol: "ABC",
    quantity: 1,
    unitPrice: 80,
  };
  const report = { activities: [fill] };
  const preview = await batch(db, account, "ibkr", report, "Flex");
  assert.equal(preview.choices[0].candidates.length, 2);
  await assert.rejects(batch(db, account, "ibkr", report, "Flex", true), /上市证券/);
  const choice = preview.choices[0];
  rememberListing(db, { ...choice, assetId: ny });
  assert.equal(listingMatch(db, { ...choice, account: account2 }).match, undefined);
  assert.equal(listingMatch(db, { ...choice, source: "webull" }).match, undefined);
  assert.equal(listingMatch(db, { ...choice, record: "another-fill" }).match, undefined);
  assert.equal((await batch(db, account, "ibkr", report, "Flex", true)).imported, 1);
  assert.equal((await batch(db, account, "ibkr", report, "Flex", true)).duplicate, 1);
  assert.equal(JSON.parse(db.prepare("SELECT data FROM sp_events").get().data).assetId, ny);
});

test("a priced security keeps its weight when a confirmed broker NAV covers another unpriced security", async (t) => {
  const { db } = fixture(t);
  const { createAccount, resolveAsset, savePrice } = require("../out/ledger.cjs");
  const account = createAccount(db, "Portfolio"), date = "2026-10-16";
  const ids = ["IVV", "ABC"].map((symbol) => resolveAsset(db, { symbol, exchangeMic:"XASX" }, "AUD"));
  db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(account, date,
    JSON.stringify({[ids[0]]:"10",[ids[1]]:"10"}), JSON.stringify({AUD:"200"}));
  savePrice(db, ids[0], date, 40, "statement");
  db.prepare("INSERT INTO sp_broker_values VALUES(?,?,?,?)").run(account, date, "券商结单",
    JSON.stringify({nav:1000,cash:{AUD:"200"},cashTotal:200,securities:800,
      positions:["IVV","ABC"].map((symbol) => ({symbol,quantity:"10",currency:"AUD",mic:"XASX"}))}));
  const d = await dashboard(db,{ids:[account],date});
  assert.equal(d.portfolio.totalAud,1000);
  assert.equal(d.portfolio.instrumentAllocation.find((r) => r.label === "IVV").weight,0.4);
  assert.equal(d.holdings.securities.find((r) => r.ticker === "ABC").value,null);
});
