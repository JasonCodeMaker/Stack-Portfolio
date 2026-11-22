// Run after node build.mjs. Launches the built Electron renderer with an isolated demo ledger.
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-overview-"));
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
    app = await electron.launch({ executablePath: require("electron"), args: [path.join(__dirname, "..")], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 640));
    await page.getByRole("button", { name: "打开示例账本" }).click();
    const chart = page.getByRole("img", { name: "总资产与净投入" });
    await chart.waitFor();
    assert.equal(await page.getByRole("main").getAttribute("data-cols"), "1");
    assert.equal((await chart.boundingBox()).height, 240);
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
