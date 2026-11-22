import React, { useLayoutEffect, useRef } from "react";
import { X, Inbox } from "lucide-react";
export const api = window.portfolio;
export const fmt = (n, digits = 0) =>
  n == null || !Number.isFinite(Number(n))
    ? "—"
    : new Intl.NumberFormat("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
        n,
      );
// The sign leads the currency symbol, and an amount which rounds to zero carries none.
const signOf = (n, digits, plus) => {
  const rounded = Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n;
  return rounded < 0 ? "−" : rounded > 0 && plus ? "+" : "";
};
export const aud = (n, digits = 0) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : signOf(n, digits) + "A$" + fmt(Math.abs(n), digits);
export const pct = (n) => (n == null ? "—" : fmt(n * 100, 1) + "%");
export const signedAud = (n, digits = 2) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : signOf(n, digits, true) + "A$" + fmt(Math.abs(n), digits);
export const signedPct = (n, digits = 2) =>
  n == null || !Number.isFinite(Number(n))
    ? "—"
    : signOf(n * 100, digits, true) + fmt(Math.abs(n) * 100, digits) + "%";
// Gains and losses carry a direction mark and a sign as well as a colour.
export const tone = (n, digits = 2) => {
  const sign = n == null || !Number.isFinite(Number(n)) ? "" : signOf(n, digits, true);
  return sign === "+" ? "gain" : sign === "−" ? "loss" : "";
};
const directionMark = (direction) => direction === "gain" ? "▲" : direction === "loss" ? "▼" : "";
const rateText = (rate, unit = "%") => signedPct(rate).replace("%", unit);

export function directedPct(rate, unit) {
  const mark = directionMark(tone(rate, 4));
  return (mark ? mark + " " : "") + rateText(rate, unit);
}

export function Delta({ amount, rate, digits = 2, currency = true, rateUnit }) {
  const basis = amount ?? rate,
    direction = tone(basis, amount == null ? 4 : digits);
  if (basis == null) return <span className="delta">—</span>;
  return (
    <span className={"delta " + direction}>
      {direction && <i aria-hidden="true">{directionMark(direction)}</i>}
      {amount != null && (currency ? signedAud(amount, digits) : signedAud(amount, digits).replace("A$", ""))}
      {rate != null && <em>{amount != null ? "（" + rateText(rate, rateUnit) + "）" : rateText(rate, rateUnit)}</em>}
    </span>
  );
}
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
export function Modal({ title, children, close, wide = false }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
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
// A heading written as [label, "num"] aligns right, over a column of figures.
export function Table({ head, onKeyDown, children }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={Array.isArray(h) ? h[1] : undefined}>
                {Array.isArray(h) ? h[0] : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown}>{children}</tbody>
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
    <select aria-label="账本账户" value={value || ""} onChange={(e) => set(e.target.value)}>
      {!value && <option value="">选择账户</option>}
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
