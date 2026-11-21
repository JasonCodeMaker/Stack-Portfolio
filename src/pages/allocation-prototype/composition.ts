// PROTOTYPE — corrected look-through composition shared by every layout variant.
//
// Fixes the current treemap, which reads the per-ETF top-10 model and therefore shows one
// "Others" tile per fund (both labelled "Others") and under-counts any company that sits
// outside one fund's top 10. Here companies are ranked across the whole portfolio from the
// untruncated model, the tail folds into ONE "Other companies" slice, and non-company value
// (cash, bonds, funds without holdings data) is kept as its own labelled slices, so the
// slices always add up to 100% of the portfolio.
import type { AllocationRow, AssetType, ExposureModel, ExposureRow, RebalanceModel, RebalanceRow } from "@/types/domain";

export type SliceKind = "company" | "other-companies" | "cash" | "fixed-income" | "other-assets" | "unresolved";

export interface FundContribution {
  label: string;
  amountAud: number;
}

export interface CompositionSlice {
  key: string;
  label: string;
  ticker?: string;
  kind: SliceKind;
  valueAud: number;
  weight: number | null;
  directAud: number;
  viaEtfsAud: number;
  memberCount: number;
  sector?: string;
  country?: string;
  direct: FundContribution[];
  viaFunds: FundContribution[];
  /** For grouped companies: how the group splits by sector. */
  bySector: Array<{ sector: string; valueAud: number; weight: number | null; count: number }>;
}

const NON_COMPANY_BUCKETS: Array<{ kind: SliceKind; label: string; types: AssetType[] }> = [
  { kind: "cash", label: "Cash", types: ["cash"] },
  { kind: "fixed-income", label: "Bonds & fixed income", types: ["fixed-income"] },
  { kind: "other-assets", label: "Other assets", types: ["derivative", "other", "unknown"] },
  { kind: "unresolved", label: "Fund holdings not available", types: ["etf"] },
];

export function buildComposition(exposure: ExposureModel, topCompanies = 12): CompositionSlice[] {
  const total = exposure.totalAud;
  const companies = exposure.rows.filter((row) => row.type === "stock").sort((a, b) => b.totalAud - a.totalAud);
  const slices: CompositionSlice[] = companies.slice(0, topCompanies).map((row) => slice(row.key, row.label, "company", [row], total, row.ticker));
  const tail = companies.slice(topCompanies);
  if (tail.length) slices.push(slice("composition:other-companies", "Other companies", "other-companies", tail, total));
  for (const bucket of NON_COMPANY_BUCKETS) {
    const rows = exposure.rows.filter((row) => bucket.types.includes(row.type));
    if (rows.length) slices.push(slice(`composition:${bucket.kind}`, bucket.label, bucket.kind, rows, total));
  }
  return slices;
}

/** Every company in look-through order, for "show all" tables. */
export function allCompanies(exposure: ExposureModel): CompositionSlice[] {
  return exposure.rows
    .filter((row) => row.type === "stock")
    .sort((a, b) => b.totalAud - a.totalAud)
    .map((row) => slice(row.key, row.label, "company", [row], exposure.totalAud, row.ticker));
}

function slice(key: string, label: string, kind: SliceKind, rows: ExposureRow[], total: number, ticker?: string): CompositionSlice {
  const valueAud = rows.reduce((sum, row) => sum + row.totalAud, 0);
  const direct = new Map<string, number>();
  const viaFunds = new Map<string, number>();
  for (const row of rows) {
    for (const source of row.sources) {
      if (source.kind === "direct") direct.set(source.accountName, (direct.get(source.accountName) ?? 0) + source.amountAud);
      else viaFunds.set(source.etfSymbol, (viaFunds.get(source.etfSymbol) ?? 0) + source.amountAud);
    }
  }
  const toList = (map: Map<string, number>) => [...map].map(([name, amountAud]) => ({ label: name, amountAud })).sort((a, b) => b.amountAud - a.amountAud);
  const sectors = new Map<string, { valueAud: number; count: number }>();
  if (kind === "other-companies") {
    for (const row of rows) {
      const name = row.sector ?? "Unclassified";
      const entry = sectors.get(name) ?? { valueAud: 0, count: 0 };
      entry.valueAud += row.totalAud;
      entry.count += 1;
      sectors.set(name, entry);
    }
  }
  return {
    key,
    label: kind === "company" ? tidyName(label) : label,
    ticker,
    kind,
    valueAud,
    weight: total > 0 ? valueAud / total : null,
    directAud: rows.reduce((sum, row) => sum + row.directAud, 0),
    viaEtfsAud: rows.reduce((sum, row) => sum + row.viaEtfsAud, 0),
    memberCount: rows.length,
    sector: rows.length === 1 ? rows[0].sector : undefined,
    country: rows.length === 1 ? rows[0].country : undefined,
    direct: toList(direct),
    viaFunds: toList(viaFunds),
    bySector: [...sectors].map(([sector, entry]) => ({ sector, ...entry, weight: total > 0 ? entry.valueAud / total : null })).sort((a, b) => b.valueAud - a.valueAud),
  };
}

export type Dimension = "sectors" | "countries" | "assets";

/**
 * Look-through breakdown with honest labels: value in funds we could not open is
 * "Not looked through", not "Unclassified" (which is kept for stocks missing metadata).
 */
export function buildDimension(dimension: Dimension, exposure: ExposureModel): Array<{ key: string; label: string; valueAud: number; weight: number | null; directAud: number; viaEtfsAud: number }> {
  const assetLabel: Record<AssetType, string> = { stock: "Shares", etf: "Not looked through", cash: "Cash", "fixed-income": "Bonds & fixed income", derivative: "Derivatives", other: "Other", unknown: "Unclassified" };
  const groups = new Map<string, { key: string; label: string; valueAud: number; weight: number | null; directAud: number; viaEtfsAud: number }>();
  for (const row of exposure.rows) {
    const label = row.type === "etf" ? "Not looked through"
      : row.type === "cash" ? "Cash"
        : dimension === "assets" ? assetLabel[row.type]
          : (dimension === "sectors" ? row.sector : row.country) ?? "Unclassified";
    const entry = groups.get(label) ?? { key: label, label, valueAud: 0, weight: null, directAud: 0, viaEtfsAud: 0 };
    entry.valueAud += row.totalAud;
    entry.directAud += row.directAud;
    entry.viaEtfsAud += row.viaEtfsAud;
    entry.weight = exposure.totalAud > 0 ? entry.valueAud / exposure.totalAud : null;
    groups.set(label, entry);
  }
  return [...groups.values()].sort((a, b) => b.valueAud - a.valueAud);
}

function tidyName(value: string): string {
  return value === value.toUpperCase() ? value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : value;
}

/** One row per rebalance bucket; grouped buckets carry the holdings inside them. */
export interface PlanRow extends RebalanceRow {
  children: AllocationRow[];
}

export function buildPlanRows(model: RebalanceModel, allocation: AllocationRow[]): PlanRow[] {
  const members: Record<string, AssetType[]> = {
    "strategy:individual-stocks": ["stock"],
    "strategy:cash": ["cash"],
    "strategy:other": ["fixed-income", "derivative", "other", "unknown"],
  };
  return model.rows.map((row) => ({
    ...row,
    children: members[row.key] ? allocation.filter((item) => members[row.key].includes(item.type)) : [],
  }));
}
