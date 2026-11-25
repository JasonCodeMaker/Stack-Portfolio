const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { tMain } = require("./i18n/index.js");
// SQLite3 Multiple Ciphers reads this option when its native addon initializes.
// VACUUM INTO uses bound file URIs to encrypt the destination from its first page.
process.env.SQLITE_USE_URI = "1";
const Database = require("better-sqlite3-multiple-ciphers");

const sqliteHeader = Buffer.from("SQLite format 3\0");
const localKeyName = "ledger-key.v1";

function isPlainDatabase(file) {
  const fd = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(sqliteHeader.length);
    return fs.readSync(fd, header, 0, header.length, 0) === header.length && header.equals(sqliteHeader);
  } finally {
    fs.closeSync(fd);
  }
}

function localKey(directory, protection, create) {
  const file = path.join(directory, localKeyName);
  if (!protection.isEncryptionAvailable()) throw Error(tMain("storage.dpapiUnavailable"));
  if (!fs.existsSync(file)) {
    if (!create) throw Error(tMain("storage.locked"));
    const secret = randomBytes(32);
    try {
      const wrapped = protection.encryptString(secret.toString("hex"));
      // Publish only a complete, flushed key. An existing key must never be replaced.
      const temp = file + "." + randomUUID() + ".tmp";
      try {
        fs.writeFileSync(temp, wrapped, { flag: "wx", mode: 0o600, flush: true });
        fs.linkSync(temp, file);
      } finally {
        fs.rmSync(temp, { force: true });
      }
    } finally {
      secret.fill(0);
    }
  }
  try {
    const hex = protection.decryptString(fs.readFileSync(file));
    if (!/^[0-9a-f]{64}$/.test(hex)) throw Error();
    return Buffer.from("raw:" + hex);
  } catch {
    throw Error(tMain("storage.locked"));
  }
}

function backupKey(password) {
  if (typeof password !== "string" || password.trim().length < 12 || password.length > 1024)
    throw Error(tMain("storage.backupPasswordLength"));
  // A prefix keeps even passwords starting with "raw:" on SQLCipher's password KDF path.
  return Buffer.from("Stack Portfolio backup v1\n" + password, "utf8");
}

function openDatabase(file, key, { readonly = false, existing = false } = {}) {
  if (key != null && (!Buffer.isBuffer(key) || !key.length)) throw Error(tMain("storage.missingKey"));
  if (fs.existsSync(file) && fs.statSync(file).size === 0) throw Error(tMain("storage.emptyFile"));
  if (!key && (!existing || !isPlainDatabase(file))) throw Error(tMain("storage.locked"));
  const db = new Database(path.resolve(file), { readonly, fileMustExist: existing });
  try {
    if (key) {
      db.pragma("cipher='sqlcipher'");
      db.key(key);
    }
    db.exec("PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON");
    // Force authentication before handing the connection to a caller.
    db.prepare("SELECT count(*) FROM sqlite_schema").get();
    return db;
  } catch (e) {
    db.close();
    if (e.code === "SQLITE_NOTADB" || e.code === "SQLITE_CORRUPT")
      throw Error(tMain("storage.badKeyOrCorrupt"));
    throw e;
  }
}

function checkIntegrity(db) {
  const result = db.pragma("quick_check");
  if (result.length !== 1 || result[0].quick_check !== "ok") throw Error(tMain("storage.integrityFailed"));
}

function encryptedCopy(sourceDb, destination, key) {
  if (!Buffer.isBuffer(key) || !key.length) throw Error(tMain("storage.missingDestKey"));
  if (fs.existsSync(destination)) throw Error(tMain("storage.destExists"));
  const uri = pathToFileURL(destination);
  uri.searchParams.set("cipher", "sqlcipher");
  // Hex encoding preserves all password bytes without exposing them in SQL or errors.
  uri.searchParams.set("hexkey", key.toString("hex"));
  try {
    sourceDb.prepare("VACUUM INTO ?").run(uri.href);
  } catch (e) {
    if (e.code === "SQLITE_BUSY" || e.code === "SQLITE_LOCKED") throw Error(tMain("storage.dbBusy"));
    throw Error(tMain("storage.copyFailed"));
  }
  const copy = openDatabase(destination, key, { readonly: true, existing: true });
  try {
    checkIntegrity(copy);
  } finally {
    copy.close();
  }
}

// A crash can leave an encrypted stage, but the destination changes only at rename.
function publishFile(destination, write) {
  const temp = destination + "." + randomUUID() + ".tmp";
  try {
    const result = write(temp);
    const fd = fs.openSync(temp, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, destination);
    return result;
  } finally {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(temp + suffix, { force: true });
  }
}

// Recover hot journals and checkpoint committed WAL frames *before* swapping files.
// An exclusive lock also detects an old client still using this ledger.
function lockForReplacement(db) {
  db.pragma("locking_mode=EXCLUSIVE");
  if (db.pragma("journal_mode=DELETE", { simple: true }) !== "delete") throw Error(tMain("storage.closeProcess"));
  db.exec("BEGIN EXCLUSIVE; COMMIT");
}

function assertNoJournal(file) {
  if (["-wal", "-shm", "-journal"].some((suffix) => fs.existsSync(file + suffix)))
    throw Error(tMain("storage.journalRemains"));
}

module.exports = {
  localKeyName, localKey, backupKey, isPlainDatabase, openDatabase, checkIntegrity,
  encryptedCopy, publishFile, lockForReplacement, assertNoJournal,
};
