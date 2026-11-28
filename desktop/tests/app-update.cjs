// End-to-end check of the update interface in the built app. A demo updater stands in for the
// updater library, so one ready update appears without a network or an installer.
// Usage: node build.mjs && node tests/app-update.cjs [--screenshots dir]   (headless Electron)
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { parseArgs } = require("node:util");

const root = path.join(__dirname, "..");
const { values } = parseArgs({ options: { screenshots: { type: "string" } } });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-update-"));
const env = {
  ...process.env,
  STACK_PORTFOLIO_HEADLESS: "1",
  STACK_PORTFOLIO_LOCALE: "en",
  STACK_PORTFOLIO_TEST_DIR: directory,
  STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = (extra = {}, ...args) => electron.launch({ executablePath: require("electron"), args: [root, ...args], env: { ...env, ...extra }, timeout: 30000 });
const shot = async (page, name) => {
  if (!values.screenshots) return;
  fs.mkdirSync(values.screenshots, { recursive: true });
  await page.screenshot({ path: path.join(values.screenshots, name + ".png") });
};
// The answer is saved by the main process just after the click, so wait for it to land.
async function remembered(key, value) {
  for (let i = 0; i < 50; i++) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(directory, "workspace.json"), "utf8")).appUpdate?.[key] === value) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(key + " was not saved as " + value);
}
async function open(app) {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const home = await page.evaluate(() => window.portfolio.home());
  if (!home.mode) {
    if (!home.onboardingSeen) await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: /^Open Sample Ledger/ }).click();
  }
  await page.getByRole("heading", { level: 1, name: "Overview", exact: true }).waitFor();
  return { page, home };
}

(async () => {
  // 1. Without an updater the app shows its version and never offers an update.
  let app = await launch();
  try {
    const { page, home } = await open(app);
    assert.deepEqual(await page.evaluate(() => window.portfolio.updateState()), { status: "disabled", reason: "headless" });
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const row = page.getByRole("group", { name: "Version and updates" });
    assert.equal((await row.innerText()).trim(), `Stock Portfolio ${home.appVersion}`);
  } finally {
    await app.close();
  }

  // 2. A ready update asks once, with both versions, the notes and three choices.
  app = await launch({ STACK_PORTFOLIO_DEMO_UPDATE: "9.9.9" });
  try {
    const { page, home } = await open(app);
    const dialog = page.getByRole("dialog", { name: "A new version is ready to install" });
    await dialog.waitFor();
    const shown = (await dialog.innerText()).replace(/\s+/g, " ");
    assert.ok(shown.includes(`Current version ${home.appVersion}`), shown);
    assert.ok(shown.includes("New version 9.9.9"));
    assert.ok(shown.includes("Released 2026-12-05"));
    assert.ok(shown.includes("In-app updates."));
    assert.ok(!/[一-鿿]/.test(shown), `only the app's language is shown: ${shown}`);
    assert.deepEqual(await dialog.locator(".upd-tag").evaluateAll((tags) => tags.map((tag) => `${tag.className.replace("upd-tag ", "")}:${tag.textContent}`)),
      ["new:New", "improved:Improved", "fixed:Fixed"]);
    assert.ok(shown.includes("Your ledger and settings are not changed"));
    for (const name of ["Restart and update", "Remind me later", "Skip this version"])
      assert.ok(await dialog.getByRole("button", { name }).isVisible(), name);
    await shot(page, "update-dialog");

    // "Later" closes it, remembers the answer, and leaves the sidebar card.
    await dialog.getByRole("button", { name: "Remind me later" }).click();
    await dialog.waitFor({ state: "detached" });
    await remembered("promptedVersion", "9.9.9");
    const side = page.getByRole("navigation");
    const card = side.getByRole("button", { name: "View and update" });
    await card.waitFor();
    assert.ok((await side.innerText()).includes(`Current ${home.appVersion} · Downloaded`));
    await shot(page, "update-card");

    // The card reopens the same dialog; closing a dialog the user opened does not ask again.
    await card.click();
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });

    // Settings names the installed version and offers the update.
    await side.getByRole("button", { name: "Settings", exact: true }).click();
    const row = page.getByRole("group", { name: "Version and updates" });
    assert.ok((await row.innerText()).includes(`Stock Portfolio ${home.appVersion}`));
    assert.ok((await row.innerText()).includes("9.9.9 is downloaded and ready to install"));
    await shot(page, "update-settings");
    await row.getByRole("button", { name: "What's new" }).click();
    await dialog.waitFor();

    // "Skip" removes the offer from the sidebar; Settings still has it.
    await dialog.getByRole("button", { name: "Skip this version" }).click();
    await dialog.waitFor({ state: "detached" });
    await remembered("skippedVersion", "9.9.9");
    await card.waitFor({ state: "detached" });
    assert.ok((await side.innerText()).includes(`Version ${home.appVersion}`));
    assert.ok(!(await side.innerText()).includes("9.9.9"));
    assert.ok(await row.getByRole("button", { name: "Restart and update" }).isVisible());
    await shot(page, "update-skipped");
  } finally {
    await app.close();
  }

  // 3. The next launch does not ask about the skipped version, and a newer one asks again.
  app = await launch({ STACK_PORTFOLIO_DEMO_UPDATE: "9.9.9" });
  try {
    const { page } = await open(app);
    await page.waitForFunction(() => window.portfolio.updateState().then((state) => state.status === "ready"));
    assert.deepEqual(await page.evaluate(() => window.portfolio.updateState().then(({ prompt, skipped }) => ({ prompt, skipped }))), { prompt: false, skipped: true });
    assert.equal(await page.getByRole("dialog").count(), 0);
  } finally {
    await app.close();
  }
  app = await launch({ STACK_PORTFOLIO_DEMO_UPDATE: "9.9.10" });
  try {
    const { page } = await open(app);
    await page.getByRole("dialog", { name: "A new version is ready to install" }).waitFor();
  } finally {
    await app.close();
  }

  // 4. A trial launch never checks.
  app = await launch({ STACK_PORTFOLIO_DEMO_UPDATE: "" }, "--trial");
  try {
    const page = await app.firstWindow();
    assert.deepEqual(await page.evaluate(() => window.portfolio.updateState()), { status: "disabled", reason: "trial" });
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log("app update ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
