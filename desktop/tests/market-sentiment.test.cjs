const assert = require("node:assert/strict");
const test = require("node:test");
const { macroSources, parseFinMindSentiment } = require("../out/macroSources.cjs");
const { createSentiment } = require("../out/marketSentiment.cjs");

const now = Date.parse("2026-11-26T20:00:00Z");
const earlier = { date: "2026-11-24", fear_greed: 22, fear_greed_emotion: "extreme fear" };
const latest = { date: "2026-11-25", fear_greed: 26.2, fear_greed_emotion: "fear" };
const reading = { score: 26.2, rating: "fear", observationDate: "2026-11-25" };
const payload = { status: 200, data: [latest, earlier] };

test("FinMind parser returns the most recent genuine score and supplied rating", () => {
  assert.deepEqual(parseFinMindSentiment(payload, "2026-11-26"), reading);
  assert.equal(parseFinMindSentiment({ status: 200, data: [{ ...earlier, fear_greed: 0 }] }, earlier.date).score, 0);
  assert.throws(() => parseFinMindSentiment(payload, earlier.date), /Invalid FinMind sentiment observation/);
  assert.throws(() => parseFinMindSentiment({ status: 200, data: [{ ...latest, fear_greed: 101 }] }, latest.date), /Invalid/);
  assert.throws(() => parseFinMindSentiment({ status: 200, data: [latest, latest] }, latest.date), /Invalid/);
});

test("FinMind requests use the fixed dataset and send the token only as a bearer credential", async () => {
  const sources = macroSources(async (url, options) => {
    const request = new URL(url);
    assert.equal(request.origin + request.pathname, "https://api.finmindtrade.com/api/v4/data");
    assert.equal(request.searchParams.get("dataset"), "CnnFearGreedIndex");
    assert.equal(request.searchParams.get("end_date"), "2026-11-26");
    assert.equal(request.searchParams.get("start_date"), "2026-11-12");
    assert.equal(request.searchParams.has("token"), false);
    assert.equal(options.headers.Authorization, "Bearer local-test-token");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    return Response.json(payload);
  });
  assert.deepEqual(await sources.sentiment("local-test-token", now), reading);

  const denied = macroSources(async () => new Response(null, { status: 400 }));
  await assert.rejects(denied.sentiment("local-test-token", now), { status: 400 });
});

test("per-install sentiment survives restart and transient failure, and clears on denial or disconnect", async () => {
  let clock = now;
  let stored;
  let calls = 0;
  let error;
  const options = {
    fetchScore: async (token) => {
      assert.equal(token, "local-test-token");
      calls++;
      if (error) throw error;
      return reading;
    },
    readPrivate: () => stored,
    writePrivate: (value) => { stored = value; },
    now: () => clock,
  };
  const sentiment = createSentiment(options);
  await sentiment.refresh();
  assert.equal(sentiment.snapshot().reason, "notConfigured");
  assert.equal(calls, 0);
  await assert.rejects(sentiment.configure("bad token"), /Invalid FinMind token/);
  const first = await sentiment.configure("local-test-token");
  assert.equal(first.status, "available");
  assert.equal(first.score, reading.score);
  assert.equal(first.token, undefined);
  await sentiment.refresh();
  assert.equal(calls, 1);

  const restarted = createSentiment(options);
  assert.deepEqual(restarted.snapshot(), first);
  clock += 60 * 60_000;
  error = Error("offline");
  await restarted.refresh();
  assert.equal(restarted.snapshot().status, "stale");
  assert.equal(restarted.snapshot().score, reading.score);
  assert.equal(restarted.snapshot().reason, "sourceUnavailable");

  clock += 5 * 60_000;
  error = Object.assign(Error("access denied"), { status: 403 });
  await restarted.refresh();
  assert.equal(restarted.snapshot().status, "unavailable");
  assert.equal(restarted.snapshot().reason, "authorizationFailed");
  assert.equal(restarted.snapshot().score, null);
  assert.equal(createSentiment(options).snapshot().score, null);
  const disconnected = await restarted.configure(null);
  assert.equal(disconnected.configured, false);
  assert.equal(stored, null);
});

test("a previously configured token cannot restore a reading after disconnect", async () => {
  let finish;
  let stored;
  const sentiment = createSentiment({
    fetchScore: () => new Promise((resolve) => { finish = resolve; }),
    readPrivate: () => stored,
    writePrivate: (value) => { stored = value; },
    now: () => now,
  });
  const inFlight = sentiment.configure("local-test-token");
  assert.equal((await sentiment.configure(null)).status, "unavailable");
  finish(reading);
  assert.equal((await inFlight).score, null);
  assert.equal(stored, null);
});
