// Run against the built app with node tests/performance-review.cjs.
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resizeContent } = require("./fixtures/display.cjs");

async function seedFullYear(app, root) {
  await app.evaluate(({ app, safeStorage }, root) => {
    const require = process.getBuiltinModule("node:module").createRequire(root + "/package.json");
    const { createBook, createAccount, putPref, resolveAsset, saveEvent, savePrice } = require("./out/ledger.cjs");
    const { localKey } = require("./bookStorage.cjs");
    const directory = app.getPath("userData");
    const db = createBook(directory + "/sample.sqlite", localKey(directory, safeStorage, true));
    try {
      const account = createAccount(db, "Review fixture");
      const start = "2024-12-31", end = "2025-12-31";
      const holdings = {};
      const stock = (symbol, change) => {
        const id = resolveAsset(db, { symbol, exchangeMic: "XASX" }, "AUD");
        holdings[id] = 1;
        savePrice(db, id, start, 100, "test close");
        savePrice(db, id, end, 100 + change, "test close");
        return id;
      };
      const ivv = stock("IVV", 100);
      for (let i = 0; i < 16; i++) stock("AU" + String(i).padStart(2, "0"), i - 8);
      db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(account, start, JSON.stringify(holdings), '{"AUD":500}');
      const activity = (id, activityType, amount, more = {}) =>
        saveEvent(db, { id, accountId: account, date: "2025-12-19", activityType, currency: "AUD", amount, ...more });
      activity("sale", "SELL", null, { assetId: ivv, quantity: 1, unitPrice: 200, fee: 2 });
      activity("dividend", "DIVIDEND", 8, { assetId: ivv });
      activity("interest", "INTEREST", 3);
      activity("unassigned", "FEE", 1, { sourceRecordId: "fee-voucher" });
      for (const day of [start, end]) {
        savePrice(db, "FX:USD/AUD", day, 1.5, "test FX");
        for (const id of ["SP500TR", "XNDX"])
          db.prepare("INSERT INTO sp_benchmark_levels VALUES(?,?,?,?)").run(id, day, day === start ? 100 : 103, "test level");
      }
      const archived = createAccount(db, "Archived fixture");
      const { portfolioReview, saveReviewNote } = require("./out/performance.cjs");
      const archivedReview = portfolioReview(db, { ids: [account, archived], from: "2025-01-01", to: end });
      saveReviewNote(db, archivedReview, "Archived account review");
      db.prepare("UPDATE sp_accounts SET active=0 WHERE id=?").run(archived);
      for (const flag of ["demo", "demo-costs-v1", "demo-review-v1"]) putPref(db, "app", flag, "1");
    } finally {
      db.close();
    }
  }, root);
}

(async () => {
  const root = path.join(__dirname, "..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-review-"));
  const env = {
    ...process.env,
    STACK_PORTFOLIO_HEADLESS: "1",
    STACK_PORTFOLIO_LOCALE: process.env.STACK_PORTFOLIO_LOCALE || "zh-CN",
    STACK_PORTFOLIO_TEST_DIR: directory,
    STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: require("electron"), args: [root], env, timeout: 30000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    await page.getByRole("button", { name: "打开示例账本" }).click();
    const nav = page.getByRole("navigation", { name: "页面" });
    await page.getByLabel("估值日").fill("2026-10-30");
    await nav.getByRole("button", { name: "收益复盘", exact: true }).click();

    await page.getByRole("group", { name: "期间" }).getByRole("button", { name: "本月" }).click();
    const drawdown = page.getByRole("region", { name: "最大回撤" });
    await drawdown.waitFor();
    const verifyDayLayout = async () => {
      const day = page.locator(".review-rail .card").filter({ has: page.getByRole("heading", { name: "收盘持仓与流水" }) });
      await day.getByRole("columnheader", { name: "估值依据" }).waitFor();
      const position = await day.evaluate((card) => {
        const bounds = (selector) => card.querySelector(selector).getBoundingClientRect();
        const tabs = bounds(".tabs"), summary = bounds(".review-readout"), table = bounds(".table-scroll");
        return { tabs: tabs.width, table: table.width, summaryGap: tabs.top - summary.bottom, tableGap: table.top - tabs.bottom };
      });
      assert.ok(position.tabs < position.table, "Day tabs stay content-width: " + JSON.stringify(position));
      assert.ok(position.summaryGap >= 7 && position.summaryGap <= 16);
      assert.ok(position.tableGap >= 7 && position.tableGap <= 16);
    };
    await verifyDayLayout();
    assert.match(await drawdown.innerText(), /−[\d.]+%[\s\S]*\d\d-\d\d 至 \d\d-\d\d[\s\S]*收复/);
    assert.equal(await page.getByRole("button", { name: "回撤", exact: true }).count(), 0);
    await page.getByText("不满一年，不显示年化").waitFor();
    const benchmarks = page.getByRole("group", { name: "对比基准" });
    await benchmarks.getByRole("button", { name: /^纳斯达克 100/ }).click();
    await page.getByRole("region", { name: "对纳斯达克 100", exact: true }).waitFor();
    const cumulative = page.getByRole("img", { name: "累计收益曲线" });
    await cumulative.waitFor();
    const labels = cumulative.locator(".ch-end");
    assert.deepEqual(await labels.allTextContents(), ["我的组合", "标普 500", "纳斯达克 100"]);
    await page.getByRole("group", { name: "主图视图" }).getByRole("button", { name: "收益差" }).click();
    const gap = page.getByRole("img", { name: "收益差曲线 · 对纳斯达克 100" });
    await gap.getByText("对纳斯达克 100", { exact: true }).waitFor();
    await gap.getByText(/最长跑输/).waitFor();
    await page.getByRole("group", { name: "主图视图" }).getByRole("button", { name: "累计收益" }).click();
    await cumulative.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: /当日明细/ }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "逐日数据", exact: true }).click();
    const daily = page.getByRole("dialog", { name: "逐日数据", exact: true });
    await daily.getByRole("columnheader", { name: "当日收益" }).waitFor();
    await daily.getByRole("columnheader", { name: "纳斯达克 100" }).waitFor();
    const lastDay = daily.getByRole("row", { name: /^2026-10-30/ });
    assert.match(await lastDay.innerText(), /▲\s*\+\d+[.]\d+%/);
    await lastDay.getByRole("button").focus();
    await page.keyboard.press("ArrowDown");
    const previousDay = daily.getByRole("button", { name: "2026-10-29", exact: true });
    assert.ok(await previousDay.evaluate((button) => button === document.activeElement));
    await lastDay.getByRole("cell").nth(1).click();
    await page.getByRole("dialog", { name: "2026-10-30 · 当日明细", exact: true }).waitFor();
    await page.keyboard.press("Escape");

    await resizeContent(app, page, 2560, 1080);
    await verifyDayLayout();
    await page.waitForFunction(() => document.querySelector(".pane").dataset.cols === "2");
    await page.getByRole("button", { name: "逐日数据", exact: true }).click();
    const dockedDaily = page.getByRole("complementary", { name: "逐日数据", exact: true });
    await dockedDaily.getByRole("row", { name: /^2026-10-30/ }).getByRole("cell").nth(1).click();
    const observedDay = page.locator(".review-rail").getByLabel("观察日");
    await observedDay.waitFor();
    assert.equal(await observedDay.inputValue(), "2026-10-30");
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.querySelector(".review-rail input[type=date]")?.value === "2026-10-29");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "数据来源与计算方法", exact: true }).click();
    const sources = page.getByRole("complementary", { name: "数据来源与计算方法", exact: true });
    await sources.getByText(/NASDAQXNDX|模拟总回报/).first().waitFor();
    const sp500 = sources.getByText("标普 500", { exact: true }).locator("..");
    const nasdaq = sources.getByText("纳斯达克 100", { exact: true }).locator("..");
    assert.match(await sp500.innerText(), /区间最大回撤\s*▼\s*−0\.71%/);
    assert.match(await nasdaq.innerText(), /区间最大回撤\s*▼\s*−1\.55%/);
    await page.waitForFunction(() => document.querySelector(".pane").dataset.cols === "2");
    await sources.getByRole("button", { name: "关闭" }).click();
    await page.waitForFunction(() => document.querySelector(".pane").dataset.cols === "2");
    await resizeContent(app, page, 1440, 900);

    const breakdown = page.getByRole("region", { name: "盈亏构成" });
    await breakdown.getByRole("button", { name: /^未实现变动/ }).click();
    await breakdown.getByRole("table").getByRole("button", { name: "IVV", exact: true }).waitFor();
    assert.equal(await breakdown.getByRole("button", { name: /^未实现变动/ }).getAttribute("aria-expanded"), "true");
    const contribution = page.getByRole("region", { name: "持仓贡献" });
    await contribution.getByRole("button", { name: /^IVV/ }).click();
    await page.getByRole("heading", { name: "持仓", exact: true }).waitFor();

    // A long formatted value must fit inside the chart's left margin.
    await page.evaluate(() => window.portfolio.savePrice({ assetId: "aapl", date: "2026-10-30", price: "300000" }));
    await page.reload();
    await nav.getByRole("button", { name: "收益复盘", exact: true }).click();
    await page.getByRole("group", { name: "主图视图" }).getByRole("button", { name: "收益差", exact: true }).click();
    const largeTick = page.getByRole("img", { name: /^收益差曲线/ }).getByText(/^\+\d{2},\d{3}\.\d pp$/, { exact: true }).first();
    await largeTick.waitFor();
    assert.ok(await largeTick.evaluate((tick) => tick.getBBox().x >= 0), "A wide return-gap tick stays inside the chart");

    await app.close();
    app = null;

    const annualDir = path.join(directory, "annual");
    fs.mkdirSync(annualDir);
    app = await electron.launch({
      executablePath: require("electron"), args: [root], env: { ...env, STACK_PORTFOLIO_TEST_DIR: annualDir }, timeout: 30000,
    });
    await seedFullYear(app, root);
    const annual = await app.firstWindow();
    annual.setDefaultTimeout(8000);
    await annual.getByRole("button", { name: "打开示例账本" }).click();
    const annualNav = annual.getByRole("navigation", { name: "页面" });
    await annual.getByLabel("估值日").fill("2025-12-31");
    await annualNav.getByRole("button", { name: "收益复盘", exact: true }).click();
    await annual.getByRole("group", { name: "期间" }).getByRole("button", { name: "近一年" }).click();
    const summary = annual.getByRole("region", { name: "时间加权收益率", exact: true });
    await summary.getByText("+4.55%", { exact: true }).first().waitFor();
    assert.match(await summary.innerText(), /年化\s*▲\s*\+4\.55%/);
    await annual.getByRole("group", { name: "主图视图" }).getByRole("button", { name: "回撤", exact: true }).click();
    await annual.getByRole("img", { name: "回撤曲线" }).getByText("标普 500").waitFor();

    const ranked = annual.getByRole("region", { name: "持仓贡献" });
    await ranked.getByRole("button", { name: /^IVV.*期间已卖清.*\+A\$106/ }).waitFor();
    const fold = ranked.getByRole("button", { name: /^中间 5 项合计/ });
    await fold.click();
    await ranked.getByRole("button", { name: /^现金利息.*\+A\$3/ }).waitFor();
    await ranked.getByRole("button", { name: /^待归属/ }).click();
    const evidence = annual.getByRole("dialog", { name: /待归属 · 区间原始流水/ });
    await evidence.getByText("fee-voucher", { exact: true }).waitFor();
    await annual.keyboard.press("Escape");

    const gainNumbers = async (rows) => (await rows.allTextContents()).map((text) =>
      Number(text.match(/[+−]?(?:A\$)?[\d,]+(?:\.\d+)?/)?.[0].replace(/[A$,]/g, "").replace("−", "-")));
    const reviewGain = await gainNumbers(annual.getByRole("region", { name: "盈亏构成" }).getByRole("button"));
    assert.deepEqual(reviewGain, [-8, 100, 11, -3, 0]);
    await annualNav.getByRole("button", { name: "总览", exact: true }).click();
    await annual.getByRole("region", { name: "关键数字" }).getByText("+4.55%", { exact: true }).waitFor();
    const overviewGain = await gainNumbers(annual.getByRole("region", { name: "盈亏构成" }).locator("dd"));
    assert.deepEqual(overviewGain, reviewGain);
    await annualNav.getByRole("button", { name: "收益复盘", exact: true }).click();
    await annual.getByRole("group", { name: "期间" }).getByRole("button", { name: "自定义…" }).click();
    const customEnd = annual.getByLabel("期间终点");
    await customEnd.fill("2026-01-01");
    assert.equal(await customEnd.inputValue(), "2025-12-31");
    await annual.getByRole("button", { name: "写笔记" }).click();
    await annual.getByRole("textbox", { name: "这段时间做了什么，下次想验证什么？" }).fill("Saved range review");
    await annual.getByRole("button", { name: "保存笔记与当前指标" }).click();

    const valuationDate = annual.getByLabel("估值日");
    await valuationDate.fill("2025-12-30");
    await annual.getByText("正在查看 2025-12-30").waitFor();
    await annual.getByRole("button", { name: /Saved range review/ }).click();
    await annual.getByText("正在查看 2025-12-31").waitFor();
    assert.equal(await valuationDate.inputValue(), "2025-12-31");
    assert.equal(await annual.getByLabel("期间起点").inputValue(), "2025-01-01");
    assert.equal(await customEnd.inputValue(), "2025-12-31");
    const comparison = annual.getByRole("heading", { name: "记录时与当前重算" }).locator("..");
    const ownReturn = comparison.getByRole("row", { name: /^我的组合 区间收益/ });
    assert.match(await ownReturn.getByRole("cell").last().innerText(), /\+4\.55%/);

    await annual.getByRole("button", { name: /Archived account review/ }).click();
    await comparison.getByText("当前无法按此笔记原有的账户范围与期间重算。").waitFor();
    assert.match(await ownReturn.getByRole("cell").nth(2).innerText(), /\+4\.55%/);
    assert.equal(await ownReturn.getByRole("cell").last().innerText(), "—");
    assert.equal(await valuationDate.inputValue(), "2025-12-31");
    console.log("Performance review verified: drawdown eligibility, benchmark selection, inspectors, contributions and Overview parity.");
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
