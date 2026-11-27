const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fundsUrl = "https://www.webull.com.au/center/fund-list";
const activity = { activityType: "DEPOSIT", amount: 50 };

function fixture() {
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      windows.push(this);
      this.verified = options.show;
      this.visible = options.show;
      this.destroyed = false;
      this.loads = 0;
      this.url = "";
      this.webContents = {
        session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} },
        setWindowOpenHandler() {},
        on() {},
        getURL: () => this.url,
        isLoadingMainFrame: () => false,
        executeJavaScript: async (script) => script.includes("pageStatusAnchor")
          ? (this.verified ? "ready" : "verification")
          : [activity],
      };
    }
    removeMenu() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
    async loadURL(url) { this.url = url; this.loads++; }
  }
  const module = { exports: {} };
  const code = fs.readFileSync(path.join(__dirname, "../webullFundsWindow.cjs"), "utf8");
  vm.runInNewContext(code, {
    module, URL, setTimeout, clearTimeout,
    require(name) {
      if (name === "electron") return { BrowserWindow };
      if (name === "node:crypto") return require(name);
      if (name === "./brokers/webullFunds.ts") return {
        WEBULL_FUNDS_URL: fundsUrl,
        webullFundsPageStatus: function pageStatusAnchor() {},
        readWebullFundsPage: function depositReaderAnchor() {},
        parseWebullFundsDeposits: (rows) => rows,
      };
      throw Error("Unexpected test module " + name);
    },
  });
  return { ...module.exports, windows, parent: new EventEmitter() };
}

test("the verified page supplies the immediate preview and subsequent syncs", async () => {
  const { connectWebullFunds, fetchWebullFunds, windows, parent } = fixture();
  assert.equal(await connectWebullFunds("webull-account", parent, "Webull"), "loaded");
  const first = await fetchWebullFunds("webull-account");
  assert.equal(first.status, "loaded");
  assert.deepEqual(first.activities, [activity]);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].visible, false);
  assert.equal(windows[0].loads, 1, "the immediate retry must use the records already retrieved");

  const second = await fetchWebullFunds("webull-account");
  assert.equal(second.status, "loaded");
  assert.deepEqual(second.activities, [activity]);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].loads, 2);
  parent.emit("closed");
  assert.equal(windows[0].isDestroyed(), true);
});
