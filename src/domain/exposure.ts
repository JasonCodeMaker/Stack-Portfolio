import { applyAlias, canonicalEtfKey, canonicalIdentity } from "@/domain/identifiers";
import type {
  AssetType,
  EtfHoldingsSnapshot,
  EtfSource,
  ExposureModel,
  ExposureRow,
  ExposureSource,
  NormalizedHolding,
  ResidualSource,
} from "@/types/domain";

const MAX_RECURSION_DEPTH = 3;

interface ExposureInput {
  holdings: NormalizedHolding[];
  snapshots: Map<string, EtfHoldingsSnapshot>;
  totalAud: number | null;
  aliases?: Record<string, string>;
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

export function buildExposureModel(input: ExposureInput): ExposureModel {
  const rows = new Map<string, ExposureRow>();
  const snapshotByKey = input.snapshots;
  const aliases = input.aliases ?? {};
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
      existing.sector = mergeMetadata(existing.sector, args.sector);
      existing.country = mergeMetadata(existing.country, args.country);
      existing.status = mergeMetadata(existing.status, args.status);
      return;
    }
    rows.set(args.key, {
      key: args.key,
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
    addRow({ key, label, type: "etf", amountAud, source, status: reason });
  }

  function findNestedKey(symbol: string | undefined, mic: string | undefined, currency: string | undefined): string | null {
    const candidate = canonicalEtfKey({ symbol, mic, currency });
    if (candidate && snapshotByKey.has(candidate)) return candidate;
    const normalizedSymbol = symbol?.trim().toUpperCase();
    if (!normalizedSymbol) return null;
    return [...snapshotByKey.keys()].find((key) => key.toUpperCase().endsWith(`:${normalizedSymbol}`)) ?? null;
  }

  function expandEtf(
    holding: NormalizedHolding,
    etfKey: string,
    etfValueAud: number,
    path: string[],
    depth: number,
  ): ExpansionResult {
    const snapshot = snapshotByKey.get(etfKey);
    if (!snapshot) {
      addOpaque(holding, etfValueAud, `opaque-etf:${etfKey}`, `${holding.ticker} · Opaque ETF`, "Missing constituent snapshot");
      return { coveredValueAud: 0 };
    }

    let covered = 0;
    for (const constituent of snapshot.holdings) {
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
        covered += expandEtf(holding, nestedKey, amountAud, [...path, nestedKey], depth + 1).coveredValueAud;
        continue;
      }

      const identity = applyAlias(canonicalIdentity(constituent).key, aliases)
        ?? `unclassified:${constituent.name.trim().toUpperCase()}`;
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
        label: constituent.name,
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
      coveredValueAud += expandEtf(holding, holding.etfKey, holding.audValue, [holding.etfKey], 0).coveredValueAud;
      continue;
    }

    const key = holding.identityKey ?? `unclassified:${holding.id}`;
    const source: ExposureSource = {
      kind: "direct",
      holdingId: holding.id,
      accountId: holding.accountId,
      accountName: holding.accountName,
      amountAud: holding.audValue,
    };
    addRow({
      key,
      label: holding.name,
      type: holding.type,
      amountAud: holding.audValue,
      direct: true,
      source,
      status: holding.status === "valued" ? undefined : holding.status,
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

export function topRows(rows: ExposureRow[], limit = 10): ExposureRow[] {
  if (rows.length <= limit) return rows;
  const top = rows.slice(0, limit);
  const other = rows.slice(limit).reduce((sum, row) => sum + row.totalAud, 0);
  return [...top, {
    key: "other",
    label: "Other",
    type: "other",
    directAud: rows.slice(limit).reduce((sum, row) => sum + row.directAud, 0),
    viaEtfsAud: rows.slice(limit).reduce((sum, row) => sum + row.viaEtfsAud, 0),
    totalAud: other,
    portfolioWeight: rows[0]?.portfolioWeight === null ? null : rows.slice(limit).reduce((sum, row) => sum + (row.portfolioWeight ?? 0), 0),
    status: "View-only aggregation",
    sources: [],
  }];
}
