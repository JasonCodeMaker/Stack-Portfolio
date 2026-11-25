import type { AllocationRow, AssetType, ExposureModel, ExposureRow, RebalanceModel, RebalanceRow } from "./types";

export interface TailMember {
  key: string;
  ticker?: string;
  label: string;
  valueAud: number;
  weight: number | null;
}

export type OtherBucketKind = "etf" | "small-direct" | "opaque" | "residual" | "small-cash" | "other-assets";

export interface OtherBucket {
  key: string;
  kind: OtherBucketKind;
  ticker: string;
  label: string;
  subtitle?: string;
  valueAud: number;
  weight: number | null;
  shareOfOther: number | null;
  memberCount: number;
  members: TailMember[];
  restValueAud: number;
  restCount: number;
}

function buildOtherBuckets(
  foldedRows: ExposureRow[],
  totalAud: number | null,
  maxTailMembersPerBucket = 14,
): OtherBucket[] {
  interface BucketAcc {
    key: string;
    kind: OtherBucketKind;
    ticker: string;
    label: string;
    subtitle?: string;
    valueAud: number;
    unattributedAud: number;
    members: Map<string, { key: string; ticker?: string; label: string; valueAud: number }>;
  }
  const bucketMap = new Map<string, BucketAcc>();
  const ensure = (key: string, kind: OtherBucketKind, ticker: string, label: string, subtitle?: string): BucketAcc => {
    let acc = bucketMap.get(key);
    if (!acc) {
      acc = { key, kind, ticker, label, subtitle, valueAud: 0, unattributedAud: 0, members: new Map() };
      bucketMap.set(key, acc);
    }
    return acc;
  };
  const addMember = (acc: BucketAcc, row: ExposureRow, amountAud: number) => {
    const existing = acc.members.get(row.key);
    if (existing) existing.valueAud += amountAud;
    else {
      acc.members.set(row.key, {
        key: row.key,
        ticker: row.ticker,
        label: displayName(row.label),
        valueAud: amountAud,
      });
    }
  };

  for (const row of foldedRows) {
    if (row.totalAud <= 0) continue;
    if (row.type === "cash") {
      const acc = ensure("small-cash", "small-cash", "现金", "小额现金");
      acc.valueAud += row.totalAud;
      continue;
    }
    if (!row.sources.length) {
      const acc = ensure("other-assets", "other-assets", "其他资产", "其他资产");
      acc.valueAud += row.totalAud;
      addMember(acc, row, row.totalAud);
      continue;
    }
    const isSyntheticOthers = row.type === "other" && (!row.ticker || row.key.startsWith("others-etf:"));
    for (const source of row.sources) {
      if (source.amountAud <= 0) continue;
      if (source.kind === "etf") {
        const sym = source.etfSymbol || source.etfKey;
        const acc = ensure(`etf:${sym}`, "etf", sym, sym);
        acc.valueAud += source.amountAud;
        if (isSyntheticOthers) acc.unattributedAud += source.amountAud;
        else addMember(acc, row, source.amountAud);
      } else if (source.kind === "opaque") {
        const sym = source.etfSymbol || source.etfKey;
        const acc = ensure(`opaque:${sym}`, "opaque", sym, `${sym}（未穿透）`, source.reason || "缺少成分表");
        acc.valueAud += source.amountAud;
      } else if (source.kind === "residual") {
        const acc = ensure("residual", "residual", "未穿透余项", "未穿透基金余项", "成分表未覆盖的 ETF 尾项");
        acc.valueAud += source.amountAud;
      } else if (row.type === "stock") {
        const acc = ensure("small-direct", "small-direct", "直接小仓位", "直接持有小仓位", "单家占比 ≤ 1%");
        acc.valueAud += source.amountAud;
        addMember(acc, row, source.amountAud);
      } else {
        const acc = ensure("other-assets", "other-assets", "其他资产", "其他资产");
        acc.valueAud += source.amountAud;
        if (!isSyntheticOthers) addMember(acc, row, source.amountAud);
        else acc.unattributedAud += source.amountAud;
      }
    }
  }

  const raw = [...bucketMap.values()].filter((b) => b.valueAud > 0).sort((a, b) => b.valueAud - a.valueAud);
  const otherTotal = raw.reduce((sum, b) => sum + b.valueAud, 0);
  const weightOf = (v: number) => (totalAud != null && totalAud > 0 ? v / totalAud : null);

  return raw.map((acc) => {
    const sorted = [...acc.members.values()].sort((a, b) => b.valueAud - a.valueAud);
    const visible = sorted.slice(0, maxTailMembersPerBucket);
    const hidden = sorted.slice(maxTailMembersPerBucket);
    const restValueAud = hidden.reduce((sum, m) => sum + m.valueAud, 0) + acc.unattributedAud;
    return {
      key: acc.key,
      kind: acc.kind,
      ticker: acc.ticker,
      label: acc.label,
      subtitle: acc.subtitle,
      valueAud: acc.valueAud,
      weight: weightOf(acc.valueAud),
      shareOfOther: otherTotal > 0 ? acc.valueAud / otherTotal : null,
      memberCount: sorted.length,
      members: visible.map((m) => ({
        key: m.key,
        ticker: m.ticker,
        label: m.label,
        valueAud: m.valueAud,
        weight: weightOf(m.valueAud),
      })),
      restValueAud,
      restCount: hidden.length + (acc.unattributedAud > 0 ? 1 : 0),
    };
  });
}

/** Use the untruncated exposure model so direct and ETF positions count toward one company weight. */
export function buildComposition(exposure: ExposureModel, totalAud: number | null) {
  const companies = exposure.rows
    .filter((row) => row.type === "stock" && row.totalAud > 0)
    .slice(0, 5)
    .map((row) => ({ ...row, label: displayName(row.label) }));
  const cash = exposure.rows.filter((row) => row.type === "cash");
  const cashAud = cash.reduce((sum, row) => sum + row.totalAud, 0);
  const cashDirectAud = cash.reduce((sum, row) => sum + row.directAud, 0);
  const cashViaEtfsAud = cash.reduce((sum, row) => sum + row.viaEtfsAud, 0);
  const waiting = exposure.rows.filter((row) => row.type === "etf" && row.sources.some((s) => s.kind === "opaque"));
  const entries = [
    ...exposure.rows.filter((row) => row.type !== "cash"),
    { key: "composition:cash", label: "Cash", ticker: undefined, type: "cash" as const, totalAud: cashAud,
      directAud: cashDirectAud, viaEtfsAud: cashViaEtfsAud, sources: cash.flatMap((row) => row.sources) },
  ];
  const named = [];
  let otherAud = 0;
  const foldedRows: ExposureRow[] = [];
  if (totalAud != null && totalAud > 0) {
    for (const row of entries) {
      if (row.totalAud <= 0) continue;
      const weight = row.totalAud / totalAud;
      const isUnattributed = (row.type === "etf" && row.sources.every((s) => s.kind === "residual"))
        || (row.type === "other" && (!row.ticker || row.key.startsWith("others-etf:")));
      if (weight - 0.01 > Number.EPSILON && !isUnattributed) {
        const { key, label, ticker, type, totalAud, directAud, viaEtfsAud } = row;
        named.push({ key, label: displayName(label), ticker, type, totalAud, directAud, viaEtfsAud, weight });
      } else {
        otherAud += row.totalAud;
        foldedRows.push(row as ExposureRow);
      }
    }
  }
  const otherBuckets = buildOtherBuckets(foldedRows, totalAud);
  return { named, otherAud, otherBuckets, companies, waiting };
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
