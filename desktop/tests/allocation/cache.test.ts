import { describe, expect, it } from "vitest";
import { EtfCache } from "../../allocation/storage/etfCache";
import type { EtfHoldingsSnapshot } from "../../allocation/domain/types";

function fakeContext() {
  const values = new Map<string, string>();
  return {
    values,
    ctx: {
      api: {
        storage: {
          get: async (key: string) => values.get(key) ?? null,
          set: async (key: string, value: string) => { values.set(key, value); },
          delete: async (key: string) => { values.delete(key); },
        },
      },
    },
  };
}

function snapshot(sourceMode: "manual" | "automatic" = "manual", name = "NVIDIA Corporation"): EtfHoldingsSnapshot {
  return {
    schemaVersion: 1,
    etfKey: "XNAS:IVV",
    provider: sourceMode,
    asOfDate: "2026-08-25",
    fetchedAt: "2026-08-25T00:00:00.000Z",
    holdings: [{ symbol: "NVDA", name, weight: 1, underlyingType: "stock" }],
    weightSum: 1,
    normalized: false,
    sourceMode,
  };
}

describe("ETF cache publication", () => {
  it("chunks large snapshots and reads the published version", async () => {
    const { ctx, values } = fakeContext();
    const cache = new EtfCache(ctx);
    const record = await cache.save(snapshot("manual", `NVIDIA ${"x".repeat(190_000)}`));
    expect(record.version).toBe(1);
    expect([...values.keys()].filter((key) => key.startsWith("etf.snapshot")).length).toBeGreaterThan(1);
    expect((await cache.get("XNAS:IVV"))?.snapshot.holdings[0]?.weight).toBe(1);
  });

  it("rejects stale Manual writes and preserves the previous valid snapshot", async () => {
    const { ctx } = fakeContext();
    const cache = new EtfCache(ctx);
    await cache.save(snapshot());
    await expect(cache.save(snapshot("manual", "New name"), { expectedVersion: 0 })).rejects.toThrow("changed elsewhere");
    await expect(cache.save(snapshot("automatic"), { expectedVersion: 1 })).rejects.toThrow("Manual snapshot");
    expect((await cache.get("XNAS:IVV"))?.snapshot.holdings[0]?.name).toBe("NVIDIA Corporation");
  });

  it("does not replace a valid cache with an invalid candidate", async () => {
    const { ctx } = fakeContext();
    const cache = new EtfCache(ctx);
    await cache.save(snapshot());
    await expect(cache.save({ ...snapshot(), holdings: [{ symbol: "NVDA", name: "NVIDIA", weight: 0.5, underlyingType: "stock" }], weightSum: 0.5 })).rejects.toThrow("outside");
    expect((await cache.get("XNAS:IVV"))?.snapshot.weightSum).toBe(1);
  });
});
