const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { randomBytes } = require("node:crypto");
const {
  createBook,
  createAccount,
  saveEvent,
  savePrice,
  resolveAsset,
  backupMode,
} = require("../out/ledger.cjs");
const { portfolioReview, reviewDay, saveReviewNote, reviewNotes } = require("../out/performance.cjs");
const { refreshBenchmarks, refreshCloses, refreshReviewPrices } = require("../out/reviewMarket.cjs");
const { loadBook, positions, positionHistory, dashboard } = require("../out/flows.cjs");
const { network } = require("../out/services.cjs");
const monday = "2025-02-03",
  tuesday = "2025-02-04",
  wednesday = "2025-02-05",
  thursday = "2025-02-06";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-review-"));
  const db = createBook(path.join(dir, "test.sqlite"), Buffer.from("raw:" + randomBytes(32).toString("hex")));
  t.after(() => {
    db.close();
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    fs.rmdirSync(dir);
  });
  const account = createAccount(db, "A"),
    ids = [account];
  const anchor = (id, date, cash, holdings = {}) =>
    db
      .prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)")
      .run(id, date, JSON.stringify(holdings), JSON.stringify(cash));
  let count = 0;
  const event = (date, type, amount, extra = {}) =>
    saveEvent(db, {
      id: "e" + ++count,
      accountId: account,
      date,
      activityType: type,
      currency: "AUD",
      amount,
      ...extra,
    });
  const level = (id, date, n) =>
    db.prepare("INSERT OR REPLACE INTO sp_benchmark_levels VALUES(?,?,?,?)").run(id, date, n, "fixture");
  const review = (from, to, selected = ids) => portfolioReview(db, { ids: selected, from, to });
  return { db, ids, account, anchor, event, level, review };
}
function near(actual, expected) {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-10, actual + " != " + expected);
}

test("gross daily cash flows, dividends, fees, AUD FX and interval rebasing", (t) => {
  const { db, account, anchor, event, level, review } = fixture(t);
  anchor(account, monday, { AUD: 10000 });
  event(tuesday, "DEPOSIT", 10000);
  event(tuesday, "DIVIDEND", 220);
  event(tuesday, "FEE", 20);
  event(tuesday, "WITHDRAWAL", 5000);
  event(wednesday, "DIVIDEND", 152);
  for (const [date, fx, sp, nd] of [
    [monday, 1.5, 100, 200],
    [tuesday, 1.5, 102, 190],
    [wednesday, 1.4, 101, 199],
  ]) {
    savePrice(db, "FX:USD/AUD", date, fx, "statement");
    level("SP500TR", date, sp);
    level("XNDX", date, nd);
  }
  const all = review(monday, wednesday);
  // The day before the first record carries no valuation, so the curves start on Monday's close.
  assert.deepEqual([all.base, all.origin], ["2025-02-02", monday]);
  near(all.points.find((p) => p.date === tuesday).portfolio, 0.01);
  near(all.metrics.portfolio.totalReturn, 1.01 ** 2 - 1);
  near(all.metrics.SP500TR.totalReturn, (101 * 1.4) / 150 - 1);
  near(all.metrics.SP500TR.gap, all.metrics.portfolio.totalReturn - all.metrics.SP500TR.totalReturn);
  near(all.metrics.SP500TR.maxDrawdown, (101 * 1.4) / (102 * 1.5) - 1);
  assert.deepEqual(
    all.intervals.filter((i) => i.id === "SP500TR").map((i) => [i.baseline, i.from, i.to, i.status]),
    [[monday, tuesday, wednesday, "recovered"]],
  );
  // A period starting on Wednesday is measured from Tuesday's close.
  const sub = review(wednesday, wednesday);
  assert.deepEqual([sub.from, sub.origin], [wednesday, tuesday]);
  assert.deepEqual([sub.points[0].portfolio, sub.points[0].SP500TR, sub.points[0].XNDX], [0, 0, 0]);
  near(sub.metrics.portfolio.totalReturn, 0.01);
});

test("cash and security transfers respect the selected boundary, including cross-day cash in transit", (t) => {
  const { db, account, anchor, event, review } = fixture(t);
  const b = createAccount(db, "B");
  anchor(account, monday, { AUD: 700 });
  anchor(b, monday, { AUD: 300 });
  event(tuesday, "TRANSFER_OUT", 200, { group: "pair" });
  event(wednesday, "TRANSFER_IN", 200, { accountId: b, group: "pair" });
  const stock = resolveAsset(db, { symbol: "ABC", exchangeMic: "XNAS" }, "USD");
  event(wednesday, "TRANSFER_IN", 0, { currency: "USD", assetId: stock, quantity: "3" });
  savePrice(db, stock, wednesday, 20, "statement");
  savePrice(db, "FX:USD/AUD", wednesday, 1.5, "statement");
  for (const ids of [[account, b], [account], [b]])
    near(review(monday, wednesday, ids).metrics.portfolio.totalReturn, 0);
  const detail = reviewDay(db, { date: tuesday, ids: [account, b] });
  assert.equal(detail.total, 1000);
  assert.equal(detail.cashWeight, 1);
  assert.ok(detail.rows.some((r) => r.account === "账户间在途" && r.value === 200));
});

test("a missing close or FX rate mid-period carries the latest known one forward; index history counts from its start", (t) => {
  const { db, account, ids, anchor, level, event, review } = fixture(t);
  const stock = resolveAsset(db, { symbol: "ABC", exchangeMic: "XASX" }, "AUD");
  anchor(account, monday, {}, { [stock]: 10 });
  for (const [date, n] of [
    [monday, 10],
    [tuesday, 11],
    [thursday, 12],
  ])
    savePrice(db, stock, date, n, "close");
  savePrice(db, stock, wednesday, 1, "成交价", 1);
  for (const date of [monday, tuesday, thursday]) savePrice(db, "FX:USD/AUD", date, 1.5, "statement");
  for (const date of [monday, tuesday, wednesday, thursday]) level("SP500TR", date, 100);
  for (const date of [tuesday, wednesday, thursday]) level("XNDX", date, 200);
  const report = review(monday, thursday);
  assert.equal(report.commonStart, tuesday);
  assert.equal(report.series[1].first, tuesday);
  // Wednesday keeps Tuesday's close and FX rate.
  const onWednesday = report.points.find((p) => p.date === wednesday);
  assert.deepEqual([onWednesday.value, onWednesday.SP500TR], [110, 0]);
  near(onWednesday.portfolio, 0.1);
  assert.equal(reviewDay(db, { ids, date: wednesday }).rows[0].value, 110);
  near(report.metrics.portfolio.totalReturn, 0.2);
  assert.equal(report.metrics.portfolio.maxDrawdown, 0);
  assert.equal(report.metrics.portfolio.asOf, thursday);
  assert.deepEqual([report.metrics.SP500TR.totalReturn, report.metrics.SP500TR.maxDrawdown], [0, 0]);
  // The data panel still lists the carried close, so it is fetched.
  assert.ok(report.outages.some((o) => o.id === "portfolio" && o.from === wednesday && /收盘价/.test(o.reason)));
  assert.ok(report.missingAssets.includes(stock));
  // Nasdaq's history starts on Tuesday, after Monday's opening close.
  assert.equal(report.metrics.XNDX.gap, null);
  assert.equal(review(wednesday, thursday).metrics.XNDX.totalReturn, 0);
  // A deposit on a day with a carried close keeps the chain: 140 on 140, then 150 on 140.
  event(wednesday, "DEPOSIT", 30);
  near(review(monday, thursday).metrics.portfolio.totalReturn, 1.1 * (150 / 140) - 1);
  // An open reconciliation check is left to the imports page; the review values the ledger.
  db.prepare("INSERT INTO sp_checks VALUES(?,?,?)").run(account, tuesday, "待核对");
  near(review(monday, tuesday).metrics.portfolio.totalReturn, 0.1);
});

test("weekends and US exchange holidays carry closes but use current FX; results stand as of the last session with its own close", (t) => {
  const { db, account, anchor, level, review } = fixture(t);
  const stock = resolveAsset(db, { symbol: "ABC", exchangeMic: "XNAS" }, "USD");
  const friday = "2025-02-14",
    holiday = "2025-02-17",
    open = "2025-02-18";
  anchor(account, friday, {}, { [stock]: 10 });
  savePrice(db, stock, friday, 10, "close");
  for (const [date, fx] of [
    [friday, 1.5],
    [holiday, 1.65],
    [open, 1.65],
  ])
    savePrice(db, "FX:USD/AUD", date, fx, "close");
  level("SP500TR", friday, 100);
  level("XNDX", friday, 110);
  const r = review(friday, open);
  const on = (date) => r.points.find((p) => p.date === date);
  near(on("2025-02-16").portfolio, 0);
  near(on(holiday).portfolio, 0.1);
  near(on(holiday).SP500TR, 0.1);
  // The open Tuesday has no close yet: it carries Friday's, and results stay as of Monday.
  near(on(open).portfolio, 0.1);
  near(on(open).SP500TR, 0.1);
  assert.deepEqual([r.metrics.portfolio.asOf, r.metrics.SP500TR.asOf], [holiday, holiday]);
});

test("underperformance and benchmark drawdowns end on the latest comparable close", (t) => {
  const { db, account, anchor, event, level, review } = fixture(t);
  const yearEnd = "2025-12-31";
  anchor(account, "2024-12-31", { AUD: 1000 });
  event(wednesday, "INTEREST", 100);
  event(yearEnd, "INTEREST", 100);
  for (const date of ["2024-12-31", tuesday, wednesday, thursday, yearEnd])
    savePrice(db, "FX:USD/AUD", date, 1.5, "statement");
  level("SP500TR", "2024-12-31", 100);
  level("SP500TR", tuesday, 110);
  level("XNDX", "2024-12-31", 100);
  level("XNDX", thursday, 135);
  level("XNDX", yearEnd, 130);

  const r = review("2025-01-01", yearEnd);
  near(r.metrics.portfolio.totalReturn, 0.2);
  near(r.metrics.portfolio.annualised, 0.2);
  const sp = r.metrics.SP500TR;
  near(sp.gap, -0.1);
  assert.equal(sp.asOf, tuesday);
  assert.equal(sp.annualised, null);
  assert.deepEqual(
    [sp.longestUnderperformance.from, sp.longestUnderperformance.to, sp.longestUnderperformance.status],
    [tuesday, tuesday, "open"],
  );
  assert.equal(r.metrics.XNDX.longestUnderperformance.to, yearEnd);
  assert.equal(r.benchmarkDrawdowns.SP500TR.at(-1).date, tuesday);
  near(r.benchmarkDrawdowns.XNDX.at(-1).drawdown, 130 / 135 - 1);
});

test("review notes preserve displayed metrics across revisions and old database backups remain recognized", (t) => {
  const { db, account, ids, anchor, event, review } = fixture(t);
  anchor(account, monday, { AUD: 100 });
  const first = review(monday, tuesday);
  event(tuesday, "DIVIDEND", 10);
  const saved = saveReviewNote(db, first, "回看股息");
  saveReviewNote(db, first, "回看股息", saved.id);
  assert.equal(reviewNotes(db).length, 1);
  const [note] = reviewNotes(db);
  assert.deepEqual(note.ids, ids);
  assert.deepEqual(note.benchmarks, ["SP500TR", "XNDX"]);
  assert.equal(note.metrics.portfolio.totalReturn, 0);
  near(review(note.from, note.to, note.ids).metrics.portfolio.totalReturn, 0.1);
  db.exec("DROP TABLE sp_benchmark_levels; DROP TABLE sp_review_notes");
  assert.equal(backupMode(db), "real");
});

test("historical position cursor agrees with the ledger across anchors and date-changing corrections", (t) => {
  const { db, account, anchor } = fixture(t);
  const deposit = {
    id: "move",
    accountId: account,
    activityType: "DEPOSIT",
    currency: "AUD",
    date: monday,
    amount: "40",
  };
  saveEvent(db, deposit, true);
  anchor(account, tuesday, { AUD: 40 });
  saveEvent(db, { ...deposit, date: wednesday, amount: "50" });
  const book = loadBook(db),
    acc = book.accounts[0],
    cursor = positionHistory(book, acc);
  for (const date of [monday, tuesday, wednesday, thursday])
    assert.deepEqual(
      cursor(date).cash.get("AUD").toFixed(),
      positions(book, acc, date).cash.get("AUD").toFixed(),
    );
});

test("benchmark refresh validates series identity, preserves good caches on partial failure, and can be retried", async (t) => {
  const { db } = fixture(t);
  let wrong = false;
  const request = async ({ url: raw }) => {
    const u = new URL(raw);
    if (u.host === "fred.stlouisfed.org")
      return { status: 200, body: "observation_date,NASDAQXNDX\n" + monday + ",200\n" + tuesday + ",.\n" };
    const symbol = decodeURIComponent(u.pathname.split("/").pop()),
      fx = symbol === "AUDUSD=X",
      latest = symbol === "^XNDX";
    assert.ok(fx || latest || symbol === "^SP500TR");
    return {
      status: 200,
      body: JSON.stringify({
        chart: {
          result: [
            {
              meta: {
                symbol: wrong && !fx ? "^GSPC" : symbol,
                currency: "USD",
                instrumentType: fx ? "CURRENCY" : "INDEX",
                dataGranularity: "1d",
                exchangeTimezoneName: "America/New_York",
              },
              // The exchange feed carries only the latest Nasdaq close, a session ahead of the history.
              timestamp: [Date.parse((latest ? tuesday : monday) + "T16:00:00Z") / 1000],
              indicators: { quote: [{ close: [fx ? 0.625 : latest ? 210 : 100] }] },
            },
          ],
        },
      }),
    };
  };
  const scope = { from: monday, to: tuesday };
  assert.deepEqual(
    (await refreshBenchmarks(db, scope, request)).map((r) => r.count),
    [1, 2, 1],
  );
  assert.deepEqual(
    db.prepare("SELECT day,level FROM sp_benchmark_levels WHERE series='XNDX' ORDER BY day").all(),
    [
      { day: monday, level: 200 },
      { day: tuesday, level: 210 },
    ],
  );
  wrong = true;
  assert.ok((await refreshBenchmarks(db, scope, request))[0].error);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sp_benchmark_levels").get().n, 3);
  assert.equal(db.prepare("SELECT price FROM sp_prices WHERE asset='FX:AUD/USD'").get().price, "0.625");
  wrong = false;
  await refreshBenchmarks(db, scope, request);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sp_benchmark_levels").get().n, 3);
});

test("historical securities use matching, unadjusted closes for the held listing", async (t) => {
  const { db } = fixture(t);
  const asset = { id: "us", symbol: "ABC", currency: "USD", mic: "XNAS" };
  let mic = "XNAS";
  const request = async ({ url }) => {
    assert.equal(new URL(url).searchParams.get("adjust"), "none");
    return {
      status: 200,
      body: JSON.stringify({
        meta: { symbol: "ABC", currency: "USD", mic_code: mic, interval: "1day" },
        values: [{ datetime: monday, close: 21 }],
      }),
    };
  };
  const update = () => refreshReviewPrices(db, [asset], { from: monday, to: tuesday }, "fixture", request);
  assert.equal((await update())[0].count, 1);
  mic = "XASX";
  assert.ok((await update())[0].error);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sp_prices").get().n, 1);
});

test("results are measured from the eve of the first record and stated as of the latest valued close", (t) => {
  const { db, account, event, level, review } = fixture(t);
  const stock = resolveAsset(db, { symbol: "ABC", exchangeMic: "XASX" }, "AUD");
  event(tuesday, "DEPOSIT", 1000);
  event(tuesday, "BUY", null, { assetId: stock, quantity: "100", unitPrice: "10", fee: "0" });
  savePrice(db, stock, tuesday, 10, "close");
  savePrice(db, stock, wednesday, 11, "close");
  [monday, tuesday, wednesday, thursday].forEach((date, i) => {
    savePrice(db, "FX:USD/AUD", date, 1.5, "close");
    level("SP500TR", date, [100, 100, 105, 110][i]);
    level("XNDX", date, 200);
  });
  // The period moves to the first record on Tuesday and is measured from Monday, when nothing
  // was held yet. Thursday's close has not arrived.
  const r = review(monday, thursday);
  assert.deepEqual([r.from, r.requested, r.origin], [tuesday, monday, monday]);
  assert.deepEqual(
    r.points.map((p) => p.portfolio == null ? null : Math.round(p.portfolio * 100)),
    [0, 0, 10, 10],
  );
  assert.equal(r.points[0].SP500TR, 0);
  near(r.points[3].SP500TR, 0.1);
  assert.equal(r.metrics.portfolio.asOf, wednesday);
  near(r.metrics.portfolio.totalReturn, 0.1);
  near(r.metrics.portfolio.maxDrawdown, 0);
  // The comparison uses the latest close both sides can be measured at.
  assert.equal(r.metrics.SP500TR.asOf, wednesday);
  near(r.metrics.SP500TR.totalReturn, 0.05);
  near(r.metrics.SP500TR.gap, 0.05);
  near(r.metrics.SP500TR.portfolioReturn, 0.1);
  assert.deepEqual(r.money, { start: 0, end: 1100, flows: 1000, gain: 100 });
  assert.equal(r.needsData, true);
  savePrice(db, stock, thursday, 11, "close");
  const complete = review(monday, thursday);
  assert.equal(complete.needsData, false);
  assert.equal(complete.metrics.portfolio.asOf, thursday);
  near(complete.metrics.SP500TR.gap, 0);
});

test("an account opened by its own deposit is empty before it; a carried-in balance is not", (t) => {
  const { db, account, anchor, event, review } = fixture(t);
  const stock = resolveAsset(db, { symbol: "ABC", exchangeMic: "XASX" }, "AUD");
  anchor(account, monday, { AUD: 1000 });
  savePrice(db, stock, wednesday, 10, "close");
  savePrice(db, stock, thursday, 11, "close");
  // The purchase sorts ahead of the deposit which funded it on the same day.
  const funded = createAccount(db, "B");
  event(wednesday, "BUY", null, { accountId: funded, assetId: stock, quantity: "10", unitPrice: "10", fee: "0" });
  event(wednesday, "DEPOSIT", 100, { accountId: funded });
  const joined = review(monday, thursday, [account, funded]);
  assert.equal(joined.origin, monday);
  near(joined.metrics.portfolio.totalReturn, 10 / 1100);
  // A snapshot which that day's own records reproduce is a calculated balance, not an opening one.
  const computed = createAccount(db, "C");
  const migrated = { id: "m1", accountId: computed, date: wednesday, activityType: "DEPOSIT", currency: "AUD", amount: "300" };
  saveEvent(db, migrated, true);
  anchor(computed, wednesday, { AUD: 300 });
  assert.equal(review(monday, thursday, [account, computed]).origin, monday);
  const carried = createAccount(db, "D");
  anchor(carried, wednesday, { AUD: 500 });
  const late = review(monday, thursday, [account, carried]);
  assert.equal(late.origin, wednesday);
  near(late.metrics.portfolio.totalReturn, 0);
});

test("public closes verify the held listing, leave restated history out and never rewrite a stored close", async (t) => {
  const { db } = fixture(t);
  const asset = { id: "us", symbol: "BRK.B", currency: "USD", mic: "XNYS", kind: "EQUITY" };
  let exchange = "NYQ",
    close = 500,
    splits;
  const stamp = (date) => Date.parse(date + "T14:30:00Z") / 1000;
  const request = async ({ url }) => {
    assert.equal(decodeURIComponent(new URL(url).pathname.split("/").pop()), "BRK-B");
    return {
      status: 200,
      body: JSON.stringify({
        chart: {
          result: [
            {
              meta: {
                symbol: "BRK-B",
                currency: "USD",
                instrumentType: "EQUITY",
                exchangeName: exchange,
                dataGranularity: "1d",
                exchangeTimezoneName: "America/New_York",
              },
              timestamp: [stamp(monday), stamp(tuesday)],
              indicators: { quote: [{ close: [close, close + 1] }] },
              events: splits && { splits },
            },
          ],
        },
      }),
    };
  };
  const update = (item = asset) => refreshCloses(db, [item], { from: monday, to: tuesday }, request);
  assert.deepEqual(await update(), [{ id: "us", name: "BRK.B", count: 2, added: 2 }]);
  close = 900;
  assert.equal((await update())[0].added, 0);
  assert.equal(db.prepare("SELECT price FROM sp_prices WHERE asset='us' AND day=?").get(monday).price, "500");
  exchange = "ASX";
  assert.ok((await update())[0].error);
  assert.ok((await update({ ...asset, mic: "XLON" }))[0].error);
  exchange = "NYQ";
  db.exec("DELETE FROM sp_prices");
  splits = { split: { date: stamp(tuesday), numerator: 2, denominator: 1 } };
  assert.equal((await update())[0].count, 1);
  assert.deepEqual(db.prepare("SELECT day FROM sp_prices").all(), [{ day: tuesday }]);
});

test("public downloads use the shell's network stack and fall back to the default one", async () => {
  const original = globalThis.fetch,
    calls = [];
  const reply = (stack) => async () => {
    calls.push(stack);
    return new Response(stack);
  };
  globalThis.fetch = reply("default");
  try {
    const open = { url: "https://fred.stlouisfed.org/graph/fredgraph.csv" };
    network.browserFetch = reply("shell");
    assert.equal((await network.request(open)).body, "shell");
    network.browserFetch = async () => {
      calls.push("shell");
      throw Error("offline");
    };
    assert.equal((await network.request(open)).body, "default");
    // A signed broker call keeps its exact headers on the default stack.
    network.browserFetch = reply("shell");
    assert.equal((await network.request({ url: "https://api.webull.com.au/x", headers: { a: "1" } })).body, "default");
    assert.deepEqual(calls, ["shell", "shell", "default", "default"]);
  } finally {
    globalThis.fetch = original;
    network.browserFetch = null;
  }
});

test("the dashboard reports money put in, the gain on it and the cost of each holding", async (t) => {
  const { db, account, event } = fixture(t);
  const stock = resolveAsset(db, { symbol: "ABC", exchangeMic: "XNAS" }, "USD");
  const conversion = { group: "fx", metadata: { fx: {}, flow: { is_external: false } } };
  event(monday, "DEPOSIT", 3000);
  event(monday, "TRANSFER_OUT", 2250, conversion);
  event(monday, "TRANSFER_IN", 1500, { ...conversion, currency: "USD" });
  const trade = (date, type, quantity, unitPrice, fee) =>
    event(date, type, null, { currency: "USD", assetId: stock, quantity, unitPrice, fee });
  trade(monday, "BUY", "10", "50", "10");
  trade(tuesday, "BUY", "10", "70", "0");
  trade(wednesday, "SELL", "5", "80", "0");
  event(thursday, "WITHDRAWAL", 200);
  for (const [date, price, fx] of [
    [monday, 50, 1.5],
    [tuesday, 70, 1.6],
    [wednesday, 80, 1.6],
    [thursday, 80, 1.6],
  ]) {
    savePrice(db, stock, date, price, "close");
    savePrice(db, "FX:USD/AUD", date, fx, "close");
  }
  const d = await dashboard(db, { ids: [account], date: thursday, period: "all" });
  // AUD 550 and USD 690 in cash, 15 shares at USD 80, all at 1.6.
  near(d.total, 3574);
  // The whole history starts from nothing on the eve of the first record.
  const { period, lifetime } = d.result;
  assert.deepEqual([d.start, d.fromOpening, period.start], [monday, true, 0]);
  near(period.flows, 2800);
  near(period.gain, 774);
  assert.equal("rate" in period, false);
  assert.deepEqual([d.points[0].date, d.points[0].value, d.points[0].basis], ["2025-02-02", 0, 0]);
  near(d.points[1].basis, 3000);
  near(d.points.at(-1).basis, 2800);
  // A year which began before the first record reads the same way instead of going blank.
  const year = await dashboard(db, { ids: [account], date: thursday, period: "ytd" });
  assert.deepEqual([year.start, year.pnl, year.flows], [monday, d.pnl, 2800]);
  assert.deepEqual(year.result, d.result);
  assert.ok(year.points.every((p) => p.value != null && p.basis != null));
  // A period which opens after the first record starts from the value held at the close before it:
  // AUD 750 and USD 290 in cash with 20 shares at USD 70, at 1.6.
  const later = await dashboard(db, { ids: [account], date: thursday, from: wednesday });
  assert.deepEqual([later.start, later.fromOpening], [wednesday, false]);
  near(later.result.period.start, 3454);
  near(later.result.period.flows, -200);
  near(later.result.period.gain, 320);
  assert.deepEqual(
    [lifetime.since, lifetime.contributed, lifetime.withdrawn, lifetime.invested],
    [monday, 3000, 200, 2800],
  );
  near(lifetime.gain, 774);
  assert.equal("rate" in lifetime, false);
  near(d.summary.cumulativeNetFlow, 2800);
  assert.deepEqual(d.byAccount[0].result, d.result);
  // Twenty shares cost USD 1,210 including the fee; a quarter of that cost left with the sale.
  const row = d.rows.find((r) => r.ticker === "ABC");
  near(row.averageCost, 60.5);
  near(row.costLocal, 907.5);
  near(row.gainLocal, 292.5);
  near(row.costAud, 907.5 * 1.6);
  near(row.gainAud, 292.5 * 1.6);
  near(row.gainRate, 292.5 / 907.5);
  near(d.holdings.gain, row.gainAud);
  assert.equal(row.stale, false);
  // A holding the trades cannot account for reports no cost.
  db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(
    account,
    thursday,
    JSON.stringify({ [stock]: "40" }),
    JSON.stringify({ AUD: "550", USD: "690" }),
  );
  const unexplained = (await dashboard(db, { ids: [account], date: thursday })).rows.find((r) => r.ticker === "ABC");
  assert.notEqual(unexplained.rawQuantity, "15");
  assert.equal(unexplained.costAud, undefined);
});

test("open positions translate native cost and gain with the valuation FX even without a purchase-day rate", async (t) => {
  const { db, ids, event } = fixture(t);
  const assetId = resolveAsset(db, { symbol: "ABC", exchangeMic: "XNAS" }, "USD");
  event(monday, "BUY", null, { assetId, quantity: 10, unitPrice: 100, fee: 1, currency: "USD" });
  savePrice(db, assetId, monday, 100, "close");
  savePrice(db, "FX:USD/AUD", tuesday, 1.5104, "close");
  savePrice(db, "FX:USD/AUD", wednesday, 1.6, "close");
  for (const [date, fx] of [[monday, null], [tuesday, 1.5104], [wednesday, 1.6]]) {
    const view = await dashboard(db, { ids, date });
    const row = view.rows.find(r => r.assetId === assetId);
    assert.deepEqual([row.costLocal, row.gainLocal], [1001, -1]);
    if (fx == null) {
      assert.deepEqual([row.costAud, row.gainAud, view.holdings.gain], [undefined, undefined, null]);
    } else {
      near(row.costAud, 1001 * fx);
      near(row.gainAud, -fx);
      near(row.gainRate, -1 / 1001);
      near(view.holdings.securities[0].cost, row.costAud);
      near(view.holdings.gain, row.gainAud);
    }
  }
});

test("a sold security earns its period change plus linked income less fees, with account income traceable", (t) => {
  const { db, account, event, anchor, review } = fixture(t);
  const stock = resolveAsset(db, { symbol: "IVV", exchangeMic: "XASX" }, "AUD");
  anchor(account, "2025-01-30", { AUD: 500 });
  event("2025-01-31", "BUY", 0, { assetId: stock, assetSymbol: "IVV", quantity: 1, unitPrice: 40 });
  for (const date of [monday, tuesday]) savePrice(db, stock, date, 100, "statement");
  event(tuesday, "DIVIDEND", 10, { assetId: stock, sourceRecordId: "dividend-voucher" });
  event(tuesday, "TAX", 2, { comment: "IVV(AU000000IVV8) Dividend Withholding" });
  event(wednesday, "SELL", 0, { assetId: stock, quantity: 1, unitPrice: 200, fee: 2 });
  event(wednesday, "INTEREST", 3);
  event(wednesday, "FEE", 1, { sourceRecordId: "fee-voucher" });
  const r = review(monday, wednesday);
  const get = (label) => r.contributions.rows.find((v) => v.label === label);
  near(r.money.gain, 108);
  near(get("IVV").gain, 106);
  assert.equal(get("IVV").closed, true);
  assert.equal(get("IVV").assetId, stock);
  const income = r.breakdown.items.find((item) => item.key === "income");
  assert.equal(income.rows.find((row) => row.assetId === stock)?.value, 8);
  assert.ok(get("IVV").events.some((v) => v.reference === "dividend-voucher"));
  near(get("现金利息").gain, 3);
  near(get("待归属").gain, -1);
  assert.equal(get("待归属").events[0].reference, "fee-voucher");
  assert.equal(
    r.contributions.rows.reduce((n, v) => n + v.gain, 0),
    r.money.gain,
  );
});

test("a deposit on a day missing its close keeps the return chain, the gain and the contributions", (t) => {
  const { db, account, event, anchor, review } = fixture(t);
  const stock = resolveAsset(db, { symbol: "ABC", exchangeMic: "XASX" }, "AUD");
  anchor(account, monday, { AUD: 100 }, { [stock]: 1 });
  savePrice(db, stock, monday, 100, "statement");
  event(tuesday, "DEPOSIT", 50);
  savePrice(db, stock, wednesday, 115, "statement");
  const result = review(monday, wednesday);
  // Tuesday carries Monday's close: 250 on 200 + 50, then 265 on 250.
  near(result.metrics.portfolio.totalReturn, 265 / 250 - 1);
  assert.equal(result.money.gain, 15);
  assert.equal(result.contributions.rows.find((r) => r.label === "ABC").gain, 15);
});
