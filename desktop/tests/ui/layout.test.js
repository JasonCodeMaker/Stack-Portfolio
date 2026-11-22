import { describe, expect, it } from "vitest";
import { arrangeGrid, gridColumns, mainChartHeight, shellTier, stepRow } from "../../ui/layout.js";

describe("table row keys", () => {
  const rows = ["AAPL", "IVV", "A200"];
  it("moves the selected row down and up with the arrow keys, stopping at either end", () => {
    expect(stepRow(rows, "AAPL", "ArrowDown")).toBe("IVV");
    expect(stepRow(rows, "IVV", "ArrowUp")).toBe("AAPL");
    expect(stepRow(rows, "A200", "ArrowDown")).toBe("A200");
    expect(stepRow(rows, "AAPL", "ArrowUp")).toBe("AAPL");
  });

  it("starts from the first row going down, or the last going up, when nothing is selected", () => {
    expect(stepRow(rows, null, "ArrowDown")).toBe("AAPL");
    expect(stepRow(rows, "gone", "ArrowUp")).toBe("A200");
  });

  it("ignores other keys and empty tables", () => {
    expect(stepRow(rows, "IVV", "Enter")).toBeUndefined();
    expect(stepRow([], null, "ArrowDown")).toBeUndefined();
  });
});

describe("main chart height", () => {
  it("fills the rest of the first screen below the chart top, inside its card", () => {
    // 700 pane − 200 above the chart − 22 card padding − 16 breathing room.
    expect(mainChartHeight({ paneHeight: 700, chartTop: 200, cardPaddingBottom: 22, nextHeight: 300 })).toBe(462);
  });

  it("leaves the next panel peeking out when the content area is at least 800 high", () => {
    // Reserve = min(next panel, 260) + 14 gap.
    expect(mainChartHeight({ paneHeight: 900, chartTop: 200, cardPaddingBottom: 22, nextHeight: 300 })).toBe(388);
    expect(mainChartHeight({ paneHeight: 900, chartTop: 200, cardPaddingBottom: 22, nextHeight: 100 })).toBe(548);
    expect(mainChartHeight({ paneHeight: 900, chartTop: 200, cardPaddingBottom: 22 })).toBe(560);
  });

  it("stays between 240 and 560 unless the page passes its own limits", () => {
    expect(mainChartHeight({ paneHeight: 549, chartTop: 330, cardPaddingBottom: 16 })).toBe(240);
    expect(mainChartHeight({ paneHeight: 1400, chartTop: 150, cardPaddingBottom: 22 })).toBe(560);
    expect(mainChartHeight({ paneHeight: 1400, chartTop: 150, cardPaddingBottom: 22, min: 320, max: 700 })).toBe(700);
    expect(mainChartHeight({ paneHeight: 549, chartTop: 200, cardPaddingBottom: 16, min: 320, max: 700 })).toBe(320);
  });

  it("keeps room for content the page draws under the chart", () => {
    expect(mainChartHeight({ paneHeight: 700, chartTop: 200, cardPaddingBottom: 22, below: 30 })).toBe(432);
  });
});

describe("shell tier", () => {
  it("uses the compact tier below 1320 wide, the regular tier to 1799 and the wide tier from 1800", () => {
    expect(shellTier(1008, 601)).toEqual({ tier: "compact", short: true });
    expect(shellTier(1280, 720)).toEqual({ tier: "compact", short: false });
    expect(shellTier(1319, 900).tier).toBe("compact");
    expect(shellTier(1320, 900).tier).toBe("regular");
    expect(shellTier(1440, 900).tier).toBe("regular");
    expect(shellTier(1799, 900).tier).toBe("regular");
    expect(shellTier(1800, 900).tier).toBe("wide");
    expect(shellTier(3440, 1440).tier).toBe("wide");
  });

  it("uses the short header when the viewport is lower than 720", () => {
    expect(shellTier(1920, 719).short).toBe(true);
    expect(shellTier(1920, 720).short).toBe(false);
  });
});

describe("content grid", () => {
  it("counts columns by the content area width, not the viewport", () => {
    expect(gridColumns(1479)).toBe(1);
    expect(gridColumns(1480)).toBe(2);
    expect(gridColumns(2239)).toBe(2);
    expect(gridColumns(2240)).toBe(3);
    // 1920 viewport: sidebar 212 leaves 1708 (two columns); a 499 inspector leaves 1209 (one column).
    expect(gridColumns(1708)).toBe(2);
    expect(gridColumns(1209)).toBe(1);
  });

  const overview = {
    1: [["kpis", "chart", "brk", ["top", "acc"]]],
    2: [["kpis", "chart", "brk"], ["top", "acc"]],
    3: [["kpis", "chart"], ["top"], ["acc", "brk"]],
  };

  it("lays out the arrangement a page declares for each column count, at 2:1 and 2:1:1", () => {
    expect(arrangeGrid(overview, 1)).toEqual({
      template: "minmax(0,1fr)",
      columns: [["kpis", "chart", "brk", ["top", "acc"]]],
    });
    expect(arrangeGrid(overview, 2)).toEqual({
      template: "minmax(0,2fr) minmax(0,1fr)",
      columns: [["kpis", "chart", "brk"], ["top", "acc"]],
    });
    expect(arrangeGrid(overview, 3).template).toBe("minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)");
  });

  it("falls back to the widest arrangement the page declared when it has none for more columns", () => {
    const holdings = { 1: [["a0", "a1", "a2"]], 3: [["a0"], ["a1", "a2"]] };
    expect(arrangeGrid(holdings, 2)).toEqual({ template: "minmax(0,1fr)", columns: [["a0", "a1", "a2"]] });
  });

  it("lets a page give its own column weights", () => {
    const allocation = {
      1: [["map", "target"]],
      2: [{ weight: 2.2, items: ["map"] }, { weight: 1, items: ["target"] }],
    };
    expect(arrangeGrid(allocation, 2)).toEqual({
      template: "minmax(0,2.2fr) minmax(0,1fr)",
      columns: [["map"], ["target"]],
    });
  });
});
