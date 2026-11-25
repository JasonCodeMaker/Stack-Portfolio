import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, Layers3 } from "lucide-react";
import { Overview } from "@desktop/ui/Overview";
import { Holdings } from "@desktop/ui/Cockpit";
import { I18nProvider } from "@desktop/ui/i18n";
import { Modal, aud } from "@desktop/ui/common";
import { periodLabels } from "@desktop/ui/filters.js";
import { CashLine, closeDrivers, CompanyExposure, DriverLine } from "./asset-information";
import "@desktop/ui/design.css";
import "@desktop/ui/styles.css";
import "./comparison.css";

const root = document.getElementById("portfolio-overview-comparison");
const scopeNames = { all: "全部账户", ibkr: "IBKR", webull: "Webull Australia" };
const initial = saved => ({
  sample: ["b", "c"].includes(saved?.sample) ? saved.sample : "a",
  scope: Object.hasOwn(scopeNames, saved?.scope) ? saved.scope : "all",
  period: Object.hasOwn(periodLabels, saved?.period) ? saved.period : "ytd",
  cash: saved?.cash !== false,
  drivers: saved?.drivers === true,
});
const money = v => v == null ? "待估值" : aud(v, 2);
function valuation(data) {
  const rows = data.rows.filter(row => row.type !== "cash");
  const missing = rows.filter(row => row.audValue == null).map(row => row.ticker);
  const fullTotal = data.valuation.total;
  const subtotal = rows.reduce((sum, row) => sum + (row.audValue ?? 0), data.valuation.cash ?? 0);
  return { complete: fullTotal != null, amount: fullTotal ?? subtotal, missing };
}

function FirstLook({ d, close }) {
  const [choice, choose] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState(null);
  const v = valuation(d);
  function check(e) {
    e.preventDefault();
    const clean = amount.trim().replace(/[,$\s]/g, "").replace(/^A/i, "");
    const valid = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(clean);
    const matches = valid && Math.abs(Number(clean) - v.amount) < .005;
    const correct = choice === (v.complete ? "total" : "partial") && (matches || (!v.complete && !clean));
    setResult({ correct });
  }
  return <Modal title="核对第一眼的判断" close={close}><form className="d02-test" onSubmit={check}>
    <fieldset><legend>能确定所选账户的完整总额吗？</legend>
      {[["total","能确定总额"],["partial","只能确定部分金额"]].map(([id,label])=><label key={id}><input type="radio" name="answer" required value={id} checked={choice===id} onChange={()=>{choose(id);setResult(null)}}/>{label}</label>)}
    </fieldset>
    <label>{choice==="partial" ? "你读到的小计（选填，AUD）" : "你读到的账户总额（AUD）"}<input type="text" inputMode="decimal" required={choice==="total"} value={amount} placeholder="输入金额" onChange={e=>{setAmount(e.target.value);setResult(null)}}/></label>
    <button className="btn pri" type="submit">核对答案</button>
    {result && <p role="status" className="d02-outcome"><b>{result.correct ? "判断正确。" : "再对照一下。"}</b>{v.complete ? "账户总额为 " + money(v.amount) + "。" : "完整总额未知。已计入现金与可定价持仓的小计为 " + money(v.amount) + "，" + v.missing.join("、") + " 缺少报价。"}</p>}
  </form></Modal>;
}
function Toolbar({ state, update, d, daily }) {
  const [check, setCheck] = useState(false);
  return <div className="d02-body experiment-controls">
    <div className="d02-samples"><span>示例账本</span><div className="seg" role="group" aria-label="行情样本">{["a","b","c"].map(k=><button type="button" key={k} aria-pressed={state.sample===k} className={state.sample===k?"on":""} onClick={()=>update({sample:k})}>样本 {k.toUpperCase()}</button>)}</div></div>
    {daily && <div className="d02-study-options" role="group" aria-label="原型对照选项">
      <label><input type="checkbox" checked={state.cash} onChange={e => update({cash:e.target.checked})}/> 显示现金</label>
      <label><input type="checkbox" checked={state.drivers} onChange={e => update({drivers:e.target.checked})}/> 解释收盘变动</label>
    </div>}
    <button className="btn d02-check" onClick={()=>setCheck(true)}>核对第一眼判断 <ChevronRight size={14}/></button>
    {check && <FirstLook d={d} close={()=>setCheck(false)} />}
  </div>;
}
// The current overview owns every KPI, chart, table and drill-down in all three views.
function OverviewPage({ d, mode, state, filters, onFilters, onPage, run }) {
  const rootRef = useRef(null);
  const descriptionId = useId();
  const [totalButton, setTotalButton] = useState(null);
  const [holdingsHeader, setHoldingsHeader] = useState(null);
  const [showCompany, setShowCompany] = useState(false);
  const coverage = valuation(d);
  const showSubtotal = mode !== "current" && !coverage.complete;
  const daily = mode === "balance";
  const showCash = daily && state.cash;
  const drivers = daily && state.drivers ? closeDrivers(d.today) : [];
  const describeTotal = showSubtotal || showCash || drivers.length > 0;

  useLayoutEffect(() => {
    if (daily) setHoldingsHeader(rootRef.current.querySelector(".top-holdings > .row"));
  }, [daily]);

  useLayoutEffect(() => {
    if (!describeTotal) return;
    const button = rootRef.current.querySelector(".overview-total");
    const previous = button.getAttribute("aria-describedby");
    button.setAttribute("aria-describedby", [previous, descriptionId].filter(Boolean).join(" "));
    setTotalButton(button);
    return () => {
      if (previous) button.setAttribute("aria-describedby", previous);
      else button.removeAttribute("aria-describedby");
    };
  }, [describeTotal, descriptionId]);

  return <div ref={rootRef} data-reading={mode}>
    <Overview d={d} filters={filters} onFilters={onFilters} onPage={onPage} run={run}/>
    {describeTotal && totalButton && createPortal(
      <span id={descriptionId} className="d02-total-notes">
        {showSubtotal && <span className="d02-subtotal">可估值小计 {money(coverage.amount)} · {coverage.missing.join("、")} 缺报价</span>}
        {showCash && <CashLine valuation={d.valuation}/>}
        {drivers.length > 0 && <DriverLine drivers={drivers}/>}
      </span>, totalButton
    )}
    {holdingsHeader && createPortal(
      <button className="overview-all" type="button" onClick={() => setShowCompany(true)}>公司敞口 ›</button>, holdingsHeader
    )}
    {showCompany && <CompanyExposure d={d} scope={scopeNames[state.scope]} close={() => setShowCompany(false)}/>}
  </div>;
}

function Screen({ mode, d, state, update }) {
  const [holdings, setHoldings] = useState(null);
  const [readOnlyNotice, setReadOnlyNotice] = useState(false);
  const scrollRef = useRef(null);
  const savedOverviewOffset = useRef(0);
  const filters = { ids: state.scope === "all" ? null : d.selected, period: state.period, date: "", from: null, to: null };
  function navigate(page, selection) {
    if (page === "holdings") {
      savedOverviewOffset.current = scrollRef.current.scrollTop;
      setHoldings(selection || {});
    }
  }
  useLayoutEffect(() => {
    scrollRef.current.scrollTop = holdings ? 0 : savedOverviewOffset.current;
  }, [holdings]);
  function readOnly() {
    setReadOnlyNotice(true);
    return false;
  }
  return <><Toolbar state={state} update={update} d={d} daily={mode === "balance" && !holdings}/>
  <div className="d02-body d02-window" data-aspect="16:9">
    <header className="d02-top">
      <div className="d02-title"><span className="d02-mark"><Layers3 size={19}/></span>
        <span><small>Stock Portfolio</small><b>{holdings ? "持仓" : "总览"}</b></span>
      </div>
      <div className="d02-header-actions">
        {holdings && <button className="btn" onClick={() => setHoldings(null)}><ArrowLeft size={14}/> 返回总览</button>}
        <select aria-label="账户范围" value={state.scope} onChange={e => update({scope:e.target.value})}>
          {Object.entries(scopeNames).map(([key,name]) => <option key={key} value={key}>{name}</option>)}
        </select>
        <time dateTime={d.date}>{d.date} · AUD</time>
      </div>
    </header>
    <div className="d02-scroll" ref={scrollRef}><div className="d02-page">
      <div hidden={Boolean(holdings)}>
        <OverviewPage d={d} mode={mode} state={state} filters={filters} onFilters={f => update({period:f.period})} onPage={navigate} run={readOnly}/>
      </div>
      {holdings && <Holdings d={d} initial={holdings} run={readOnly}/>}
    </div></div>
    {readOnlyNotice && <Modal title="只读示例账本" close={() => setReadOnlyNotice(false)}>
      <p>三个布局共用固定的账本快照，本次编辑仅供预览。</p>
    </Modal>}
  </div></>;
}
function mount(host) {
  const tree=host.attachShadow({mode:"open"});
  const style=document.createElement("style");
  style.textContent=D02_STYLE;
  const node=document.createElement("div");
  tree.append(style,node);
  return node;
}
async function start() {
  const bytes=Uint8Array.from(atob(JSON.parse(document.getElementById("overview-fixture").textContent)),c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const fixtures=await new Response(stream).json();
  const controls=root.querySelector("#overview-controls");
  const views=[...root.querySelectorAll("[data-screen]")].map(host=>({mode:host.dataset.screen,node:mount(host)}));
  function Comparison() {
    const [state,setState]=useState(()=>initial(window.openai?.widgetState?.modelContent));
    useEffect(()=>{
      const listen=e=>{const saved=e.detail?.globals?.widgetState;if(saved) setState(initial(saved.modelContent));};
      window.addEventListener("openai:set_globals",listen);
      return ()=>window.removeEventListener("openai:set_globals",listen);
    },[]);
    const update=patch=>{const next=initial({...state,...patch});setState(next);window.openai?.setWidgetState?.({modelContent:next,privateContent:null})?.catch(()=>{});};
    const d=fixtures[[state.sample,state.scope,state.period].join("/")];
    return <I18nProvider locale="zh-CN">
      {views.map(({mode,node})=>createPortal(<Screen key={state.sample+"/"+state.scope} mode={mode} d={d} state={state} update={update}/>,node,mode))}
    </I18nProvider>;
  }
  createRoot(controls).render(<Comparison/>);
}
start().catch(()=>{root.textContent="无法加载示例账本，请使用新版浏览器重新打开。";});
