// End-to-end check of the adaptive shell (spec §1, §2.2, §3.1–§3.4) in the built app.
// Usage: node build.mjs && node tests/shell-layout.cjs   (not part of `npm test`; launches headless Electron)
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { resizeContent } = require("./fixtures/display.cjs");
const root = path.join(__dirname, ".."),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-shell-"));
const packaged = process.argv[2];
const env = {
  ...process.env,
  STACK_PORTFOLIO_HEADLESS: "1",
  STACK_PORTFOLIO_LOCALE: process.env.STACK_PORTFOLIO_LOCALE || "zh-CN",
  STACK_PORTFOLIO_TEST_DIR: directory,
  STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
};
delete env.ELECTRON_RUN_AS_NODE;

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: packaged ? path.resolve(packaged) : require("electron"),
      args: packaged ? [] : [root],
      env,
      timeout: 30000,
    });
    const p = await app.firstWindow();
    p.setDefaultTimeout(10000);
    const home = await p.evaluate(() => window.portfolio.home());
    if (!home.mode && !home.hasReal && !home.onboardingSeen)
      await p.getByRole("button", { name: /^(暂时跳过|Skip for now|暫時略過)$/ }).click();
    const resize = (w, h) => resizeContent(app, p, w, h);
    const cols = (n) =>
      p.waitForFunction((n) => document.querySelector(".pane").dataset.cols === String(n), n, { timeout: 3000 });
    const shell = () =>
      p.evaluate(() => ({
        tier: document.documentElement.dataset.tier,
        short: document.documentElement.dataset.short,
        side: Math.round(document.querySelector(".side").getBoundingClientRect().width),
        head: Math.round(document.querySelector(".head").getBoundingClientRect().height),
        title: getComputedStyle(document.querySelector(".head h1")).fontSize,
        cols: Number(document.querySelector(".pane").dataset.cols),
        inspector: !!document.querySelector(".insp:not([hidden])"),
      }));

    await p.getByRole("button", { name: "打开示例账本" }).click();
    await p.getByRole("heading", { name: "总览", exact: true }).waitFor();

    // Sidebar: six pages in two groups, the sample book badge stays visible.
    const nav = p.getByRole("navigation", { name: "页面" });
    assert.deepEqual(await nav.getByRole("button").evaluateAll((b) => b.map((x) => x.getAttribute("aria-label"))), [
      "总览",
      "收益复盘",
      "配置分析",
      "持仓",
      "导入与对账",
      "设置",
      "切换账本 · 示例账本",
    ]);
    assert.equal(await nav.locator("hr").count(), 1);
    assert.equal(await p.getByRole("button", { name: "总览", exact: true }).getAttribute("aria-current"), "page");

    // Tiers.
    await resize(920, 650);
    assert.deepEqual(await shell(), { tier: "compact", short: "0", side: 64, head: 52, title: "20px", cols: 1, inspector: false });
    assert.ok(await p.locator(".side .demo").isVisible(), "示例 badge is visible in the icon bar");
    await resize(1280, 720);
    assert.deepEqual(await shell(), { tier: "regular", short: "0", side: 198, head: 76, title: "28px", cols: 1, inspector: false });
    await resize(1440, 900);
    assert.deepEqual(await shell(), { tier: "regular", short: "0", side: 198, head: 76, title: "28px", cols: 1, inspector: false });

    // The controls at the top of a scrollable page need room for the entire keyboard focus outline.
    await resize(1743, 910);
    await nav.getByRole("button", { name: "设置", exact: true }).click();
    await p.getByRole("group", { name: "设置页签" }).getByRole("button", { name: "数据", exact: true }).focus();
    await p.keyboard.press("Tab");
    const themeSelect = p.getByRole("combobox", { name: "主题", exact: true });
    assert.ok(await themeSelect.evaluate((select) => {
      const css = getComputedStyle(select);
      const outlineTop = select.getBoundingClientRect().top - parseFloat(css.outlineWidth) - parseFloat(css.outlineOffset);
      return select.matches(":focus-visible") && outlineTop >= select.closest("main").getBoundingClientRect().top;
    }), "The theme selector's keyboard focus outline fits below the page header");

    // At the same viewport width, scrolling and non-scrolling pages share the heading and content gutters.
    await resize(1024, 650);
    const content = p.locator(".page");
    const left = (await content.boundingBox()).x;
    const right = await content.evaluate((el) => el.getBoundingClientRect().right);
    for (const name of ["总览", "收益复盘", "配置分析", "持仓", "导入与对账", "设置"]) {
      await nav.getByRole("button", { name, exact: true }).click();
      const layout = await content.evaluate((el) => {
        const { left, right, top } = el.getBoundingClientRect();
        const paneTop = el.parentElement.getBoundingClientRect().top;
        const filter = document.querySelector(".head .date-pick");
        return { left, right, inset: top - paneTop, filterRight: filter?.getBoundingClientRect().right ?? right };
      });
      assert.ok(layout.inset >= 4, `${name} has space above its first controls`);
      assert.ok(Math.abs(layout.left - left) < 1 && Math.abs(layout.right - right) < 1 &&
        Math.abs(layout.filterRight - right) < 1, `${name} shares the page gutters`);
    }

    await resize(2560, 1080);
    assert.deepEqual(await shell(), { tier: "wide", short: "0", side: 212, head: 76, title: "28px", cols: 2, inspector: false });

    // The 21:9 inspector uses its reserved column. Closing it keeps the master table in place.
    await p.getByRole("button", { name: "持仓", exact: true }).click();
    await p.getByRole("button", { name: "AAPL", exact: true }).first().click();
    const inspector = p.getByRole("complementary", { name: /AAPL/ });
    await inspector.waitFor();
    assert.equal(await p.getByRole("dialog").count(), 0);
    await cols(2);
    const [width, reserved] = await inspector.evaluate((e) =>
      [e.getBoundingClientRect().width, e.parentElement.getBoundingClientRect().width]);
    assert.ok(width >= 389 && Math.abs(width - reserved) < 1);
    await inspector.getByRole("button", { name: "关闭", exact: true }).click();
    await inspector.waitFor({ state: "detached" });
    await cols(2);
    // ↑↓ in the holdings table moves the selection and the inspector follows (demo IBKR rows: IVV, then AAPL).
    await p.getByRole("button", { name: "IVV", exact: true }).first().click();
    await p.getByRole("complementary", { name: /^IVV/ }).waitFor();
    await p.keyboard.press("ArrowDown");
    await p.getByRole("complementary", { name: /^AAPL/ }).waitFor();
    await p.keyboard.press("ArrowUp");
    await p.getByRole("complementary", { name: /^IVV/ }).waitFor();
    await p.keyboard.press("Escape");
    await p.getByRole("complementary").waitFor({ state: "detached" });
    await cols(2);

    // Regular and compact tiers: the same detail opens in a dialog; Esc closes it.
    await resize(1280, 720);
    await p.getByRole("button", { name: "AAPL", exact: true }).first().click();
    await p.getByRole("dialog", { name: /AAPL/ }).waitFor();
    assert.equal((await shell()).inspector, false);
    await p.keyboard.press("Escape");
    await p.getByRole("dialog").waitFor({ state: "detached" });

    // Colours follow the system theme (spec §1.1).
    const colours = () =>
      p.evaluate(() => {
        const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
        return { bg: css("body", "backgroundColor"), side: css(".side", "backgroundColor"), text: css("body", "color") };
      });
    // The offscreen test window does not hear nativeTheme, so emulate the system preference it maps to.
    const theme = (colorScheme) => p.emulateMedia({ colorScheme });
    await theme("light");
    assert.deepEqual(await colours(), { bg: "rgb(236, 241, 234)", side: "rgb(227, 234, 225)", text: "rgb(23, 34, 28)" });
    await theme("dark");
    assert.deepEqual(await colours(), { bg: "rgb(14, 20, 16)", side: "rgb(18, 26, 21)", text: "rgb(233, 240, 234)" });
    await theme("light");

    // Keyboard focus ring uses the accent colour; transitions stay within 150 ms and stop under reduced motion.
    await p.getByRole("button", { name: "总览", exact: true }).focus();
    await p.keyboard.press("Tab");
    const ring = await p.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { style: s.outlineStyle, color: s.outlineColor };
    });
    assert.deepEqual(ring, { style: "solid", color: "rgb(18, 101, 72)" });
    const duration = () =>
      p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".side button")).transitionDuration));
    assert.ok((await duration()) > 0 && (await duration()) <= 0.15);
    await p.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await duration(), 0);

    console.log("Shell verified: tiers, sidebar, inspector and dialog, grid columns, keyboard, theme and motion.");
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
