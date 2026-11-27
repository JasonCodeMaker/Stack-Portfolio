const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { requestFactoryReset, finishFactoryReset } = require("../factoryReset.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-reset-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, "Stock Portfolio");
  const outside = path.join(root, "external");
  fs.mkdirSync(profile);
  fs.mkdirSync(outside);
  return { root, profile, outside };
}

test("only a pending reset clears the app profile, including nested data", (t) => {
  const { profile, outside } = fixture(t);
  const external = path.join(outside, "exported.spbackup");
  fs.writeFileSync(external, "portable backup");
  for (const name of ["portfolio.sqlite", "sample.sqlite", "ledger-key.v1", "workspace.json", "old.spbackup"]) {
    fs.writeFileSync(path.join(profile, name), name);
  }
  const partition = path.join(profile, "Partitions", "broker-session");
  fs.mkdirSync(partition, { recursive: true });
  fs.writeFileSync(path.join(partition, "Cookies"), "session");
  fs.symlinkSync(outside, path.join(partition, "external-link"), "junction");

  finishFactoryReset(profile);
  assert.equal(fs.existsSync(path.join(profile, "portfolio.sqlite")), true);
  requestFactoryReset(profile);
  assert.equal(fs.existsSync(path.join(profile, "portfolio.sqlite")), true);
  finishFactoryReset(profile);
  assert.deepEqual(fs.readdirSync(profile), []);
  assert.equal(fs.readFileSync(external, "utf8"), "portable backup");
  finishFactoryReset(profile);
});

test("refuses a linked profile and ignores an invalid pending marker as a deletion instruction", (t) => {
  const { root, profile, outside } = fixture(t);
  const outsideFile = path.join(outside, "source.sqlite");
  fs.writeFileSync(outsideFile, "external original");
  const linkedProfile = path.join(root, "linked-profile");
  fs.symlinkSync(outside, linkedProfile, "junction");
  assert.throws(() => requestFactoryReset(linkedProfile), /not a regular profile directory/);
  requestFactoryReset(profile);
  const marker = path.join(profile, fs.readdirSync(profile)[0]);
  fs.unlinkSync(marker);
  fs.linkSync(outsideFile, marker);
  fs.writeFileSync(path.join(profile, "portfolio.sqlite"), "keep this ledger");
  assert.throws(() => finishFactoryReset(profile), /Invalid factory reset marker/);
  assert.equal(fs.readFileSync(path.join(profile, "portfolio.sqlite"), "utf8"), "keep this ledger");
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "external original");
});

test("a failed flush never publishes a pending reset", (t) => {
  const { profile } = fixture(t);
  const ledger = path.join(profile, "portfolio.sqlite");
  fs.writeFileSync(ledger, "keep this ledger");
  t.mock.method(fs, "fsyncSync", () => { throw Error("simulated flush failure"); });

  assert.throws(() => requestFactoryReset(profile), /simulated flush failure/);
  finishFactoryReset(profile);
  assert.deepEqual(fs.readdirSync(profile), ["portfolio.sqlite"]);
  assert.equal(fs.readFileSync(ledger, "utf8"), "keep this ledger");
});
