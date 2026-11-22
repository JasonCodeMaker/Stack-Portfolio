// A close may carry across an exchange holiday, never across a missing trading session.
const dayMs = 86400000;
export const shiftDay = (date, days) => new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
const weekday = (date) => new Date(date).getUTCDay();
const usExchanges = new Set(["XNAS", "XNYS", "ARCX", "XASE", "BATS", "NASDAQ", "NYSE"]);
export function marketFor(asset) {
  if (usExchanges.has(asset?.mic)) return "US";
  if (["XASX", "ASX"].includes(asset?.mic)) return "ASX";
  return /CRYPTO/i.test(asset?.kind || "") ? "DAILY" : "WEEKDAY";
}

// Gregorian Easter, used by both cash-market calendars.
function easter(year) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const n = h + l - 7 * Math.floor((a + 11 * h + 22 * l) / 451) + 114;
  return new Date(Date.UTC(year, Math.floor(n / 31) - 1, (n % 31) + 1)).toISOString().slice(0, 10);
}
const closures = new Map();
function holidays(market, year) {
  const key = market + year;
  if (closures.has(key)) return closures.get(key);
  const date = (mmdd) => year + "-" + mmdd;
  const observed = (d, saturdayOffset) =>
    shiftDay(d, weekday(d) === 6 ? saturdayOffset : weekday(d) === 0 ? 1 : 0);
  const nth = (first, dow, week) =>
    shiftDay(date(first), ((dow - weekday(date(first)) + 7) % 7) + (week - 1) * 7);
  const days = new Set();
  if (market === "US") {
    // NYSE cash-market calendar. A Saturday New Year does not close the previous year.
    days.add(observed(date("01-01"), 0));
    if (year >= 1998) days.add(nth("01-01", 1, 3));
    days.add(nth("02-01", 1, 3));
    days.add(shiftDay(easter(year), -2));
    days.add(shiftDay(date("05-31"), -((weekday(date("05-31")) + 6) % 7)));
    if (year >= 2022) days.add(observed(date("06-19"), -1));
    days.add(observed(date("07-04"), -1));
    days.add(nth("09-01", 1, 1));
    days.add(nth("11-01", 4, 4));
    days.add(observed(date("12-25"), -1));
    for (const d of [
      "1994-04-27",
      "2001-09-11",
      "2001-09-12",
      "2001-09-13",
      "2001-09-14",
      "2004-06-11",
      "2007-01-02",
      "2012-10-29",
      "2012-10-30",
      "2018-12-05",
      "2025-01-09",
    ])
      days.add(d);
  } else if (market === "ASX") {
    days.add(observed(date("01-01"), 2));
    days.add(observed(date("01-26"), 2));
    days.add(shiftDay(easter(year), -2));
    days.add(shiftDay(easter(year), 1));
    days.add(date("04-25"));
    days.add(nth("06-01", 1, 2));
    const christmas = observed(date("12-25"), 2);
    const boxing = observed(date("12-26"), 2);
    days.add(christmas);
    days.add(boxing === christmas ? shiftDay(boxing, 1) : boxing);
    days.add("2022-09-22");
  } else if (market === "FX") {
    days.add(date("01-01"));
    days.add(date("12-25"));
  }
  closures.set(key, days);
  return days;
}
export function closingDay(date, market) {
  if (market === "DAILY") return date;
  let d = date;
  while ([0, 6].includes(weekday(d)) || holidays(market, Number(d.slice(0, 4))).has(d)) d = shiftDay(d, -1);
  return d;
}
