const { app, BrowserWindow, ipcMain, dialog, safeStorage, Menu } = require("electron");
const path = require("node:path"),
  fs = require("node:fs"),
  { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const {
  createBook,
  copyBook,
  knownSources,
  inspectSource,
  migrate,
  createAccount,
  ALLOCATION,
  BROKER,
  preference,
  putPref,
  savePrice,
  day,
  currency,
  money,
  account,
  resolveAsset,
  transaction,
  json,
} = require("./ledger.js");
const { dashboard, storageContext, loadBook } = require("./flows.js");
const {
  batch,
  combinedBatch,
  parseWebullCsv,
  detailedIbkr,
  compareStatement,
  addManual,
  amendEvent,
  brokerReport,
  connectWebull,
  resetSync,
  refreshFund,
  network,
} = require("./services.js");
const { seedDemo, demoCsv, demoXml } = require("./demo.js");
const { EtfCache } = require("../src/storage/etfCache.ts");
const { parseManualCsv, snapshotToCsv } = require("../src/domain/etf.ts");
const { saveAddonSettings } = require("../src/storage/settings.ts");
const { saveRebalanceSettings } = require("../src/storage/rebalance.ts");
const { FxService } = require("../src/services/fx/fxService.ts");
app.setName("Stack Portfolio");
if (process.env.STACK_PORTFOLIO_TEST_DIR) app.setPath("userData", process.env.STACK_PORTFOLIO_TEST_DIR);
else app.setPath("userData", path.join(app.getPath("appData"), "Stack Portfolio"));
let db,
  mode,
  win,
  stagedSource,
  previews = new Map(),
  lastFxCheck = 0;
const fundChecks = new Map();
const dataDir = () => app.getPath("userData"),
  fileFor = (m) => path.join(dataDir(), m === "demo" ? "sample.sqlite" : "portfolio.sqlite");
const originalDir = () =>
  process.env.STACK_PORTFOLIO_TEST_SOURCE || path.join(app.getPath("appData"), "com.teymz.wealthfolio");
const preferenceFile = () => path.join(dataDir(), "workspace.json");
function writeFileAtomic(file, data) {
  const part = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(part, data, { mode: 0o600 });
    fs.renameSync(part, file);
  } finally {
    if (fs.existsSync(part)) fs.unlinkSync(part);
  }
}
function lastMode() {
  try {
    return JSON.parse(fs.readFileSync(preferenceFile(), "utf8")).mode;
  } catch {
    return null;
  }
}
async function activate(m) {
  if (db && mode === m) return m;
  const next = createBook(fileFor(m));
  try {
    if (m === "demo") await seedDemo(next);
  } catch (e) {
    next.close();
    throw e;
  }
  db?.close();
  db = next;
  mode = m;
  previews.clear();
  fundChecks.clear();
  lastFxCheck = 0;
  writeFileAtomic(preferenceFile(), JSON.stringify({ mode }));
  return mode;
}
function requireBook() {
  if (!db) throw Error("请先选择账本。");
  return db;
}
const secretNames = new Set([
  "ibkr.flex-token",
  "webull.app-secret",
  "webull.access-token",
  "twelvedata.apiKey",
  "alphaVantage.apiKey",
]);
const secrets = {
  async get(key) {
    if (!secretNames.has(key)) throw Error("未知连接。");
    const v = preference(db, "credentials", key);
    if (!v) return null;
    try {
      return safeStorage.decryptString(Buffer.from(v, "base64"));
    } catch {
      throw Error("当前 Windows 账户无法解锁此授权，请重新连接。");
    }
  },
  async set(key, value) {
    if (!secretNames.has(key)) throw Error("未知连接。");
    if (!value) {
      putPref(db, "credentials", key, null);
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) throw Error("Windows 凭据保护暂时不可用。");
    putPref(db, "credentials", key, safeStorage.encryptString(String(value)).toString("base64"));
  },
};
async function pick(filters, save = false, defaultPath) {
  const outcome = save
    ? await dialog.showSaveDialog(win, { filters, defaultPath })
    : await dialog.showOpenDialog(win, { filters, properties: ["openFile"] });
  return outcome.canceled ? null : save ? outcome.filePath : outcome.filePaths[0];
}
function sourcePreview(file) {
  if (!file) return null;
  const counts = inspectSource(file);
  stagedSource = { file, token: randomUUID() };
  return { counts, token: stagedSource.token, name: path.basename(file) };
}
const nativeBackup = [{ name: "Stack Portfolio 账本", extensions: ["sqlite"] }];
const handlers = {
  async home() {
    if (!mode && ["real", "demo"].includes(lastMode()) && fs.existsSync(fileFor(lastMode())))
      await activate(lastMode());
    return {
      mode: mode || null,
      hasReal: fs.existsSync(fileFor("real")),
      sources: knownSources(originalDir()).map((p, i) => ({ id: i, label: path.relative(originalDir(), p) })),
    };
  },
  openDemo: () => activate("demo"),
  openReal: () => {
    if (!fs.existsSync(fileFor("real"))) throw Error("尚未建立正式账本。");
    return activate("real");
  },
  newBook: () => {
    if (fs.existsSync(fileFor("real"))) throw Error("正式账本已经存在。");
    return activate("real");
  },
  async migrationPreview({ source }) {
    const file = Number.isInteger(source)
      ? knownSources(originalDir())[source]
      : await pick([{ name: "Wealthfolio 未加密 SQLite", extensions: ["db", "sqlite", "sqlite3"] }]);
    return sourcePreview(file);
  },
  async migrationCommit({ token }) {
    if (!stagedSource || token !== stagedSource.token) throw Error("请重新预览迁移。");
    const summary = migrate(stagedSource.file, fileFor("real"));
    stagedSource = null;
    await activate("real");
    return summary;
  },
  dashboard: (args) => dashboard(requireBook(), args),
  account: (args) => createAccount(requireBook(), args.name, args.currency),
  history({ account: id, limit = 200, offset = 0, text = "" }) {
    const rows = requireBook()
      .prepare(
        "SELECT data FROM sp_events WHERE (?='' OR account=?) AND (?='' OR instr(lower(data),lower(?))>0) ORDER BY day DESC,id LIMIT ? OFFSET ?",
      )
      .all(
        id || "",
        id || "",
        text,
        text,
        Math.min(500, Math.max(1, Number(limit) || 200)),
        Math.max(0, Number(offset) || 0),
      );
    return rows.map((r) => json(r.data, {}));
  },
  manual: (args) => addManual(requireBook(), args),
  amend: (args) => amendEvent(requireBook(), args),
  corrections: (args) =>
    requireBook()
      .prepare("SELECT created,reason FROM sp_corrections WHERE event=? ORDER BY created DESC")
      .all(args.id),
  async preview(args) {
    if (args.broker === "both") {
      requireBook();
      const parts = [];
      for (const broker of ["ibkr", "webull"]) {
        const a = account(db, args.mapping?.[broker]);
        if (!a.active || a.mode !== "TRANSACTIONS") throw Error("请选择启用的交易账户。");
        if (parts.some((p) => p.account === a.id)) throw Error("请为两家券商分别指定对应的本地账户。");
        let report, source;
        if (args.source === "live" && mode === "real") {
          report = await brokerReport(db, broker, secrets);
          source = broker.toUpperCase() + " 在线同步";
        } else if (args.source === "sample" && mode === "demo") {
          report = broker === "ibkr" ? detailedIbkr(demoXml) : parseWebullCsv(demoCsv);
          source = broker === "ibkr" ? "示例 IBKR.xml" : "示例 Webull.csv";
        } else throw Error("批量预览需要两家券商连接，或使用示例账本。");
        parts.push({ account: a.id, broker, report, source });
      }
      const summary = await combinedBatch(db, parts),
        token = randomUUID();
      previews.clear();
      previews.set(token, { parts });
      return { ...summary, token };
    }
    requireBook();
    const broker = args.broker === "ibkr" ? "ibkr" : "webull",
      a = account(db, args.account);
    if (!a.active || a.mode !== "TRANSACTIONS") throw Error("请选择启用的交易账户。");
    let report, source;
    if (args.source === "live") {
      if (mode === "demo") throw Error("请在正式账本中连接券商。");
      report = await brokerReport(db, broker, secrets);
      source = broker.toUpperCase() + " 在线同步";
    } else {
      let text;
      if (args.source === "sample") {
        if (mode !== "demo") throw Error("示例文件只可导入示例账本。");
        source = broker === "ibkr" ? "示例 IBKR.xml" : "示例 Webull.csv";
        text = broker === "ibkr" ? demoXml : demoCsv;
      } else {
        const file = await pick([
          {
            name: broker === "ibkr" ? "IBKR Activity Flex XML" : "Webull 成交 CSV",
            extensions: [broker === "ibkr" ? "xml" : "csv"],
          },
        ]);
        if (!file) return null;
        if (fs.statSync(file).size > 48 * 1024 * 1024) throw Error("文件超过 48 MB，请按日期拆分券商导出。");
        source = path.basename(file);
        text = fs.readFileSync(file, "utf8");
      }
      report = broker === "ibkr" ? detailedIbkr(text) : parseWebullCsv(text);
    }
    const summary = await batch(db, a.id, broker, report, source),
      token = randomUUID();
    previews.clear();
    previews.set(token, { account: a.id, broker, report, source });
    return { ...summary, token };
  },
  async commit({ token }) {
    const p = previews.get(token);
    if (!p) throw Error("预览已过期，请重新选择文件。");
    const r = p.parts
      ? await combinedBatch(requireBook(), p.parts, true)
      : await batch(requireBook(), p.account, p.broker, p.report, p.source, true);
    previews.delete(token);
    return r;
  },
  compare: (args) => compareStatement(requireBook(), args),
  confirmStatement: (args) => compareStatement(requireBook(), args, true),
  opening(args) {
    requireBook();
    const a = account(db, args.account),
      date = day(args.date);
    if (
      db.prepare("SELECT 1 FROM sp_anchors WHERE account=? LIMIT 1").get(a.id) ||
      db.prepare("SELECT 1 FROM sp_events WHERE account=? AND day<=? LIMIT 1").get(a.id, date)
    )
      throw Error("已有期初余额或更早流水，请选择更早的起算日期或核对结单。");
    return transaction(db, () => {
      const cash = {},
        positions = {};
      for (const [c, v] of Object.entries(args.cash || {})) cash[currency(c)] = money(v);
      for (const r of args.positions || []) {
        const id = resolveAsset(
          db,
          { symbol: r.symbol, exchangeMic: r.mic, instrumentType: r.kind || "EQUITY" },
          r.currency,
        );
        if (!id) throw Error("期初持仓缺少证券代码。");
        if (id in positions) throw Error("期初持仓中证券重复。");
        positions[id] = money(r.quantity);
        if (r.price) savePrice(db, id, date, r.price, "期初结单", 30);
      }
      if (!Object.keys(cash).length && !Object.keys(positions).length)
        throw Error("请至少填写一项期初现金或持仓。");
      db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)").run(
        a.id,
        date,
        JSON.stringify(positions),
        JSON.stringify(cash),
      );
      putPref(db, "opening-date", a.id, date);
      return true;
    });
  },
  savePrice(a) {
    requireBook();
    const id = a.assetId || "FX:" + currency(a.from) + "/AUD";
    if (a.assetId && !db.prepare("SELECT 1 FROM sp_assets WHERE id=?").get(id)) throw Error("找不到证券。");
    savePrice(db, id, a.date, a.price, "手工报价", 40);
    return true;
  },
  targets: async (args) => {
    const values = Object.values(args.targets || {});
    if (
      !values.length ||
      values.some((v) => typeof v !== "number" || v < 0 || v > 1) ||
      Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.0001 ||
      !(args.tolerance >= 0.005 && args.tolerance <= 0.25)
    )
      throw Error("目标合计必须为 100%，允许偏离须为 0.5% 至 25%。");
    const settings = { schemaVersion: 1, tolerance: args.tolerance, targets: args.targets };
    if (args.scope === "instruments")
      putPref(requireBook(), ALLOCATION, "targets.instruments.v1", JSON.stringify(settings));
    else await saveRebalanceSettings(storageContext(requireBook(), ALLOCATION), settings);
    return true;
  },
  allocationSettings: async (args) => {
    await saveAddonSettings(storageContext(requireBook(), ALLOCATION), args);
    return true;
  },
  async fundCsv(a) {
    let text = a.text;
    if (a.fromFile) {
      const file = await pick([{ name: "ETF 成分 CSV", extensions: ["csv"] }]);
      if (!file) return null;
      text = fs.readFileSync(file, "utf8");
    }
    return parseManualCsv(text || "", {
      etfKey: a.key,
      provider: "manual",
      asOfDate: day(a.date),
      fetchedAt: new Date().toISOString(),
    });
  },
  async fundSave(a) {
    const cache = new EtfCache(storageContext(requireBook(), ALLOCATION));
    return cache.save({ ...a.snapshot, sourceMode: "manual" }, { expectedVersion: a.version });
  },
  fundDisable: (a) => new EtfCache(storageContext(requireBook(), ALLOCATION)).disable(a.key),
  async fundExport(a) {
    const entry = await new EtfCache(storageContext(requireBook(), ALLOCATION)).get(a.key);
    if (!entry?.snapshot) throw Error("缺少成分表。");
    const file = await pick([{ name: "ETF 成分 CSV", extensions: ["csv"] }], true, "ETF-holdings.csv");
    if (file) writeFileAtomic(file, "\uFEFF" + snapshotToCsv(entry.snapshot));
    return !!file;
  },
  fundRefresh: (a) => refreshFund(requireBook(), a.asset, secrets),
  async connections() {
    requireBook();
    const present = Object.fromEntries(
      [...secretNames].map((k) => [k, Boolean(preference(db, "credentials", k))]),
    );
    return {
      present,
      query: preference(db, BROKER, "ibkr.flex-query-id") || "",
      webullKey: preference(db, BROKER, "webull.app-key") || "",
      webullId: preference(db, BROKER, "webull.api-account-id") || "",
    };
  },
  async saveConnection(args) {
    requireBook();
    if (mode === "demo") throw Error("请在正式账本连接数据源。");
    const allowed = new Set(["ibkr.flex-query-id", "webull.app-key", "webull.api-account-id"]);
    for (const [k, v] of Object.entries(args)) {
      if (secretNames.has(k)) await secrets.set(k, v);
      else if (allowed.has(k)) putPref(db, BROKER, k, v || null);
      else throw Error("未知连接设置。");
    }
    return true;
  },
  async connectWebull() {
    requireBook();
    if (mode !== "real") throw Error("请打开正式账本。");
    const result = await connectWebull(db, secrets);
    if (
      result.accounts.length &&
      !result.accounts.some((a) => a.accountId === preference(db, BROKER, "webull.api-account-id"))
    )
      putPref(db, BROKER, "webull.api-account-id", result.accounts[0].accountId);
    return result;
  },
  resetSync: (a) => resetSync(requireBook(), a.broker, a.account),
  async autoRefresh(args) {
    if (mode !== "real" || !db) return false;
    let changed = false;
    const now = Date.now();
    if (args?.fx && now - lastFxCheck >= 300000) {
      lastFxCheck = now;
      if (preference(db, "credentials", "twelvedata.apiKey")) {
        const ctx = storageContext(db, ALLOCATION);
        ctx.api.network = network;
        ctx.api.secrets = secrets;
        ctx.api.logger = { warn() {} };
        ctx.api.exchangeRates = { getAll: async () => [] };
        const quote = await new FxService(ctx).getQuote();
        if (quote?.provider === "twelvedata" && now - Date.parse(quote.fetchedAt) < 300000) {
          savePrice(db, "FX:USD/AUD", day(quote.fetchedAt), quote.rate, "Twelve Data", 25);
          changed = true;
        }
      }
    }
    if (args?.funds) {
      for (const f of (await dashboard(db)).etfData) {
        if (
          f.snapshot?.sourceMode === "manual" ||
          f.status === "Fresh" ||
          now - (fundChecks.get(f.asset.etfKey) || 0) < 86400000
        )
          continue;
        fundChecks.set(f.asset.etfKey, now);
        try {
          await refreshFund(db, f.asset, secrets);
          changed = true;
        } catch {
          /* The existing snapshot remains available. */
        }
      }
    }
    return changed;
  },
  async refreshMarket(a) {
    requireBook();
    if (mode === "demo") throw Error("示例账本使用结单时点报价。");
    const key = await secrets.get("twelvedata.apiKey");
    if (!key) throw Error("请先在连接设置中保存 Twelve Data API Key，或手工维护报价。");
    const now = new Date().toISOString(),
      ctx = storageContext(db, ALLOCATION);
    ctx.api.network = network;
    ctx.api.secrets = secrets;
    ctx.api.exchangeRates = { getAll: async () => [] };
    ctx.api.logger = { warn() {} };
    const fx = await new FxService(ctx).getQuote({ force: true });
    if (fx && fx.provider === "twelvedata")
      savePrice(db, "FX:USD/AUD", day(fx.fetchedAt), fx.rate, "Twelve Data", 25);
    const active = new Set(
        (await dashboard(db, { ids: a?.ids })).rows.filter((r) => r.type !== "cash").map((r) => r.assetId),
      ),
      failed = [];
    let updated = 0;
    for (const id of active) {
      const asset = db.prepare("SELECT * FROM sp_assets WHERE id=?").get(id);
      try {
        const url = new URL("https://api.twelvedata.com/quote");
        url.searchParams.set("symbol", asset.symbol);
        if (asset.mic) url.searchParams.set("mic_code", asset.mic);
        url.searchParams.set("apikey", key);
        const response = await network.request({ method: "GET", url: url.toString() }),
          out = JSON.parse(response.body);
        if (
          response.status !== 200 ||
          !out.close ||
          !out.datetime ||
          out.currency?.toUpperCase() !== asset.currency
        )
          throw Error("报价缺失或币种不一致");
        savePrice(db, id, day(out.datetime), out.close, "Twelve Data", 25);
        updated++;
      } catch {
        failed.push(asset.symbol);
      }
    }
    return { updated, failed, fx: !!(fx?.provider === "twelvedata" && day(fx.fetchedAt) === day(now)) };
  },
  async backup() {
    requireBook();
    const file = await pick(
      nativeBackup,
      true,
      "Stack-Portfolio-" + new Date().toISOString().slice(0, 10) + ".sqlite",
    );
    if (!file) return null;
    if (path.resolve(file) === path.resolve(fileFor(mode))) throw Error("请选择其他位置。");
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      copyBook(fileFor(mode), temp);
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return path.basename(file);
  },
  async restore() {
    const source = await pick(nativeBackup);
    if (!source) return null;
    const check = new DatabaseSync(source, { readOnly: true });
    let destinationMode;
    try {
      if (
        check.prepare("PRAGMA quick_check").get().quick_check !== "ok" ||
        check.prepare("SELECT value FROM sp_meta WHERE key='version'").get()?.value !== "1"
      )
        throw Error("不是支持的账本备份。");
      destinationMode = preference(check, "app", "demo") === "1" ? "demo" : "real";
    } finally {
      check.close();
    }
    const target = fileFor(destinationMode);
    const title = destinationMode === "demo" ? "示例账本" : "正式账本";
    if (path.resolve(source) === path.resolve(target)) throw Error("请选择独立的备份文件。");
    const ok = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["取消", "恢复到" + title],
      defaultId: 0,
      cancelId: 0,
      message: "恢复这份" + title + "？",
      detail: "现有账本会先保存为带时间戳的本地备份。",
    });
    if (ok.response !== 1) return null;
    const temp = target + "." + randomUUID() + ".tmp";
    try {
      copyBook(source, temp);
      if (fs.existsSync(target))
        copyBook(target, path.join(dataDir(), "before-restore-" + Date.now() + ".sqlite"));
      if (db) {
        db.close();
        db = null;
        mode = null;
      }
      fs.renameSync(temp, target);
      await activate(destinationMode);
      return destinationMode;
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  },
};
let queue = Promise.resolve();
const page = pathToFileURL(path.join(__dirname, "index.html")).href;
for (const [name, fn] of Object.entries(handlers))
  ipcMain.handle("portfolio:" + name, (event, args) => {
    if (event.sender !== win?.webContents || event.senderFrame?.url !== page) throw Error("请求来源无效。");
    if (["dashboard", "history", "connections"].includes(name)) return fn(args || {});
    const run = queue.then(() => fn(args || {}));
    queue = run.catch(() => {});
    return run;
  });
function createWindow() {
  win = new BrowserWindow({
    title: "Stack Portfolio",
    width: 1420,
    height: 930,
    minWidth: 920,
    minHeight: 650,
    backgroundColor: "#f4f5ee",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== page) e.preventDefault();
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => {
    if (!process.env.STACK_PORTFOLIO_HEADLESS) win.show();
  });
  win.loadFile(path.join(__dirname, "index.html"));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    db?.close();
  });
}
