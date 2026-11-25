import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Activity, ArrowUpRight, Check, ChevronRight, CircleAlert, Layers3, Wallet } from "lucide-react";
import { Overview } from "@desktop/ui/Overview";
import { PeriodControl } from "@desktop/ui/FilterControls";
import { FxPanel } from "@desktop/ui/MarketQuotes";
import { I18nProvider } from "@desktop/ui/i18n";
import { LineChart } from "@desktop/ui/charts";
import { Modal, aud, signedAud, signedPct } from "@desktop/ui/common";
import { periodLabels } from "@desktop/ui/filters.js";
import "@desktop/ui/design.css";
import "@desktop/ui/styles.css";
import "./comparison.css";

const root = document.getElementById("portfolio-overview-comparison");
const scopeNames = { all: "全部账户", ibkr: "IBKR", webull: "Webull Australia" };
const defaults = { sample: "a", scope: "all", period: "ytd" };
const initial = saved => ({
  sample: saved?.sample === "b" ? "b" : "a",
  scope: Object.hasOwn(scopeNames, saved?.scope) ? saved.scope : "all",
  period: Object.hasOwn(periodLabels, saved?.period) ? saved.period : "ytd",
});
const money = v => v == null ? "待估值" : aud(v, 2);
const sign = v => v == null ? "待计算" : signedAud(v);
const tone = v => v == null || v === 0 ? "" : v > 0 ? "up" : "down";
const securities = d => d.rows.filter(r => r.type !== "cash");
function valuation(data) {
  const rows = securities(data);
  const unpriced = rows.filter(r => r.audValue == null);
  const total = data.valuation.total;
  // Historical demo balances use reconstructed cash. Count it once even when a security is unpriced.
  const subtotal = rows.reduce((sum, r) => sum + (r.audValue ?? 0), data.valuation.cash ?? 0);
  return { complete: total != null, amount: total ?? subtotal, rows, unpriced };
}
function Status({ v }) {
  const Icon = v.complete ? Check : CircleAlert;
  return <span className={"d02-status " + (v.complete ? "ok" : "partial")}><Icon size={14} aria-hidden="true" />{v.complete ? "估值完整" : "估值不完整"}</span>;
}
function NumberLine({ label, value, signed, strong }) {
  return <div className={"d02-line" + (strong ? " strong" : "")}><span>{label}</span><b className={signed ? tone(value) : ""}>{signed ? sign(value) : money(value)}</b></div>;
}
function Coverage({ d }) {
  const v = valuation(d);
  return <div className="coverage"><Status v={v} /><p>{v.complete ? "所选账户的持仓和现金均已计入。" : v.unpriced.map(r => r.ticker).join("、") + " 缺少可用报价，完整总额暂时未知。"}</p>
    <table><thead><tr><th>持仓 / 现金</th><th>数量</th><th>计入金额（AUD）</th></tr></thead><tbody>
      {v.rows.map(r => <tr key={r.id}><th>{r.ticker}</th><td>{r.rawQuantity}</td><td>{r.audValue == null ? "缺报价 · 未计入" : money(r.audValue)}</td></tr>)}
      <tr><th>现金（折合 AUD）</th><td>—</td><td>{money(d.valuation.cash)}</td></tr>
    </tbody></table>
    <NumberLine label={v.complete ? "账户总额" : "可估值小计"} value={v.amount} strong />
    {v.rows.some(r => r.costAud == null) && <p className="d02-note">BHP 缺少成本记录，持仓盈亏待补。有可用报价时，市值仍计入估值。</p>}
  </div>;
}
function PeriodDetail({ d }) {
  const p = d.summary;
  return <div className="coverage"><p>{p?.period.from ?? d.start ?? "—"} 至 {p?.period.to ?? d.date} · 澳元</p>
    <NumberLine label="期初估值" value={p?.startValue} /><NumberLine label="期末估值" value={p?.endValue} />
    <NumberLine label="期间净外部资金流" value={p?.netFlow} signed />
    <NumberLine label="期间投资盈亏" value={p?.gain} signed strong />
    <p className="d02-note">{p?.gain == null ? "选中期间缺少完整估值，无法确认投资盈亏。" : "期末估值减去期初估值和期间净外部资金流，得到期间投资盈亏。"}</p>
    {d.breakdown?.items?.map(i => <NumberLine key={i.key} label={i.label} value={i.value} signed />)}
  </div>;
}
function Inspect({ d, kind, close }) {
  if (kind === "fx") return <FxPanel fx={d.fx} periodGain={d.breakdown?.parts.fx} close={close}/>;
  return <Modal title={kind === "period" ? "期间盈亏明细" : "估值明细"} close={close} wide>
    {kind === "period" ? <PeriodDetail d={d}/> : <Coverage d={d}/>}
  </Modal>;
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
    {result && <p role="status" className="d02-outcome"><b>{result.correct ? "判断正确。" : "再对照一下。"}</b>{v.complete ? "账户总额为 " + money(v.amount) + "，估值完整。" : "完整总额未知。已计入现金与可定价持仓的小计为 " + money(v.amount) + "；BHP 缺少报价。"}</p>}
  </form></Modal>;
}
function Toolbar({ state, update, d }) {
  const [check, setCheck] = useState(false);
  return <div className="d02-body experiment-controls">
    <div className="d02-samples"><span>示例账本</span><div className="seg" role="group" aria-label="行情样本">{["a","b"].map(k=><button type="button" key={k} aria-pressed={state.sample===k} className={state.sample===k?"on":""} onClick={()=>update({sample:k})}>样本 {k.toUpperCase()}</button>)}</div></div>
    <button className="btn d02-check" onClick={()=>setCheck(true)}>核对第一眼判断 <ChevronRight size={14}/></button>
    {check && <FirstLook d={d} close={()=>setCheck(false)} />}
  </div>;
}
function Balance({ d, state, inspect, hero }) {
  const v=valuation(d);
  return <section className={"d02-balance "+(hero?"d02-hero":"d02-secondary")}>
    <div className="d02-heading"><span><Wallet size={16}/> {v.complete?"账户总额":"可估值小计"}</span><Status v={v}/></div>
    <div className="d02-number" data-money="valuation">{money(v.amount)}</div>
    <div className="d02-caption">{scopeNames[state.scope]} · 截至 {d.date}</div>
    <div className="d02-footer"><span>{v.complete && d.today?.change != null
      ? "收盘变动 " + signedAud(d.today.change) + " · " + d.today.previous.slice(5) + " 至 " + d.today.date.slice(5)
      : v.complete ? "全部持仓与现金已计入" : "BHP 缺报价 · 完整总额未知"}</span><button type="button" onClick={()=>inspect("value")}>查看构成 <ChevronRight size={14}/></button></div>
  </section>;
}
function Gain({ d, state, inspect, hero }) {
  const p=d.summary;
  return <section className={"d02-gain "+(hero?"d02-hero":"d02-secondary")}>
    <div className="d02-heading"><span><Activity size={16}/> {periodLabels[state.period]}投资盈亏</span></div>
    <div className="d02-number" data-money="gain">{sign(p?.gain)}</div>
    <div className="d02-caption">{p?.period.from??d.start??"—"} 至 {p?.period.to??d.date}</div>
    <div className="d02-footer"><span>{p?.twr==null?"完整期间收益待计算":"时间加权收益率 "+signedPct(p.twr)}</span><button type="button" onClick={()=>inspect("period")}>查看归因 <ChevronRight size={14}/></button></div>
  </section>;
}
function AccountBreakdown({ d, update }) {
  return <section className="d02-account-summary"><div className="d02-h2"><h2>账户构成</h2><span>AUD</span></div>
  {d.byAccount.map(a=>{const v=valuation(a);return <button className="d02-account" key={a.id} onClick={()=>update({scope:a.id.replace("demo-","")})}>
    <span><b>{a.name}</b><small>{v.complete?"账户总额":"可估值小计"}</small></span><span><b>{money(v.amount)}</b><ChevronRight size={13}/></span>
  </button>})}</section>;
}
function CashBridge({ d, inspect }) {
  return <section className="d02-cash"><div className="d02-h2"><h2>资产变动来源</h2><span>AUD</span></div><NumberLine label="期间净外部资金流" value={d.summary?.netFlow} signed/><NumberLine label="期间投资盈亏" value={d.summary?.gain} signed/>
  <button className="d02-link" onClick={()=>inspect("period")}>查看期初与期末 <ArrowUpRight size={14}/></button></section>;
}
function Trend({ d, mode }) {
  const gain=mode==="performance";
  const points=d.points.filter(p=>!d.summary?.earliest || p.date>=d.summary.earliest);
  const series=[{name:gain?"期间投资盈亏":"资产总额",values:points.map(p=>gain?p.gain:p.value),color:"var(--s1)",width:2}];
  return <section className="d02-trend"><div className="d02-h2"><h2>{gain?"投资盈亏走势":"资产走势"}</h2><span>AUD</span></div>
    {series[0].values.some(Number.isFinite)?<LineChart ariaLabel={series[0].name+"走势"} dates={points.map(p=>p.date)} series={series} height={170} zero={gain} formatAxis={n=>new Intl.NumberFormat("en-AU",{notation:"compact"}).format(n)} formatValue={n=>gain?sign(n):money(n)}/>:<div className="d02-empty">所选期间缺少完整估值，暂无可比走势。</div>}
  </section>;
}
function Candidate({ d, mode, state, filters, update, inspect }) {
  const daily=mode==="balance";
  return <>
    <PeriodControl filters={filters} range={d.start&&{from:d.start,to:d.end??d.date}} valuationDate={d.date} onChange={f=>update({period:f.period})}/>
    <div className="d02-layout">
      {daily ? <Balance d={d} state={state} inspect={inspect} hero/> : <Gain d={d} state={state} inspect={inspect} hero/>}
      {daily ? <AccountBreakdown d={d} update={update}/> : <CashBridge d={d} inspect={inspect}/>}
      {daily ? <Gain d={d} state={state} inspect={inspect}/> : <Balance d={d} state={state} inspect={inspect}/>}
      {daily ? <CashBridge d={d} inspect={inspect}/> : <AccountBreakdown d={d} update={update}/>}
    </div>
    <Trend d={d} mode={mode}/>
    <div className="d02-more"><button onClick={()=>inspect("value")}>持仓与现金 <ChevronRight size={14}/></button><button onClick={()=>inspect("fx")}>汇率影响 <ChevronRight size={14}/></button></div>
  </>;
}
function Screen({ mode, d, state, update }) {
  const [detail,setDetail]=useState(null);
  const filters={ids:state.scope==="all"?null:d.selected,period:state.period,date:"",from:null,to:null};
  return <div className="d02-body d02-window" data-aspect="16:9">
    <header className="d02-top"><div className="d02-title"><span className="d02-mark"><Layers3 size={19}/></span><span><small>Stock Portfolio</small><b>总览</b></span></div>
      <div className="d02-header-actions"><select aria-label="账户范围" value={state.scope} onChange={e=>update({scope:e.target.value})}>{Object.entries(scopeNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><time dateTime={d.date}>{d.date}</time></div></header>
    <div className="d02-scroll" key={state.sample+"/"+state.scope}><div className="d02-page">
      {mode==="current"?<Overview d={d} filters={filters} onFilters={f=>update({period:f.period})} onPage={()=>setDetail("value")} run={()=>{}}/>:
        <Candidate d={d} mode={mode} state={state} filters={filters} update={update} inspect={setDetail}/>}
    </div></div>
    {detail && <Inspect d={d} kind={detail} close={()=>setDetail(null)}/>}
  </div>;
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
  const controls=mount(root.querySelector("#overview-controls"));
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
    return <I18nProvider locale="zh-CN"><Toolbar state={state} update={update} d={d}/>
      {views.map(({mode,node})=>createPortal(<Screen key={state.sample+"/"+state.scope} mode={mode} d={d} state={state} update={update}/>,node,mode))}
    </I18nProvider>;
  }
  createRoot(controls).render(<Comparison/>);
}
start().catch(()=>{root.textContent="无法加载示例账本，请使用新版浏览器重新打开。";});
