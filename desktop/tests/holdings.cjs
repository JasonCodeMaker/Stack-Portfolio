// Run after node build.mjs. Uses the built-in demo in an isolated Electron profile.
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resizeContent } = require("./fixtures/display.cjs");

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
    const packaged = process.argv[2];
    app = await electron.launch({ executablePath: packaged || require("electron"), args: packaged ? [] : [path.join(__dirname, "..")], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(6000);
    await resizeContent(app, page, 1024, 650);
    await page.getByRole("button", { name: "打开示例账本" }).click();
    const nav = page.getByRole("navigation", { name: "页面" });
    await nav.getByRole("button", { name: "持仓", exact: true }).click();
    const webull = page.getByRole("region", { name: "Webull Australia", exact: true });
    const table = webull.getByRole("table");
    await table.getByRole("columnheader", { name: "累计分红", exact: true }).waitFor();
    assert.ok(await webull.evaluate((card) => {
      const inset = card.getBoundingClientRect().left + card.clientLeft + parseFloat(getComputedStyle(card).getPropertyValue("--card-pad"));
      return Math.abs(card.querySelector("h2").getBoundingClientRect().left - inset) < 1 &&
        Math.abs(card.querySelector(".holdings-sort").getBoundingClientRect().left - inset) < 1;
    }), "The account title and first column share the standard card inset");
    assert.ok(await table.evaluate((el) => el.parentElement.scrollWidth === el.parentElement.clientWidth),
      "The compact holdings table fits even with a long ETF name");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720));
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

    await resizeContent(app, page, 2560, 1080);
    const top = page.getByRole("region", { name: "前 5 大持仓" });
    await nav.getByRole("button", { name: "总览", exact: true }).click();
    const header = page.locator("header.head");
    await page.evaluate(async () => {
      const manual = (args) => window.portfolio.manual({ account: "demo-ibkr", currency: "USD", ...args });
      await manual({ date: "2026-10-20", type: "DIVIDEND", symbol: "AAPL", mic: "XNAS", amount: 7, reference: "aapl-dividend" });
      await manual({ date: "2026-10-20", type: "TAX", amount: 2, note: "AAPL(US0378331005) Cash Dividend withholding", reference: "aapl-withholding" });
      await manual({ date: "2026-10-21", type: "FEE", amount: 3, note: "aapl", reference: "unlinked-fee" });
      await manual({ date: "2026-10-29", type: "DIVIDEND", symbol: "AAPL", mic: "XNAS", amount: 9, reference: "later-dividend" });
    });
    await header.getByLabel("估值日").fill("2026-10-27");
    await header.getByText("正在查看 2026-10-27").waitFor();

    await top.getByRole("row", { name: /AAPL.*31,050/ }).waitFor();
    await top.getByRole("button", { name: "IVV", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    const appleLink = top.getByRole("button", { name: "AAPL", exact: true });
    assert.ok(await appleLink.evaluate((button) => button === document.activeElement));
    await appleLink.press("Enter");
    const aapl = page.getByRole("complementary", { name: "AAPL", exact: true });
    await aapl.waitFor();
    assert.equal(await nav.getByRole("button", { name: "总览", exact: true }).getAttribute("aria-current"), "page",
      "Opening a security from the overview must keep the overview active");
    await page.getByRole("main").and(page.locator('[data-cols="2"]')).waitFor();
    assert.equal(await header.getByLabel("估值日").inputValue(), "2026-10-27");
    assert.match(await aapl.getByRole("row", { name: /^合计股数/ }).innerText(), /100/);
    assert.match(await aapl.getByRole("row", { name: /^现价/ }).innerText(), /USD 207\.00/);
    assert.match(await aapl.getByRole("row", { name: /^买入均价/ }).innerText(), /USD 180\.00/);
    await aapl.getByRole("row", { name: /2026-10-20.*税款.*USD 2\.00/ }).waitFor();
    assert.match(await aapl.getByRole("row", { name: /^累计分红/ }).innerText(), /A\$7\.50/);
    assert.equal(await aapl.getByRole("row", { name: /^2026-10-2[19]/ }).count(), 0);
    await page.waitForFunction(() => document.activeElement.textContent === "AAPL");
    await page.keyboard.press("ArrowUp");
    await page.getByRole("complementary", { name: "IVV", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("complementary", { name: "IVV", exact: true }).waitFor({ state: "detached" });
    await page.getByRole("main").and(page.locator('[data-cols="2"]')).waitFor();
    await page.waitForFunction(() => document.activeElement.textContent === "IVV");

    await resizeContent(app, page, 1743, 910);
    await top.getByRole("row", { name: /AAPL.*31,050/ }).getByRole("cell").nth(1).click();
    const overviewDetail = page.getByRole("dialog", { name: "AAPL", exact: true });
    await overviewDetail.getByRole("heading", { name: "关联流水" }).waitFor();
    await overviewDetail.getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(await nav.getByRole("button", { name: "总览", exact: true }).getAttribute("aria-current"), "page");
    await page.waitForFunction(() => document.activeElement.textContent === "AAPL");

    await top.getByRole("button", { name: "查看全部", exact: true }).click();
    await page.getByRole("dialog", { name: "IVV", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(await nav.getByRole("button", { name: "持仓", exact: true }).getAttribute("aria-current"), "page");

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

    await page.evaluate(async () => {
      const api = window.portfolio;
      const account = await api.account({ name: "ASX IVV", currency: "AUD" });
      await api.opening({ account, date: "2026-11-19", cash: { AUD: "10" }, positions: [
        { symbol: "IVV", mic: "XASX", currency: "AUD", kind: "ETF", quantity: "50", price: "73.40" },
      ] });
      const { rows } = await api.dashboard({ ids: "all", date: "2026-11-19" });
      const ivv = rows.find((row) => row.ticker === "IVV" && row.mic === "XASX");
      for (const row of rows.filter((r) => r.type !== "cash")) {
        await api.savePrice({ assetId: row.assetId, date: "2026-11-19", price: row.price });
        await api.savePrice({ assetId: row.assetId, date: "2026-11-20", price: row === ivv ? "71.33" : row.price });
      }
      for (const date of ["2026-11-19", "2026-11-20"])
        await api.savePrice({ from: "USD", date, price: "1.50" });
      await api.savePrice({ assetId: ivv.assetId, date: "2026-11-23", price: "70.89" });
    });
    await page.reload();
    await nav.getByRole("button", { name: "持仓", exact: true }).click();
    const australian = page.getByRole("region", { name: "ASX IVV", exact: true });
    await australian.getByRole("cell", { name: /−0\.62%.*2026-11-23/ }).waitFor();
    await australian.getByRole("button", { name: "IVV", exact: true }).click();
    const australianIvv = page.getByRole("dialog", { name: "IVV", exact: true });
    await australianIvv.getByText("报价涨跌 · 2026-11-23", { exact: true }).waitFor();
    await australianIvv.getByText(/−A\$22\.00.*−0\.62%/).waitFor();
    await australianIvv.getByRole("row", { name: /收盘贡献.*2026-11-20.*−A\$103\.50/ }).waitFor();

    console.log("Overview and holdings security details, valuation-date links, quote currency, ASX quote change, keyboard navigation and cost repair verified.");
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
