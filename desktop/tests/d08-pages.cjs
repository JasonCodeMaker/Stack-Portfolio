// End-to-end check of the D08 Settings and Imports pages in the sample ledger: four Settings categories,
// the Imports account list and workspace, 一键更新全部账户, inline drawers, and both themes at 16:9 and 21:9.
// Usage: node build.mjs && node tests/d08-pages.cjs [--screenshots dir] [app.exe]   (launches headless Electron)
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { resizeContent: resize } = require("./fixtures/display.cjs");

const root = path.join(__dirname, "..");
const { values, positionals } = parseArgs({ options: { screenshots: { type: "string" } }, allowPositionals: true });
const [packaged] = positionals;
const button = (scope, name) => scope.getByRole("button", { name, exact: typeof name === "string" });
const nav = (p) => p.getByRole("navigation", { name: "页面" });
const title = (p, name) => p.getByRole("heading", { level: 1, name, exact: true });
const shot = async (p, name) => {
  if (!values.screenshots) return;
  fs.mkdirSync(values.screenshots, { recursive: true });
  await p.screenshot({ path: path.join(values.screenshots, name + ".png") });
};

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stock-portfolio-d08-"));
  const env = {
    ...process.env,
    STACK_PORTFOLIO_HEADLESS: "1",
    STACK_PORTFOLIO_LOCALE: "zh-CN",
    STACK_PORTFOLIO_TEST_DIR: directory,
    STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: packaged ? path.resolve(packaged) : require("electron"),
    args: packaged ? [] : [root],
    env,
    timeout: 30000,
  });
  const errors = [];
  try {
    const p = await app.firstWindow();
    p.setDefaultTimeout(10000);
    await p.emulateMedia({ colorScheme: null });
    p.on("pageerror", (error) => errors.push(error.message));
    const home = await p.evaluate(() => window.portfolio.home());
    if (!home.mode && !home.hasReal && !home.onboardingSeen) await button(p, "暂时跳过").click();
    await button(p, /^打开示例账本/).click();
    await title(p, "总览").waitFor();
    await resize(app, p, 1600, 900);

    // Settings: four categories, no 危险操作 tab, each with its groups.
    await button(nav(p), "设置").click();
    await title(p, "设置").waitFor();
    await p.getByLabel("主题", { exact: true }).selectOption("light");
    await p.waitForFunction(() => !matchMedia("(prefers-color-scheme: dark)").matches);
    const rail = p.getByRole("navigation", { name: "设置分类" });
    assert.deepEqual(
      (await rail.getByRole("button").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim()),
      ["通用与外观", "账户与券商连接 2", "账本与备份", "行情与分类规则"],
    );
    assert.equal(await p.getByText("危险操作").count(), 0);
    await p.getByRole("group", { name: "状态概览" }).waitFor();
    // Each status icon sits in the middle of its tile.
    const offsets = await p.locator(".kpi-ico").evaluateAll((tiles) => tiles.map((tile) => {
      const box = tile.getBoundingClientRect(), icon = tile.querySelector("svg").getBoundingClientRect();
      return Math.max(
        Math.abs(icon.left + icon.width / 2 - (box.left + box.width / 2)),
        Math.abs(icon.top + icon.height / 2 - (box.top + box.height / 2)),
      );
    }));
    assert.equal(offsets.length, 3);
    assert.ok(offsets.every((offset) => offset < 1), "Status icons are centred, offsets " + offsets.join(", "));
    await p.getByRole("region", { name: "外观与显示" }).waitFor();
    await p.getByRole("region", { name: "恢复出厂设置" }).waitFor();
    await shot(p, "settings-general-light");
    await button(rail, /账户与券商连接/).click();
    const connections = p.getByRole("region", { name: "账户与券商连接" });
    await connections.getByText("示例连接").first().waitFor();
    await button(connections, "管理连接").first().click();
    await connections.getByText("示例账本使用随附的券商样例。").waitFor();
    const reset = p.getByRole("region", { name: "同步排错与重置游标" });
    await button(reset, "展开").click();
    await button(reset, "选择重置").waitFor();
    await shot(p, "settings-accounts-light");
    await button(rail, "账本与备份").click();
    await button(p, "备份账本").waitFor();
    await button(rail, "行情与分类规则").click();
    await button(p, "维护结单报价").click();
    await p.getByLabel("报价日期").waitFor();
    await shot(p, "settings-market-light");

    // Imports: account list, workspace, one click to update every account, inline drawers.
    await button(nav(p), "导入与对账").click();
    await title(p, "导入与对账").waitFor();
    const list = p.getByRole("navigation", { name: "账户列表" });
    await button(list, /^全部账户/).waitFor();
    assert.equal(await list.locator(".acct-children .acct-item").count(), 2);
    // The ledger of all accounts starts folded and opens from its title.
    const ledger = p.getByRole("region", { name: "交易与资金流水", exact: true });
    const fold = ledger.getByRole("button", { name: /交易与资金流水 · 全部账户/ });
    assert.equal(await fold.getAttribute("aria-expanded"), "false");
    assert.equal(await ledger.getByRole("table").count(), 0);
    await shot(p, "imports-all-light");
    await fold.click();
    await ledger.getByRole("table").waitFor();
    await fold.click();
    await ledger.getByRole("table").waitFor({ state: "detached" });
    await button(p.locator(".imp-head"), "一键更新全部账户").click();
    const webull = p.getByRole("region", { name: "WEBULL 同步结果", exact: true });
    const ibkr = p.getByRole("region", { name: "IBKR 同步结果", exact: true });
    await webull.getByRole("region", { name: "导入预览" }).waitFor();
    await ibkr.waitFor();
    await shot(p, "imports-update-all-light");
    await button(list, /^IBKR/).click();
    assert.equal(await webull.count(), 0, "A selected account shows only its own sync result");
    await button(p.getByRole("group", { name: "操作" }), /^手动记一笔/).click();
    const manual = p.getByRole("region", { name: /^手动记账 · IBKR/ });
    await manual.getByLabel("金额").waitFor();
    assert.equal(await p.getByRole("dialog").count(), 0, "Manual entry opens inline, without an account picker dialog");
    await button(p.getByRole("group", { name: "操作" }), /^结单对账/).click();
    await p.getByRole("region", { name: /^券商结单对账 · IBKR/ }).waitFor();
    await shot(p, "imports-ibkr-reconcile-light");
    await button(p.locator(".ws-head"), "期初建账").click();
    await p.getByRole("region", { name: /^期初建账 · IBKR/ }).waitFor();
    await p.getByRole("searchbox", { name: "筛选流水" }).or(p.getByLabel("筛选流水")).first().waitFor();

    // Accounts are added only through the add-account guide, which needs the real ledger, so the sample
    // ledger shows no add button. An account made in the sample ledger is managed and deleted from its workspace.
    assert.equal(await button(list, /^添加账户/).count(), 0);
    await button(nav(p), "设置").click();
    await button(p.getByRole("navigation", { name: "设置分类" }), /^账户与券商连接/).click();
    await p.getByLabel("新账户名称").fill("Temporary account");
    await button(p, "创建账户").click();
    await button(nav(p), "导入与对账").click();
    const added = button(list, /^Temporary account/);
    await added.waitFor();
    assert.equal(await list.locator(".acct-children .acct-item").count(), 3);
    await added.click();
    await button(p.locator(".ws-head"), "管理账户").click();
    const manage = p.getByRole("region", { name: "账户管理 · Temporary account" });
    await manage.getByText("账户类型").waitFor();
    await shot(p, "imports-manage-light");
    await button(manage, /删除此账户/).click();
    const confirm = p.getByRole("dialog", { name: "删除账户「Temporary account」？" });
    const remove = button(confirm, /删除账户/);
    assert.equal(await remove.isDisabled(), true, "Deleting waits for the acknowledgement");
    await shot(p, "imports-delete-light");
    await confirm.getByLabel("我了解此操作无法撤销").check();
    await remove.click();
    await added.waitFor({ state: "detached" });
    assert.equal(await list.locator(".acct-children .acct-item").count(), 2);
    assert.equal(await button(list, /^全部账户/).getAttribute("aria-current"), "true");
    await p.locator(".toast").getByRole("button").click().catch(() => {});

    // Dark theme and 21:9.
    await button(nav(p), "设置").click();
    await p.getByLabel("主题", { exact: true }).selectOption("dark");
    await p.waitForFunction(() => matchMedia("(prefers-color-scheme: dark)").matches);
    await shot(p, "settings-general-dark");
    await resize(app, p, 2560, 1080);
    await button(nav(p), "导入与对账").click();
    await button(p.locator(".imp-head"), "一键更新全部账户").click();
    await webull.getByRole("region", { name: "导入预览" }).waitFor();
    await shot(p, "imports-update-all-dark-219");
    const importsOverflow = await p.evaluate(() => document.querySelector("main").scrollWidth - document.querySelector("main").clientWidth);
    assert.ok(importsOverflow <= 1, "Imports fits horizontally at 21:9, overflow " + importsOverflow);
    await button(nav(p), "设置").click();
    await button(p.getByRole("navigation", { name: "设置分类" }), /账户与券商连接/).click();
    await shot(p, "settings-accounts-dark-219");
    const overflow = await p.evaluate(() => document.querySelector("main").scrollWidth - document.querySelector("main").clientWidth);
    assert.ok(overflow <= 1, "Settings fits horizontally at 21:9");
    assert.deepEqual(errors, []);
    console.log("D08 pages passed: Settings categories, Imports workspace, update all accounts, inline drawers, dark theme, 21:9.");
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
