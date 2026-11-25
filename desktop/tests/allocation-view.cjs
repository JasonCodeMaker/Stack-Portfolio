// Run after npm run build. Uses an isolated sample book and an offscreen Electron window.
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resizeContent } = require("./fixtures/display.cjs");

async function verify() {
  const root = path.join(__dirname, "..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-allocation-"));
  const env = {
    ...process.env,
    STACK_PORTFOLIO_HEADLESS: "1",
    STACK_PORTFOLIO_TEST_DIR: directory,
    STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv[2];
  let app;
  try {
    app = await electron.launch({
      executablePath: packaged ? path.resolve(packaged) : require("electron"), args: packaged ? [] : [root], env, timeout: 30000,
    });
    const p = await app.firstWindow();
    p.setDefaultTimeout(8000);
    await p.getByRole("button", { name: "打开示例账本" }).click();
    await p.getByRole("heading", { name: "总览", exact: true }).waitFor();

    const cash = "strategy:cash";
    const day = "2026-10-30";
    const dashboard = (ids) => p.evaluate((options) => window.portfolio.dashboard(options), { ids, date: day });
    const save = (ids, targets, tolerance = 0.05) => p.evaluate((args) => window.portfolio.targets(args), { ids, targets, tolerance });
    const ids = (await dashboard("all")).selected;
    await assert.rejects(save(ids, { [cash]: 0.99 }), /100%/);
    await assert.rejects(save(ids, { [cash]: 1 }, 0.004), /0.5/);
    await assert.rejects(save(ids, { [cash]: 1 }, "0.05"), /0.5/);
    await assert.rejects(save(ids, { "mic:XNAS:AAPL": 1 }), /个股合计/);
    await assert.rejects(save(ids, { "strategy:other": 1 }), /个股合计/);
    await save(ids, { [cash]: 1 });
    assert.equal((await dashboard([...ids].reverse())).targets.targets[cash], 1);
    assert.deepEqual((await dashboard([ids[0]])).targets.targets, {});

    const example = await p.evaluate(() => window.portfolio.account({ name: "额外账户", currency: "AUD" }));
    assert.deepEqual((await dashboard("all")).targets.targets, {});
    assert.equal((await dashboard(ids)).targets.targets[cash], 1);
    const nav = p.getByRole("navigation", { name: "页面" });
    await nav.getByRole("button", { name: "配置分析", exact: true }).click();
    await p.getByRole("heading", { name: "钱最终投在哪些公司" }).waitFor();
    const apple = p.getByRole("button", { name: /Apple.*AAPL/ });
    await apple.waitFor();
    assert.equal(await p.getByText("其余成分（示例汇总）", { exact: true }).count(), 0);
    const firstChart = p.locator(".ch-tmap");
    assert.equal(await firstChart.locator(".ch-tm").last().evaluate((tile) => tile.classList.contains("rest")), true);
    await firstChart.locator(".rest b").getByText("其他", { exact: true }).waitFor();
    await apple.focus();
    await p.keyboard.press("Enter");
    const source = p.getByRole("dialog", { name: /Apple/ });
    await source.getByText("直接持有", { exact: true }).waitFor();
    await source.getByText("通过 IVV 持有", { exact: true }).waitFor();
    assert.match(await source.innerText(), /今日涨跌幅\s*▲\s*\+0\.16%/);
    await source.getByRole("button", { name: "直接持有", exact: true }).focus();
    await p.keyboard.press("ArrowDown");
    const fundLink = source.getByRole("button", { name: "通过 IVV 持有", exact: true });
    assert.ok(await fundLink.evaluate((button) => button === document.activeElement));
    await p.keyboard.press("Escape");
    await source.waitFor({ state: "detached" });

    const resize = (w, h) => resizeContent(app, p, w, h);
    await resize(2560, 1080);
    await apple.click();
    await p.getByRole("complementary", { name: /Apple/ }).getByText("通过 IVV 持有", { exact: true }).waitFor();
    await p.keyboard.press("Escape");
    await p.evaluate(async ({ account, date }) => {
      const api = window.portfolio, open = "2026-10-29";
      await api.opening({
        account, date: open, cash: { AUD: "20000" },
        positions: [
          { symbol: "IVV", mic: "XASX", kind: "ETF", quantity: "100", price: "400" },
          { symbol: "AAPL", mic: "XNAS", quantity: "40", price: "98" },
          { symbol: "NVDA", mic: "XNAS", quantity: "349", price: "100" },
          { symbol: "BOND", mic: "XASX", kind: "BOND", quantity: "10", price: "100" },
          { symbol: "NEW", mic: "XASX", kind: "ETF", quantity: "1", price: "100" },
        ].map((r) => ({ ...r, currency: "AUD" })),
      });
      const d = await api.dashboard({ ids: [account], date });
      await api.savePrice({ assetId: d.rows.find((r) => r.ticker === "AAPL").assetId, date, price: 100 });
      await api.fundSave({
        snapshot: {
          schemaVersion: 2, etfKey: d.rows.find((r) => r.ticker === "IVV").etfKey, provider: "样例成分", asOfDate: open, fetchedAt: open + "T05:00:00Z",
          holdings: [
            { symbol: "AAPL", name: "Apple", weight: 0.075, mic: "XNAS", sector: "Technology", country: "United States", underlyingType: "stock" },
            { symbol: "CBA", name: "Commonwealth Bank", weight: 0.925, mic: "XASX", sector: "Financials", country: "Australia", underlyingType: "stock" },
          ],
        },
      });
    }, { account: example, date: day });

    await p.getByLabel("估值日").fill("2026-10-29");
    await p.getByText("正在查看 2026-10-29").waitFor();
    await p.getByLabel("估值日").fill(day);
    await p.getByRole("button", { name: "账户范围 · 全部账户", exact: true }).click();
    const accounts = p.getByRole("dialog", { name: "账户范围" });
    await accounts.getByLabel("IBKR").uncheck();
    await accounts.getByLabel("Webull Australia").uncheck();
    await accounts.getByLabel("额外账户").check();
    await accounts.getByRole("button", { name: "应用", exact: true }).click();
    await p.getByRole("button", { name: "账户范围 · 额外账户", exact: true }).waitFor();

    const fixture = await dashboard([example]);
    assert.equal(fixture.portfolio.totalAud, 100_000);
    const company = fixture.exposure.rows.find((r) => r.ticker === "AAPL");
    assert.deepEqual([company.directAud, company.viaEtfsAud, company.totalAud], [4_000, 3_000, 7_000]);
    const pricedApple = p.getByRole("button", { name: /Apple.*AAPL.*7[.]0%/ });
    await pricedApple.click();
    const breakdown = p.getByRole("complementary", { name: /Apple/ });
    await breakdown.getByText("A$4,000.00", { exact: true }).waitFor();
    await breakdown.getByText("A$3,000.00", { exact: true }).waitFor();
    await p.keyboard.press("Escape");
    await breakdown.waitFor({ state: "detached" });
    const chart = p.getByRole("region", { name: "钱最终投在哪些公司" });
    assert.match(await chart.innerText(), /前五大公司合计\s*78.9%/);
    assert.match(await chart.innerText(), /成分待更新[\s\S]*NEW[\s\S]*A\$100.00/);
    assert.equal(await chart.locator(".ch-tmap").count(), 1);
    const views = chart.getByRole("group", { name: "公司敞口图" });
    const colors = chart.getByRole("group", { name: "方框着色" });
    await colors.getByRole("button", { name: "持有方式" }).click();
    assert.match(await pricedApple.evaluate((button) => getComputedStyle(button).backgroundImage), /linear-gradient\(90deg,.+57\.1429%/);
    await chart.locator(".alloc-key").getByText("通过 ETF", { exact: true }).waitFor();
    await views.getByRole("button", { name: "条形" }).click();
    assert.equal(await chart.locator(".ch-tmap").count(), 0);
    assert.equal(await colors.count(), 0);
    const bars = chart.locator(".alloc-company-bar");
    assert.equal(await bars.count(), 5);
    assert.match(await bars.first().innerText(), /CBA/);
    assert.match(await bars.last().innerText(), /其他\s*1\.1%/);
    await pricedApple.locator(".ch-stack").waitFor();
    await pricedApple.press("Enter");
    await breakdown.getByText("A$3,000.00", { exact: true }).waitFor();
    await p.keyboard.press("Escape");
    await breakdown.waitFor({ state: "detached" });
    await views.getByRole("button", { name: "方框图" }).click();
    await colors.getByRole("button", { name: "持有方式", pressed: true }).waitFor();
    await colors.getByRole("button", { name: "今日涨跌" }).click();
    assert.equal(await chart.locator(".alloc-company-bars").count(), 0);
    const tiles = chart.locator(".ch-tmap .ch-tm");
    assert.equal(await tiles.count(), 5);
    assert.deepEqual(await chart.locator(".ch-tm:not(.rest) b").allTextContents(), ["CBA", "NVDA", "现金", "AAPL"]);
    assert.equal(await tiles.filter({ hasText: /AAPL.*7\.0%/ }).count(), 1);
    const other = chart.locator(".ch-tm.rest");
    assert.equal(await other.count(), 1);
    const otherShare = other.getByText("1.1%", { exact: true }).or(chart.getByText("其他 1.1%", { exact: true }));
    await otherShare.waitFor();
    await resize(1024, 640);
    await otherShare.waitFor();
    await chart.getByRole("button", { name: /Apple.*AAPL.*7[.]0%/ }).waitFor();
    assert.ok(await tiles.locator("span").evaluateAll((lines) => lines.every((line) => {
      const bounds = line.getBoundingClientRect(), tile = line.closest(".ch-tm").getBoundingClientRect();
      return bounds.left >= tile.left && bounds.right <= tile.right && bounds.top >= tile.top && bounds.bottom <= tile.bottom;
    })));
    await resize(1920, 1080);

    const edit = p.getByRole("button", { name: "设置目标", exact: true });
    await edit.click();
    const targets = p.getByRole("dialog", { name: "设置目标" });
    const saveButton = targets.getByRole("button", { name: "保存目标" });
    assert.equal(await targets.getByLabel("允许偏离（百分点）").inputValue(), "5");
    await targets.getByLabel("IVV 目标（%）").fill("45");
    await targets.getByLabel("个股 目标（%）").fill("35");
    assert.equal(await saveButton.isEnabled(), false);
    await targets.getByLabel("现金 目标（%）").fill("20");
    assert.equal(await saveButton.isEnabled(), true);
    assert.equal(await targets.getByLabel("其他投资 目标（%）").count(), 0);
    await saveButton.click();
    const target = p.getByRole("region", { name: "IVV", exact: true });
    await target.getByText("不用调", { exact: true }).waitFor();
    assert.match(await target.innerText(), /低于目标 5.0 个百分点/);
    await edit.click();
    await targets.getByLabel("IVV 目标（%）").fill("46");
    await targets.getByLabel("个股 目标（%）").fill("34");
    await saveButton.click();
    await target.getByText("买入 A$6,000", { exact: true }).waitFor();
    assert.match(await target.innerText(), /低于目标 6.0 个百分点/);
    assert.match(await p.getByRole("region", { name: "其他投资", exact: true }).innerText(), /A\$1,000/);
    await p.evaluate(async () => {
      const api = window.portfolio;
      const account = await api.account({ name: "集中持仓", currency: "AUD" });
      await api.opening({
        account, date: "2026-10-29", cash: {},
        positions: [
          { symbol: "LARGE", mic: "XNAS", kind: "STOCK", quantity: "989", price: "10", currency: "AUD" },
          { symbol: "SMALL", mic: "XNAS", kind: "STOCK", quantity: "11", price: "10", currency: "AUD" },
        ],
      });
    });
    await p.getByLabel("估值日").fill("2026-10-29");
    await p.getByText("正在查看 2026-10-29").waitFor();
    await p.getByRole("button", { name: "账户范围 · 额外账户", exact: true }).click();
    await accounts.getByLabel("额外账户").uncheck();
    await accounts.getByLabel("集中持仓").check();
    await accounts.getByRole("button", { name: "应用", exact: true }).click();
    await resize(1024, 640);
    const smallLabel = chart.locator(".ch-tm-labels").getByRole("button", { name: /SMALL.*1\.1%/ });
    await smallLabel.waitFor();
    const leader = chart.locator(".ch-tm-leaders g");
    await leader.locator("path").waitFor();
    await smallLabel.focus();
    await chart.locator(".ch-tm-leaders g.on").waitFor();
    await chart.locator('.ch-tm.on[title*="SMALL"]').waitFor();
    const connected = await leader.evaluate((group) => {
      const circle = group.querySelector("circle"), overlay = group.ownerSVGElement.getBoundingClientRect();
      const tile = document.querySelector('.ch-tmap [title*="SMALL"]').getBoundingClientRect();
      const x = overlay.left + circle.cx.baseVal.value, y = overlay.top + circle.cy.baseVal.value;
      return Math.abs(x - (tile.left + tile.width / 2)) < 1 && Math.abs(y - (tile.top + tile.height / 2)) < 1;
    });
    assert.ok(connected);
    await smallLabel.press("Enter");
    await p.getByRole("dialog", { name: /SMALL/ }).waitFor();
    console.log("Allocation targets, company sources and chart label callouts verified in the app.");
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
