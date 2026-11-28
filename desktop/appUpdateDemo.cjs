const { EventEmitter } = require("node:events");

// Written the way a release body is: one section per language, categories inside each.
const NOTES = [
  "# English",
  "## New",
  "- In-app updates. A new version downloads by itself; you decide when to restart and install it.",
  "- Delete a custom account permanently, together with its records.",
  "## Improved",
  "- Webull IVV and NDQ look through to their underlying companies again.",
  "## Fixed",
  "- The ledger is backed up before a structural upgrade.",
  "# 简体中文",
  "## 新功能",
  "- 应用内更新。新版本会自动下载，由你决定何时重启安装。",
  "- 永久删除自定义账户及其记录。",
  "## 改进",
  "- Webull 的 IVV 和 NDQ 恢复穿透到底层公司。",
  "## 修复",
  "- 账本结构升级前会先自动备份。",
  "# 繁體中文",
  "## 新功能",
  "- 應用程式內更新。新版本會自動下載，由你決定何時重新啟動安裝。",
  "- 永久刪除自訂帳戶及其記錄。",
  "## 改進",
  "- Webull 的 IVV 和 NDQ 恢復穿透到底層公司。",
  "## 修復",
  "- 帳本結構升級前會先自動備份。",
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
