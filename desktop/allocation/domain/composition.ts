import type { AllocationRow, AssetType, EtfSource, ExposureModel, ExposureRow, RebalanceModel, RebalanceRow } from "./types";

export interface TailSource {
  key: string;
  ticker: string;
  label: string;
  valueAud: number;
  weight: number | null;
}

export interface TailMember {
  key: string;
  ticker?: string;
  label: string;
  sector?: string;
  country?: string;
  valueAud: number;
  weight: number | null;
  fundWeight?: number | null;
  sources?: TailSource[];
  overlaps?: boolean;
}

export interface TailSectorSlice {
  sector: string;
  valueAud: number;
  weight: number | null;
  shareOfBucket: number | null;
  count: number;
}

export type OtherBucketKind = "etf" | "small-direct" | "opaque" | "residual" | "small-cash" | "other-assets";

export interface OtherBucket {
  key: string;
  kind: OtherBucketKind;
  ticker: string;
  label: string;
  subtitle?: string;
  etfKey?: string;
  etfTotalAud?: number;
  valueAud: number;
  weight: number | null;
  shareOfOther: number | null;
  memberCount: number;
  members: TailMember[];
  allMembers: TailMember[];
  unattributedAud: number;
  sectors: TailSectorSlice[];
  restValueAud: number;
  restCount: number;
}

export interface MergedTailModel {
  totalAud: number;
  weight: number | null;
  members: TailMember[];
  overlapCount: number;
  unattributedAud: number;
  sectors: TailSectorSlice[];
}

function buildSectorSlices(
  members: Array<{ valueAud: number; sector?: string }>,
  unattributedAud: number,
  bucketTotalAud: number,
  totalAud: number | null,
): TailSectorSlice[] {
  const map = new Map<string, { valueAud: number; count: number }>();
  for (const m of members) {
    if (m.valueAud <= 0) continue;
    const sec = !m.sector || m.sector === "Mixed/Conflicting" ? "Unclassified" : m.sector;
    const cur = map.get(sec) ?? { valueAud: 0, count: 0 };
    cur.valueAud += m.valueAud;
    cur.count += 1;
    map.set(sec, cur);
  }
  if (unattributedAud > 0) {
    const cur = map.get("Unclassified") ?? { valueAud: 0, count: 0 };
    cur.valueAud += unattributedAud;
    map.set("Unclassified", cur);
  }
  const weightOf = (v: number) => (totalAud != null && totalAud > 0 ? v / totalAud : null);
  return [...map.entries()]
    .map(([sector, acc]) => ({
      sector,
      valueAud: acc.valueAud,
      weight: weightOf(acc.valueAud),
      shareOfBucket: bucketTotalAud > 0 ? acc.valueAud / bucketTotalAud : null,
      count: acc.count,
    }))
    .sort((a, b) => b.valueAud - a.valueAud);
}

const heldEtfKey = (source: EtfSource) => source.path[0] ?? source.etfKey;

function buildOtherBuckets(
  foldedRows: ExposureRow[],
  allExposureRows: ExposureRow[],
  totalAud: number | null,
  maxTailMembersPerBucket = 14,
): { otherBuckets: OtherBucket[]; mergedTail: MergedTailModel } {
  interface BucketAcc {
    key: string;
    kind: OtherBucketKind;
    ticker: string;
    label: string;
    subtitle?: string;
    etfKey?: string;
    valueAud: number;
    unattributedAud: number;
    members: Map<string, { key: string; ticker?: string; label: string; sector?: string; country?: string; valueAud: number }>;
  }
  const bucketMap = new Map<string, BucketAcc>();
  const ensure = (
    key: string,
    kind: OtherBucketKind,
    ticker: string,
    label: string,
    subtitle?: string,
    etfKey?: string,
  ): BucketAcc => {
    let acc = bucketMap.get(key);
    if (!acc) {
      acc = { key, kind, ticker, label, subtitle, etfKey, valueAud: 0, unattributedAud: 0, members: new Map() };
      bucketMap.set(key, acc);
    } else if (etfKey && !acc.etfKey) {
      acc.etfKey = etfKey;
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
        sector: row.sector,
        country: row.country,
        valueAud: amountAud,
      });
    }
  };

  // Attribute cash, residuals and nested amounts back to the ETF held in the account.
  const etfValues = new Map<string, number>();
  for (const row of allExposureRows) {
    for (const source of row.sources) {
      if (source.kind === "direct") continue;
      const key = source.kind === "etf" ? heldEtfKey(source) : source.etfKey;
      etfValues.set(key, (etfValues.get(key) ?? 0) + source.amountAud);
    }
  }

  for (const row of foldedRows) {
    if (row.totalAud <= 0) continue;
    if (row.type === "cash") {
      const acc = ensure("small-cash", "small-cash", "现金", "小额现金");
      acc.valueAud += row.totalAud;
      acc.unattributedAud += row.totalAud;
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
        const key = heldEtfKey(source);
        const sym = source.etfSymbol || key;
        const acc = ensure(`etf:${key}`, "etf", sym, sym, undefined, key);
        acc.valueAud += source.amountAud;
        if (isSyntheticOthers) acc.unattributedAud += source.amountAud;
        else addMember(acc, row, source.amountAud);
      } else if (source.kind === "opaque") {
        const sym = source.etfSymbol || source.etfKey;
        const acc = ensure(`opaque:${source.etfKey}`, "opaque", sym, `${sym}（未穿透）`, source.reason || "缺少成分表", source.etfKey);
        acc.valueAud += source.amountAud;
        acc.unattributedAud += source.amountAud;
      } else if (source.kind === "residual") {
        const acc = ensure("residual", "residual", "未穿透余项", "未穿透基金余项", "成分表未覆盖的 ETF 尾项");
        acc.valueAud += source.amountAud;
        acc.unattributedAud += source.amountAud;
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
  const etfCountsByTicker = new Map<string, number>();
  for (const bucket of raw) {
    if (bucket.kind === "etf") etfCountsByTicker.set(bucket.ticker, (etfCountsByTicker.get(bucket.ticker) ?? 0) + 1);
  }
  const otherTotal = raw.reduce((sum, b) => sum + b.valueAud, 0);
  const weightOf = (v: number) => (totalAud != null && totalAud > 0 ? v / totalAud : null);

  const otherBuckets = raw.map((acc) => {
    const etfTotalAud = acc.kind === "etf" && acc.etfKey ? etfValues.get(acc.etfKey) : undefined;
    const label = acc.kind === "etf" && (etfCountsByTicker.get(acc.ticker) ?? 0) > 1
      ? `${acc.label} · ${acc.etfKey}` : acc.label;
    const sorted = [...acc.members.values()].sort((a, b) => b.valueAud - a.valueAud);
    const allMembers: TailMember[] = sorted.map((m) => ({
      key: m.key,
      ticker: m.ticker,
      label: m.label,
      sector: m.sector,
      country: m.country,
      valueAud: m.valueAud,
      weight: weightOf(m.valueAud),
      fundWeight: etfTotalAud != null && etfTotalAud > 0 ? m.valueAud / etfTotalAud : null,
      sources: [{ key: acc.key, ticker: acc.ticker, label, valueAud: m.valueAud, weight: weightOf(m.valueAud) }],
      overlaps: false,
    }));
    const visible = allMembers.slice(0, maxTailMembersPerBucket);
    const hidden = allMembers.slice(maxTailMembersPerBucket);
    const restValueAud = hidden.reduce((sum, m) => sum + m.valueAud, 0) + acc.unattributedAud;
    return {
      key: acc.key,
      kind: acc.kind,
      ticker: acc.ticker,
      label,
      subtitle: acc.subtitle,
      etfKey: acc.etfKey,
      etfTotalAud,
      valueAud: acc.valueAud,
      weight: weightOf(acc.valueAud),
      shareOfOther: otherTotal > 0 ? acc.valueAud / otherTotal : null,
      memberCount: sorted.length,
      members: visible,
      allMembers,
      unattributedAud: acc.unattributedAud,
      sectors: buildSectorSlices(allMembers, acc.unattributedAud, acc.valueAud, totalAud),
      restValueAud,
      restCount: hidden.length + (acc.unattributedAud > 0 ? 1 : 0),
    };
  });

  // Merge all tail buckets by company identity so cross-ETF <1% overlaps are exposed directly.
  const mergedMap = new Map<
    string,
    {
      key: string;
      ticker?: string;
      label: string;
      sector?: string;
      country?: string;
      valueAud: number;
      sources: Map<string, TailSource>;
      etfSourceKeys: Set<string>;
    }
  >();
  let totalUnattributedAud = 0;
  for (const bucket of otherBuckets) {
    totalUnattributedAud += bucket.unattributedAud;
    for (const m of bucket.allMembers) {
      let entry = mergedMap.get(m.key);
      if (!entry) {
        entry = {
          key: m.key,
          ticker: m.ticker,
          label: m.label,
          sector: m.sector,
          country: m.country,
          valueAud: 0,
          sources: new Map(),
          etfSourceKeys: new Set(),
        };
        mergedMap.set(m.key, entry);
      } else {
        entry.sector = entry.sector ?? m.sector;
        entry.country = entry.country ?? m.country;
      }
      entry.valueAud += m.valueAud;
      if (bucket.kind === "etf") entry.etfSourceKeys.add(bucket.key);
      const existingSrc = entry.sources.get(bucket.key);
      if (existingSrc) {
        existingSrc.valueAud += m.valueAud;
        existingSrc.weight = weightOf(existingSrc.valueAud);
      } else {
        entry.sources.set(bucket.key, {
          key: bucket.key,
          ticker: bucket.ticker,
          label: bucket.label,
          valueAud: m.valueAud,
          weight: weightOf(m.valueAud),
        });
      }
    }
  }

  const mergedMembers: TailMember[] = [...mergedMap.values()]
    .map((entry) => {
      const sources = [...entry.sources.values()].sort((a, b) => b.valueAud - a.valueAud);
      return {
        key: entry.key,
        ticker: entry.ticker,
        label: entry.label,
        sector: entry.sector,
        country: entry.country,
        valueAud: entry.valueAud,
        weight: weightOf(entry.valueAud),
        fundWeight: null,
        sources,
        overlaps: entry.etfSourceKeys.size > 1,
      };
    })
    .sort((a, b) => b.valueAud - a.valueAud);

  const mergedTail: MergedTailModel = {
    totalAud: otherTotal,
    weight: weightOf(otherTotal),
    members: mergedMembers,
    overlapCount: mergedMembers.filter((m) => m.overlaps).length,
    unattributedAud: totalUnattributedAud,
    sectors: buildSectorSlices(mergedMembers, totalUnattributedAud, otherTotal, totalAud),
  };

  return { otherBuckets, mergedTail };
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
  const { otherBuckets, mergedTail } = buildOtherBuckets(foldedRows, exposure.rows, totalAud);
  return { named, otherAud, otherBuckets, mergedTail, companies, waiting };
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
