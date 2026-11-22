import { canonicalEtfKey, canonicalIdentity } from "./identifiers";
import { convertToAud, normalizeCurrency } from "./currency";
import type {
  AllocationRow,
  AssetProfile,
  AssetType,
  FxQuote,
  HoldingInput,
  NormalizedHolding,
  PortfolioAccount,
  PortfolioModel,
  PortfolioWarning,
} from "./types";

function asFiniteNumber(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function weightedMetadataLabel(value: unknown): string | undefined {
  const parsed = parseJsonValue(value);
  if (typeof parsed === "string") return parsed.trim() || undefined;
  if (!Array.isArray(parsed)) return undefined;
  const candidates = parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ name: typeof item.name === "string" ? item.name.trim() : "", weight: Number(item.weight ?? 0) }))
    .filter((item) => item.name)
    .sort((a, b) => b.weight - a.weight);
  return candidates[0]?.name;
}

function profileMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const parsed = parseJsonValue(metadata?.profile);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : metadata ?? {};
}

export function normalizeSectorName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const aliases: Record<string, string> = {
    technology: "Information Technology",
    "financial services": "Financials",
    "communication services": "Communication",
    healthcare: "Health Care",
    "consumer cyclical": "Consumer Discretionary",
    "consumer defensive": "Consumer Staples",
    "basic materials": "Materials",
    realestate: "Real Estate",
  };
  return aliases[value.trim().toLowerCase()] ?? value.trim();
}

export function securityType(profile: AssetProfile | null): AssetType {

  const instrumentType = profile?.instrumentType?.toUpperCase() ?? "";
  const metadataType = ["quoteType", "instrumentType", "assetType", "type"]
    .map((key) => profile?.metadata?.[key])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toUpperCase();
  const profileName = profile?.name?.toUpperCase() ?? "";
  if (instrumentType.includes("ETF") || instrumentType.includes("MUTUAL") || metadataType.includes("ETF") || metadataType.includes("FUND") || /\bETF\b|EXCHANGE[- ]TRADED FUND/.test(profileName)) return "etf";
  if (instrumentType.includes("BOND") || instrumentType.includes("FIXED")) return "fixed-income";
  if (instrumentType.includes("OPTION") || instrumentType.includes("DERIVATIVE")) return "derivative";
  if (instrumentType.includes("EQUITY") || instrumentType.includes("STOCK")) return "stock";

  const kind = profile?.kind?.toUpperCase() ?? "";
  if (kind === "INVESTMENT" && profile?.symbol) return "unknown";
  return "unknown";
}

export function normalizeHolding(
  holding: HoldingInput,
  account: PortfolioAccount,
  profile: AssetProfile | null,
  fxQuote: FxQuote | null,
  typeOverride?: AssetType,
): NormalizedHolding {
  const localCurrency = normalizeCurrency(holding.localCurrency);
  const nativeValue = asFiniteNumber(holding.marketValue?.local);
  const hostBaseValue = asFiniteNumber(holding.marketValue?.base);
  const quantity = holding.quantity;
  const type = typeOverride ?? (holding.holdingType === "cash" ? "cash" : securityType(profile));
  const conversion = convertToAud(nativeValue, localCurrency, fxQuote);
  const audValue = conversion.audValue ?? hostBaseValue;
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
  const metadata = profileMetadata(profile?.metadata);
  const sector = normalizeSectorName(weightedMetadataLabel(metadata.sectors ?? metadata.sector));
  const country = weightedMetadataLabel(metadata.countries ?? metadata.country);

  let status: NormalizedHolding["status"] = "valued";
  let issue: string | undefined;
  if (quantity < 0 || (type === "cash" && nativeValue !== null && nativeValue < 0)) {
    status = "unsupported-position";
    issue = "Negative quantity or cash is not supported in v1";
  } else if (audValue === null && nativeValue === null) {
    status = "unvalued";
    issue = "No usable market value";
  } else if (audValue === null && !conversion.supported) {
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
    audValue,
    priceUpdatedAt: holding.asOfDate || null,
    identityKey: identity.key,
    etfKey,
    mic: profile?.mic || undefined,
    profileId: holding.instrument?.id ?? null,
    sector,
    country,
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
