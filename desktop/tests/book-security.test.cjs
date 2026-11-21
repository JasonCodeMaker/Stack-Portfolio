const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomBytes } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createBook, protectOldBook, backupMode } = require("../out/ledger.cjs");
const { localKey, localKeyName, backupKey, openDatabase, isPlainDatabase, encryptedCopy, publishFile,
  checkIntegrity } = require("../bookStorage.cjs");

const key = () => Buffer.from("raw:" + randomBytes(32).toString("hex"));
const marker = "private-test-account-" + randomBytes(12).toString("hex");
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-crypto-"));
  t.after(() => {
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
    fs.rmdirSync(dir);
  });
  return dir;
}

test("upgrades an old SQLite ledger including committed WAL frames; subsequent opens keep the ciphertext", (t) => {
  const dir = directory(t), source = path.join(dir, "old.db"), dest = path.join(dir, "portfolio.sqlite");
  const secret = key(), seed = createBook(path.join(dir, "schema.db"), secret);
  const old = new DatabaseSync(source);
  try {
    for (const { sql } of seed.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid").all()) old.exec(sql);
    old.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO sp_meta VALUES ('version','1')");
    old.prepare("INSERT INTO sp_accounts VALUES ('a',?,'AUD',1,'TRANSACTIONS')").run(marker);
    fs.copyFileSync(source, dest);
    fs.copyFileSync(source + "-wal", dest + "-wal");
  } finally {
    old.close();
    seed.close();
  }
  assert.ok(isPlainDatabase(dest));
  protectOldBook(dest, secret);
  assert.ok(!isPlainDatabase(dest));
  const bytes = fs.readFileSync(dest);
  assert.ok(!bytes.includes(Buffer.from(marker)));
  protectOldBook(dest, secret);
  assert.deepEqual(fs.readFileSync(dest), bytes);
  assert.throws(() => openDatabase(dest, key(), { readonly: true, existing: true }));
  const migrated = openDatabase(dest, secret);
  try {
    assert.equal(backupMode(migrated), "real");
    assert.equal(migrated.prepare("SELECT name FROM sp_accounts").get().name, marker);
    // Force an original page into the rollback journal, as a crash during an edit would.
    migrated.exec("PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE; UPDATE sp_accounts SET name='changed'");
    assert.ok(!fs.readFileSync(dest + "-journal").includes(Buffer.from(marker)));
    migrated.exec("ROLLBACK");
  } finally { migrated.close(); }
});

test("a portable backup reopens under a new local key; wrong passwords, corruption and interrupted writes preserve the destination", (t) => {
  const dir = directory(t), ledger = path.join(dir, "book.db"), backup = path.join(dir, "备份 # &.spbackup");
  const secret = key(), portable = backupKey("unicode 测试 & ' # % " + randomBytes(12).toString("hex"));
  const db = createBook(ledger, secret);
  try {
    db.prepare("INSERT INTO sp_accounts VALUES ('a',?,'AUD',1,'TRANSACTIONS')").run(marker);
    publishFile(backup, (stage) => encryptedCopy(db, stage, portable));
  } finally { db.close(); }
  const previous = fs.readFileSync(ledger);
  const contents = fs.readFileSync(backup);
  assert.ok(!isPlainDatabase(backup) && !contents.includes(Buffer.from(marker)));
  assert.ok(!contents.includes(portable));
  assert.throws(() => openDatabase(backup, backupKey("a different password"), { readonly: true, existing: true }));
  const read = openDatabase(backup, portable, { readonly: true, existing: true });
  const newKey = key();
  try {
    assert.throws(() => publishFile(ledger, (stage) => {
      encryptedCopy(read, stage, newKey);
      throw Error("simulated interruption");
    }), /interruption/);
    assert.deepEqual(fs.readFileSync(ledger), previous);
    publishFile(ledger, (stage) => encryptedCopy(read, stage, newKey));
  } finally { read.close(); }
  const fresh = openDatabase(ledger, newKey);
  try { assert.equal(fresh.prepare("SELECT name FROM sp_accounts").get().name, marker); }
  finally { fresh.close(); }
  contents[contents.length - 32] ^= 1;
  fs.writeFileSync(backup, contents);
  assert.throws(() => {
    const corrupt = openDatabase(backup, portable, { readonly: true, existing: true });
    try { checkIntegrity(corrupt); } finally { corrupt.close(); }
  });
  assert.ok(!fs.readdirSync(dir).some((file) => file.includes(".tmp")));
});

test("a missing or unreadable Windows key cannot be regenerated over an encrypted book", (t) => {
  const dir = directory(t), file = path.join(dir, localKeyName);
  // The fake protector never holds a real Windows user's key.
  const protectedValues = new Map();
  const protection = {
    isEncryptionAvailable: () => true,
    encryptString(value) { const id = randomBytes(32); protectedValues.set(id.toString("hex"), value); return id; },
    decryptString(bytes) { const value = protectedValues.get(bytes.toString("hex")); if (!value) throw Error(); return value; },
  };
  assert.throws(() => localKey(dir, protection, false));
  assert.ok(!fs.existsSync(file));
  const secret = localKey(dir, protection, true);
  assert.deepEqual(localKey(dir, protection, false), secret);
  assert.ok(!fs.readFileSync(file).includes(secret));
  const corrupt = randomBytes(19);
  fs.writeFileSync(file, corrupt);
  assert.throws(() => localKey(dir, protection, true));
  assert.deepEqual(fs.readFileSync(file), corrupt);
  assert.throws(() => localKey(dir, { isEncryptionAvailable: () => false }, true));
  assert.throws(() => createBook(path.join(dir, "new.sqlite")));
  assert.ok(!fs.existsSync(path.join(dir, "new.sqlite")));
});
