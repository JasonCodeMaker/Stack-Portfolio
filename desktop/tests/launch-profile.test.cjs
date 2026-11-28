const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { launchProfile } = require("../launchProfile.cjs");

const appData = path.join("C:", "Users", "someone", "AppData", "Roaming");
const exe = path.join("C:", "Program Files", "Stock Portfolio", "Stock Portfolio.exe");
const real = path.join(appData, "Stack Portfolio");

test("a normal launch keeps the established data directory", () => {
  assert.deepEqual(launchProfile({ argv: [exe], env: {}, appData }), { trial: false, userData: real });
});

test("a trial launch resolves a separate data directory", () => {
  for (const argv of [[exe, "--trial"], [exe, "--some-switch", "--trial"], ["electron.exe", ".", "--trial"]]) {
    const profile = launchProfile({ argv, env: {}, appData });
    assert.equal(profile.trial, true);
    assert.equal(profile.userData, path.join(appData, "Stack Portfolio Trial"));
    assert.notEqual(path.relative(real, profile.userData).split(path.sep)[0], "", "not the real directory");
    assert.ok(path.relative(real, profile.userData).startsWith(".."), "not inside the real directory");
  }
});

test("only the exact switch starts a trial", () => {
  for (const argv of [[exe, "trial"], [exe, "--trial=1"], [exe, "--TRIAL"], [exe, "--trial-run"], ["--trial"]]) {
    assert.deepEqual(launchProfile({ argv, env: {}, appData }), { trial: false, userData: real });
  }
});

test("a test directory still separates trial data from normal data", () => {
  const env = { STACK_PORTFOLIO_TEST_DIR: path.join("D:", "tmp", "profile") };
  const normal = launchProfile({ argv: [exe], env, appData });
  const trial = launchProfile({ argv: [exe, "--trial"], env, appData });
  assert.deepEqual(normal, { trial: false, userData: env.STACK_PORTFOLIO_TEST_DIR });
  assert.equal(trial.trial, true);
  assert.notEqual(trial.userData, normal.userData);
});

function boot(directory, ...args) {
  const env = { ...process.env };
  delete env.STACK_PORTFOLIO_TEST_DIR;
  const run = spawnSync(process.execPath, [path.join(__dirname, "fixtures", "boot-main.cjs"), directory, ...args],
    { env, encoding: "utf8", timeout: 60000 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split("\n").pop());
}

test("starting the main process in trial mode never touches the real data directory", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stock-portfolio-trial-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const realDir = path.join(directory, "Stack Portfolio");
  const trialDir = path.join(directory, "Stack Portfolio Trial");
  fs.mkdirSync(realDir);
  fs.writeFileSync(path.join(realDir, "portfolio.sqlite"), "real ledger");
  // A pending factory reset in the real profile is destructive startup work a trial must not run.
  fs.writeFileSync(path.join(realDir, ".factory-reset-pending"), "");
  const before = fs.statSync(realDir).mtimeMs;

  assert.equal(boot(directory, "--trial").userData, trialDir);
  assert.ok(fs.existsSync(path.join(trialDir, "diagnostics")), "startup wrote into the trial directory");
  assert.deepEqual(fs.readdirSync(realDir).sort(), [".factory-reset-pending", "portfolio.sqlite"]);
  assert.equal(fs.readFileSync(path.join(realDir, "portfolio.sqlite"), "utf8"), "real ledger");
  assert.equal(fs.statSync(realDir).mtimeMs, before);

  // The same build without the switch uses the real directory, as before.
  assert.equal(boot(directory).userData, realDir);
  assert.deepEqual(fs.readdirSync(realDir).sort(), ["diagnostics"]);
  assert.equal(fs.readdirSync(trialDir).includes("portfolio.sqlite"), false);
});
