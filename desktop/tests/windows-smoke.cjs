const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const root = path.join(__dirname, ".."),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-ui-"));
const env = {
  ...process.env,
  STACK_PORTFOLIO_HEADLESS: "1",
  STACK_PORTFOLIO_TEST_DIR: directory,
  STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
};
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2];
async function verifyReview(p) {
  await p.getByRole("button", { name: "收益复盘", exact: true }).click();
  const chart = p.getByRole("img", { name: /每日收益曲线/ });
  await chart.waitFor();
  assert.equal(await p.locator(".review-metric").count(), 3);
  assert.match(await p.locator(".review-primary strong").innerText(), /%/);
  // Each benchmark states whether the portfolio is ahead, and one tooltip reads every curve.
  assert.match(await p.locator(".review-metric").nth(1).innerText(), /跑赢|跑输|持平/);
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  const moveTo = (fraction) => p.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await moveTo(.5);
  assert.match(await p.locator(".chart-tip").innerText(), /我的组合[\s\S]*标普 500[\s\S]*相对纳斯达克 100/);
  await p.getByRole("button", { name: "收益差", exact: true }).click();
  await p.getByRole("heading", { name: "组合相对指数的收益差" }).waitFor();
  await moveTo(.22); await p.mouse.down(); await moveTo(.68); await p.mouse.up();
  await p.waitForFunction(() => document.querySelector("[aria-label='复盘起点']")?.value > "2026-09-30");
  await p.getByRole("button", { name: /IBKR、Webull Australia/ }).click();
  await p.getByRole("dialog").getByLabel("Webull Australia").uncheck();
  await p.getByRole("button", { name: "应用账户" }).click();
  await p.getByLabel("复盘起点").fill("2026-10-16");
  await p.getByLabel("复盘终点").fill("2026-10-22");
  await p.getByRole("button", { name: "应用区间" }).click();
  await p.getByText("查看每日数据",{exact:true}).click();
  await p.getByRole("button",{name:"2026-10-16",exact:true}).click();
  await p.getByRole("button", { name: "当日流水" }).click();
  await p.getByRole("row").filter({ hasText: "账户之间划转" }).waitFor();
  await p.getByRole("dialog").getByRole("button",{name:"关闭",exact:true}).click();
  await p.getByRole("button", { name: "写笔记" }).click();
  await p.getByLabel("这段时间做了什么，下次想验证什么？").fill("观察留现金的影响");
  await p.getByRole("button", { name: "保存笔记与当前指标" }).click();
  await p.getByRole("heading", { name: "记录时与当前重算" }).waitFor();
  // Revise only this isolated example ledger, then reopen the original view.
  await p.evaluate(() => window.portfolio.savePrice({ assetId: "aapl", date: "2026-10-22", price: "212" }));
  await p.getByRole("button", { name: "全部", exact: true }).click();
  await p.getByRole("button", { name: /重开区间/ }).click();
  await p.locator(".review-changed").first().waitFor();
  assert.equal(await p.getByLabel("复盘起点").inputValue(), "2026-10-16");
  assert.equal(await p.getByLabel("复盘终点").inputValue(), "2026-10-22");
  assert.ok(await p.getByRole("button", { name: "IBKR", exact: true }).isVisible());
}
(async () => {
  let app;
  try {
    const launch = (profile) => electron.launch({
      executablePath: packaged || require("electron"),
      args: packaged ? [] : [root],
      env: { ...env, STACK_PORTFOLIO_TEST_DIR: profile },
      timeout: 30000,
    });
    app = await launch(directory);
    const p = await app.firstWindow();
    p.setDefaultTimeout(8000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.getByRole("button", { name: "打开示例账本" }).click();
    await p.getByRole("heading", { name: "总览", exact: true }).waitFor();
    const allHoldings = p.locator(".card").filter({has:p.getByRole("heading",{name:"全部证券持仓"})});
    assert.equal(await allHoldings.locator("tbody tr").count(),4);
    assert.ok((await p.locator(".overview-totals").innerText()).includes("已计入 3/4 只"));
    // Total assets opens onto what each account holds.
    await p.getByRole("button", { name: /^总资产 A\$/ }).click();
    const assets = p.getByRole("dialog");
    await assets.getByRole("heading", { name: "Webull Australia" }).waitFor();
    assert.match(await assets.innerText(), /IBKR[\s\S]*AAPL[\s\S]*USD 现金[\s\S]*A200/);
    await p.getByRole("button", { name: "关闭", exact: true }).click();
    const historyChart = p.getByRole("img", { name: /每日走势/ });
    await historyChart.scrollIntoViewIfNeeded();
    const trend = await historyChart.boundingBox();
    await p.mouse.move(trend.x + trend.width / 2, trend.y + trend.height / 2);
    assert.match(await p.locator(".chart-tip").innerText(), /总资产/);
    await p.mouse.move(2, 2);
    await p.getByRole("button", { name: "持仓", exact: true }).click();
    await p.getByRole("button", { name: "AAPL", exact: true }).click();
    assert.match(await p.getByRole("dialog").innerText(), /成本均价/);
    await p.getByRole("dialog").getByText("市值与成本折算汇率", { exact: true }).waitFor();
    await p.getByRole("dialog").getByRole("button", { name: "补成本", exact: true }).click();
    const appleCost = p.getByRole("dialog", { name: "补成本 · AAPL" });
    await appleCost.getByLabel(/这些股数的总买入成本（USD/).fill("18000");
    await appleCost.getByText("记录历史澳元成本（可选）", { exact: true }).click();
    await appleCost.getByLabel("凭据中的历史金额（AUD）").fill("25200");
    await appleCost.getByLabel(/凭据（如/).fill("示例 AAPL 成本");
    await appleCost.getByRole("button", { name: "保存", exact: true }).click();
    await p.getByRole("dialog").getByText("A$27,000.00", { exact: true }).waitFor();
    await p.getByRole("button", { name: "关闭", exact: true }).click();
    await p.getByLabel("按账户筛选").selectOption("demo-webull");
    await p.getByLabel("搜索持仓").fill("BHP");
    await p.getByRole("button",{name:"按账面盈亏（AUD）排序"}).click();
    await p.getByRole("button",{name:"补成本",exact:true}).click();
    const costForm = p.getByRole("dialog");
    await costForm.getByLabel(/这些股数的总买入成本/).fill("5600");
    await costForm.getByLabel(/凭据（如/).fill("样例成本凭据");
    await costForm.getByRole("button",{name:"保存",exact:true}).click();
    await p.getByRole("row").filter({hasText:"BHP"}).getByText("A$5,600.00",{exact:true}).waitFor();
    assert.equal(await p.getByLabel("搜索持仓").inputValue(),"BHP");
    assert.equal(await p.getByLabel("按账户筛选").inputValue(),"demo-webull");
    await p.waitForFunction(() => document.activeElement?.textContent === "BHP");
    await p.getByRole("button", { name: "配置分析", exact: true }).first().click();
    await p.getByRole("button",{name:/^IVV/}).click();
    await p.getByRole("dialog").getByText("基金成分与数据来源").waitFor();
    await p.getByRole("button",{name:"关闭",exact:true}).click();
    await p.getByRole("button",{name:"实际投了哪些公司",exact:true}).click();
    await p.getByRole("button",{name:/Apple|苹果/}).first().click();
    const sources = p.getByRole("dialog");
    await sources.getByText("通过 IVV 持有",{exact:true}).waitFor();
    await sources.getByText("直接持有",{exact:true}).waitFor();
    await sources.getByRole("button",{name:"关闭",exact:true}).click();
    await p.getByText(/其余 \d+ 家公司/).click();
    assert.ok(await p.locator(".company-tail details summary").first().isVisible());
    await p.getByRole("button", { name: "配置目标", exact: true }).click();
    await p.getByRole("button", { name: "IVV · 设定目标", exact: true }).click();
    await p.getByRole("dialog").getByLabel(/目标占总资产/).fill("45");
    await p.getByRole("button", { name: "保存目标" }).click();
    await p.getByRole("button",{name:"IVV · 编辑目标",exact:true}).waitFor();
    await p.getByRole("button",{name:"全部账户",exact:true}).click();
    await p.getByRole("dialog").getByLabel("Webull Australia").uncheck();
    await p.getByRole("button",{name:"应用到组合"}).click();
    const target = p.locator(".target-row").filter({has:p.getByRole("button",{name:"IVV · 设定目标",exact:true})});
    await target.getByText("全部账户目标 45.0%", {exact:true}).waitFor();
    assert.match(await target.innerText(),/未设当前范围目标/);
    await p.locator(".header-tools").getByRole("button",{name:"IBKR",exact:true}).click();
    await p.getByRole("dialog").getByLabel("Webull Australia").check();
    await p.getByRole("button",{name:"应用到组合"}).click();
    await p.getByRole("button",{name:"IVV · 编辑目标",exact:true}).waitFor();
    await p.getByRole("button", { name: "导入与对账", exact: true }).click();
    assert.equal(await p.getByRole("button",{name:"两家一起",exact:true}).getAttribute("aria-pressed"),"true");
    await p.getByRole("button", { name: /^同步券商/ }).click();
    const webull = p.getByRole("region",{name:"WEBULL 同步结果",exact:true});
    const ibkr = p.getByRole("region",{name:"IBKR 同步结果",exact:true});
    const preview = webull.getByRole("region", { name: "导入预览", exact: true });
    await ibkr.getByRole("region",{name:"导入预览",exact:true}).waitFor();
    await preview.getByRole("heading", { name: "将新增 1 笔流水" }).waitFor();
    assert.match(await preview.getByRole("row").filter({ hasText: "买入 BHP" }).innerText(), /10 × AUD 44/);
    await preview.getByRole("button", { name: "确认导入 1 笔", exact: true }).click();
    await p.getByRole("button", { name: "前往结单对账" }).click();
    await p.getByRole("button", { name: "查看示例月结单" }).click();
    await p.getByRole("button", { name: "填入结单用于比较" }).click();
    await p.getByRole("button", { name: "比较结单", exact: true }).click();
    await p.getByText("请检查凭证及相关流水，再次比较。", { exact: false }).waitFor();
    await p.getByRole("button", { name: "查看示例月结单" }).click();
    await p.getByRole("button", { name: "按凭证补录入金" }).click();
    await p.getByRole("button", { name: /确认记入/ }).click();
    await p.getByRole("button", { name: "比较结单", exact: true }).click();
    await p.getByLabel("已核对期间资金流水及所有币种余额").check();
    await p.getByRole("button", { name: "完成对账并查看总览" }).click();
    await p.getByText("A$128,400.00", { exact: true }).waitFor();
    await p.getByRole("button", { name: /^近 1 月盈亏 \+A\$3,200\.00/ }).waitFor();
    await p.getByRole("button", { name: /^近 1 月盈亏/ }).click();
    await p.getByRole("heading",{name:"这段时间的盈亏来自哪里"}).waitFor();
    assert.equal(await p.getByLabel("复盘起点").inputValue(),"2026-10-01");
    assert.equal(await p.getByLabel("复盘终点").inputValue(),"2026-10-30");
    assert.match(await p.getByRole("row").filter({hasText:"组合期间盈亏"}).innerText(),/3,200/);
    await p.getByRole("button",{name:"总览",exact:true}).click();
    await p.getByRole("button",{name:"查看期间计算",exact:true}).click();
    assert.match(await p.getByRole("dialog").innerText(), /期初资产[\s\S]*Webull Australia[\s\S]*合计[\s\S]*\+A\$3,200\.00/);
    await p.getByRole("button", { name: "关闭", exact: true }).click();
    await p.locator(".account-list > button").first().click();
    await p.getByRole("button", { name: "查看该账户持仓" }).click();
    assert.equal(await p.getByLabel("按账户筛选").inputValue(), "demo-ibkr");
    await verifyReview(p);
    await p.getByRole("button", { name: "总览", exact: true }).click();
    await p.getByText("A$128,400.00", { exact: true }).waitFor();
    if (process.env.STACK_PORTFOLIO_SCREENSHOT) {
      await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
        const png = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {stayHidden:true,stayAwake:true});
        return png.toDataURL().split(",")[1];
      });
      fs.writeFileSync(process.env.STACK_PORTFOLIO_SCREENSHOT, Buffer.from(screenshot,"base64"));
    }
    await p.getByRole("button", { name: "导入与对账", exact: true }).click();
    await p.getByRole("button", { name: /^同步券商/ }).click();
    await preview.getByRole("heading", { name: "没有新变化" }).waitFor();
    assert.deepEqual(await preview.getByRole("button").allTextContents(), ["关闭预览"]);
    assert.equal(await preview.locator("article,table,details").count(), 0);
    assert.equal(await p.getByRole("heading", { name: "最近导入批次" }).count(), 0);
    await preview.getByRole("button", { name: "关闭预览" }).click();
    await p.locator(".account-mapping summary").click();
    await p.getByLabel("WEBULL 入账账户").selectOption("");
    await p.getByRole("button",{name:/^同步券商/}).click();
    await webull.getByRole("button",{name:"单独重试"}).waitFor();
    const ibkrPreview = ibkr.getByRole("region", {name:"导入预览", exact:true});
    await ibkrPreview.getByRole("article", { name: "IBKR 变更" }).getByText("A$83,700.00").waitFor();
    assert.doesNotMatch(await ibkrPreview.innerText(), /Webull|BHP|重复|已入账|持平/);
    await ibkrPreview.getByRole("button", { name: "确认保存变更" }).click();
    await ibkr.getByRole("region",{name:"导入结果",exact:true}).waitFor();
    await p.getByLabel("WEBULL 入账账户").selectOption("demo-webull");
    await webull.getByRole("button",{name:"单独重试"}).click();
    await preview.getByRole("heading",{name:"没有新变化"}).waitFor();
    await p.getByRole("article", { name: "IBKR 变更" }).getByRole("button", { name: "前往结单对账" }).click();
    assert.equal(await p.getByLabel("账本账户").inputValue(), "demo-ibkr");
    assert.equal(await p.getByLabel("结单日期").inputValue(), "2026-10-30");
    assert.ok(await p.locator('input[value="1792"]').isVisible());
    const statement = path.join(directory, "amount-change.xml");
    fs.writeFileSync(statement, require("../out/demo.cjs").demoXml.replace('endingValue="83700"', 'endingValue="83725"'));
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, statement);
    await p.getByRole("button", { name: "记录与同步", exact: true }).click();
    await p.getByRole("button", { name: /^导入文件/ }).click();
    await p.getByRole("button", { name: /选择 Flex XML/ }).click();
    await ibkrPreview.getByRole("heading", { name: "将更新 1 项账户数据" }).waitFor();
    assert.match(await ibkrPreview.innerText(), /账户总额/);
    assert.ok(await ibkrPreview.getByText("A$83,700.00", { exact: true }).isVisible());
    assert.ok(await ibkrPreview.getByText("A$83,725.00", { exact: true }).isVisible());
    assert.doesNotMatch(await ibkrPreview.innerText(), /现金余额|证券市值|AAPL|Webull|已入账/);
    await ibkrPreview.getByRole("button", { name: "取消预览" }).click();
    await p.reload();
    await p.getByText("A$128,400.00", { exact: true }).waitFor();
    const backup = path.join(directory, "verify-backup.spbackup");
    const password = require("node:crypto").randomBytes(24).toString("base64");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    await p.getByRole("button", { name: "设置", exact: true }).click();
    await p.getByRole("button",{ name:"账本与备份", exact:true }).click();
    await p.getByRole("button", { name: "备份账本", exact: true }).click();
    await p.getByLabel("备份密码（至少 12 个字符）").fill(password);
    await p.getByLabel("再次输入密码").fill(password);
    await p.getByRole("button", { name: "选择文件位置" }).click();
    await p.getByText("已保存 verify-backup.spbackup", { exact: true }).waitFor();
    assert.ok(fs.existsSync(backup));
    const saved = fs.readFileSync(path.join(directory, "sample.sqlite"));
    const failed = await p.evaluate(async () => {
      const { token } = await window.portfolio.selectBackup();
      try { await window.portfolio.restore({ token, password: "incorrect backup password" }); }
      catch { return true; }
      return false;
    });
    assert.ok(failed);
    assert.deepEqual(fs.readFileSync(path.join(directory, "sample.sqlite")), saved);
    await p.getByRole("button", { name: "恢复账本备份", exact: true }).click();
    await p.getByLabel("备份密码", { exact: true }).fill(password);
    await p.getByRole("button", { name: "解锁并恢复" }).click();
    await p.waitForFunction(() => document.querySelector(".busy") === null);
    await p.getByRole("button", { name: "总览", exact: true }).click();
    await p.getByText("A$128,400.00", { exact: true }).waitFor();
    assert.ok(fs.readdirSync(directory).some((f) => f.startsWith("before-restore-")));
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    const fresh = path.join(directory, "new-profile");
    fs.mkdirSync(fresh);
    app = await launch(fresh);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    const clean = await app.firstWindow();
    await clean.getByRole("button", { name: "从账本备份恢复" }).click();
    await clean.getByLabel("备份密码", { exact: true }).fill(password);
    await clean.getByRole("button", { name: "解锁并恢复" }).click();
    await clean.getByText("A$128,400.00", { exact: true }).waitFor();
    await clean.getByRole("button", { name: "收益复盘", exact: true }).click();
    await clean.getByRole("button", { name: /重开区间/ }).click();
    await clean.locator(".review-changed").first().waitFor();
    assert.notDeepEqual(fs.readFileSync(path.join(directory, "ledger-key.v1")), fs.readFileSync(path.join(fresh, "ledger-key.v1")));
    await clean.getByRole("button",{name:"导入与对账",exact:true}).click();
    await clean.getByRole("button",{name:/^手工补一条/}).click();
    await clean.getByRole("button",{name:"补持仓",exact:true}).click();
    const manual = clean.getByRole("dialog");
    await manual.getByLabel("证券代码").fill("MOCK");
    await manual.getByLabel("上市市场").fill("XASX");
    await manual.getByLabel("截至该日的股数或份额").fill("10");
    await manual.getByLabel(/凭据（如/).fill("示例持股凭据");
    await manual.getByRole("button",{name:"保存持仓"}).click();
    await manual.waitFor({state:"hidden"});
    await clean.getByRole("button",{name:"持仓",exact:true}).click();
    const mock = clean.getByRole("row").filter({has:clean.getByRole("button",{name:"MOCK",exact:true})});
    await mock.getByRole("button",{name:"补报价",exact:true}).click();
    await clean.getByRole("dialog").getByLabel("每股／份报价（AUD）").fill("100");
    await clean.getByRole("dialog").getByRole("button",{name:"保存",exact:true}).click();
    await mock.getByText("A$1,000.00",{exact:true}).waitFor();
    await mock.getByRole("button",{name:"补成本",exact:true}).waitFor();
    console.log(
      "Windows UI verified: onboarding, holdings, allocation, import, reconciliation, benchmark chart selection, historical review notes, backup and restore.",
    );
  } catch (e) {
    if (app) {
      const p = await app.firstWindow();
      console.error((await p.locator("body").innerText()).slice(-1100));
    }
    throw e;
  } finally {
    if (app) await app.close();
    const checked = fs.realpathSync(directory),
      parent = fs.realpathSync(os.tmpdir());
    if (path.dirname(checked) === parent && path.basename(checked).startsWith("stack-portfolio-ui-"))
      fs.rmSync(checked, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
