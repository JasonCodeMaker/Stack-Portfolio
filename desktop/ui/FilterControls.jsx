// Global filter controls (spec §2.3): account scope and valuation date for the page head, the
// 「正在查看」 chip beside the title, and the period control the overview and review place in-page.
// The filter rules themselves live in filters.js.
import React, { useState } from "react";
import { ChevronDown, LayoutDashboard } from "lucide-react";
import { Modal } from "./common";
import { daysBetween, periodPresets } from "../periods.js";
import { accountScope, choosePreset, chooseRange, clearRange, isCustom, periodLabel, setValuationDate } from "./filters.js";
import { useI18n } from "./i18n.jsx";

// The local calendar date, which the valuation date returns to.
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" });

export function OverviewLayoutPicker({ value, onChange }) {
  const { t } = useI18n();
  return (
    <label className="btn overview-layout-picker" title={t("overview.layout.label")}>
      <LayoutDashboard size={15} aria-hidden="true" />
      <span aria-hidden="true">{t("overview.layout." + value)}</span>
      <ChevronDown size={13} aria-hidden="true" />
      <select aria-label={t("overview.layout.label")} value={value} onChange={event => onChange(event.target.value)}>
        <option value="classic">{t("overview.layout.classic")}</option>
        <option value="daily">{t("overview.layout.daily")}</option>
      </select>
    </label>
  );
}

// accounts: the active accounts [{id, name}]; selected: the ids the page shows.
export function AccountScope({ filters, accounts, selected, onChange }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(null);
  const label =
    filters.ids == null || selected.length === accounts.length
      ? t("app.allAccounts")
      : selected.length === 1
        ? accounts.find((a) => a.id === selected[0])?.name
        : t("app.accountsSelected", { count: selected.length });
  return (
    <>
      <button type="button" className="btn account-scope" aria-label={t("app.accountScopeAria", { label })}
        title={label} onClick={() => setEditing([...selected])}>
        <span>{label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {editing && (
        <Modal title={t("app.accountScope")} close={() => setEditing(null)}>
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
              {t("app.allAccounts")}
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
              {t("app.apply")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// "Today ▾" until a past day is chosen; the native date picker opens on click.
export function ValuationDate({ filters, value, onChange }) {
  const { t } = useI18n();
  const now = today();
  return (
    <label className="btn date-pick">
      <span>{filters.date || t("app.today")}</span>
      <ChevronDown size={13} aria-hidden="true" />
      <input
        type="date"
        aria-label={t("app.valuationDateAria")}
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
  const { t } = useI18n();
  if (!filters.date) return null;
  return (
    <span className="asof" role="status">
      {t("app.viewingAsOf", { date: filters.date })}
      <button type="button" onClick={() => onChange(setValuationDate(filters, "", today()))}>
        {t("app.backToToday")}
      </button>
    </span>
  );
}

// The period presets end on the valuation date. With `custom` (the review) the control also
// enters a custom range; elsewhere a custom range shows as `from to to ✕` with no preset selected.
// range = {from, to}: the period as measured, for the caption; days adds " · N days".
export function PeriodControl({ filters, range, valuationDate, custom = false, days = false, onChange, children }) {
  const { t } = useI18n();
  const ranged = isCustom(filters);
  return (
    <div className="row m0 period-row" role="group" aria-label={t("period.groupAria")}>
      <span className="seg">
        {periodPresets.map((k) => (
          <button
            type="button"
            key={k}
            className={!ranged && filters.period === k ? "on" : ""}
            aria-pressed={!ranged && filters.period === k}
            onClick={() => onChange(choosePreset(filters, k))}
          >
            {periodLabel(k, t)}
          </button>
        ))}
        {custom && (
          <button
            type="button"
            className={ranged ? "on" : ""}
            aria-pressed={ranged}
            onClick={() => !ranged && range && onChange(chooseRange(filters, range.from, range.to, valuationDate))}
          >
            {t("period.customBtn")}
          </button>
        )}
      </span>
      {ranged && custom ? (
        <span className="period-range">
          <input
            className="btn"
            type="date"
            aria-label={t("period.fromAria")}
            value={filters.from}
            max={filters.to}
            onChange={(e) => onChange(chooseRange(filters, e.target.value, filters.to, valuationDate))}
          />
          <span className="cap">{t("period.toWord")}</span>
          <input
            className="btn"
            type="date"
            aria-label={t("period.toAria")}
            value={filters.to}
            min={filters.from}
            max={valuationDate}
            onChange={(e) => onChange(chooseRange(filters, filters.from, e.target.value, valuationDate))}
          />
        </span>
      ) : ranged ? (
        <span className="range-chip">
          {filters.from} {t("period.toWord")} {filters.to > valuationDate ? valuationDate : filters.to}
          <button type="button" aria-label={t("period.resetPresetAria")} onClick={() => onChange(clearRange(filters))}>
            ✕
          </button>
        </span>
      ) : (
        range && (
          <span className="cap">
            {range.from === range.to ? range.to : `${range.from} ${t("period.toWord")} ${range.to}`}
            {days && t("period.daysCount", { days: daysBetween(range.from, range.to) + 1 })}
          </span>
        )
      )}
      {children}
    </div>
  );
}
