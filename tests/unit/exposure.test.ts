import { describe, expect, it } from "vitest";
import { buildExposureModel } from "@/domain/exposure";
import type { EtfHoldingsSnapshot, NormalizedHolding } from "@/types/domain";

function direct(id: string, ticker: string, amountAud: number): NormalizedHolding {
  return {
    id,
    accountId: "ibkr",
    accountName: "IBKR",
    ticker,
    name: ticker === "NVDA" ? "NVIDIA" : ticker,
    type: "stock",
    quantity: 1,
    localCurrency: "USD",
    nativeValue: amountAud,
    audValue: amountAud,
    priceUpdatedAt: "2026-08-25",
    identityKey: `mic:XNAS:${ticker}`,
    etfKey: null,
    profileId: id,
    status: "valued",
    sourceHoldingId: id,
  };
}

function etf(id: string, ticker: string, key: string, amountAud: number): NormalizedHolding {
  return { ...direct(id, ticker, amountAud), name: ticker, type: "etf", identityKey: `mic:XNAS:${ticker}`, etfKey: key };
}

function snapshot(etfKey: string, holdings: EtfHoldingsSnapshot["holdings"]): EtfHoldingsSnapshot {
  return { schemaVersion: 1, etfKey, provider: "manual", asOfDate: "2026-08-25", fetchedAt: "2026-08-25T00:00:00.000Z", holdings, weightSum: holdings.reduce((sum, item) => sum + item.weight, 0), normalized: false };
}

describe("exposure engine", () => {
  it("merges direct NVDA with ETF-derived NVDA and conserves value", () => {
    const model = buildExposureModel({
      holdings: [direct("nvda-direct", "NVDA", 1500), etf("ivv", "IVV", "XNAS:IVV", 3000), etf("ndq", "NDQ", "XASX:NDQ", 1000)],
      snapshots: new Map([
        ["XNAS:IVV", snapshot("XNAS:IVV", [{ symbol: "NVDA", name: "NVIDIA", mic: "XNAS", weight: 0.08, underlyingType: "stock" }])],
        ["XASX:NDQ", snapshot("XASX:NDQ", [{ symbol: "NVDA", name: "NVIDIA", mic: "XNAS", weight: 0.084, underlyingType: "stock" }])],
      ]),
      totalAud: 5500,
    });
    const nvda = model.rows.find((row) => row.key === "mic:XNAS:NVDA");
    expect(nvda?.totalAud).toBeCloseTo(1500 + 240 + 84);
    expect(model.valueConservationDelta).toBeCloseTo(0);
    expect(model.coverage).toBeCloseTo((1500 + 240 + 84) / 5500);
  });

  it("keeps unsupported ETF value opaque and lowers coverage", () => {
    const model = buildExposureModel({ holdings: [etf("opaque", "OPAQUE", "XNAS:OPAQUE", 1000)], snapshots: new Map(), totalAud: 1000 });
    expect(model.rows[0].label).toContain("Opaque ETF");
    expect(model.rows[0].totalAud).toBe(1000);
    expect(model.coverage).toBe(0);
    expect(model.valueConservationDelta).toBe(0);
  });

  it("multiplies nested ETF weights and turns cycles into opaque exposure", () => {
    const nested = snapshot("XNAS:B", [{ symbol: "NVDA", name: "NVIDIA", mic: "XNAS", weight: 0.5, underlyingType: "stock" }]);
    const root = snapshot("XNAS:A", [{ symbol: "B", name: "Nested B", mic: "XNAS", weight: 0.4, currency: "USD", underlyingType: "etf" }, { symbol: "CASH", name: "Cash", weight: 0.6, underlyingType: "cash" }]);
    const model = buildExposureModel({ holdings: [etf("root", "A", "XNAS:A", 1000)], snapshots: new Map([["XNAS:A", root], ["XNAS:B", nested]]), totalAud: 1000 });
    expect(model.rows.find((row) => row.label === "NVIDIA")?.totalAud).toBeCloseTo(200);
    expect(model.valueConservationDelta).toBeCloseTo(0);

    const cycleA = snapshot("XNAS:CYCLEA", [{ symbol: "CYCLEB", name: "Cycle B", mic: "XNAS", currency: "USD", weight: 1, underlyingType: "etf" }]);
    const cycleB = snapshot("XNAS:CYCLEB", [{ symbol: "CYCLEA", name: "Cycle A", mic: "XNAS", currency: "USD", weight: 1, underlyingType: "etf" }]);
    const cycleModel = buildExposureModel({ holdings: [etf("cycle", "CYCLEA", "XNAS:CYCLEA", 1000)], snapshots: new Map([["XNAS:CYCLEA", cycleA], ["XNAS:CYCLEB", cycleB]]), totalAud: 1000 });
    expect(cycleModel.rows.some((row) => row.status === "Cycle detected")).toBe(true);
    expect(cycleModel.valueConservationDelta).toBeCloseTo(0);

    const missingNested = snapshot("XNAS:MISSINGROOT", [{ symbol: "MISSING", name: "Missing nested ETF", mic: "XNAS", currency: "USD", weight: 1, underlyingType: "etf" }]);
    const missingModel = buildExposureModel({ holdings: [etf("missing", "ROOT", "XNAS:MISSINGROOT", 1000)], snapshots: new Map([["XNAS:MISSINGROOT", missingNested]]), totalAud: 1000 });
    expect(missingModel.rows.some((row) => row.status === "Missing nested ETF snapshot")).toBe(true);
    expect(missingModel.coverage).toBe(0);
    expect(missingModel.valueConservationDelta).toBeCloseTo(0);
  });
});
