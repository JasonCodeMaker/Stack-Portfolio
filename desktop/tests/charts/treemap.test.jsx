import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { treemapLayout } from "../../ui/charts/treemapLayout.js";
import { changeTileColor, Treemap } from "../../ui/charts/Treemap.jsx";

const groups = [
  {
    key: "fin",
    label: "金融",
    caption: "20.0%",
    items: [
      { id: "fin-rest", label: "其他", value: 5, rest: true, detail: ["5.0%"] },
      { id: "CBA", label: "CBA", value: 15, detail: ["15.0%", "+1.20%"] },
    ],
  },
  {
    key: "tech",
    label: "科技",
    caption: "60.0%",
    items: [
      { id: "MSFT", label: "MSFT", value: 20, detail: ["20.0%"] },
      { id: "AAPL", label: "AAPL", value: 30, detail: ["30.0%", "−0.80%"] },
      { id: "tech-rest", label: "其他", value: 10, rest: true, detail: ["10.0%"] },
    ],
  },
  { key: "cash", label: "未穿透与现金", caption: "20.0%", items: [{ id: "cash", label: "现金", value: 20, rest: true }] },
];
const area = (t) => t.w * t.h;
const tile = (layout, id) => layout.tiles.find((t) => t.item.id === id);

describe("treemap layout", () => {
  const layout = treemapLayout(groups, 600, 400);

  it("gives every item a tile with area in proportion to its value", () => {
    expect(layout.tiles).toHaveLength(6);
    expect(area(tile(layout, "AAPL")) / area(tile(layout, "MSFT"))).toBeCloseTo(1.5, 1);
    const total = layout.tiles.reduce((s, t) => s + area(t), 0);
    expect(area(tile(layout, "AAPL")) / total).toBeGreaterThan(0.25);
    expect(area(tile(layout, "AAPL")) / total).toBeLessThan(0.35);
  });

  it("places the largest group first, in the top-left corner", () => {
    expect(layout.groups[0].key).toBe("tech");
    expect(layout.groups[0].x).toBe(3);
    expect(layout.groups[0].y).toBe(3);
  });

  it("titles a group when its box is big enough and leaves 6px between groups", () => {
    const tech = layout.groups.find((g) => g.key === "tech");
    expect(tech.header).toEqual({ x: tech.x, y: tech.y, w: tech.w, label: "科技", caption: "60.0%" });
    expect(tech.content.y).toBe(tech.y + 19);
    const small = treemapLayout(groups, 140, 100).groups.find((g) => g.key === "fin");
    expect(small.header).toBeNull();
  });

  it("puts the grey 「其他」 block at the end of its group, sized by its share", () => {
    const tech = layout.groups.find((g) => g.key === "tech"),
      rest = tile(layout, "tech-rest"),
      c = tech.content;
    expect(rest.rest).toBe(true);
    if (c.w >= c.h) {
      expect(rest.x + rest.w).toBeCloseTo(c.x + c.w - 0.5, 5);
      expect(rest.w + 1).toBeCloseTo((c.w * 10) / 60, 5);
    } else {
      expect(rest.y + rest.h).toBeCloseTo(c.y + c.h - 0.5, 5);
      expect(rest.h + 1).toBeCloseTo((c.h * 10) / 60, 5);
    }
  });

  it("sizes tile text to the box, capped at 28px, with detail lines only when they fit", () => {
    const big = tile(layout, "AAPL");
    expect(big.font).toBeGreaterThanOrEqual(9);
    expect(big.font).toBeLessThanOrEqual(28);
    expect(big.lines).toEqual(["30.0%", "−0.80%"]);
    expect(big.detailFont).toBe(Math.max(10, Math.min(14, big.font * 0.55)));
  });

  it("shows no text in a box too small to hold it", () => {
    const tiny = treemapLayout(
      [{ key: "g", label: "组", items: [{ id: "BIG", label: "BIG", value: 60 }, { id: "TINY", label: "TINYCO", value: 1 }] }],
      300,
      200,
    );
    const t = tile(tiny, "TINY");
    expect(t.font).toBeNull();
    expect(t.lines).toEqual([]);
  });
});

describe("daily change tile colour", () => {
  it("deepens from the neutral tile colour to full gain or loss colour at ±3%", () => {
    expect(changeTileColor(0)).toEqual({ background: "color-mix(in srgb,var(--tu) 18%,var(--tz))", color: "var(--tm-ink)" });
    expect(changeTileColor(-3)).toEqual({ background: "color-mix(in srgb,var(--td) 92%,var(--tz))", color: "#fff" });
    expect(changeTileColor(9).background).toContain("92%");
    expect(changeTileColor(1.5)).toEqual({ background: "color-mix(in srgb,var(--tu) 55%,var(--tz))", color: "#fff" });
  });
});

describe("treemap component", () => {
  it("colours tiles with the caller's colour function and marks the selected tile", () => {
    const html = renderToStaticMarkup(
      <Treemap
        width={600}
        height={400}
        groups={groups}
        selected="AAPL"
        color={(item) => ({ background: item.id === "AAPL" ? "var(--td)" : "var(--tu)", color: "#fff" })}
      />,
    );
    expect(html).toMatch(/class="ch-tm on"[^>]*background:var\(--td\)[^>]*>.*AAPL/);
    expect(html).toMatch(/class="ch-tm rest"[^>]*>其他 10\.0%</);
    expect(html).toMatch(/class="ch-tmh"[^>]*><b>科技<\/b>　60\.0%/);
    expect(html).toContain("height:400px");
  });
});
