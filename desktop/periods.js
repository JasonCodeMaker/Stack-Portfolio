// Period resolution shared by the period summary engine and the screens' period control.
// Pure date arithmetic on YYYY-MM-DD strings, so the renderer can bundle it too.
import { shiftDay } from "./marketDays.js";

export const dayOf = (date) => String(date || "").slice(0, 10);
export function day(value) {
  const text = dayOf(value);
  if (
    !/^\d{4}-\d\d-\d\d$/.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString().slice(0, 10) !== text
  )
    throw Error("请输入有效日期。");
  return text;
}

const dayMs = 86400000;
// Calendar days from one date to a later one.
export const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs);

// The same day of the month `months` earlier, or that month's last day when it is shorter.
function monthsBefore(date, months) {
  const d = new Date(date + "T00:00:00Z"),
    n = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(Math.min(n, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
const monthPresets = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };
export const periodPresets = ["1d", "1w", "mtd", "3m", "6m", "ytd", "1y", "all"];

// A review period from its first day through `to`, the valuation date. Its gains are measured
// from the close of `base`, the day before it. A preset or chosen start earlier than the first
// record (`earliest`) is moved to that record; `requested` keeps the start asked for.
export function resolvePeriod({ to, period = "ytd", from, earliest }) {
  to = day(to);
  let start;
  if (from) start = day(from);
  else if (period === "1d") start = to;
  else if (period === "1w") start = shiftDay(to, -6);
  else if (period === "mtd") start = to.slice(0, 8) + "01";
  else if (period === "ytd") start = to.slice(0, 5) + "01-01";
  else if (period === "all") start = earliest && earliest <= to ? earliest : to;
  else if (monthPresets[period]) start = shiftDay(monthsBefore(to, monthPresets[period]), 1);
  else throw Error("无法识别的期间：" + period);
  if (start > to) throw Error("期间起点须早于或等于终点。");
  const requested = start,
    clipped = Boolean(earliest) && start < earliest && earliest <= to;
  if (clipped) start = earliest;
  return {
    preset: from ? "custom" : period,
    from: start,
    to,
    base: shiftDay(start, -1),
    days: daysBetween(start, to) + 1,
    clipped,
    requested,
  };
}

// A return over `days` calendar days, counted inclusive of both ends, as a yearly compound rate.
// Periods shorter than a year have none.
export function annualise(totalReturn, days) {
  return totalReturn == null || !(days >= 365) ? null : (1 + totalReturn) ** (365 / days) - 1;
}
