import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, Layers3 } from "lucide-react";
import { Overview } from "@desktop/ui/Overview";
import { Holdings } from "@desktop/ui/Cockpit";
import { I18nProvider } from "@desktop/ui/i18n";
import { Modal, aud } from "@desktop/ui/common";
import { periodLabels } from "@desktop/ui/filters.js";
import { DailyGroups, dailyParts } from "./daily-groups";
import "@desktop/ui/design.css";
import "@desktop/ui/styles.css";
import "./comparison.css";

const root = document.getElementById("portfolio-overview-comparison");
const scopeNames = { all: "全部账户", ibkr: "IBKR", webull: "Webull Australia" };
const initial = saved => ({
  sample: ["b", "c"].includes(saved?.sample) ? saved.sample : "a",
  scope: Object.hasOwn(scopeNames, saved?.scope) ? saved.scope : "all",
  period: Object.hasOwn(periodLabels, saved?.period) ? saved.period : "ytd",
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
function Toolbar({ state, update, d }) {
  const [check, setCheck] = useState(false);
  return <div className="d02-body experiment-controls">
    <div className="d02-samples"><span>示例账本</span><div className="seg" role="group" aria-label="行情样本">{["a","b","c"].map(k=><button type="button" key={k} aria-pressed={state.sample===k} className={state.sample===k?"on":""} onClick={()=>update({sample:k})}>样本 {k.toUpperCase()}</button>)}</div></div>
    <button className="btn d02-check" onClick={()=>setCheck(true)}>核对第一眼判断 <ChevronRight size={14}/></button>
    {check && <FirstLook d={d} close={()=>setCheck(false)} />}
  </div>;
}
// The current overview owns every KPI, chart, table and drill-down in all three views.
function OverviewPage({ d, mode, filters, onFilters, onPage, run }) {
  const rootRef = useRef(null);
  const descriptionId = useId();
  const [targets, setTargets] = useState(null);
  const coverage = valuation(d);
  const showSubtotal = mode !== "current" && !coverage.complete;
  const daily = mode === "balance";

  useLayoutEffect(() => {
    const page = rootRef.current;
    const layout = page.querySelector(".overview-layout");
    setTargets({
      total: page.querySelector(".overview-total"),
      layout, parts: daily ? dailyParts(layout) : null,
    });
  }, [daily]);

  useLayoutEffect(() => {
    if (!showSubtotal || !targets) return;
    const button = targets.total;
    const previous = button.getAttribute("aria-describedby");
    button.setAttribute("aria-describedby", [previous, descriptionId].filter(Boolean).join(" "));
    return () => {
      if (previous) button.setAttribute("aria-describedby", previous);
      else button.removeAttribute("aria-describedby");
    };
  }, [showSubtotal, targets, descriptionId]);

  return <div ref={rootRef} data-reading={mode}>
    <Overview d={d} filters={filters} onFilters={onFilters} onPage={onPage} run={run}/>
    {showSubtotal && targets && createPortal(
      <span id={descriptionId} className="d02-subtotal">可估值小计 {money(coverage.amount)} · {coverage.missing.join("、")} 缺报价</span>, targets.total
    )}
    {daily && targets && createPortal(<DailyGroups d={d} parts={targets.parts}/>, targets.layout)}
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
  return <><Toolbar state={state} update={update} d={d}/>
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
        <OverviewPage d={d} mode={mode} filters={filters} onFilters={f => update({period:f.period})} onPage={navigate} run={readOnly}/>
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
