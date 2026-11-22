import type { AllocationRow, AssetType, ExposureModel, ExposureRow, NormalizedHolding } from "./types";
import { CASH_TARGET, OTHER_INVESTMENTS, STOCKS_TARGET } from "./rebalance";

/** Value held in funds whose holdings could not be loaded, so it cannot be classified. */
export const NOT_LOOKED_THROUGH = "Not looked through";

export type BreakdownLens = "holdings" | "accounts" | "assets" | "sectors" | "countries" | "currencies";

export interface VisualizationNode {
  key: string;
  label: string;
  valueAud: number;
  weight: number | null;
  type?: AssetType;
  directAud: number;
  viaEtfsAud: number;
  source?: ExposureRow;
}

function toWeight(valueAud: number, totalAud: number | null): number | null {
  return totalAud !== null && totalAud > 0 ? valueAud / totalAud : null;
}

function aggregate(
  rows: Array<{ key: string; label: string; valueAud: number; type?: AssetType; directAud?: number; viaEtfsAud?: number }>,
  totalAud: number | null,
): VisualizationNode[] {
  const nodes = new Map<string, VisualizationNode>();
  for (const row of rows) {
    const current = nodes.get(row.key) ?? {
      key: row.key,
      label: row.label,
      valueAud: 0,
      weight: null,
      type: row.type,
      directAud: 0,
      viaEtfsAud: 0,
    };
    current.valueAud += row.valueAud;
    current.directAud += row.directAud ?? 0;
    current.viaEtfsAud += row.viaEtfsAud ?? 0;
    current.weight = toWeight(current.valueAud, totalAud);
    nodes.set(row.key, current);
  }
  return [...nodes.values()].sort((a, b) => b.valueAud - a.valueAud);
}

export function buildCoreSatelliteAllocation(allocation: AllocationRow[], totalAud: number | null): AllocationRow[] {
  const etfs = allocation.filter((row) => row.type === "etf").map((row) => ({ ...row, weight: toWeight(row.valueAud, totalAud) }));
  const groups: Array<{ key: string; label: string; type: AssetType; types: AssetType[] }> = [
    { key: STOCKS_TARGET, label: "Individual stocks", type: "stock", types: ["stock"] },
    { key: CASH_TARGET, label: "Cash", type: "cash", types: ["cash"] },
    { key: OTHER_INVESTMENTS, label: "Other investments", type: "other", types: ["fixed-income", "derivative", "other", "unknown"] },
  ];
  const grouped = groups.flatMap((group): AllocationRow[] => {
    const valueAud = allocation.filter((row) => group.types.includes(row.type)).reduce((sum, row) => sum + row.valueAud, 0);
    return valueAud > 0 ? [{ key: group.key, label: group.label, type: group.type, valueAud, weight: toWeight(valueAud, totalAud) }] : [];
  });
  return [...etfs, ...grouped].sort((a, b) => b.valueAud - a.valueAud);
}

export function buildPurchasedNodes(allocation: AllocationRow[]): VisualizationNode[] {
  return allocation.map((row) => ({
    key: row.key,
    label: row.label,
    valueAud: row.valueAud,
    weight: row.weight,
    type: row.type,
    directAud: row.valueAud,
    viaEtfsAud: 0,
  }));
}

export function buildBreakdownNodes(
  lens: BreakdownLens,
  allocation: AllocationRow[],
  holdings: NormalizedHolding[],
  exposure: ExposureModel,
  totalAud: number | null,
): VisualizationNode[] {
  if (lens === "holdings") return buildPurchasedNodes(allocation);
  if (lens === "accounts") {
    return aggregate(holdings.flatMap((row) => row.audValue === null ? [] : [{ key: row.accountId, label: row.accountName, valueAud: row.audValue, type: row.type }]), totalAud);
  }
  if (lens === "currencies") {
    return aggregate(holdings.flatMap((row) => row.audValue === null ? [] : [{ key: row.localCurrency, label: row.localCurrency, valueAud: row.audValue, type: row.type }]), totalAud);
  }
  if (lens === "assets") {
    return aggregate(exposure.rows.map((row) => ({ key: row.type, label: assetTypeLabel(row.type), valueAud: row.totalAud, type: row.type, directAud: row.directAud, viaEtfsAud: row.viaEtfsAud })), exposure.totalAud);
  }
  const field = lens === "sectors" ? "sector" : "country";
  return aggregate(exposure.rows.map((row) => {
    const label = row.type === "cash" ? "Cash" : row.type === "etf" ? NOT_LOOKED_THROUGH : row[field] ?? "Unclassified";
    return { key: label, label, valueAud: row.totalAud, type: row.type, directAud: row.directAud, viaEtfsAud: row.viaEtfsAud };
  }), exposure.totalAud);
}

export function assetTypeLabel(type: AssetType): string {
  return ({ stock: "Equity", etf: NOT_LOOKED_THROUGH, cash: "Cash", "fixed-income": "Fixed income", derivative: "Derivatives", other: "Other", unknown: "Unclassified" })[type];
}
