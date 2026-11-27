import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Database,
  RefreshCw,
  X,
} from "lucide-react";
import { api, isIpcFailure, Modal } from "./common";
import { Mark, Shell } from "./Shell";
import { Holdings } from "./Cockpit";
import { Overview } from "./Overview";
import { Performance } from "./Performance";
import { MacroAnalysis } from "./MacroAnalysis";
import { Imports } from "./Imports";
import { Allocation } from "./Allocation";
import { Settings } from "./Settings";
import { BookBackups } from "./BookBackups";
import { FactoryResetButton } from "./FactoryReset";
import { DiagnosticsButton } from "./Diagnostics";
import { AccountScope, AsOf, OverviewLayoutPicker, ValuationDate } from "./FilterControls";
import { dashboardQuery, defaultFilters, rememberedFilters, restoreFilters } from "./filters.js";
import "./design.css";
import "./styles.css";
import "./settings.css";
import { AccountWizard } from "./onboarding/AccountWizard";
import { I18nProvider, useI18n } from "./i18n.jsx";
import { createTranslator } from "../i18n/index.js";

let diagnosticScreen = "startup";
function recordRendererFailure(stage, error) {
  if (!isIpcFailure(error)) void api?.diagnosticsRenderer({ screen: diagnosticScreen, stage }).catch(() => {});
}

class AppErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    recordRendererFailure("render", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="boot"><Mark /><DiagnosticsButton screen={diagnosticScreen} /></div>;
  }
}

function Welcome({ home, run, enter, onClose, onSetup }) {
  const { t, languagePreference, localeOptions, changeLanguage } = useI18n();
  const [preview, setPreview] = useState(null),
    [source, setSource] = useState(home.sources[0]?.id ?? "file");
  async function migrate() {
    await run(async () => {
      const s = await api.migrationPreview({ source: source === "file" ? null : Number(source) });
      if (s) setPreview(s);
    }, false);
  }
  // Spec §4.7: no app shell and no filters; the two cards sit side by side, stacked below 900.
  return (
    <div className="welcome">
      <div className="wel">
      <header>
        <Mark />
        {t("app.name")}
        <label className="welcome-lang" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 400 }}>
          <span className="cap">{t("lang.label")}</span>
          <select
            aria-label={t("lang.label")}
            value={languagePreference}
            onChange={(e) => changeLanguage(e.target.value)}
          >
            {localeOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
      </header>
      <main>
        <div className="intro">
          <h1>{t("welcome.heading")}</h1>
          <p>{t("welcome.tagline")}</p>
        </div>
        <div className="wc">
          <section className="card hero" aria-label={home.hasReal ? t("welcome.realTitle") : t("welcome.migrateTitle")}>
            <Database size={24} strokeWidth={1.8} />
            <h2>{home.hasReal ? t("welcome.realTitle") : t("welcome.migrateTitle")}</h2>
            {home.hasReal ? (
              <>
                <p>{t("welcome.realDesc")}</p>
                <button className="btn" onClick={() => enter("openReal")}>
                  {t("welcome.openReal")}
                </button>
              </>
            ) : (
              <>
                <p>{t("welcome.migrateDesc")}</p>
                <label className="f">
                  <span>{t("welcome.dataSource")}</span>
                  <select
                    aria-label={t("welcome.dataSourceAria")}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    {home.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {t("welcome.localWealthfolio", { label: s.label })}
                      </option>
                    ))}
                    <option value="file">{t("welcome.chooseOtherDb")}</option>
                  </select>
                </label>
                <button className="btn" onClick={migrate}>
                  {t("welcome.previewMigration")}
                </button>
              </>
            )}
          </section>
          <section className="card" aria-label={t("welcome.demoTitle")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3v18h18" />
              <path d="m7 15 4-5 3 3 5-7" />
            </svg>
            <h2>
              {t("welcome.demoTitle")} <span className="demo">{t("app.demoBadge")}</span>
            </h2>
            <p>{t("welcome.demoDesc")}</p>
            <button className="btn" onClick={() => enter("openDemo")}>
              {t("welcome.openDemo")}
            </button>
          </section>
        </div>
        <div className="wf">
          {!home.hasReal && !home.mode && <button className="lnk" onClick={onSetup}>{t("app.addBrokerAccount")}</button>}
          {!home.hasReal && (
            <button className="lnk" onClick={() => enter("newBook")}>
              {t("welcome.newBook")}
            </button>
          )}
          <BookBackups welcome run={run} restored={(m) => enter(m === "demo" ? "openDemo" : "openReal")} />
          <DiagnosticsButton screen="welcome" />
          {home.storageError && <FactoryResetButton />}
          {onClose && (
            <button className="lnk" onClick={onClose}>
              {t("welcome.backToCurrent")}
            </button>
          )}
        </div>
        {preview && (
          <Modal title={t("welcome.modalTitle")} close={() => setPreview(null)}>
            <p>{t("welcome.modalDesc", { name: preview.name })}</p>
            <dl>
              {Object.entries({
                accounts: t("welcome.count.accounts"),
                activities: t("welcome.count.activities"),
                assets: t("welcome.count.assets"),
                snapshots: t("welcome.count.snapshots"),
                valuations: t("welcome.count.valuations"),
                quotes: t("welcome.count.quotes"),
                allocation: t("welcome.count.allocation"),
                broker: t("welcome.count.broker"),
              }).map(([k, l]) => (
                <React.Fragment key={k}>
                  <dt>{l}</dt>
                  <dd>{preview.counts[k]}</dd>
                </React.Fragment>
              ))}
            </dl>
            {(!preview.counts.allocation || !preview.counts.broker) && (
              <p className="warning">{t("welcome.missingModuleWarning")}</p>
            )}
            {preview.counts.invalidFunds > 0 && (
              <p className="warning">
                {t("welcome.invalidFundsWarning", { count: preview.counts.invalidFunds })}
              </p>
            )}
            <p className="muted">{t("welcome.reconnectNote")}</p>
            <button
              className="btn pri"
              onClick={() =>
                run(async () => {
                  await api.migrationCommit({ token: preview.token });
                  setPreview(null);
                  await enter("openReal");
                }, t("welcome.migrationDone"))
              }
            >
              {t("welcome.confirmMigrate")}
            </button>
          </Modal>
        )}
      </main>
      </div>
    </div>
  );
}
// The account scope and period are remembered across restarts (spec §2.3); storage may be unavailable.
const overviewLayoutKey = "stock-portfolio.overview-layout.v1";
function savedOverviewLayout() {
  try {
    if (localStorage.getItem(overviewLayoutKey) === "daily") return "daily";
  } catch {}
  return "classic";
}

const filtersKey = "stock-portfolio.filters.v1";
function savedFilters() {
  try {
    return restoreFilters(JSON.parse(localStorage.getItem(filtersKey)));
  } catch {
    return defaultFilters;
  }
}
function saveFilters(filters) {
  try {
    localStorage.setItem(filtersKey, JSON.stringify(rememberedFilters(filters)));
  } catch {}
}
const analysisPages = ["overview", "performance", "allocation", "holdings"];

function Application() {
  const [display, setDisplay] = useState({ aspect: "16:9", userScaleMultiplier: 1 });
  useLayoutEffect(() => {
    let active = true, received = false;
    const unsubscribe = api.onDisplayState((state) => {
      received = true;
      setDisplay(state);
    });
    api.displayState().then((state) => {
      if (active && !received) setDisplay(state);
    }).catch((error) => {
      if (active) setFatal(error.message);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.aspect = display.aspect;
  }, [display.aspect]);
  const [home, setHome] = useState(null),
    [welcome, setWelcome] = useState(false),
    [wizard, setWizard] = useState(null),
    [bindings, setBindings] = useState([]),
    [d, setD] = useState(null),
    [mode, setMode] = useState(null),
    [page, setPage] = useState("overview"),
    [initial, setInitial] = useState({});
  const [overviewLayout, setOverviewLayout] = useState(savedOverviewLayout);
  const changeOverviewLayout = value => {
    setOverviewLayout(value);
    try { localStorage.setItem(overviewLayoutKey, value); } catch {}
  };
  const [filters, setFilters] = useState(savedFilters),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [fatal, setFatal] = useState("");
  useLayoutEffect(() => {
    diagnosticScreen = !home ? "startup" : wizard ? "onboarding" : welcome || !d ? "welcome" : page;
  }, [home, wizard, welcome, d, page]);
  const opts = useRef(filters),
    seq = useRef(0),
    busyDepth = useRef(0);
  const refresh = useCallback(async (next = opts.current) => {
    const id = ++seq.current,
      output = await api.dashboard(dashboardQuery(next));
    if (id === seq.current) setD(output);
  }, []);
  const workspace = useCallback(async () => {
    const h = await api.home();
    setHome(h);
    if (h.storageError) setFatal(h.storageError);
    setMode(h.mode);
    if (!h.mode && !h.hasReal && !h.storageError && !h.onboardingSeen) setWizard("welcome");
    if (h.mode) {
      await refresh();
      setWelcome(false);
    } else setWelcome(true);
  }, [refresh]);
  useEffect(() => {
    workspace().catch((e) => {
      recordRendererFailure("async", e);
      setFatal(e.message);
    });
  }, [workspace]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 7000);
    return () => clearTimeout(timer);
  }, [message]);
  const run = useCallback(
    async (fn, success = true) => {
      busyDepth.current++;
      setBusy(true);
      try {
        const result = await fn();
        if (success !== false && (await api.home().then((h) => h.mode))) await refresh();
        if (typeof result === "string" && (success === true || success === false)) setMessage(result);
        else if (typeof success === "string") setMessage(success);
        return result;
      } catch (e) {
        recordRendererFailure("event", e);
        setFatal(String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
      } finally {
        busyDepth.current--;
        setBusy(busyDepth.current > 0);
      }
    },
    [refresh],
  );
  async function enter(method) {
    await run(async () => {
      await api[method]();
      // Another book starts on the default filters.
      opts.current = defaultFilters;
      setFilters(defaultFilters);
      saveFilters(defaultFilters);
      setInitial({});
      setPage("overview");
      await workspace();
    }, false);
  }
  function changeFilters(next) {
    if (JSON.stringify(next) === JSON.stringify(opts.current)) return;
    opts.current = next;
    setFilters(next);
    saveFilters(next);
    run(() => refresh(next), false);
  }
  function changeTheme(theme) {
    run(async () => {
      const saved = await api.setTheme({ theme });
      setHome((current) => ({ ...current, theme: saved }));
    }, false);
  }
  function changeLanguage(language) {
    run(async () => {
      const next = await api.setLanguage({ language });
      setHome((current) => ({ ...current, ...next }));
      return createTranslator(next.locale)("lang.saved");
    }, true);
  }
  function onPage(id, init = {}) {
    setPage(id);
    setInitial({ ...init });
    document.querySelector(".pane")?.scrollTo(0, 0);
  }
  async function showHome() {
    setHome(await api.home());
    setWelcome(true);
  }
  async function updateBindings() {
    const info = await api.connections();
    setBindings(info.bindings);
  }
  function openSetup() {
    run(async () => {
      if (mode === "real") await updateBindings();
      else setBindings([]);
      setWizard("broker");
    }, false);
  }
  async function closeSetup(account) {
    await api.leaveAccountSetup();
    await workspace();
    setWizard(null);
    if (account) onPage("imports", { broker: account.broker, account: account.id, sync: true });
  }
  const shown = useRef(page);
  shown.current = page;
  const reload = useCallback(() => refresh().catch(() => {}), [refresh]);
  // Closes, FX and index levels are fetched in the background; the page keeps what it shows meanwhile.
  // The check belongs to the open book, so moving between pages never drops a result on its way.
  useEffect(() => {
    if (mode !== "real" || welcome || wizard || !d) return;
    let active = true,
      checking = false,
      retry;
    const check = () => {
      clearTimeout(retry);
      if (document.visibilityState !== "visible") return;
      // Wait out an operation in progress instead of skipping until the next interval.
      if (busyDepth.current) return void (retry = setTimeout(check, 2000));
      if (checking) return;
      checking = true;
      api
        .autoRefresh({ market: true, funds: shown.current === "allocation" })
        .then((changed) => {
          if (active && changed && (!opts.current.date || shown.current === "settings")) reload();
        })
        .catch(() => {})
        .finally(() => { checking = false; });
    };
    const timer = setInterval(check, 20_000);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      active = false;
      clearTimeout(retry);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [mode, welcome, wizard, !!d, reload]);
  // Fund holdings are checked when the allocation page opens.
  useEffect(() => {
    if (mode !== "real" || welcome || !d || page !== "allocation") return;
    api
      .autoRefresh({ funds: true })
      .then((changed) => changed && reload())
      .catch(() => {});
  }, [page]);
  const active = d?.accounts.filter((a) => a.active) || [];
  const analysis = analysisPages.includes(page);
  const t = createTranslator(home?.locale || "zh-CN");
  const wrap = (node) => (
    <I18nProvider
      locale={home?.locale || "zh-CN"}
      languagePreference={home?.languagePreference || "system"}
      systemLocale={home?.systemLocale || "zh-CN"}
      changeLanguage={changeLanguage}
    >
      {node}
    </I18nProvider>
  );
  const banners = (
    <>
      {busy && (
        <div className="busy" role="status">
          <RefreshCw size={14} /> {t("app.busy")}
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          <span>{message}</span>
          <button type="button" className="icon" aria-label={t("app.close")} onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {fatal && (
        <Modal title={t("app.noticeTitle")} close={() => setFatal("")}>
          <p className="error-text">{fatal}</p>
          <div className="acts">
            <DiagnosticsButton screen={diagnosticScreen} />
            <button className="primary" onClick={() => setFatal("")}>{t("app.ok")}</button>
          </div>
        </Modal>
      )}
    </>
  );
  if (!home)
    return wrap(
      <div className="boot">
        <Mark /> {t("app.booting")}{banners}
      </div>,
    );
  if (wizard)
    return wrap(
      <>
        <AccountWizard initialPage={wizard} accounts={d?.accounts || []} existing={bindings}
          theme={home.theme} onTheme={changeTheme} onLeave={() => closeSetup()} onImport={closeSetup}
          onBound={() => run(async () => { await workspace(); await updateBindings(); }, false)} />
        {banners}
      </>,
    );
  if (welcome || !d)
    return wrap(
      <>
        <Welcome home={home} run={run} enter={enter} onSetup={openSetup} onClose={mode ? () => setWelcome(false) : null} />
        {banners}
      </>,
    );
  return wrap(
    <>
      <Shell
        aspect={display.aspect}
        page={page}
        onPage={onPage}
        ledger={{ demo: mode === "demo", accounts: active.length }}
        onLedger={showHome}
        titleExtra={analysis && <AsOf filters={filters} onChange={changeFilters} />}
        filters={
          analysis && (
            <>
              {page === "overview" && <OverviewLayoutPicker value={overviewLayout} onChange={changeOverviewLayout} />}
              <AccountScope filters={filters} accounts={active} selected={d.selected} onChange={changeFilters} />
              <ValuationDate filters={filters} value={d.date} onChange={changeFilters} />
            </>
          )
        }
      >
        {page === "performance" && (
          <Performance d={d} mode={mode} run={run} reload={reload} filters={filters} onFilters={changeFilters} onPage={onPage} />
        )}
        {page === "overview" && <Overview layout={overviewLayout} d={d} run={run} onPage={onPage} filters={filters} onFilters={changeFilters} />}
        {page === "overview" && mode === "real" && !active.length && (
          <button className="btn pri" onClick={openSetup}>{t("app.addBrokerAccount")}</button>
        )}
        {page === "holdings" && (
          <Holdings key={JSON.stringify(initial)} run={run} d={d} initial={initial} />
        )}
        {page === "macro" && <MacroAnalysis />}
        {page === "allocation" && (
          <Allocation d={d} run={run} onPage={onPage} />
        )}
        {page === "imports" && (
          <Imports
            key={JSON.stringify(initial)}
            d={d}
            mode={mode}
            run={run}
            initial={initial}
            onPage={onPage}
          />
        )}
        {page === "settings" && (
          <Settings
            key={JSON.stringify(initial)}
            d={d}
            mode={mode}
            appVersion={home.appVersion}
            theme={home.theme}
            onThemeChange={changeTheme}
            userScale={display.userScaleMultiplier}
            onUserScaleChange={(request) => run(() => api.setUserScale(request), false)}
            run={run}
            initial={initial}
            onPage={onPage}
            workspace={workspace}
            openHome={showHome}
            onSetup={openSetup}
          />
        )}
      </Shell>
      {banners}
    </>,
  );
}
window.addEventListener("error", (event) => recordRendererFailure("event", event.error));
window.addEventListener("unhandledrejection", (event) => recordRendererFailure("async", event.reason));
createRoot(document.getElementById("root")).render(<AppErrorBoundary><Application /></AppErrorBoundary>);
