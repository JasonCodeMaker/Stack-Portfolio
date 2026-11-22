const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createBook, createAccount, saveEvent, savePrice, resolveAsset } = require("../out/ledger.cjs");
const { dashboard } = require("../out/flows.cjs");
const { seedDemo, demoDay } = require("../out/demo.cjs");

function near(actual, expected, label = "") {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-9, label + " " + actual + " != " + expected);
}
const sum = (values) => values.reduce((n, v) => n + v, 0);

// Two accounts from Monday 2025-02-03: A holds AUD cash and an ASX stock, B holds USD cash and a
// US stock. B receives a USD dividend on Wednesday, A a deposit on Thursday, A pays B A$500 on
// Friday through a matched transfer, and A pays a A$10 fee on Saturday.
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "today-change-"));
  const db = createBook(path.join(dir, "test.sqlite"), Buffer.from("raw:" + randomBytes(32).toString("hex")));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const a = createAccount(db, "A"),
    b = createAccount(db, "B");
  const asx = resolveAsset(db, { symbol: "XYZ", exchangeMic: "XASX" }, "AUD"),
    us = resolveAsset(db, { symbol: "ABC", exchangeMic: "XNAS" }, "USD");
  const anchor = db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)");
  anchor.run(a, "2025-02-03", JSON.stringify({ [asx]: 100 }), JSON.stringify({ AUD: 10000 }));
  anchor.run(b, "2025-02-03", JSON.stringify({ [us]: 10 }), JSON.stringify({ USD: 1000 }));
  let count = 0;
  const event = (accountId, date, activityType, amount, extra = {}) =>
    saveEvent(db, { id: "e" + ++count, accountId, date, activityType, currency: "AUD", amount, ...extra });
  event(b, "2025-02-05", "DIVIDEND", 20, { currency: "USD", assetId: us });
  event(a, "2025-02-06", "DEPOSIT", 1000);
  event(a, "2025-02-07", "TRANSFER_OUT", 500, { group: "pair" });
  event(b, "2025-02-07", "TRANSFER_IN", 500, { group: "pair" });
  event(a, "2025-02-08", "FEE", 10);
  for (const [date, xyz, abc, fx] of [
    ["2025-02-03", 20, 100, 1.5],
    ["2025-02-04", 21, 102, 1.5],
    ["2025-02-05", 21, 101, 1.6],
    ["2025-02-06", 22, 100, 1.6],
    ["2025-02-07", 21, 110, 1.5],
    ["2025-02-10", 23, 111, 1.5],
    ["2025-02-11", 23, 112, 1.55],
  ]) {
    savePrice(db, asx, date, xyz, "close");
    savePrice(db, us, date, abc, "close");
    savePrice(db, "FX:USD/AUD", date, fx, "close");
  }
  return { db, a, b, asx, us, ids: [a, b] };
}

test("on a Sunday the daily change is Friday's, net of the matched transfer, and adds up across accounts and securities", async (t) => {
  const { db, a, b, ids } = fixture(t);
  const d = await dashboard(db, { ids, date: "2025-02-09", period: "mtd" });
  const today = d.today;
  assert.deepEqual([today.date, today.previous], ["2025-02-07", "2025-02-06"]);
  // Thursday 16,432 (A 11,000 + 100 × 22; B USD 1,020 + 10 × 100 at 1.6); Friday 16,280.
  assert.deepEqual([today.startValue, today.endValue, today.flow], [16432, 16280, 0]);
  near(today.change, -152);
  near(today.twr, 16280 / 16432 - 1);
  const byId = Object.fromEntries(d.byAccount.map((v) => [v.id, v.today]));
  // The transfer is money out of A and into B when each account is seen alone.
  near(byId[a].change, -100);
  near(byId[b].change, -52);
  assert.deepEqual([byId[a].flow, byId[b].flow], [-500, 500]);
  near(sum(d.byAccount.map((v) => v.today.change)), today.change);
  // Securities plus account-level items (here the USD cash rate move) add up to the portfolio.
  const row = (label) => today.securities.find((r) => r.label === label);
  near(row("XYZ").change, -100);
  near(row("ABC").change, 50);
  near(row("USD 现金汇率变动").change, -102);
  assert.equal(row("USD 现金汇率变动").kind, "account");
  near(sum(today.securities.map((r) => r.change)), today.change);
});

test("a US stock's 涨跌幅 is its USD price change while its amount is the AUD change on the net-value basis", async (t) => {
  const { db, b, ids } = fixture(t);
  const d = await dashboard(db, { ids, date: "2025-02-07", period: "mtd" });
  // USD 100 → 110 is +10%; in AUD 10 × 100 × 1.6 = 1,600 → 10 × 110 × 1.5 = 1,650, i.e. +A$50.
  const security = d.holdings.securities.find((s) => s.ticker === "ABC");
  near(security.today.change, 50);
  assert.deepEqual(security.today.priceChange, {
    date: "2025-02-07",
    previous: "2025-02-06",
    close: 110,
    previousClose: 100,
    change: 0.1,
  });
  const row = d.byAccount.find((v) => v.id === b).rows.find((r) => r.ticker === "ABC");
  near(row.today.change, 50);
  near(row.today.priceChange.change, 0.1);
  // An ASX stock compares with the previous ASX session: Thursday 22 → Friday 21.
  const asx = d.holdings.securities.find((s) => s.ticker === "XYZ");
  near(asx.today.priceChange.change, 21 / 22 - 1);
  near(asx.today.change, -100);
});

test("daily changes over a period add up to its investment gain and chain to its time-weighted return", async (t) => {
  const { db, ids } = fixture(t);
  let total = 0,
    growth = 1;
  const seen = [];
  for (const date of ["2025-02-04", "2025-02-05", "2025-02-06", "2025-02-07", "2025-02-10", "2025-02-11"]) {
    const { today } = await dashboard(db, { ids, date, period: "mtd" });
    assert.equal(today.date, date);
    seen.push(today.previous);
    total += today.change;
    growth *= 1 + today.twr;
  }
  // Monday's change runs from Friday's close, so it carries Saturday's A$10 fee.
  assert.deepEqual(seen, ["2025-02-03", "2025-02-04", "2025-02-05", "2025-02-06", "2025-02-07", "2025-02-10"]);
  const period = await dashboard(db, { ids, date: "2025-02-11", from: "2025-02-04" });
  near(total, period.pnl);
  near(growth - 1, period.summary.twr);
  const monday = await dashboard(db, { ids, date: "2025-02-10", period: "mtd" });
  // XYZ +200 and ABC 10 × (111 − 110) × 1.5 = +15, less the fee.
  near(monday.today.change, 205);
  near(monday.today.securities.find((r) => r.label === "XYZ").change, 200);
});

test("before every listing has closed, the daily change stays on the latest close valued on its own data", async (t) => {
  const { db, asx, ids } = fixture(t);
  // Wednesday's ASX close and rate are in; the US close is not yet.
  savePrice(db, asx, "2025-02-12", 24, "close");
  savePrice(db, "FX:USD/AUD", "2025-02-12", 1.55, "close");
  const { today } = await dashboard(db, { ids, date: "2025-02-12", period: "mtd" });
  assert.deepEqual([today.date, today.previous], ["2025-02-11", "2025-02-10"]);
});

test("company tiles use dated closes from direct or unambiguously known listings", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "today-company-"));
  const db = createBook(path.join(dir, "test.sqlite"), Buffer.from("raw:" + randomBytes(32).toString("hex")));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await seedDemo(db);
  const d = await dashboard(db, { ids: ["demo-ibkr", "demo-webull"], date: demoDay, period: "mtd" });
  const company = (ticker) => d.exposure.rows.find((r) => r.ticker === ticker);
  const aapl = company("AAPL");
  // Apple is held directly and through IVV; Microsoft only through IVV.
  assert.deepEqual(
    [aapl.sources.some((s) => s.kind === "direct"), company("MSFT").sources.map((s) => s.kind)],
    [true, ["etf"]],
  );
  const listing = d.holdings.securities.find((s) => s.ticker === "AAPL").today.priceChange;
  assert.equal(listing.date, d.today.date);
  assert.equal(d.today.companies[aapl.key], listing.change);
  assert.equal(d.today.companies[company("MSFT").key], null);
  // The amounts of the security rows and account items still add up to the portfolio.
  near(sum(d.today.securities.map((r) => r.change)), d.today.change);
  near(sum(d.byAccount.map((v) => v.today.change)), d.today.change);

  const funds = createAccount(db, "ETF-only account");
  db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(funds, "2026-10-27", '{"ivv":"100"}', "{}");
  const otherMarket = resolveAsset(db, { symbol: "AAPL", exchangeMic: "XASX" }, "AUD");
  savePrice(db, otherMarket, "2026-10-27", 100, "close");
  savePrice(db, otherMarket, demoDay, 200, "close");
  const indirect = await dashboard(db, { ids: [funds], date: demoDay, period: "mtd" });
  assert.equal(indirect.exposure.rows.find((r) => r.key === aapl.key).directAud, 0);
  assert.equal(indirect.today.companies[aapl.key], listing.change);
  assert.equal(indirect.today.companies[company("MSFT").key], null);

  const otherListing = resolveAsset(db, { symbol: "AAPL", exchangeMic: "XNYS" }, "USD");
  savePrice(db, otherListing, "2026-10-27", 100, "close");
  savePrice(db, otherListing, demoDay, 200, "close");
  const ambiguous = await dashboard(db, { ids: [funds], date: demoDay, period: "mtd" });
  assert.equal(ambiguous.today.companies[aapl.key], null);
});
