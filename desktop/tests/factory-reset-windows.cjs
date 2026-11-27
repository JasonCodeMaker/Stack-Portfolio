const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright-core");
const { requestFactoryReset } = require("../factoryReset.cjs");

const appRoot = path.resolve(__dirname, "..");
const executable = process.argv[2] || require("electron");
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function debugPort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function connect(port) {
  const endpoint = `http://127.0.0.1:${port}`;
  for (let elapsed = 0; elapsed < 10000; elapsed += 100) {
    const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json()).catch(() => []);
    if (targets.some((target) => target.type === "page" && target.url.endsWith("/out/index.html"))) {
      const browser = await chromium.connectOverCDP(endpoint);
      const page = browser.contexts()[0].pages().find((candidate) => candidate.url().endsWith("/out/index.html"));
      if (page) return { browser, page };
      await browser.close();
    }
    await delay(100);
  }
  throw Error("Stock Portfolio did not open its desktop page");
}

async function closeWindow({ browser, page }) {
  const disconnected = once(browser, "disconnected");
  await page.close().catch(() => {});
  await disconnected;
}

async function verify() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-factory-reset-e2e-"));
  const profile = path.join(root, "profile");
  const source = path.join(root, "wealthfolio");
  fs.mkdirSync(profile);
  fs.mkdirSync(source);
  const original = path.join(source, "portfolio.sqlite");
  const exported = path.join(root, "exported.spbackup");
  fs.writeFileSync(original, "external Wealthfolio fixture");
  fs.writeFileSync(exported, "external backup fixture");
  const marker = path.join(profile, ".factory-reset-pending");
  const ledger = path.join(profile, "portfolio.sqlite");
  const key = path.join(profile, "ledger-key.v1");
  const env = { ...process.env, STACK_PORTFOLIO_TEST_DIR: profile, STACK_PORTFOLIO_TEST_SOURCE: source,
    STACK_PORTFOLIO_HEADLESS: "1", STACK_PORTFOLIO_LOCALE: "en" };
  delete env.ELECTRON_RUN_AS_NODE;
  const port = await debugPort();
  const start = () => spawn(executable, [
    ...(process.argv[2] ? [] : [appRoot]), `--remote-debugging-port=${port}`,
  ], { env, windowsHide: true, stdio: ["ignore", "ignore", "inherit"] });
  const first = start();
  let current;
  try {
    current = await connect(port);
    const { page } = current;
    await page.evaluate(async () => {
      await window.portfolio.newBook();
      await window.portfolio.account({ name: "Reset fixture account", currency: "AUD" });
      await window.portfolio.saveConnection({ "ibkr.flex-token": "synthetic-token" });
      await window.portfolio.setTheme({ theme: "dark" });
      localStorage.setItem("factory-reset-fixture", "old workspace");
    });
    await page.reload();
    await button(page, "Settings").click();
    await button(page, "Ledger").click();
    await button(page, "Factory reset…").click();
    const modal = page.getByRole("dialog", { name: "Reset Stock Portfolio?" });
    await modal.waitFor();
    assert.equal(await modal.evaluate((node) => node.contains(document.activeElement)), true);
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "hidden" });
    await button(page, "Factory reset…").click();
    await button(page, "Cancel").click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(ledger), true);
    const oldKey = fs.readFileSync(key);
    const internalBackup = path.join(profile, "old-copy.spbackup");
    fs.writeFileSync(internalBackup, "app-managed backup");

    const firstExit = once(first, "exit");
    await button(page, "Factory reset…").click();
    await button(page, "Clear data and restart").click();
    assert.equal((await firstExit)[0], 0);
    current = await connect(port);
    await current.page.waitForFunction(() => !!window.portfolio);
    await current.page.getByRole("heading", { name: "Add your first account now?" }).waitFor();
    const home = await current.page.evaluate(() => window.portfolio.home());
    assert.deepEqual({ mode: home.mode, hasReal: home.hasReal, theme: home.theme, onboardingSeen: home.onboardingSeen },
      { mode: null, hasReal: false, theme: "system", onboardingSeen: false });
    assert.equal(await current.page.evaluate(() => localStorage.getItem("factory-reset-fixture")), null);
    assert.equal(fs.existsSync(ledger), false);
    assert.equal(fs.existsSync(key), false);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(internalBackup), false);
    await current.page.evaluate(() => window.portfolio.newBook());
    assert.equal(fs.existsSync(ledger), true);
    assert.notDeepEqual(fs.readFileSync(key), oldKey);
    await closeWindow(current);
    current = undefined;

    const locked = path.join(profile, "locked-fixture");
    fs.writeFileSync(locked, "hold open across startup");
    requestFactoryReset(profile);
    const holder = spawn("powershell.exe", ["-NoProfile", "-Command",
      "$file=[IO.File]::Open($env:SP_FACTORY_RESET_LOCK,'Open','Read','Read'); try { [Console]::WriteLine('locked'); [void][Console]::ReadLine() } finally { $file.Dispose() }",
    ], { env: { ...env, SP_FACTORY_RESET_LOCK: locked }, windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
    try {
      const [message] = await once(holder.stdout, "data");
      assert.match(String(message), /locked/);
      assert.equal((await once(start(), "exit"))[0], 1);
      assert.equal(fs.existsSync(marker), true);
      assert.equal(fs.existsSync(locked), true);
    } finally {
      const released = once(holder, "exit");
      holder.stdin.end("\n");
      await released;
    }

    start();
    current = await connect(port);
    assert.equal((await current.page.evaluate(() => window.portfolio.home())).mode, null);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(locked), false);
    assert.equal(fs.readFileSync(original, "utf8"), "external Wealthfolio fixture");
    assert.equal(fs.readFileSync(exported, "utf8"), "external backup fixture");
    console.log("Factory reset passed: cancel, encrypted ledger, automatic relaunch, default settings, session cleanup, Windows file lock recovery, and external files.");
  } finally {
    if (current?.browser.isConnected()) await closeWindow(current);
    if (first.exitCode === null) first.kill();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
