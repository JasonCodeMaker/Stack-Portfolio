import type { AddonContext } from "@wealthfolio/addon-sdk";
import { parseCsvRows, validateSnapshot } from "@/domain/etf";
import type { EtfAsset, EtfHoldingsSnapshot, UnderlyingHolding } from "@/types/domain";

export interface EtfHoldingsProvider {
  id: string;
  canHandle(etf: EtfAsset): Promise<boolean>;
  fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot>;
}

function normalizeProviderWeight(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(/%$/, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric > 1 ? numeric / 100 : numeric;
}

function mapUnderlyingType(value: unknown): UnderlyingHolding["underlyingType"] {
  const type = String(value ?? "").toLowerCase();
  if (type.includes("etf") || type.includes("fund")) return "etf";
  if (type.includes("bond") || type.includes("fixed") || type.includes("income")) return "fixed-income";
  if (type.includes("derivative") || type.includes("option") || type.includes("future")) return "derivative";
  if (type.includes("cash") || type.includes("currency")) return "cash";
  if (type.includes("equity") || type.includes("equities") || type.includes("stock")) return "stock";
  return "other";
}

function buildSnapshot(etf: EtfAsset, provider: string, holdings: UnderlyingHolding[], asOfDate?: string): EtfHoldingsSnapshot {
  const snapshot: EtfHoldingsSnapshot = {
    schemaVersion: 1,
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

async function fetchText(ctx: AddonContext, url: string): Promise<string> {
  const response = await ctx.api.network.request({ method: "GET", url });
  if (response.status < 200 || response.status >= 300) throw new Error(`Provider returned ${response.status}`);
  return response.body;
}

export class AlphaVantageProvider implements EtfHoldingsProvider {
  public readonly id = "alpha-vantage";

  public constructor(private readonly ctx: AddonContext, private readonly apiKey?: string | null) {}

  public async canHandle(etf: EtfAsset): Promise<boolean> {
    return Boolean(this.apiKey && etf.symbol);
  }

  public async fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot> {
    if (!this.apiKey) throw new Error("Alpha Vantage API key is not configured");
    const url = `https://www.alphavantage.co/query?function=ETF_PROFILE&symbol=${encodeURIComponent(etf.symbol)}&apikey=${encodeURIComponent(this.apiKey)}`;
    const body = JSON.parse(await fetchText(this.ctx, url)) as {
      holdings?: Array<Record<string, unknown>>;
      last_updated?: string;
      Information?: string;
      Note?: string;
      message?: string;
    };
    if (!body.holdings?.length) throw new Error(body.Information || body.Note || body.message || "Alpha Vantage returned no holdings");
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
    private readonly ctx: AddonContext,
    private readonly hostPrefix: string,
  ) {}

  public async canHandle(etf: EtfAsset): Promise<boolean> {
    if (!etf.providerSymbol) return false;
    return this.id === "ishares" ? /^\d+$/.test(etf.providerSymbol) : /^[A-Za-z0-9]+$/.test(etf.providerSymbol);
  }

  public async fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot> {
    const providerSymbol = etf.providerSymbol;
    if (!providerSymbol) throw new Error(`${this.id} public identifier is missing`);
    const url = this.id === "ishares"
      ? `${this.hostPrefix}${encodeURIComponent(providerSymbol)}/latest-holdings.csv`
      : `${this.hostPrefix}${encodeURIComponent(providerSymbol.toUpperCase())}_Portfolio_Holdings.csv`;
    const csv = await fetchText(this.ctx, url);
    return parseIssuerCsv(csv, etf, this.id);
  }
}

function parseIssuerCsv(csv: string, etf: EtfAsset, provider: "ishares" | "betashares"): EtfHoldingsSnapshot {
  const allRows = parseCsvRows(csv);
  const headerIndex = allRows.findIndex((row) => row.some((value) => value.toLowerCase().replace(/\s+/g, "") === "weight(%)"));
  if (headerIndex < 0) throw new Error(`${provider} holdings CSV schema changed: Weight (%) column not found`);
  const header = allRows[headerIndex].map((value) => value.toLowerCase().replace(/[\s%()/#]+/g, ""));
  const indexOf = (name: string) => header.indexOf(name);
  const rows: UnderlyingHolding[] = [];
  for (const values of allRows.slice(headerIndex + 1)) {
    const get = (name: string) => {
      const index = indexOf(name);
      return index >= 0 ? values[index]?.trim() ?? "" : "";
    };
    const symbol = get("ticker") || undefined;
    const name = get("name") || symbol || "";
    const weight = normalizeProviderWeight(get("weight"));
    if (!name || weight === null) continue;
    rows.push({
      symbol,
      name,
      weight,
      country: get("location") || get("country") || undefined,
      currency: get("currency") || undefined,
      sector: get("sector") || undefined,
      assetClass: get("assetclass") || undefined,
      underlyingType: mapUnderlyingType(get("assetclass")),
    });
  }
  return buildSnapshot(etf, provider, rows);
}

export function createProviders(
  ctx: AddonContext,
  secrets: { alphaVantageApiKey?: string | null },
): EtfHoldingsProvider[] {
  return [
    new PublicCsvIssuerProvider("ishares", ctx, "https://www.ishares.com/us/products/"),
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
