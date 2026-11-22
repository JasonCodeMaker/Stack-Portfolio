// End-to-end check of the settings page (spec §4.6) and the welcome page (spec §4.7) in the built app.
// Usage: node build.mjs && node tests/settings-welcome.cjs   (not part of `npm test`; launches headless Electron)
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const root = path.join(__dirname, ".."),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-settings-"));
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
    app = await electron.launch({ executablePath: require("electron"), args: [root], env, timeout: 30000 });
    const p = await app.firstWindow();
    p.setDefaultTimeout(10000);
    const resize = async (w, h) => {
      await app.evaluate(({ BrowserWindow }, [w, h]) => {
        const win = BrowserWindow.getAllWindows()[0];
        // The window minimum (1024 × 640) would stop the narrow welcome check.
        win.setMinimumSize(1, 1);
        win.setContentSize(w, h);
      }, [w, h]);
      await p.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [w, h]);
      await p.waitForTimeout(150);
    };
    const boxes = (selector) => p.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));

    // Welcome: no sidebar or page head; the two cards sit side by side at 1280 and stack below 900.
    await p.getByRole("button", { name: "打开示例账本" }).waitFor();
    assert.equal(await p.locator(".side, .head, .header-tools").count(), 0);
    await resize(1280, 720);
    let [main, sample] = await boxes(".wc > .card");
    assert.equal(main.top, sample.top, "cards side by side at 1280");
    assert.ok(main.width > sample.width, "the ledger card is the wider one");
    await resize(860, 700);
    [main, sample] = await boxes(".wc > .card");
    assert.equal(main.left, sample.left, "cards stacked below 900");
    assert.ok(sample.top >= main.bottom);
    await resize(1440, 900);

    // Settings: three tabs, cards in one column up to 880 wide; no global filters in the page head.
    await p.getByRole("button", { name: "打开示例账本" }).click();
    await p.getByRole("button", { name: "设置", exact: true }).click();
    await p.getByRole("heading", { name: "设置", exact: true }).waitFor();
    assert.equal(await p.locator(".header-tools").count(), 0);
    const tabs = p.getByRole("group", { name: "设置页签" });
    assert.deepEqual(await tabs.getByRole("button").allInnerTexts(), ["券商连接", "账本", "数据"]);
    await p.getByText("正式账本可保存券商授权。示例账本使用随附样例。").waitFor();
    const ibkr = p.getByRole("region", { name: "Interactive Brokers" });
    assert.match(await ibkr.innerText(), /示例连接[\s\S]*立即更新/);
    let [column] = await boxes(".settings .stack");
    assert.ok(column.width <= 880, "one column up to 880 wide, got " + column.width);

    // Two columns, together at most 1760 wide, once the content area allows it.
    await resize(1920, 1080);
    await p.waitForFunction(() => document.querySelectorAll(".settings .cols > .col").length === 2);
    await resize(3440, 1440);
    [column] = await boxes(".settings .cols");
    assert.ok(column.width <= 1760, "two columns up to 1760 wide, got " + column.width);
    assert.equal(await p.locator(".settings .cols > .col").count(), 2);
    await resize(1440, 900);

    // Confirmations open in dialogs.
    await p.getByRole("button", { name: "选择重置" }).click();
    const reset = p.getByRole("dialog", { name: "重置同步标记" });
    await reset.getByRole("button", { name: "取消" }).click();
    await reset.waitFor({ state: "detached" });

    await tabs.getByRole("button", { name: "账本", exact: true }).click();
    await p.getByRole("region", { name: "当前账本" }).waitFor();
    await p.getByRole("region", { name: "账户" }).getByRole("button", { name: "创建账户" }).waitFor();
    await p.getByRole("button", { name: "备份账本", exact: true }).click();
    await p.getByRole("dialog", { name: "设置备份密码" }).waitFor();
    await p.keyboard.press("Escape");
    await p.getByRole("dialog").waitFor({ state: "detached" });

    await tabs.getByRole("button", { name: "数据", exact: true }).click();
    await p.getByRole("region", { name: "维护结单报价" }).waitFor();
    await p.getByText("更正证券类别及基金成分匹配").waitFor();
    const label = await p
      .locator("label.f")
      .filter({ has: p.locator("span", { hasText: /^证券$/ }) })
      .locator("option")
      .evaluateAll((o) => o.map((x) => x.textContent));
    assert.ok(label.some((x) => /^Apple · AAPL · 美国 Nasdaq · USD$/.test(x)), label.join(" | "));

    // The ledger button returns to the welcome page, which offers the way back.
    await p.getByRole("button", { name: /^切换账本/ }).click();
    await p.getByRole("button", { name: "返回当前账本" }).click();
    await p.getByRole("heading", { name: "设置", exact: true }).waitFor();

    console.log("Settings and welcome verified: tabs, card columns, dialogs, welcome without shell, card stacking.");
  } catch (e) {
    if (app) {
      const p = await app.firstWindow();
      console.error((await p.locator("body").innerText()).slice(0, 600));
    }
    throw e;
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
