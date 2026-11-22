import type { AllocationRow, AssetType, ExposureModel, ExposureRow, ExposureSource, RebalanceModel, RebalanceRow } from "./types";

export type CompositionKind = "company" | "other-companies" | "cash" | "fixed-income" | "other-assets" | "unresolved";

export interface SectorShare {
  sector: string;
  valueAud: number;
  weight: number | null;
  count: number;
}

/** One part of the portfolio composition. Slices always add up to the whole portfolio. */
export interface CompositionSlice {
  key: string;
  label: string;
  ticker?: string;
  kind: CompositionKind;
  valueAud: number;
  weight: number | null;
  directAud: number;
  viaEtfsAud: number;
  memberCount: number;
  sector?: string;
  sources: ExposureSource[];
  bySector: SectorShare[];
}

const BUCKETS: Array<{ kind: CompositionKind; label: string; types: AssetType[] }> = [
  { kind: "cash", label: "Cash", types: ["cash"] },
  { kind: "fixed-income", label: "Bonds & fixed income", types: ["fixed-income"] },
  { kind: "other-assets", label: "Other assets", types: ["derivative", "other", "unknown"] },
  { kind: "unresolved", label: "Fund holdings not available", types: ["etf"] },
];

/**
 * Ranks companies across the whole portfolio and folds everything below the top
 * `topCompanies` into one "Other companies" slice. Pass the untruncated exposure model:
 * a per-fund top-N model hides part of a company's value in each fund's own remainder.
 */
export function buildComposition(exposure: ExposureModel, topCompanies = 12): CompositionSlice[] {
  const companies = exposure.rows.filter((row) => row.type === "stock").sort((a, b) => b.totalAud - a.totalAud);
  const slices = companies.slice(0, topCompanies).map((row) => toSlice(row.key, displayName(row.label), "company", [row], exposure.totalAud, row.ticker));
  const tail = companies.slice(topCompanies);
  if (tail.length) slices.push(toSlice("composition:other-companies", "Other companies", "other-companies", tail, exposure.totalAud));
  for (const bucket of BUCKETS) {
    const rows = exposure.rows.filter((row) => bucket.types.includes(row.type));
    if (rows.length) slices.push(toSlice(`composition:${bucket.kind}`, bucket.label, bucket.kind, rows, exposure.totalAud));
  }
  return slices;
}

function toSlice(key: string, label: string, kind: CompositionKind, rows: ExposureRow[], totalAud: number, ticker?: string): CompositionSlice {
  const valueAud = rows.reduce((sum, row) => sum + row.totalAud, 0);
  const weight = (value: number) => (totalAud > 0 ? value / totalAud : null);
  return {
    key,
    label,
    ticker,
    kind,
    valueAud,
    weight: weight(valueAud),
    directAud: rows.reduce((sum, row) => sum + row.directAud, 0),
    viaEtfsAud: rows.reduce((sum, row) => sum + row.viaEtfsAud, 0),
    memberCount: rows.length,
    sector: kind === "company" ? rows[0].sector : undefined,
    sources: rows.flatMap((row) => row.sources),
    bySector: kind === "other-companies" ? sectorShares(rows, weight) : [],
  };
}

function sectorShares(rows: ExposureRow[], weight: (value: number) => number | null): SectorShare[] {
  const sectors = new Map<string, { valueAud: number; count: number }>();
  for (const row of rows) {
    const sector = row.sector ?? "Unclassified";
    const entry = sectors.get(sector) ?? { valueAud: 0, count: 0 };
    entry.valueAud += row.totalAud;
    entry.count += 1;
    sectors.set(sector, entry);
  }
  return [...sectors]
    .map(([sector, entry]) => ({ sector, valueAud: entry.valueAud, weight: weight(entry.valueAud), count: entry.count }))
    .sort((a, b) => b.valueAud - a.valueAud);
}

/** Provider constituent names often arrive upper-case ("ALPHABET INC CLASS A"). */
function displayName(value: string): string {
  return value === value.toUpperCase() ? value.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase()) : value;
}

/** A rebalance bucket plus the holdings grouped inside it (empty for an individual ETF). */
export interface PlanRow extends RebalanceRow {
  children: AllocationRow[];
}

const BUCKET_MEMBERS: Record<string, AssetType[]> = {
  "strategy:individual-stocks": ["stock"],
  "strategy:cash": ["cash"],
  "strategy:other": ["fixed-income", "derivative", "other", "unknown"],
};

export function buildPlanRows(model: RebalanceModel, allocation: AllocationRow[]): PlanRow[] {
  return model.rows.map((row) => ({
    ...row,
    children: BUCKET_MEMBERS[row.key] ? allocation.filter((item) => BUCKET_MEMBERS[row.key].includes(item.type)) : [],
  }));
}
