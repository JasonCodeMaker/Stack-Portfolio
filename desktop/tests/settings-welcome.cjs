// End-to-end check of the settings page (spec §4.6) and the welcome page (spec §4.7) in the built app.
// Usage: node build.mjs && node tests/settings-welcome.cjs [app.exe]   (launches headless Electron)
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { resizeContent } = require("./fixtures/display.cjs");
const root = path.join(__dirname, ".."),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-settings-"));
const env = {
  ...process.env,
  STACK_PORTFOLIO_HEADLESS: "1",
  STACK_PORTFOLIO_LOCALE: process.env.STACK_PORTFOLIO_LOCALE || "zh-CN",
  STACK_PORTFOLIO_TEST_DIR: directory,
  STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
};
delete env.ELECTRON_RUN_AS_NODE;

const packaged = process.argv[2];
const launch = (overrideEnv = {}) => electron.launch({
  executablePath: packaged ? path.resolve(packaged) : require("electron"),
  args: packaged ? [] : [root],
  env: { ...env, ...overrideEnv },
  timeout: 30000,
});
const themeControl = (p) => p.getByRole("combobox", { name: "主题", exact: true });
const languageControl = (p, label = /语言|Language|語言/) => p.getByRole("combobox", { name: label });
const waitForTheme = (p, dark) => p.waitForFunction(
  (background) => getComputedStyle(document.body).backgroundColor === background,
  dark ? "rgb(14, 20, 16)" : "rgb(236, 241, 234)",
);
async function selectTheme(p, source, dark) {
  await themeControl(p).selectOption(source);
  assert.equal((await p.evaluate(() => window.portfolio.home())).theme, source);
  await waitForTheme(p, dark);
}

async function verifyOverviewContrast(p) {
  await p.getByRole("button", { name: "总览", exact: true }).click();
  const total = p.getByRole("button", { name: /^总资产 A\$/ });
  const check = () => total.evaluate((el) => {
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const luminance = (color) => {
      canvas.fillStyle = color;
      canvas.fillRect(0, 0, 1, 1);
      return Array.from(canvas.getImageData(0, 0, 1, 1).data).slice(0, 3)
        .map((n) => n / 255)
        .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
        .reduce((sum, n, index) => sum + n * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const background = luminance(getComputedStyle(el).backgroundColor);
    const foreground = luminance(getComputedStyle(el.querySelector(".v")).color);
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  });
  await p.mouse.move(0, 0);
  assert.ok(await check() >= 4.5, "The total assets value must be readable");
  await total.hover();
  assert.ok(await check() >= 4.5, "The total assets value must stay readable on hover");
  await p.getByRole("button", { name: "设置", exact: true }).click();
}

(async () => {
  let app;
  try {
    app = await launch();
    const p = await app.firstWindow();
    p.setDefaultTimeout(10000);
    const home = await p.evaluate(() => window.portfolio.home());
    if (!home.mode && !home.hasReal && !home.onboardingSeen)
      await p.getByRole("button", { name: /^(暂时跳过|Skip for now|暫時略過)$/ }).click();
    // Use Electron's color scheme for this test.
    await p.emulateMedia({ colorScheme: null, reducedMotion: "reduce" });
    const systemDark = await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    const resize = (w, h) => resizeContent(app, p, w, h);
    const boxes = (selector) => p.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));

    // Welcome: no sidebar or page head; the two cards sit side by side at 1280 and stack below 900.
    await p.getByRole("button", { name: "打开示例账本" }).waitFor();
    assert.equal(await p.locator(".side, .head, .header-tools").count(), 0);
    await resize(1280, 720);
    let [main, sample] = await boxes(".wc > .card");
    assert.equal(main.top, sample.top, "cards side by side at 1280");
    assert.ok(main.width > sample.width, "the ledger card is the wider one");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(1, 1));
    await resize(600, 500);
    [main, sample] = await boxes(".wc > .card");
    assert.equal(main.left, sample.left, "cards stacked below 900");
    assert.ok(sample.top >= main.bottom);
    await resize(1440, 900);

    // Settings uses one column in 16:9 and keeps filters out of the page head.
    await p.getByRole("button", { name: "打开示例账本" }).click();
    await p.getByRole("button", { name: "设置", exact: true }).click();
    await p.getByRole("heading", { name: "设置", exact: true }).waitFor();
    assert.equal(await p.locator(".header-tools").count(), 0);
    const tabs = p.getByRole("group", { name: "设置页签" });
    assert.deepEqual(await tabs.getByRole("button").allInnerTexts(), ["券商连接", "账本", "数据"]);
    const theme = themeControl(p);
    assert.equal(await theme.inputValue(), "system");
    assert.deepEqual(await theme.getByRole("option").allTextContents(), ["跟随系统", "浅色", "深色"]);
    await waitForTheme(p, systemDark);
    await selectTheme(p, "light", false);
    await verifyOverviewContrast(p);
    await selectTheme(p, "dark", true);
    await verifyOverviewContrast(p);
    await p.getByText("正式账本可保存券商授权。示例账本使用随附样例。").waitFor();
    const market = p.getByRole("region", { name: "行情自动更新" });
    await market.getByRole("button", { name: "立即更新行情" }).waitFor();
    assert.equal(await p.getByText("其他行情来源", { exact: true }).count(), 0);
    assert.equal(await p.evaluate(() => "refreshMarket" in window.portfolio), false);
    const ibkr = p.getByRole("region", { name: "Interactive Brokers" });
    assert.match(await ibkr.innerText(), /示例连接[\s\S]*立即更新/);
    let [column] = await boxes(".settings .stack");
    assert.ok(column.width <= 1241, "one column up to 1240 wide, got " + column.width);

    // The ultrawide operational grid uses two columns up to 1820 wide.
    await resize(2560, 1080);
    await p.waitForFunction(() => document.querySelectorAll(".settings .cols > .col").length === 2);
    await resize(3440, 1440);
    [column] = await boxes(".settings .cols");
    assert.ok(column.width <= 1821, "two columns up to 1820 wide, got " + column.width);
    const [notice] = await boxes(".settings > .notice");
    assert.deepEqual([notice.left, notice.right], [column.left, column.right], "The notice shares the card grid gutters");
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
    const backup = p.getByRole("dialog", { name: "设置备份密码" });
    await backup.waitFor();
    assert.ok(await backup.evaluate((el) => el.scrollWidth <= el.clientWidth), "The backup dialog fits without horizontal scroll");
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
    await waitForTheme(p, true);
    await p.getByRole("button", { name: "返回当前账本" }).click();
    await p.getByRole("heading", { name: "设置", exact: true }).waitFor();
    assert.equal(await theme.inputValue(), "dark");

    // The selected theme applies at startup before the settings page is reopened.
    await app.close();
    app = null;
    app = await launch();
    const reopened = await app.firstWindow();
    reopened.setDefaultTimeout(10000);
    await reopened.emulateMedia({ colorScheme: null });
    await reopened.getByRole("heading", { name: "总览", exact: true }).waitFor();
    await waitForTheme(reopened, true);
    await reopened.getByRole("button", { name: "设置", exact: true }).click();
    assert.equal(await themeControl(reopened).inputValue(), "dark");
    await selectTheme(reopened, "system", systemDark);

    // Live language switching without restart & persistence across restart.
    await languageControl(reopened).selectOption("en");
    await reopened.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    assert.equal(await reopened.evaluate(() => document.documentElement.lang), "en");
    assert.deepEqual(
      await reopened.getByRole("group", { name: "Settings tabs" }).getByRole("button").allInnerTexts(),
      ["Connections", "Ledger", "Data"],
    );

    await languageControl(reopened).selectOption("zh-TW");
    await reopened.getByRole("heading", { name: "設定", exact: true }).waitFor();
    assert.equal(await reopened.evaluate(() => document.documentElement.lang), "zh-TW");
    assert.deepEqual(
      await reopened.getByRole("group", { name: "設定頁籤" }).getByRole("button").allInnerTexts(),
      ["券商連線", "帳本", "資料"],
    );
    await app.close();
    app = null;

    app = await launch();
    const persisted = await app.firstWindow();
    persisted.setDefaultTimeout(10000);
    await persisted.getByRole("heading", { name: "總覽", exact: true }).waitFor();
    assert.equal(await persisted.evaluate(() => document.documentElement.lang), "zh-TW");
    await persisted.getByRole("button", { name: "設定", exact: true }).click();
    assert.equal(await languageControl(persisted).inputValue(), "zh-TW");
    await languageControl(persisted).selectOption("en");
    await persisted.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    // Verify English 21:9 Overview fits on a single screen without vertical scroll.
    await persisted.getByRole("button", { name: "Overview", exact: true }).click();
    await persisted.getByRole("heading", { name: "Overview", exact: true }).waitFor();
    await resizeContent(app, persisted, 2560, 1080);
    await persisted.waitForFunction(() => document.querySelector(".pane")?.dataset.cols === "2");
    const enOverflow = await persisted.evaluate(() => {
      const pane = document.querySelector(".pane");
      return pane.scrollHeight - pane.clientHeight;
    });
    assert.ok(enOverflow <= 1, `English 21:9 Overview overflowed by ${enOverflow}px`);
    await app.close();
    app = null;

    // System fallback: unsupported locale falls back to English; onboarding & Welcome switcher work immediately.
    const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-i18n-fallback-"));
    let fallbackApp;
    try {
      fallbackApp = await launch({
        STACK_PORTFOLIO_TEST_DIR: fallbackDir,
        STACK_PORTFOLIO_TEST_SOURCE: path.join(fallbackDir, "empty"),
        STACK_PORTFOLIO_LOCALE: "fr-FR",
      });
      const wp = await fallbackApp.firstWindow();
      wp.setDefaultTimeout(10000);
      await wp.getByRole("button", { name: "Skip for now" }).waitFor();
      assert.equal(await wp.evaluate(() => document.documentElement.lang), "en");
      await wp.getByRole("button", { name: "Skip for now" }).click();
      await wp.getByRole("button", { name: /^Open Sample Ledger/ }).waitFor();
      assert.equal(await wp.evaluate(() => document.documentElement.lang), "en");
      assert.equal(await languageControl(wp).inputValue(), "system");
      await languageControl(wp).selectOption("zh-TW");
      await wp.getByRole("heading", { name: "開啟投資帳本" }).waitFor();
      assert.equal(await wp.evaluate(() => document.documentElement.lang), "zh-TW");
    } finally {
      if (fallbackApp) await fallbackApp.close();
      fs.rmSync(fallbackDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }

    console.log("Settings and welcome verified: tabs, card columns, dialogs, theme & live multi-language switching.");
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
