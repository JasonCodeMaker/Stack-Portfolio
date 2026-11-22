import type { AllocationRow, RebalanceModel, RebalanceSettings } from "./types";

export function buildRebalanceModel(
  allocation: AllocationRow[],
  totalAud: number | null,
  settings: RebalanceSettings,
): RebalanceModel {
  const targetTotal = Object.values(settings.targets).reduce((sum, target) => sum + target, 0);
  const configured = Object.keys(settings.targets).length > 0;
  const rows = allocation.map((row) => {
    const targetWeight = settings.targets[row.key] ?? null;
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
