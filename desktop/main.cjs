const { app, BrowserWindow, ipcMain, dialog, safeStorage, Menu, net, screen, nativeTheme, shell } = require("electron");
const { connectWebullFunds: openFundsLogin, fetchWebullFunds } = require("./webullFundsWindow.cjs");
const guideLinks = Object.values(require("./ui/onboarding/guide-sources.json"));
const {bindings,bindingFor,credentialsFor,savedWebullToken,saveBinding,disconnectBinding} = require("./brokerBindings");
const path = require("node:path"),
  fs = require("node:fs"),
  { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { requestFactoryReset, finishFactoryReset } = require("./factoryReset.cjs");
const { createDiagnostics } = require("./diagnostics.cjs");
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
  CUSTOM_ACCOUNT,
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
const { createMacroMarket } = require("./macroMarket.js");
const { macroSources } = require("./macroSources.js");
const { initialWindow, minimumWindowSize } = require("./windowState.js");
const { computeDisplayState, normalizeUserScale, USER_SCALE_LIMITS } = require("./adaptiveLayout.js");
const {
  batch,
  parseWebullCsv,
  detailedIbkr,
  compareStatement,
  createCustomAccount,
  customAccount,
  customCsvHeader,
  importCustomCsv,
  transferMembers,
  recordAccountValue,
  addManual,
  recordHolding,
  securityHistory,
  amendEvent,
  deleteActivity,
  brokerReport,
  connectWebull,
  authorizeWebull,
  resetSync,
  refreshFund,
  network,
} = require("./services.js");
const { seedDemo, demoCsv, demoXml } = require("./demo.js");
const {
  LANGUAGE_PREFERENCES,
  normalizeLanguagePreference,
  resolveLocale,
  resolveSystemLocale,
  setActiveLocale,
  tMain,
} = require("./i18n/index.js");
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
  customPreviews = new Map(),
  lastCloseCheck = 0,
  lastMarketCheck = 0;
let factoryResetRequested = false;
let diagnostics;
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
      throw Error(tMain("err.encryptFailed", { file: path.basename(file), message: e.message }));
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
const macroCacheFile = () => path.join(dataDir(), "macro-market.json");
const macroMarket = createMacroMarket({
  providers: macroSources((url, options) => net.fetch(url, options)),
  readCache: () => fs.readFileSync(macroCacheFile(), "utf8"),
  writeCache: (data) => writeFileAtomic(macroCacheFile(), data),
  onDegraded: (reason) => diagnostics?.note(reason),
});
function readPreferences() {
  try {
    const value = JSON.parse(fs.readFileSync(preferenceFile(), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
function writePreferences(patch) {
  diagnostics?.stage("preferences");
  writeFileAtomic(preferenceFile(), JSON.stringify({ ...readPreferences(), ...patch }));
}
const lastMode = () => readPreferences().mode ?? null;
const themes = ["system", "light", "dark"];
function currentSystemLanguages() {
  if (process.env.STACK_PORTFOLIO_LOCALE) return [process.env.STACK_PORTFOLIO_LOCALE];
  const preferred = typeof app.getPreferredSystemLanguages === "function" ? app.getPreferredSystemLanguages() : [];
  const fallback = typeof app.getLocale === "function" ? app.getLocale() : "";
  return [...preferred, fallback].filter(Boolean);
}
function syncLanguage(pref = readPreferences().language) {
  const languagePreference = normalizeLanguagePreference(pref);
  const systemLocale = resolveSystemLocale(currentSystemLanguages());
  const locale = resolveLocale(languagePreference, currentSystemLanguages());
  setActiveLocale(locale);
  return { languagePreference, locale, systemLocale };
}
let displayState;
let syncDisplay;
function setUserScale(request) {
  const { multiplier, delta, reset } = request;
  const valid = Object.keys(request).length === 1 &&
    (Number.isFinite(multiplier) || Number.isFinite(delta) || reset === true);
  if (!valid) throw Error(tMain("err.invalidScale"));
  const next = normalizeUserScale(reset ? USER_SCALE_LIMITS.default : multiplier ?? displayState.userScaleMultiplier + delta);
  if (next !== displayState.userScaleMultiplier) writePreferences({ uiScaleMultiplier: next });
  return syncDisplay(next);
}
async function activate(m) {
  if (db && mode === m) return m;
  diagnostics?.stage("open");
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
  customPreviews.clear();
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
  if (!db) throw Error(tMain("err.selectBookFirst"));
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
  diagnostics.stage("fetch");
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
  if (results.some((result) => result.error)) diagnostics.note("source_unavailable");
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
    if (!secretNames.has(key)) throw Error(tMain("err.unknownConnection"));
    const v = preference(db, "credentials", key);
    if (!v) return null;
    try {
      return safeStorage.decryptString(Buffer.from(v, "base64"));
    } catch {
      throw Error(tMain("err.dpapiDecrypt"));
    }
  },
  set(key, value) {
    if (!secretNames.has(key)) throw Error(tMain("err.unknownConnection"));
    if (!value) {
      putPref(db, "credentials", key, null);
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) throw Error(tMain("err.dpapiUnavailable"));
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
const portableBackup = () => [{ name: tMain("dialog.filter.spbackup"), extensions: ["spbackup"] }];
function expireAccountPreviews(id) {
  for (const broker of ["ibkr","webull"]) previewRequests.delete(JSON.stringify([broker,id]));
  for (const [key,preview] of previews) if (preview.account === id) previews.delete(key);
}
function draftFor(ticket) {
  if(!setupDraft || setupDraft.ticket!==ticket || Date.now()>setupDraft.expires) throw Error(tMain("err.setupExpired"));
  return setupDraft;
}
function allowSetup(){
  if(mode==="demo" || (!db && fs.existsSync(fileFor("real")))) throw Error(tMain("err.openRealBookForSetup"));
}
async function verifyDraft(draft) {
  if(draft.broker==="ibkr"){
    const report=await brokerReport(db,"ibkr",secrets,draft.credentials);
    if(!report.brokerAccountId) throw Error(tMain("err.ibkrMissingAccountInfo"));
    draft.accounts=[{accountId:report.brokerAccountId,accountNumber:report.brokerAccountId}];
  }else{
    const result=await authorizeWebull(draft.credentials,value=>{draft.credentials.accessToken=value;});
    draft.accounts=result.accounts;
    if(result.connected && !draft.accounts.length) throw Error(tMain("err.webullNoBindableAccounts"));
  }
  return {ticket:draft.ticket,accounts:draft.accounts};
}
const nativeBackup = () => [{ name: tMain("dialog.filter.restoreBackup"), extensions: ["spbackup", "sqlite", "db"] }];
function webullFundsTarget(book, localId, binding) {
  if (binding && binding.broker !== "webull") return;
  const remoteId = binding?.remoteId || preference(book, BROKER, "webull.api-account-id");
  return remoteId ? JSON.stringify([localId, remoteId]) : undefined;
}

const handlers = {
  diagnosticsPreview({ range }) {
    return diagnostics.preview(["recent", "day", "all"].includes(range) ? range : "recent");
  },
  async diagnosticsSave({ id }) {
    const file = await pick([{ name: "JSON Lines", extensions: ["jsonl"] }], true, "Stock-Portfolio-diagnostics.jsonl");
    if (!file || factoryResetRequested) return false;
    const text = diagnostics.snapshot(id);
    if (text === undefined || path.extname(file).toLowerCase() !== ".jsonl") throw Error("Invalid diagnostic export");
    const parent = fs.realpathSync.native(path.dirname(file));
    const profile = fs.realpathSync.native(dataDir());
    const relative = path.relative(profile, parent);
    if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
      throw Error("Choose a destination outside the application profile");
    }
    publishFile(path.join(parent, path.basename(file)), (stage) => fs.writeFileSync(stage, text, { flag: "wx", mode: 0o600 }));
    return true;
  },
  diagnosticsPause({ paused }) {
    if (typeof paused !== "boolean") throw Error("Invalid diagnostic setting");
    writePreferences({ diagnosticsPaused: paused });
    diagnostics.setPaused(paused);
  },
  diagnosticsClear: () => diagnostics.clear(),
  diagnosticsReport({ screen }) {
    diagnostics.mark(screen);
  },
  diagnosticsRenderer({ screen, stage }) {
    diagnostics.renderer(screen, stage);
  },
  async connectWebullFunds({ account: localId }) {
    diagnostics.stage("validate");
    const book = db;
    if (!book || mode !== "real") throw Error(tMain("err.connectBrokerInReal"));
    const local = account(book, localId);
    if (!local.active || local.mode !== "TRANSACTIONS") throw Error(tMain("err.selectActiveTxAccount"));
    const target = webullFundsTarget(book, local.id, bindingFor(book, local.id));
    if (!target) throw Error(tMain("svc.webullNeedCreds"));
    diagnostics.stage("fetch");
    const status = await openFundsLogin(target, win, tMain("imports.webullFundsTitle", { account: local.name }));
    if (status !== "loaded") return status;
    if (db !== book || webullFundsTarget(book, local.id, bindingFor(book, local.id)) !== target) {
      throw Error(tMain("err.bookSwitchedResync"));
    }
    putPref(book, BROKER, "webull.funds." + local.id, target);
    return status;
  },
  macroMarket: () => macroMarket.snapshot(),
  refreshMacroMarket: () => macroMarket.refresh(),
  displayState: () => syncDisplay(),
  setUserScale,
  factoryReset() {
    try {
      requestFactoryReset(dataDir());
    } catch {
      throw Error(tMain("err.factoryResetRequest"));
    }
    factoryResetRequested = true;
    let relaunchFailed;
    try {
      relaunchFailed = app.relaunch() === false;
    } catch {
      relaunchFailed = true;
      diagnostics.note("unexpected_error");
    }
    setImmediate(() => {
      // An embedded broker page can veto a normal close via beforeunload.
      for (const window of BrowserWindow.getAllWindows()) {
        if (window !== win) window.destroy();
      }
      if (relaunchFailed) {
        dialog.showErrorBox(tMain("settings.factoryReset.section"), tMain("settings.factoryReset.reopen"));
      }
      app.quit();
    });
  },
  async home() {
    let storageError;
    try {
      diagnostics.stage("protect");
      protectLocalFiles();
      if (!mode && ["real", "demo"].includes(lastMode()) && fs.existsSync(fileFor(lastMode())))
        await activate(lastMode());
    } catch (e) {
      diagnostics.note("storage_unavailable");
      storageError = e.message;
    }
    return {
      storageError,
      mode: mode || null,
      theme: nativeTheme.themeSource,
      ...syncLanguage(),
      hasReal: fs.existsSync(fileFor("real")),
      onboardingSeen: Boolean(readPreferences().onboardingSeen),
      sources: knownSources(originalDir()).map((p, i) => ({ id: i, label: path.relative(originalDir(), p) })),
    };
  },
  async beginAccountSetup({broker,queryId,token,appKey,appSecret}) {
    allowSetup();
    if(!["ibkr","webull"].includes(broker)) throw Error(tMain("err.unknownBroker"));
    const credentials=broker==="ibkr"?{queryId,token}:{appKey,appSecret};
    if(Object.values(credentials).some(v=>typeof v!=="string" || !v.trim() || v.length>4096)) throw Error(tMain("err.incompleteCredentials"));
    if (broker === "webull" && db) credentials.accessToken = savedWebullToken(db, safeStorage, credentials);
    setupDraft={broker,credentials,accounts:[],ticket:randomUUID(),expires:Date.now()+20*60_000};
    return verifyDraft(setupDraft);
  },
  async checkAccountSetup({ticket}) { allowSetup();return verifyDraft(draftFor(ticket)); },
  async bindAccount({ticket,...args}) {
    allowSetup();
    const draft=draftFor(ticket);
    if(!draft.accounts.some(a=>a.accountId===args.remoteId)) throw Error(tMain("err.verifyBindAccountFirst"));
    if(!db){await activate("real");setupDraft=draft;}
    const result=saveBinding(db,safeStorage,draft,args);
    expireAccountPreviews(result.id);
    setupDraft=null;
    writePreferences({onboardingSeen:true});
    return result;
  },
  leaveAccountSetup() {setupDraft=null;writePreferences({onboardingSeen:true});},
  async reauthorizeIbkr({ id, queryId = "", token }) {
    if (mode !== "real") throw Error(tMain("err.openRealBook"));
    const book = requireBook();
    const binding = bindingFor(book, id);
    if (binding?.broker !== "ibkr") throw Error(tMain("err.bindingNotFound"));
    const local = account(book, id);
    if (!local.active || local.mode !== "TRANSACTIONS") throw Error(tMain("err.selectActiveTxAccount"));
    if (typeof queryId !== "string" || queryId.length > 4096 ||
        typeof token !== "string" || !token.trim() || token.length > 4096) {
      throw Error(tMain("err.incompleteCredentials"));
    }
    const draft = {
      broker: "ibkr",
      credentials: { queryId: queryId.trim() || credentialsFor(book, id, safeStorage).queryId, token: token.trim() },
    };
    await verifyDraft(draft);
    if (draft.accounts[0].accountId !== binding.remoteId) throw Error(tMain("err.ibkrAccountMismatch"));
    saveBinding(book, safeStorage, draft, { remoteId: binding.remoteId, localId: id }, { selectForImport: false });
    expireAccountPreviews(id);
  },
  disconnectAccount({id}) {
    if(mode!=="real") throw Error(tMain("err.openRealBook"));
    disconnectBinding(requireBook(),id);
    expireAccountPreviews(id);
  },
  setTheme({ theme }) {
    if (!themes.includes(theme)) throw Error(tMain("err.invalidTheme"));
    writePreferences({ theme });
    nativeTheme.themeSource = theme;
    return theme;
  },
  setLanguage({ language }) {
    if (!LANGUAGE_PREFERENCES.includes(language)) throw Error(tMain("lang.invalid"));
    writePreferences({ language });
    return syncLanguage(language);
  },
  openDemo: () => activate("demo"),
  openReal: () => {
    if (!fs.existsSync(fileFor("real"))) throw Error(tMain("err.noRealBook"));
    return activate("real");
  },
  newBook: () => {
    if (fs.existsSync(fileFor("real"))) throw Error(tMain("err.realBookExists"));
    return activate("real");
  },
  async migrationPreview({ source }) {
    diagnostics.stage("pick");
    const file = Number.isInteger(source)
      ? knownSources(originalDir())[source]
      : await pick([{ name: tMain("dialog.filter.wealthfolio"), extensions: ["db", "sqlite", "sqlite3"] }]);
    diagnostics.stage("preview");
    return sourcePreview(file);
  },
  async migrationCommit({ token }) {
    diagnostics.stage("validate");
    if (!stagedSource || token !== stagedSource.token) throw Error(tMain("err.repreviewMigration"));
    diagnostics.stage("commit");
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
    if (!displayedReview || token !== displayedReview.token) throw Error(tMain("err.reviewRangeChanged"));
    return saveReviewNote(requireBook(), displayedReview, text, id);
  },
  // Index levels, the AUD rate and the closes of held listings for the displayed period.
  // An automatic update repeats for the same period only after a pause.
  async refreshReview({ token, auto }) {
    if (mode !== "real" || !displayedReview || token !== displayedReview.token)
      throw Error(tMain("err.openRealReview"));
    const review = displayedReview,
      range = { from: review.base, to: review.to };
    const find = db.prepare("SELECT * FROM sp_assets WHERE id=?");
    const assets = review.missingAssets.map((id) => find.get(id)).filter(Boolean);
    const key = review.ids.join() + range.from + range.to;
    if (auto && (!marketAutoUpdate() || Date.now() - (reviewChecks.get(key) || 0) < 900000)) return null;
    reviewChecks.set(key, Date.now());
    diagnostics.stage("fetch");
    const [indices, closes] = await Promise.all([
      refreshBenchmarks(requireBook(), range, network.request),
      refreshCloses(requireBook(), assets, range, network.request),
    ]);
    const results = [...indices, ...closes];
    if (results.some((result) => result.error)) diagnostics.note("source_unavailable");
    return results;
  },
  async updateMarket() {
    requireBook();
    if (mode !== "real") throw Error(tMain("err.demoSimulatedMarket"));
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
  async createCustomAccount(args) {
    allowSetup();
    if (!db) await activate("real");
    const id = createCustomAccount(requireBook(), args);
    writePreferences({ onboardingSeen: true });
    return id;
  },
  async previewCustomCsv({ account: id }) {
    const book = requireBook();
    customAccount(book, id);
    const file = await pick([{ name: tMain("custom.csv"), extensions: ["csv"] }]);
    if (!file || factoryResetRequested) return null;
    customPreviews.clear();
    if (fs.statSync(file).size > 48 * 1024 * 1024) throw Error(tMain("err.fileTooLarge"));
    const data = fs.readFileSync(file);
    if (data.length > 48 * 1024 * 1024) throw Error(tMain("err.fileTooLarge"));
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw Error(tMain("custom.error.encoding"));
    }
    const result = importCustomCsv(book, id, text);
    const token = randomUUID();
    customPreviews.set(token, { account: id, text });
    return { ...result, token, name: path.basename(file) };
  },
  commitCustomCsv({ account: id, token }) {
    const preview = customPreviews.get(token);
    if (!preview || preview.account !== id) throw Error(tMain("err.previewExpired"));
    const result = importCustomCsv(requireBook(), id, preview.text, true);
    customPreviews.delete(token);
    return { ...result, done: result.invalid === 0 };
  },
  async downloadCustomCsv({ account: id }) {
    customAccount(requireBook(), id);
    const file = await pick([{ name: tMain("custom.csv"), extensions: ["csv"] }], true, "stock-portfolio-template.csv");
    if (factoryResetRequested) return false;
    if (file) fs.writeFileSync(file, customCsvHeader + "\r\n", "utf8");
    return Boolean(file);
  },
  activityAccounts({ account: id, event: eventId }) {
    const book = requireBook();
    const row = book.prepare("SELECT data FROM sp_events WHERE id=? AND account=?").get(eventId, id);
    if (!row) throw Error(tMain("svc.amendNotFound"));
    const { group } = json(row.data, {});
    const related = transferMembers(book, group);
    const ids = new Set([id, ...related.map((event) => event.accountId)]);
    return { names: [...ids].map((accountId) => account(book, accountId).name), members: related.map((event) => event.id) };
  },
  history({ account: id, limit = 200, offset = 0, text = "", accountIds, assetIds, through }) {
    const book = requireBook();
    const pageSize = Math.min(500, Math.max(1, Math.trunc(Number(limit)) || 200));
    if (assetIds) return securityHistory(book, { accountIds, assetIds, through, limit: pageSize });
    const rows = book
      .prepare(
        "SELECT data FROM sp_events WHERE (?='' OR account=?) AND (?='' OR instr(lower(data),lower(?))>0) AND json_extract(data,'$.metadata.customFxIncoming') IS NULL ORDER BY day DESC,id LIMIT ? OFFSET ?",
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
  manual(args) {
    const book = requireBook();
    if (preference(book, CUSTOM_ACCOUNT, args.account) === null) return addManual(book, args);
    try {
      return { id: addManual(book, args) };
    } catch (error) {
      if (!error.field) throw error;
      return { field: error.field, message: error.message };
    }
  },
  recordHolding: (args) => recordHolding(requireBook(), args),
  rememberListing: (args) => rememberListing(requireBook(), args),
  amend: (args) => amendEvent(requireBook(), args),
  deleteActivity(args) {
    const result = deleteActivity(requireBook(), args);
    // A grouped transfer can affect both sides of the ledger.
    previews.clear();
    previewRequests.clear();
    return result;
  },
  corrections: (args) =>
    requireBook()
      .prepare("SELECT created,reason FROM sp_corrections WHERE event=? ORDER BY created DESC")
      .all(args.id),
  async preview(args) {
    diagnostics.stage("validate");
    const book = requireBook();
    if (args.token) {
      const p = previews.get(args.token);
      if (!p) throw Error(tMain("err.previewExpired"));
      return { ...await batch(book, p.account, p.broker, p.report, p.source), token: args.token };
    }
    if (args.broker === "both") {
      if (args.mapping?.ibkr && args.mapping.ibkr === args.mapping.webull)
        throw Error(tMain("err.distinctAccountsForBoth"));
      const reports = await Promise.all(["ibkr", "webull"].map((broker) => diagnostics.branch(async () => {
        const id = args.mapping?.[broker];
        try {
          if (!id) throw Error(tMain("err.selectTargetAccount"));
          return await handlers.preview({ broker, source: args.source, account: id });
        } catch (err) {
          diagnostics.note("partial_sync", broker);
          return { broker, account: id, error: err.message };
        }
      })));
      diagnostics.stage("preview");
      return { broker: "both", reports };
    }
    const broker = args.broker === "ibkr" ? "ibkr" : "webull",
      a = account(db, args.account);
    if (!a.active || a.mode !== "TRANSACTIONS") throw Error(tMain("err.selectActiveTxAccount"));
    const requestKey = JSON.stringify([broker, a.id]);
    const request = randomUUID();
    previewRequests.set(requestKey, request);
    let report, source;
    if (preference(book, CUSTOM_ACCOUNT, a.id) !== null) throw Error(tMain("custom.error.brokerBinding"));
    const binding=bindingFor(book,a.id);
    if(binding && binding.broker!==broker) throw Error(tMain("err.accountBrokerMismatch"));
    if (args.source === "live") {
      if (mode === "demo") throw Error(tMain("err.connectBrokerInReal"));
      try {
        diagnostics.stage("fetch");
        report = await brokerReport(book, broker, secrets,binding ? credentialsFor(book,a.id,safeStorage) : null);
      } catch (error) {
        if (db === book && !binding) putPref(book, BROKER, "verified." + broker, null);
        throw error;
      }
      if (broker === "webull" && !report.activities.some((activity) => activity.activityType === "DEPOSIT")) {
        const target = webullFundsTarget(book, a.id, binding);
        const funds = target && preference(book, BROKER, "webull.funds." + a.id) === target
          ? await fetchWebullFunds(target)
          : { status: "login" };
        report.webullFundsStatus = funds.status;
        if (funds.status === "login") diagnostics.note("login_required", "webull");
        if (funds.status === "loaded") report.activities.push(...funds.activities);
      }
      source = tMain("source.liveSync", { broker: broker.toUpperCase() });
    } else {
      let text;
      if (args.source === "sample") {
        if (mode !== "demo") throw Error(tMain("err.sampleOnlyInDemo"));
        source = tMain(broker === "ibkr" ? "source.sampleIbkr" : "source.sampleWebull");
        text = broker === "ibkr" ? demoXml : demoCsv;
      } else {
        diagnostics.stage("pick");
        const file = await pick([
          {
            name: tMain(broker === "ibkr" ? "dialog.filter.ibkrXml" : "dialog.filter.webullCsv"),
            extensions: [broker === "ibkr" ? "xml" : "csv"],
          },
        ]);
        if (!file) return null;
        if (fs.statSync(file).size > 48 * 1024 * 1024) throw Error(tMain("err.fileTooLarge"));
        source = path.basename(file);
        text = fs.readFileSync(file, "utf8");
      }
      diagnostics.stage("parse");
      report = broker === "ibkr" ? detailedIbkr(text) : parseWebullCsv(text);
    }
    if(binding && broker==="ibkr" && report.brokerAccountId!==binding.remoteId) throw Error(tMain("err.ibkrAccountMismatch"));
    if (db !== book) throw Error(tMain("err.bookSwitchedResync"));
    if (!binding && broker === "ibkr" && report.brokerAccountId && bindings(book).some(b => b.broker === broker && b.remoteId === report.brokerAccountId))
      throw Error(tMain("err.ibkrBoundElsewhere"));
    diagnostics.stage("preview");
    const summary = await batch(book, a.id, broker, report, source),
      token = randomUUID();
    if (db !== book) throw Error(tMain("err.bookSwitchedResync"));
    if (previewRequests.get(requestKey) !== request) throw Error(tMain("err.brokerRereadSuperseded"));
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
    diagnostics.stage("validate");
    const p = previews.get(token);
    if (!p) throw Error(tMain("err.previewExpired"));
    diagnostics.stage("commit");
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
      throw Error(tMain("err.openingConflict"));
    return transaction(db, () => {
      const cash = {},
        positions = {};
      for (const [c, v] of Object.entries(args.cash || {})) cash[currency(c)] = money(v);
      for (const r of args.positions || []) {
        const picked = r.assetId && listingMatch(db, {account: a.id, symbol:r.symbol, currency:r.currency, mic:r.mic}).candidates.find((c) => c.id === r.assetId);
        if (r.assetId && !picked) throw Error(tMain("err.openingMarketMismatch"));
        const id = picked?.id || resolveAsset(
          db,
          { symbol: r.symbol, exchangeMic: r.mic, instrumentType: r.kind || "EQUITY" },
          r.currency,
        );
        if (!id) throw Error(tMain("err.openingMissingSymbol"));
        if (id in positions) throw Error(tMain("err.openingDuplicateSymbol"));
        positions[id] = money(r.quantity);
        if (r.price) savePrice(db, id, date, r.price, "期初结单", 30);
      }
      if (!Object.keys(cash).length && !Object.keys(positions).length)
        throw Error(tMain("err.openingEmpty"));
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
    if (a.assetId && !db.prepare("SELECT 1 FROM sp_assets WHERE id=?").get(id)) throw Error(tMain("err.assetNotFound"));
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
      const file = await pick([{ name: tMain("dialog.filter.etfCsv"), extensions: ["csv"] }]);
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
    if (!entry?.snapshot) throw Error(tMain("err.holdingsMissing"));
    const file = await pick([{ name: tMain("dialog.filter.etfCsv"), extensions: ["csv"] }], true, "ETF-holdings.csv");
    if (file) {
      if (path.extname(file).toLowerCase() !== ".csv") throw Error(tMain("err.csvExtRequired"));
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
    if (mode === "demo") throw Error(tMain("err.connectInReal"));
    const allowed = new Set(["ibkr.flex-query-id", "webull.app-key", "webull.api-account-id"]);
    transaction(db, () => {
      for (const [k, v] of Object.entries(args)) {
        if (/^(ibkr|webull)\./.test(k)) putPref(db, BROKER, "verified." + k.split(".")[0], null);
        if (secretNames.has(k)) secrets.set(k, v);
        else if (allowed.has(k)) putPref(db, BROKER, k, v || null);
        else throw Error(tMain("err.unknownSetting"));
      }
    });
    return true;
  },
  async connectWebull() {
    requireBook();
    if (mode !== "real") throw Error(tMain("err.openRealBook"));
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
      diagnostics.stage("fetch");
      if (now - lastCloseCheck >= 18_000) {
        const previous = lastCloseCheck;
        lastCloseCheck = now;
        const book = loadBook(db);
        const assets = heldListings(book, marketTime(now).date);
        const closes = await refreshDueCloses(book, assets, now);
        if (closes.some((result) => result.error)) diagnostics.note("source_unavailable");
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
          diagnostics.stage("fetch");
          await refreshFund(db, f.asset);
          changed = true;
        } catch {
          diagnostics.stage("cache");
          diagnostics.note(f.snapshot ? "stale_cache" : "source_unavailable");
        }
      }
    }
    return changed;
  },
  async backup({ password, convertLegacy = false }) {
    diagnostics.stage("validate");
    const key = backupKey(password);
    let external;
    try {
      let source;
      if (convertLegacy) {
        const old = await pick([{ name: tMain("dialog.filter.legacyBackup"), extensions: ["sqlite", "db"] }]);
        if (!old) return null;
        external = openDatabase(old, isPlainDatabase(old) ? null : getBookKey(), { readonly: true, existing: true });
        backupMode(external);
        source = external;
      } else source = requireBook();
      diagnostics.stage("pick");
      const file = await pick(portableBackup(), true, "Stock-Portfolio-" + new Date().toISOString().slice(0, 10) + ".spbackup");
      if (!file) return null;
      if (path.extname(file).toLowerCase() !== ".spbackup") throw Error(tMain("err.spbackupExtRequired"));
      diagnostics.stage("commit");
      publishFile(file, (temp) => encryptedCopy(source, temp, key));
      return path.basename(file);
    } finally {
      key.fill(0);
      external?.close();
    }
  },
  async selectBackup() {
    selectedBackup = null;
    const file = await pick(nativeBackup());
    if (!file) return null;
    const resolved = fs.realpathSync.native(file).toLowerCase();
    if (["real", "demo"].some((m) => fs.existsSync(fileFor(m)) && fs.realpathSync.native(fileFor(m)).toLowerCase() === resolved))
      throw Error(tMain("err.selectSeparateBackup"));
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
    diagnostics.stage("validate");
    if (!selectedBackup || token !== selectedBackup.token) throw Error(tMain("err.reselectBackup"));
    const { file, kind } = selectedBackup;
    const passwordKey = kind === "password" ? backupKey(password) : null;
    const sourceKey = kind === "local" ? getBookKey() : passwordKey;
    let source, replaced, rollback;
    const previousMode = mode;
    try {
      diagnostics.stage("open");
      source = openDatabase(file, sourceKey, { readonly: true, existing: true });
      const nextMode = backupMode(source);
      diagnostics.stage("integrity");
      checkIntegrity(source);
      const target = fileFor(nextMode);
      const targetLabel = tMain(nextMode === "demo" ? "dialog.restore.titleDemo" : "dialog.restore.titleReal");
      const ok = await dialog.showMessageBox(win, {
        type: "question",
        buttons: [tMain("dialog.restore.cancel"), tMain("dialog.restore.confirm", { target: targetLabel })],
        defaultId: 0,
        cancelId: 0,
        message: tMain("dialog.restore.message", { target: targetLabel }),
        detail: tMain("dialog.restore.detail"),
      });
      if (ok.response !== 1) return null;
      const key = getBookKey();
      diagnostics.stage("replace");
      publishFile(target, (stage) => {
        encryptedCopy(source, stage, key);
        const next = createBook(stage, key);
        try {
          if (backupMode(next) !== nextMode) throw Error(tMain("err.backupChangedDuringRestore"));
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
      await diagnostics.branch(async () => {
        if (replaced && rollback) {
          diagnostics.stage("rollback");
          publishFile(replaced, (stage) => fs.copyFileSync(rollback, stage, fs.constants.COPYFILE_EXCL));
          diagnostics.note("rollback_completed");
        }
        if (!db && previousMode) await activate(previousMode);
      });
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
const diagnosticMilestones = new Set([
  "openReal", "openDemo", "newBook", "migrationPreview", "migrationCommit",
  "beginAccountSetup", "checkAccountSetup", "bindAccount", "reauthorizeIbkr",
  "connectWebullFunds", "preview", "commit", "backup", "restore", "updateMarket", "factoryReset",
]);
const diagnosticJobs = ["startup", "renderer", "childProcess", "windowLayout", "keyboardZoom", "saveWindow", "openGuide", "shutdown"];
function dispatchAction(name, fn, args) {
  const invoke = () => {
    if (factoryResetRequested) throw Error(tMain("err.factoryResetPending"));
    diagnostics.stage("execute");
    return fn(args ?? {});
  };
  if (name === "factoryReset" || name.startsWith("diagnostics") ||
      ["displayState", "setUserScale", "macroMarket", "refreshMacroMarket"].includes(name)) return invoke();
  diagnostics.stage("queue");
  if (!switchingBooks && ["dashboard", "history", "connections", "preview", "connectWebullFunds"].includes(name)) {
    const read = Promise.resolve().then(invoke);
    readers.add(read);
    return read.finally(() => readers.delete(read));
  }
  const run = queue.then(async () => {
    if (factoryResetRequested) throw Error(tMain("err.factoryResetPending"));
    const switchBook = ["openDemo", "openReal", "newBook", "migrationCommit", "restore"].includes(name) ||
      (["home", "createCustomAccount"].includes(name) && !mode);
    if (!switchBook) return invoke();
    switchingBooks = true;
    try {
      await Promise.allSettled(readers);
      return await invoke();
    } finally {
      switchingBooks = false;
    }
  });
  queue = run.catch(() => {});
  return run;
}
for (const [name, fn] of Object.entries(handlers))
  ipcMain.handle("portfolio:" + name, (event, args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame?.url !== page) throw Error(tMain("err.invalidRequestOrigin"));
    return diagnostics.run(name, "dispatch", () => dispatchAction(name, fn, args), diagnosticMilestones.has(name));
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
  diagnosticJob("windowLayout", "configure", () => contents.setVisualZoomLevelLimits(1, 1));
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
    resizeTimer = setTimeout(() => diagnosticJob("windowLayout", "layout", () => {
      if (!win || win.isDestroyed()) return;
      const next = minimumWindowSize(screen.getDisplayMatching(win.getBounds()).workArea);
      if (next.width !== minimum.width || next.height !== minimum.height) {
        minimum = next;
        win.setMinimumSize(minimum.width, minimum.height);
      }
      syncDisplay();
    }), 50);
  };
  for (const name of ["resize", "move", "moved", "maximize", "unmaximize"]) win.on(name, scheduleDisplay);
  screen.on("display-metrics-changed", scheduleDisplay);
  win.once("closed", () => {
    clearTimeout(resizeTimer);
    screen.removeListener("display-metrics-changed", scheduleDisplay);
    win = null;
  });
  contents.on("did-finish-load", () => diagnosticJob("windowLayout", "layout", () => syncDisplay()));
  contents.on("preload-error", () => diagnostics.emit("renderer", "renderer", "preload", "failed", "preload_failed"));
  contents.on("render-process-gone", () => diagnostics.emit("renderer", "renderer", "render", "failed", "renderer_gone"));
  contents.on("unresponsive", () => diagnostics.emit("renderer", "renderer", "render", "degraded", "renderer_unresponsive"));
  contents.on("before-input-event", (event, input) => {
    if (factoryResetRequested) return;
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
    const key = input.key;
    if (key !== "0" && key !== "=" && key !== "+" && key !== "-") return;
    event.preventDefault();
    diagnosticJob("keyboardZoom", "preferences", () => {
      setUserScale(key === "0" ? { reset: true } : { delta: key === "-" ? -USER_SCALE_LIMITS.step : USER_SCALE_LIMITS.step });
    });
  });
  contents.setWindowOpenHandler(({url}) => {
    if (guideLinks.includes(url)) diagnosticJob("openGuide", "execute", () => shell.openExternal(url));
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
      if (factoryResetRequested) return;
      diagnosticJob("saveWindow", "preferences", () => {
        writePreferences({ window: { bounds: win.getNormalBounds(), maximized: win.isMaximized() } });
      });
    });
  syncDisplay();
  diagnostics.stage("load");
  return win.loadFile(path.join(__dirname, "index.html"));
}

function diagnosticJob(operation, stage, work) {
  void diagnostics.run(operation, stage, work).catch(() => {});
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let profileReady = false;
  try {
    // The previous process and its database/session handles are gone. Keep the
    // single-instance lock while clearing the profile before Electron is ready.
    finishFactoryReset(dataDir());
    diagnostics = createDiagnostics({
      directory: path.join(dataDir(), "diagnostics"), build: app.getVersion(),
      operations: [...Object.keys(handlers), ...diagnosticJobs], paused: readPreferences().diagnosticsPaused === true,
    });
    diagnostics.start();
    profileReady = true;
  } catch {
    console.error("Unable to finish factory reset");
    if (!process.env.STACK_PORTFOLIO_HEADLESS) {
      syncLanguage("system");
      dialog.showErrorBox(tMain("settings.factoryReset.incomplete"), tMain("settings.factoryReset.retry"));
    }
    app.exit(1);
  }
  app.on("second-instance", () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
  nativeTheme.on("updated", () => {
    if (win && !win.isDestroyed()) diagnosticJob("windowLayout", "layout", () => win.setBackgroundColor(windowBackground()));
  });
  if (profileReady) {
    app.on("child-process-gone", () => diagnostics.emit("childProcess", "child", "event", "failed", "child_gone"));
    void diagnostics.run("startup", "configure", async () => {
      await app.whenReady();
      const { theme } = readPreferences();
      nativeTheme.themeSource = themes.includes(theme) ? theme : "system";
      syncLanguage();
      diagnostics.stage("createWindow");
      await createWindow();
    }, true).catch(async () => {
      await diagnostics.stop();
      app.exit(1);
    });
  }
  app.on("window-all-closed", () => app.quit());
  let drained = false;
  app.on("will-quit", (event) => {
    if (!drained && diagnostics) {
      event.preventDefault();
      if (!factoryResetRequested) diagnostics.emit("shutdown", "main", "close", "succeeded");
      void diagnostics.stop().then(() => {
        if (drained) return;
        drained = true;
        app.quit();
      });
      return;
    }
    db?.close();
    bookKey?.fill(0);
  });
}
