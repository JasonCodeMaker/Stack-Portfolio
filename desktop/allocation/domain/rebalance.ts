import type { AllocationRow, RebalanceModel, RebalanceSettings } from "./types";

const TARGET_EPSILON = 0.0001;

export function buildRebalanceModel(
  allocation: AllocationRow[],
  totalAud: number | null,
  settings: RebalanceSettings,
): RebalanceModel {
  const targetTotal = allocation.reduce((sum, row) => sum + (settings.targets[row.key] ?? 0), 0);
  const configured = Math.abs(targetTotal - 1) <= TARGET_EPSILON;
  const rows = allocation.map((row) => {
    const targetWeight = configured ? settings.targets[row.key] ?? 0 : null;
    const drift = targetWeight !== null && row.weight !== null ? row.weight - targetWeight : null;
    const adjustmentAud = drift !== null && totalAud !== null ? -drift * totalAud : null;
    const status = drift === null
      ? "unconfigured" as const
      : drift > settings.tolerance
        ? "overweight" as const
        : drift < -settings.tolerance
          ? "underweight" as const
          : "on-target" as const;
    return { ...row, targetWeight, drift, adjustmentAud, status };
  });
  const drifts = rows.flatMap((row) => row.drift === null ? [] : [Math.abs(row.drift)]);
  return {
    rows,
    configured,
    targetTotal,
    tolerance: settings.tolerance,
    needsRebalance: rows.some((row) => row.status === "overweight" || row.status === "underweight"),
    largestDrift: drifts.length ? Math.max(...drifts) : null,
  };
}
