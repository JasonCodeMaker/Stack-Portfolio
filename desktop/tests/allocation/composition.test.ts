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
  it("lists every company above 1% and combines smaller holdings across sectors and funds", () => {
    const large = Array.from({ length: 13 }, (_, index) => stock(`L${index}`, 0.075));
    const exposure = buildExposureModel({
      holdings: [etf("AAA", 1000), etf("BBB", 1000)],
      snapshots: new Map([
        ["XASX:AAA", snapshot("XASX:AAA", [...large, stock("EXACT", 0.02), stock("SMALL", 0.005, "Financials")])],
        ["XASX:BBB", snapshot("XASX:BBB", [stock("BIG", 0.96), stock("ABOVE", 0.02002), stock("BELOW", 0.01998, "Energy")])],
      ]),
      totalAud: 2000,
    });

    const { named, otherAud } = buildComposition(exposure, 2000);

    expect(named.map((slice) => slice.ticker)).toEqual(["BIG", ...large.map((row) => row.symbol), "ABOVE"]);
    expect(otherAud).toBeCloseTo(20 + 5 + 19.98);
    expect(named.reduce((sum, row) => sum + row.totalAud, otherAud)).toBeCloseTo(2000);
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

    const nflx = buildComposition(exposure, 2000).named.find((slice) => slice.ticker === "NFLX");

    expect(nflx?.totalAud).toBeCloseTo(50 + 500);
  });

  it("folds exact 1% ETF exposures into Other despite floating-point noise", () => {
    const exposure = buildExposureModel({
      holdings: [etf("AAA", 0.1), holding("cash", "AUD", "cash", 0.9)],
      snapshots: new Map([["XASX:AAA", snapshot("XASX:AAA", [stock("EXACT", 0.1), stock("BIG", 0.9)])]]),
      totalAud: 1,
    });
    const { named, otherAud } = buildComposition(exposure, 1);
    expect(named.map((row) => row.ticker)).not.toContain("EXACT");
    expect(otherAud).toBeCloseTo(0.01);
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

    const { named, otherAud, waiting } = buildComposition(exposure, 2000);

    expect(named.reduce((sum, slice) => sum + slice.weight, 0)).toBeCloseTo(1);
    expect(otherAud).toBe(0);
    expect(named.filter((slice) => slice.type === "cash")).toMatchObject([{ totalAud: 300, directAud: 200, viaEtfsAud: 100 }]);
    expect(named.find((slice) => slice.ticker === "NVDA")).toMatchObject({ directAud: 300, viaEtfsAud: 600 });
    expect(named.find((slice) => slice.type === "etf")).toMatchObject({ ticker: "OPAQUE", totalAud: 500 });
    expect(waiting.map((row) => row.ticker)).toEqual(["OPAQUE"]);
  });

  it("adds unattributed fund value and small cash balances to Other", () => {
    const exposure = buildExposureModel({
      holdings: [etf("AAA", 1000), holding("cash", "AUD", "cash", 5)],
      snapshots: new Map([["XASX:AAA", snapshot("XASX:AAA", [
        stock("BIG", 0.8),
        { name: "Other constituents", weight: 0.1, underlyingType: "other" },
      ])]]),
      totalAud: 1005,
    });

    const { named, otherAud } = buildComposition(exposure, 1005);
    expect(named.map((row) => row.ticker)).toEqual(["BIG"]);
    expect(otherAud).toBeCloseTo(205);
  });

  it("leaves shares unavailable when the portfolio total cannot be valued", () => {
    const exposure = buildExposureModel({
      holdings: [etf("AAA", 1000), holding("nvda", "NVDA", "stock", 300)],
      snapshots: new Map([["XASX:AAA", snapshot("XASX:AAA", [stock("NVDA", 0.5), stock("MSFT", 0.5)])]]),
      totalAud: null,
    });

    expect(buildComposition(exposure, null)).toMatchObject({ named: [], otherAud: 0, otherBuckets: [] });
  });

  it("decomposes Other by ETF and direct tail while conserving total value", () => {
    const exposure = buildExposureModel({
      holdings: [
        holding("big", "BIG", "stock", 600),
        holding("tiny", "TINY", "stock", 5),
        etf("VGS", 300),
        etf("OPAQUE", 95),
      ],
      snapshots: new Map([
        [
          "XASX:VGS",
          snapshot("XASX:VGS", [stock("BIG", 0.5), stock("ASML", 0.02)]),
        ],
      ]),
      totalAud: 1000,
    });

    const result = buildComposition(exposure, 1000);
    expect(result.otherAud).toBeCloseTo(155);
    expect(result.otherBuckets.map((b) => [b.ticker, Math.round(b.valueAud)])).toEqual([
      ["未穿透余项", 144],
      ["VGS", 6],
      ["直接小仓位", 5],
    ]);
    expect(result.otherBuckets.find((b) => b.ticker === "VGS")?.members.map((m) => m.ticker)).toEqual(["ASML"]);
    expect(result.otherBuckets.reduce((s, b) => s + b.valueAud, 0)).toBeCloseTo(result.otherAud);
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
