const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const test = require("node:test");
const { createMacroMarket } = require("../out/macroMarket.cjs");
const { macroSources, parseCpi, parseCpiSchedule, parseTreasuryXml } = require("../out/macroSources.cjs");

const treasury = {
  sourceReleaseDate: "2026-11-25",
  latest: { date: "2026-11-24", valuePct: 4.91 },
  previous: { date: "2026-11-23", valuePct: 4.92 },
  changeBp: -1,
  history: [{ date: "2026-11-24", valuePct: 4.91 }],
};
const cpi = {
  referenceMonth: "2026-10",
  indexValue: 337.511,
  yearOverYearPct: null,
  yearOverYearStatus: "missingComparison",
};
const schedule = [
  { referenceMonth: "2026-10", scheduledAt: "2026-11-10T13:30:00.000Z" },
  { referenceMonth: "2026-11", scheduledAt: "2026-12-10T13:30:00.000Z" },
  { referenceMonth: "2026-12", scheduledAt: "2027-01-13T13:30:00.000Z" },
];

test("H.15 selects the daily 10-year series and compares valid readings across a gap", async () => {
  const xml = [
    '<data xmlns:message="m" xmlns:kf="k" xmlns:frb="f"><message:Prepared>2026-11-25T16:40:02</message:Prepared>',
    '<kf:Series SERIES_NAME="OTHER"><frb:Obs TIME_PERIOD="2026-11-25" OBS_VALUE="2.00" OBS_STATUS="A"/></kf:Series>',
    '<kf:Series SERIES_NAME="RIFLGFCY10_N.B">',
    '<frb:Obs TIME_PERIOD="2026-11-24" OBS_VALUE="4.91" OBS_STATUS="A"/>',
    '<frb:Obs TIME_PERIOD="2026-11-23" OBS_STATUS="ND"/>',
    '<frb:Obs TIME_PERIOD="2026-11-21" OBS_VALUE="4.92" OBS_STATUS="A"/>',
    '<frb:Obs TIME_PERIOD="2024-11-22" OBS_VALUE="4.90" OBS_STATUS="A"/>',
    '</kf:Series></data>',
  ];
  const result = await parseTreasuryXml(Readable.from(xml.map((chunk) => Buffer.from(chunk))));
  assert.deepEqual(result, {
    sourceReleaseDate: "2026-11-25",
    latest: { date: "2026-11-24", valuePct: 4.91 },
    previous: { date: "2026-11-21", valuePct: 4.92 },
    changeBp: -1,
    history: [
      { date: "2026-11-21", valuePct: 4.92 },
      { date: "2026-11-23", valuePct: null },
      { date: "2026-11-24", valuePct: 4.91 },
    ],
  });
  const one = await parseTreasuryXml(Readable.from(xml.filter((line) =>
    !line.includes('TIME_PERIOD="2026-11-21"') && !line.includes('TIME_PERIOD="2024-11-22"'),
  )));
  assert.equal(one.latest.valuePct, 4.91);
  assert.equal(one.previous, null);
  assert.equal(one.changeBp, null);
  await assert.rejects(
    parseTreasuryXml(Readable.from(xml.slice(0, -1))),
    /H.15 release or 10-year observations are missing/,
  );
});

test("BLS CPI uses the matching month last year and preserves missing comparison data", () => {
  const observations = [
    { year: "2025", period: "M09", value: "324.800" },
    { year: "2025", period: "M10", value: "-" },
    { year: "2026", period: "M13", value: "390.000" },
    { year: "2026", period: "M10", value: "337.511" },
  ];
  const payload = {
    status: "REQUEST_SUCCEEDED",
    Results: { series: [{ seriesID: "CUUR0000SA0", data: observations }] },
  };
  assert.deepEqual(parseCpi(payload), cpi);
  observations.push({ year: "2026", period: "M09", value: "336.940" });
  observations[3].value = "-";
  assert.deepEqual(parseCpi(payload), {
    referenceMonth: "2026-09",
    indexValue: 336.940,
    yearOverYearPct: 3.7,
    yearOverYearStatus: "available",
  });
});

test("official BLS release rows convert Eastern Time across daylight saving changes", () => {
  const html = [
    "<table><tr><th>Reference Month</th><th>Release Date</th><th>Release Time</th></tr>",
    "<tr><td>March 2027</td><td><span>Apr. 13, 2027</span></td><td>08:30&nbsp;AM</td></tr>",
    "<tr><td>February 2027</td><td>Mar. 10, 2027</td><td>08:30 AM</td></tr></table>",
  ].join("");
  assert.deepEqual(parseCpiSchedule(html), [
    { referenceMonth: "2027-02", scheduledAt: "2027-03-10T13:30:00.000Z" },
    { referenceMonth: "2027-03", scheduledAt: "2027-04-13T12:30:00.000Z" },
  ]);
  assert.throws(() => parseCpiSchedule("<html>Access Denied</html>"), /schedule is missing/);
});

test("providers use bounded unauthenticated requests and reject an oversized download", async () => {
  const sources = macroSources(async (url, options) => {
    assert.equal(new URL(url).origin, "https://www.federalreserve.gov");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response("too large", { headers: { "content-length": "20000000" } });
  });
  await assert.rejects(sources.treasury(), /usable response/);
});

test("refresh coalesces requests and preserves independent public data across restart", async () => {
  let clock = Date.parse("2026-11-26T16:00:00Z");
  let treasuryFails = false;
  let cpiRegresses = false;
  let stored;
  let saves = 0;
  const calls = { treasury: 0, cpi: 0, schedule: 0 };
  const options = {
    providers: {
      async treasury() {
        calls.treasury++;
        if (treasuryFails) throw Error("offline");
        return treasury;
      },
      async cpi() {
        calls.cpi++;
        if (cpiRegresses) return { ...cpi, referenceMonth: "2026-09" };
        return cpi;
      },
      async schedule() {
        calls.schedule++;
        throw Error("BLS calendar returned 403");
      },
    },
    readCache: () => stored,
    writeCache: (data) => { stored = data; saves++; },
    now: () => clock,
  };
  const market = createMacroMarket(options);
  const initial = market.snapshot();
  assert.deepEqual(initial.market, { date: "2026-11-26", phase: "closed", timeZone: "America/New_York" });
  assert.equal(initial.treasury.status, "unavailable");
  assert.deepEqual(initial.cpi.schedule.upcoming, schedule[1]);
  assert.equal(initial.cpi.schedule.status, "bundled");
  assert.equal(initial.sentiment.score, null);
  const [first, repeated] = await Promise.all([market.refresh(), market.refresh()]);
  assert.deepEqual(first, repeated);
  assert.deepEqual(calls, { treasury: 1, cpi: 1, schedule: 1 });
  assert.equal(saves, 2);
  assert.equal(first.cpi.latest.publishedAt, null);
  assert.equal(first.cpi.latest.firstSeenAt, first.cpi.fetchedAt);
  assert.equal(first.cpi.latest.scheduledAt, schedule[0].scheduledAt);
  await market.refresh();
  assert.deepEqual(calls, { treasury: 1, cpi: 1, schedule: 1 });

  clock += 25 * 60 * 60 * 1000;
  treasuryFails = true;
  const second = await market.refresh();
  assert.equal(second.treasury.status, "stale");
  assert.equal(second.treasury.fetchedAt, first.treasury.fetchedAt);
  assert.deepEqual(second.treasury.data, treasury);
  assert.equal(second.cpi.status, "available");
  assert.equal(second.cpi.latest.firstSeenAt, first.cpi.latest.firstSeenAt);
  assert.notEqual(second.cpi.fetchedAt, first.cpi.fetchedAt);
  const restarted = createMacroMarket(options);
  assert.deepEqual(restarted.snapshot().treasury.data, treasury);
  assert.equal(restarted.snapshot().treasury.status, "stale");

  clock += 25 * 60 * 60 * 1000;
  cpiRegresses = true;
  const third = await restarted.refresh();
  assert.equal(third.cpi.status, "stale");
  assert.equal(third.cpi.latest.referenceMonth, "2026-10");
  assert.equal(third.cpi.latest.firstSeenAt, first.cpi.latest.firstSeenAt);
});

test("crossing the official CPI release time triggers a check ahead of the daily refresh", async () => {
  let clock = Date.parse("2026-12-10T13:25:00Z");
  let cpiCalls = 0;
  let released = false;
  let stored = "corrupt JSON";
  const options = {
    providers: {
      treasury: async () => treasury,
      cpi: async () => { cpiCalls++; return released ? { ...cpi, referenceMonth: "2026-11" } : cpi; },
      schedule: async () => schedule,
    },
    readCache: () => stored,
    writeCache: (data) => { stored = data; },
    now: () => clock,
  };
  const market = createMacroMarket(options);
  const before = await market.refresh();
  assert.equal(before.cpi.schedule.status, "available");
  assert.deepEqual(before.cpi.schedule.upcoming, schedule[1]);
  assert.equal(before.cpi.schedule.awaiting, null);

  clock = Date.parse("2026-12-10T13:30:00Z");
  const due = await market.refresh();
  assert.equal(cpiCalls, 2);
  assert.deepEqual(due.cpi.schedule.awaiting, schedule[1]);

  clock = Date.parse("2026-12-10T13:35:00Z");
  const restarted = createMacroMarket(options);
  assert.deepEqual((await restarted.refresh()).cpi.schedule.awaiting, schedule[1]);
  assert.equal(cpiCalls, 2);

  clock = Date.parse("2026-12-10T15:00:00Z");
  released = true;
  const after = await restarted.refresh();
  assert.equal(cpiCalls, 3);
  assert.equal(after.cpi.latest.referenceMonth, "2026-11");
  assert.equal(after.cpi.latest.firstSeenAt, "2026-12-10T15:00:00.000Z");
  assert.deepEqual(after.cpi.schedule.upcoming, schedule[2]);
  assert.equal(after.cpi.schedule.awaiting, null);
});

test("H.15 publication waits on the Board calendar and retries a late release", async () => {
  let clock = Date.parse("2026-11-11T21:20:00Z");
  let calls = 0;
  let releaseDate = "2026-11-10";
  const market = createMacroMarket({
    providers: {
      treasury: async () => {
        calls++;
        return {
          ...treasury,
          sourceReleaseDate: releaseDate,
          latest: { date: "2026-11-09", valuePct: 4.91 },
          previous: { date: "2026-11-06", valuePct: 4.92 },
          history: [],
        };
      },
      cpi: async () => cpi,
      schedule: async () => schedule,
    },
    readCache() {},
    writeCache() {},
    now: () => clock,
  });

  const holiday = await market.refresh();
  assert.equal(holiday.market.phase, "post");
  assert.deepEqual(holiday.treasury.publication, { expectedReleaseDate: "2026-11-10", status: "released" });
  assert.equal(calls, 1);

  clock = Date.parse("2026-11-12T21:15:00Z");
  const late = await market.refresh();
  assert.deepEqual(late.treasury.publication, { expectedReleaseDate: "2026-11-12", status: "awaiting" });
  assert.equal(late.treasury.data.sourceReleaseDate, "2026-11-10");
  assert.equal(calls, 2);

  clock = Date.parse("2026-11-12T21:20:00Z");
  releaseDate = "2026-11-12";
  const arrived = await market.refresh();
  assert.equal(arrived.treasury.publication.status, "released");
  assert.equal(calls, 3);
});
