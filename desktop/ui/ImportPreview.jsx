import React, { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Table, types } from "./common";

const brokerNames = { ibkr: "IBKR", webull: "Webull AU" };
const statusNames = {
  update: ["将修改", "已修改"], new: ["将新增", "已新增"], void: ["将冲销", "已冲销"],
  link: ["将关联凭证", "已关联凭证"], review: ["待核对", "待核对"],
};
const number = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 20 });
const money = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 20 });

function formatted(value, format, currency) {
  if (value == null || value === "") return "未提供";
  if (format === "type") return types[value] || value;
  if (format === "money") return currency === "AUD" ? "A$" + money.format(value) : money.format(value) + " " + (currency || "");
  if (format === "price") return [currency, number.format(value)].filter(Boolean).join(" ");
  if (format === "quantity" || format === "rate") return number.format(value);
  return String(value);
}

function rowType(r) {
  if (r.exchange && r.type === "TRANSFER_IN") return "换汇转入";
  if (r.exchange && r.type === "TRANSFER_OUT") return "换汇转出";
  return types[r.type] || "待识别";
}

function activityValue(r) {
  if (r.quantity != null && r.unitPrice != null)
    return number.format(r.quantity) + " × " + formatted(r.unitPrice, "price", r.currency);
  if (r.quantity != null && r.symbol) return number.format(r.quantity) + " 单位";
  return r.amount == null ? "—" : formatted(r.amount, "money", r.currency);
}

function Difference({ edit }) {
  return <span className="import-difference">
    <span>{edit.label}</span>
    {edit.before == null ? <small>新记录</small> : <>
      <span className="import-before">{formatted(edit.before, edit.format, edit.oldCurrency || edit.currency)}</span>
      <span aria-label="变为">→</span>
    </>}
    <strong>{formatted(edit.after, edit.format, edit.currency)}</strong>
  </span>;
}

function ActivityChanges({ rows, done }) {
  const [limit, setLimit] = useState(15);
  const sorted = React.useMemo(() => {
    const order = Object.keys(statusNames);
    return [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) ||
      String(b.date || "").localeCompare(String(a.date || "")));
  }, [rows]);
  return <>
    <Table head={["变更", "日期", "流水", "变更内容"]}>
      {sorted.slice(0, limit).map((r, i) => (
        <tr key={i}>
          <td className={"import-status " + r.status}>{statusNames[r.status][Number(done)]}</td>
          <td>{String(r.date || "—").slice(0, 10)}{r.line && <small>文件第 {r.line} 行</small>}</td>
          <td>{rowType(r)} {r.symbol}</td>
          <td>{r.edits?.length ? r.edits.map((e) => <Difference key={e.label} edit={e} />)
            : r.status === "link" ? "关联这笔流水的券商凭证" : activityValue(r)}
            {r.status === "new" && Number(r.fee) > 0 && <small>费用 {formatted(r.fee, "money", r.currency)}</small>}
            {r.status === "new" && Number(r.tax) > 0 && <small>税款 {formatted(r.tax, "money", r.currency)}</small>}
            {r.reason && <small>{r.reason}</small>}
          </td>
        </tr>
      ))}
    </Table>
    {sorted.length > limit && <button className="text-btn" onClick={() => setLimit(limit + 15)}>再显示 {Math.min(15, sorted.length - limit)} 笔变更</button>}
  </>;
}

function AccountChanges({ report, rows, edits, name, reconcile, done }) {
  const [limit, setLimit] = useState(12);
  const broker = brokerNames[report.broker];
  return <article className="import-account" aria-label={broker + " 变更"}>
    <header><h3>{broker}</h3>{name && name.toLowerCase() !== broker.toLowerCase() && <small>{name}</small>}</header>
    {rows.length > 0 && <ActivityChanges rows={rows} done={done} />}
    {edits.length > 0 && <>
      <h4>账户数据变更{report.statement?.date && <small>{report.statement.date}</small>}</h4>
      <ul className="import-fields">{edits.slice(0, limit).map((edit, i) => <li key={i}><Difference edit={edit} /></li>)}</ul>
      {edits.length > limit && <button className="text-btn" onClick={() => setLimit(limit + 12)}>再显示 {Math.min(12, edits.length - limit)} 项变更</button>}
    </>}
    {done && <button className="text-btn" onClick={() => reconcile(report)}>前往结单对账 <ArrowRight size={14} /></button>}
  </article>;
}

function changedReports(result) {
  const out = [];
  for (const report of result.reports || [result]) {
    const rows = report.rows.filter((r) => r.status in statusNames);
    const edits = [...report.amountEdits];
    for (const quote of report.priceEdits) {
      if (!edits.some((e) => e.label === quote.label && e.currency === quote.currency && Number(e.after) === Number(quote.after)))
        edits.push(quote);
    }
    if (rows.length || edits.length) out.push({ report, rows, edits });
  }
  return out;
}

function impact(changed, done) {
  if (!changed.length) return { title: "没有新变化" };
  const rows = changed.flatMap((r) => r.rows);
  const count = (status) => rows.filter((r) => r.status === status).length;
  const actions = [];
  for (const [status, verb] of [["update", "修改"], ["new", "新增"], ["void", "冲销"], ["link", "关联凭证"]]) {
    const n = count(status);
    if (n) actions.push(status === "link" ? "为 " + n + " 笔流水关联券商凭证" : verb + " " + n + " 笔流水");
  }
  const fields = changed.reduce((n, r) => n + r.edits.length, 0);
  if (fields) actions.push("更新 " + fields + " 项账户数据");
  const pending = count("review");
  const button = actions.length === 0 ? "保存待核对提示"
    : actions.length === 1 && count("new") && !pending ? "确认导入 " + count("new") + " 笔" : "确认保存变更";
  const title = actions.length ? (done ? "已" : "将") + actions.join("、") : pending + " 笔流水待核对";
  const note = pending ? (actions.length ? pending + " 笔待核对。" : "") + "待核对流水暂不入账。" : "";
  return { title, button, note };
}

export function ImportPreview({ result, done, accounts, confirm, close, reconcile }) {
  const panel = useRef(null);
  useEffect(() => {
    panel.current.focus({ preventScroll: true });
    panel.current.scrollIntoView({ block: "start" });
  }, []);
  const changed = changedReports(result);
  const { title, button, note } = impact(changed, done);
  return (
    <section ref={panel} tabIndex={-1} className="card import-preview" aria-label={done ? "导入结果" : "导入预览"}>
      <div className="card-head"><h2>{done ? "导入结果" : "导入预览"}</h2></div>
      <div className="import-impact">
        <div><h3>{title}</h3>{note && <p>{note}</p>}</div>
        <div className="import-decisions">
          {!done && button && <button className="primary" onClick={confirm}>{button}</button>}
          <button onClick={close}>{done ? "关闭结果" : button ? "取消预览" : "关闭预览"}</button>
        </div>
      </div>
      {changed.map(({ report, rows, edits }) => <AccountChanges key={report.account} report={report} rows={rows} edits={edits}
        name={accounts.find((a) => a.id === report.account)?.name} done={done} reconcile={reconcile} />)}
    </section>
  );
}
