import type { NetworkContext } from "../../context";
import { parseCsvRows, validateSnapshot } from "../../domain/etf";
import { knownEtfListing } from "../../domain/etfListings";
import type { EtfAsset, EtfHoldingsSnapshot, UnderlyingHolding } from "../../domain/types";

export interface EtfHoldingsProvider {
  id: string;
  canHandle(etf: EtfAsset): Promise<boolean>;
  fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot>;
}

function normalizePercentageWeight(value: unknown): number | null {
  const text = String(value ?? "").trim().replace(/%$/, "");
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric / 100;
}

function mapUnderlyingType(value: unknown): UnderlyingHolding["underlyingType"] {
  const type = String(value ?? "").toLowerCase();
  if (type.includes("money market")) return "cash";
  if (type.includes("etf") || type.includes("fund")) return "etf";
  if (type.includes("bond") || type.includes("fixed") || type.includes("income")) return "fixed-income";
  if (type.includes("derivative") || type.includes("option") || type.includes("future")) return "derivative";
  if (type.includes("cash") || type.includes("currency")) return "cash";
  if (type.includes("equity") || type.includes("equities") || type.includes("stock")) return "stock";
  return "other";
}

function buildSnapshot(etf: EtfAsset, provider: string, holdings: UnderlyingHolding[], asOfDate?: string): EtfHoldingsSnapshot {
  const snapshot: EtfHoldingsSnapshot = {
    schemaVersion: 2,
    etfKey: etf.etfKey,
    provider,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    fetchedAt: new Date().toISOString(),
    holdings,
    weightSum: holdings.reduce((sum, holding) => sum + holding.weight, 0),
    normalized: false,
    sourceMode: "automatic",
  };
  const validation = validateSnapshot(snapshot);
  if (!validation.accepted || !validation.snapshot) throw new Error(validation.message);
  return validation.snapshot;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function issuerSymbol(provider: "ishares" | "betashares", value: string): string | undefined {
  const symbol = value.trim().toUpperCase();
  if (!symbol) return undefined;
  if (provider === "ishares") {
    const aliases: Record<string, string> = { BRKB: "BRK.B", BFB: "BF.B" };
    return aliases[symbol] ?? symbol;
  }
  return symbol;
}

function exchangeMic(value: string): string | undefined {
  const exchange = value.trim().toUpperCase().replace(/\s+/g, " ");
  const mappings: Record<string, string> = {
    NASDAQ: "XNAS",
    NYSE: "XNYS",
    "NYSE ARCA": "ARCX",
    ARCA: "ARCX",
    ASX: "XASX",
    "CBOE BZX": "BATS",
  };
  return mappings[exchange];
}

// Some issuer CDNs reject requests without a User-Agent.
const USER_AGENT = "StockPortfolio";

async function fetchText(ctx: NetworkContext, url: string, headers?: Record<string, string>): Promise<string> {
  const response = await ctx.api.network.request({ method: "GET", url, headers: { "User-Agent": USER_AGENT, ...headers } });
  if (response.status < 200 || response.status >= 300) throw new Error(`Provider returned ${response.status}`);
  return response.body;
}

class PublicCsvIssuerProvider implements EtfHoldingsProvider {
  public constructor(
    public readonly id: "ishares" | "betashares",
    private readonly ctx: NetworkContext,
    private readonly hostPrefix: string,
  ) {}

  public async canHandle(etf: EtfAsset): Promise<boolean> {
    return Boolean(this.identifier(etf));
  }

  private identifier(etf: EtfAsset): string | undefined {
    const known = knownEtfListing(etf);
    const configured = etf.providerSymbol?.trim();
    if (this.id === "ishares" && configured && /^\d+$/.test(configured)) return configured;
    if (this.id === "betashares" && configured && /^[A-Za-z0-9]+$/.test(configured)) return configured;
    if (known?.provider === this.id) return known.identifier;
    if (this.id === "ishares" && /\bishares\b/i.test(etf.name)) return ISHARES_US_PRODUCT_IDS[etf.symbol.toUpperCase()];
  }

  public async fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot> {
    const providerSymbol = this.identifier(etf);
    if (!providerSymbol) throw new Error(`${this.id} public identifier is missing`);
    const known = knownEtfListing(etf);
    const ticker = encodeURIComponent(etf.symbol.trim().toUpperCase());
    if (this.id === "ishares" && known?.provider === "ishares" && providerSymbol === known.identifier) {
      const url = `https://www.blackrock.com/au/products/${providerSymbol}/fund/1478358644060.ajax?dataType=fund&fileName=${ticker}_holdings&fileType=csv`;
      return parseIssuerCsv(await fetchText(this.ctx, url), etf, this.id, true);
    }
    const url = this.id === "ishares"
      ? `${this.hostPrefix}${encodeURIComponent(providerSymbol)}/${ticker}/latest-holdings.csv`
      : `${this.hostPrefix}${encodeURIComponent(providerSymbol.toUpperCase())}_Portfolio_Holdings.csv`;
    const csv = await fetchText(this.ctx, url);
    return parseIssuerCsv(csv, etf, this.id);
  }
}

// Verified iShares product IDs let the ledger look up common funds by ticker.
const ISHARES_US_PRODUCT_IDS: Readonly<Record<string, string>> = {
  IVV: "239726",
};

// Invesco's API uses the share-class CUSIP. These verified IDs cover common funds.
const INVESCO_US_CUSIPS: Readonly<Record<string, string>> = {
  SPMO: "46138E339",
  QQQ: "46090E103",
};

const CUSIP_PATTERN = /^[0-9A-Z]{9}$/;

const INVESCO_REQUEST_HEADERS: Readonly<Record<string, string>> = { Accept: "application/json" };

function resolveInvescoCusip(etf: EtfAsset): string | null {
  const configured = etf.providerSymbol?.trim().toUpperCase();
  if (configured && CUSIP_PATTERN.test(configured)) return configured;
  const looksLikeInvesco = /\binvesco\b/i.test(etf.name);
  if (!looksLikeInvesco) return null;
  return INVESCO_US_CUSIPS[etf.symbol.toUpperCase()] ?? null;
}

interface InvescoHoldingsResponse {
  effectiveDate?: string;
  holdings?: Array<{
    ticker?: string | null;
    issuerName?: string | null;
    percentageOfTotalNetAssets?: number | null;
    securityTypeName?: string | null;
    currency?: string | null;
  }>;
  message?: string;
}

export class InvescoProvider implements EtfHoldingsProvider {
  public readonly id = "invesco";

  public constructor(private readonly ctx: NetworkContext) {}

  public async canHandle(etf: EtfAsset): Promise<boolean> {
    return Boolean(resolveInvescoCusip(etf));
  }

  // A unique query parameter forces a cache miss when Invesco's CDN serves
  // a stale error from the cache shared by requests without an Origin header.
  private async fetchWithCacheBypass(url: string): Promise<string> {
    try {
      return await fetchText(this.ctx, url, INVESCO_REQUEST_HEADERS);
    } catch (error) {
      if (!(error instanceof Error) || !/^Provider returned \d+$/.test(error.message)) throw error;
      return fetchText(this.ctx, `${url}&_=${Date.now()}`, INVESCO_REQUEST_HEADERS);
    }
  }

  public async fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot> {
    const cusip = resolveInvescoCusip(etf);
    if (!cusip) throw new Error("Invesco CUSIP is missing");
    const url = `https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/${encodeURIComponent(cusip)}/holdings/fund?idType=cusip&productType=ETF`;
    const body = JSON.parse(await this.fetchWithCacheBypass(url)) as InvescoHoldingsResponse;
    if (!body.holdings?.length) throw new Error(body.message || "Invesco returned no holdings");
    const holdings: UnderlyingHolding[] = [];
    for (const row of body.holdings) {
      // The API reports Weight as a percentage of net assets (10.7 means 10.7%).
      // Pending-dividend and similar accrual rows carry a null weight and are
      // not constituents, so they are skipped rather than treated as zero.
      const weight = normalizePercentageWeight(row.percentageOfTotalNetAssets);
      if (row.percentageOfTotalNetAssets === null || row.percentageOfTotalNetAssets === undefined || weight === null) continue;
      const symbol = String(row.ticker ?? "").trim().toUpperCase() || undefined;
      const name = decodeHtmlEntities(String(row.issuerName ?? "").trim()) || symbol || "";
      if (!name) continue;
      holdings.push({
        symbol,
        name,
        weight,
        currency: String(row.currency ?? "").trim() || undefined,
        assetClass: String(row.securityTypeName ?? "").trim() || undefined,
        underlyingType: mapUnderlyingType(row.securityTypeName),
      });
    }
    return buildSnapshot(etf, this.id, holdings, body.effectiveDate);
  }
}

function parseIssuerCsv(
  csv: string,
  etf: EtfAsset,
  provider: "ishares" | "betashares",
  australianIshares = false,
): EtfHoldingsSnapshot {
  let allRows = parseCsvRows(csv);
  if (australianIshares) {
    // The Australian CSV lists the wrapper's holdings before the underlying companies.
    const [, start, end] = allRows.flatMap(([label], index) => /^fund holdings as of$/i.test(label) ? [index] : []);
    if (start === undefined) throw new Error("iShares Australia holdings CSV is missing its underlying holdings");
    allRows = allRows.slice(start, end);
  }
  // iShares US renamed "Weight (%)" to "Market Weight" (alongside "Notional
  // Weight") in late 2026; Betashares still uses "Weight (%)".
  const weightHeaders = new Set(["weight(%)", "marketweight"]);
  const headerIndex = allRows.findIndex((row) => row.some((value) => weightHeaders.has(value.toLowerCase().replace(/\s+/g, ""))));
  if (headerIndex < 0) throw new Error(`${provider} holdings CSV schema changed: Weight (%) column not found`);
  const header = allRows[headerIndex].map((value) => value.toLowerCase().replace(/[\s%()/#]+/g, ""));
  const weightColumn = header.includes("weight") ? "weight" : "marketweight";
  const indexOf = (name: string) => header.indexOf(name);
  const rows: UnderlyingHolding[] = [];
  for (const values of allRows.slice(headerIndex + 1)) {
    const get = (name: string) => {
      const index = indexOf(name);
      return index >= 0 ? values[index]?.trim() ?? "" : "";
    };
    const country = get("location") || get("country") || undefined;
    const assetClass = get("assetclass");
    const underlyingType = mapUnderlyingType(assetClass);
    let symbol = issuerSymbol(provider, get("ticker"));
    if (provider === "betashares" && underlyingType === "stock" && country === "United States") {
      // Betashares includes a Bloomberg exchange suffix in its US stock tickers.
      symbol = symbol?.replace(/ UW$/, "");
    }
    const name = get("name") || symbol || "";
    // Issuer weight columns are percentages. Values such as 0.97 therefore
    // mean 0.97%, not a fractional weight of 97%.
    const weight = normalizePercentageWeight(get(weightColumn));
    if (!name || weight === null) continue;
    rows.push({
      symbol,
      name,
      mic: exchangeMic(get("exchange")),
      weight,
      country,
      currency: (australianIshares && get("marketcurrency")) || get("currency") || undefined,
      sector: get("sector") || undefined,
      assetClass: assetClass || undefined,
      underlyingType,
    });
  }
  const asOfDate = parseIssuerAsOfDate(allRows, provider);
  return buildSnapshot(etf, provider, rows, asOfDate);
}

function parseIssuerAsOfDate(rows: string[][], provider: "ishares" | "betashares"): string | undefined {
  if (provider === "betashares") {
    const date = rows.find(([label]) => /^date$/i.test(label))?.[1];
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  const metadataRow = rows.find(([label]) => /holdings as of/i.test(label));
  const value = metadataRow?.[1] ?? "";
  const date = value.replace(/^(\d{1,2})-([a-z]{3})-(\d{4})$/i, "$2 $1, $3");
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})$/i.exec(date);
  if (!match) return undefined;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

export function createProviders(ctx: NetworkContext): EtfHoldingsProvider[] {
  return [
    new PublicCsvIssuerProvider("ishares", ctx, "https://www.ishares.com/us/products/"),
    // Invesco runs before Betashares because a configured CUSIP is alphanumeric
    // and would otherwise be tried as a Betashares ticker first.
    new InvescoProvider(ctx),
    new PublicCsvIssuerProvider("betashares", ctx, "https://www.betashares.com.au/files/csv/"),
  ];
}

export interface ResolverOptions {
  mode: "auto" | "pinned";
  pinnedProvider?: string;
  cached?: EtfHoldingsSnapshot | null;
  force?: boolean;
}

export interface ResolverResult {
  snapshot: EtfHoldingsSnapshot | null;
  provider: string | null;
  failureReason?: string;
}

export async function resolveEtfHoldings(
  etf: EtfAsset,
  providers: EtfHoldingsProvider[],
  options: ResolverOptions,
): Promise<ResolverResult> {
  const cacheMatchesPinnedProvider = options.mode === "auto" || options.cached?.provider === options.pinnedProvider;
  if (options.cached && cacheMatchesPinnedProvider && !options.force) {
    const fetchedAt = Date.parse(options.cached.fetchedAt);
    if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt <= 24 * 60 * 60 * 1000) {
      return { snapshot: options.cached, provider: options.cached.provider };
    }
  }
  const candidates = options.mode === "pinned"
    ? providers.filter((provider) => provider.id === options.pinnedProvider)
    : providers;
  let lastError = "No provider can handle this ETF";
  for (const provider of candidates) {
    try {
      if (!(await provider.canHandle(etf))) continue;
      return { snapshot: await provider.fetchHoldings(etf), provider: provider.id };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Provider failed";
    }
  }
  return {
    snapshot: cacheMatchesPinnedProvider ? options.cached ?? null : null,
    provider: cacheMatchesPinnedProvider ? options.cached?.provider ?? null : null,
    failureReason: lastError,
  };
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return result;
}
