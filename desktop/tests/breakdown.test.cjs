const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createBook, createAccount, saveEvent, savePrice, resolveAsset } = require("../out/ledger.cjs");
const { dashboard } = require("../out/flows.cjs");
const { portfolioReview } = require("../out/performance.cjs");
const { seedDemo, demoDay } = require("../out/demo.cjs");

const monday = "2025-02-03",
  tuesday = "2025-02-04",
  wednesday = "2025-02-05",
  thursday = "2025-02-06",
  friday = "2025-02-07";

function book(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-breakdown-"));
  const db = createBook(path.join(dir, "test.sqlite"), Buffer.from("raw:" + randomBytes(32).toString("hex")));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let count = 0;
  const account = (name, opening, cash = {}, holdings = {}) => {
    const id = createAccount(db, name);
    if (opening)
      db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(id, opening, JSON.stringify(holdings), JSON.stringify(cash));
    return id;
  };
  const event = (accountId, date, activityType, amount, extra = {}) =>
    saveEvent(db, { id: "e" + ++count, accountId, date, activityType, currency: "AUD", amount, ...extra });
  const stock = (symbol, currency = "AUD", mic = currency === "AUD" ? "XASX" : "XNAS") =>
    resolveAsset(db, { symbol, exchangeMic: mic }, currency);
  const close = (asset, date, price) => savePrice(db, asset, date, price, "statement");
  return { db, account, event, stock, close };
}
function near(actual, expected, tolerance = 1e-9) {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) < tolerance, actual + " != " + expected);
}
const sum = (parts) => Object.values(parts).reduce((a, b) => a + b, 0);
const row = (item, label) => item.rows.find((r) => r.label === label)?.value;

test("a share bought at A$40, worth A$100 at the period start and sold at A$110 realises +70 and gives back −60 unrealised", async (t) => {
  const { db, account, event, stock, close } = book(t);
  const a = account("A", "2025-02-02", { AUD: 40 });
  const abc = stock("ABC");
  event(a, monday, "BUY", null, { assetId: abc, quantity: "1", unitPrice: "40", fee: "0" });
  close(abc, monday, 40);
  close(abc, tuesday, 100);
  event(a, wednesday, "SELL", null, { assetId: abc, quantity: "1", unitPrice: "110", fee: "0" });
  close(abc, wednesday, 110);
  const review = portfolioReview(db, { ids: [a], from: wednesday, to: thursday });
  const { parts } = review.breakdown;
  near(parts.realised, 70);
  near(parts.unrealised, -60);
  near(parts.income, 0);
  near(parts.fees, 0);
  near(parts.fx, 0);
  near(review.money.gain, 10);
  const realised = review.breakdown.items.find((i) => i.key === "realised");
  assert.equal(realised.label, "已实现");
  near(row(realised, "ABC"), 70);
  // The overview states the same breakdown for the same period.
  const overview = await dashboard(db, { ids: [a], date: thursday, from: wednesday });
  assert.deepEqual(overview.breakdown, review.breakdown);
});

test("under 全部 the breakdown's realised gain exceeds the holdings' cumulative realised gain by exactly the trading fees", async (t) => {
  const { db, account, event, stock, close } = book(t);
  const a = account("A");
  const abc = stock("ABC"),
    ghi = stock("GHI");
  event(a, monday, "DEPOSIT", 1000);
  event(a, monday, "BUY", null, { assetId: abc, quantity: "10", unitPrice: "20", fee: "5" });
  event(a, monday, "BUY", null, { assetId: ghi, quantity: "5", unitPrice: "10", fee: "2" });
  event(a, tuesday, "SELL", null, { assetId: abc, quantity: "10", unitPrice: "25", fee: "5" });
  event(a, wednesday, "DIVIDEND", 3, { assetId: ghi, tax: "0.5" });
  for (const [date, p] of [
    [monday, 20],
    [tuesday, 25],
  ])
    close(abc, date, p);
  for (const [date, p] of [
    [monday, 10],
    [wednesday, 11],
  ])
    close(ghi, date, p);
  const d = await dashboard(db, { ids: [a], date: wednesday, period: "all" });
  near(d.breakdown.parts.realised, 10 * (25 - 20));
  const holdings = d.byAccount[0];
  near(holdings.cumulative.realised, 250 - 5 - (200 + 5));
  near(d.breakdown.parts.realised - holdings.cumulative.realised, 5 + 5);
  // ABC is sold out; GHI is still held and has its dividend net of tax.
  const held = holdings.rows.find((r) => r.ticker === "GHI");
  assert.deepEqual([held.realised, held.dividends], [0, 2.5]);
  assert.deepEqual(
    holdings.cumulative.closed.map((r) => [r.symbol, r.realised, r.dividends]),
    [["ABC", 40, 0]],
  );
  near(holdings.cumulative.dividends, 2.5);
  const merged = d.holdings.securities.find((s) => s.ticker === "GHI");
  assert.deepEqual([merged.realised, merged.dividends], [0, 2.5]);
});

test("cumulative realised gain counts opening holdings with a recorded cost but not transfers in without one", async (t) => {
  const { db, account, event, stock, close } = book(t);
  const abc = stock("ABC"),
    jkl = stock("JKL");
  const a = account("A", monday, { AUD: 0 }, { [abc]: "10" });
  db.prepare(
    "INSERT INTO sp_holding_evidence(account,asset,day,quantity,reported,local_cost,aud_cost,reference) VALUES(?,?,?,?,?,?,?,?)",
  ).run(a, abc, monday, "10", 0, "150", null, "补成本");
  event(a, tuesday, "SELL", null, { assetId: abc, quantity: "4", unitPrice: "20", fee: "0" });
  event(a, tuesday, "TRANSFER_IN", 0, { assetId: jkl, quantity: "4" });
  event(a, wednesday, "SELL", null, { assetId: jkl, quantity: "2", unitPrice: "12", fee: "0" });
  for (const date of [monday, tuesday, wednesday]) {
    close(abc, date, 20);
    close(jkl, date, 10);
  }
  const d = await dashboard(db, { ids: [a], date: wednesday, period: "all" });
  const rows = d.byAccount[0].rows;
  near(rows.find((r) => r.ticker === "ABC").realised, 4 * (20 - 15));
  assert.equal(rows.find((r) => r.ticker === "JKL").realised, 0);
  // The breakdown values JKL at its first close instead, so the identity still holds.
  near(d.breakdown.parts.realised, 4 * (20 - 15) + 2 * (12 - 10));
  near(sum(d.breakdown.parts), d.pnl);
});

function mixedBook(t) {
  const b = book(t);
  const { account, event, stock, close } = b;
  const abc = stock("ABC"),
    xyz = stock("XYZ", "USD"),
    def = stock("DEF");
  // ABC is carried in by the opening balance without a cost.
  const a = account("A", monday, { AUD: 5000, USD: 1000 }, { [abc]: "10" });
  const usd = { currency: "USD" };
  event(a, tuesday, "BUY", null, { ...usd, assetId: xyz, quantity: "5", unitPrice: "105", fee: "1" });
  event(a, wednesday, "DIVIDEND", 10, { ...usd, assetId: xyz, tax: "1.5" });
  event(a, wednesday, "INTEREST", 3);
  event(a, wednesday, "TRANSFER_IN", 0, { assetId: def, quantity: "10", unitPrice: "5" });
  event(a, thursday, "SELL", null, { ...usd, assetId: xyz, quantity: "2", unitPrice: "108", fee: "1" });
  event(a, thursday, "FEE", 4, { ...usd, comment: "USD Debit Interest for Jan-2025" });
  event(a, thursday, "TAX", 0.5, { ...usd, comment: "XYZ(US0000000001) Cash Dividend USD 2 per Share - US Tax" });
  event(a, thursday, "FEE", 2, { comment: "Account fee" });
  event(a, thursday, "TAX", 0.3, { comment: "Transaction tax" });
  event(a, thursday, "DEPOSIT", 1000);
  event(a, friday, "WITHDRAWAL", 200);
  const closes = {
    [abc]: [20, 21, 19, 22, 23],
    [xyz]: [null, 105, 110, 108, 112],
    [def]: [null, null, 8, 8.5, 9],
    "FX:USD/AUD": [1.5, 1.6, 1.55, 1.4, 1.45],
  };
  for (const [asset, prices] of Object.entries(closes))
    prices.forEach((p, i) => p != null && close(asset, [monday, tuesday, wednesday, thursday, friday][i], p));
  return { ...b, a, abc, xyz, def };
}

test("dividends net of withholding, cash and borrowing interest, all fees and foreign holdings fill the five parts", (t) => {
  const { db, a } = mixedBook(t);
  const { breakdown, money } = portfolioReview(db, { ids: [a], from: wednesday, to: friday });
  const { parts } = breakdown;
  near(parts.income, (10 - 1.5) * 1.55 + 3 - 4 * 1.4 - 0.5 * 1.4);
  near(parts.fees, -1 * 1.4 - 2 - 0.3);
  // Two XYZ sold at US$108 against an average cost of US$105 before fees, at the sale-day rate.
  near(parts.realised, 2 * 3 * 1.4);
  // ABC is costed at its first close; DEF arrives with its own cost and gains only after it arrived.
  near(parts.unrealised, 10 * (23 - 20) - 10 * (21 - 20) + 3 * (112 - 105) * 1.45 + 10 * (9 - 8));
  near(sum(parts), money.gain);
  const income = breakdown.items.find((i) => i.key === "income");
  near(row(income, "XYZ"), (10 - 1.5) * 1.55 - 0.5 * 1.4);
  near(row(income, "现金利息"), 3);
  near(row(income, "借款利息"), -4 * 1.4);
  const fees = breakdown.items.find((i) => i.key === "fees");
  assert.deepEqual(fees.rows.map((r) => r.label).sort(), ["XYZ", "交易税", "账户费用"].sort());
  const fx = breakdown.items.find((i) => i.key === "fx");
  assert.ok(fx.rows.some((r) => r.label === "外币现金"));
});

test("the five parts add up to the period investment gain for every period", async (t) => {
  const { db, a } = mixedBook(t);
  for (const [from, to] of [
    [tuesday, friday],
    [wednesday, thursday],
    [thursday, friday],
    [friday, friday],
    [monday, wednesday],
  ]) {
    const review = portfolioReview(db, { ids: [a], from, to });
    near(sum(review.breakdown.parts), review.money.gain);
    for (const item of review.breakdown.items) {
      near(item.value, item.rows.reduce((n, r) => n + r.value, 0), 0.01);
      near(item.value, review.breakdown.parts[item.key]);
    }
  }
  for (const period of ["mtd", "ytd", "all"]) {
    const overview = await dashboard(db, { ids: [a], date: friday, period });
    near(sum(overview.breakdown.parts), overview.pnl);
  }
});

test("a security moved between the selected accounts keeps its cost and adds no unrealised change", (t) => {
  const { db, account, event, stock, close } = book(t);
  const abc = stock("ABC");
  const a = account("A", "2025-02-02", { AUD: 100 }),
    b = account("B", "2025-02-02", { AUD: 0 });
  event(a, monday, "BUY", null, { assetId: abc, quantity: "5", unitPrice: "20", fee: "0" });
  event(a, wednesday, "TRANSFER_OUT", 0, { assetId: abc, quantity: "5", group: "move" });
  event(b, wednesday, "TRANSFER_IN", 0, { accountId: b, assetId: abc, quantity: "5", unitPrice: "30", group: "move" });
  for (const [date, p] of [
    [monday, 20],
    [tuesday, 22],
    [wednesday, 25],
    [thursday, 26],
  ])
    close(abc, date, p);
  const { breakdown, money } = portfolioReview(db, { ids: [a, b], from: wednesday, to: thursday });
  near(money.gain, 5 * (26 - 22));
  near(breakdown.parts.unrealised, 5 * (26 - 22));
  near(breakdown.parts.fx, 0);
});

test("the sample book's breakdown adds up to the same gain on the overview and the review", async (t) => {
  const { db } = book(t);
  await seedDemo(db);
  const ids = ["demo-ibkr", "demo-webull"];
  for (const period of ["mtd", "3m", "all"]) {
    const overview = await dashboard(db, { ids, date: demoDay, period });
    const review = portfolioReview(db, { ids, to: demoDay, period });
    assert.equal(typeof overview.pnl, "number");
    near(sum(overview.breakdown.parts), overview.pnl, 1e-6);
    assert.deepEqual(review.breakdown, overview.breakdown);
  }
});
