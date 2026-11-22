import type { NetworkContext } from "../../context";
import { parseCsvRows, validateSnapshot } from "../../domain/etf";
import type { EtfAsset, EtfHoldingsSnapshot, UnderlyingHolding } from "../../domain/types";

export interface EtfHoldingsProvider {
  id: string;
  canHandle(etf: EtfAsset): Promise<boolean>;
  fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot>;
}

function normalizeProviderWeight(value: unknown): number | null {
  const text = String(value ?? "").trim();
  const numeric = typeof value === "number" ? value : Number(text.replace(/%$/, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (text.endsWith("%")) return numeric / 100;
  return numeric > 1 ? numeric / 100 : numeric;
}

function normalizePercentageWeight(value: unknown): number | null {
  const numeric = Number(String(value ?? "").trim().replace(/%$/, ""));
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

export class AlphaVantageProvider implements EtfHoldingsProvider {
  public readonly id = "alpha-vantage";

  public constructor(private readonly ctx: NetworkContext, private readonly apiKey?: string | null) {}

  public async canHandle(etf: EtfAsset): Promise<boolean> {
    return Boolean(this.apiKey && etf.symbol);
  }

  public async fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot> {
    if (!this.apiKey) throw new Error("Alpha Vantage API key is not configured");
    const url = `https://www.alphavantage.co/query?function=ETF_PROFILE&symbol=${encodeURIComponent(etf.symbol)}&apikey=${encodeURIComponent(this.apiKey)}`;
    let body: {
      holdings?: Array<Record<string, unknown>>;
      last_updated?: string;
    };
    try {
      body = JSON.parse(await fetchText(this.ctx, url));
    } catch {
      throw new Error("Alpha Vantage ETF request failed");
    }
    if (!body?.holdings?.length) throw new Error("Alpha Vantage returned no holdings");
    const holdings: UnderlyingHolding[] = [];
    for (const row of body.holdings) {
      const weight = normalizeProviderWeight(row.weight);
      const name = String(row.name ?? row.description ?? row.symbol ?? "").trim();
      if (!name || weight === null) continue;
      holdings.push({
        symbol: String(row.symbol ?? "").trim() || undefined,
        name,
        weight,
        country: String(row.country ?? "").trim() || undefined,
        sector: String(row.sector ?? "").trim() || undefined,
        assetClass: String(row.asset_type ?? row.assetClass ?? "").trim() || undefined,
        underlyingType: mapUnderlyingType(row.asset_type ?? row.assetClass),
      });
    }
    return buildSnapshot(etf, this.id, holdings, body.last_updated);
  }
}

class PublicCsvIssuerProvider implements EtfHoldingsProvider {
  public constructor(
    public readonly id: "ishares" | "betashares",
    private readonly ctx: NetworkContext,
    private readonly hostPrefix: string,
  ) {}

  public async canHandle(etf: EtfAsset): Promise<boolean> {
    if (this.id === "ishares") return Boolean(resolveIsharesProductId(etf));
    return Boolean(etf.providerSymbol && /^[A-Za-z0-9]+$/.test(etf.providerSymbol));
  }

  public async fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot> {
    const providerSymbol = this.id === "ishares" ? resolveIsharesProductId(etf) : etf.providerSymbol;
    if (!providerSymbol) throw new Error(`${this.id} public identifier is missing`);
    const url = this.id === "ishares"
      ? `${this.hostPrefix}${encodeURIComponent(providerSymbol)}/${encodeURIComponent(etf.symbol.toUpperCase())}/latest-holdings.csv`
      : `${this.hostPrefix}${encodeURIComponent(providerSymbol.toUpperCase())}_Portfolio_Holdings.csv`;
    const csv = await fetchText(this.ctx, url);
    return parseIssuerCsv(csv, etf, this.id);
  }
}

// Verified iShares product IDs let the ledger look up common funds by ticker.
const ISHARES_US_PRODUCT_IDS: Readonly<Record<string, string>> = {
  IVV: "239726",
};

function resolveIsharesProductId(etf: EtfAsset): string | null {
  if (etf.providerSymbol && /^\d+$/.test(etf.providerSymbol)) return etf.providerSymbol;
  const looksLikeIshares = /\bishares\b/i.test(etf.name);
  if (!looksLikeIshares) return null;
  return ISHARES_US_PRODUCT_IDS[etf.symbol.toUpperCase()] ?? null;
}

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

function parseIssuerCsv(csv: string, etf: EtfAsset, provider: "ishares" | "betashares"): EtfHoldingsSnapshot {
  const allRows = parseCsvRows(csv);
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
    const symbol = issuerSymbol(provider, get("ticker"));
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
      country: get("location") || get("country") || undefined,
      currency: get("currency") || undefined,
      sector: get("sector") || undefined,
      assetClass: get("assetclass") || undefined,
      underlyingType: mapUnderlyingType(get("assetclass")),
    });
  }
  const asOfDate = parseIssuerAsOfDate(allRows);
  return buildSnapshot(etf, provider, rows, asOfDate);
}

function parseIssuerAsOfDate(rows: string[][]): string | undefined {
  const metadataRow = rows.find((row) => /holdings as of/i.test(row[0] ?? ""));
  const value = metadataRow?.[1]?.trim() ?? "";
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})$/i.exec(value);
  if (!match) return undefined;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

export function createProviders(
  ctx: NetworkContext,
  secrets: { alphaVantageApiKey?: string | null },
): EtfHoldingsProvider[] {
  return [
    new PublicCsvIssuerProvider("ishares", ctx, "https://www.ishares.com/us/products/"),
    // Invesco runs before Betashares because a configured CUSIP is alphanumeric
    // and would otherwise be tried as a Betashares ticker first.
    new InvescoProvider(ctx),
    new PublicCsvIssuerProvider("betashares", ctx, "https://www.betashares.com.au/files/csv/"),
    new AlphaVantageProvider(ctx, secrets.alphaVantageApiKey),
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
