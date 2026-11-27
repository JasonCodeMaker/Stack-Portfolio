import { describe, expect, it } from "vitest";
import { buildPortfolioModel, normalizeHolding } from "../../allocation/domain/portfolio";
import type { AssetProfile, FxQuote, HoldingInput, PortfolioAccount } from "../../allocation/domain/types";

const account: PortfolioAccount = { id: "ibkr", name: "IBKR", currency: "USD", isActive: true, isArchived: false };
const fx: FxQuote = { pair: "USD/AUD", rate: 1.5, fetchedAt: "2026-08-25T00:00:00.000Z", provider: "twelvedata" };
const profile: AssetProfile = { id: "nvda-id", name: "NVIDIA Corporation", symbol: "NVDA", mic: "XNAS", instrumentType: "EQUITY", currency: "USD" };

function holding(overrides: Partial<HoldingInput> = {}): HoldingInput {
  return {
    id: "holding-1",
    holdingType: "security",
    quantity: 10,
    localCurrency: "USD",
    marketValue: { local: 1000, base: 1500 },
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

  it("falls back to the ledger's base-currency value when live FX is unavailable", () => {
    const result = normalizeHolding(holding(), account, profile, null);
    expect(result.audValue).toBe(1500);
    expect(result.status).toBe("valued");
  });

  it("classifies cash from the holding type", () => {
    const result = normalizeHolding(holding({ holdingType: "cash", localCurrency: "AUD", marketValue: { local: 500, base: 500 } }), account, null, fx);
    expect(result.type).toBe("cash");
    expect(result.identityKey).toBe("cash:AUD");
  });

  it("recognizes an ETF from provider metadata or its explicit fund name", () => {
    const metadataProfile = { ...profile, name: "iShares Core S&P 500", metadata: { quoteType: "ETF" } };
    expect(normalizeHolding(holding(), account, metadataProfile, fx).type).toBe("etf");
    expect(normalizeHolding(holding(), account, { ...profile, name: "iShares Core S&P 500 ETF" }, fx).type).toBe("etf");
  });

  it("matches a known ETF by listing and honors a manual classification", () => {
    const ivv = { ...profile, symbol: "IVV", name: "IVV", mic: "XASX", currency: "AUD" };
    expect(normalizeHolding(holding(), account, ivv, fx).type).toBe("etf");
    expect(normalizeHolding(holding(), account, { ...ivv, mic: "ARCX" }, fx).type).toBe("stock");
    expect(normalizeHolding(holding(), account, ivv, fx, "stock").type).toBe("stock");
  });

  it("reads and normalizes direct-stock sector and country metadata", () => {
    const metadataProfile: AssetProfile = {
      ...profile,
      metadata: {
        profile: {
          sectors: '[{"name":"Technology","weight":1}]',
          countries: '[{"name":"United States","weight":1}]',
        },
      },
    };
    const result = normalizeHolding(holding(), account, metadataProfile, fx);
    expect(result.sector).toBe("Information Technology");
    expect(result.country).toBe("United States");
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
