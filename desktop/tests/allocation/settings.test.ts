import { describe, expect, it } from "vitest";
import { loadAllocationSettings, reconcileAccountSelection } from "../../allocation/storage/settings";
import type { AllocationSettings, PortfolioAccount } from "../../allocation/domain/types";

const accounts: PortfolioAccount[] = [
  { id: "ibkr", name: "IBKR", currency: "USD", isActive: true, isArchived: false },
  { id: "stake", name: "Stake", currency: "AUD", isActive: true, isArchived: false },
];

const settings: AllocationSettings = {
  schemaVersion: 1,
  selectionInitialized: true,
  selectedAccountIds: ["ibkr"],
  acknowledgedAccountIds: ["ibkr", "stake"],
  providerModes: {},
  pinnedProviders: {},
  providerIdentities: {},
  typeOverrides: {},
  aliases: {},
};

it("returns a retired ETF source to automatic while preserving other pinned providers", async () => {
  const legacy = JSON.stringify({
    ...settings,
    providerModes: { retired: "pinned", current: "pinned" },
    pinnedProviders: { retired: "alpha-vantage", current: "ishares" },
  });
  const result = await loadAllocationSettings({ api: { storage: { get: async () => legacy } } } as never);
  expect(result.providerModes).toEqual({ current: "pinned" });
  expect(result.pinnedProviders).toEqual({ current: "ishares" });
});

describe("account selection", () => {
  it("includes every active account on first use", () => {
    const result = reconcileAccountSelection({ ...settings, selectionInitialized: false }, accounts);
    expect(result.selectedAccounts.map((account) => account.id)).toEqual(["ibkr", "stake"]);
  });

  it("keeps an explicit deselection while auto-including a new account once", () => {
    const result = reconcileAccountSelection(settings, [...accounts, {
      id: "new",
      name: "New broker",
      currency: "AUD",
      isActive: true,
      isArchived: false,
    }]);
    expect(result.selectedAccounts.map((account) => account.id)).toEqual(["ibkr", "new"]);
    expect(result.newlyIncludedAccounts.map((account) => account.id)).toEqual(["new"]);
  });

  it("excludes inactive accounts without rewriting the user's selected choice", () => {
    const result = reconcileAccountSelection(settings, [accounts[0]]);
    expect(result.selectedAccounts.map((account) => account.id)).toEqual(["ibkr"]);
    expect(result.settings.selectedAccountIds).toEqual(["ibkr"]);
  });
});
