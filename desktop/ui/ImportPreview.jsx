import React, { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { aud, fmt, num, Table, types } from "./common";

const brokerNames = { ibkr: "IBKR", webull: "Webull AU" };
const statusNames = {
  new: ["将新增", "已新增"], update: ["将更正", "已更正"], link: ["将关联", "已关联"],
  review: ["待核对", "待核对"], existing: ["已入账", "已入账"],
};

function changes(reports, done) {
  const count = (status) => reports.reduce((n, r) => n + r.rows.filter((v) => v.status === status).length, 0);
  const added = reports.reduce((n, r) => n + (done ? r.imported : r.added), 0);
  const update = count("update"), link = count("link"), review = count("review"), existing = count("existing");
  const repair = reports.reduce((n, r) => n + r.repaired, 0);
  const namesFor = (change) => reports.filter((r) => r.valueChange === change).map((r) => brokerNames[r.broker]).join("、");
  const values = namesFor("value"), times = namesFor("time");
  const prices = reports.reduce((n, r) => n + r.prices, 0);
  const actions = [];
  if (added) actions.push(`新增 ${added} 笔流水`);
  if (update) actions.push(`更正 ${update} 笔已有流水`);
  if (link) actions.push(`为 ${link} 笔已有流水关联券商记录`);
  if (repair) actions.push(`冲销 ${repair} 笔重复流水`);
  if (values) actions.push(`保存 ${values} 的账户估值`);
  if (times) actions.push(`更新 ${times} 的估值时间`);
  if (prices) actions.push(`更新 ${prices} 项结单报价或汇率`);
  const hasLedgerChange = added || update || link || repair;
  const headline = hasLedgerChange
    ? (done ? "已" : "将") + actions.shift()
    : review ? `${review} 笔流水需要核对`
    : existing ? `这 ${existing} 笔流水都已入账` : "本次没有交易流水";
  if (review) actions.push(`保存 ${review} 笔待核对记录的提示`);
  const description = [];
  if (times && !values && !prices && !review && !hasLedgerChange)
    description.push("账户金额与上次相同，" + (done ? "已" : "本次只会") + actions[0] + "。");
  else if (actions.length) description.push((done ? "已" : hasLedgerChange ? "同时会" : "本次会") + actions.join("，") + "。");
  else if (!hasLedgerChange) description.push("没有需要保存的变更。");
  if (hasLedgerChange && existing) description.push(`另有 ${existing} 笔已入账，自动跳过。`);
  if (review) description.push("待核对流水暂不入账。");
  let button = null;
  if (added) button = `确认导入 ${added} 笔`;
  else if (hasLedgerChange) button = "确认更新流水";
  else if (times && !values && !prices && !review) button = `更新 ${times} 估值时间`;
  else if (values && !times && !prices && !review) button = `保存 ${values} 账户估值`;
  else if (prices || values || times) button = "保存本次更新";
  else if (review) button = "保存待核对提示";
  return { headline, description: description.join(""), button };
}

function money(value, currency) {
  if (value == null || value === "") return null;
  return currency === "AUD" ? aud(value, 2) : [currency || "币种未注明", fmt(value, 2)].join(" ");
}

function byCurrency(balances) {
  return Object.entries(balances || {}).map(([ccy, value]) => money(value, ccy)).join(" / ");
}

function rateOrPrice(value, currency) {
  return [currency, num(value)].filter(Boolean).join(" ");
}

function displayDate(value) {
  return String(value || "").slice(0, 10);
}

function amounts(value, positionValues) {
  if (!value) return [];
  return [
    ["账户总额", money(value.nav, value.base), value.base === "AUD" ? value.nav : null],
    ["现金余额", money(value.cashTotal, value.base) || byCurrency(value.cash), value.cashTotal],
    ["证券市值", money(value.securities, value.base) || byCurrency(positionValues), value.securities],
  ];
}

function AmountList({ items, previous, missing = "未提供" }) {
  return (
    <dl className="import-amounts">
      {items.map(([label, value, raw], i) => {
        const prior = previous?.[i]?.[2];
        const delta = raw != null && prior != null ? Math.round((Number(raw) - Number(prior)) * 100) / 100 : null;
        return (
          <div key={label}>
            <dt>{label}</dt><dd className={value ? "" : "amount-missing"}>{value || missing}</dd>
            {delta != null && <small>{delta === 0 ? "较上次持平" : "较上次 " + (delta > 0 ? "+" : "−") + aud(Math.abs(delta), 2)}</small>}
          </div>
        );
      })}
    </dl>
  );
}

function AccountAmounts({ report, accountName, done, reconcile }) {
  const { broker, audit, statement, previousValue } = report;
  const name = brokerNames[broker];
  const current = statement || { base: audit.baseCurrency, nav: audit.reportedNavBase, cash: audit.endingCashByCurrency, positions: audit.statementPositions };
  const items = amounts(current, audit.openPositionValueByCurrency);
  const hasAmounts = items.some(([, value]) => value);
  const previous = amounts(previousValue);
  const accountLabel = accountName && accountName.toLowerCase() !== name.toLowerCase() ? accountName : "";
  const positions = current.positions;
  const period = audit.period;
  const when = current.observedAt
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(current.observedAt)) + "（布里斯班）"
    : current.date;
  const previousNote = previousValue && `上次保存 · ${previousValue.date} · ${previousValue.source}`;
  const canCompare = done || (!report.repaired && report.rows.every((r) => r.status === "existing"));
  return (
    <article className="import-account" aria-label={name + " 账户金额"}>
      <header><h3>{name}</h3>{accountLabel && <span>{accountLabel}</span>}</header>
      {hasAmounts ? (
        <>
          <p className="import-caption">本次{broker === "ibkr" ? "结单" : "返回"}{when && " · " + when}</p>
          <AmountList items={items} previous={previous} />
          {previousNote && <p className="import-caption">{previousNote}</p>}
        </>
      ) : (
        <>
          <p className="import-unavailable">{broker === "ibkr" ? "本次 Flex 报表" : "本次数据"}未提供账户金额{positions == null ? "和持仓" : ""}。</p>
          {previousNote && <>
            <p className="import-caption">{previousNote}</p>
            <AmountList items={previous.filter(([, value]) => value)} />
          </>}
        </>
      )}
      {Array.isArray(positions) && <p className="import-note">{positions.length
        ? "本次持仓 · " + positions.slice(0, 3).map((p) => p.symbol + " × " + num(p.quantity)).join("、") + (positions.length > 3 ? ` 等 ${positions.length} 项` : "")
        : "本次持仓 · 空仓"}</p>}
      {hasAmounts && broker === "ibkr" && positions == null && <p className="import-note">本次报表未提供持仓明细。</p>}
      {audit.cashLedgerAvailable === false && <p className="import-note">Webull 未返回出入金等现金流水，可用月结单核对。</p>}
      {audit.cashLedgerAvailable === true && audit.cashActivities === 0 && <p className="import-note">本次查询的六个月内，券商返回了 0 笔现金流水。</p>}
      {broker === "webull" && /\.csv$/i.test(report.source) && <p className="import-note">成交文件只含订单，可用同日结单核对余额。</p>}
      {period && <p className="import-caption">报表期间 · {period.from} 至 {period.to}</p>}
      {/\.(?:xml|csv)$/i.test(report.source) && <p className="import-caption">来源文件 · {report.source}</p>}
      {canCompare && <button className="text-btn" onClick={() => reconcile(report)}>{done ? "前往结单对账" : "用结单核对"} <ArrowRight size={14} /></button>}
    </article>
  );
}

function rowType(r) {
  if (r.exchange && r.type === "TRANSFER_IN") return "换汇转入";
  if (r.exchange && r.type === "TRANSFER_OUT") return "换汇转出";
  return types[r.type] || "待识别";
}

function rowValue(r) {
  if (r.quantity != null && r.unitPrice != null) return num(r.quantity) + " × " + rateOrPrice(r.unitPrice, r.currency);
  if (r.quantity != null && r.symbol) return num(r.quantity) + " 单位";
  return money(r.amount, r.currency) || "—";
}

function ActivityList({ report, done }) {
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [limit, setLimit] = useState(25);
  const rows = React.useMemo(() => [...report.rows].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))), [report.rows]);
  const counts = new Map();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) || 0) + 1);
  const breakdown = Object.keys(statusNames).filter((s) => counts.has(s)).map((s) => `${counts.get(s)} 笔${statusNames[s][Number(done)]}`);
  const latestTrade = rows.find((r) => r.type === "BUY" || r.type === "SELL");
  const recent = latestTrade || rows[0];
  const filtered = rows.filter((r) => (status === "all" || r.status === status) && (type === "all" || rowType(r) === type));
  return (
    <details className="import-activities">
      <summary>
        <span>{brokerNames[report.broker]} · {rows.length} 笔流水{breakdown.length > 0 && <small>{breakdown.join(" · ")}</small>}</span>
        {recent && <span className="import-recent">{latestTrade ? "最近成交" : "最近流水"} · {[displayDate(recent.date), rowType(recent), recent.symbol, rowValue(recent)].filter(Boolean).join(" ")}</span>}
      </summary>
      {!rows.length && <p className="import-caption">券商数据中没有流水记录。</p>}
      {rows.length > 0 && <>
        <div className="import-filters">
          <label>状态 <select value={status} onChange={(e) => { setStatus(e.target.value); setLimit(25); }}>
            <option value="all">全部状态</option>
            {Object.keys(statusNames).filter((s) => counts.has(s)).map((s) => <option key={s} value={s}>{statusNames[s][Number(done)]}</option>)}
          </select></label>
          <label>类型 <select value={type} onChange={(e) => { setType(e.target.value); setLimit(25); }}>
            <option value="all">全部类型</option>
            {[...new Set(rows.map(rowType))].map((s) => <option key={s}>{s}</option>)}
          </select></label>
          <small>共 {filtered.length} 笔</small>
        </div>
        {filtered.length ? <Table head={["日期", "类型 / 证券", "数量 × 单价 / 金额", "入账状态"]}>
          {filtered.slice(0, limit).map((r, i) => (
            <tr key={i}>
              <td>{displayDate(r.date) || "—"}{r.line && <small>文件第 {r.line} 行</small>}</td>
              <td>{rowType(r)} {r.symbol}</td>
              <td>{rowValue(r)}{Number(r.fee) > 0 && <small>费用 {rateOrPrice(r.fee, r.currency)}</small>}{Number(r.tax) > 0 && <small>税款 {rateOrPrice(r.tax, r.currency)}</small>}</td>
              <td>{statusNames[r.status][Number(done)]}{r.reason && <small>{r.reason}</small>}</td>
            </tr>
          ))}
        </Table> : <p className="import-caption">没有符合条件的流水。</p>}
        {filtered.length > limit && <button className="text-btn" onClick={() => setLimit(limit + 25)}>再显示 {Math.min(25, filtered.length - limit)} 笔</button>}
      </>}
    </details>
  );
}

export function ImportPreview({ result, done, accounts, confirm, close, reconcile }) {
  const panel = useRef(null);
  useEffect(() => {
    panel.current.focus({ preventScroll: true });
    panel.current.scrollIntoView({ block: "start" });
  }, []);
  const reports = result.reports || [result];
  const impact = changes(reports, done);
  return (
    <section ref={panel} tabIndex={-1} className="card import-preview" aria-label={done ? "导入结果" : "导入预览"}>
      <div className="card-head"><h2>{done ? "导入结果" : "导入预览"}</h2></div>
      <div className="import-impact">
        <div><h3>{impact.headline}</h3>{impact.description && <p>{impact.description}</p>}</div>
        {!done && <div className="import-decisions">
          {impact.button && <button className="primary" onClick={confirm}>{impact.button}</button>}
          <button onClick={close}>{impact.button ? "取消预览" : "关闭预览"}</button>
        </div>}
      </div>
      <h3 className="import-section-title">账户金额</h3>
      <div className="import-accounts">
        {reports.map((r) => <AccountAmounts key={r.account} report={r} accountName={accounts.find((a) => a.id === r.account)?.name} done={done} reconcile={reconcile} />)}
      </div>
      <h3 className="import-section-title">流水明细</h3>
      {reports.map((r) => <ActivityList key={r.account} report={r} done={done} />)}
    </section>
  );
}
