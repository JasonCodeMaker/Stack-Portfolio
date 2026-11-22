import React, { useEffect, useRef, useState } from "react";
import { types } from "./common";

const brokerNames = { ibkr: "IBKR", webull: "Webull AU" };
// [preview label, saved label, tone]; the tone colours new (gain), corrected (warn) and linked (secondary).
const statusNames = {
  update: ["更正", "已更正", "fix"],
  new: ["新增", "已新增", "new"],
  void: ["冲销", "已冲销", "fix"],
  link: ["关联", "已关联", "dup"],
  evidence: ["补凭据", "已补凭据", "dup"],
  review: ["待核对", "待核对", "fix"],
};
const number = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 20 });
const money = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 20 });

function formatted(value, format, currency) {
  if (value == null || value === "") return "未提供";
  if (format === "type") return types[value] || value;
  if (format === "money")
    return currency === "AUD" ? "A$" + money.format(value) : money.format(value) + " " + (currency || "");
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
  return (
    <span className="diff">
      <span>{edit.label}</span>{" "}
      {edit.before == null ? (
        <small className="cap">新记录</small>
      ) : (
        <>
          <s>{formatted(edit.before, edit.format, edit.oldCurrency || edit.currency)}</s>{" "}
          <span aria-label="变为">→</span>
        </>
      )}{" "}
      <b>{formatted(edit.after, edit.format, edit.currency)}</b>
    </span>
  );
}

function ActivityChanges({ rows, done }) {
  const [limit, setLimit] = useState(15);
  const sorted = React.useMemo(() => {
    const order = Object.keys(statusNames);
    return [...rows].sort(
      (a, b) =>
        order.indexOf(a.status) - order.indexOf(b.status) ||
        String(b.date || "").localeCompare(String(a.date || "")),
    );
  }, [rows]);
  return (
    <>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>变更</th>
              <th className="l">日期</th>
              <th className="l">流水</th>
              <th className="l">变更内容</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r, i) => (
              <tr key={i}>
                <td className={"st " + statusNames[r.status][2]}>{statusNames[r.status][Number(done)]}</td>
                <td className="l">
                  {String(r.date || "—").slice(0, 10)}
                  {r.line && <small>文件第 {r.line} 行</small>}
                </td>
                <td className="l">
                  {rowType(r)} {r.symbol}
                </td>
                <td className="l wrap">
                  {r.edits?.length
                    ? r.edits.map((e) => <Difference key={e.label} edit={e} />)
                    : r.status === "link"
                      ? "关联这笔流水的券商凭证"
                      : activityValue(r)}
                  {r.status === "new" && Number(r.fee) > 0 && <small>费用 {formatted(r.fee, "money", r.currency)}</small>}
                  {r.status === "new" && Number(r.tax) > 0 && <small>税款 {formatted(r.tax, "money", r.currency)}</small>}
                  {r.reason && <small>{r.reason}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <button type="button" className="lnk cap more" onClick={() => setLimit(limit + 15)}>
          再显示 {Math.min(15, sorted.length - limit)} 笔变更
        </button>
      )}
    </>
  );
}

function AccountChanges({ report, rows, edits, name, reconcile, done }) {
  const [limit, setLimit] = useState(12);
  const broker = brokerNames[report.broker];
  return (
    <article className="changes" aria-label={broker + " 变更"}>
      {name && name.toLowerCase() !== broker.toLowerCase() && <div className="cap">入账账户 {name}</div>}
      {rows.length > 0 && <ActivityChanges rows={rows} done={done} />}
      {edits.length > 0 && (
        <>
          <div className="sub">
            账户数据变更{report.statement?.date && <span className="cap">{report.statement.date}</span>}
          </div>
          <div className="diffs">
            {edits.slice(0, limit).map((edit, i) => (
              <Difference key={i} edit={edit} />
            ))}
          </div>
          {edits.length > limit && (
            <button type="button" className="lnk cap more" onClick={() => setLimit(limit + 12)}>
              再显示 {Math.min(12, edits.length - limit)} 项变更
            </button>
          )}
        </>
      )}
      {done && (
        <button type="button" className="lnk next" onClick={() => reconcile(report)}>
          前往结单对账 →
        </button>
      )}
    </article>
  );
}

function changedReports(result) {
  const out = [];
  for (const report of result.reports || [result]) {
    const rows = report.rows.filter((r) => r.status in statusNames);
    const edits = [...report.amountEdits];
    for (const quote of report.priceEdits) {
      if (
        !edits.some(
          (e) => e.label === quote.label && e.currency === quote.currency && Number(e.after) === Number(quote.after),
        )
      )
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
  for (const [status, verb] of [
    ["update", "更正"],
    ["new", "新增"],
    ["void", "冲销"],
    ["link", "关联凭证"],
  ]) {
    const n = count(status);
    if (n) actions.push(status === "link" ? "为 " + n + " 笔流水关联券商凭证" : verb + " " + n + " 笔流水");
  }
  if (count("evidence")) actions.push("为 " + count("evidence") + " 条流水补充券商凭据");
  const fields = changed.reduce((n, r) => n + r.edits.length, 0);
  if (fields) actions.push("更新 " + fields + " 项账户数据");
  const pending = count("review");
  const button =
    actions.length === 0
      ? "保存待核对提示"
      : actions.length === 1 && count("new") && !pending
        ? "确认导入 " + count("new") + " 笔"
        : "确认保存变更";
  const title = actions.length ? (done ? "已" : "将") + actions.join("、") : pending + " 笔流水待核对";
  const note = pending ? (actions.length ? pending + " 笔待核对。" : "") + "待核对流水暂不入账。" : "";
  return { title, button, note };
}

export function ImportPreview({ result, done, accounts, confirm, close, reconcile }) {
  const panel = useRef(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    // With two brokers previewed at once, only the first takes focus.
    if (document.querySelector(".imp-preview") === panel.current) panel.current.focus({ preventScroll: true });
  }, []);
  const changed = changedReports(result);
  const priceWarnings = [...new Set((result.reports || [result]).flatMap((r) => r.priceWarnings || []))];
  const { title, button, note } = impact(changed, done);
  return (
    <section ref={panel} tabIndex={-1} className="imp-preview" aria-label={done ? "导入结果" : "导入预览"}>
      <div className="impact">
        <div className="what">
          <h3>{result.choices?.length ? "请先确认 " + result.choices.length + " 条记录的上市证券" : title}</h3>
          {note && <p>{note}</p>}
          {priceWarnings.map((warning) => (
            <p key={warning}>{warning}，请核对该日结单。</p>
          ))}
        </div>
        {!done && button && (
          <button
            type="button"
            className="btn pri"
            disabled={saving || !!result.choices?.length}
            onClick={async () => {
              setSaving(true);
              try {
                await confirm();
              } finally {
                setSaving(false);
              }
            }}
          >
            {button}
          </button>
        )}
        <button type="button" className="btn" onClick={close}>
          {done ? "关闭结果" : button ? "取消预览" : "关闭预览"}
        </button>
      </div>
      {changed.map(({ report, rows, edits }) => (
        <AccountChanges
          key={report.account}
          report={report}
          rows={rows}
          edits={edits}
          name={accounts.find((a) => a.id === report.account)?.name}
          done={done}
          reconcile={reconcile}
        />
      ))}
    </section>
  );
}

// One broker's sync in its own card: reading, failed (retry this broker alone) or its preview / result.
// `children` goes above the preview (listing choices to settle first).
export function BrokerResult({ report: r, accounts, onConfirm, onClose, onRetry, onConnect, onReconcile, children }) {
  const ready = !r.loading && !r.error;
  return (
    <section className="card broker" aria-label={r.broker.toUpperCase() + " 同步结果"}>
      <div className="row">
        <h2>{brokerNames[r.broker]}</h2>
        {ready && <span className="tag">{r.done ? "导入结果" : "导入预览"}</span>}
      </div>
      {r.loading ? (
        <p role="status" className="cap">
          正在读取券商记录…
        </p>
      ) : r.error ? (
        <div className="notice">
          <span>{r.error}</span>
          <span className="sp" />
          <button type="button" className="btn sm" onClick={onRetry}>
            单独重试
          </button>
          {onConnect && (
            <button type="button" className="btn sm" onClick={onConnect}>
              连接券商
            </button>
          )}
        </div>
      ) : (
        <>
          {children}
          <ImportPreview
            key={r.token || "saved"}
            result={r}
            done={!!r.done}
            accounts={accounts}
            confirm={onConfirm}
            close={onClose}
            reconcile={onReconcile}
          />
        </>
      )}
    </section>
  );
}
