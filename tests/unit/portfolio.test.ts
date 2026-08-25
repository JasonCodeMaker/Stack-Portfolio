import { describe, expect, it } from "vitest";
import type { Holding } from "@wealthfolio/addon-sdk";
import { buildPortfolioModel, normalizeHolding } from "@/domain/portfolio";
import type { AssetProfile, FxQuote, PortfolioAccount } from "@/types/domain";

const account: PortfolioAccount = { id: "ibkr", name: "IBKR", currency: "USD", isActive: true, isArchived: false };
const fx: FxQuote = { pair: "USD/AUD", rate: 1.5, fetchedAt: "2026-08-25T00:00:00.000Z", provider: "twelvedata" };
const profile: AssetProfile = { id: "nvda-id", name: "NVIDIA Corporation", symbol: "NVDA", mic: "XNAS", instrumentType: "EQUITY", currency: "USD" };

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: "holding-1",
    holdingType: "security",
    accountId: account.id,
    quantity: 10,
    localCurrency: "USD",
    baseCurrency: "AUD",
    fxRate: 1.5,
    marketValue: { local: 1000, base: 1500 },
    weight: 1,
    asOfDate: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("holding normalization", () => {
  it("uses local value × selected USD/AUD quote", () => {
    const result = normalizeHolding(holding(), account, profile, fx);
    expect(result.audValue).toBe(1500);
    expect(result.type).toBe("stock");
    expect(result.identityKey).toBe("mic:XNAS:NVDA");
  });

  it("classifies cash from Wealthfolio holdingType", () => {
    const result = normalizeHolding(holding({ holdingType: "cash", localCurrency: "AUD", marketValue: { local: 500, base: 500 } }), account, null, fx);
    expect(result.type).toBe("cash");
    expect(result.identityKey).toBe("cash:AUD");
  });

  it("blocks negative positions and does not calculate percentages", () => {
    const result = normalizeHolding(holding({ quantity: -1 }), account, profile, fx);
    const model = buildPortfolioModel([result], [account.id]);
    expect(result.status).toBe("unsupported-position");
    expect(model.totalAud).toBeNull();
    expect(model.incomplete).toBe(true);
  });

  it("keeps a missing value visible and incomplete", () => {
    const result = normalizeHolding(holding({ marketValue: { local: Number.NaN, base: Number.NaN } }), account, profile, fx);
    expect(result.nativeValue).toBeNull();
    expect(result.audValue).toBeNull();
    expect(buildPortfolioModel([result], [account.id]).totalAud).toBeNull();
  });

  it("keeps a valued but unresolved type in the AUD total", () => {
    const result = normalizeHolding(holding(), account, null, fx);
    const model = buildPortfolioModel([result], [account.id]);
    expect(result.status).toBe("unknown-instrument");
    expect(model.totalAud).toBe(1500);
    expect(model.warnings.some((warning) => warning.id === "unknown-instrument")).toBe(true);
  });
});
