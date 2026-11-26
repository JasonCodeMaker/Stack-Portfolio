import sax from "sax";
import yauzl from "yauzl";
import { marketTime, shiftDay } from "./marketDays.js";

const h15Url = "https://www.federalreserve.gov/releases/h15/data/FRB_h15_xml.zip";
const cpiSeries = "CUUR0000SA0";
const cpiUrl = "https://api.bls.gov/publicAPI/v2/timeseries/data/" + cpiSeries;
const scheduleUrl = "https://www.bls.gov/schedule/news_release/cpi.htm";
const h15Series = "RIFLGFCY10_N.B";
const finMindUrl = "https://api.finmindtrade.com/api/v4/data";
const sentimentRatings = new Set(["extreme fear", "fear", "neutral", "greed", "extreme greed"]);
const mib = 1024 * 1024;
const xmlLimit = 100 * mib;
const maxHistoryDays = 366;
const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function finiteNumber(value) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readResponse(fetch, url, byteLimit, headers) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > byteLimit) {
    await response.body?.cancel();
    throw Object.assign(Error("Macro source did not return a usable response"), { status: response.status });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > byteLimit) throw Error("Macro source response exceeded the size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

export async function parseTreasuryXml(stream) {
  const parser = sax.parser(true);
  const observations = new Map();
  let prepared = "";
  let readingPrepared = false;
  let inSeries = false;
  let complete = false;
  parser.onopentag = ({ name, attributes }) => {
    if (name === "message:Prepared") readingPrepared = true;
    if (name === "kf:Series" && attributes.SERIES_NAME === h15Series) inSeries = true;
    if (!inSeries || name !== "frb:Obs") return;
    const date = attributes.TIME_PERIOD;
    if (!isDate(date)) throw Error("Invalid H.15 observation date");
    const valuePct = attributes.OBS_STATUS === "A" ? finiteNumber(attributes.OBS_VALUE) : null;
    if (attributes.OBS_STATUS === "A" && valuePct === null) throw Error("Invalid H.15 observation value");
    if (observations.has(date)) throw Error("Duplicate H.15 observation date");
    observations.set(date, { date, valuePct });
  };
  parser.ontext = (value) => {
    if (readingPrepared) prepared += value;
  };
  parser.onclosetag = (name) => {
    if (name === "message:Prepared") readingPrepared = false;
    if (inSeries && name === "kf:Series") {
      inSeries = false;
      complete = true;
    }
  };
  let bytes = 0;
  for await (const chunk of stream.setEncoding("utf8")) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > xmlLimit) throw Error("H.15 XML exceeded the size limit");
    parser.write(chunk);
    if (complete) break;
  }
  if (!complete) parser.close();
  const sourceReleaseDate = prepared.trim().slice(0, 10);
  const rows = [...observations.values()].sort((a, b) => a.date.localeCompare(b.date));
  const [latest, previous = null] = rows.filter((row) => row.valuePct !== null).slice(-2).reverse();
  if (!complete || !isDate(sourceReleaseDate) || !latest || latest.date > sourceReleaseDate)
    throw Error("H.15 release or 10-year observations are missing");

  const cutoff = shiftDay(latest.date, -maxHistoryDays);
  return {
    sourceReleaseDate,
    latest,
    previous,
    changeBp: previous ? Math.round((latest.valuePct - previous.valuePct) * 100) : null,
    history: rows.filter(({ date }) => date >= cutoff && date <= sourceReleaseDate),
  };
}

export function parseCpi(payload) {
  const series = payload?.Results?.series?.find(({ seriesID }) => seriesID === cpiSeries);
  if (payload?.status !== "REQUEST_SUCCEEDED" || !Array.isArray(series?.data))
    throw Error("BLS CPI series is missing");
  const observations = new Map();
  for (const row of series.data) {
    if (!/^\d{4}$/.test(row.year) || !/^M(0[1-9]|1[0-2])$/.test(row.period)) continue;
    const month = row.year + "-" + row.period.slice(1);
    const value = finiteNumber(row.value);
    if (observations.has(month)) throw Error("Duplicate BLS CPI reference month");
    observations.set(month, value > 0 ? value : null);
  }
  const referenceMonth = [...observations.keys()].sort().findLast((month) => observations.get(month) !== null);
  if (!referenceMonth) throw Error("BLS CPI observations are missing");
  const comparisonMonth = String(Number(referenceMonth.slice(0, 4)) - 1) + referenceMonth.slice(4);
  const indexValue = observations.get(referenceMonth);
  const base = observations.get(comparisonMonth);
  return {
    referenceMonth,
    indexValue,
    yearOverYearPct: base ? Number(((indexValue / base - 1) * 100).toFixed(1)) : null,
    yearOverYearStatus: base ? "available" : "missingComparison",
  };
}

function eventInEasternTime(referenceMonth, date, hour, minute) {
  if (!isDate(referenceMonth + "-01") || !isDate(date) || date.slice(0, 7) <= referenceMonth)
    throw Error("Invalid BLS release date");
  const noonUtc = Date.parse(date + "T12:00:00Z");
  const eastern = marketTime(noonUtc, "US");
  return {
    referenceMonth,
    scheduledAt: new Date(noonUtc + (hour * 60 + minute - eastern.minute) * 60_000).toISOString(),
  };
}

function monthNumber(text) {
  return String(months.findIndex((month) => month.slice(0, 3) === text.slice(0, 3)) + 1).padStart(2, "0");
}

export function parseCpiSchedule(html) {
  const events = [];
  for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const cells = Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), ([, cell]) =>
      cell.replace(/<[^>]+>|&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim(),
    );
    if (cells.length !== 3) continue;
    const reference = /^([A-Za-z]+) (\d{4})$/.exec(cells[0]);
    const release = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(cells[1]);
    const time = /^(0?[1-9]|1[0-2]):([0-5]\d) ([AP]M)$/.exec(cells[2]);
    if (!reference || !release || !time) continue;
    const referenceMonth = reference[2] + "-" + monthNumber(reference[1]);
    const date = [release[3], monthNumber(release[1]), release[2].padStart(2, "0")].join("-");
    const hour = Number(time[1]) % 12 + (time[3] === "PM" ? 12 : 0);
    events.push(eventInEasternTime(referenceMonth, date, hour, Number(time[2])));
  }
  if (!events.length || new Set(events.map(({ referenceMonth }) => referenceMonth)).size !== events.length)
    throw Error("BLS CPI schedule is missing or ambiguous");
  return events.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

// BLS CPI release calendar checked on 2026-11-26. Keep the finite fallback identifiable in the snapshot.
export const bundledCpiSchedule = [
  ["2026-10", "2026-11-10"], ["2026-11", "2026-12-10"], ["2026-12", "2027-01-13"],
  ["2027-01", "2027-02-11"], ["2027-02", "2027-03-10"], ["2027-03", "2027-04-13"],
  ["2027-04", "2027-05-12"], ["2027-05", "2027-06-10"], ["2027-06", "2027-07-14"],
  ["2027-07", "2027-08-11"], ["2027-08", "2027-09-14"], ["2027-09", "2027-10-14"],
  ["2027-10", "2027-11-10"], ["2027-11", "2027-12-10"],
].map(([month, date]) => eventInEasternTime(month, date, 8, 30));

export function parseFinMindSentiment(payload, throughDate) {
  if (payload?.status !== 200) {
    throw Object.assign(Error("FinMind did not return the CNN dataset"), { status: payload?.status });
  }
  if (!Array.isArray(payload.data) || !payload.data.length) throw Error("FinMind sentiment observations are missing");
  const rows = new Map();
  for (const row of payload.data) {
    const date = row?.date;
    const score = row?.fear_greed;
    const rating = typeof row?.fear_greed_emotion === "string" ? row.fear_greed_emotion.trim().toLowerCase() : "";
    if (!isDate(date) || date > throughDate || !Number.isFinite(score) || score < 0 || score > 100 ||
        !sentimentRatings.has(rating) || rows.has(date)) throw Error("Invalid FinMind sentiment observation");
    rows.set(date, { score, rating, observationDate: date });
  }
  return rows.get([...rows.keys()].sort().at(-1));
}

export function macroSources(fetch) {
  return {
    async sentiment(token, at) {
      const date = marketTime(at, "US").date;
      const url = new URL(finMindUrl);
      url.search = new URLSearchParams({
        dataset: "CnnFearGreedIndex",
        start_date: shiftDay(date, -14),
        end_date: date,
      });
      const body = await readResponse(fetch, url.toString(), mib, { Authorization: "Bearer " + token });
      return parseFinMindSentiment(JSON.parse(body.toString("utf8")), date);
    },
    async treasury() {
      const download = await readResponse(fetch, h15Url, 10 * mib);
      const archive = await yauzl.fromBufferPromise(download);
      try {
        for await (const entry of archive.eachEntry()) {
          if (entry.fileName !== "H15_data.xml") continue;
          if (entry.uncompressedSize > xmlLimit) break;
          return await parseTreasuryXml(await archive.openReadStreamPromise(entry));
        }
        throw Error("H.15 archive did not contain usable data");
      } finally {
        archive.close();
      }
    },
    async cpi() {
      const body = await readResponse(fetch, cpiUrl, mib);
      return parseCpi(JSON.parse(body.toString("utf8")));
    },
    async schedule() {
      const body = await readResponse(fetch, scheduleUrl, mib);
      return parseCpiSchedule(body.toString("utf8"));
    },
  };
}
