import { describe, expect, it } from "vitest";
import { getSnapshotStatus, parseManualCsv, snapshotToCsv, validateSnapshot } from "../../allocation/domain/etf";
import type { EtfHoldingsSnapshot } from "../../allocation/domain/types";

function snapshot(weights: number[]): EtfHoldingsSnapshot {
  return {
    schemaVersion: 1,
    etfKey: "XNAS:IVV",
    provider: "test",
    asOfDate: "2026-08-25",
    fetchedAt: "2026-08-25T00:00:00.000Z",
    holdings: weights.map((weight, index) => ({ symbol: `S${index}`, name: `Security ${index}`, weight, underlyingType: "stock" })),
    weightSum: weights.reduce((sum, weight) => sum + weight, 0),
    normalized: false,
  };
}

describe("ETF snapshot validation", () => {
  it("accepts an underweight snapshot and preserves its residual", () => {
    const result = validateSnapshot(snapshot([0.6, 0.36]));
    expect(result.accepted).toBe(true);
    expect(result.status).toBe("residual");
    expect(result.snapshot?.weightSum).toBeCloseTo(0.96);
  });

  it("normalizes a small overage but rejects missing data", () => {
    const normalized = validateSnapshot(snapshot([0.7, 0.305]));
    expect(normalized.accepted).toBe(true);
    expect(normalized.status).toBe("normalized");
    expect(normalized.snapshot?.weightSum).toBe(1);
    expect(validateSnapshot(snapshot([0.5, 0.45])).accepted).toBe(false);
  });

  it("parses fractional, percentage, and bare percentage weights with a review signal", () => {
    const preview = parseManualCsv(
      "symbol,name,weight,country\nNVDA,NVIDIA,0.084,US\nAAPL,Apple,8.4%,US\nMSFT,Microsoft,8.4,US",
      { etfKey: "XNAS:TEST", provider: "manual", asOfDate: "2026-08-25", fetchedAt: "2026-08-25T00:00:00.000Z" },
    );
    expect(preview.rows.map((row) => row.weight)).toEqual([0.084, 0.084, 0.084]);
    expect(preview.detectedUnit).toBe("mixed");
    expect(preview.validation.accepted).toBe(false);
  });

  it("exports normalized manual data without dropping optional metadata", () => {
    const csv = snapshotToCsv({ ...snapshot([1]), holdings: [{ symbol: "NVDA", name: "NVIDIA", weight: 1, country: "US", sector: "Technology" }] });
    expect(csv).toContain("symbol,name,weight");
    expect(csv).toContain("NVDA,NVIDIA,1,,,US,,Technology");
  });

  it("marks old snapshots as warning or critical instead of silently live", () => {
    const now = Date.parse("2026-08-25T00:00:00.000Z");
    expect(getSnapshotStatus({ ...snapshot([1]), fetchedAt: "2026-08-16T00:00:00.000Z" }, now)).toBe("Warning");
    expect(getSnapshotStatus({ ...snapshot([1]), fetchedAt: "2026-07-01T00:00:00.000Z" }, now)).toBe("Critical");
  });
});
