import { day, savePrice, transaction } from "./ledger.js";
import { marketFor, marketSession, shiftDay } from "./marketDays.js";

export const benchmarks = [
  { id: "SP500TR", name: "标普 500", source: "Yahoo Finance · ^SP500TR" },
  { id: "XNDX", name: "纳斯达克 100", source: "Nasdaq / FRED · NASDAQXNDX" },
];
const fxSource = "Yahoo Finance · AUDUSD=X";
export const closeSource = "Yahoo Finance 日收盘";

export function reviewDates(from, to) {
  from = day(from);
  to = day(to);
  if (from > to) throw Error("复盘起点须早于或等于终点。");
  if (from < "1900-01-01" || to > shiftDay(new Date().toISOString().slice(0, 10), 1))
    throw Error("请选择已发生的复盘日期。");
  return { from, to };
}

async function get(request, url) {
  const response = await request({ method: "GET", url: url.toString() });
  if (response.status !== 200) throw Error("数据源返回 HTTP " + response.status);
  return response.body;
}
function positive(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw Error("数据源返回了无效的点位或汇率。");
  return n;
}
function localDates(timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
}
// `expect` names the currency, instrument kinds and, for listed securities, the exchange codes
// which the returned series must carry before any of its closes are stored.
async function yahooCloses(request, symbol, from, to, expect) {
  const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
  url.search = new URLSearchParams({
    period1: String(Date.parse(shiftDay(from, -1)) / 1000),
    period2: String(Date.parse(shiftDay(to, 1)) / 1000),
    interval: "1d",
    ...(expect.splits && { events: "splits" }),
  }).toString();
  const data = JSON.parse(await get(request, url)).chart?.result?.[0];
  const meta = data?.meta;
  if (
    meta?.symbol !== symbol ||
    meta.currency !== expect.currency ||
    !expect.kinds.includes(meta.instrumentType) ||
    (expect.exchanges && !expect.exchanges.includes(meta.exchangeName)) ||
    meta.dataGranularity !== "1d" ||
    !meta.exchangeTimezoneName
  )
    throw Error(expect.exchanges ? "证券、币种或交易所不可核实" : "序列标识、币种或频率不匹配。");
  const rows = new Map();
  if (!data.timestamp?.length) return rows;
  const dates = localDates(meta.exchangeTimezoneName);
  const closes = data.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes) || closes.length !== data.timestamp.length) throw Error("缺少完整的日线字段。");
  const now = expect.now ?? Date.now();
  const today = dates.format(now);
  const session = meta.currentTradingPeriod?.regular;
  const listed = expect.market && marketSession(now, expect.market);
  const completed = listed?.completed === today &&
    (expect.market !== "ASX" || listed.minute >= listed.officialAfter + 20);
  const finishedToday = session?.end * 1000 <= now && dates.format(session.end * 1000) === today &&
    (!expect.market || completed);
  // Closes before a split are restated by the source. The ledger holds the original
  // quantities, so only closes from the latest split onwards remain comparable.
  const splits = Object.values(data.events?.splits || {}).map((s) => dates.format(s.date * 1000));
  const comparableFrom = splits.sort().at(-1) || "";
  data.timestamp.forEach((stamp, i) => {
    const date = dates.format(stamp * 1000);
    if (
      date < from ||
      date > to ||
      date < comparableFrom ||
      (date === today && !finishedToday) ||
      date > today ||
      closes[i] == null
    )
      return;
    rows.set(date, positive(closes[i]));
  });
  return rows;
}
const index = { currency: "USD", kinds: ["INDEX"] };
async function fredCloses(request, from, to) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.search = new URLSearchParams({ id: "NASDAQXNDX", cosd: from, coed: to }).toString();
  const [header, ...lines] = (await get(request, url)).trim().split(/\r?\n/);
  if (!/^(observation_date|DATE),NASDAQXNDX$/.test(header)) throw Error("未收到 Nasdaq 总回报序列。");
  const rows = new Map();
  for (const line of lines) {
    const [raw, level] = line.split(",");
    if (!level || level === ".") continue;
    const date = day(raw);
    if (date >= from && date <= to) rows.set(date, positive(level));
  }
  return rows;
}
// The published history arrives a session late. The same index's latest close, where the
// exchange feed carries it, covers that session; the history stays authoritative where both exist.
async function nasdaqCloses(request, from, to) {
  const [history, recent] = await Promise.allSettled([
    fredCloses(request, from, to),
    yahooCloses(request, "^XNDX", from, to, index),
  ]);
  if (history.status === "rejected" && !(recent.status === "fulfilled" && recent.value.size)) throw history.reason;
  const rows = new Map();
  if (recent.status === "fulfilled")
    for (const [date, level] of recent.value) rows.set(date, { level, source: "Yahoo Finance · ^XNDX" });
  if (history.status === "fulfilled") for (const [date, level] of history.value) rows.set(date, level);
  return rows;
}
export async function refreshBenchmarks(db, args, request) {
  const range = reviewDates(args.from, args.to);
  const from = shiftDay(range.from, -7),
    to = range.to;
  const pair = { currency: "USD", kinds: ["CURRENCY"] };
  const feeds = [
    { ...benchmarks[0], read: () => yahooCloses(request, "^SP500TR", from, to, index) },
    { ...benchmarks[1], read: () => nasdaqCloses(request, from, to) },
    { id: "FX", name: "澳元汇率", source: fxSource, read: () => yahooCloses(request, "AUDUSD=X", from, to, pair) },
  ];
  const results = await Promise.allSettled(feeds.map((feed) => feed.read()));
  const insert = db.prepare(
    "INSERT OR REPLACE INTO sp_benchmark_levels(series,day,level,source) VALUES(?,?,?,?)",
  );
  return results.map((result, i) => {
    const { id, name, source } = feeds[i];
    if (result.status === "rejected") return { name, error: result.reason.message || "获取失败" };
    if (!result.value.size) return { name, error: "所选期间没有日线" };
    transaction(db, () => {
      for (const [date, value] of result.value) {
        if (id === "FX") savePrice(db, "FX:AUD/USD", date, value, source, 6);
        else insert.run(id, date, value.level ?? value, value.source || source);
      }
    });
    return { name, count: result.value.size };
  });
}

const listings = {
  XNAS: ["NMS", "NGM", "NCM"],
  XNYS: ["NYQ"],
  ARCX: ["PCX"],
  XASE: ["ASE"],
  BATS: ["BTS"],
  XASX: ["ASX"],
};
const usListings = ["NMS", "NGM", "NCM", "NYQ", "PCX", "ASE", "BTS"];
// The public feed's ticker and the exchange codes it reports for one held listing.
export function publicListing(asset) {
  const symbol = String(asset.symbol || "")
    .trim()
    .toUpperCase();
  const market = marketFor(asset);
  if (!symbol || !["US", "ASX"].includes(market)) return null;
  return market === "ASX"
    ? { symbol: symbol.replace(/\.AX$/, "") + ".AX", exchanges: listings.XASX }
    : { symbol: symbol.replace(/[./ ]/g, "-"), exchanges: listings[asset.mic] || usListings };
}

// Daily closes for held listings, without an API key. The ledger posts dividends itself, so
// these are closes unadjusted for dividends. A stored close is never rewritten, which keeps the
// value seen on the day even if the source later restates its history.
export async function refreshCloses(db, assets, args, request) {
  const { from, to } = reviewDates(args.from, args.to);
  const insert = db.prepare("INSERT OR IGNORE INTO sp_prices VALUES(?,?,?,?,?)");
  const read = async (asset) => {
    const listing = publicListing(asset);
    if (!listing) throw Error("该交易所暂不支持自动收盘价");
    return yahooCloses(request, listing.symbol, shiftDay(from, -7), to, {
      currency: asset.currency,
      kinds: ["EQUITY", "ETF"],
      exchanges: listing.exchanges,
      splits: true,
      market: marketFor(asset),
      now: args.now,
    });
  };
  const results = [];
  // A handful of listings at a time keeps the public feed from throttling the batch.
  for (let i = 0; i < assets.length; i += 4) {
    const group = assets.slice(i, i + 4);
    const settled = await Promise.allSettled(group.map(read));
    settled.forEach((result, j) => {
      const asset = group[j];
      if (result.status === "rejected")
        return results.push({ id: asset.id, name: asset.symbol, error: result.reason.message || "获取失败" });
      if (!result.value.size) return results.push({ id: asset.id, name: asset.symbol, error: "所选期间没有收盘价" });
      let added = 0;
      transaction(db, () => {
        for (const [date, value] of result.value)
          added += insert.run(asset.id, date, String(value), closeSource, 12).changes;
      });
      results.push({ id: asset.id, name: asset.symbol, count: result.value.size, added });
    });
  }
  return results;
}
