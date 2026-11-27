const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createDiagnostics } = require("../diagnostics.cjs");

const day = 86_400_000;
const megabyte = 1024 * 1024;
const fixedNow = Date.parse("2026-11-27T12:00:00Z");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sp-diagnostics-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "diagnostics");
  const create = () => createDiagnostics({ directory, build: "1.4.23", operations: ["example", "startup", "shutdown"], now: () => fixedNow });
  return { directory, create };
}

test("diagnostics enforces segment bounds, recovers a partial file, and saves the exact preview snapshot", async (t) => {
  const { directory, create } = await fixture(t);
  const diagnostics = create();
  await fs.mkdir(directory);
  const name = (time) => path.join(directory, `events-${time}.jsonl`);
  const expired = name(fixedNow - 8 * day);
  await fs.writeFile(expired, "old");
  const files = Array.from({ length: 5 }, (_, i) => name(fixedNow - 5 + i));
  for (const file of files) await fs.writeFile(file, " ".repeat(megabyte - 10));
  diagnostics.emit("example", "main", "open", "succeeded");
  const preview = await diagnostics.preview("day");
  const present = await fs.readdir(directory);
  assert.equal(present.length, 5);
  assert.ok(!present.includes(path.basename(expired)));
  assert.ok(!present.includes(path.basename(files[0])));
  for (const file of present) assert.ok((await fs.stat(path.join(directory, file))).size <= megabyte);
  assert.match(preview.text, /"stage":"open"/);

  diagnostics.emit("example", "main", "commit", "succeeded");
  assert.equal(diagnostics.snapshot(preview.id), preview.text);
  const refreshed = await diagnostics.preview("day");
  assert.match(refreshed.text, /"stage":"commit"/);
  const active = name(fixedNow);
  await fs.appendFile(active, '{"secret":"PRIVATE_UNFINISHED');
  diagnostics.emit("example", "main", "replace", "succeeded");
  await diagnostics.preview("day");
  diagnostics.emit("example", "main", "integrity", "succeeded");
  const recovered = await diagnostics.preview("day");
  assert.match(recovered.text, /"stage":"integrity"/);
  assert.doesNotMatch(recovered.text, /PRIVATE_UNFINISHED/);
  assert.equal(recovered.incomplete, true);
  await diagnostics.stop();
});

test("diagnostics signals a storage failure without changing the operation or logging untrusted values", async (t) => {
  const { directory, create } = await fixture(t);
  await fs.writeFile(directory, "not a directory");
  const diagnostics = create();
  const original = new Error("PRIVATE_NOT_FOR_DISK");
  await assert.rejects(diagnostics.run("example", "dispatch", () => {
    diagnostics.stage("execute");
    throw original;
  }), (thrown) => thrown === original);
  const preview = await diagnostics.preview("day");
  assert.equal(preview.count, 0);
  assert.equal(preview.incomplete, true);
  await fs.unlink(directory);
  diagnostics.mark("PRIVATE_SCREEN");
  diagnostics.renderer("startup", "PRIVATE_STAGE");
  diagnostics.setPaused(true);
  diagnostics.emit("example", "main", "execute", "succeeded");
  assert.equal((await diagnostics.preview("day")).count, 0);
  diagnostics.setPaused(false);
  diagnostics.mark("startup");
  const marked = await diagnostics.preview("recent");
  assert.equal(marked.count, 1);
  assert.doesNotMatch(marked.text, /PRIVATE/);
  await diagnostics.clear();
  assert.equal(diagnostics.snapshot(marked.id), undefined);
  assert.deepEqual(await fs.readdir(directory), []);
  await diagnostics.stop();
});
