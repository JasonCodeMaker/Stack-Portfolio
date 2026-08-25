import { describe, expect, it } from "vitest";
import { mapWithConcurrency, resolveEtfHoldings } from "@/services/etf/providers";
import type { EtfAsset, EtfHoldingsSnapshot } from "@/types/domain";

const etf: EtfAsset = { etfKey: "XNAS:IVV", profileId: "ivv", symbol: "IVV", name: "iShares Core S&P 500", mic: "XNAS" };
const cached: EtfHoldingsSnapshot = { schemaVersion: 1, etfKey: etf.etfKey, provider: "alpha-vantage", asOfDate: "2026-08-25", fetchedAt: new Date().toISOString(), holdings: [{ symbol: "NVDA", name: "NVIDIA", weight: 1, underlyingType: "stock" }], weightSum: 1, normalized: false, sourceMode: "automatic" };

describe("ETF provider resolver", () => {
  it("does not fall back to another provider's cache in pinned mode", async () => {
    const result = await resolveEtfHoldings(etf, [], { mode: "pinned", pinnedProvider: "ishares", cached });
    expect(result.snapshot).toBeNull();
    expect(result.failureReason).toContain("No provider");
  });

  it("honors a forced refresh even when the shared cache is fresh", async () => {
    const provider = {
      id: "alpha-vantage",
      canHandle: async () => true,
      fetchHoldings: async () => ({ ...cached, fetchedAt: new Date(Date.now() + 1000).toISOString() }),
    };
    const result = await resolveEtfHoldings(etf, [provider], { mode: "auto", cached, force: true });
    expect(result.snapshot?.fetchedAt).not.toBe(cached.fetchedAt);
  });

  it("keeps automatic provider refresh concurrency at the configured limit", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });
    expect(result).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
