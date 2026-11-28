const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createAppUpdate, plainNotes, RECHECK_MS } = require("../appUpdate.cjs");

const READY = { status: "ready", version: "1.5.1", notes: "", releaseDate: "", prompt: true, skipped: false };
function remembering(initial = {}) {
  const saved = { ...initial };
  return { saved, memory: { read: () => saved, write: (patch) => Object.assign(saved, patch) } };
}
const asked = (update) => ({ prompt: update.state().prompt, skipped: update.state().skipped });

// Stands in for electron-updater: records calls and lets a test decide how a check ends.
function fakeUpdater() {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.installs = [];
  updater.pending = [];
  updater.checkForUpdates = () => {
    updater.checks += 1;
    return new Promise((resolve, reject) => updater.pending.push({ resolve, reject }));
  };
  updater.quitAndInstall = (...args) => updater.installs.push(args);
  updater.finish = () => updater.pending.shift().resolve(null);
  updater.reject = () => updater.pending.shift().reject(Error("offline"));
  return updater;
}

function setup(options = {}) {
  const updater = fakeUpdater();
  const states = [];
  const notes = [];
  const timers = [];
  const update = createAppUpdate({
    updater,
    onState: (state) => states.push(state),
    onNote: (code) => notes.push(code),
    now: () => 1000,
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: (id) => { timers[id - 1].cleared = true; },
    ...options,
  });
  return { updater, update, states, notes, timers };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const statuses = (states) => states.map((state) => state.status);

async function downloaded({ updater, update }, version = "1.5.1") {
  update.start();
  updater.emit("update-available", { version });
  updater.emit("update-downloaded", { version });
  updater.finish();
  await settle();
}

test("a launch with updates off never touches the updater", async () => {
  for (const reason of ["unpackaged", "trial", "headless", "unavailable"]) {
    const { updater, update, states, timers } = setup({ disabledReason: reason });
    assert.deepEqual(update.state(), { status: "disabled", reason });
    update.start();
    await update.check();
    assert.equal(await update.install(), false);
    assert.equal(updater.checks, 0);
    assert.equal(updater.listenerCount("update-available"), 0);
    assert.equal(timers.length, 0);
    assert.deepEqual(states, []);
  }
  assert.throws(() => createAppUpdate({ updater: fakeUpdater(), disabledReason: "other" }));
});

test("starting configures the updater and checks once", () => {
  const { updater, update, timers } = setup();
  assert.deepEqual(update.state(), { status: "idle" });
  update.start();
  update.start();
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false, "never installs on an ordinary quit");
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.checks, 1);
  assert.equal(updater.listenerCount("error"), 1);
  assert.deepEqual(timers.map((timer) => timer.ms), [RECHECK_MS]);
  assert.deepEqual(update.state(), { status: "checking" });
});

test("no newer version ends as current", async () => {
  const { updater, update, states } = setup();
  update.start();
  updater.emit("update-not-available", { version: "1.5.0" });
  updater.finish();
  await settle();
  assert.deepEqual(statuses(states), ["checking", "current"]);
  assert.deepEqual(update.state(), { status: "current", checkedAt: 1000 });
});

test("a check that resolves without an event ends as current", async () => {
  const { updater, update } = setup();
  update.start();
  updater.finish();
  await settle();
  assert.deepEqual(update.state(), { status: "current", checkedAt: 1000 });
});

test("a newer version downloads and becomes ready", async () => {
  const { updater, update, states } = setup();
  update.start();
  updater.emit("update-available", { version: "1.5.1" });
  assert.deepEqual(update.state(), { status: "downloading", version: "1.5.1", percent: 0 });
  updater.emit("download-progress", { percent: 41.9 });
  updater.emit("download-progress", { percent: 41.95 });
  updater.emit("download-progress", { percent: 12 });
  assert.equal(update.state().percent, 41, "whole percent, never backwards");
  updater.emit("download-progress", { percent: 250 });
  assert.equal(update.state().percent, 100);
  updater.emit("update-downloaded", { version: "1.5.1" });
  updater.finish();
  await settle();
  assert.deepEqual(update.state(), READY);
  assert.deepEqual(statuses(states), ["checking", "downloading", "downloading", "downloading", "ready"]);
  assert.equal(updater.installs.length, 0, "nothing installs without the user");
});

test("a failed check is recorded and can be retried", async () => {
  const { updater, update, notes } = setup();
  update.start();
  updater.reject();
  await settle();
  assert.deepEqual(update.state(), { status: "failed", checkedAt: 1000 });
  assert.deepEqual(notes, ["update_check_failed"]);
  const retry = update.check();
  assert.equal(updater.checks, 2);
  updater.emit("update-not-available", {});
  updater.finish();
  await retry;
  assert.equal(update.state().status, "current");
});

test("an error event and a rejected check count as one failure", async () => {
  const { updater, update, notes, states } = setup();
  update.start();
  updater.emit("error", Error("offline"));
  updater.reject();
  await settle();
  assert.deepEqual(notes, ["update_check_failed"]);
  assert.deepEqual(statuses(states), ["checking", "failed"]);
});

test("a failed download is recorded as a download failure", async () => {
  const { updater, update, notes } = setup();
  update.start();
  updater.emit("update-available", { version: "1.5.1" });
  updater.emit("error", Error("truncated"));
  updater.finish();
  await settle();
  assert.equal(update.state().status, "failed");
  assert.deepEqual(notes, ["update_download_failed"]);
});

test("checks do not overlap or disturb a download or a ready update", async () => {
  const context = setup();
  const { updater, update } = context;
  update.start();
  await update.check();
  assert.equal(updater.checks, 1, "already checking");
  updater.emit("update-available", { version: "1.5.1" });
  await update.check();
  assert.equal(updater.checks, 1, "already downloading");
  updater.emit("update-downloaded", { version: "1.5.1" });
  updater.finish();
  await settle();
  await update.check();
  updater.emit("error", Error("late"));
  updater.emit("update-not-available", {});
  assert.equal(updater.checks, 1, "already ready");
  assert.deepEqual(update.state(), READY);
});

test("the timer rechecks, and a blocked launch skips the check", async () => {
  let allowed = false;
  const { updater, update, timers } = setup({ canCheck: () => allowed });
  update.start();
  assert.equal(updater.checks, 0);
  assert.deepEqual(update.state(), { status: "idle" });
  allowed = true;
  timers[0].fn();
  assert.equal(updater.checks, 1);
  updater.finish();
  await settle();
  timers[0].fn();
  assert.equal(updater.checks, 2);
});

test("install runs only when ready, after the ledger is released", async () => {
  const order = [];
  const context = setup({ beforeInstall: async () => { order.push("released"); } });
  const { updater, update } = context;
  assert.equal(await update.install(), false);
  await downloaded(context);
  updater.quitAndInstall = (...args) => order.push(args);
  const both = await Promise.all([update.install(), update.install()]);
  assert.deepEqual(both, [true, false], "a second request does not install twice");
  assert.deepEqual(order, ["released", [true, true]]);
  await update.check();
  assert.equal(updater.checks, 1, "no check while installing");
});

test("an install that cannot release the ledger stays offered", async () => {
  let fails = true;
  const context = setup({ beforeInstall: async () => { if (fails) throw Error("ledger busy"); } });
  const { updater, update, notes } = context;
  await downloaded(context);
  await assert.rejects(update.install(), /ledger busy/);
  assert.equal(updater.installs.length, 0);
  assert.deepEqual(update.state(), READY);
  assert.deepEqual(notes, ["update_install_failed"]);
  fails = false;
  assert.equal(await update.install(), true);
  assert.deepEqual(updater.installs, [[true, true]]);
});

test("a ready update carries its notes and release date", async () => {
  const { updater, update } = setup();
  update.start();
  updater.emit("update-available", { version: "1.5.1" });
  updater.emit("update-downloaded", {
    version: "1.5.1", releaseDate: "2026-12-05T03:10:00.000Z",
    releaseNotes: "<h2>New</h2><ul><li>In-app updates</li><li>A &amp; B</li></ul>",
  });
  updater.finish();
  await settle();
  assert.deepEqual(update.state(), { ...READY, notes: "## New\n- In-app updates\n- A & B", releaseDate: "2026-12-05" });
});

test("release notes become plain text whatever they contain", () => {
  assert.equal(plainNotes(null), "");
  assert.equal(plainNotes(42), "");
  assert.equal(plainNotes("Fixes\r\n\r\n\r\n- one\n- two"), "Fixes\n\n- one\n- two");
  assert.equal(plainNotes([{ version: "1.5.1", note: "<p>b</p>" }, { version: "1.5.0", note: "a" }]), "b\n\na");
  assert.equal(plainNotes('<img src=x onerror="alert(1)"><script>alert(2)</script><a href="https://example.com">link</a>'), "alert(2)link");
  assert.ok(!/[<>]/.test(plainNotes("<b>x</b><i>y <scr<script>ipt>")));
  assert.equal(plainNotes("x".repeat(9000)).length, 4000);
});

test("later keeps the update offered without asking again", async () => {
  const { saved, memory } = remembering();
  const context = setup({ memory });
  await downloaded(context);
  assert.equal(context.update.state().prompt, true);
  context.update.later();
  assert.deepEqual(saved, { promptedVersion: "1.5.1" });
  assert.deepEqual(asked(context.update), { prompt: false, skipped: false });
  const next = setup({ memory });
  await downloaded(next);
  assert.deepEqual(asked(next.update), { prompt: false, skipped: false }, "the next launch does not ask again");
});

test("skip hides one version and a newer one asks again", async () => {
  const { saved, memory } = remembering();
  const context = setup({ memory });
  await downloaded(context);
  context.update.skip();
  assert.deepEqual(saved, { promptedVersion: "1.5.1", skippedVersion: "1.5.1" });
  assert.deepEqual(asked(context.update), { prompt: false, skipped: true });
  assert.equal(await context.update.install(), true, "a skipped version can still be installed on request");
  const same = setup({ memory });
  await downloaded(same);
  assert.deepEqual(asked(same.update), { prompt: false, skipped: true });
  const newer = setup({ memory });
  await downloaded(newer, "1.5.2");
  assert.deepEqual(asked(newer.update), { prompt: true, skipped: false });
});

test("the launch after an installed update reports it once", async () => {
  const { saved, memory } = remembering();
  const context = setup({ memory });
  context.update.start();
  context.updater.emit("update-downloaded", { version: "1.5.1", releaseNotes: "- faster" });
  context.updater.finish();
  await settle();
  assert.equal(setup({ memory }).update.takeInstalled("1.5.1"), null, "nothing was installed yet");
  await context.update.install();
  assert.deepEqual(saved.installed, { version: "1.5.1", notes: "- faster" });
  const next = setup({ memory, disabledReason: "trial" }).update;
  assert.deepEqual(next.takeInstalled("1.5.1"), { version: "1.5.1", notes: "- faster" });
  assert.equal(next.takeInstalled("1.5.1"), null, "reported once");
  saved.installed = { version: "1.5.1", notes: "" };
  assert.equal(next.takeInstalled("1.5.0"), null, "the installation did not complete");
  assert.equal(saved.installed, null);
});

test("later and skip do nothing before an update is ready", () => {
  const { saved, memory } = remembering();
  const { update } = setup({ memory });
  update.later();
  update.skip();
  assert.deepEqual(saved, {});
  assert.deepEqual(update.state(), { status: "idle" });
});

test("stopping removes the listeners and the timer", () => {
  const { updater, update, timers, states } = setup();
  update.start();
  update.stop();
  update.stop();
  assert.equal(timers[0].cleared, true);
  for (const event of ["error", "update-available", "update-not-available", "download-progress", "update-downloaded"])
    assert.equal(updater.listenerCount(event), 0);
  updater.emit("update-available", { version: "9.9.9" });
  assert.deepEqual(statuses(states), ["checking"]);
});
