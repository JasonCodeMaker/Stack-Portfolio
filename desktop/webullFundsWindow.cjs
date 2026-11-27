const { BrowserWindow } = require("electron");
const { createHash } = require("node:crypto");
const {
  WEBULL_FUNDS_URL,
  webullFundsPageStatus,
  readWebullFundsPage,
  parseWebullFundsDeposits,
} = require("./brokers/webullFunds.ts");

const fundsUrl = new URL(WEBULL_FUNDS_URL);
const passport = "https://passport.webull.com.au";
const script = "(" + readWebullFundsPage.toString() + ")()";
const checkPage = "(" + webullFundsPageStatus.toString() + ")()";
const verifiedPages = new Map();
const operations = new Map();

function serial(account, run) {
  const previous = operations.get(account) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  operations.set(account, next);
  return next.finally(() => {
    if (operations.get(account) === next) operations.delete(account);
  });
}

function retainPage(account, browser, parent, activities) {
  let page = verifiedPages.get(account);
  if (!page) {
    page = { browser };
    verifiedPages.set(account, page);
    const close = () => {
      if (!browser.isDestroyed()) browser.destroy();
    };
    parent?.once("closed", close);
    browser.once("closed", () => {
      if (verifiedPages.get(account) === page) verifiedPages.delete(account);
      parent?.removeListener("closed", close);
    });
  }
  page.firstRead = activities;
  browser.hide();
}

function openWindow(account, options = {}) {
  const partition = "persist:webull-funds-" + createHash("sha256").update(account).digest("hex");
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    ...options,
    webPreferences: {
      partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  const { webContents: contents } = window;
  window.removeMenu();
  window.on("page-title-updated", (event) => event.preventDefault());
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const restrict = (event) => {
    if (!event.isMainFrame) return;
    try {
      if ([fundsUrl.origin, passport].includes(new URL(event.url).origin)) return;
    } catch {}
    event.preventDefault();
  };
  contents.on("will-navigate", restrict);
  contents.on("will-redirect", restrict);
  return window;
}

async function loadFundsPage(window) {
  let timeout;
  try {
    await Promise.race([
      window.loadURL(WEBULL_FUNDS_URL),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error("Webull Funds Records did not respond.")), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function currentUrl(window) {
  return new URL(window.webContents.getURL());
}

function onPassport(window) {
  return !window.isDestroyed() && window.webContents.getURL().startsWith(passport + "/");
}

function onFundsPage(url) {
  return url.origin === fundsUrl.origin && url.pathname.replace(/\/$/, "") === fundsUrl.pathname;
}

async function readDeposits(window) {
  if (!onFundsPage(currentUrl(window))) throw Error("Unexpected Webull Funds Records URL.");
  return parseWebullFundsDeposits(await window.webContents.executeJavaScript(script));
}

async function pageStatus(browser) {
  if (onPassport(browser)) return "login";
  if (!onFundsPage(currentUrl(browser))) return "waiting";
  return browser.webContents.executeJavaScript(checkPage);
}

function fetchWebullFunds(account) {
  return serial(account, () => readFunds(account));
}

async function readFunds(account) {
  const verified = verifiedPages.get(account);
  if (verified?.firstRead) {
    const activities = verified.firstRead;
    verified.firstRead = undefined;
    return { status: "loaded", activities };
  }

  const browser = verified?.browser ?? openWindow(account);
  try {
    await loadFundsPage(browser);
    const end = Date.now() + 8_000;
    while (Date.now() < end) {
      const status = await pageStatus(browser);
      if (status === "login" || status === "verification") return { status };
      if (status === "ready") {
        try {
          return { status: "loaded", activities: await readDeposits(browser) };
        } catch {
          const after = await pageStatus(browser);
          return { status: after === "verification" || after === "login" ? after : "unavailable" };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { status: "unavailable" };
  } catch {
    return { status: onPassport(browser) ? "login" : "unavailable" };
  } finally {
    if (!verified && !browser.isDestroyed()) browser.destroy();
  }
}

function connectWebullFunds(account, parent, title) {
  return serial(account, () => verifyFunds(account, parent, title));
}

async function verifyFunds(account, parent, title) {
  const verified = verifiedPages.get(account);
  const browser = verified?.browser ?? openWindow(account, { parent, title, show: true });
  let loaded = false;
  try {
    if (verified) browser.show();
    else await loadFundsPage(browser);
    const end = Date.now() + 5 * 60_000;
    while (!browser.isDestroyed() && Date.now() < end) {
      const url = currentUrl(browser);
      const status = await pageStatus(browser);
      if (status === "ready") {
        try {
          const activities = await readDeposits(browser);
          // Webull's trading-password verification belongs to this page.
          retainPage(account, browser, parent, activities);
          loaded = true;
          return "loaded";
        } catch {
          if (browser.isDestroyed()) return "cancelled";
          const after = await pageStatus(browser);
          if (after === "ready") return "unavailable";
        }
      }
      if (url.origin === fundsUrl.origin && !onFundsPage(url) && !browser.webContents.isLoadingMainFrame()) {
        await loadFundsPage(browser);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return "cancelled";
  } catch {
    return browser.isDestroyed() ? "cancelled" : "unavailable";
  } finally {
    if (!loaded && !browser.isDestroyed()) browser.destroy();
  }
}

module.exports = { connectWebullFunds, fetchWebullFunds };
