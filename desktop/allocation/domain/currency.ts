import type { CurrencyValuation, FxQuote } from "./types";

export const FX_CACHE_TTL_MS = 5 * 60 * 1000;

export function normalizeCurrency(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

export function convertToAud(
  localValue: number | null | undefined,
  currency: string,
  quote: FxQuote | null | undefined,
): CurrencyValuation {
  if (localValue === null || localValue === undefined || !Number.isFinite(localValue)) {
    return { audValue: null, supported: false, reason: "No usable market value" };
  }

  const normalized = normalizeCurrency(currency);
  if (normalized === "AUD") {
    return { audValue: localValue, supported: true };
  }

  if (normalized === "USD" && quote && Number.isFinite(quote.rate) && quote.rate > 0) {
    return { audValue: localValue * quote.rate, supported: true };
  }

  if (normalized === "USD") {
    return { audValue: null, supported: false, reason: "Missing valid USD/AUD quote" };
  }

  return {
    audValue: null,
    supported: false,
    reason: `Unsupported currency: ${normalized || "unknown"}`,
  };
}
