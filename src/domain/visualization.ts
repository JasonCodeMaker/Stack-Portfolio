import type { AllocationRow, AssetType, ExposureModel, ExposureRow, NormalizedHolding } from "@/types/domain";

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

export interface ConcentrationSummary {
  top1: number | null;
  top5: number | null;
  top10: number | null;
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
    { key: "strategy:individual-stocks", label: "Individual stocks", type: "stock", types: ["stock"] },
    { key: "strategy:cash", label: "Cash", type: "cash", types: ["cash"] },
    { key: "strategy:other", label: "Other investments", type: "other", types: ["fixed-income", "derivative", "other", "unknown"] },
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

export function concentrationOf(nodes: VisualizationNode[]): ConcentrationSummary {
  const weights = nodes.flatMap((node) => node.weight === null ? [] : [node.weight]).sort((a, b) => b - a);
  if (!weights.length) return { top1: null, top5: null, top10: null };
  const sum = (count: number) => weights.slice(0, count).reduce((total, value) => total + value, 0);
  return { top1: sum(1), top5: sum(5), top10: sum(10) };
}

export function topNodesWithOther(nodes: VisualizationNode[], limit = 5): VisualizationNode[] {
  if (nodes.length <= limit + 1) return nodes;
  const visible = nodes.slice(0, limit);
  const rest = nodes.slice(limit);
  const otherValue = rest.reduce((sum, row) => sum + row.valueAud, 0);
  return [...visible, {
    key: "breakdown:other",
    label: "Other",
    valueAud: otherValue,
    weight: rest.every((row) => row.weight !== null) ? rest.reduce((sum, row) => sum + (row.weight ?? 0), 0) : null,
    directAud: rest.reduce((sum, row) => sum + row.directAud, 0),
    viaEtfsAud: rest.reduce((sum, row) => sum + row.viaEtfsAud, 0),
  }];
}

export function assetTypeLabel(type: AssetType): string {
  return ({ stock: "Equity", etf: NOT_LOOKED_THROUGH, cash: "Cash", "fixed-income": "Fixed income", derivative: "Derivatives", other: "Other", unknown: "Unclassified" })[type];
}
