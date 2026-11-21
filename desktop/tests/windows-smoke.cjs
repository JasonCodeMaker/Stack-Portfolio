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
(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: packaged || require("electron"),
      args: packaged ? [] : [root],
      env,
      timeout: 30000,
    });
    const p = await app.firstWindow();
    p.setDefaultTimeout(8000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.getByRole("button", { name: "打开示例账本" }).click();
    await p.getByRole("heading", { name: "总览", exact: true }).waitFor();
    await p.getByRole("button", { name: "持仓", exact: true }).click();
    await p.getByRole("button", { name: "AAPL", exact: true }).click();
    await p.getByRole("dialog").waitFor();
    await p.getByRole("button", { name: "关闭", exact: true }).click();
    await p.getByRole("button", { name: "配置分析", exact: true }).first().click();
    await p.getByRole("button", { name: "ETF 成分", exact: true }).click();
    await p.getByText("基金成分与数据来源").waitFor();
    await p.getByRole("button", { name: "配置目标", exact: true }).click();
    await p.getByRole("button", { name: "编辑目标", exact: true }).click();
    await p.getByRole("dialog").getByRole("spinbutton").first().fill("100");
    await p.getByRole("button", { name: "保存目标" }).click();
    await p.getByRole("button", { name: "导入与对账", exact: true }).click();
    await p.getByRole("button", { name: "载入示例文件" }).click();
    await p.getByRole("button", { name: "确认导入", exact: true }).click();
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
    await p.getByText("A$128,400", { exact: true }).waitFor();
    await p.getByText("+A$3,200", { exact: true }).waitFor();
    if (process.env.STACK_PORTFOLIO_SCREENSHOT) {
      const image = await app.evaluate(async ({ BrowserWindow }) =>
        (
          await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          })
        ).toDataURL(),
      );
      fs.writeFileSync(process.env.STACK_PORTFOLIO_SCREENSHOT, Buffer.from(image.split(",")[1], "base64"));
    }
    await p.getByRole("button", { name: "导入与对账", exact: true }).click();
    await p.getByRole("button", { name: "载入示例文件" }).click();
    const summary = await p.locator(".mini-stats").innerText();
    assert.match(summary, /1\s*重复/);
    await p.reload();
    await p.getByText("A$128,400", { exact: true }).waitFor();
    const backup = path.join(directory, "verify-backup.sqlite");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    await p.getByRole("button", { name: "数据与设置", exact: true }).click();
    await p.getByRole("button", { name: "备份账本", exact: true }).click();
    await p.getByText("已保存 verify-backup.sqlite", { exact: true }).waitFor();
    assert.ok(fs.existsSync(backup));
    await p.getByRole("button", { name: "恢复账本备份", exact: true }).click();
    await p.waitForFunction(() => document.querySelector(".busy") === null);
    await p.getByRole("button", { name: "总览", exact: true }).click();
    await p.getByText("A$128,400", { exact: true }).waitFor();
    assert.ok(fs.readdirSync(directory).some((f) => f.startsWith("before-restore-")));
    assert.deepEqual(errors, []);
    console.log(
      "Windows UI verified: onboarding, holdings, allocation, target saving, import, reconciliation, duplicate detection, reload, backup and restore.",
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
