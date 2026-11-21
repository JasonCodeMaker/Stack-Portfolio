import { describe, expect, it } from "vitest";
import { compositionTiles, exposureSegments, sectorColor } from "@/components/portfolioVisualizations";
import type { CompositionSlice } from "@/domain/composition";
import type { VisualizationNode } from "@/domain/visualization";
import type { AllocationRow } from "@/types/domain";

function slice(kind: CompositionSlice["kind"], label: string, valueAud: number, extra: Partial<CompositionSlice> = {}): CompositionSlice {
  return { key: `${kind}:${label}`, label, kind, valueAud, weight: valueAud / 1000, directAud: 0, viaEtfsAud: valueAud, memberCount: 1, sources: [], bySector: [], ...extra };
}

function node(label: string, valueAud: number): VisualizationNode {
  return { key: label, label, valueAud, weight: valueAud / 1000, directAud: 0, viaEtfsAud: valueAud };
}

describe("composition tiles", () => {
  it("labels companies by ticker, colours them by sector, and gives the rest of the portfolio neutral fills", () => {
    const tiles = compositionTiles("look-through", [
      slice("company", "Nvidia", 400, { ticker: "NVDA", sector: "Information Technology" }),
      slice("other-companies", "Other companies", 300, { memberCount: 210 }),
      slice("cash", "Cash", 100),
      slice("unresolved", "Fund holdings not available", 200, { sources: [{ kind: "opaque", holdingId: "vgs", accountId: "a", accountName: "A", etfKey: "XASX:VGS", etfSymbol: "VGS", amountAud: 200, reason: "Missing constituent snapshot" }] }),
    ], []);

    expect(tiles.map((tile) => [tile.label, tile.sub, tile.fill])).toEqual([
      ["NVDA", "Nvidia", sectorColor("Information Technology")],
      ["Other companies", "210 smaller companies", "var(--pi-group)"],
      ["Cash", "Held directly and inside funds", "var(--pi-cash)"],
      ["Fund holdings not available", "VGS", "url(#pi-hatch)"],
    ]);
    expect(tiles.filter((tile) => tile.ink === "var(--foreground)").map((tile) => tile.label)).toEqual(["Cash", "Fund holdings not available"]);
    expect(tiles.every((tile) => tile.slice)).toBe(true);
  });

  it("shows what was bought, coloured by instrument type, when viewing as purchased", () => {
    const allocation: AllocationRow[] = [
      { key: "ivv", label: "IVV", type: "etf", valueAud: 600, weight: 0.6 },
      { key: "nvda", label: "NVDA", type: "stock", valueAud: 300, weight: 0.3 },
      { key: "aud", label: "AUD cash", type: "cash", valueAud: 100, weight: 0.1 },
    ];

    const tiles = compositionTiles("purchased", [], allocation);

    expect(tiles.map((tile) => [tile.label, tile.sub, tile.fill, tile.slice])).toEqual([
      ["IVV", "ETF", "var(--pi-cat-3)", undefined],
      ["NVDA", "Stock", "var(--pi-cat-1)", undefined],
      ["AUD cash", "Cash", "var(--pi-cash)", undefined],
    ]);
  });
});

describe("exposure segments", () => {
  it("keeps each sector's colour fixed no matter how it ranks", () => {
    const first = exposureSegments("sectors", [node("Financials", 500), node("Information Technology", 400)]);
    const second = exposureSegments("sectors", [node("Information Technology", 500), node("Financials", 400)]);

    expect(first.find((segment) => segment.label === "Financials")?.swatch).toBe(second.find((segment) => segment.label === "Financials")?.swatch);
    expect(first.find((segment) => segment.label === "Information Technology")?.swatch).toBe(sectorColor("Information Technology"));
  });

  it("folds small categories into Other and hatches value that was not looked through", () => {
    const nodes = ["A", "B", "C", "D", "E", "F", "G", "H"].map((label, index) => node(label, 100 - index));
    const segments = exposureSegments("countries", [...nodes, node("Not looked through", 50)]);

    expect(segments.map((segment) => segment.label)).toEqual(["A", "B", "C", "D", "E", "F", "Other"]);
    expect(segments.at(-1)?.valueAud).toBe(94 + 93 + 50);
    expect(exposureSegments("countries", [node("United States", 600), node("Not looked through", 300)]).at(-1)?.swatch).toBe("var(--pi-hatch)");
  });
});
