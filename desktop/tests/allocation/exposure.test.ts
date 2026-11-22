import { describe, expect, it } from "vitest";
import { buildExposureModel } from "../../allocation/domain/exposure";
import type { EtfHoldingsSnapshot, NormalizedHolding } from "../../allocation/domain/types";

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
      holdings: [{ ...direct("nvda-direct", "NVDA", 1500), sector: "Information Technology" }, etf("ivv", "IVV", "XNAS:IVV", 3000), etf("ndq", "NDQ", "XASX:NDQ", 1000)],
      snapshots: new Map([
        ["XNAS:IVV", snapshot("XNAS:IVV", [{ symbol: "NVDA", name: "NVIDIA", mic: "XNAS", weight: 0.08, sector: "Technology", underlyingType: "stock" }])],
        ["XASX:NDQ", snapshot("XASX:NDQ", [{ symbol: "NVDA", name: "NVIDIA", mic: "XNAS", weight: 0.084, underlyingType: "stock" }])],
      ]),
      totalAud: 5500,
    });
    const nvda = model.rows.find((row) => row.key === "listing:US:NVDA");
    expect(nvda?.totalAud).toBeCloseTo(1500 + 240 + 84);
    expect(nvda?.sector).toBe("Information Technology");
    expect(model.valueConservationDelta).toBeCloseTo(0);
    expect(model.coverage).toBeCloseTo((1500 + 240 + 84) / 5500);
  });

  it("merges a US stock reported by exchange in one fund and by ticker and currency in another", () => {
    const model = buildExposureModel({
      holdings: [direct("aapl-direct", "AAPL", 100), etf("ivv", "IVV", "XNAS:IVV", 1000), etf("spmo", "SPMO", "ARCX:SPMO", 1000)],
      snapshots: new Map([
        ["XNAS:IVV", snapshot("XNAS:IVV", [{ symbol: "AAPL", name: "APPLE", mic: "XNAS", country: "United States", currency: "USD", weight: 0.07, underlyingType: "stock" }])],
        ["ARCX:SPMO", snapshot("ARCX:SPMO", [{ symbol: "AAPL", name: "Apple Inc", currency: "USD", weight: 0.05, underlyingType: "stock" }])],
      ]),
      totalAud: 2100,
    });
    const apple = model.rows.filter((row) => row.ticker === "AAPL");
    expect(apple).toHaveLength(1);
    expect(apple[0].directAud).toBeCloseTo(100);
    expect(apple[0].viaEtfsAud).toBeCloseTo(70 + 50);
  });

  it("keeps an ASX ticker apart from a US ticker with the same symbol", () => {
    const model = buildExposureModel({
      holdings: [etf("mix", "MIX", "XASX:MIX", 1000)],
      snapshots: new Map([
        ["XASX:MIX", snapshot("XASX:MIX", [
          { symbol: "CBA", name: "Commonwealth Bank", mic: "XASX", currency: "AUD", weight: 0.5, underlyingType: "stock" },
          { symbol: "CBA", name: "US namesake", currency: "USD", weight: 0.5, underlyingType: "stock" },
        ])],
      ]),
      totalAud: 1000,
    });
    expect(model.rows.filter((row) => row.ticker === "CBA")).toHaveLength(2);
  });

  it("keeps unsupported ETF value opaque and lowers coverage", () => {
    const model = buildExposureModel({ holdings: [etf("opaque", "OPAQUE", "XNAS:OPAQUE", 1000)], snapshots: new Map(), totalAud: 1000 });
    expect(model.rows[0].label).toContain("Opaque ETF");
    expect(model.rows[0].totalAud).toBe(1000);
    expect(model.coverage).toBe(0);
    expect(model.valueConservationDelta).toBe(0);
  });

  it("merges direct holdings and keeps only each ETF's top ten constituents", () => {
    const ivv = snapshot("XNAS:IVV", Array.from({ length: 12 }, (_, index) => ({
      symbol: index === 0 ? "ORCL" : `STOCK${index + 1}`,
      name: index === 0 ? "Oracle" : `Stock ${index + 1}`,
      mic: "XNAS",
      weight: index < 8 ? 0.1 : 0.05,
      underlyingType: "stock" as const,
    })));
    const model = buildExposureModel({
      holdings: [direct("orcl-direct", "ORCL", 500), etf("ivv", "IVV", "XNAS:IVV", 1000)],
      snapshots: new Map([["XNAS:IVV", ivv]]),
      totalAud: 1500,
      maxConstituentsPerEtf: 10,
    });
    expect(model.rows.find((row) => row.ticker === "ORCL")?.totalAud).toBeCloseTo(600);
    expect(model.rows.find((row) => row.label === "IVV · Others")?.totalAud).toBeCloseTo(100);
    expect(model.rows.some((row) => row.ticker === "STOCK11")).toBe(false);
    expect(model.rows.some((row) => row.ticker === "STOCK12")).toBe(false);
    expect(model.rows.filter((row) => row.viaEtfsAud > 0)).toHaveLength(11);
    expect(model.valueConservationDelta).toBeCloseTo(0);
  });

  it("combines share classes into one company before selecting the top ten", () => {
    const ivv = snapshot("XNAS:IVV", [
      { symbol: "GOOGL", name: "ALPHABET CLASS A", mic: "XNAS", weight: 0.06, underlyingType: "stock" },
      { symbol: "GOOG", name: "ALPHABET CLASS C", mic: "XNAS", weight: 0.05, underlyingType: "stock" },
      ...Array.from({ length: 9 }, (_, index) => ({ symbol: `S${index + 1}`, name: `Stock ${index + 1}`, mic: "XNAS", weight: 0.09, underlyingType: "stock" as const })),
      { symbol: "S10", name: "Stock 10", mic: "XNAS", weight: 0.08, sector: "Technology", underlyingType: "stock" },
    ]);
    const model = buildExposureModel({
      holdings: [direct("googl-direct", "GOOGL", 50), etf("ivv", "IVV", "XNAS:IVV", 1000)],
      snapshots: new Map([["XNAS:IVV", ivv]]),
      totalAud: 1050,
      maxConstituentsPerEtf: 10,
    });
    const alphabet = model.rows.find((row) => row.label === "Alphabet");
    expect(alphabet?.directAud).toBeCloseTo(50);
    expect(alphabet?.viaEtfsAud).toBeCloseTo(110);
    expect(model.rows.some((row) => row.ticker === "GOOG")).toBe(false);
    expect(model.rows.some((row) => row.ticker === "GOOGL")).toBe(false);
    expect(model.rows.find((row) => row.label === "IVV · Others")?.viaEtfsAud).toBeCloseTo(80);
    expect(model.valueConservationDelta).toBeCloseTo(0);
  });

  it("discovers previously unknown share-class groups from constituent names", () => {
    const fund = snapshot("XNAS:FUND", [
      { symbol: "ACMEA", name: "ACME CLASS A", mic: "XNAS", weight: 0.6, underlyingType: "stock" },
      { symbol: "ACMEC", name: "ACME CLASS C", mic: "XNAS", weight: 0.4, underlyingType: "stock" },
    ]);
    const model = buildExposureModel({
      holdings: [direct("acme-direct", "ACMEA", 50), etf("fund", "FUND", "XNAS:FUND", 1000)],
      snapshots: new Map([["XNAS:FUND", fund]]),
      totalAud: 1050,
    });
    const acme = model.rows.find((row) => row.label === "Acme");
    expect(acme?.directAud).toBeCloseTo(50);
    expect(acme?.viaEtfsAud).toBeCloseTo(1000);
    expect(model.rows.filter((row) => row.key.startsWith("company:"))).toHaveLength(1);
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
