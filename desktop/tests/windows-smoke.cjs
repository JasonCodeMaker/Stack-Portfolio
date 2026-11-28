const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { seedAcceptanceBook } = require("./fixtures/acceptance-book.cjs");
const { resizeContent: resize } = require("./fixtures/display.cjs");

const root = path.join(__dirname, "..");
const { values, positionals } = parseArgs({
  options: { screenshots: { type: "string" } },
  allowPositionals: true,
});
const [packaged] = positionals;
const pages = [
  ["overview", "总览"],
  ["performance", "收益复盘"],
  ["allocation", "配置分析"],
  ["holdings", "持仓"],
  ["macro", "宏观分析"],
  ["imports", "导入与对账"],
  ["settings", "设置"],
];
const button = (scope, name) => scope.getByRole("button", { name, exact: typeof name === "string" });
const region = (scope, name) => scope.getByRole("region", { name, exact: true });
const nav = (p) => p.getByRole("navigation", { name: "页面" });
const preset = (p, name) => button(p.getByRole("group", { name: "期间" }), name);
const title = (p, name) => p.getByRole("heading", { level: 1, name, exact: true });
const welcome = (p) => button(p, /^打开示例账本/);
const assets = (p, amount) => button(p, "总资产 A$" + amount + "，查看明细");

async function withDesktop(directory, verify) {
  fs.mkdirSync(directory, { recursive: true });
  const env = {
    ...process.env,
    STACK_PORTFOLIO_HEADLESS: "1",
    STACK_PORTFOLIO_LOCALE: process.env.STACK_PORTFOLIO_LOCALE || "zh-CN",
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
  let p;
  try {
    assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), directory);
    p = await app.firstWindow();
    p.setDefaultTimeout(10000);
    p.on("pageerror", (error) => errors.push(error.message));
    const home = await p.evaluate(() => window.portfolio.home());
    if (!home.mode && !home.hasReal && !home.onboardingSeen)
      await button(p, "暂时跳过").click();
    await verify(app, p);
    assert.deepEqual(errors, []);
  } catch (error) {
    if (p && !p.isClosed()) {
      const text = await p.locator("body").innerText({ timeout: 2000 });
      console.error(text.length < 1600 ? text : text.slice(0, 800) + "\n…\n" + text.slice(-800));
    }
    throw error;
  } finally {
    await app.close();
  }
}

async function open(p, page) {
  const tab = button(nav(p), page);
  await tab.click();
  await title(p, page).waitFor();
  assert.equal(await tab.getAttribute("aria-current"), "page");
}

async function openSample(p) {
  await welcome(p).click();
  await title(p, "总览").waitFor();
}

async function verifyNativeMinimum(app, p) {
  const { minimum, size, content } = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(800, 500);
    return { minimum: win.getMinimumSize(), size: win.getSize(), content: win.getContentSize() };
  });
  assert.deepEqual(minimum, [920, 650]);
  assert.deepEqual(size, minimum);
  await p.waitForFunction(([w, h]) =>
    Math.abs(innerWidth - w / 0.70) <= 2 && Math.abs(innerHeight - h / 0.70) <= 2 &&
    document.documentElement.dataset.aspect === "16:9", content);
  const dimensions = (locator) => locator.boundingBox();
  assert.ok(Math.abs((await dimensions(nav(p))).width - 64) < 1);
  assert.ok(Math.abs((await dimensions(p.getByRole("banner"))).height - 52) < 1);
  assert.equal(await p.getByRole("main").getAttribute("data-cols"), "1");
  const chart = p.getByRole("img", { name: "总资产与净投入", exact: true });
  assert.ok((await dimensions(chart)).height >= 239);
  assert.ok(await nav(p).getByText("示例", { exact: true }).isVisible());
}

async function verifyPeriods(p) {
  const day = "2025-12-31";
  await p.getByLabel("估值日").fill("2025-12-05");
  await p.getByText("正在查看 2025-12-05").waitFor();
  await p.getByLabel("估值日").fill(day);
  await p.getByText("正在查看 " + day).waitFor();
  await assets(p, "100,000.00").waitFor();
  const top = region(p, "前 5 大持仓");
  const apple = top.getByRole("row", { name: /AAPL.*4,000\.00/ });
  await apple.waitFor();
  // Apple outranks the A$3,500 holding only once both accounts are included.
  assert.deepEqual(await top.getByRole("table").getByRole("button").allTextContents(), ["IVV", "BHP", "AAPL", "MID", "MOCK"]);
  const annualHoldings = await top.innerText();
  const chart = p.getByRole("img", { name: "总资产与净投入", exact: true });
  const ticks = await chart.locator("text").allTextContents();
  const breakdown = region(p, "盈亏构成");
  const gains = async (locators) => (await locators.allTextContents()).map((text) => {
    const value = text.match(/[+−]?(?:A\$)?[\d,]+(?:\.\d+)?/);
    assert.ok(value, text);
    return Number(value[0].replace(/[A$,]/g, "").replace("−", "-"));
  });
  const overviewGains = () => gains(breakdown.locator("dd"));
  const overviewKpis = region(p, "关键数字");
  await overviewKpis.getByText("+1.09%", { exact: true }).waitFor();
  assert.match(await overviewKpis.innerText(), /今年以来投资盈亏\s*▲\s*\+1,079\.00[\s\S]*今年以来净投入\s*100\.00/);
  const yearGains = await overviewGains();

  await preset(p, "本月").click();
  await overviewKpis.getByText("+0.24%", { exact: true }).waitFor();
  assert.match(await overviewKpis.innerText(), /本月投资盈亏\s*▲\s*\+244\.00[\s\S]*本月净投入\s*0\.00/);
  await assets(p, "100,000.00").waitFor();
  assert.equal(await top.innerText(), annualHoldings);
  assert.notDeepEqual(await chart.locator("text").allTextContents(), ticks);
  const monthGains = await overviewGains();
  assert.notDeepEqual(monthGains, yearGains);

  await open(p, "收益复盘");
  const returns = region(p, "时间加权收益率");
  await returns.getByText(/\+0\.24%/).waitFor();
  assert.deepEqual(await gains(breakdown.getByRole("button")), monthGains);
  const contribution = region(p, "持仓贡献");
  await button(contribution, /^ABC.*期间已卖清.*\+A\$10$/).waitFor();
  await button(contribution, /^IVV.*\+A\$106$/).waitFor();
  await button(contribution, /^现金利息.*\+A\$3$/).waitFor();

  for (const name of ["今年以来", "近一年"]) {
    await preset(p, name).click();
    await p.getByText("2025-01-01 至 2025-12-31 · 365 天", { exact: true }).waitFor();
    await returns.getByText(/^年化\s*▲\s*\+1\.09%/).waitFor();
  }
  assert.deepEqual(await gains(breakdown.getByRole("button")), yearGains);
}

async function verifyHoldings(app, p) {
  await resize(app, p, 2560, 1080);
  await open(p, "持仓");
  const holding = (account, ticker) => region(p, account).getByRole("row").filter({ has: button(p, ticker) });
  for (const [account, quantity] of [["IBKR", "8"], ["Webull Australia", "2"]]) {
    const row = holding(account, "AAPL");
    await row.getByRole("cell", { name: quantity, exact: true }).waitFor();
    assert.equal(await row.count(), 1);
  }
  const columns = (n) => p.getByRole("main").and(p.locator('[data-cols="' + n + '"]')).waitFor();
  await columns(2);
  await button(holding("IBKR", "AAPL"), "AAPL").click();
  const dock = p.getByRole("complementary", { name: "AAPL", exact: true });
  await columns(2);
  for (const [label, quantity] of [["合计股数", "10"], ["IBKR", "8"], ["Webull Australia", "2"]]) {
    await dock.getByRole("rowheader", { name: label, exact: true }).locator("..")
      .getByRole("cell", { name: quantity, exact: true }).waitFor();
  }
  await button(dock, "关闭").click();
  await columns(2);
  await button(region(p, "IBKR"), "IBKR现金").click();
  await p.getByRole("complementary", { name: "IBKR · 现金", exact: true }).waitFor();
  await p.keyboard.press("Escape");
  await resize(app, p, 1280, 720);
  await button(holding("IBKR", "AAPL"), "AAPL").click();
  const popup = p.getByRole("dialog", { name: "AAPL", exact: true });
  await popup.waitFor();
  assert.equal(await dock.count(), 0);
  await button(popup, "关闭").click();
}

async function verifyAdaptiveDisplay(app, p, profile) {
  await welcome(p).waitFor();
  assert.equal(await p.locator("html").getAttribute("data-aspect"), "16:9");
  assert.equal(await resize(app, p, 2100, 1000).then((state) => state.aspect), "16:9");
  await resize(app, p, 2440, 1020);
  await p.locator('html[data-aspect="21:9"]').waitFor();
  assert.equal(await resize(app, p, 2100, 1000).then((state) => state.aspect), "21:9");
  await resize(app, p, 2560, 1080);
  await openSample(p);
  assert.ok(await p.locator(".overview-main").getByRole("region", { name: "资产走势" }).isVisible());
  assert.ok(await p.locator(".overview-rail").getByRole("region", { name: "汇率影响" }).isVisible());
  assert.ok(await p.locator(".pane").evaluate((pane) => pane.scrollHeight <= pane.clientHeight + 1),
    "The sample Overview fits in a 21:9 viewport at the default comfort zoom");
  const trend = p.getByRole("img", { name: "总资产与净投入", exact: true });
  const chart = await trend.boundingBox();
  await p.mouse.move(chart.x + chart.width / 2, chart.y + chart.height / 2);
  await p.locator(".ch-tip").waitFor({ state: "visible" });
  await open(p, "收益复盘");
  await p.locator(".review-rail").getByLabel("观察日").waitFor();
  await p.locator(".review-rail").getByRole("heading", { name: /跑输时段/ }).waitFor();
  await open(p, "配置分析");
  await p.locator(".allocation-breakdown").getByRole("heading", { name: "公司敞口明细" }).waitFor();
  await open(p, "导入与对账");
  await p.locator(".imp .cols").waitFor();
  await open(p, "设置");
  const waitScale = (scale) => p.waitForFunction(
    (value) => document.querySelector(".settings-zoom output")?.textContent === value, scale);
  const shortcut = (keyCode) => app.evaluate(({ BrowserWindow }, keyCode) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.focus();
    for (const type of ["keyDown", "keyUp"]) contents.sendInputEvent({ type, keyCode, modifiers: ["control"] });
  }, keyCode);
  await button(p, "放大界面").click();
  await waitScale("105%");
  await shortcut("=");
  await waitScale("110%");
  await shortcut("Plus");
  await waitScale("115%");
  await shortcut("-");
  await waitScale("110%");
  await shortcut("-");
  await waitScale("105%");
  await shortcut("0");
  await waitScale("100%");
  await button(p, "缩小界面").click();
  await waitScale("95%");
  await button(p, "重置界面缩放").click();
  await waitScale("100%");
  await assert.rejects(() => p.evaluate(() => window.portfolio.setUserScale({ multiplier: "1.2" })));
  await p.evaluate(() => window.portfolio.setUserScale({ multiplier: 8 }));
  await waitScale("130%");
  assert.ok(await button(p, "放大界面").isDisabled());
  await p.evaluate(() => window.portfolio.setUserScale({ multiplier: 0 }));
  await waitScale("85%");
  assert.ok(await button(p, "缩小界面").isDisabled());
  await p.evaluate(async () => {
    await window.portfolio.setTheme({ theme: "dark" });
    await window.portfolio.newBook();
    await window.portfolio.openDemo();
  });
  await resize(app, p, 1920, 1080);
  assert.equal(await p.locator("html").getAttribute("data-aspect"), "16:9");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, "workspace.json"), "utf8")),
    { mode: "demo", uiScaleMultiplier: 0.85, theme: "dark", onboardingSeen:true });
}

async function verifyHoldingCost(app, p) {
  await resize(app, p, 1024, 650);
  const stock = button(p.getByRole("group", { name: "证券类别" }), "股票");
  await stock.click();
  const search = p.getByRole("searchbox", { name: "搜索持仓" });
  await search.fill("sample");
  const account = region(p, "Webull Australia");
  const sort = button(account, "按证券排序");
  await sort.click();
  const ticker = button(account, "MOCK");
  const mock = account.getByRole("row").filter({ has: button(p, "MOCK") });
  await mock.getByRole("cell", { name: "10", exact: true }).waitFor();
  await mock.getByRole("cell", { name: "A$1,000.00", exact: true }).waitFor();
  assert.equal(await mock.getByText("待补", { exact: true }).count(), 2);
  await ticker.scrollIntoViewIfNeeded();
  const scroll = () => p.getByRole("main").evaluate((main) => main.scrollTop);
  const before = await scroll();
  assert.ok(before > 0, "The filtered table has scrolled to MOCK");
  await ticker.click();
  await button(p.getByRole("dialog", { name: "MOCK", exact: true }), "补成本").click();
  const form = p.getByRole("dialog", { name: "补成本 · MOCK", exact: true });
  assert.equal(await form.getByLabel("成本凭据日期").inputValue(), "2025-12-31");
  await form.getByLabel(/这些股数的总买入成本/).fill("600");
  await form.getByLabel(/凭据（如/).fill("Sample cost evidence");
  await button(form, "保存").click();
  await mock.getByText("A$600.00", { exact: true }).waitFor();
  assert.match(await mock.innerText(), /\+A\$400\.00/);
  assert.equal(await search.inputValue(), "sample");
  assert.equal(await stock.getAttribute("aria-pressed"), "true");
  assert.equal(await sort.locator("..").getAttribute("aria-sort"), "ascending");
  await p.waitForFunction(() => document.activeElement?.textContent === "MOCK");
  assert.ok(Math.abs(await scroll() - before) <= 1, "The holdings scroll position is preserved");
}

async function verifyHoldingLink(p) {
  await open(p, "配置分析");
  await button(p, "账户范围 · 全部账户").click();
  const scope = p.getByRole("dialog", { name: "账户范围", exact: true });
  await scope.getByLabel("Webull Australia").uncheck();
  await button(scope, "应用").click();
  const stocks = region(p, "个股");
  await stocks.getByText(/^看这 \d+ 只个股$/).click();
  await button(stocks, "AAPL").click();
  await title(p, "持仓").waitFor();
  await p.getByRole("dialog", { name: "AAPL", exact: true }).waitFor();
  assert.equal(await button(p, "账户范围 · IBKR").count(), 1);
  assert.equal(await p.getByLabel("估值日").inputValue(), "2025-12-31");
}

async function verifyReconciliation(p) {
  await open(p, "导入与对账");
  await button(p, /^同步券商/).click();
  const webull = region(p, "WEBULL 同步结果");
  const preview = region(webull, "导入预览");
  const trade = preview.getByRole("row").filter({ hasText: "买入 BHP" });
  assert.match(await trade.innerText(), /10 × AUD 44/);
  await button(preview, "确认导入 1 笔").click();
  await button(webull, /^前往结单对账/).click();
  await button(p, "查看示例月结单").click();
  await button(p, "填入结单用于比较").click();
  await button(p, "比较结单").click();
  await p.getByText(/请检查凭证及相关流水，再次比较/).waitFor();
  await button(p, "查看示例月结单").click();
  await button(p, "按凭证补录入金").click();
  await button(p, /^确认记入/).click();
  await button(p, "比较结单").click();
  await p.getByLabel("已核对期间资金流水及所有币种余额").check();
  await button(p, "完成对账并查看总览").click();
  await assets(p, "128,400.00").waitFor();
  await preset(p, "本月").click();
  await region(p, "关键数字").getByText(/\+3,200\.00/).waitFor();
}

async function verifyNotes(p) {
  await open(p, "收益复盘");
  await button(p, "账户范围 · 全部账户").click();
  const scope = p.getByRole("dialog", { name: "账户范围", exact: true });
  await scope.getByLabel("Webull Australia").uncheck();
  await button(scope, "应用").click();
  await p.getByRole("img", { name: "累计收益曲线", exact: true }).waitFor();
  await preset(p, "自定义…").click();
  await p.getByLabel("期间起点").fill("2026-10-16");
  await p.getByLabel("期间终点").fill("2026-10-22");
  await button(p, "逐日数据").click();
  await button(p.getByRole("dialog", { name: "逐日数据" }), "2026-10-16").click();
  const day = p.getByRole("dialog", { name: "2026-10-16 · 当日明细" });
  await button(day, "当日流水").click();
  await day.getByRole("row").filter({ hasText: "账户之间划转" }).waitFor();
  await button(day, "关闭").click();
  await button(p, "写笔记").click();
  await p.getByLabel("这段时间做了什么，下次想验证什么？").fill("观察留现金的影响");
  await button(p, "保存笔记与当前指标").click();
  await p.getByRole("heading", { name: "记录时与当前重算" }).waitFor();
  await p.evaluate(() => window.portfolio.savePrice({ assetId: "aapl", date: "2026-10-22", price: "212" }));
  await preset(p, "全部").click();
  await reopenNote(p);
}

async function reopenNote(p) {
  await button(p, /重开区间/).click();
  await p.locator(".review-changed").first().waitFor();
  assert.equal(await p.getByLabel("期间起点").inputValue(), "2026-10-16");
  assert.equal(await p.getByLabel("期间终点").inputValue(), "2026-10-22");
  await button(p, "账户范围 · IBKR").waitFor();
}

async function verifyDeleteFlow(p) {
  await p.evaluate(() => window.portfolio.manual({
    account: "demo-webull", date: "2026-10-28", amount: "25", currency: "AUD",
    type: "DEPOSIT", reference: "SMOKE-DELETE",
  }));
  await open(p, "导入与对账");
  await button(p, "交易流水").click();
  await p.locator("select.btn").selectOption("demo-webull");
  const row = p.getByRole("row").filter({ hasText: "SMOKE-DELETE" });
  await button(row, "修改").waitFor();
  await button(row, "删除").click();
  const confirm = p.getByRole("dialog", { name: "删除流水", exact: true });
  await button(confirm, "取消").click();
  await button(row, "删除").click();
  await button(confirm, "确认删除").click();
  await row.waitFor({ state: "hidden" });
  await p.getByLabel("显示已删除和已冲销的流水").check();
  await row.getByText("已删除", { exact: true }).waitFor();
}

async function verifyBrokerRetry(app, p, file) {
  await open(p, "导入与对账");
  const webull = region(p, "WEBULL 同步结果");
  const ibkr = region(p, "IBKR 同步结果");
  await p.locator(".account-mapping summary").click();
  const mapping = p.getByLabel("WEBULL 入账账户");
  await mapping.selectOption("");
  await button(p, /^同步券商/).click();
  await button(webull, "单独重试").waitFor();

  const trades = Array.from({ length: 6 }, (_, i) =>
    '<Trade accountId="DEMO-IBKR" assetCategory="STK" symbol="AAPL" description="Apple" listingExchange="NASDAQ" ' +
    'dateTime="20261030;100000" buySell="BUY" quantity="1" tradePrice="208" currency="USD" ibCommission="0" ibExecID="SMOKE-' + i + '"/>');
  fs.writeFileSync(file, '<FlexQueryResponse><FlexStatements><FlexStatement accountId="DEMO-IBKR" fromDate="20261027" toDate="20261030">' +
    '<AccountInformation currency="AUD"/><Trades>' + trades.join("") + '</Trades></FlexStatement></FlexStatements></FlexQueryResponse>');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  const importXml = async () => {
    await button(p, /^导入文件/).click();
    await button(p.getByRole("dialog"), /选择 Flex XML/).click();
  };
  await importXml();
  assert.ok(await button(webull, "单独重试").isVisible());
  await button(ibkr, "确认导入 6 笔").click();
  const result = region(ibkr, "导入结果").getByText("已新增 6 笔流水", { exact: true });
  await result.waitFor();
  await mapping.selectOption("demo-webull");
  await button(webull, "单独重试").click();
  await button(webull, "确认导入 1 笔").waitFor();
  assert.ok(await result.isVisible());

  const balances = () => p.evaluate(async () => {
    const d = await window.portfolio.dashboard({ ids: "all", date: "2026-10-30" });
    return d.rows.map(({ accountId, ticker, type, rawQuantity }) => [accountId, ticker, type, rawQuantity]);
  });
  const imported = await balances();
  assert.ok(imported.some((row) => row[1] === "AAPL" && row[3] === "106"));
  assert.ok(imported.some((row) => row[2] === "cash"));
  await importXml();
  await ibkr.getByText("没有新变化", { exact: true }).waitFor();
  assert.deepEqual(await balances(), imported);
}

async function useBackupFile(app, file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, file);
}

async function unlockBackup(p, entry, password) {
  await button(p, entry).click();
  const prompt = p.getByRole("dialog", { name: "解锁备份", exact: true });
  await prompt.getByLabel("备份密码", { exact: true }).fill(password);
  await button(prompt, "解锁并恢复").click();
}

async function verifyBackup(app, p, file, password, directory) {
  await useBackupFile(app, file);
  await open(p, "设置");
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
  await p.getByRole("group", { name: "版本与更新" }).getByText(`Stock Portfolio ${version}`, { exact: true }).waitFor();
  await button(p.getByRole("group", { name: "设置页签" }), "账本").click();
  await button(p, "备份账本").click();
  const prompt = p.getByRole("dialog", { name: "设置备份密码", exact: true });
  await prompt.getByLabel("备份密码（至少 12 个字符）").fill(password);
  await prompt.getByLabel("再次输入密码").fill(password);
  await button(prompt, "选择文件位置").click();
  await p.getByText("已保存 " + path.basename(file), { exact: true }).waitFor();
  assert.ok(fs.statSync(file).size > 0);
  const ledger = path.join(directory, "sample.sqlite");
  const original = fs.readFileSync(ledger);
  await unlockBackup(p, "恢复账本备份", "incorrect backup password");
  const failure = p.getByRole("dialog", { name: "操作提示", exact: true });
  await failure.getByText(/密码|备份/).first().waitFor();
  assert.deepEqual(fs.readFileSync(ledger), original);
  await button(failure, "知道了").click();
  await unlockBackup(p, "恢复账本备份", password);
  await p.locator(".busy").waitFor({ state: "hidden" });
  await open(p, "总览");
  await button(p, "账户范围 · IBKR").click();
  const scope = p.getByRole("dialog", { name: "账户范围", exact: true });
  await button(scope, "全部账户").click();
  await button(scope, "应用").click();
  await assets(p, "128,400.00").waitFor();
  assert.ok(fs.readdirSync(directory).some((file) => file.startsWith("before-restore-")));
  await open(p, "收益复盘");
  await reopenNote(p);
}

async function captureMatrix(app, p, output) {
  const sizes = [[1024, 650], [1280, 720], [1920, 1080], [3440, 1440]];
  const eachViewport = async (verify) => {
    for (const [width, height] of sizes) {
      await resize(app, p, width, height);
      for (const theme of ["light", "dark"]) {
        await p.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        const folder = path.join(output, width + "x" + height, theme);
        fs.mkdirSync(folder, { recursive: true });
        await verify(async (name) => {
          await p.mouse.move(0, 0);
          await p.evaluate(async () => {
            document.querySelector("main.pane")?.scrollTo(0, 0);
            await document.fonts.ready;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
            return image.toPNG({ scaleFactor: 1 }).toString("base64");
          });
          const png = Buffer.from(screenshot, "base64");
          assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height], name);
          fs.writeFileSync(path.join(folder, name + ".png"), png);
        });
      }
    }
  };

  await welcome(p).waitFor();
  await eachViewport((capture) => capture("welcome"));
  await openSample(p);
  await open(p, "配置分析");
  await button(p, "设置目标").click();
  const targets = p.getByRole("dialog", { name: "设置目标", exact: true });
  for (const [label, target] of [["IVV", "45"], ["A200", "20"], ["个股", "25"], ["现金", "10"]]) {
    await targets.getByLabel(label + " 目标（%）").fill(target);
  }
  await button(targets, "保存目标").click();
  await region(p, "IVV").getByText("目标 45.0%", { exact: true }).waitFor();
  await p.locator(".toast").getByRole("button").click();

  await eachViewport(async (capture) => {
    for (const [key, name] of pages) {
      await open(p, name);
      if (key === "performance") await p.getByRole("img", { name: "累计收益曲线", exact: true }).waitFor();
      if (key === "imports") {
        await button(p, /^同步券商/).click();
        await region(region(p, "IBKR 同步结果"), "导入预览").waitFor();
        await button(region(p, "WEBULL 同步结果"), "确认导入 1 笔").waitFor();
      }
      if (key === "settings") await p.getByText("正式账本可保存券商授权。示例账本使用随附样例。").waitFor();
      await capture(key);
    }
  });
  console.log(`Captured ${(pages.length + 1) * sizes.length * 2} app screenshots in ${output}`);
}

async function main() {
  assert.ok(positionals.length <= 1, "Usage: node tests/windows-smoke.cjs [app.exe] [--screenshots directory]");
  const prefix = "stack-portfolio-smoke-";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    const diagnosticProfile = path.join(directory, "private-profile-fixture");
    const diagnosticExport = path.join(directory, "diagnostics.jsonl");
    await withDesktop(diagnosticProfile, async (app, p) => {
      await openSample(p);
      await open(p, "设置");
      await p.evaluate(() => window.portfolio.diagnosticsClear());
      await button(p, "诊断日志").click();
      const diagnosticDialog = p.getByRole("dialog", { name: "诊断日志" });
      const rangeControl = diagnosticDialog.getByLabel("时间范围");
      const markProblem = button(diagnosticDialog, "标记此刻的问题");
      await markProblem.waitFor();
      const [rangeBounds, markBounds] = await Promise.all([rangeControl.boundingBox(), markProblem.boundingBox()]);
      assert.ok(Math.abs(rangeBounds.y - markBounds.y) < 1, "diagnostic range and problem marker must align");
      await diagnosticDialog.getByText("所选时间范围内没有诊断事件。").waitFor();
      const saveLog = button(diagnosticDialog, "保存日志文件…");
      assert.equal(await saveLog.isDisabled(), true);
      assert.equal(await saveLog.evaluate((element) => element.classList.contains("pri")), false);
      await p.keyboard.press("Escape");
      await diagnosticDialog.waitFor({ state: "hidden" });
      const preferences = path.join(diagnosticProfile, "workspace.json");
      const originalPreferences = fs.readFileSync(preferences);
      fs.unlinkSync(preferences);
      fs.mkdirSync(preferences);
      try {
        await p.getByLabel("主题", { exact: true }).selectOption("dark");
        const notice = p.getByRole("dialog", { name: "操作提示" });
        await notice.getByText(/private-profile-fixture/).waitFor();
        await notice.getByRole("button", { name: "关闭" }).click();
        await assert.rejects(() => p.evaluate(() => window.portfolio.setTheme({ theme: "dark" })), /private-profile-fixture/);
      } finally {
        fs.rmdirSync(preferences);
        fs.writeFileSync(preferences, originalPreferences);
      }

      const guide = Object.values(require("../ui/onboarding/guide-sources.json"))[0];
      await app.evaluate(({ shell, dialog }, file) => {
        shell.openExternal = async () => { throw Error("PRIVATE_BROKER_TOKEN\nPRIVATE_ACCOUNT_ID PRIVATE_HOLDING"); };
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      }, diagnosticExport);
      await p.evaluate((url) => { window.open(url); }, guide);
      await p.waitForFunction(async () => {
        const preview = await window.portfolio.diagnosticsPreview({ range: "day" });
        return preview.text.includes('"operation":"openGuide"');
      });
      await button(p, "诊断日志").click();
      await diagnosticDialog.getByLabel("时间范围").selectOption("day");
      await diagnosticDialog.getByLabel("导出预览").waitFor();
      const preview = await diagnosticDialog.getByLabel("导出预览").inputValue();
      await button(diagnosticDialog, "保存日志文件…").click();
      await diagnosticDialog.getByText("诊断日志已保存。").waitFor();
      const exported = fs.readFileSync(diagnosticExport, "utf8");
      assert.equal(exported, preview);
      const records = exported.trim().split("\n").map(JSON.parse);
      const theme = records.filter((record) => record.operation === "setTheme");
      assert.equal(theme.length, 1);
      assert.equal(theme[0].stage, "preferences");
      assert.equal(theme[0].reason, "unexpected_error");
      assert.equal(theme[0].process, "main");
      assert.equal(theme[0].outcome, "failed");
      assert.match(theme[0].build, /^\d+\.\d+\.\d+$/);
      assert.ok(!records.some((record) => record.operation === "settings" && record.process === "renderer"));
      assert.ok(records.some((record) => record.operation === "openGuide" &&
        record.stage === "execute" && record.reason === "unexpected_error"));
      const persisted = fs.readdirSync(path.join(diagnosticProfile, "diagnostics"))
        .map((file) => fs.readFileSync(path.join(diagnosticProfile, "diagnostics", file), "utf8"));
      for (const text of [exported, ...persisted]) {
        assert.doesNotMatch(text, /PRIVATE_BROKER_TOKEN|PRIVATE_ACCOUNT_ID|PRIVATE_HOLDING|private-profile-fixture|workspace\.json/);
      }
      await diagnosticDialog.getByRole("button", { name: "关闭" }).click();
      assert.equal(await p.evaluate(() => window.portfolio.setTheme({ theme: "dark" })), "dark");
    });
    console.log("Diagnostics smoke passed: setTheme/preferences and openGuide/execute, repeated failure deduplicated, private fixtures excluded, and export matches preview.");
    const displayProfile = path.join(directory, "display");
    await withDesktop(displayProfile, (app, p) => verifyAdaptiveDisplay(app, p, displayProfile));
    await withDesktop(displayProfile, async (_app, p) => {
      await title(p, "总览").waitFor();
      assert.equal(await p.evaluate(() => window.portfolio.displayState().then((state) => state.userScaleMultiplier)), 0.85);
    });
    await withDesktop(path.join(directory, "acceptance"), async (app, p) => {
      await title(p, "打开投资账本").waitFor();
      await region(p, "迁入 Wealthfolio 账本").waitFor();
      await region(p, "示例组合").waitFor();
      assert.equal(await nav(p).count(), 0);
      await seedAcceptanceBook(app);
      await openSample(p);
      assert.deepEqual((await nav(p).getByRole("button").evaluateAll((buttons) =>
        buttons.map((item) => item.getAttribute("aria-label")))).slice(0, -1), pages.map(([, name]) => name));
      await verifyNativeMinimum(app, p);
      await resize(app, p, 1440, 900);
      await verifyPeriods(p);
      await verifyHoldings(app, p);
      await verifyHoldingCost(app, p);
      await verifyHoldingLink(p);
    });
    const password = randomBytes(24).toString("base64");
    const backup = path.join(directory, "sample.spbackup");
    const sample = path.join(directory, "sample");
    await withDesktop(sample, async (app, p) => {
      await openSample(p);
      await resize(app, p, 1440, 900);
      await p.getByLabel("估值日").fill("2026-10-27");
      await p.getByText("正在查看 2026-10-27").waitFor();
      await p.getByLabel("估值日").fill("2026-10-30");
      await p.getByText("正在查看 2026-10-30").waitFor();
      await verifyReconciliation(p);
      await verifyNotes(p);
      await verifyBackup(app, p, backup, password, sample);
    });
    await withDesktop(path.join(directory, "restored"), async (app, p) => {
      await useBackupFile(app, backup);
      await unlockBackup(p, "从账本备份恢复", password);
      await assets(p, "128,400.00").waitFor();
      await open(p, "收益复盘");
      await reopenNote(p);
    });
    await withDesktop(path.join(directory, "brokers"), async (app, p) => {
      await openSample(p);
      await verifyBrokerRetry(app, p, path.join(directory, "six-trades.xml"));
      await verifyDeleteFlow(p);
    });
    if (values.screenshots) {
      const output = path.resolve(values.screenshots);
      await withDesktop(path.join(directory, "screenshots"), (app, p) => captureMatrix(app, p, output));
    }
  console.log("Windows smoke passed: welcome, page navigation, minimum window, periods, holdings, import and retry, reconciliation, review notes, backup and restore.");
  } finally {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith(prefix));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
