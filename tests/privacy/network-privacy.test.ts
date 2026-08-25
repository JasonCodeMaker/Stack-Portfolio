import { describe, expect, it, vi } from "vitest";
import { FxService } from "@/services/fx/fxService";

describe("provider privacy boundary", () => {
  it("sends only the USD/AUD pair and provider authentication to Twelve Data", async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify({ rate: "1.5" }) });
    const storage = new Map<string, string>();
    const ctx = {
      api: {
        storage: { get: async (key: string) => storage.get(key) ?? null, set: async (key: string, value: string) => { storage.set(key, value); }, delete: async () => undefined },
        secrets: { get: async () => "test-secret" },
        network: { request },
        exchangeRates: { getAll: async () => [] },
        logger: { warn: vi.fn() },
      },
    } as never;
    await new FxService(ctx).getQuote({ force: true });
    const url = String(request.mock.calls[0]?.[0]?.url);
    expect(url).toContain("symbol=USD%2FAUD");
    expect(url).not.toMatch(/accountId|accountName|quantity|marketValue|costBasis|transactions|portfolioTotal/i);
  });
});
