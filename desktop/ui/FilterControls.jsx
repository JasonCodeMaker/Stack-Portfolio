// Global filter controls (spec §2.3): account scope and valuation date for the page head, the
// 「正在查看」 chip beside the title, and the period control the overview and review place in-page.
// The filter rules themselves live in filters.js.
import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Modal } from "./common";
import { daysBetween, periodPresets } from "../periods.js";
import { accountScope, choosePreset, chooseRange, clearRange, isCustom, periodLabels, setValuationDate } from "./filters.js";

// The local calendar date, which the valuation date returns to.
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" });

// accounts: the active accounts [{id, name}]; selected: the ids the page shows.
export function AccountScope({ filters, accounts, selected, onChange }) {
  const [editing, setEditing] = useState(null);
  const label =
    filters.ids == null || selected.length === accounts.length
      ? "全部账户"
      : selected.length === 1
        ? accounts.find((a) => a.id === selected[0])?.name
        : selected.length + " 个账户";
  return (
    <>
      <button type="button" className="btn account-scope" aria-label={"账户范围 · " + label}
        title={label} onClick={() => setEditing([...selected])}>
        <span>{label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {editing && (
        <Modal title="账户范围" close={() => setEditing(null)}>
          {accounts.map((a) => (
            <label className="check" key={a.id}>
              <input
                type="checkbox"
                checked={editing.includes(a.id)}
                onChange={(e) => setEditing(e.target.checked ? [...editing, a.id] : editing.filter((id) => id !== a.id))}
              />
              {a.name}
            </label>
          ))}
          <div className="actions">
            <button type="button" onClick={() => setEditing(accounts.map((a) => a.id))}>
              全部账户
            </button>
            <button
              type="button"
              className="primary"
              disabled={!editing.length}
              onClick={() => {
                onChange({ ...filters, ids: accountScope(editing, accounts.map((a) => a.id)) });
                setEditing(null);
              }}
            >
              应用
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// "今天 ▾" until a past day is chosen; the native date picker opens on click.
export function ValuationDate({ filters, value, onChange }) {
  const now = today();
  return (
    <label className="btn date-pick">
      <span>{filters.date || "今天"}</span>
      <ChevronDown size={13} aria-hidden="true" />
      <input
        type="date"
        aria-label="估值日"
        max={now}
        value={value}
        onClick={(e) => e.currentTarget.showPicker?.()}
        onChange={(e) => e.target.value && onChange(setValuationDate(filters, e.target.value, now))}
      />
    </label>
  );
}

// Beside the page title while a past valuation date is shown.
export function AsOf({ filters, onChange }) {
  if (!filters.date) return null;
  return (
    <span className="asof" role="status">
      正在查看 {filters.date}
      <button type="button" onClick={() => onChange(setValuationDate(filters, "", today()))}>
        回到今天
      </button>
    </span>
  );
}

// The period presets end on the valuation date. With `custom` (the review) the control also
// enters a custom range; elsewhere a custom range shows as 「起 至 止 ✕」 with no preset selected.
// range = {from, to}: the period as measured, for the caption; days adds "· N 天".
export function PeriodControl({ filters, range, valuationDate, custom = false, days = false, onChange, children }) {
  const ranged = isCustom(filters);
  return (
    <div className="row m0 period-row" role="group" aria-label="期间">
      <span className="seg">
        {periodPresets.map((k) => (
          <button
            type="button"
            key={k}
            className={!ranged && filters.period === k ? "on" : ""}
            aria-pressed={!ranged && filters.period === k}
            onClick={() => onChange(choosePreset(filters, k))}
          >
            {periodLabels[k]}
          </button>
        ))}
        {custom && (
          <button
            type="button"
            className={ranged ? "on" : ""}
            aria-pressed={ranged}
            onClick={() => !ranged && range && onChange(chooseRange(filters, range.from, range.to, valuationDate))}
          >
            自定义…
          </button>
        )}
      </span>
      {ranged && custom ? (
        <span className="period-range">
          <input
            className="btn"
            type="date"
            aria-label="期间起点"
            value={filters.from}
            max={filters.to}
            onChange={(e) => onChange(chooseRange(filters, e.target.value, filters.to, valuationDate))}
          />
          <span className="cap">至</span>
          <input
            className="btn"
            type="date"
            aria-label="期间终点"
            value={filters.to}
            min={filters.from}
            max={valuationDate}
            onChange={(e) => onChange(chooseRange(filters, filters.from, e.target.value, valuationDate))}
          />
        </span>
      ) : ranged ? (
        <span className="range-chip">
          {filters.from} 至 {filters.to > valuationDate ? valuationDate : filters.to}
          <button type="button" aria-label="回到预设期间" onClick={() => onChange(clearRange(filters))}>
            ✕
          </button>
        </span>
      ) : (
        range && (
          <span className="cap">
            {range.from === range.to ? range.to : range.from + " 至 " + range.to}
            {days && " · " + (daysBetween(range.from, range.to) + 1) + " 天"}
          </span>
        )
      )}
      {children}
    </div>
  );
}
