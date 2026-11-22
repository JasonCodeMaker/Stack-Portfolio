const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createBook, createAccount, saveEvent, savePrice, resolveAsset } = require("../out/ledger.cjs");
const { dashboard } = require("../out/flows.cjs");
const { portfolioReview } = require("../out/performance.cjs");

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
