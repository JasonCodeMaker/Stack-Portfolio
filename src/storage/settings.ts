import type { AddonContext } from "@wealthfolio/addon-sdk";
import type { AddonSettings, AssetType, PortfolioAccount } from "@/types/domain";

export const SETTINGS_STORAGE_KEY = "settings.v1";

export const DEFAULT_ADDON_SETTINGS: AddonSettings = {
  schemaVersion: 1,
  selectionInitialized: false,
  selectedAccountIds: [],
  acknowledgedAccountIds: [],
  liveFxPolling: true,
  providerModes: {},
  pinnedProviders: {},
  typeOverrides: {},
  aliases: {},
};

function sanitizeSettings(value: unknown): AddonSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_ADDON_SETTINGS };
  const candidate = value as Partial<AddonSettings>;
  const validType = (type: unknown): type is AssetType =>
    type === "stock" || type === "etf" || type === "cash" || type === "fixed-income" || type === "derivative" || type === "other" || type === "unknown";
  const typeOverrides = Object.fromEntries(
    Object.entries(candidate.typeOverrides ?? {}).filter(([, type]) => validType(type)),
  ) as Record<string, AssetType>;
  const providerModes = Object.fromEntries(
    Object.entries(candidate.providerModes ?? {}).filter(([, mode]) => mode === "auto" || mode === "pinned"),
  ) as Record<string, "auto" | "pinned">;
  return {
    ...DEFAULT_ADDON_SETTINGS,
    ...candidate,
    schemaVersion: 1,
    selectionInitialized: Boolean(candidate.selectionInitialized),
    selectedAccountIds: Array.isArray(candidate.selectedAccountIds) ? candidate.selectedAccountIds.filter((id): id is string => typeof id === "string") : [],
    acknowledgedAccountIds: Array.isArray(candidate.acknowledgedAccountIds) ? candidate.acknowledgedAccountIds.filter((id): id is string => typeof id === "string") : [],
    liveFxPolling: candidate.liveFxPolling !== false,
    providerModes,
    pinnedProviders: typeof candidate.pinnedProviders === "object" && candidate.pinnedProviders ? candidate.pinnedProviders as Record<string, string> : {},
    typeOverrides,
    aliases: typeof candidate.aliases === "object" && candidate.aliases ? candidate.aliases as Record<string, string> : {},
  };
}

export async function loadAddonSettings(ctx: AddonContext): Promise<AddonSettings> {
  const raw = await ctx.api.storage.get(SETTINGS_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_ADDON_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_ADDON_SETTINGS };
  }
}

export async function saveAddonSettings(ctx: AddonContext, settings: AddonSettings): Promise<void> {
  await ctx.api.storage.set(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
}

export interface AccountSelectionResult {
  settings: AddonSettings;
  selectedAccounts: PortfolioAccount[];
  newlyIncludedAccounts: PortfolioAccount[];
}

export function reconcileAccountSelection(
  settings: AddonSettings,
  activeAccounts: PortfolioAccount[],
): AccountSelectionResult {
  const activeIds = new Set(activeAccounts.map((account) => account.id));
  if (!settings.selectionInitialized) {
    const selectedAccountIds = activeAccounts.map((account) => account.id);
    return {
      settings: {
        ...settings,
        selectionInitialized: true,
        selectedAccountIds,
        acknowledgedAccountIds: selectedAccountIds,
      },
      selectedAccounts: activeAccounts,
      newlyIncludedAccounts: [],
    };
  }

  const acknowledged = new Set(settings.acknowledgedAccountIds);
  const selected = new Set(settings.selectedAccountIds.filter((id) => activeIds.has(id)));
  const newlyIncludedAccounts = activeAccounts.filter((account) => !acknowledged.has(account.id));
  for (const account of newlyIncludedAccounts) {
    selected.add(account.id);
    acknowledged.add(account.id);
  }
  return {
    settings: {
      ...settings,
      selectedAccountIds: [...selected],
      acknowledgedAccountIds: [...acknowledged],
    },
    selectedAccounts: activeAccounts.filter((account) => selected.has(account.id)),
    newlyIncludedAccounts,
  };
}

export function setSelectedAccounts(settings: AddonSettings, accountIds: string[]): AddonSettings {
  return { ...settings, selectionInitialized: true, selectedAccountIds: [...new Set(accountIds)] };
}
