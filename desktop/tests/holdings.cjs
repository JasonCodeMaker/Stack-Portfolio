// Run after node build.mjs. Uses the built-in demo in an isolated Electron profile.
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-holdings-"));
const env = {
  ...process.env,
  STACK_PORTFOLIO_HEADLESS: "1",
  STACK_PORTFOLIO_TEST_DIR: directory,
  STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
};
delete env.ELECTRON_RUN_AS_NODE;

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require("electron"), args: [path.join(__dirname, "..")], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(6000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720));
    await page.getByRole("button", { name: "打开示例账本" }).click();
    const nav = page.getByRole("navigation", { name: "页面" });
    await nav.getByRole("button", { name: "持仓", exact: true }).click();
    const webull = page.getByRole("region", { name: "Webull Australia", exact: true });
    const bhp = webull.getByRole("row", { name: /^BHP\b/ });
    await bhp.waitFor();
    assert.match(await bhp.innerText(), /A\$6,160\.00/);
    assert.equal(await bhp.getByText("待补", { exact: true }).count(), 2);
    assert.match(await webull.getByRole("row").last().innerText(), /现金\s+A\$7,040\.00/);
    await page.getByRole("button", { name: "股票", exact: true }).click();
    assert.equal(await webull.getByRole("button", { name: "A200", exact: true }).count(), 0);
    assert.match(await webull.getByRole("row").last().innerText(), /现金/);
    await page.getByRole("searchbox", { name: "搜索持仓" }).fill("BHP");
    assert.equal(await page.getByRole("main").getByRole("button", { name: "AAPL", exact: true }).count(), 0);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080));
    const top = page.getByRole("region", { name: "前 5 大持仓" });
    await nav.getByRole("button", { name: "总览", exact: true }).click();
    const header = page.locator("header.head");
    await header.getByLabel("估值日").fill("2026-10-27");
    await header.getByText("正在查看 2026-10-27").waitFor();

    await top.getByRole("row", { name: /AAPL.*31,050/ }).waitFor();
    await top.getByRole("button", { name: "AAPL", exact: true }).click();
    const aapl = page.getByRole("complementary", { name: "AAPL", exact: true });
    await aapl.waitFor();
    assert.equal(await page.getByRole("main").getAttribute("data-cols"), "1");
    assert.equal(await header.getByLabel("估值日").inputValue(), "2026-10-27");
    assert.match(await aapl.getByRole("row", { name: /^合计股数/ }).innerText(), /100/);
    assert.match(await aapl.getByRole("row", { name: /^现价/ }).innerText(), /USD 207\.00/);
    assert.match(await aapl.getByRole("row", { name: /^买入均价/ }).innerText(), /USD 180\.00/);
    await page.waitForFunction(() => document.activeElement.textContent === "AAPL");
    await page.keyboard.press("ArrowUp");
    await page.getByRole("complementary", { name: "IVV", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("complementary", { name: "IVV", exact: true }).waitFor({ state: "detached" });
    await page.getByRole("main").and(page.locator('[data-cols="2"]')).waitFor();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720));
    await page.getByRole("region", { name: "IBKR", exact: true }).getByRole("button", { name: "AAPL", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "AAPL", exact: true });
    await modal.waitFor();
    await page.keyboard.press("ArrowUp");
    await page.getByRole("dialog", { name: "IVV", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "IVV", exact: true }).waitFor({ state: "detached" });

    const stock = page.getByRole("button", { name: "股票", exact: true });
    await stock.click();
    const search = page.getByRole("searchbox", { name: "搜索持仓" });
    await search.fill("bhp");
    const sort = webull.getByRole("button", { name: "按证券排序" });
    await sort.click();
    await bhp.click();
    const detail = page.getByRole("dialog", { name: "BHP", exact: true });
    await detail.getByRole("button", { name: "补成本", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "补成本 · BHP", exact: true });
    assert.equal(await editor.getByLabel("成本凭据日期").inputValue(), "2026-10-27");
    await editor.getByText("Webull Australia · BHP Group · 140 股／份", { exact: true }).waitFor();
    await editor.getByLabel("这些股数的总买入成本（AUD，含买入费用）").fill("5600");
    await editor.getByLabel("凭据（如券商结单日期或编号）").fill("Demo cost receipt");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    await detail.waitFor({ state: "detached" });
    assert.equal(await search.inputValue(), "bhp");
    assert.equal(await stock.getAttribute("aria-pressed"), "true");
    assert.equal(await sort.locator("..").getAttribute("aria-sort"), "ascending");
    assert.match(await bhp.innerText(), /A\$5,600\.00/);
    assert.match(await bhp.innerText(), /\+A\$560\.00/);
    await page.waitForFunction(() => document.activeElement.textContent === "BHP");

    console.log("Holdings account cards, valuation-date links, quote currency, adaptive details, keyboard navigation and cost repair verified.");
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
