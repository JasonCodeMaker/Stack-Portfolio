import { describe, expect, it } from "vitest";
import { arrangeGrid } from "../../ui/layout.js";
import { checkLayout, quantityGaps, syncLayout } from "../../ui/importsLayout.js";

const at = (layout, cols) => arrangeGrid(layout, cols);

describe("记录与同步 layout", () => {
  it("stacks the import card and recent batches in one column, side by side 2 : 1 when there is room", () => {
    const layout = syncLayout([]);
    expect(at(layout, 1).columns).toEqual([["update", "batches"]]);
    expect(at(layout, 2)).toEqual({ template: "minmax(0,2fr) minmax(0,1fr)", columns: [["update"], ["batches"]] });
    expect(at(layout, 3).columns).toEqual([["update"], ["batches"]]);
  });

  it("puts the broker previews beside the import card, one broker per column only when three columns fit", () => {
    const layout = syncLayout(["ibkr", "webull"]);
    expect(at(layout, 1).columns).toEqual([["update", "ibkr", "webull"]]);
    expect(at(layout, 2)).toEqual({ template: "minmax(0,1fr) minmax(0,1.6fr)", columns: [["update"], ["ibkr", "webull"]] });
    expect(at(layout, 3)).toEqual({
      template: "minmax(0,1fr) minmax(0,1.3fr) minmax(0,1.3fr)",
      columns: [["update"], ["ibkr"], ["webull"]],
    });
  });

  it("keeps the import card at the same width when there are no batches to list yet", () => {
    expect(at(syncLayout([], { batches: false }), 2).columns).toEqual([["update"], []]);
  });

  it("keeps a single preview in the wider second column at three columns", () => {
    expect(at(syncLayout(["webull"]), 3).columns).toEqual([["update"], ["webull"]]);
  });
});

describe("和券商结单核对 layout", () => {
  it("puts the statement and the evidence side by side in equal columns, stacked in one column", () => {
    const layout = checkLayout(true);
    expect(at(layout, 1).columns).toEqual([["statement", "evidence"]]);
    expect(at(layout, 2)).toEqual({ template: "minmax(0,1fr) minmax(0,1fr)", columns: [["statement"], ["evidence"]] });
    expect(at(layout, 3).columns).toEqual([["statement"], ["evidence"]]);
  });

  it("shows the statement alone when no reported holding quantity has been recorded", () => {
    expect(at(checkLayout(false), 3).columns).toEqual([["statement"]]);
  });
});

describe("statement differences", () => {
  it("names the account, the security and how many units the book is short or over", () => {
    const rows = [
      { label: "AUD 现金", delta: "0" },
      { label: "A200 股数", symbol: "A200", delta: "-20" },
      { label: "BHP 股数", symbol: "BHP", delta: "0" },
      { label: "IVV 股数", symbol: "IVV", delta: "2.5" },
      { label: "总资产 AUD", delta: "-781.3" },
    ];
    expect(quantityGaps(rows, "Webull AU")).toEqual([
      "Webull AU 的 A200 比结单少 20 股",
      "Webull AU 的 IVV 比结单多 2.5 股",
    ]);
  });
});
