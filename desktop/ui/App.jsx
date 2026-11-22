import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Database,
  RefreshCw,
  X,
} from "lucide-react";
import { api, Modal } from "./common";
import { Mark, Shell } from "./Shell";
import { Overview, Holdings } from "./Cockpit";
import { Performance } from "./Performance";
import { Imports } from "./Imports";
import { Allocation } from "./Allocation";
import { Settings } from "./Settings";
import { BookBackups } from "./BookBackups";
import { AccountScope, AsOf, ValuationDate } from "./FilterControls";
import { dashboardQuery, defaultFilters, rememberedFilters, restoreFilters } from "./filters.js";
import "./design.css";
import "./styles.css";
import "./settings.css";
function Welcome({ home, run, enter, onClose }) {
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
        Stock Portfolio
      </header>
      <main>
        <div className="intro">
          <h1>打开投资账本</h1>
          <p>在本机管理持仓、资金流水和资产配置。</p>
        </div>
        <div className="wc">
          <section className="card hero" aria-label={home.hasReal ? "正式账本" : "迁入 Wealthfolio 账本"}>
            <Database size={24} strokeWidth={1.8} />
            <h2>{home.hasReal ? "正式账本" : "迁入 Wealthfolio 账本"}</h2>
            {home.hasReal ? (
              <>
                <p>继续查看已保存的投资记录、配置目标和对账结果。</p>
                <button className="btn" onClick={() => enter("openReal")}>
                  打开正式账本 →
                </button>
              </>
            ) : (
              <>
                <p>带入账户、交易历史、手工更正、ETF 数据及配置设置。可在迁入前核对记录数。</p>
                <label className="f">
                  <span>数据来源</span>
                  <select
                    aria-label="迁移数据来源"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    {home.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        本机 Wealthfolio · {s.label}
                      </option>
                    ))}
                    <option value="file">选择其他账本或 .db 备份…</option>
                  </select>
                </label>
                <button className="btn" onClick={migrate}>
                  预览迁移 →
                </button>
              </>
            )}
          </section>
          <section className="card" aria-label="示例组合">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3v18h18" />
              <path d="m7 15 4-5 3 3 5-7" />
            </svg>
            <h2>
              示例组合 <span className="demo">示例</span>
            </h2>
            <p>用 IBKR 和 Webull 的虚构记录试用总览、持仓、ETF 穿透和月结对账。</p>
            <button className="btn" onClick={() => enter("openDemo")}>
              打开示例账本 ↗
            </button>
          </section>
        </div>
        <div className="wf">
          {!home.hasReal && (
            <button className="lnk" onClick={() => enter("newBook")}>
              建立空白账本
            </button>
          )}
          <BookBackups welcome run={run} restored={(m) => enter(m === "demo" ? "openDemo" : "openReal")} />
          {onClose && (
            <button className="lnk" onClick={onClose}>
              返回当前账本
            </button>
          )}
        </div>
        {preview && (
          <Modal title="确认迁入旧账本和设置" close={() => setPreview(null)}>
            <p>{preview.name} · 迁入后由 Stock Portfolio 独立保存和更新。</p>
            <dl>
              {Object.entries({
                accounts: "账户",
                activities: "交易及资金流水",
                assets: "资产档案",
                snapshots: "持仓快照",
                valuations: "历史估值",
                quotes: "历史报价",
                allocation: "配置设置与 ETF 数据",
                broker: "同步设置及去重记录",
              }).map(([k, l]) => (
                <React.Fragment key={k}>
                  <dt>{l}</dt>
                  <dd>{preview.counts[k]}</dd>
                </React.Fragment>
              ))}
            </dl>
            {(!preview.counts.allocation || !preview.counts.broker) && (
              <p className="warning">这份源文件中有一项功能没有保存设置，可以改选原始账本再预览。</p>
            )}
            {preview.counts.invalidFunds > 0 && (
              <p className="warning">
                有 {preview.counts.invalidFunds} 份基金成分表缺少有效数据，可选择另一份备份或在迁入后补齐。
              </p>
            )}
            <p className="muted">迁入完成后，请在「设置」中重新连接券商。</p>
            <button
              className="btn pri"
              onClick={() =>
                run(async () => {
                  await api.migrationCommit({ token: preview.token });
                  setPreview(null);
                  await enter("openReal");
                }, "迁移已完成")
              }
            >
              确认迁入并打开
            </button>
          </Modal>
        )}
      </main>
      </div>
    </div>
  );
}
// The account scope and period are remembered across restarts (spec §2.3); storage may be unavailable.
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
  const [home, setHome] = useState(null),
    [welcome, setWelcome] = useState(false),
    [d, setD] = useState(null),
    [mode, setMode] = useState(null),
    [page, setPage] = useState("overview"),
    [initial, setInitial] = useState({});
  const [filters, setFilters] = useState(savedFilters),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [fatal, setFatal] = useState("");
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
    if (h.mode) {
      await refresh();
      setWelcome(false);
    } else setWelcome(true);
  }, [refresh]);
  useEffect(() => {
    workspace().catch((e) => setFatal(e.message));
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
  function onPage(id, init = {}) {
    setPage(id);
    setInitial({ ...init });
    document.querySelector(".pane")?.scrollTo(0, 0);
  }
  async function showHome() {
    setHome(await api.home());
    setWelcome(true);
  }
  const shown = useRef(page);
  shown.current = page;
  const reload = useCallback(() => refresh().catch(() => {}), [refresh]);
  // Closes, FX and index levels are fetched in the background; the page keeps what it shows meanwhile.
  // The check belongs to the open book, so moving between pages never drops a result on its way.
  useEffect(() => {
    if (mode !== "real" || welcome || !d) return;
    let active = true,
      retry;
    const check = () => {
      clearTimeout(retry);
      if (document.visibilityState !== "visible") return;
      // Wait out an operation in progress instead of skipping until the next interval.
      if (busyDepth.current) return void (retry = setTimeout(check, 2000));
      api
        .autoRefresh({ market: true, fx: d.settings.liveFxPolling, funds: shown.current === "allocation" })
        .then((changed) => {
          if (active && changed) reload();
        })
        .catch(() => {});
    };
    const timer = setInterval(check, 300000);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      active = false;
      clearTimeout(retry);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [mode, welcome, !!d, !!d?.settings.liveFxPolling, reload]);
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
  const banners = (
    <>
      {busy && (
        <div className="busy" role="status">
          <RefreshCw size={14} /> 正在处理…
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {message}
          <button className="icon" onClick={() => setMessage("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {fatal && (
        <Modal title="操作提示" close={() => setFatal("")}>
          <p className="error-text">{fatal}</p>
          <button className="primary" onClick={() => setFatal("")}>
            知道了
          </button>
        </Modal>
      )}
    </>
  );
  if (!home)
    return (
      <div className="boot">
        <Mark /> 正在打开 Stock Portfolio…{banners}
      </div>
    );
  if (welcome || !d)
    return (
      <>
        <Welcome home={home} run={run} enter={enter} onClose={mode ? () => setWelcome(false) : null} />
        {banners}
      </>
    );
  return (
    <>
      <Shell
        page={page}
        onPage={onPage}
        ledger={{ demo: mode === "demo", accounts: active.length }}
        onLedger={showHome}
        titleExtra={analysis && <AsOf filters={filters} onChange={changeFilters} />}
        filters={
          analysis && (
            <>
              <AccountScope filters={filters} accounts={active} selected={d.selected} onChange={changeFilters} />
              <ValuationDate filters={filters} value={d.date} onChange={changeFilters} />
            </>
          )
        }
      >
        {page === "performance" && (
          <Performance d={d} mode={mode} run={run} reload={reload} filters={filters} onFilters={changeFilters} onPage={onPage} />
        )}
        {page === "overview" && <Overview d={d} run={run} onPage={onPage} filters={filters} onFilters={changeFilters} />}
        {page === "holdings" && (
          <Holdings key={JSON.stringify(initial)} run={run} d={d} initial={initial} historical={Boolean(filters.date)} />
        )}
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
            theme={home.theme}
            onThemeChange={changeTheme}
            run={run}
            initial={initial}
            onPage={onPage}
            workspace={workspace}
            openHome={showHome}
          />
        )}
      </Shell>
      {banners}
    </>
  );
}
createRoot(document.getElementById("root")).render(<Application />);
