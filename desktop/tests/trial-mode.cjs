// End-to-end check of trial mode (docs/trial-mode.md) in the built app: the --trial switch moves the
// data directory, marks the window, and a normal launch beside it is unchanged.
// Usage: node build.mjs && node tests/trial-mode.cjs [app.exe] [--screenshots dir]   (headless Electron)
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { parseArgs } = require("node:util");

const root = path.join(__dirname, "..");
const { values, positionals: [packaged] } = parseArgs({
  options: { screenshots: { type: "string" } },
  allowPositionals: true,
});
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-trial-"));
const env = {
  ...process.env,
  STACK_PORTFOLIO_HEADLESS: "1",
  STACK_PORTFOLIO_LOCALE: "en",
  STACK_PORTFOLIO_TEST_DIR: directory,
  STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = (...args) => electron.launch({
  executablePath: packaged ? path.resolve(packaged) : require("electron"),
  args: packaged ? args : [root, ...args],
  env,
  timeout: 30000,
});
const flag = (p) => p.getByRole("note", { name: /^Trial mode/ });
const state = (app) => app.evaluate(({ app, BrowserWindow }) => ({
  userData: app.getPath("userData"),
  title: BrowserWindow.getAllWindows()[0].getTitle(),
}));
const files = (dir) => fs.readdirSync(dir).filter((name) => /\.sqlite$|^ledger-key/.test(name)).sort();

(async () => {
  const trialDir = path.join(directory, "trial");
  // Both run at once: each data directory has its own single-instance lock.
  const normal = await launch(), trial = await launch("--trial");
  try {
    const n = await normal.firstWindow(), t = await trial.firstWindow();
    for (const p of [n, t]) {
      p.setDefaultTimeout(10000);
      await p.getByRole("button", { name: "Skip for now" }).click();
    }

    assert.deepEqual(await state(normal), { userData: directory, title: "Stock Portfolio" });
    assert.equal((await n.evaluate(() => window.portfolio.home())).trial, false);
    assert.equal(await flag(n).count(), 0);

    assert.deepEqual(await state(trial), { userData: trialDir, title: "Stock Portfolio — TRIAL" });
    assert.equal((await t.evaluate(() => window.portfolio.home())).trial, true);
    await flag(t).waitFor();
    assert.ok(await t.getByText("Trial", { exact: true }).isVisible());
    if (values.screenshots) {
      fs.mkdirSync(values.screenshots, { recursive: true });
      await t.screenshot({ path: path.join(values.screenshots, "trial-welcome.png") });
    }

    // A ledger created in the trial stays in the trial directory, and the marker follows into the app.
    await t.getByRole("button", { name: /^Open Sample Ledger/ }).click();
    await t.getByRole("heading", { level: 1, name: "Overview", exact: true }).waitFor();
    await flag(t).waitFor();
    assert.ok(files(trialDir).includes("sample.sqlite"));
    assert.deepEqual(files(directory), []);
    // The marker must not block the controls beneath it.
    await t.getByRole("button", { name: "Settings", exact: true }).click();
    await t.getByRole("heading", { level: 1, name: "Settings", exact: true }).waitFor();
    if (values.screenshots) await t.screenshot({ path: path.join(values.screenshots, "trial-settings.png") });
  } finally {
    await Promise.all([normal.close(), trial.close()]);
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log("trial mode ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
