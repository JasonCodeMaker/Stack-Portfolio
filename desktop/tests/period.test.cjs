const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createBook, createAccount, saveEvent } = require("../out/ledger.cjs");
const { resolvePeriod, periodSummary } = require("../out/periodSummary.cjs");
const { dashboard } = require("../out/flows.cjs");
const { portfolioReview } = require("../out/performance.cjs");

function book(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "period-summary-"));
  const db = createBook(path.join(dir, "test.sqlite"), Buffer.from("raw:" + randomBytes(32).toString("hex")));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let count = 0;
  const account = (name, opening, cash) => {
    const id = createAccount(db, name);
    db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(id, opening, "{}", JSON.stringify({ AUD: cash }));
    return id;
  };
  const event = (accountId, date, activityType, amount, extra = {}) =>
    saveEvent(db, { id: "e" + ++count, accountId, date, activityType, currency: "AUD", amount, ...extra });
  return { db, account, event };
}
function near(actual, expected) {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-10, actual + " != " + expected);
}

const range = (to, period, earliest, from) => {
  const r = resolvePeriod({ to, period, earliest, from });
  return [r.from, r.to, r.days];
};

test("presets end on the valuation date and a year runs from the day after the same date last year", () => {
  assert.deepEqual(range("2025-12-31", "ytd"), ["2025-01-01", "2025-12-31", 365]);
  assert.deepEqual(range("2025-12-31", "1y"), ["2025-01-01", "2025-12-31", 365]);
  assert.deepEqual(range("2024-12-31", "1y"), ["2024-01-01", "2024-12-31", 366]);
  assert.deepEqual(range("2025-12-31", "3m"), ["2025-10-01", "2025-12-31", 92]);
  assert.deepEqual(range("2025-05-31", "3m"), ["2025-03-01", "2025-05-31", 92]);
  assert.deepEqual(range("2025-12-17", "mtd"), ["2025-12-01", "2025-12-17", 17]);
  assert.deepEqual(range("2025-12-17", "all", "2023-04-05"), ["2023-04-05", "2025-12-17", 988]);
  assert.deepEqual(range("2025-12-17", undefined, "2023-04-05", "2025-02-03"), ["2025-02-03", "2025-12-17", 318]);
});

test("a period reaching before the first record starts on that record", () => {
  const r = resolvePeriod({ to: "2025-12-31", period: "1y", earliest: "2025-06-10" });
  assert.deepEqual([r.from, r.base, r.requested, r.clipped, r.days], ["2025-06-10", "2025-06-09", "2025-01-01", true, 205]);
  assert.equal(resolvePeriod({ to: "2025-12-31", period: "custom", from: "2025-01-01", earliest: "2025-06-10" }).from, "2025-06-10");
  assert.throws(() => resolvePeriod({ to: "2025-01-01", from: "2025-02-01" }), /起点/);
});

test("a period of a full year has an annualised return and a drawdown with its peak, trough and recovery", (t) => {
  const { db, account, event } = book(t);
  const a = account("A", "2024-01-01", 1000);
  event(a, "2025-03-03", "FEE", 200);
  event(a, "2025-05-01", "INTEREST", 300);
  const summary = (period, to = "2025-12-31") => periodSummary(db, { ids: [a], to, period });
  for (const period of ["ytd", "1y"]) {
    const year = summary(period);
    assert.deepEqual([year.period.from, year.period.to, year.origin], ["2025-01-01", "2025-12-31", "2024-12-31"]);
    near(year.twr, 0.1);
    near(year.annualised, 0.1);
    assert.deepEqual([year.startValue, year.endValue, year.netFlow, year.gain], [1000, 1100, 0, 100]);
    const { depth, peak, trough, recovery } = year.drawdown;
    near(depth, -0.2);
    assert.deepEqual([peak, trough, recovery], ["2025-03-02", "2025-03-03", "2025-05-01"]);
    assert.equal(year.drawdownSeries.length, 366);
    near(year.drawdownSeries.find((p) => p.date === "2025-04-30").drawdown, -0.2);
  }
  near(summary("all").annualised, 1.1 ** (365 / 731) - 1);
  assert.equal(summary("3m").annualised, null);
  // Shorter than three months: the depth and dates remain, the series does not.
  const month = summary("mtd", "2025-03-20");
  near(month.drawdown.depth, -0.2);
  assert.deepEqual([month.drawdown.peak, month.drawdown.trough, month.drawdown.recovery], ["2025-03-02", "2025-03-03", null]);
  assert.equal(month.drawdownSeries, null);
});

test("the overview and the review report the same investment gain and time-weighted return for a period", async (t) => {
  const { db, account, event } = book(t);
  const a = account("A", "2025-01-01", 1000);
  event(a, "2025-02-10", "INTEREST", 50);
  event(a, "2025-03-01", "DEPOSIT", 500);
  event(a, "2025-03-15", "FEE", 30);
  const to = "2025-03-31";
  for (const [period, from] of [["mtd"], ["3m"], ["ytd"], ["1y"], ["all"], [undefined, "2025-02-11"]]) {
    const overview = await dashboard(db, { ids: [a], date: to, period, from });
    const review = portfolioReview(db, { ids: [a], to, period, from });
    assert.equal(overview.pnl, review.money.gain, period || from);
    assert.equal(overview.summary.twr, review.metrics.portfolio.totalReturn, period || from);
    assert.equal(overview.start, review.from);
  }
  // A 5% interest gain, then a fee of 30 on 1,550 after the deposit.
  const year = periodSummary(db, { ids: [a], to, period: "ytd" });
  near(year.twr, 1.05 * (1520 / 1550) - 1);
  assert.deepEqual([year.startValue, year.netFlow, year.gain], [1000, 500, 20]);
});

test("a matched transfer between selected accounts is internal; one account alone sees it as money put in", async (t) => {
  const { db, account, event } = book(t);
  const a = account("A", "2025-02-03", 5000),
    b = account("B", "2025-02-03", 500);
  event(a, "2025-02-05", "TRANSFER_OUT", 1000, { group: "pair" });
  event(b, "2025-02-05", "TRANSFER_IN", 1000, { group: "pair" });
  const range = { to: "2025-02-06", from: "2025-02-04" };
  for (const [ids, flow] of [[[a, b], 0], [[b], 1000], [[a], -1000]]) {
    const s = periodSummary(db, { ids, ...range });
    assert.deepEqual([s.netFlow, s.gain, s.twr], [flow, 0, 0], ids.join());
    const d = await dashboard(db, { ids, date: range.to, from: range.from });
    assert.deepEqual([d.flows, d.pnl], [flow, 0]);
  }
});
