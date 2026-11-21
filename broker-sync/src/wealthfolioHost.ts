import type { AddonContext } from "@wealthfolio/addon-sdk";
import { importedKeysStorageKey, type SyncHost } from "@/syncEngine";

export function createWealthfolioHost(ctx: AddonContext): SyncHost {
  return {
    checkImport: (activities) => ctx.api.activities.checkImport(activities),
    getActivities: (accountId) => ctx.api.activities.getAll(accountId),
    saveActivities: (creates, updates = []) => ctx.api.activities.saveMany({ creates, updates }),
    updatePortfolio: () => ctx.api.portfolio.update(),
    loadImportedKeys: async () => {
      const raw = await ctx.api.storage.get(importedKeysStorageKey());
      if (!raw) return new Set<string>();
      const parsed: unknown = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
    },
    saveImportedKeys: (keys) => ctx.api.storage.set(importedKeysStorageKey(), JSON.stringify([...keys].sort())),
  };
}
