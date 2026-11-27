const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_OS, "Windows");
const { chromium } = require(path.join(process.env.RUNNER_TEMP, "sp-upgrade-tools", "node_modules", "playwright-core"));
const profile = path.join(process.env.APPDATA, "Stack Portfolio");
const dbPath = path.join(profile, "portfolio.sqlite");
const keyPath = path.join(profile, "ledger-key.v1");
const snapshotPath = path.join(process.env.RUNNER_TEMP, "sp-upgrade-fixture.json");
const accountName = "Synthetic upgrade ledger";
const digest = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function withApp(verify) {
  const socket = net.createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const endpoint = `http://127.0.0.1:${port}`;
  const env = { ...process.env, STACK_PORTFOLIO_HEADLESS: "1", STACK_PORTFOLIO_LOCALE: "zh-CN" };
  delete env.STACK_PORTFOLIO_TEST_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.env.SP_UPGRADE_EXE, [`--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: "inherit" });
  const exited = once(child, "exit");
  let browser;
  let page;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const targets = await fetch(endpoint + "/json/list").then(res => res.json()).catch(() => []);
      if (targets.some(target => target.url.endsWith("/out/index.html"))) {
        browser = await chromium.connectOverCDP(endpoint);
        page = browser.contexts()[0].pages().find(target => target.url().endsWith("/out/index.html"));
        if (page) break;
        await browser.close();
      }
      await sleep(150);
    }
    assert.ok(page, "The installed desktop renderer did not open");
    page.setDefaultTimeout(10000);
    await page.waitForFunction(() => !!window.portfolio);
    return await verify(page);
  } finally {
    if (page) await page.close().catch(() => {});
    const result = await Promise.race([exited, sleep(7000, null, { ref: false })]);
    if (!result) child.kill();
    await browser?.close();
    assert.ok(result, "The installed app did not exit cleanly");
    assert.equal(result[0], 0);
  }
}

async function ledgerSnapshot(page, accountId) {
  return page.evaluate(async (id) => {
    const { mode, hasReal, storageError, theme } = await window.portfolio.home();
    const { accounts } = await window.portfolio.dashboard({ date: "2025-12-31", ids: "all" });
    const account = accounts.find(account => account.id === id);
    const history = await window.portfolio.history({ account: id });
    return { mode, hasReal, storageError: storageError ?? null, theme, account: { id: account?.id, name: account?.name }, history };
  }, accountId);
}

async function main() {
  const phase = process.argv[2];
  if (phase === "seed") {
    assert.equal(fs.existsSync(dbPath), false, "The runner already contains a ledger");
    const before = await withApp(async page => {
      const id = await page.evaluate(async name => {
        await window.portfolio.newBook();
        const account = await window.portfolio.account({ name, currency: "AUD" });
        await window.portfolio.manual({
          account, type: "DEPOSIT", currency: "AUD", date: "2025-12-31", amount: "1234.56",
          reference: "isolated-upgrade-fixture", note: "Synthetic test deposit",
        });
        await window.portfolio.setTheme({ theme: "dark" });
        return account;
      }, accountName);
      return ledgerSnapshot(page, id);
    });
    assert.equal(before.mode, "real");
    assert.equal(before.storageError, null);
    assert.equal(before.account.name, accountName);
    assert.equal(before.history.length, 1);
    assert.equal(before.history[0].amount, "1234.56");
    assert.notEqual(fs.readFileSync(dbPath).subarray(0, 15).toString("ascii"), "SQLite format 3");
    fs.writeFileSync(snapshotPath, JSON.stringify({ before, key: digest(keyPath), ledger: digest(dbPath) }));
    console.log("1.4.22 created an encrypted ledger with one account and an AUD 1,234.56 deposit.");
    return;
  }
  assert.equal(phase, "verify");
  const fixture = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  assert.equal(digest(keyPath), fixture.key, "The installer changed the ledger key before the first launch");
  assert.equal(digest(dbPath), fixture.ledger, "The installer changed the ledger file before the first launch");
  await withApp(async page => {
    assert.deepEqual(await ledgerSnapshot(page, fixture.before.account.id), fixture.before);
    await button(page, "设置").click();
    await button(page, "账本").click();
    await button(page, "恢复出厂设置…").waitFor();
    assert.equal(await button(page, "恢复出厂设置…").isEnabled(), true);
  });
  assert.equal(digest(keyPath), fixture.key);
  assert.equal(fs.existsSync(path.join(profile, ".factory-reset-pending")), false);
  console.log("PASS: same encrypted ledger file and key across the installer upgrade; 1.4.23 read the original account, deposit and theme. 设置 → 账本 → 恢复出厂设置 is visible and enabled.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
