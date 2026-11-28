const { EventEmitter } = require("node:events");

const NOTES = [
  "## New",
  "- In-app updates. A new version downloads by itself; you decide when to restart and install it.",
  "- Delete a custom account permanently, together with its records.",
  "## Improved",
  "- Webull IVV and NDQ look through to their underlying companies again.",
  "## Fixed",
  "- The ledger is backed up before a structural upgrade.",
].join("\n");

// Stands in for the updater library in an unpackaged run, so the update interface can be seen and
// tested without a network or an installer. It finds one ready update and installs nothing.
function demoUpdater(version) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    updater.emit("update-available", { version });
    updater.emit("update-downloaded", { version, releaseDate: "2026-12-05T00:00:00.000Z", releaseNotes: NOTES });
    return null;
  };
  updater.quitAndInstall = () => {};
  return updater;
}

module.exports = { demoUpdater };
