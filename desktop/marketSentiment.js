import { marketSession } from "./marketDays.js";

const refreshInterval = 60 * 60_000;
const failureInterval = 5 * 60_000;

export function createSentiment({ fetchScore, readPrivate, writePrivate, now = Date.now }) {
  let config;
  let pending;
  let attemptedAt = -Infinity;
  let failure = null;

  function load() {
    if (config !== undefined) return;
    try {
      const saved = readPrivate();
      config = saved?.token ? saved : null;
    } catch {
      config = null;
    }
  }

  function snapshot(at = now()) {
    load();
    const reading = config?.reading;
    const stale = reading && (failure || reading.observationDate < marketSession(at, "US").prior);
    return {
      source: "CNN Fear & Greed Index",
      provider: "FinMind",
      configured: config !== null,
      status: reading ? (stale ? "stale" : "available") : "unavailable",
      reason: config ? failure ?? (reading ? (stale ? "oldObservation" : null) : "notFetched") : "notConfigured",
      score: reading?.score ?? null,
      rating: reading?.rating ?? null,
      observationDate: reading?.observationDate ?? null,
      fetchedAt: reading?.fetchedAt ?? null,
    };
  }

  async function fetchLatest(current, at) {
    try {
      const data = await fetchScore(current.token, at);
      if (config !== current) return;
      if (current.reading && data.observationDate < current.reading.observationDate)
        throw Error("FinMind sentiment observation regressed");
      config = { token: current.token, reading: { ...data, fetchedAt: new Date(now()).toISOString() } };
      failure = null;
    } catch (err) {
      if (config !== current) return;
      failure = [400, 401, 403].includes(err?.status) ? "authorizationFailed" : "sourceUnavailable";
      if (failure !== "authorizationFailed" || !current.reading) return;
      config = { token: current.token, reading: null };
    }
    try {
      writePrivate(config);
    } catch {
      // The current reading remains available in memory if the encrypted cache cannot be updated.
    }
  }

  async function refresh(at = now()) {
    load();
    if (!config) return;
    if (pending?.token === config.token) return pending.task;
    const readingTime = Date.parse(config.reading?.fetchedAt);
    if ((!failure && at - readingTime < refreshInterval) || at - attemptedAt < failureInterval) return;
    attemptedAt = at;
    const current = config;
    const task = fetchLatest(current, at);
    pending = { token: current.token, task };
    try {
      await task;
    } finally {
      if (pending?.task === task) pending = undefined;
    }
  }

  async function configure(value) {
    load();
    const token = typeof value === "string" ? value.trim() : value;
    if (token !== null && (typeof token !== "string" || !/^[A-Za-z0-9._~+\/=-]{1,4096}$/.test(token)))
      throw Error("Invalid FinMind token");
    if (token !== config?.token && (token !== null || config)) {
      const next = token === null ? null : { token, reading: null };
      writePrivate(next);
      config = next;
      failure = null;
      pending = undefined;
      attemptedAt = -Infinity;
    }
    await refresh();
    return snapshot();
  }

  return { snapshot, refresh, configure };
}
