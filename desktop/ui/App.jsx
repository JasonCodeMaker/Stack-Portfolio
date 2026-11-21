import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChartPie,
  CheckCircle2,
  ChevronDown,
  Database,
  FolderInput,
  Layers3,
  LayoutDashboard,
  PanelLeft,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Wallet,
  Waypoints,
  X,
} from "lucide-react";
import { api, Card, Modal, Tabs, Field } from "./common";
import { Overview, Holdings } from "./Cockpit";
import { Imports } from "./Imports";
import { Allocation } from "./Allocation";
import { Settings } from "./Settings";
import "./styles.css";
const pages = {
  overview: ["总览", LayoutDashboard],
  holdings: ["持仓", BriefcaseBusiness],
  allocation: ["配置分析", ChartPie],
  imports: ["导入与对账", FolderInput],
  settings: ["数据与设置", Settings2],
};
function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
function Welcome({ home, run, enter, onClose }) {
  const [preview, setPreview] = useState(null),
    [source, setSource] = useState(home.sources[0]?.id ?? "file");
  async function migrate() {
    await run(async () => {
      const s = await api.migrationPreview({ source: source === "file" ? null : Number(source) });
      if (s) setPreview(s);
    }, false);
  }
  return (
    <div className="welcome">
      <header>
        <Mark />
        <strong>Stack Portfolio</strong>
      </header>
      <main>
        <div className="intro">
          <div className="intro-icon">
            <Layers3 size={35} />
          </div>
          <h1>打开投资账本</h1>
          <p>在本机管理持仓、资金流水和资产配置。</p>
        </div>
        <div className="welcome-cards">
          <section className="welcome-main">
            <Database size={24} />
            <h2>{home.hasReal ? "正式账本" : "迁入 Wealthfolio 账本"}</h2>
            {home.hasReal ? (
              <>
                <p>继续查看已保存的投资记录、配置目标和对账结果。</p>
                <button className="primary" onClick={() => enter("openReal")}>
                  打开正式账本 <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <p>带入账户、交易历史、手工更正、ETF 数据及配置设置。可在迁入前核对记录数。</p>
                <label className="field">
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
                <button className="primary" onClick={migrate}>
                  预览迁移 <ArrowRight size={16} />
                </button>
              </>
            )}
          </section>
          <section>
            <ChartNoAxesCombined size={24} />
            <h2>示例组合</h2>
            <p>用 IBKR 和 Webull 的虚构记录试用总览、持仓、ETF 穿透和月结对账。</p>
            <button onClick={() => enter("openDemo")}>
              打开示例账本 <ArrowUpRight size={15} />
            </button>
          </section>
        </div>
        <div className="welcome-foot">
          {!home.hasReal && (
            <button className="text-btn" onClick={() => enter("newBook")}>
              建立空白账本
            </button>
          )}
          <button
            className="text-btn"
            onClick={() =>
              run(async () => {
                const restored = await api.restore();
                if (restored) await enter(restored === "demo" ? "openDemo" : "openReal");
              }, false)
            }
          >
            从 Stack Portfolio 备份恢复
          </button>
          {onClose && (
            <button className="text-btn" onClick={onClose}>
              返回当前账本
            </button>
          )}
        </div>
        {preview && (
          <Modal title="确认迁入旧账本和设置" close={() => setPreview(null)}>
            <p>{preview.name} · 迁入后由 Stack Portfolio 独立保存和更新。</p>
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
            <p className="muted">迁入完成后，请在「数据与设置」中重新连接券商。</p>
            <button
              className="primary"
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
  );
}
function Application() {
  const [home, setHome] = useState(null),
    [welcome, setWelcome] = useState(false),
    [d, setD] = useState(null),
    [mode, setMode] = useState(null),
    [page, setPage] = useState("overview"),
    [initial, setInitial] = useState({});
  const [options, setOptions] = useState({ ids: undefined, period: "1m", date: "" }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [scope, setScope] = useState(null),
    [fatal, setFatal] = useState("");
  const opts = useRef(options),
    seq = useRef(0),
    busyDepth = useRef(0);
  const refresh = useCallback(async (newOptions = opts.current) => {
    const id = ++seq.current,
      output = await api.dashboard(newOptions);
    if (id === seq.current) setD(output);
  }, []);
  const workspace = useCallback(async () => {
    const h = await api.home();
    setHome(h);
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
      const next = { period: "1m", date: "", ids: undefined };
      opts.current = next;
      setOptions(next);
      setInitial({});
      setPage("overview");
      await workspace();
    }, false);
  }
  function change(patch) {
    const next = { ...opts.current, ...patch };
    opts.current = next;
    setOptions(next);
    run(() => refresh(next), false);
  }
  function onPage(id, init = {}) {
    setPage(id);
    setInitial({ ...init });
    document.querySelector(".workspace")?.scrollTo(0, 0);
  }
  async function showHome() {
    setHome(await api.home());
    setWelcome(true);
  }
  useEffect(() => {
    if (mode !== "real" || welcome || !d || (!d.settings.liveFxPolling && page !== "allocation")) return;
    let active = true;
    const check = () => {
      if (document.visibilityState === "visible" && !busyDepth.current)
        api
          .autoRefresh({ fx: d.settings.liveFxPolling, funds: page === "allocation" })
          .then((changed) => {
            if (active && changed) refresh().catch(() => {});
          })
          .catch(() => {});
    };
    const timer = setInterval(check, 300000);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [mode, welcome, page, !!d?.settings.liveFxPolling, refresh]);
  const active = d?.accounts.filter((a) => a.active) || [],
    accountLabel = !d
      ? ""
      : d.selected.length === active.length
        ? "全部账户"
        : d.selected.length === 1
          ? active.find((a) => a.id === d.selected[0])?.name
          : "自选账户";
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
        <Mark /> 正在打开 Stack Portfolio…{banners}
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
    <div className="shell">
      <aside>
        <div className="brand">
          <Mark />
          <div>
            Stack<span>Portfolio</span>
          </div>
        </div>
        <nav>
          {Object.entries(pages).map(([k, [label, Icon]]) => (
            <button className={page === k ? "selected" : ""} key={k} onClick={() => onPage(k)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <button className="sidebar-account" onClick={showHome}>
          <span className="app-avatar">
            <Database size={16} />
          </span>
          <span>
            {mode === "demo" ? "示例账本" : "本地账本"}
            <small>Stack Portfolio</small>
          </span>
          <ChevronDown size={14} />
        </button>
      </aside>
      <main className="workspace">
        <div className="content">
          <header className="page-head">
            <div>
              <p className="crumb">
                Stack Portfolio <span>/</span> 投资账本
              </p>
              <h1>{pages[page][0]}</h1>
            </div>
            <div className="header-tools">
              <button onClick={() => setScope([...d.selected])}>
                <Wallet size={15} />
                {accountLabel}
                <ChevronDown size={13} />
              </button>
              <label className="date-filter">
                <input
                  aria-label="估值日期"
                  type="date"
                  value={options.date || d.date}
                  onChange={(e) => change({ date: e.target.value })}
                />
              </label>
            </div>
          </header>
          {page === "overview" && (
            <Overview
              d={d}
              options={options}
              change={change}
              onPage={onPage}
              setScope={(ids) => change({ ids })}
            />
          )}
          {page === "holdings" && (
            <Holdings key={JSON.stringify(initial)} d={d} initial={initial} onPage={onPage} />
          )}
          {page === "allocation" && (
            <Allocation key={JSON.stringify(initial)} d={d} run={run} initial={initial} />
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
              run={run}
              initial={initial}
              workspace={workspace}
              openHome={showHome}
            />
          )}
          <footer>
            <span className="dot" />
            {mode === "demo" ? "示例数据" : "本机账本"}
            <span>·</span> 汇总币种 AUD
          </footer>
        </div>
      </main>
      {scope && (
        <Modal title="账户范围" close={() => setScope(null)}>
          {active.map((a) => (
            <label className="check" key={a.id}>
              <input
                type="checkbox"
                checked={scope.includes(a.id)}
                onChange={(ev) =>
                  setScope(ev.target.checked ? [...scope, a.id] : scope.filter((id) => id !== a.id))
                }
              />
              {a.name}
            </label>
          ))}
          <div className="actions">
            <button onClick={() => setScope(active.map((a) => a.id))}>全选</button>
            <button
              className="primary"
              disabled={!scope.length}
              onClick={() =>
                run(async () => {
                  await api.allocationSettings({
                    ...d.settings,
                    selectionInitialized: true,
                    selectedAccountIds: scope,
                    acknowledgedAccountIds: active.map((a) => a.id),
                  });
                  const next = { ...opts.current, ids: scope };
                  opts.current = next;
                  setOptions(next);
                  setScope(null);
                  await refresh(next);
                }, false)
              }
            >
              应用到组合
            </button>
          </div>
        </Modal>
      )}
      {banners}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Application />);
