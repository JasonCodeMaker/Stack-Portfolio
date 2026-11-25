// Global filters (spec §2.3): the account scope and valuation date in the page head of the four
// analysis pages, and the period shared by the overview and the return review.
// { ids: null (全部账户) | [accountId], date: "" (今天) | "YYYY-MM-DD",
//   period: preset, from/to: a custom range (from the review) or null }
import { day, periodPresets, resolvePeriod } from "../periods.js";

export const periodLabels = {
  "1d": "本日", "1w": "本周", mtd: "本月", "3m": "近 3 月", "6m": "近 6 月", ytd: "今年以来", "1y": "近一年", all: "全部",
};

export const defaultFilters =Object.freeze({ ids: null, date: "", period: "ytd", from: null, to: null });

const isDay = (value) => {
  try {
    return day(value) === value;
  } catch {
    return false;
  }
};

// What survives a restart: the account scope and the period. The valuation date returns to today.
export function rememberedFilters({ ids, period, from, to }) {
  return { ids, period, from, to };
}

export function restoreFilters(saved) {
  if (!saved || typeof saved !== "object") return defaultFilters;
  const ids = saved.ids == null ? null : saved.ids;
  const custom = saved.from != null || saved.to != null;
  if (
    (ids !== null && !(Array.isArray(ids) && ids.length && ids.every((id) => typeof id === "string"))) ||
    !periodPresets.includes(saved.period) ||
    (custom && !(isDay(saved.from) && isDay(saved.to) && saved.from <= saved.to))
  )
    return defaultFilters;
  return { ...defaultFilters, ids, period: saved.period, from: custom ? saved.from : null, to: custom ? saved.to : null };
}

// A custom range ends no later than the valuation date; one that would start after it gives way to
// 今年以来. Presets always end on the valuation date.
function fitRange(filters, to) {
  if (filters.from == null) return filters;
  const end = filters.to > to ? to : filters.to;
  try {
    resolvePeriod({ to: end, from: filters.from });
    return { ...filters, to: end };
  } catch {
    return { ...filters, period: defaultFilters.period, from: null, to: null };
  }
}

export const isCustom = (filters) => filters.from != null;

// A preset (本月 … 全部) replaces a custom range.
export function choosePreset(filters, period) {
  return { ...filters, period, from: null, to: null };
}

// A custom range is entered on the review; the preset chosen before it is kept to return to.
export function chooseRange(filters, from, to, valuationDate) {
  if (!isDay(from) || !isDay(to) || from > to) return filters;
  const next = fitRange({ ...filters, from, to }, valuationDate);
  return next.from == null ? filters : next;
}

export function clearRange(filters) {
  return choosePreset(filters, filters.period);
}

// The period as the period engine takes it: a preset or a custom range, through `valuationDate`.
export function periodQuery(filters, valuationDate) {
  if (!isCustom(filters)) return { period: filters.period, to: valuationDate };
  const to = filters.to > valuationDate ? valuationDate : filters.to;
  return { period: filters.period, from: filters.from, to };
}

// The chosen accounts, or null (全部账户) when they are all the active accounts.
export function accountScope(ids, activeIds) {
  return activeIds.every((id) => ids.includes(id)) ? null : [...ids];
}

// Arguments for the dashboard: "all" accounts or the chosen ones, "" for today's valuation.
export function dashboardQuery(filters) {
  const query = { ids: filters.ids ?? "all", date: filters.date, period: filters.period };
  return isCustom(filters) ? { ...query, from: filters.from, to: filters.to } : query;
}

// `today` is the local calendar date; choosing it (or "") means 今天.
export function setValuationDate(filters, date, today) {
  if (!date || date >= today) return { ...filters, date: "" };
  return fitRange({ ...filters, date }, date);
}
