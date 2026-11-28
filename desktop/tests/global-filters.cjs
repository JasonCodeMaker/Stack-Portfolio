// End-to-end check of the global filters (spec §2.3): account scope and valuation date in the page head,
// the shared period control, what a restart remembers and what switching the book resets.
// Usage: node build.mjs && node tests/global-filters.cjs   (not part of `npm test`; launches headless Electron)
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const root = path.join(__dirname, ".."),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-filters-"));
const env = {
  ...process.env,
  STACK_PORTFOLIO_HEADLESS: "1",
  STACK_PORTFOLIO_TEST_DIR: directory,
  STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
};
delete env.ELECTRON_RUN_AS_NODE;

// A first launch shows the onboarding page before the welcome page.
async function skipOnboarding(page) {
  const home = await page.evaluate(() => window.portfolio.home());
  if (!home.mode && !home.hasReal && !home.onboardingSeen) await page.getByRole("button", { name: "暂时跳过" }).click();
}
async function launch() {
  const app = await electron.launch({ executablePath: require("electron"), args: [root], env, timeout: 30000 });
  const p = await app.firstWindow();
  p.setDefaultTimeout(10000);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  return { app, p };
}

(async () => {
  let app;
  try {
    let p;
    ({ app, p } = await launch());
    await skipOnboarding(p);

    await p.getByRole("button", { name: "打开示例账本" }).click();
    await p.getByRole("heading", { name: "总览", exact: true }).waitFor();
    let head = p.locator("header.head");
    const page = (name) => p.getByRole("navigation", { name: "页面" }).getByRole("button", { name, exact: true }).click();
    const preset = (name) => p.getByRole("group", { name: "期间" }).getByRole("button", { name, exact: true });
    const pressed = () =>
      p.getByRole("group", { name: "期间" }).locator("button[aria-pressed=true]").allInnerTexts();

    // The four analysis pages carry the account scope and the valuation date; the maintenance pages do not.
    for (const name of ["总览", "收益复盘", "配置分析", "持仓"]) {
      await page(name);
      await p.getByRole("heading", { name, exact: true }).waitFor();
      await head.getByRole("button", { name: "账户范围 · 全部账户" }).waitFor();
      assert.equal(await head.getByLabel("估值日").count(), 1, name);
      assert.match(await head.locator(".date-pick").innerText(), /今天/);
    }
    for (const name of ["导入与对账", "设置"]) {
      await page(name);
      await p.getByRole("heading", { name, exact: true }).waitFor();
      assert.equal(await head.locator(".header-tools").count(), 0, name);
    }

    // The overview opens on 今年以来.
    await page("总览");
    assert.deepEqual(await pressed(), ["今年以来"]);
    const labels = ["本日", "本周", "本月", "近 3 月", "近 6 月", "今年以来", "近一年", "全部"];
    assert.deepEqual(await p.getByRole("group", { name: "期间" }).getByRole("button").allTextContents(), labels);
    for (const label of labels) {
      await preset(label).click();
      await p.getByRole("region", { name: "关键数字" }).getByText(label + "投资盈亏", { exact: true }).waitFor();
      assert.deepEqual(await pressed(), [label]);
    }
    await page("收益复盘");
    assert.deepEqual(await pressed(), ["全部"]);
    await preset("本周").click();
    await page("总览");
    assert.deepEqual(await pressed(), ["本周"]);
    await preset("今年以来").click();

    await head.getByRole("button", { name: "账户范围 · 全部账户" }).focus();
    await p.keyboard.press("Tab");
    assert.ok(await head.getByLabel("估值日").evaluate((input) => input === document.activeElement));
    assert.equal(await head.locator(".date-pick").evaluate((label) => getComputedStyle(label).outlineStyle), "solid");

    // A past valuation date shows 「正在查看」 beside the title until 回到今天.
    await head.getByLabel("估值日").fill("2025-12-31");
    await head.getByText("正在查看 2025-12-31").waitFor();
    assert.match(await head.locator(".date-pick").innerText(), /2025-12-31/);
    await head.getByRole("button", { name: "回到今天" }).click();
    await head.getByText("正在查看").waitFor({ state: "detached" });
    assert.match(await head.locator(".date-pick").innerText(), /今天/);

    // A custom range set on the review: on the overview no preset is selected and 「起 至 止 ✕」 shows.
    await page("收益复盘");
    await preset("自定义…").click();
    await p.getByLabel("期间起点").fill("2026-10-05");
    await p.getByLabel("期间终点").fill("2026-10-20");
    await p.waitForFunction(() => document.querySelector("[aria-label=期间终点]")?.value === "2026-10-20");
    await page("总览");
    await p.locator(".range-chip").getByText("2026-10-05 至 2026-10-20").waitFor();
    assert.deepEqual(await pressed(), []);
    await p.getByRole("button", { name: "回到预设期间" }).click();
    await p.locator(".range-chip").waitFor({ state: "detached" });
    assert.deepEqual(await pressed(), ["今年以来"]);

    // Account scope one account, period 本月, valuation date in the past — then restart.
    await head.getByRole("button", { name: "账户范围 · 全部账户" }).click();
    const dialog = p.getByRole("dialog", { name: "账户范围" });
    await dialog.getByLabel("Webull Australia").uncheck();
    await dialog.getByRole("button", { name: "应用" }).click();
    await head.getByRole("button", { name: "账户范围 · IBKR" }).waitFor();
    await preset("本月").click();
    await p.waitForFunction(() => document.querySelector("[aria-pressed=true]")?.textContent === "本月");
    await head.getByLabel("估值日").fill("2026-10-20");
    await head.getByText("正在查看 2026-10-20").waitFor();
    await app.close();

    ({ app, p } = await launch());
    head = p.locator("header.head");
    await p.getByRole("heading", { name: "总览", exact: true }).waitFor();
    await head.getByRole("button", { name: "账户范围 · IBKR" }).waitFor();
    assert.deepEqual(await pressed(), ["本月"]);
    assert.equal(await head.getByText("正在查看").count(), 0);
    assert.match(await head.locator(".date-pick").innerText(), /今天/);

    // Switching the book returns all three filters to their defaults.
    await head.getByLabel("估值日").fill("2026-10-20");
    await head.getByText("正在查看 2026-10-20").waitFor();
    await p.getByRole("button", { name: "切换账本 · 示例账本" }).click();
    await skipOnboarding(p);

    await p.getByRole("button", { name: "打开示例账本" }).click();
    await head.getByRole("button", { name: "账户范围 · 全部账户" }).waitFor();
    assert.deepEqual(await pressed(), ["今年以来"]);
    assert.equal(await head.getByText("正在查看").count(), 0);

    // A valid long account name reflows in the account list and stays inside the page head.
    const longName = "Portfolio " + "W".repeat(109);
    await p.evaluate((name) => window.portfolio.account({ name, currency: "AUD" }), longName);
    await p.reload();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 640));
    await head.getByRole("button", { name: "账户范围 · 全部账户" }).click();
    const accounts = p.getByRole("dialog", { name: "账户范围" });
    assert.ok(await accounts.evaluate((el) => el.scrollWidth <= el.clientWidth));
    await accounts.getByLabel("IBKR", { exact: true }).uncheck();
    await accounts.getByLabel("Webull Australia").uncheck();
    await accounts.getByLabel(longName).check();
    await accounts.getByRole("button", { name: "应用", exact: true }).click();
    await head.getByRole("button", { name: "账户范围 · " + longName }).waitFor();
    await head.getByLabel("估值日").fill("2025-12-31");
    await head.getByText("正在查看 2025-12-31").waitFor();
    assert.ok(await head.evaluate((el) => el.scrollWidth <= el.clientWidth));

    await p.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "导入与对账", exact: true }).click();
    const checkTab = p.getByRole("button", { name: "和券商结单核对", exact: true });
    await checkTab.click();
    const account = p.getByRole("main").getByLabel("账本账户");
    await account.selectOption({ label: longName });
    assert.ok(await p.getByRole("main").evaluate((el) => el.scrollWidth <= el.clientWidth),
      "Long account names must not widen the imports page");
    const [tabBox, accountBox] = await Promise.all([checkTab.boundingBox(), account.boundingBox()]);
    assert.ok(Math.abs(tabBox.y + tabBox.height / 2 - accountBox.y - accountBox.height / 2) < 1,
      "The account selector stays aligned with the import tabs");

    console.log("Global filters verified: page head, as-of chip, shared period, restart memory and book switch.");
  } catch (e) {
    if (app) {
      const p = await app.firstWindow();
      console.error((await p.locator("body").innerText()).slice(0, 800));
    }
    throw e;
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
