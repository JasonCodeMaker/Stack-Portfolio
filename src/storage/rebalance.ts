import type { AddonContext } from "@wealthfolio/addon-sdk";
import type { RebalanceSettings } from "@/types/domain";

export const REBALANCE_STORAGE_KEY = "rebalance.v1";
export const DEFAULT_REBALANCE_SETTINGS: RebalanceSettings = {
  schemaVersion: 1,
  tolerance: 0.05,
  targets: {},
};

function sanitize(value: unknown): RebalanceSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_REBALANCE_SETTINGS };
  const candidate = value as Partial<RebalanceSettings>;
  const tolerance = typeof candidate.tolerance === "number" && Number.isFinite(candidate.tolerance)
    ? Math.min(0.25, Math.max(0.005, candidate.tolerance))
    : DEFAULT_REBALANCE_SETTINGS.tolerance;
  const targets = Object.fromEntries(Object.entries(candidate.targets ?? {}).filter((entry): entry is [string, number] => {
    const [, target] = entry;
    return typeof target === "number" && Number.isFinite(target) && target >= 0 && target <= 1;
  }));
  return { schemaVersion: 1, tolerance, targets };
}

export async function loadRebalanceSettings(ctx: AddonContext): Promise<RebalanceSettings> {
  const raw = await ctx.api.storage.get(REBALANCE_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_REBALANCE_SETTINGS };
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_REBALANCE_SETTINGS };
  }
}

export async function saveRebalanceSettings(ctx: AddonContext, settings: RebalanceSettings): Promise<void> {
  await ctx.api.storage.set(REBALANCE_STORAGE_KEY, JSON.stringify(sanitize(settings)));
}
