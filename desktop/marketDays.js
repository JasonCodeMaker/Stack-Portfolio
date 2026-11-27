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
  } else if (market === "FED") {
    // Board of Governors K.8 calendar used for H.15 publication.
    days.add(observed(date("01-01"), -1));
    if (weekday((year + 1) + "-01-01") === 6) days.add(date("12-31"));
    days.add(nth("01-01", 1, 3));
    days.add(nth("02-01", 1, 3));
    days.add(shiftDay(date("05-31"), -((weekday(date("05-31")) + 6) % 7)));
    if (year >= 2021) days.add(observed(date("06-19"), -1));
    days.add(observed(date("07-04"), -1));
    days.add(nth("09-01", 1, 1));
    days.add(nth("10-01", 1, 2));
    days.add(observed(date("11-11"), -1));
    days.add(nth("11-01", 4, 4));
    days.add(observed(date("12-25"), -1));
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

const clocks = Object.fromEntries(
  Object.entries({
    ASX: "Australia/Sydney",
    US: "America/New_York",
    FX: "America/New_York",
    local: "Australia/Brisbane",
  }).map(([key, timeZone]) => [
    key, new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }),
  ]),
);

export function marketTime(time, market = "local") {
  const fields = Object.fromEntries((clocks[market] || clocks.local).formatToParts(time).map((p) => [p.type, p.value]));
  return { date: [fields.year, fields.month, fields.day].join("-"), minute: Number(fields.hour) * 60 + Number(fields.minute) };
}

function sessionClose(date, market) {
  if (market === "ASX") {
    const year = date.slice(0, 4);
    const christmasEve = closingDay(year + "-12-24", market);
    const yearEnd = closingDay(year + "-12-31", market);
    return date === christmasEve || date === yearEnd ? 14 * 60 + 10 : 16 * 60;
  }
  const [year, month, dom] = date.split("-").map(Number);
  const short = (month === 11 && weekday(date) === 5 && dom >= 23 && dom <= 29) ||
    (month === 12 && dom === 24) ||
    (month === 7 && dom === 3 && weekday(date) !== 5);
  return short && year >= 1993 ? 13 * 60 : 16 * 60;
}

const officialCloseMinute = (date, market) =>
  sessionClose(date, market) + (market === "ASX" ? 11 : 0);

export function marketCloseTime(date, market) {
  const utcNoon = Date.parse(date + "T12:00:00Z");
  const local = marketTime(utcNoon, market);
  const dateOffset = Date.parse(date) - Date.parse(local.date);
  return utcNoon + dateOffset + (officialCloseMinute(date, market) - local.minute) * 60_000;
}

export function marketSession(time, market) {
  const { date, minute } = marketTime(time, market);
  if (market === "FX") {
    const dow = weekday(date);
    const open = dow === 0 ? minute >= 17 * 60 : dow === 5 ? minute < 17 * 60 : dow !== 6;
    return { date, phase: open ? "regular" : "closed" };
  }
  const prior = closingDay(shiftDay(date, -1), market);
  const close = sessionClose(date, market);
  const officialAfter = officialCloseMinute(date, market);
  if (closingDay(date, market) !== date)
    return { date, minute, phase: "closed", completed: prior, prior, officialAfter };
  let phase = "closed";
  if (market === "ASX") {
    if (minute >= 600 && minute < close) phase = "regular";
    else if (minute >= close && minute < officialAfter) phase = "auction";
  } else if (market === "US") {
    if (minute >= 240 && minute < 570) phase = "pre";
    else if (minute >= 570 && minute < close) phase = "regular";
    else if (minute >= close && minute < (close === 780 ? 1020 : 1200)) phase = "post";
  }
  return { date, minute, phase, completed: minute >= officialAfter ? date : prior, prior, officialAfter };
}
