import type { AddonContext, ExchangeRate } from "@wealthfolio/addon-sdk";
import { FX_CACHE_TTL_MS } from "@/domain/currency";
import type { FxQuote } from "@/types/domain";

export const FX_STORAGE_KEY = "fx.quote.usd-aud";
export const TWELVE_DATA_SECRET = "twelvedata.apiKey";

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

function fromWealthfolioRates(rates: ExchangeRate[]): FxQuote | null {
  const direct = rates.find(
    (rate) => rate.fromCurrency.toUpperCase() === "USD" && rate.toCurrency.toUpperCase() === "AUD" && validRate(rate.rate),
  );
  if (direct) {
    return { pair: "USD/AUD", rate: direct.rate, fetchedAt: direct.timestamp, provider: "wealthfolio" };
  }
  const inverse = rates.find(
    (rate) => rate.fromCurrency.toUpperCase() === "AUD" && rate.toCurrency.toUpperCase() === "USD" && validRate(rate.rate),
  );
  if (inverse) {
    return { pair: "USD/AUD", rate: 1 / inverse.rate, fetchedAt: inverse.timestamp, provider: "wealthfolio" };
  }
  return null;
}

async function fetchTwelveData(ctx: AddonContext, apiKey: string): Promise<FxQuote> {
  const url = `https://api.twelvedata.com/exchange_rate?symbol=${encodeURIComponent("USD/AUD")}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await ctx.api.network.request({ method: "GET", url });
  if (response.status < 200 || response.status >= 300) throw new Error(`Twelve Data returned ${response.status}`);
  const body = JSON.parse(response.body) as { rate?: string | number; status?: string; message?: string };
  const rate = typeof body.rate === "string" ? Number(body.rate) : body.rate;
  if (!validRate(rate)) throw new Error(body.message || "Twelve Data returned an invalid USD/AUD rate");
  return { pair: "USD/AUD", rate, fetchedAt: new Date().toISOString(), provider: "twelvedata" };
}

export class FxService {
  public constructor(private readonly ctx: AddonContext) {}

  public async getSharedQuote(): Promise<FxQuote | null> {
    return parseStoredQuote(await this.ctx.api.storage.get(FX_STORAGE_KEY));
  }

  public async getQuote(options: { force?: boolean } = {}): Promise<FxQuote | null> {
    const cached = await this.getSharedQuote();
    const isFreshEnough = cached && Date.now() - Date.parse(cached.fetchedAt) < FX_CACHE_TTL_MS;
    if (isFreshEnough && !options.force) return cached;

    const apiKey = await this.ctx.api.secrets.get(TWELVE_DATA_SECRET);
    if (apiKey) {
      try {
        const live = await fetchTwelveData(this.ctx, apiKey);
        await this.ctx.api.storage.set(FX_STORAGE_KEY, JSON.stringify(live));
        return live;
      } catch (error) {
        this.ctx.api.logger.warn(`USD/AUD provider failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    try {
      const fallback = fromWealthfolioRates(await this.ctx.api.exchangeRates.getAll());
      if (fallback) {
        await this.ctx.api.storage.set(FX_STORAGE_KEY, JSON.stringify(fallback));
        return fallback;
      }
    } catch (error) {
      this.ctx.api.logger.warn(`Wealthfolio FX fallback failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    return cached;
  }
}

export function getTwelveDataSecretKey(): string {
  return TWELVE_DATA_SECRET;
}
