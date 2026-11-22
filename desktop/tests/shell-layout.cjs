// End-to-end check of the adaptive shell (spec §1, §2.2, §3.1–§3.4) in the built app.
// Usage: node build.mjs && node tests/shell-layout.cjs   (not part of `npm test`; launches headless Electron)
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const root = path.join(__dirname, ".."),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-shell-"));
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
      await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
      await p.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [w, h]);
      await p.waitForTimeout(150);
    };
    // Columns follow a ResizeObserver, so wait for the count rather than reading it at once.
    const cols = (n) =>
      p.waitForFunction((n) => document.querySelector(".pane").dataset.cols === String(n), n, { timeout: 3000 });
    const shell = () =>
      p.evaluate(() => ({
        tier: document.documentElement.dataset.tier,
        short: document.documentElement.dataset.short,
        side: document.querySelector(".side").getBoundingClientRect().width,
        head: document.querySelector(".head").getBoundingClientRect().height,
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
    await resize(1024, 640);
    assert.deepEqual(await shell(), { tier: "compact", short: "1", side: 64, head: 52, title: "20px", cols: 1, inspector: false });
    assert.ok(await p.locator(".side .demo").isVisible(), "示例 badge is visible in the icon bar");
    await resize(1280, 720);
    assert.deepEqual(await shell(), { tier: "compact", short: "0", side: 64, head: 52, title: "20px", cols: 1, inspector: false });
    await resize(1440, 900);
    assert.deepEqual(await shell(), { tier: "regular", short: "0", side: 212, head: 76, title: "28px", cols: 1, inspector: false });
    await resize(1920, 1080);
    assert.deepEqual(await shell(), { tier: "wide", short: "0", side: 212, head: 76, title: "28px", cols: 2, inspector: false });

    // Wide tier: a holding detail docks in the inspector and the grid recounts its columns; ✕ and Esc close it.
    await p.getByRole("button", { name: "持仓", exact: true }).click();
    await p.getByRole("button", { name: "AAPL", exact: true }).first().click();
    const inspector = p.getByRole("complementary", { name: /AAPL/ });
    await inspector.waitFor();
    assert.equal(await p.getByRole("dialog").count(), 0);
    await cols(1);
    const width = await inspector.evaluate((e) => e.getBoundingClientRect().width);
    assert.ok(Math.abs(width - 499.2) < 1, "inspector width is clamp(380px, 26vw, 520px), got " + width);
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
