const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createAccount, createBook, resolveAsset, savePrice, saveBrokerValue } = require("../out/ledger.cjs");
const { dashboard } = require("../out/flows.cjs");
const { marketCloseTime, marketSession, marketTime } = require("../out/marketDays.cjs");
const { refreshCloses } = require("../out/reviewMarket.cjs");

const time = (value) => Date.parse(value);
const now = time("2026-11-23T09:22:00Z");
const prior = "2026-11-20";
const monday = "2026-11-23";
const fx = { id: "FX:USD/AUD" };
const response = (value, status = 200) => ({ status, body: JSON.stringify(value) });

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-live-"));
  const db = createBook(path.join(directory, "book.sqlite"), Buffer.from("raw:" + randomBytes(32).toString("hex")));
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const a = createAccount(db, "Australia", "AUD"), b = createAccount(db, "US", "USD");
  function asset(mic, currency) {
    const id = resolveAsset(db, { symbol: "IVV", name: "iShares", exchangeMic: mic, kind: "ETF" }, currency);
    return db.prepare("SELECT * FROM sp_assets WHERE id=?").get(id);
  }
  const au = asset("XASX", "AUD"), us = asset("ARCX", "USD");
  const anchor = db.prepare("INSERT INTO sp_anchors VALUES (?,?,?,?)");
  anchor.run(a, "2026-11-19", JSON.stringify({ [au.id]: 50 }), "{}");
  anchor.run(b, "2026-11-19", JSON.stringify({ [us.id]: 10 }), '{"USD":"200"}');
  for (const date of ["2026-11-19", prior]) {
    savePrice(db, au.id, date, "71.33", "close");
    savePrice(db, us.id, date, "100", "close");
    savePrice(db, fx.id, date, "1.50", "close");
  }
  return { db, a, b, au, us };
}

test("market-local sessions distinguish the ASX auction, US premarket, DST and an early close", () => {
  assert.equal(marketSession(time("2026-11-23T05:08Z"), "ASX").phase, "auction");
  assert.equal(marketSession(time("2026-11-23T05:11Z"), "ASX").completed, monday);
  assert.equal(marketSession(time("2026-11-23T08:59Z"), "US").phase, "closed");
  assert.equal(marketSession(time("2026-11-23T09:00Z"), "US").phase, "pre");
  assert.equal(marketSession(time("2026-07-06T08:00Z"), "US").phase, "pre");
  assert.equal(marketTime(time("2026-11-23T14:30Z")).date, "2026-11-24");
  assert.equal(marketSession(time("2026-11-23T14:30Z"), "US").date, monday);
  assert.equal(marketSession(time("2026-11-26T18:00Z"), "US").phase, "closed");
  assert.equal(marketSession(time("2026-11-27T18:00Z"), "US").phase, "post");
  assert.deepEqual(marketTime(marketCloseTime("2026-07-06", "US")), { date: "2026-07-07", minute: 360 });
  assert.deepEqual(marketTime(marketCloseTime("2026-11-27", "US")), { date: "2026-11-28", minute: 240 });
});

test("latest closes and daily FX determine current valuation while old intraday prices stay out", async (t) => {
  const { db, a, b, au, us } = fixture(t);
  const options = { ids: [a, b], period: "mtd", current: true, now };
  let data = await dashboard(db, options);
  assert.equal(data.rows.find((r) => r.assetId === au.id).marketQuote.status, "awaiting-close");
  savePrice(db, au.id, monday, "70.89", "close");
  saveBrokerValue(db, b, {
    date: monday, source: "Webull AU", base: "AUD", cash: { USD: 200 }, nav: 1190,
    positions: [{ symbol: "IVV", mic: "ARCX", currency: "USD", quantity: 10, price: 99 }],
  });
  savePrice(db, us.id, monday, "104", "Twelve Data");
  savePrice(db, fx.id, monday, "1.52", "Twelve Data");
  data = await dashboard(db, options);
  const asx = data.rows.find((r) => r.assetId === au.id), american = data.rows.find((r) => r.assetId === us.id);
  assert.deepEqual([asx.price, asx.marketQuote.day, asx.marketQuote.status, asx.quoteChange.amount], ["70.89", monday, "close", -22]);
  assert.deepEqual([american.price, american.marketQuote.day, american.fx], ["100", prior, "1.5"]);
  assert.equal(data.today.date, prior);
  assert.equal(data.valuation.total, 5344.5);
  assert.equal(data.currentMarket.recentCloseChange.total, -22);
  assert.equal(data.currentMarket.fx.impact, 0);
  assert.equal(data.currentMarket.fx.accounts.find((r) => r.id === b).holdingsImpact, 0);
  assert.equal(data.currentMarket.fx.accounts.find((r) => r.id === b).cashImpact, 0);
  assert.equal(data.currentMarket.fx.accounts.find((r) => r.id === a).impact, 0);
  assert.equal(data.currentMarket.fx.quote.day, prior);
  const dated = await dashboard(db, { ...options, date: prior });
  assert.equal(dated.valuation.total, 5366.5);
  assert.equal(dated.currentMarket, null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sp_prices WHERE day=?").get(monday).count, 3);
});

test("on 24 November in Brisbane each market uses its own latest close and daily FX is included once", async (t) => {
  const { db, a, b, au, us } = fixture(t);
  const tuesday = "2026-11-24";
  savePrice(db, au.id, monday, "70.89", "close");
  savePrice(db, us.id, monday, "104", "close");
  savePrice(db, fx.id, monday, "1.52", "close");
  savePrice(db, au.id, tuesday, "72", "close");

  const options = { ids: [a, b], period: "mtd", current: true, now: time("2026-11-24T11:09:00Z") };
  const data = await dashboard(db, options);
  const aud = data.byAccount.find(({ id }) => id === a).recentCloseChange;
  const usd = data.byAccount.find(({ id }) => id === b).recentCloseChange;
  assert.deepEqual([aud.price, aud.fx, aud.total], [55.5, 0, 55.5]);
  assert.deepEqual([usd.price, usd.fx, usd.total], [60, 24.8, 84.8]);
  assert.deepEqual(aud.closes, [{ market: "ASX", day: tuesday, at: time("2026-11-24T05:11Z") }]);
  assert.deepEqual(usd.closes, [{ market: "US", day: monday, at: time("2026-11-23T21:00Z") }]);
  assert.equal(data.currentMarket.recentCloseChange.total, 140.3);
  assert.equal(data.currentMarket.fx.date, prior);
  assert.equal(data.currentMarket.fx.quote.day, monday);
  assert.equal(data.currentMarket.fx.impact, 24.8);
  assert.equal(data.fx.exposureUsd, 1240);
  assert.equal(data.fx.sensitivity, 18.848);
  assert.ok(Math.abs(data.fx.exposureShare - 1884.8 / data.valuation.total) < 1e-12);
  assert.ok(Math.abs(data.fx.periodRateChange - (1.52 / 1.50 - 1)) < 1e-12);
  assert.equal(data.fx.accounts.find((r) => r.id === a).periodGain, 0);
  assert.equal(data.fx.accounts.find((r) => r.id === b).periodGain, data.breakdown.parts.fx);
  assert.equal(data.holdings.securities.find((s) => s.localCurrency === "USD").recentCloseChange, 80.8);
  const historical = await dashboard(db, { ...options, date: prior, period: "1d" });
  assert.equal(historical.currentMarket, null);
  assert.deepEqual([historical.fx.exposureUsd, historical.fx.sensitivity, historical.fx.periodRateChange,
    historical.fx.impact, historical.fx.quote.day], [1200, 18, 0, 0, prior]);
  assert.equal(data.today.date, monday);

  const onlyAud = await dashboard(db, { ...options, ids: [a] });
  assert.equal(onlyAud.currentMarket.recentCloseChange.total, 55.5);
  assert.equal(onlyAud.currentMarket.fx.impact, 0);
});

test("native USD exposure remains known without an AUD conversion rate", async (t) => {
  const { db, b } = fixture(t);
  db.prepare("DELETE FROM sp_prices WHERE asset=?").run(fx.id);
  for (const options of [{ date: prior }, { current: true, now }]) {
    const data = await dashboard(db, { ids: [b], ...options });
    assert.deepEqual([data.fx.accounts[0].cash, data.fx.exposureUsd, data.fx.exposureShare, data.fx.sensitivity],
      [200, 1200, null, null]);
  }
});

test("a missing prior close leaves the stock move pending while a daily FX move is still visible", async (t) => {
  const { db, b, us } = fixture(t);
  db.prepare("DELETE FROM sp_prices WHERE asset=? AND day=?").run(us.id, prior);
  savePrice(db, us.id, monday, "104", "close");
  savePrice(db, fx.id, monday, "1.52", "close");
  const data = await dashboard(db, { ids: [b], current: true, now: time("2026-11-24T11:09Z") });
  const change = data.byAccount[0].recentCloseChange;
  assert.deepEqual([change.price, change.fx, change.total], [null, 24.8, null]);
  assert.equal(change.closes[0].day, monday);
});

test("the existing ASX close importer waits through the auction and delayed feed, independently of US hours", async (t) => {
  const { db, au } = fixture(t);
  const testSymbol = "IVV.AX";
  // The historical fixture justifies retaining the exact configured MIC and currency.
  const request = async () => response({ chart: { result: [{
    meta: { symbol: testSymbol, currency: "AUD", instrumentType: "ETF", exchangeName: "ASX",
      dataGranularity: "1d", exchangeTimezoneName: "Australia/Sydney",
      currentTradingPeriod: { regular: { end: time("2026-11-23T05:00:00Z") / 1000 } } },
    timestamp: [time("2026-11-23T00:00:00Z") / 1000], indicators: { quote: [{ close: [70.89] }] },
  }] } });
  const get = (stamp) => refreshCloses(db, [au], { from: monday, to: monday, now: time(stamp) }, request);
  assert.ok((await get("2026-11-23T05:04:00Z"))[0].error);
  assert.ok((await get("2026-11-23T05:30:00Z"))[0].error);
  assert.equal((await get("2026-11-23T05:31:00Z"))[0].added, 1);
  assert.equal(marketSession(time("2026-11-23T05:31:00Z"), "US").phase, "closed");
});
