import { closingDay, marketSession, marketTime, shiftDay } from "./marketDays.js";
import { bundledCpiSchedule, isDate, validFearGreedReading } from "./macroSources.js";

const minute = 60_000;
const day = 24 * 60 * minute;
const retry = 5 * minute;
const cpiRetry = 90 * minute;
const h15ReleaseMinute = 16 * 60 + 15;
const sources = {
  treasury: { refresh: day, staleAfter: 2 * day },
  cpi: { refresh: day, staleAfter: 2 * day },
  schedule: { refresh: day, staleAfter: 2 * day },
  sentiment: { refresh: 15 * minute, staleAfter: 2 * day },
};

const sourceNames = {
  treasury: "Federal Reserve Board",
  cpi: "U.S. Bureau of Labor Statistics",
  schedule: "U.S. Bureau of Labor Statistics",
};

const isTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const isMonth = (value) => typeof value === "string" && isDate(value + "-01");
const isObservation = (row) => isDate(row?.date) && Number.isFinite(row.valuePct);

function expectedTreasuryRelease(at) {
  const eastern = marketTime(at, "US");
  const effectiveDate = eastern.minute >= h15ReleaseMinute ? eastern.date : shiftDay(eastern.date, -1);
  return closingDay(effectiveDate, "FED");
}

function validRecord(key, record) {
  if (!isTimestamp(record?.fetchedAt)) return false;
  const data = record.data;
  if (key === "treasury") {
    return isDate(data?.sourceReleaseDate) && isObservation(data.latest) &&
      (data.previous === null ? data.changeBp === null : isObservation(data.previous) && Number.isFinite(data.changeBp)) && Array.isArray(data.history) && data.history.length <= 400 &&
      data.history.every((row) => isDate(row?.date) && (row.valuePct === null || Number.isFinite(row.valuePct)));
  }
  if (key === "cpi") {
    return isMonth(data?.referenceMonth) && Number.isFinite(data.indexValue) && isTimestamp(record.firstSeenAt) &&
      (data.yearOverYearPct === null || Number.isFinite(data.yearOverYearPct));
  }
  if (key === "sentiment") return validFearGreedReading(data);
  return Array.isArray(data) && data.length > 0 &&
    data.every((event) => isMonth(event?.referenceMonth) && isTimestamp(event.scheduledAt));
}

export function createMacroMarket({ providers, readCache, writeCache, now = Date.now }) {
  const attempts = {};
  let records;
  let pending;

  function load() {
    if (records) return;
    records = {};
    try {
      const saved = JSON.parse(readCache());
      if (saved.version !== 1) return;
      if (Number.isSafeInteger(saved.lastCpiAttemptAt)) attempts.cpi = saved.lastCpiAttemptAt;
      for (const key of Object.keys(sources)) {
        if (validRecord(key, saved.records?.[key])) records[key] = saved.records[key];
      }
    } catch {
      // A missing or unreadable public cache can be rebuilt on refresh.
    }
  }

  function scheduleEvents() {
    return records.schedule?.data ?? bundledCpiSchedule;
  }

  function status(key, at) {
    const record = records[key];
    if (!record) return "unavailable";
    return record.failed || at - Date.parse(record.fetchedAt) >= sources[key].staleAfter ? "stale" : "available";
  }

  function snapshot(at = now()) {
    load();
    const { date, phase, completed } = marketSession(at, "US");
    const treasury = records.treasury;
    const expectedReleaseDate = expectedTreasuryRelease(at);
    const cpi = records.cpi;
    const releaseMonth = cpi?.data.referenceMonth;
    const events = scheduleEvents();
    const relevant = events.filter((event) => !releaseMonth || event.referenceMonth > releaseMonth);
    const lastScheduled = events.find((event) => event.referenceMonth === releaseMonth) ??
      bundledCpiSchedule.find((event) => event.referenceMonth === releaseMonth);
    const upcoming = relevant.find((event) => Date.parse(event.scheduledAt) > at) ?? null;
    const awaiting = relevant.findLast((event) => Date.parse(event.scheduledAt) <= at) ?? null;
    const sentiment = records.sentiment;
    const updatedAt = sentiment?.data.updatedAt ?? null;
    const priorSession = sentiment && (sentiment.data.observationDate < completed ||
      marketTime(Date.parse(updatedAt), "US").date < completed);
    return {
      market: { date, phase, timeZone: "America/New_York" },
      treasury: {
        source: sourceNames.treasury,
        status: status("treasury", at),
        fetchedAt: treasury?.fetchedAt ?? null,
        publication: {
          expectedReleaseDate,
          status: treasury?.data.sourceReleaseDate >= expectedReleaseDate ? "released" : "awaiting",
        },
        data: treasury?.data ?? null,
      },
      cpi: {
        source: sourceNames.cpi,
        status: status("cpi", at),
        fetchedAt: cpi?.fetchedAt ?? null,
        latest: cpi ? {
          ...cpi.data,
          scheduledAt: lastScheduled?.scheduledAt ?? null,
          publishedAt: null,
          firstSeenAt: cpi.firstSeenAt,
        } : null,
        schedule: {
          source: sourceNames.schedule,
          status: upcoming ? (records.schedule ? status("schedule", at) : "bundled") :
            (awaiting ? "stale" : "unavailable"),
          fetchedAt: records.schedule?.fetchedAt ?? null,
          upcoming,
          awaiting,
        },
      },
      sentiment: {
        source: "Fear & Greed Flow",
        status: priorSession ? "stale" : status("sentiment", at),
        score: sentiment?.data.score ?? null,
        rating: sentiment?.data.rating ?? null,
        updatedAt,
        fetchedAt: sentiment?.fetchedAt ?? null,
      },
    };
  }

  function due(key, at) {
    const record = records[key];
    const lastAttempt = attempts[key] ?? -Infinity;
    const fetched = Date.parse(record?.fetchedAt);
    if (key === "cpi") {
      const releaseDue = scheduleEvents().findLast(({ referenceMonth, scheduledAt }) => {
        const scheduled = Date.parse(scheduledAt);
        return (!record || referenceMonth > record.data.referenceMonth) &&
          scheduled <= at && scheduled > at - 3 * day;
      });
      // The public BLS API allows 25 queries per day. Persist a 90-minute retry interval
      // across restarts, with one earlier attempt when a new release becomes due.
      if (releaseDue && Date.parse(releaseDue.scheduledAt) > lastAttempt) return true;
      if (at - lastAttempt < cpiRetry) return false;
      return !record || record.failed || !!releaseDue || at - fetched >= sources.cpi.refresh;
    }
    const retryAfter = key === "schedule" ? sources.schedule.refresh : retry;
    if (at - lastAttempt < retryAfter) return false;
    if (!record || record.failed || at - fetched >= sources[key].refresh) return true;
    if (key === "treasury" && record.data.sourceReleaseDate < expectedTreasuryRelease(at)) {
      const eastern = marketTime(at, "US");
      return at - fetched >= 60 * minute || (expectedTreasuryRelease(at) === eastern.date &&
        eastern.minute < h15ReleaseMinute + 120);
    }
    return false;
  }

  async function update(key, at) {
    attempts[key] = at;
    const old = records[key];
    try {
      const data = await providers[key]();
      const fetchedAt = new Date(now()).toISOString();
      const record = { data, fetchedAt };
      if (key === "treasury" && old && (data.sourceReleaseDate < old.data.sourceReleaseDate ||
          data.latest.date < old.data.latest.date)) throw Error("H.15 release regressed");
      if (key === "cpi") {
        if (old && data.referenceMonth < old.data.referenceMonth) throw Error("BLS CPI release regressed");
        record.firstSeenAt = old?.data.referenceMonth === data.referenceMonth ? old.firstSeenAt : fetchedAt;
      }
      if (key === "schedule" && !data.some((event) => Date.parse(event.scheduledAt) > at))
        throw Error("BLS CPI calendar has no upcoming release");
      if (!validRecord(key, record)) throw Error("Invalid macro source data");
      if (key === "sentiment" && (Date.parse(data.updatedAt) > Date.parse(fetchedAt) + minute ||
          (old && Date.parse(data.updatedAt) < Date.parse(old.data.updatedAt))))
        throw Error("Fear & Greed Flow update time is inconsistent");
      records[key] = record;
      return true;
    } catch {
      if (!old || old.failed) return false;
      records[key] = { ...old, failed: true };
      return true;
    }
  }

  function save() {
    try {
      writeCache(JSON.stringify({ version: 1, records, lastCpiAttemptAt: attempts.cpi }));
    } catch {
      // Keep the successful public readings usable for this session.
    }
  }

  async function refreshSources() {
    const at = now();
    const keys = Object.keys(sources).filter((key) => due(key, at));
    if (keys.includes("cpi")) {
      attempts.cpi = at;
      save();
    }
    const changed = await Promise.all(keys.map((key) => update(key, at)));
    if (changed.some(Boolean)) save();
    return snapshot();
  }

  function refresh() {
    load();
    pending ??= refreshSources().finally(() => { pending = undefined; });
    return pending;
  }

  return { snapshot: () => snapshot(), refresh };
}
