// Run after node build.mjs. Launches the built Electron renderer with an isolated demo ledger.
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resizeContent } = require("./fixtures/display.cjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-overview-"));
const env = {
  ...process.env,
  STACK_PORTFOLIO_HEADLESS: "1",
  STACK_PORTFOLIO_TEST_DIR: directory,
  STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
};
delete env.ELECTRON_RUN_AS_NODE;

async function verifyLayoutChoice(app, page) {
  const picker = page.getByRole("combobox", { name: "总览布局" });
  const scope = page.locator(".header-tools .account-scope");
  const date = page.getByLabel("估值日");
  const period = page.locator(".overview > .period-row");
  const total = page.locator(".overview-total .v");
  const gain = page.locator(".overview-trend .seg button").nth(1);
  assert.equal(await picker.inputValue(), "classic");
  await scope.click();
  await page.getByRole("checkbox", { name: "Webull Australia" }).uncheck();
  await page.locator("dialog .primary").click();
  await date.fill("2026-10-29");
  await period.getByRole("button", { name: "本月", exact: true }).click();
  await gain.click();
  await page.waitForFunction(() => document.querySelector(".overview-total-label time")?.dateTime === "2026-10-29");
  const prior = await total.textContent();

  for (const [width, height] of [[1024, 650], [3440, 1440]]) {
    await resizeContent(app, page, width, height);
    for (const choice of ["daily", "classic"]) {
      await picker.selectOption(choice);
      assert.equal(await page.locator(".daily-assets").count(), choice === "daily" ? 1 : 0);
      assert.equal(await total.textContent(), prior);
      assert.equal(await date.inputValue(), "2026-10-29");
      assert.equal(await scope.innerText(), "IBKR");
      assert.equal(await gain.getAttribute("aria-pressed"), "true");
      assert.equal(await period.getByRole("button", { name: "本月", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByText("先看资产与走势", { exact: true }).count(), 0);
      assert.ok(await page.locator(".overview").evaluate(root => {
        const row = root.firstElementChild;
        return row.classList.contains("period-row") &&
          Math.abs(row.firstElementChild.getBoundingClientRect().left - root.getBoundingClientRect().left) < 1;
      }));
    }
  }

  await picker.selectOption("daily");
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "持仓", exact: true }).click();
  assert.equal(await picker.count(), 0);
  await page.reload();
  await page.locator(".daily-assets").waitFor();
  assert.equal(await picker.inputValue(), "daily");
  await picker.selectOption("classic");
  await scope.click();
  await page.getByRole("dialog").getByRole("button", { name: "全部账户" }).click();
  await page.locator("dialog .primary").click();
  await period.getByRole("button", { name: "今年以来", exact: true }).click();
  await page.reload();
  await page.locator(".overview-main > .kpis").waitFor();
  assert.equal(await picker.inputValue(), "classic");
  await resizeContent(app, page, 1024, 650);
}

(async () => {
  let app;
  try {
    const packaged = process.argv[2];
    app = await electron.launch({ executablePath: packaged || require("electron"), args: packaged ? [] : [path.join(__dirname, "..")], env });
    assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), directory);
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    await resizeContent(app, page, 1024, 650);
    const home = await page.evaluate(() => window.portfolio.home());
    if (!home.mode && !home.hasReal && !home.onboardingSeen) await page.getByRole("button", { name: "暂时跳过" }).click();
    await page.getByRole("button", { name: "打开示例账本" }).click();
    await page.locator(".overview").waitFor();
    await verifyLayoutChoice(app, page);
    const chart = page.getByRole("img", { name: "总资产与净投入" });
    await chart.waitFor();
    assert.equal(await page.getByRole("main").getAttribute("data-cols"), "1");
    assert.ok((await chart.boundingBox()).height >= 239);
    const presets = await page.getByRole("group", { name: "期间" }).boundingBox();
    const metrics = await page.getByRole("region", { name: "关键数字" }).boundingBox();
    assert.ok(Math.abs(metrics.y - presets.y - presets.height - 12) < 1);
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    const first = page.locator(".ch-tip");
    await first.waitFor();
    assert.match(await first.innerText(), /2026-09-30/);
    assert.match(await first.innerText(), /总资产\s+A\$124,200\.00/);
    assert.match(await first.innerText(), /净投入收益率\s+[+−]?[\d.]+%/);
    assert.ok(await chart.locator(".ch-axis").filter({ hasText: /%$/ }).count());
    await page.mouse.move(0, 0);
    await chart.focus();
    await page.keyboard.press("Home");
    assert.match(await first.innerText(), /2026-09-30/);
    await page.keyboard.press("End");
    assert.match(await first.innerText(), /2026-10-30/);
    await page.keyboard.press("Escape");
    await first.waitFor({ state: "hidden" });

    const overview = page.locator(".overview");
    const kpis = overview.getByRole("region", { name: "关键数字" });
    assert.equal(await kpis.locator(".kpi").count(), 5);
    await kpis.getByText("持仓盈亏", { exact: true }).waitFor();
    const fx = overview.getByRole("region", { name: "汇率影响" });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => window.portfolio.setTheme({ theme }), theme);
      // Electron offscreen windows need the corresponding renderer media preference.
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction((theme) => matchMedia("(prefers-color-scheme: " + theme + ")").matches, theme);
      for (const [w, h] of [[1024, 650], [1280, 720], [1920, 1080], [3440, 1440]]) {
        const state = await resizeContent(app, page, w, h);
        const layout = await overview.evaluate((root) => ({
          fits: root.scrollWidth <= root.clientWidth && [...root.querySelectorAll(".card")].every((c) => c.scrollWidth <= c.clientWidth),
          rail: [...root.querySelectorAll(".overview-rail h2")].map((heading) => heading.textContent),
          singleScreen: root.closest(".pane").scrollHeight <= root.closest(".pane").clientHeight + 1,
          centeredBars: root.querySelectorAll(".pnl-track").length === root.querySelectorAll("[data-row]").length,
          accountToFx: root.querySelector(".overview-fx").getBoundingClientRect().top -
            root.querySelector(".overview-accounts").getBoundingClientRect().bottom,
          chartToBreakdown: root.querySelector(".overview-breakdown").getBoundingClientRect().top -
            root.querySelector(".overview-trend").getBoundingClientRect().bottom,
        }));
        assert.ok(layout.fits && layout.centeredBars, theme + " " + w);
        assert.ok(layout.accountToFx > 0 && layout.accountToFx <= 16, "FX follows Accounts with a card gutter, got " + layout.accountToFx);
        if (state.aspect === "21:9") {
          assert.deepEqual(layout.rail, ["账户", "汇率影响", "盈亏构成"]);
          assert.ok(layout.singleScreen, "the sample Overview fits on one ultrawide screen");
        } else {
          assert.deepEqual(layout.rail, ["账户", "汇率影响"]);
          assert.ok(layout.chartToBreakdown > 0 && layout.chartToBreakdown <= 16, "the breakdown follows the chart");
        }
        if (process.env.STACK_PORTFOLIO_SCREENSHOTS) {
          await page.locator("main").evaluate((el) => el.scrollTo(0, 0));
          await page.screenshot({ path: path.join(process.env.STACK_PORTFOLIO_SCREENSHOTS, theme + "-" + w + ".png") });
        }
      }
    }
    const presetsGroup = overview.getByRole("group", { name: "期间" });
    for (const [label, start] of [["本日", "2026-10-29"], ["本周", "2026-10-23"]]) {
      await presetsGroup.getByRole("button", { name: label, exact: true }).click();
      await kpis.getByText(label + "投资盈亏", { exact: true }).waitFor();
      await chart.focus();
      await chart.press("Home");
      assert.match(await first.innerText(), new RegExp(start));
      await chart.press("End");
      assert.match(await first.innerText(), /2026-10-30/);
      await chart.press("Escape");
    }

    await page.evaluate(async () => {
      const api = window.portfolio;
      const account = await api.account({ name: "Large balances", currency: "AUD" });
      await api.opening({ account, date: "2026-10-29", cash: { AUD: "653421000000.01" }, positions: [] });
      await api.manual({
        account, date: "2026-10-30", type: "INTEREST", amount: "475123987.12", currency: "AUD", reference: "UI layout test",
      });
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1743, 910));
    await page.reload();
    await page.getByText("A$653,896,251,387.13", { exact: true }).waitFor();
    await chart.waitFor();
    assert.ok(await page.locator(".kpi").evaluateAll((cards) => cards.every((card) => card.scrollWidth <= card.clientWidth)));
    assert.ok(await chart.locator('text.ch-axis[text-anchor="end"]').evaluateAll((ticks) =>
      ticks.every((tick) => tick.getBBox().x >= 0)), "Large values must fit inside the y-axis margin");

    await page.evaluate(async () => {
      for (let i = 1; i <= 8; i++)
        await window.portfolio.account({ name: "Additional account " + i, currency: "AUD" });
    });
    await page.reload();
    await resizeContent(app, page, 3440, 1440);
    await overview.getByRole("article", { name: "Additional account 8" }).waitFor();
    assert.ok(await overview.locator(".overview-account-list").evaluate((list) => list.scrollHeight > list.clientHeight));
    assert.ok(await fx.evaluate((card) => card.getBoundingClientRect().bottom <= innerHeight),
      "The FX card stays in view when the account list overflows");

    await app.evaluate(() => { Date.now = () => Date.parse("2026-11-24T11:09Z"); });
    await page.evaluate(async () => {
      const api = window.portfolio;
      await api.newBook();
      await api.marketSettings({ autoUpdate: false });
      const au = await api.account({ name: "Australian holdings", currency: "AUD" });
      const us = await api.account({ name: "US holdings", currency: "USD" });
      await api.opening({ account: au, date: "2026-11-23", positions: [
        { symbol: "IVV", mic: "XASX", currency: "AUD", quantity: "50", price: "70.89" },
      ] });
      await api.opening({ account: us, date: "2026-11-20", cash: { USD: "200" }, positions: [
        { symbol: "AAPL", mic: "XNAS", currency: "USD", quantity: "10", price: "100" },
      ] });
      const { rows } = await api.dashboard({ ids: "all", date: "2026-11-23" });
      const ivv = rows.find((row) => row.ticker === "IVV").assetId;
      const apple = rows.find((row) => row.ticker === "AAPL").assetId;
      await api.savePrice({ assetId: ivv, date: "2026-11-24", price: "72" });
      await api.savePrice({ assetId: apple, date: "2026-11-23", price: "104" });
      await api.savePrice({ from: "USD", date: "2026-11-20", price: "1.50" });
      await api.savePrice({ from: "USD", date: "2026-11-23", price: "1.52" });
    });
    await page.reload();
    const accounts = page.getByRole("region", { name: "账户", exact: true });
    const australia = accounts.getByRole("article", { name: "Australian holdings" });
    const america = accounts.getByRole("article", { name: "US holdings" });
    await australia.getByText("澳股 11/24 15:11").waitFor();
    assert.match(await australia.innerText(), /\+A\$55\.50.*\+1\.57%.*股价.*纯澳元 · 无汇兑/s);
    assert.match(await america.innerText(), /美股 11\/24 07:00.*\+A\$84\.80.*股价.*\+60\.00.*汇率.*\+24\.80/s);
    assert.match(await america.locator(".close-badge").getAttribute("title"), /布里斯班时间 · 按当前持仓和现金计算/);
    assert.match(await fx.innerText(), /最近收盘汇率变动.*\+A\$24\.80.*\+1\.33%.*US\$ 1,240\.00.*±A\$18\.85/s);
    await fx.getByRole("button", { name: /分账户明细/ }).click();
    await page.getByRole("dialog", { name: "汇率影响" }).getByText(/上一笔日汇率 2026-11-20.*1\.5000/).waitFor();
    await page.getByRole("columnheader", { name: "期间汇率盈亏" }).waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByLabel("估值日").fill("2026-11-23");
    await accounts.getByText("收盘变动", { exact: true }).waitFor();
    await fx.getByRole("button", { name: /分账户明细/ }).click();
    await page.getByRole("dialog", { name: "汇率影响" }).getByRole("row", { name: /US holdings.*US\$ 1,040\.00.*US\$ 200\.00/ }).waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.evaluate(async () => {
      const account = await window.portfolio.account({ name: "Unvalued position", currency: "AUD" });
      await window.portfolio.opening({ account, date: "2026-11-20", positions: [
        { symbol: "NOPRICE", mic: "XASX", currency: "AUD", quantity: "100" },
      ] });
    });
    await page.reload();
    const top = page.getByRole("region", { name: "前 5 大持仓" });
    await top.getByText("持仓估值待补，暂无法确定前五大持仓").waitFor();
    assert.equal(await top.locator(".concentration").count(), 0);
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
