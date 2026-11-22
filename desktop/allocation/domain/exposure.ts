import { applyAlias, canonicalCompanyIdentity, canonicalEtfKey, canonicalIdentity, normalizeIdentityPart, preferUsListingKey, usListingKey } from "./identifiers";
import type { CompanyIdentity } from "./identifiers";
import type {
  AssetType,
  EtfHoldingsSnapshot,
  EtfSource,
  ExposureModel,
  ExposureRow,
  ExposureSource,
  NormalizedHolding,
  ResidualSource,
} from "./types";

const MAX_RECURSION_DEPTH = 3;

interface ExposureInput {
  holdings: NormalizedHolding[];
  snapshots: Map<string, EtfHoldingsSnapshot>;
  totalAud: number | null;
  aliases?: Record<string, string>;
  maxConstituentsPerEtf?: number;
}

interface ExpansionResult {
  coveredValueAud: number;
}

function mergeMetadata(current: string | undefined, next: string | undefined): string | undefined {
  if (!next) return current;
  if (!current) return next;
  return current === next ? current : "Mixed/Conflicting";
}

function displayType(type: UnderlyingType): AssetType {
  if (type === "fixed-income") return "fixed-income";
  if (type === "derivative") return "derivative";
  if (type === "cash") return "cash";
  if (type === "etf") return "etf";
  if (type === "stock") return "stock";
  return "other";
}

type UnderlyingType = NonNullable<EtfHoldingsSnapshot["holdings"][number]["underlyingType"]>;
type UnderlyingHolding = EtfHoldingsSnapshot["holdings"][number];
type CompanyConstituent = UnderlyingHolding & { company?: CompanyIdentity };

function shareClassIssuerName(name: string): string | null {
  const match = /^(.*?)\s+CLASS\s+[A-Z0-9]+$/i.exec(name.trim());
  return match?.[1]?.trim() || null;
}

function displayCompanyName(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function discoverShareClassCompanies(snapshots: Map<string, EtfHoldingsSnapshot>): Map<string, CompanyIdentity> {
  const discovered = new Map<string, CompanyIdentity>();
  for (const snapshot of snapshots.values()) {
    const groups = new Map<string, UnderlyingHolding[]>();
    for (const holding of snapshot.holdings) {
      if (holding.underlyingType !== "stock") continue;
      const issuerName = shareClassIssuerName(holding.name);
      if (!issuerName) continue;
      const key = normalizeIdentityPart(issuerName);
      const group = groups.get(key) ?? [];
      group.push(holding);
      groups.set(key, group);
    }
    for (const [issuerKey, shareClasses] of groups) {
      const symbols = [...new Set(shareClasses.map((holding) => holding.symbol?.trim()).filter((symbol): symbol is string => Boolean(symbol)))];
      if (symbols.length < 2) continue;
      const explicit = symbols.map((symbol) => canonicalCompanyIdentity({ symbol })).find((company) => company !== null);
      const company: CompanyIdentity = explicit ?? {
        key: `company:${issuerKey}`,
        label: displayCompanyName(shareClassIssuerName(shareClasses[0].name) ?? issuerKey),
        ticker: symbols.join(" / "),
      };
      for (const symbol of symbols) discovered.set(normalizeIdentityPart(symbol), company);
    }
  }
  return discovered;
}

function resolveCompany(symbol: string | undefined, discovered: Map<string, CompanyIdentity>): CompanyIdentity | null {
  return canonicalCompanyIdentity({ symbol }) ?? discovered.get(normalizeIdentityPart(symbol)) ?? null;
}

function consolidateShareClasses(
  holdings: UnderlyingHolding[],
  discovered: Map<string, CompanyIdentity>,
): CompanyConstituent[] {
  const result: CompanyConstituent[] = [];
  const companies = new Map<string, CompanyConstituent>();
  for (const holding of holdings) {
    const company = holding.underlyingType === "stock" ? resolveCompany(holding.symbol, discovered) : null;
    if (!company) {
      result.push(holding);
      continue;
    }
    const existing = companies.get(company.key);
    if (existing) {
      existing.weight += holding.weight;
      existing.sector = mergeMetadata(existing.sector, holding.sector);
      existing.country = mergeMetadata(existing.country, holding.country);
      continue;
    }
    const consolidated: CompanyConstituent = {
      ...holding,
      symbol: company.ticker,
      name: company.label,
      company,
    };
    companies.set(company.key, consolidated);
    result.push(consolidated);
  }
  return result;
}

export function buildExposureModel(input: ExposureInput): ExposureModel {
  const rows = new Map<string, ExposureRow>();
  const snapshotByKey = input.snapshots;
  const discoveredCompanies = discoverShareClassCompanies(snapshotByKey);
  const aliases = input.aliases ?? {};
  const maxConstituentsPerEtf = input.maxConstituentsPerEtf && input.maxConstituentsPerEtf > 0
    ? Math.floor(input.maxConstituentsPerEtf)
    : null;
  const supportedValueAud = input.holdings.reduce((sum, holding) => sum + (holding.audValue ?? 0), 0);
  let coveredValueAud = 0;
  let eligibleValueAud = 0;

  function addRow(args: {
    key: string;
    label: string;
    type: AssetType;
    amountAud: number;
    direct?: boolean;
    source: ExposureSource;
    ticker?: string;
    sector?: string;
    country?: string;
    status?: string;
  }): void {
    const existing = rows.get(args.key);
    if (existing) {
      if (args.direct) existing.directAud += args.amountAud;
      else existing.viaEtfsAud += args.amountAud;
      existing.totalAud += args.amountAud;
      existing.sources.push(args.source);
      existing.ticker = existing.ticker ?? args.ticker;
      existing.sector = mergeMetadata(existing.sector, args.sector);
      existing.country = mergeMetadata(existing.country, args.country);
      existing.status = mergeMetadata(existing.status, args.status);
      return;
    }
    rows.set(args.key, {
      key: args.key,
      ticker: args.ticker,
      label: args.label,
      type: args.type,
      directAud: args.direct ? args.amountAud : 0,
      viaEtfsAud: args.direct ? 0 : args.amountAud,
      totalAud: args.amountAud,
      portfolioWeight: null,
      sector: args.sector,
      country: args.country,
      status: args.status,
      sources: [args.source],
    });
  }

  function addOpaque(
    holding: NormalizedHolding,
    amountAud: number,
    key: string,
    label: string,
    reason: string,
  ): void {
    const source: ResidualSource = {
      kind: reason === "ETF-specific residual" ? "residual" : "opaque",
      holdingId: holding.id,
      accountId: holding.accountId,
      accountName: holding.accountName,
      etfKey: holding.etfKey ?? key,
      etfSymbol: holding.ticker,
      amountAud,
      reason,
    };
    addRow({ key, ticker: holding.ticker, label, type: "etf", amountAud, source, status: reason });
  }

  function findNestedKey(symbol: string | undefined, mic: string | undefined, currency: string | undefined): string | null {
    const candidate = canonicalEtfKey({ symbol, mic, currency });
    if (candidate && snapshotByKey.has(candidate)) return candidate;
    return null;
  }

  function expandEtf(
    holding: NormalizedHolding,
    etfKey: string,
    etfValueAud: number,
    path: string[],
    depth: number,
    fundLabel: string,
  ): ExpansionResult {
    const snapshot = snapshotByKey.get(etfKey);
    if (!snapshot) {
      addOpaque(holding, etfValueAud, `opaque-etf:${etfKey}`, `${holding.ticker} · Opaque ETF`, "Missing constituent snapshot");
      return { coveredValueAud: 0 };
    }

    let covered = 0;
    const consolidatedHoldings = consolidateShareClasses(snapshot.holdings, discoveredCompanies);
    const ranked = maxConstituentsPerEtf
      ? [...consolidatedHoldings].sort((a, b) => b.weight - a.weight)
      : consolidatedHoldings;
    const visibleConstituents = maxConstituentsPerEtf ? ranked.slice(0, maxConstituentsPerEtf) : ranked;
    const hiddenConstituents = maxConstituentsPerEtf ? ranked.slice(maxConstituentsPerEtf) : [];
    const hiddenAmountAud = hiddenConstituents.reduce((sum, constituent) => sum + etfValueAud * constituent.weight, 0);
    if (hiddenAmountAud > 0) {
      const source: EtfSource = {
        kind: "etf",
        holdingId: holding.id,
        accountId: holding.accountId,
        accountName: holding.accountName,
        etfKey,
        etfSymbol: holding.ticker,
        amountAud: hiddenAmountAud,
        path: [...path, "Others"],
      };
      addRow({
        key: `others-etf:${etfKey}`,
        ticker: "Others",
        label: `${fundLabel} · Others`,
        type: "other",
        amountAud: hiddenAmountAud,
        source,
      });
      covered += hiddenAmountAud;
    }
    for (const constituent of visibleConstituents) {
      const amountAud = etfValueAud * constituent.weight;
      if (amountAud === 0) continue;
      const nestedKey = constituent.underlyingType === "etf"
        ? findNestedKey(constituent.symbol, constituent.mic, constituent.currency)
        : null;
      if (nestedKey) {
        if (path.includes(nestedKey)) {
          addOpaque(holding, amountAud, `opaque-etf:${nestedKey}`, `${constituent.symbol ?? constituent.name} · Opaque ETF`, "Cycle detected");
          continue;
        }
        if (depth >= MAX_RECURSION_DEPTH) {
          addOpaque(holding, amountAud, `opaque-etf:${nestedKey}`, `${constituent.symbol ?? constituent.name} · Opaque ETF`, "Maximum recursion depth reached");
          continue;
        }
        covered += expandEtf(holding, nestedKey, amountAud, [...path, nestedKey], depth + 1, constituent.symbol ?? constituent.name).coveredValueAud;
        continue;
      }

      if (constituent.underlyingType === "etf") {
        addOpaque(
          holding,
          amountAud,
          `opaque-etf:${etfKey}:${constituent.symbol ?? constituent.name}`,
          `${constituent.symbol ?? constituent.name} · Opaque ETF`,
          "Missing nested ETF snapshot",
        );
        continue;
      }

      const canonicalKey = canonicalIdentity(constituent).key;
      const aliasedKey = applyAlias(canonicalKey, aliases, { provider: snapshot.provider, etfKey });
      const identity = constituent.company?.key
        ?? (aliasedKey && aliasedKey !== canonicalKey ? preferUsListingKey(aliasedKey) : null)
        ?? (constituent.underlyingType === "stock" ? usListingKey(constituent) : null)
        ?? canonicalKey
        ?? `unmapped:${etfKey}:${constituent.symbol ?? constituent.name}:${path.length}`;
      const type = displayType(constituent.underlyingType ?? "other");
      const source: EtfSource = {
        kind: "etf",
        holdingId: holding.id,
        accountId: holding.accountId,
        accountName: holding.accountName,
        etfKey,
        etfSymbol: holding.ticker,
        amountAud,
        path: [...path, constituent.symbol ?? constituent.name],
      };
      addRow({
        key: identity,
        ticker: constituent.company?.ticker ?? constituent.symbol,
        label: constituent.company?.label ?? constituent.name,
        type,
        amountAud,
        source,
        sector: constituent.sector,
        country: constituent.country,
      });
      covered += amountAud;
    }

    const residualWeight = Math.max(0, 1 - snapshot.weightSum);
    if (residualWeight > 0.0000001) {
      addOpaque(
        holding,
        etfValueAud * residualWeight,
        `residual-etf:${etfKey}`,
        `${holding.ticker} · ETF residual`,
        "ETF-specific residual",
      );
    }
    return { coveredValueAud: covered };
  }

  for (const holding of input.holdings) {
    if (holding.audValue === null) continue;
    if (holding.type === "etf") {
      eligibleValueAud += holding.audValue;
      if (!holding.etfKey || !snapshotByKey.has(holding.etfKey)) {
        addOpaque(
          holding,
          holding.audValue,
          `opaque-etf:${holding.etfKey ?? holding.id}`,
          `${holding.ticker} · Opaque ETF`,
          "Missing constituent snapshot",
        );
        continue;
      }
      coveredValueAud += expandEtf(holding, holding.etfKey, holding.audValue, [holding.etfKey], 0, holding.ticker).coveredValueAud;
      continue;
    }

    const company = holding.type === "stock" ? resolveCompany(holding.ticker, discoveredCompanies) : null;
    const listingKey = holding.type === "stock"
      ? usListingKey({ symbol: holding.ticker, mic: holding.mic, currency: holding.localCurrency, country: holding.country })
      : null;
    const key = company?.key ?? listingKey ?? (holding.identityKey && preferUsListingKey(holding.identityKey)) ?? `unclassified:${holding.id}`;
    const source: ExposureSource = {
      kind: "direct",
      holdingId: holding.id,
      accountId: holding.accountId,
      accountName: holding.accountName,
      amountAud: holding.audValue,
    };
    addRow({
      key,
      ticker: company?.ticker ?? holding.ticker,
      label: company?.label ?? holding.name,
      type: holding.type,
      amountAud: holding.audValue,
      direct: true,
      source,
      status: holding.status === "valued" ? undefined : holding.status,
      sector: holding.sector,
      country: holding.country,
    });
    if (holding.type !== "cash") {
      eligibleValueAud += holding.audValue;
      coveredValueAud += holding.audValue;
    }
  }

  const denominator = input.totalAud ?? supportedValueAud;
  const exposureRows = [...rows.values()]
    .map((row) => ({
      ...row,
      portfolioWeight: denominator > 0 && !input.totalAud ? null : denominator > 0 ? row.totalAud / denominator : null,
    }))
    .sort((a, b) => b.totalAud - a.totalAud);
  const sum = exposureRows.reduce((total, row) => total + row.totalAud, 0);
  return {
    rows: exposureRows,
    totalAud: denominator,
    coveredValueAud,
    eligibleValueAud,
    coverage: eligibleValueAud > 0 ? coveredValueAud / eligibleValueAud : null,
    valueConservationDelta: sum - supportedValueAud,
    incomplete: input.totalAud === null || input.holdings.some((holding) => holding.status === "unvalued" || holding.status === "unsupported-currency" || holding.status === "unsupported-position"),
  };
}
