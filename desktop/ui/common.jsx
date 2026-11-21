import React, { useEffect, useRef } from "react";
import { X, Inbox } from "lucide-react";
export const api = window.portfolio;
export const fmt = (n, digits = 0) =>
  n == null || !Number.isFinite(Number(n))
    ? "—"
    : new Intl.NumberFormat("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
        n,
      );
export const aud = (n, digits = 0) => (n == null ? "—" : "A$" + fmt(n, digits));
export const pct = (n) => (n == null ? "—" : fmt(n * 100, 1) + "%");
export const num = (n) =>
  n == null ? "—" : new Intl.NumberFormat("en-AU", { maximumFractionDigits: 8 }).format(n);
export const kind = {
  stock: "股票",
  etf: "ETF",
  cash: "现金",
  "fixed-income": "固收",
  derivative: "衍生品",
  unknown: "待分类",
  other: "其他",
};
export const types = {
  BUY: "买入",
  SELL: "卖出",
  DEPOSIT: "入金",
  WITHDRAWAL: "出金",
  DIVIDEND: "股息",
  INTEREST: "利息",
  FEE: "费用",
  TAX: "税款",
  TRANSFER_IN: "转入",
  TRANSFER_OUT: "转出",
};
export function Modal({ title, children, close }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-inner">
        <header>
          <h2>{title}</h2>
          <button aria-label="关闭" className="icon" onClick={close}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Tabs({ items, value, onChange }) {
  return (
    <div className="tabs">
      {items.map(([id, label]) => (
        <button
          type="button"
          key={id}
          aria-pressed={value === id}
          className={value === id ? "on" : ""}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function Empty({ children }) {
  return (
    <div className="empty">
      <Inbox size={23} />
      <span>{children}</span>
    </div>
  );
}
export function Table({ head, children }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Card({ title, action, children }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function AccountSelect({ data, value, set }) {
  return (
    <select aria-label="账本账户" value={value} onChange={(e) => set(e.target.value)}>
      {data.accounts
        .filter((a) => a.active)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </select>
  );
}
export function parseCash(text) {
  const out = {};
  for (const row of text.trim().split(/\r?\n/).filter(Boolean)) {
    const p = row.split(/[,，\s]+/).filter(Boolean);
    if (p.length !== 2 || !/^[-+]?\d+(?:\.\d+)?$/.test(p[1]))
      throw Error("每行填写币种与余额，例如 AUD 7600。");
    const code = p[0].toUpperCase();
    if (code in out) throw Error("现金币种重复。");
    out[code] = p[1];
  }
  return out;
}
