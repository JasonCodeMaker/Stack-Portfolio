import { describe, expect, it } from "vitest";
import { buildBreakdownNodes, buildCoreSatelliteAllocation, concentrationOf, topNodesWithOther } from "@/domain/visualization";
import type { AllocationRow, ExposureModel, NormalizedHolding } from "@/types/domain";

const allocation: AllocationRow[] = [
  { key: "etf:ivv", label: "IVV", type: "etf", valueAud: 400, weight: 0.4 },
  { key: "etf:ndq", label: "NDQ", type: "etf", valueAud: 200, weight: 0.2 },
  { key: "stock:nvda", label: "NVDA", type: "stock", valueAud: 150, weight: 0.15 },
  { key: "stock:orcl", label: "ORCL", type: "stock", valueAud: 100, weight: 0.1 },
  { key: "cash:aud", label: "AUD cash", type: "cash", valueAud: 100, weight: 0.1 },
  { key: "cash:usd", label: "USD cash", type: "cash", valueAud: 50, weight: 0.05 },
];

describe("visualization derivations", () => {
  it("builds core-satellite rebalance rows with individual ETFs and grouped stocks and cash", () => {
    const rows = buildCoreSatelliteAllocation(allocation, 1000);
    expect(rows.map((row) => [row.key, row.valueAud, row.weight])).toEqual([
      ["etf:ivv", 400, 0.4],
      ["strategy:individual-stocks", 250, 0.25],
      ["etf:ndq", 200, 0.2],
      ["strategy:cash", 150, 0.15],
    ]);
    expect(rows.reduce((sum, row) => sum + row.valueAud, 0)).toBe(1000);
  });

  it("keeps non-core instruments in an explicit other bucket", () => {
    const rows = buildCoreSatelliteAllocation([...allocation, { key: "bond", label: "Bond", type: "fixed-income", valueAud: 50, weight: 0.05 }], 1050);
    expect(rows.find((row) => row.key === "strategy:other")?.valueAud).toBe(50);
    expect(rows.reduce((sum, row) => sum + row.valueAud, 0)).toBe(1050);
  });

  it("aggregates account and quoted-currency breakdowns without losing value", () => {
    const holdings = [
      holding("a", "Broker A", "AUD", 600),
      holding("a", "Broker A", "USD", 100),
      holding("b", "Broker B", "USD", 300),
    ];
    const accounts = buildBreakdownNodes("accounts", allocation, holdings, emptyExposure, 1000);
    const currencies = buildBreakdownNodes("currencies", allocation, holdings, emptyExposure, 1000);
    expect(accounts.map((row) => [row.label, row.valueAud])).toEqual([["Broker A", 700], ["Broker B", 300]]);
    expect(currencies.map((row) => [row.label, row.valueAud])).toEqual([["USD", 400], ["AUD", 600]].sort((a, b) => Number(b[1]) - Number(a[1])));
  });

  it("labels value in funds without holdings data as not looked through, not unclassified", () => {
    const exposure: ExposureModel = {
      ...emptyExposure,
      rows: [
        { key: "mic:XNAS:NVDA", ticker: "NVDA", label: "NVIDIA", type: "stock", directAud: 0, viaEtfsAud: 600, totalAud: 600, portfolioWeight: 0.6, sector: "Information Technology", country: "United States", sources: [] },
        { key: "mic:XNAS:ACME", ticker: "ACME", label: "Acme", type: "stock", directAud: 100, viaEtfsAud: 0, totalAud: 100, portfolioWeight: 0.1, sources: [] },
        { key: "opaque-etf:XASX:VGS", ticker: "VGS", label: "VGS · Opaque ETF", type: "etf", directAud: 0, viaEtfsAud: 300, totalAud: 300, portfolioWeight: 0.3, status: "Missing constituent snapshot", sources: [] },
      ],
    };

    const label = (lens: "sectors" | "countries" | "assets") => buildBreakdownNodes(lens, allocation, [], exposure, 1000).map((row) => [row.label, row.valueAud]);

    expect(label("sectors")).toEqual([["Information Technology", 600], ["Not looked through", 300], ["Unclassified", 100]]);
    expect(label("countries")).toEqual([["United States", 600], ["Not looked through", 300], ["Unclassified", 100]]);
    expect(label("assets")).toEqual([["Equity", 700], ["Not looked through", 300]]);
  });

  it("calculates concentration and preserves totals in Top N plus Other", () => {
    const nodes = allocation.map((row) => ({ ...row, directAud: row.valueAud, viaEtfsAud: 0 }));
    expect(concentrationOf(nodes)).toEqual({ top1: 0.4, top5: 0.9500000000000001, top10: 1 });
    const compact = topNodesWithOther(nodes, 3);
    expect(compact.at(-1)?.label).toBe("Other");
    expect(compact.reduce((sum, row) => sum + row.valueAud, 0)).toBe(1000);
  });
});

const emptyExposure: ExposureModel = { rows: [], totalAud: 1000, coveredValueAud: 0, eligibleValueAud: 0, coverage: null, valueConservationDelta: 0, incomplete: false };

function holding(accountId: string, accountName: string, localCurrency: string, audValue: number): NormalizedHolding {
  return {
    id: `${accountId}-${localCurrency}`,
    accountId,
    accountName,
    ticker: "TEST",
    name: "Test",
    type: "stock",
    quantity: 1,
    localCurrency,
    nativeValue: audValue,
    audValue,
    priceUpdatedAt: null,
    identityKey: `${accountId}:${localCurrency}`,
    etfKey: null,
    profileId: null,
    status: "valued",
    sourceHoldingId: `${accountId}-${localCurrency}`,
  };
}
