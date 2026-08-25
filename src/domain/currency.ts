import type { CurrencyValuation, FxQuote, SupportedCurrency } from "@/types/domain";

export const FX_CACHE_TTL_MS = 5 * 60 * 1000;

export function normalizeCurrency(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

export function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  const currency = normalizeCurrency(value);
  return currency === "AUD" || currency === "USD";
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

export type QuoteFreshness = "Fresh" | "Stale" | "Warning";

export function getQuoteFreshness(
  fetchedAt: string,
  now = Date.now(),
): QuoteFreshness | null {
  const timestamp = Date.parse(fetchedAt);
  if (!Number.isFinite(timestamp)) return null;
  const age = Math.max(0, now - timestamp);
  if (age < 10 * 60 * 1000) return "Fresh";
  if (age <= 30 * 60 * 1000) return "Stale";
  return "Warning";
}

export function formatRelativeAge(
  timestamp: string | null | undefined,
  now = Date.now(),
): string {
  if (!timestamp) return "Not available";
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "Unknown time";
  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
