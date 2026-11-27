const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const pendingName = ".factory-reset-pending";
// Electron holds these while we own the single-instance lock during startup.
const instanceFiles = new Set(process.platform === "win32"
  ? ["lockfile"]
  : ["SingletonLock", "SingletonCookie", "SingletonSocket"]);

function checkProfile(profile) {
  const parent = path.dirname(profile);
  const expected = path.join(fs.realpathSync(parent), path.basename(profile));
  if (parent === profile || !fs.lstatSync(profile).isDirectory() || path.relative(expected, fs.realpathSync(profile))) {
    throw Error("The application data directory is not a regular profile directory");
  }
}

function requestFactoryReset(profile) {
  checkProfile(profile);
  const pending = path.join(profile, pendingName);
  const staging = `${pending}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(staging, "", { flag: "wx", mode: 0o600, flush: true });
    fs.renameSync(staging, pending);
  } catch (error) {
    try { fs.rmSync(staging, { force: true }); } catch {}
    throw error;
  }
}

function finishFactoryReset(profile) {
  const marker = path.join(profile, pendingName);
  let pending;
  try {
    pending = fs.lstatSync(marker);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  checkProfile(profile);
  if (!pending.isFile() || pending.size !== 0) throw Error("Invalid factory reset marker");

  for (const entry of fs.readdirSync(profile, { withFileTypes: true })) {
    if (entry.name === pendingName || instanceFiles.has(entry.name)) continue;
    fs.rmSync(path.join(profile, entry.name), { recursive: entry.isDirectory(), force: true });
  }
  fs.unlinkSync(marker);
}

module.exports = { requestFactoryReset, finishFactoryReset };
