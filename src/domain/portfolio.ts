import type { Asset, Holding } from "@wealthfolio/addon-sdk";
import { canonicalEtfKey, canonicalIdentity } from "@/domain/identifiers";
import { convertToAud, normalizeCurrency } from "@/domain/currency";
import type {
  AllocationRow,
  AssetProfile,
  AssetType,
  FxQuote,
  NormalizedHolding,
  PortfolioAccount,
  PortfolioModel,
  PortfolioWarning,
} from "@/types/domain";

function asFiniteNumber(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function classifyAsset(
  holding: Holding,
  profile: AssetProfile | null,
  override?: AssetType,
): AssetType {
  if (override) return override;
  if (holding.holdingType === "cash") return "cash";

  const instrumentType = profile?.instrumentType?.toUpperCase() ?? "";
  if (instrumentType.includes("ETF") || instrumentType.includes("MUTUAL")) return "etf";
  if (instrumentType.includes("BOND") || instrumentType.includes("FIXED")) return "fixed-income";
  if (instrumentType.includes("OPTION") || instrumentType.includes("DERIVATIVE")) return "derivative";
  if (instrumentType.includes("EQUITY") || instrumentType.includes("STOCK")) return "stock";

  const kind = profile?.kind?.toUpperCase() ?? "";
  if (kind === "INVESTMENT" && profile?.symbol) return "unknown";
  return "unknown";
}

export function normalizeHolding(
  holding: Holding,
  account: PortfolioAccount,
  profile: AssetProfile | null,
  fxQuote: FxQuote | null,
  typeOverride?: AssetType,
): NormalizedHolding {
  const localCurrency = normalizeCurrency(holding.localCurrency);
  const nativeValue = asFiniteNumber(holding.marketValue?.local);
  const quantity = holding.quantity;
  const type = classifyAsset(holding, profile, typeOverride);
  const conversion = convertToAud(nativeValue, localCurrency, fxQuote);
  const ticker = profile?.symbol || holding.instrument?.symbol || (type === "cash" ? localCurrency : "Unmapped");
  const name = profile?.name || holding.instrument?.name || (type === "cash" ? `${localCurrency} cash` : "Unmapped instrument");
  const identity = type === "cash"
    ? { key: `cash:${localCurrency}` }
    : canonicalIdentity({
        isin: profile?.isin,
        mic: profile?.mic,
        symbol: profile?.symbol || holding.instrument?.symbol,
        currency: localCurrency,
        name,
      });
  const etfKey = type === "etf"
    ? canonicalEtfKey({
        instrumentKey: profile?.instrumentKey,
        mic: profile?.mic,
        symbol: ticker,
        currency: localCurrency,
      })
    : null;

  let status: NormalizedHolding["status"] = "valued";
  let issue: string | undefined;
  if (quantity < 0 || (type === "cash" && nativeValue !== null && nativeValue < 0)) {
    status = "unsupported-position";
    issue = "Negative quantity or cash is not supported in v1";
  } else if (nativeValue === null) {
    status = "unvalued";
    issue = "Wealthfolio did not provide a usable market value";
  } else if (!conversion.supported) {
    status = conversion.reason?.startsWith("Unsupported currency") ? "unsupported-currency" : "unvalued";
    issue = conversion.reason;
  } else if (type === "unknown") {
    status = "unknown-instrument";
    issue = "Instrument type is unresolved; add a local type override";
  }

  return {
    id: holding.id,
    accountId: account.id,
    accountName: account.name,
    ticker,
    name,
    type,
    quantity,
    localCurrency,
    nativeValue,
    audValue: conversion.audValue,
    priceUpdatedAt: holding.asOfDate || null,
    identityKey: identity.key,
    etfKey,
    profileId: holding.instrument?.id ?? null,
    status,
    issue,
    sourceHoldingId: holding.id,
  };
}

function buildWarnings(holdings: NormalizedHolding[]): PortfolioWarning[] {
  const warnings: PortfolioWarning[] = [];
  const byStatus = new Map<NormalizedHolding["status"], NormalizedHolding[]>();
  for (const holding of holdings) {
    const rows = byStatus.get(holding.status) ?? [];
    rows.push(holding);
    byStatus.set(holding.status, rows);
  }

  const unsupportedCurrencies = byStatus.get("unsupported-currency") ?? [];
  if (unsupportedCurrencies.length) {
    const currencies = [...new Set(unsupportedCurrencies.map((row) => row.localCurrency))].join(", ");
    warnings.push({
      id: "unsupported-currency",
      severity: "critical",
      title: "Unsupported currency",
      detail: `${currencies} holdings remain visible but are excluded from AUD totals until supported.`,
      holdingIds: unsupportedCurrencies.map((row) => row.id),
    });
  }

  const unvalued = byStatus.get("unvalued") ?? [];
  if (unvalued.length) {
    warnings.push({
      id: "unvalued",
      severity: "critical",
      title: "Portfolio total is incomplete",
      detail: `${unvalued.length} holding${unvalued.length === 1 ? " has" : "s have"} no usable AUD value. Missing data is never replaced with zero.`,
      holdingIds: unvalued.map((row) => row.id),
    });
  }

  const unsupported = byStatus.get("unsupported-position") ?? [];
  if (unsupported.length) {
    warnings.push({
      id: "unsupported-position",
      severity: "critical",
      title: "Unsupported portfolio position",
      detail: "Negative quantity, short positions, or negative cash stop percentage-based X-Ray calculations.",
      holdingIds: unsupported.map((row) => row.id),
    });
  }

  const unknown = byStatus.get("unknown-instrument") ?? [];
  if (unknown.length) {
    warnings.push({
      id: "unknown-instrument",
      severity: "warning",
      title: "Instrument type needs review",
      detail: `${unknown.length} instrument${unknown.length === 1 ? " is" : "s are"} visible as Unknown until a local override is supplied.`,
      holdingIds: unknown.map((row) => row.id),
    });
  }

  return warnings;
}

function buildAllocation(holdings: NormalizedHolding[], totalAud: number | null): AllocationRow[] {
  const entries = new Map<string, AllocationRow>();
  for (const holding of holdings) {
    if (holding.audValue === null || !holding.identityKey) continue;
    const existing = entries.get(holding.identityKey);
    if (existing) {
      existing.valueAud += holding.audValue;
      continue;
    }
    entries.set(holding.identityKey, {
      key: holding.identityKey,
      label: holding.type === "cash" ? `${holding.localCurrency} cash` : holding.ticker,
      type: holding.type,
      valueAud: holding.audValue,
      weight: totalAud && totalAud > 0 ? holding.audValue / totalAud : null,
      status: holding.status === "valued" ? undefined : holding.status,
    });
  }
  return [...entries.values()]
    .map((row) => ({ ...row, weight: totalAud && totalAud > 0 ? row.valueAud / totalAud : null }))
    .sort((a, b) => b.valueAud - a.valueAud);
}

export function buildPortfolioModel(
  holdings: NormalizedHolding[],
  selectedAccountIds: string[],
): PortfolioModel {
  const supportedValueAud = holdings.reduce((sum, holding) => sum + (holding.audValue ?? 0), 0);
  const hasIncompleteHolding = holdings.some((holding) => holding.status === "unvalued" || holding.status === "unsupported-currency");
  const hasUnsupportedPosition = holdings.some((holding) => holding.status === "unsupported-position");
  const totalAud = holdings.length > 0 && !hasIncompleteHolding && !hasUnsupportedPosition ? supportedValueAud : null;
  const warnings = buildWarnings(holdings);
  return {
    holdings,
    selectedAccountIds,
    totalAud,
    supportedValueAud,
    valuedHoldingCount: holdings.filter((holding) => holding.audValue !== null).length,
    incomplete: totalAud === null,
    warnings,
    instrumentAllocation: buildAllocation(holdings, totalAud),
    etfs: [...new Map(
      holdings
        .filter((holding) => holding.type === "etf" && holding.etfKey)
        .map((holding) => [holding.etfKey, {
          etfKey: holding.etfKey as string,
          profileId: holding.profileId,
          symbol: holding.ticker,
          name: holding.name,
          currency: holding.localCurrency,
        }]),
    ).values()],
  };
}

export function isPercentageCalculationAvailable(model: PortfolioModel): boolean {
  return model.totalAud !== null && model.totalAud > 0 && !model.incomplete;
}

export function normalizeAssetProfile(asset: Asset | null | undefined, instrumentSymbol?: string): AssetProfile | null {
  if (!asset) return null;
  return {
    id: asset.id,
    name: asset.name || instrumentSymbol || asset.displayCode || "Unmapped instrument",
    symbol: asset.instrumentSymbol || asset.displayCode || instrumentSymbol || "",
    mic: asset.instrumentExchangeMic || undefined,
    instrumentKey: asset.instrumentKey || undefined,
    instrumentType: asset.instrumentType || undefined,
    currency: asset.quoteCcy,
    kind: asset.kind,
  };
}
