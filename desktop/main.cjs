const { app, BrowserWindow, ipcMain, dialog, safeStorage, Menu, net, screen, nativeTheme, shell } = require("electron");
const guideLinks = Object.values(require("./ui/onboarding/guide-sources.json"));
const {bindings,bindingFor,credentialsFor,savedWebullToken,saveBinding,disconnectBinding} = require("./brokerBindings");
const path = require("node:path"),
  fs = require("node:fs"),
  { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const {
  localKeyName, localKey, backupKey, isPlainDatabase, openDatabase, checkIntegrity,
  encryptedCopy, publishFile, lockForReplacement, assertNoJournal,
} = require("./bookStorage.cjs");
const {
  createBook,
  protectOldBook,
  backupMode,
  hasTable,
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
  listingMatch,
  rememberListing,
  transaction,
  json,
} = require("./ledger.js");
const { dashboard, storageContext, loadBook, positions, saveGroupedTargets } = require("./flows.js");
const { portfolioReview, reviewDay, saveReviewNote, reviewNotes } = require("./performance.js");
const { refreshBenchmarks, refreshCloses } = require("./reviewMarket.js");
const { marketFor, marketSession, marketTime, shiftDay } = require("./marketDays.js");
const { initialWindow, minimumWindowSize } = require("./windowState.js");
const { computeDisplayState, normalizeUserScale, USER_SCALE_LIMITS } = require("./adaptiveLayout.js");
const {
  batch,
  parseWebullCsv,
  detailedIbkr,
  compareStatement,
  recordAccountValue,
  addManual,
  recordHolding,
  securityHistory,
  amendEvent,
  brokerReport,
  connectWebull,
  authorizeWebull,
  resetSync,
  refreshFund,
  network,
} = require("./services.js");
const { seedDemo, demoCsv, demoXml } = require("./demo.js");
network.browserFetch = (url, init) => net.fetch(url, init);
const { EtfCache } = require("./allocation/storage/etfCache.ts");
const { parseManualCsv, snapshotToCsv } = require("./allocation/domain/etf.ts");
const { saveAllocationSettings } = require("./allocation/storage/settings.ts");
app.setName("Stock Portfolio");
if (process.env.STACK_PORTFOLIO_TEST_DIR) app.setPath("userData", process.env.STACK_PORTFOLIO_TEST_DIR);
else app.setPath("userData", path.join(app.getPath("appData"), "Stack Portfolio"));
let db,
  mode,
  setupDraft,
  win,
  stagedSource,
  selectedBackup,
  displayedReview,
  bookKey,
  previews = new Map(),
  previewRequests = new Map(),
  lastCloseCheck = 0,
  lastMarketCheck = 0;
const reviewChecks = new Map();
const fundChecks = new Map();
const closeChecks = new Map();
const dataDir = () => app.getPath("userData"),
  fileFor = (m) => path.join(dataDir(), m === "demo" ? "sample.sqlite" : "portfolio.sqlite");
const originalDir = () =>
  process.env.STACK_PORTFOLIO_TEST_SOURCE || path.join(app.getPath("appData"), "com.teymz.wealthfolio");
const preferenceFile = () => path.join(dataDir(), "workspace.json");
const localFiles = () => fs.readdirSync(dataDir(), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.sqlite$/i.test(entry.name))
  .map((entry) => path.join(dataDir(), entry.name));
const isManagedBook = (file) => /^(portfolio|sample|before-.+|(stack|stock)-portfolio-.+)\.sqlite$/i.test(path.basename(file));
function getBookKey() {
  if (!bookKey) {
    const canCreate = fs.existsSync(path.join(dataDir(), localKeyName)) ||
      !localFiles().some((f) => isManagedBook(f) && !isPlainDatabase(f));
    bookKey = localKey(dataDir(), safeStorage, canCreate);
  }
  return bookKey;
}
let checkedLocalFiles = false;
function protectLocalFiles() {
  if (checkedLocalFiles) return;
  for (const file of localFiles()) {
    if (!isPlainDatabase(file)) continue;
    if (!isManagedBook(file)) {
      const check = openDatabase(file, null, { readonly: true, existing: true });
      try {
        if (!hasTable(check, "sp_meta")) continue;
      } finally {
        check.close();
      }
    }
    try {
      protectOldBook(file, getBookKey());
    } catch (e) {
      throw Error("未能加密 " + path.basename(file) + "。" + e.message);
    }
  }
  checkedLocalFiles = true;
}
function writeFileAtomic(file, data) {
  const part = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(part, data, { mode: 0o600 });
    fs.renameSync(part, file);
  } finally {
    if (fs.existsSync(part)) fs.unlinkSync(part);
  }
}
function readPreferences() {
  try {
    const value = JSON.parse(fs.readFileSync(preferenceFile(), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
const writePreferences = (patch) =>
  writeFileAtomic(preferenceFile(), JSON.stringify({ ...readPreferences(), ...patch }));
const lastMode = () => readPreferences().mode ?? null;
const themes = ["system", "light", "dark"];
let displayState;
let syncDisplay;
function setUserScale(request) {
  const { multiplier, delta, reset } = request;
  const valid = Object.keys(request).length === 1 &&
    (Number.isFinite(multiplier) || Number.isFinite(delta) || reset === true);
  if (!valid) throw Error("请选择有效的界面缩放比例。");
  const next = normalizeUserScale(reset ? USER_SCALE_LIMITS.default : multiplier ?? displayState.userScaleMultiplier + delta);
  if (next !== displayState.userScaleMultiplier) writePreferences({ uiScaleMultiplier: next });
  return syncDisplay(next);
}
async function activate(m) {
  if (db && mode === m) return m;
  const file = fileFor(m);
  const key = getBookKey();
  if (fs.existsSync(file)) protectOldBook(file, key);
  const next = createBook(file, key);
  try {
    if (m === "demo") await seedDemo(next);
    writePreferences({ mode: m });
  } catch (e) {
    next.close();
    throw e;
  }
  db?.close();
  db = next;
  mode = m;
  setupDraft=null;
  previews.clear();
  previewRequests.clear();
  displayedReview = null;
  fundChecks.clear();
  reviewChecks.clear();
  closeChecks.clear();
  lastCloseCheck = 0;
  lastMarketCheck = 0;
  return mode;
}
function requireBook() {
  if (!db) throw Error("请先选择账本。");
  return db;
}
// Public closes, FX and index levels arrive without a key unless the investor turns this off.
const marketAutoUpdate = () => preference(db, "app", "market.autoUpdate") !== "0";
function heldListings(book, date) {
  const held = new Map();
  for (const account of book.accounts.filter((a) => a.isActive))
    for (const [id, quantity] of positions(book, account, date).holdings)
      if (!quantity.isZero() && book.assets.has(id)) held.set(id, book.assets.get(id));
  return [...held.values()];
}
// Closes of the listings held today, with the AUD rate and index levels for the same days,
// so that valuations do not rest on stale quotes.
async function updateMarket() {
  const book = loadBook(db);
  const today = marketTime(Date.now()).date;
  const held = heldListings(book, today);
  const observed = ["Webull AU", "Twelve Data"];
  const oldest = held
    .map(({ id }) => book.prices.get(id)?.findLast((q) => !observed.includes(q.source))?.day || "")
    .sort()[0];
  // Reach back to the oldest stored close, at most a quarter, to fill the days in between.
  const floor = shiftDay(today, -92);
  const range = { from: oldest > floor ? oldest : floor, to: today };
  const [indices, closes] = await Promise.all([
    refreshBenchmarks(db, range, network.request),
    refreshCloses(db, held, range, network.request),
  ]);
  const results = [...indices, ...closes];
  if (results.some((r) => r.count)) putPref(db, "app", "market.updated", new Date().toISOString());
  return results;
}
async function refreshDueCloses(book, assets, now) {
  const results = [];
  for (const market of ["ASX", "US"]) {
    const session = marketSession(now, market);
    if (market === "ASX" && session.completed === session.date && session.minute < session.officialAfter + 20) continue;
    const date = session.completed;
    const key = market + date;
    if (now - (closeChecks.get(key) || 0) < 120_000) continue;
    const missing = assets.filter((asset) => marketFor(asset) === market &&
      !book.prices.get(asset.id)?.some((q) => q.day === date && !["Webull AU", "Twelve Data"].includes(q.source)));
    if (!missing.length) continue;
    closeChecks.set(key, now);
    results.push(...await refreshCloses(db, missing, { from: date, to: date }, network.request));
  }
  if (results.some((result) => result.added)) putPref(db, "app", "market.updated", new Date(now).toISOString());
  return results;
}
const secretNames = new Set([
  "ibkr.flex-token",
  "webull.app-secret",
  "webull.access-token",
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
  set(key, value) {
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
const portableBackup = [{ name: "密码加密的账本备份", extensions: ["spbackup"] }];
function expireAccountPreviews(id) {
  for (const broker of ["ibkr","webull"]) previewRequests.delete(JSON.stringify([broker,id]));
  for (const [key,preview] of previews) if (preview.account === id) previews.delete(key);
}
function draftFor(ticket) {
  if(!setupDraft || setupDraft.ticket!==ticket || Date.now()>setupDraft.expires) throw Error("验证已过期，请返回凭据步骤重新连接。");
  return setupDraft;
}
function allowSetup(){
  if(mode==="demo" || (!db && fs.existsSync(fileFor("real")))) throw Error("请先打开正式账本。");
}
async function verifyDraft(draft) {
  if(draft.broker==="ibkr"){
    const report=await brokerReport(db,"ibkr",secrets,draft.credentials);
    if(!report.brokerAccountId) throw Error("报表没有可核对的账户编号。请在 Activity Flex Query 加入 Account Information 后重试。");
    draft.accounts=[{accountId:report.brokerAccountId,accountNumber:report.brokerAccountId}];
  }else{
    const result=await authorizeWebull(draft.credentials,value=>{draft.credentials.accessToken=value;});
    draft.accounts=result.accounts;
    if(result.status==="已连接" && !draft.accounts.length) throw Error("授权成功，但券商没有返回可绑定的账户。请核对 OpenAPI 权限。");
  }
  return {ticket:draft.ticket,accounts:draft.accounts};
}
const nativeBackup = [{ name: "投资账本备份", extensions: ["spbackup", "sqlite", "db"] }];
const handlers = {
  displayState: () => syncDisplay(),
  setUserScale,
  async home() {
    let storageError;
    try {
      protectLocalFiles();
      if (!mode && ["real", "demo"].includes(lastMode()) && fs.existsSync(fileFor(lastMode())))
        await activate(lastMode());
    } catch (e) {
      storageError = e.message;
    }
    return {
      storageError,
      mode: mode || null,
      theme: nativeTheme.themeSource,
      hasReal: fs.existsSync(fileFor("real")),
      onboardingSeen: Boolean(readPreferences().onboardingSeen),
      sources: knownSources(originalDir()).map((p, i) => ({ id: i, label: path.relative(originalDir(), p) })),
    };
  },
  async beginAccountSetup({broker,queryId,token,appKey,appSecret}) {
    allowSetup();
    if(!["ibkr","webull"].includes(broker)) throw Error("未知券商。");
    const credentials=broker==="ibkr"?{queryId,token}:{appKey,appSecret};
    if(Object.values(credentials).some(v=>typeof v!=="string" || !v.trim() || v.length>4096)) throw Error("请填写完整的券商凭据。");
    if (broker === "webull" && db) credentials.accessToken = savedWebullToken(db, safeStorage, credentials);
    setupDraft={broker,credentials,accounts:[],ticket:randomUUID(),expires:Date.now()+20*60_000};
    return verifyDraft(setupDraft);
  },
  async checkAccountSetup({ticket}) { allowSetup();return verifyDraft(draftFor(ticket)); },
  async bindAccount({ticket,...args}) {
    allowSetup();
    const draft=draftFor(ticket);
    if(!draft.accounts.some(a=>a.accountId===args.remoteId)) throw Error("请先验证要绑定的账户。");
    if(!db){await activate("real");setupDraft=draft;}
    const result=saveBinding(db,safeStorage,draft,args);
    expireAccountPreviews(result.id);
    setupDraft=null;
    writePreferences({onboardingSeen:true});
    return result;
  },
  leaveAccountSetup() {setupDraft=null;writePreferences({onboardingSeen:true});},
  disconnectAccount({id}) {
    if(mode!=="real") throw Error("请打开正式账本。");
    disconnectBinding(requireBook(),id);
    expireAccountPreviews(id);
  },
  setTheme({ theme }) {
    if (!themes.includes(theme)) throw Error("请选择有效的主题。");
    writePreferences({ theme });
    nativeTheme.themeSource = theme;
    return theme;
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
    const summary = migrate(stagedSource.file, fileFor("real"), getBookKey());
    stagedSource = null;
    await activate("real");
    return summary;
  },
  dashboard(args) {
    return dashboard(requireBook(), { ...args, current: mode === "real", now: Date.now() });
  },
  portfolioReview(args) {
    const result = portfolioReview(requireBook(), args);
    const token = randomUUID();
    // Save the exact values shown even if a quote or ledger entry changes before the note is written.
    const { ids, from, to, base, requested, series, metrics, missingAssets } = result;
    displayedReview = { token, ids, from, to, base, requested, series, metrics, missingAssets };
    return {
      ...result,
      token,
      notes: reviewNotes(db),
      autoUpdate: mode === "real" && marketAutoUpdate(),
    };
  },
  reviewDay: (args) => reviewDay(requireBook(), args),
  saveReviewNote({ token, text, id }) {
    if (!displayedReview || token !== displayedReview.token) throw Error("复盘区间已改变，请重新打开当前区间。");
    return saveReviewNote(requireBook(), displayedReview, text, id);
  },
  // Index levels, the AUD rate and the closes of held listings for the displayed period.
  // An automatic update repeats for the same period only after a pause.
  async refreshReview({ token, auto }) {
    if (mode !== "real" || !displayedReview || token !== displayedReview.token)
      throw Error("请在正式账本打开需要更新的复盘区间。");
    const review = displayedReview,
      range = { from: review.base, to: review.to };
    const find = db.prepare("SELECT * FROM sp_assets WHERE id=?");
    const assets = review.missingAssets.map((id) => find.get(id)).filter(Boolean);
    const key = review.ids.join() + range.from + range.to;
    if (auto && (!marketAutoUpdate() || Date.now() - (reviewChecks.get(key) || 0) < 900000)) return null;
    reviewChecks.set(key, Date.now());
    const [indices, closes] = await Promise.all([
      refreshBenchmarks(requireBook(), range, network.request),
      refreshCloses(requireBook(), assets, range, network.request),
    ]);
    return [...indices, ...closes];
  },
  async updateMarket() {
    requireBook();
    if (mode !== "real") throw Error("示例账本使用随附的模拟行情。");
    lastMarketCheck = Date.now();
    return updateMarket();
  },
  marketSettings(args) {
    requireBook();
    if (typeof args?.autoUpdate === "boolean") putPref(db, "app", "market.autoUpdate", args.autoUpdate ? "1" : "0");
    return {
      autoUpdate: marketAutoUpdate(), last: preference(db, "app", "market.updated"),
    };
  },
  account: (args) => createAccount(requireBook(), args.name, args.currency),
  history({ account: id, limit = 200, offset = 0, text = "", accountIds, assetIds, through }) {
    const book = requireBook();
    const pageSize = Math.min(500, Math.max(1, Math.trunc(Number(limit)) || 200));
    if (assetIds) return securityHistory(book, { accountIds, assetIds, through, limit: pageSize });
    const rows = book
      .prepare(
        "SELECT data FROM sp_events WHERE (?='' OR account=?) AND (?='' OR instr(lower(data),lower(?))>0) ORDER BY day DESC,id LIMIT ? OFFSET ?",
      )
      .all(
        id || "",
        id || "",
        text,
        text,
        pageSize,
        Math.max(0, Number(offset) || 0),
      );
    return rows.map((r) => json(r.data, {}));
  },
  manual: (args) => addManual(requireBook(), args),
  recordHolding: (args) => recordHolding(requireBook(), args),
  rememberListing: (args) => rememberListing(requireBook(), args),
  amend: (args) => amendEvent(requireBook(), args),
  corrections: (args) =>
    requireBook()
      .prepare("SELECT created,reason FROM sp_corrections WHERE event=? ORDER BY created DESC")
      .all(args.id),
  async preview(args) {
    const book = requireBook();
    if (args.token) {
      const p = previews.get(args.token);
      if (!p) throw Error("预览已过期，请重新读取。");
      return { ...await batch(book, p.account, p.broker, p.report, p.source), token: args.token };
    }
    if (args.broker === "both") {
      if (args.mapping?.ibkr && args.mapping.ibkr === args.mapping.webull)
        throw Error("请给两家券商选择不同的入账账户。");
      const reports = await Promise.all(["ibkr", "webull"].map(async (broker) => {
        const id = args.mapping?.[broker];
        try {
          if (!id) throw Error("请选择这家券商的入账账户。");
          return await handlers.preview({ broker, source: args.source, account: id });
        } catch (err) {
          return { broker, account: id, error: err.message };
        }
      }));
      return { broker: "both", reports };
    }
    const broker = args.broker === "ibkr" ? "ibkr" : "webull",
      a = account(db, args.account);
    if (!a.active || a.mode !== "TRANSACTIONS") throw Error("请选择启用的交易账户。");
    const requestKey = JSON.stringify([broker, a.id]);
    const request = randomUUID();
    previewRequests.set(requestKey, request);
    let report, source;
    const binding=bindingFor(book,a.id);
    if(binding && binding.broker!==broker) throw Error("入账账户与券商不匹配，请重新选择。");
    if (args.source === "live") {
      if (mode === "demo") throw Error("请在正式账本中连接券商。");
      try {
        report = await brokerReport(book, broker, secrets,binding ? credentialsFor(book,a.id,safeStorage) : null);
      } catch (error) {
        if (db === book && !binding) putPref(book, BROKER, "verified." + broker, null);
        throw error;
      }
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
    if(binding && broker==="ibkr" && report.brokerAccountId!==binding.remoteId) throw Error("报表中的券商账户与当前绑定不符，请检查报表和入账账户。");
    if (db !== book) throw Error("账本已切换，请重新同步。");
    if (!binding && broker === "ibkr" && report.brokerAccountId && bindings(book).some(b => b.broker === broker && b.remoteId === report.brokerAccountId))
      throw Error("这份报表已绑定到其他本地账户，请选择对应的入账账户。");
    const summary = await batch(book, a.id, broker, report, source),
      token = randomUUID();
    if (db !== book) throw Error("账本已切换，请重新同步。");
    if (previewRequests.get(requestKey) !== request) throw Error("已重新读取该券商记录。");
    for (const [old, preview] of previews) if (preview.broker === broker && preview.account === a.id) previews.delete(old);
    putPref(db, BROKER, "local-account." + broker, a.id);
    if (args.source === "live" && !binding) {
      putPref(db, BROKER, "last-success." + broker, new Date().toISOString());
      putPref(db, BROKER, "verified." + broker, "1");
    }
    previews.set(token, { account: a.id, broker, report, source });
    return { ...summary, token };
  },
  async commit({ token }) {
    const p = previews.get(token);
    if (!p) throw Error("预览已过期，请重新选择文件。");
    const result = await batch(requireBook(), p.account, p.broker, p.report, p.source, true);
    previews.delete(token);
    return result;
  },
  compare: (args) => compareStatement(requireBook(), args),
  recordAccountValue: (args) => recordAccountValue(requireBook(), args),
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
        const picked = r.assetId && listingMatch(db, {account: a.id, symbol:r.symbol, currency:r.currency, mic:r.mic}).candidates.find((c) => c.id === r.assetId);
        if (r.assetId && !picked) throw Error("所选证券与上市市场或币种不符。");
        const id = picked?.id || resolveAsset(
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
  targets: (args) => saveGroupedTargets(requireBook(), args),
  allocationSettings: async (args) => {
    await saveAllocationSettings(storageContext(requireBook(), ALLOCATION), args);
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
    if (file) {
      if (path.extname(file).toLowerCase() !== ".csv") throw Error("请选择扩展名为 .csv 的文件。");
      writeFileAtomic(file, "\uFEFF" + snapshotToCsv(entry.snapshot));
    }
    return !!file;
  },
  fundRefresh: (a) => refreshFund(requireBook(), a.asset),
  async connections() {
    requireBook();
    const present = Object.fromEntries(
      [...secretNames].map((k) => [k, Boolean(preference(db, "credentials", k))]),
    );
    return {
      present,
      bindings: bindings(db),
      lastSuccess: Object.fromEntries(["ibkr", "webull"].map((id) => [id, preference(db, BROKER, "last-success." + id)])),
      verified: Object.fromEntries(["ibkr", "webull"].map((id) => [id, preference(db, BROKER, "verified." + id) === "1"])),
      query: preference(db, BROKER, "ibkr.flex-query-id") || "",
      webullKey: preference(db, BROKER, "webull.app-key") || "",
      webullId: preference(db, BROKER, "webull.api-account-id") || "",
    };
  },
  async saveConnection(args) {
    requireBook();
    if (mode === "demo") throw Error("请在正式账本连接数据源。");
    const allowed = new Set(["ibkr.flex-query-id", "webull.app-key", "webull.api-account-id"]);
    transaction(db, () => {
      for (const [k, v] of Object.entries(args)) {
        if (/^(ibkr|webull)\./.test(k)) putPref(db, BROKER, "verified." + k.split(".")[0], null);
        if (secretNames.has(k)) secrets.set(k, v);
        else if (allowed.has(k)) putPref(db, BROKER, k, v || null);
        else throw Error("未知连接设置。");
      }
    });
    return true;
  },
  async connectWebull() {
    requireBook();
    if (mode !== "real") throw Error("请打开正式账本。");
    const result = await connectWebull(db, secrets);
    if (result.accounts.length && !result.accounts.some((a) => a.accountId === preference(db, BROKER, "webull.api-account-id")))
      putPref(db, BROKER, "webull.api-account-id", result.accounts.length === 1 ? result.accounts[0].accountId : null);
    return result;
  },
  resetSync: (a) => resetSync(requireBook(), a.broker, a.account),
  async autoRefresh(args) {
    if (mode !== "real" || !db) return false;
    let changed = false;
    const now = Date.now();
    if (args?.market && marketAutoUpdate()) {
      if (now - lastCloseCheck >= 18_000) {
        const previous = lastCloseCheck;
        lastCloseCheck = now;
        const book = loadBook(db);
        const assets = heldListings(book, marketTime(now).date);
        const closes = await refreshDueCloses(book, assets, now);
        changed = closes.some((r) => r.added) || Math.floor(previous / 60_000) !== Math.floor(now / 60_000);
      }
      if (now - lastMarketCheck >= 1800000) {
        lastMarketCheck = now;
        if ((await updateMarket()).some((r) => r.added ?? r.count)) changed = true;
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
          await refreshFund(db, f.asset);
          changed = true;
        } catch {
          /* The existing snapshot remains available. */
        }
      }
    }
    return changed;
  },
  async backup({ password, convertLegacy = false }) {
    const key = backupKey(password);
    let external;
    try {
      let source;
      if (convertLegacy) {
        const old = await pick([{ name: "旧版或本机加密的账本备份", extensions: ["sqlite", "db"] }]);
        if (!old) return null;
        external = openDatabase(old, isPlainDatabase(old) ? null : getBookKey(), { readonly: true, existing: true });
        backupMode(external);
        source = external;
      } else source = requireBook();
      const file = await pick(portableBackup, true, "Stock-Portfolio-" + new Date().toISOString().slice(0, 10) + ".spbackup");
      if (!file) return null;
      if (path.extname(file).toLowerCase() !== ".spbackup") throw Error("请选择扩展名为 .spbackup 的备份文件。");
      publishFile(file, (temp) => encryptedCopy(source, temp, key));
      return path.basename(file);
    } finally {
      key.fill(0);
      external?.close();
    }
  },
  async selectBackup() {
    selectedBackup = null;
    const file = await pick(nativeBackup);
    if (!file) return null;
    const resolved = fs.realpathSync.native(file).toLowerCase();
    if (["real", "demo"].some((m) => fs.existsSync(fileFor(m)) && fs.realpathSync.native(fileFor(m)).toLowerCase() === resolved))
      throw Error("请选择独立的备份文件。");
    let kind = "plain";
    if (!isPlainDatabase(file)) {
      kind = "password";
      if (fs.existsSync(path.join(dataDir(), localKeyName))) {
        try {
          openDatabase(file, getBookKey(), { readonly: true, existing: true }).close();
          kind = "local";
        } catch { /* A portable backup uses its own password. */ }
      }
    }
    selectedBackup = { file, kind, token: randomUUID() };
    return { token: selectedBackup.token, name: path.basename(file), needsPassword: kind === "password" };
  },
  async restore({ token, password }) {
    if (!selectedBackup || token !== selectedBackup.token) throw Error("请重新选择备份。");
    const { file, kind } = selectedBackup;
    const passwordKey = kind === "password" ? backupKey(password) : null;
    const sourceKey = kind === "local" ? getBookKey() : passwordKey;
    let source, replaced, rollback;
    const previousMode = mode;
    try {
      source = openDatabase(file, sourceKey, { readonly: true, existing: true });
      const nextMode = backupMode(source);
      checkIntegrity(source);
      const target = fileFor(nextMode);
      const title = nextMode === "demo" ? "示例账本" : "正式账本";
      const ok = await dialog.showMessageBox(win, {
        type: "question", buttons: ["取消", "恢复到" + title], defaultId: 0, cancelId: 0,
        message: "恢复这份" + title + "？",
        detail: "现有账本会先保存为本机加密备份。跨 Windows 账户恢复后，请重新授权券商连接。",
      });
      if (ok.response !== 1) return null;
      const key = getBookKey();
      publishFile(target, (stage) => {
        encryptedCopy(source, stage, key);
        const next = createBook(stage, key);
        try {
          if (backupMode(next) !== nextMode) throw Error("备份在恢复期间发生了变化，请重试。");
          loadBook(next);
          // Keep working tokens on this computer. On a different Windows profile
          // the backup retains the original ciphertext and the restored book can reconnect.
          for (const name of secretNames) {
            const value = preference(next, "credentials", name);
            if (!value) continue;
            try { safeStorage.decryptString(Buffer.from(value, "base64")); }
            catch { putPref(next, "credentials", name, null); }
          }
          for (const binding of bindings(next).filter(b => b.authorized)) {
            try { credentialsFor(next, binding.id, safeStorage); }
            catch { disconnectBinding(next, binding.id); }
          }
        } finally {
          next.close();
        }
        if (mode === nextMode) {
          db.close();
          db = null;
          mode = null;
        }
        if (fs.existsSync(target)) {
          const old = openDatabase(target, isPlainDatabase(target) ? null : key, { existing: true });
          try {
            lockForReplacement(old);
            rollback = path.join(dataDir(), "before-restore-" + Date.now() + "-" + randomUUID() + ".sqlite");
            publishFile(rollback, (temp) => encryptedCopy(old, temp, key));
          } finally {
            old.close();
          }
        }
        assertNoJournal(target);
      });
      replaced = target;
      selectedBackup = null;
      return await activate(nextMode);
    } catch (e) {
      if (replaced && rollback)
        publishFile(replaced, (stage) => fs.copyFileSync(rollback, stage, fs.constants.COPYFILE_EXCL));
      if (!db && previousMode) await activate(previousMode);
      throw e;
    } finally {
      source?.close();
      passwordKey?.fill(0);
    }
  },
};
let queue = Promise.resolve();
const readers = new Set();
let switchingBooks = false;
const page = pathToFileURL(path.join(__dirname, "index.html")).href;
for (const [name, fn] of Object.entries(handlers))
  ipcMain.handle("portfolio:" + name, (event, args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame?.url !== page) throw Error("请求来源无效。");
    // Display actions are synchronous and independent of ledger operations.
    if (name === "displayState" || name === "setUserScale") return fn(args ?? {});
    if (!switchingBooks && ["dashboard", "history", "connections", "preview"].includes(name)) {
      const read = Promise.resolve().then(() => fn(args || {}));
      readers.add(read);
      return read.finally(() => readers.delete(read));
    }
    const run = queue.then(async () => {
      const switchBook = ["openDemo", "openReal", "newBook", "migrationCommit", "restore"].includes(name) ||
        (name === "home" && !mode);
      if (!switchBook) return fn(args || {});
      switchingBooks = true;
      try {
        await Promise.allSettled(readers);
        return await fn(args || {});
      } finally {
        switchingBooks = false;
      }
    });
    queue = run.catch(() => {});
    return run;
  });
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#0E1410" : "#ECF1EA");
function createWindow() {
  const headless = !!process.env.STACK_PORTFOLIO_HEADLESS;
  const { bounds, maximized } = initialWindow(
    headless ? null : readPreferences().window,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay(),
  );
  let minimum = minimumWindowSize(screen.getDisplayMatching(bounds).workArea);
  win = new BrowserWindow({
    title: "Stock Portfolio",
    ...bounds,
    minWidth: minimum.width,
    minHeight: minimum.height,
    backgroundColor: windowBackground(),
    show: false,
    webPreferences: {
      ...(process.env.STACK_PORTFOLIO_HEADLESS ? {offscreen:true, backgroundThrottling:false} : {}),
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contents = win.webContents;
  contents.setZoomMode("isolated");
  contents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  let resizeTimer;
  syncDisplay = (multiplier = displayState?.userScaleMultiplier ?? readPreferences().uiScaleMultiplier) => {
    const [dipWidth, dipHeight] = win.getContentSize();
    const prev = displayState;
    displayState = computeDisplayState({ dipWidth, dipHeight, currentAspect: prev?.aspect, userScaleMultiplier: multiplier });
    if (Math.abs(contents.getZoomFactor() - displayState.zoomFactor) >= 0.005)
      contents.setZoomFactor(displayState.zoomFactor);
    if (contents.getURL() === page && (prev?.aspect !== displayState.aspect ||
        prev?.zoomFactor !== displayState.zoomFactor || prev?.userScaleMultiplier !== displayState.userScaleMultiplier))
      contents.send("portfolio:displayState", displayState);
    return displayState;
  };
  const scheduleDisplay = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = minimumWindowSize(screen.getDisplayMatching(win.getBounds()).workArea);
      if (next.width !== minimum.width || next.height !== minimum.height) {
        minimum = next;
        win.setMinimumSize(minimum.width, minimum.height);
      }
      syncDisplay();
    }, 50);
  };
  for (const name of ["resize", "move", "moved", "maximize", "unmaximize"]) win.on(name, scheduleDisplay);
  screen.on("display-metrics-changed", scheduleDisplay);
  win.once("closed", () => {
    clearTimeout(resizeTimer);
    screen.removeListener("display-metrics-changed", scheduleDisplay);
    win = null;
  });
  contents.on("did-finish-load", () => syncDisplay());
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
    const key = input.key;
    if (key !== "0" && key !== "=" && key !== "+" && key !== "-") return;
    event.preventDefault();
    try {
      setUserScale(key === "0" ? { reset: true } : { delta: key === "-" ? -USER_SCALE_LIMITS.step : USER_SCALE_LIMITS.step });
    } catch (error) {
      console.error("Unable to save interface zoom:", error.message);
    }
  });
  contents.setWindowOpenHandler(({url}) => {
    if(guideLinks.includes(url)) void shell.openExternal(url).catch(()=>{});
    return {action:"deny"};
  });
  contents.on("will-navigate", (e, url) => {
    if (url !== page) e.preventDefault();
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => {
    if (!headless && maximized) win.maximize();
    syncDisplay();
    if (!headless) win.show();
  });
  if (!headless)
    win.on("close", () => {
      try {
        writePreferences({ window: { bounds: win.getNormalBounds(), maximized: win.isMaximized() } });
      } catch {}
    });
  syncDisplay();
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
  nativeTheme.on("updated", () => {
    if (win && !win.isDestroyed()) win.setBackgroundColor(windowBackground());
  });
  app.whenReady().then(() => {
    const { theme } = readPreferences();
    nativeTheme.themeSource = themes.includes(theme) ? theme : "system";
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    db?.close();
    bookKey?.fill(0);
  });
}
