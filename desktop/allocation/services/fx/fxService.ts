import type { NetworkContext, StorageContext } from "../../context";
import { FX_CACHE_TTL_MS } from "../../domain/currency";
import type { FxQuote } from "../../domain/types";

export const FX_STORAGE_KEY = "fx.quote.usd-aud";
export const TWELVE_DATA_SECRET = "twelvedata.apiKey";

interface FxContext extends StorageContext, NetworkContext {
  api: StorageContext["api"] & NetworkContext["api"] & {
    secrets: { get(key: string): Promise<string | null> };
    logger: { warn(message: string): void };
  };
}

function validRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

function parseStoredQuote(value: string | null): FxQuote | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<FxQuote>;
    if (parsed.pair === "USD/AUD" && validRate(parsed.rate) && typeof parsed.fetchedAt === "string") {
      return {
        pair: "USD/AUD",
        rate: parsed.rate,
        fetchedAt: parsed.fetchedAt,
        provider: parsed.provider === "wealthfolio" ? "wealthfolio" : "twelvedata",
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function safeGetSecret(ctx: FxContext, key: string): Promise<string | null> {
  try {
    return await ctx.api.secrets.get(key);
  } catch (error) {
    ctx.api.logger.warn(`Secret access unavailable for ${key}: ${error instanceof Error ? error.message : "permission denied"}`);
    return null;
  }
}

async function fetchTwelveData(ctx: NetworkContext, apiKey: string): Promise<FxQuote> {
  const url = `https://api.twelvedata.com/exchange_rate?symbol=${encodeURIComponent("USD/AUD")}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await ctx.api.network.request({ method: "GET", url });
  if (response.status < 200 || response.status >= 300) throw new Error(`Twelve Data returned ${response.status}`);
  const body = JSON.parse(response.body) as { rate?: string | number };
  const rate = typeof body.rate === "string" ? Number(body.rate) : body.rate;
  if (!validRate(rate)) throw new Error("Twelve Data returned an invalid USD/AUD rate");
  return { pair: "USD/AUD", rate, fetchedAt: new Date().toISOString(), provider: "twelvedata" };
}

export class FxService {
  public constructor(private readonly ctx: FxContext) {}

  public async getSharedQuote(): Promise<FxQuote | null> {
    return parseStoredQuote(await this.ctx.api.storage.get(FX_STORAGE_KEY));
  }

  public async getQuote(options: { force?: boolean } = {}): Promise<FxQuote | null> {
    const cached = await this.getSharedQuote();
    const isFreshEnough = cached && Date.now() - Date.parse(cached.fetchedAt) < FX_CACHE_TTL_MS;
    if (isFreshEnough && !options.force) return cached;

    const apiKey = await safeGetSecret(this.ctx, TWELVE_DATA_SECRET);
    if (apiKey) {
      try {
        const live = await fetchTwelveData(this.ctx, apiKey);
        await this.ctx.api.storage.set(FX_STORAGE_KEY, JSON.stringify(live));
        return live;
      } catch {
        this.ctx.api.logger.warn("Twelve Data USD/AUD request failed");
      }
    }

    return cached;
  }
}
