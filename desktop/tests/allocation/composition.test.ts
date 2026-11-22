import { describe, expect, it } from "vitest";
import { buildComposition, buildPlanRows } from "../../allocation/domain/composition";
import { buildExposureModel } from "../../allocation/domain/exposure";
import { buildRebalanceModel } from "../../allocation/domain/rebalance";
import type { AllocationRow, EtfHoldingsSnapshot, NormalizedHolding, UnderlyingHolding } from "../../allocation/domain/types";

function holding(id: string, ticker: string, type: NormalizedHolding["type"], audValue: number, extra: Partial<NormalizedHolding> = {}): NormalizedHolding {
  return {
    id,
    accountId: "broker",
    accountName: "Broker",
    ticker,
    name: ticker,
    type,
    quantity: 1,
    localCurrency: "AUD",
    nativeValue: audValue,
    audValue,
    priceUpdatedAt: "2026-09-25",
    identityKey: `mic:XNAS:${ticker}`,
    etfKey: null,
    profileId: id,
    status: "valued",
    sourceHoldingId: id,
    ...extra,
  };
}

const etf = (ticker: string, audValue: number) => holding(ticker, ticker, "etf", audValue, { identityKey: `mic:XASX:${ticker}`, etfKey: `XASX:${ticker}` });

function stock(symbol: string, weight: number, sector = "Information Technology"): UnderlyingHolding {
  return { symbol, name: symbol, mic: "XNAS", weight, sector, underlyingType: "stock" };
}

function snapshot(etfKey: string, holdings: UnderlyingHolding[]): EtfHoldingsSnapshot {
  return { schemaVersion: 1, etfKey, provider: "manual", asOfDate: "2026-09-25", fetchedAt: "2026-09-25T00:00:00.000Z", holdings, weightSum: holdings.reduce((sum, row) => sum + row.weight, 0), normalized: false };
}

describe("portfolio composition", () => {
  it("folds the tail of every fund into a single Other companies slice", () => {
    const exposure = buildExposureModel({
      holdings: [etf("AAA", 1000), etf("BBB", 1000)],
      snapshots: new Map([
        ["XASX:AAA", snapshot("XASX:AAA", [stock("A1", 0.4), stock("A2", 0.3), stock("A3", 0.2), stock("A4", 0.1)])],
        ["XASX:BBB", snapshot("XASX:BBB", [stock("B1", 0.4), stock("B2", 0.3), stock("B3", 0.2), stock("B4", 0.1)])],
      ]),
      totalAud: 2000,
    });

    const slices = buildComposition(exposure, 3);

    const others = slices.filter((slice) => slice.kind === "other-companies");
    expect(others).toHaveLength(1);
    expect(others[0].label).toBe("Other companies");
    expect(others[0].memberCount).toBe(5);
    expect(new Set(slices.map((slice) => slice.label)).size).toBe(slices.length);
  });

  it("ranks companies across the whole portfolio so none loses value hidden in one fund's tail", () => {
    const smallInFirstFund = Array.from({ length: 10 }, (_, index) => stock(`S${index}`, 0.095));
    const exposure = buildExposureModel({
      holdings: [etf("AAA", 1000), etf("BBB", 1000)],
      snapshots: new Map([
        ["XASX:AAA", snapshot("XASX:AAA", [...smallInFirstFund, stock("NFLX", 0.05)])],
        ["XASX:BBB", snapshot("XASX:BBB", [stock("NFLX", 0.5), stock("B1", 0.5)])],
      ]),
      totalAud: 2000,
    });

    const nflx = buildComposition(exposure, 3).find((slice) => slice.ticker === "NFLX");

    expect(nflx?.valueAud).toBeCloseTo(50 + 500);
  });

  it("adds up to the whole portfolio with cash and unopened funds as their own slices", () => {
    const exposure = buildExposureModel({
      holdings: [
        etf("AAA", 1000),
        etf("OPAQUE", 500),
        holding("nvda", "NVDA", "stock", 300),
        holding("cash", "AUD", "cash", 200, { identityKey: "cash:AUD" }),
      ],
      snapshots: new Map([["XASX:AAA", snapshot("XASX:AAA", [stock("NVDA", 0.6), stock("MSFT", 0.3), { name: "Cash", weight: 0.1, underlyingType: "cash" }])]]),
      totalAud: 2000,
    });

    const slices = buildComposition(exposure, 12);

    expect(slices.reduce((sum, slice) => sum + (slice.weight ?? 0), 0)).toBeCloseTo(1);
    expect(slices.filter((slice) => slice.kind === "cash")).toHaveLength(1);
    expect(slices.find((slice) => slice.kind === "cash")?.valueAud).toBeCloseTo(200 + 100);
    expect(slices.find((slice) => slice.kind === "unresolved")).toMatchObject({ label: "Fund holdings not available", valueAud: 500 });
    expect(slices.map((slice) => slice.kind)).toEqual(["company", "company", "cash", "unresolved"]);
  });

  it("splits Other companies by sector", () => {
    const exposure = buildExposureModel({
      holdings: [etf("AAA", 1000)],
      snapshots: new Map([["XASX:AAA", snapshot("XASX:AAA", [stock("BIG", 0.5), stock("T1", 0.2), stock("T2", 0.1), stock("F1", 0.2, "Financials")])]]),
      totalAud: 1000,
    });

    const other = buildComposition(exposure, 1).find((slice) => slice.kind === "other-companies");

    expect(other?.bySector).toEqual([
      { sector: "Information Technology", valueAud: 300, weight: 0.3, count: 2 },
      { sector: "Financials", valueAud: 200, weight: 0.2, count: 1 },
    ]);
  });

  it("keeps where each slice comes from, direct and through funds", () => {
    const exposure = buildExposureModel({
      holdings: [etf("AAA", 1000), holding("nvda", "NVDA", "stock", 300)],
      snapshots: new Map([["XASX:AAA", snapshot("XASX:AAA", [stock("NVDA", 0.5), stock("MSFT", 0.5)])]]),
      totalAud: 1300,
    });

    const nvda = buildComposition(exposure, 12).find((slice) => slice.ticker === "NVDA");

    expect(nvda).toMatchObject({ directAud: 300, viaEtfsAud: 500 });
    expect(nvda?.sources.map((source) => [source.kind, source.amountAud])).toEqual([["etf", 500], ["direct", 300]]);
  });
});

describe("plan rows", () => {
  it("lists the holdings inside each grouped rebalance bucket", () => {
    const allocation: AllocationRow[] = [
      { key: "mic:XASX:IVV", label: "IVV", type: "etf", valueAud: 600, weight: 0.6 },
      { key: "mic:XNAS:NVDA", label: "NVDA", type: "stock", valueAud: 200, weight: 0.2 },
      { key: "mic:XNAS:AAPL", label: "AAPL", type: "stock", valueAud: 100, weight: 0.1 },
      { key: "cash:AUD", label: "AUD cash", type: "cash", valueAud: 100, weight: 0.1 },
    ];
    const buckets: AllocationRow[] = [
      { key: "mic:XASX:IVV", label: "IVV", type: "etf", valueAud: 600, weight: 0.6 },
      { key: "strategy:individual-stocks", label: "Individual stocks", type: "stock", valueAud: 300, weight: 0.3 },
      { key: "strategy:cash", label: "Cash", type: "cash", valueAud: 100, weight: 0.1 },
    ];
    const model = buildRebalanceModel(buckets, 1000, { schemaVersion: 1, tolerance: 0.02, targets: { "mic:XASX:IVV": 0.6, "strategy:individual-stocks": 0.3, "strategy:cash": 0.1 } });

    const rows = buildPlanRows(model, allocation);

    expect(rows.map((row) => [row.key, row.children.map((child) => child.label)])).toEqual([
      ["mic:XASX:IVV", []],
      ["strategy:individual-stocks", ["NVDA", "AAPL"]],
      ["strategy:cash", ["AUD cash"]],
    ]);
  });
});
