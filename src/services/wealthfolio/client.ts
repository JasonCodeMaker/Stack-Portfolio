import type { AddonContext, Account, Asset, Holding } from "@wealthfolio/addon-sdk";
import { normalizeAssetProfile } from "@/domain/portfolio";
import type { AssetProfile, NormalizedHolding, PortfolioAccount } from "@/types/domain";

export interface WealthfolioHoldingRow {
  holding: Holding;
  account: PortfolioAccount;
  profile: AssetProfile | null;
}

export function toPortfolioAccount(account: Account): PortfolioAccount {
  return {
    id: account.id,
    name: account.name,
    currency: account.currency,
    isActive: account.isActive,
    isArchived: account.isArchived,
  };
}

export async function getActiveAccounts(ctx: AddonContext): Promise<PortfolioAccount[]> {
  const accounts = await ctx.api.accounts.getAll();
  return accounts.filter((account) => account.isActive && !account.isArchived).map(toPortfolioAccount);
}

export async function loadHoldingRows(
  ctx: AddonContext,
  accounts: PortfolioAccount[],
  selectedAccountIds: string[],
): Promise<WealthfolioHoldingRow[]> {
  const selectedAccounts = accounts.filter((account) => selectedAccountIds.includes(account.id));
  const accountHoldings = await Promise.all(
    selectedAccounts.map(async (account) => ({
      account,
      holdings: await ctx.api.portfolio.getHoldings(account.id),
    })),
  );
  const profileCache = new Map<string, AssetProfile | null>();
  const rows: WealthfolioHoldingRow[] = [];
  for (const accountResult of accountHoldings) {
    for (const holding of accountResult.holdings) {
      const instrumentId = holding.instrument?.id;
      let profile: AssetProfile | null = null;
      if (instrumentId) {
        if (!profileCache.has(instrumentId)) {
          try {
            const asset: Asset = await ctx.api.assets.getProfile(instrumentId);
            profileCache.set(instrumentId, normalizeAssetProfile(asset, holding.instrument?.symbol));
          } catch {
            profileCache.set(instrumentId, null);
          }
        }
        profile = profileCache.get(instrumentId) ?? null;
      }
      rows.push({ holding, account: accountResult.account, profile });
    }
  }
  return rows;
}

export async function loadPortfolioBaseCurrency(ctx: AddonContext): Promise<string> {
  const settings = await ctx.api.settings.get();
  return settings.baseCurrency.toUpperCase();
}

export function getHoldingIdentity(row: WealthfolioHoldingRow): string {
  return row.profile?.instrumentKey
    ?? row.profile?.id
    ?? row.holding.instrument?.id
    ?? row.holding.id;
}

export type { NormalizedHolding };
