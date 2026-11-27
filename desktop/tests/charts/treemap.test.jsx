import React from "react";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { treemapLayout } from "../../ui/charts/treemapLayout.js";
import { changeTileColor, Treemap } from "../../ui/charts/Treemap.jsx";

const items = [
  { id: "CBA", label: "CBA", value: 15, detail: ["15.0%", "+1.20%"] },
  { id: "MSFT", label: "MSFT", value: 20, detail: ["20.0%"] },
  { id: "AAPL", label: "AAPL", value: 30, detail: ["30.0%", "−0.80%"] },
  { id: "cash", label: "现金", value: 20, detail: ["20.0%"] },
  { id: "other", label: "其他", value: 15, rest: true, detail: ["15.0%"] },
];
const area = (t) => t.w * t.h;
const tile = (layout, id) => layout.find((t) => t.item.id === id);
const screenshotItems = [
  ["AVGO", 18.2], ["ORCL", 11.7], ["GOOGL / GOOG", 8], ["BRK.A / BRK.B", 7], ["AAPL", 5.2],
  ["现金", 5.1], ["MU", 2.2], ["CBRS", 1.9], ["AMD", 1.7], ["JNJ", 1.7], ["MSFT", 1.6],
  ["NVDA", 1.4], ["XOM", 1.2], ["AMZN", 1.1], ["其他", 31.8],
].map(([label, value]) => ({ id: label, label, value, detail: [value.toFixed(1) + "%"], rest: label === "其他" }));
// Widths are relative to font size, measured in the app's Windows renderer.
const fixtureWidths = {
  AVGO: 2.747, ORCL: 2.532, "GOOGL / GOOG": 7.383, GOOGL: 3.45, GOOG: 2.938, "BRK.A / BRK.B": 6.767,
  "BRK.A": 2.917, "BRK.B": 2.855, AAPL: 2.532, 现金: 2, MU: 1.68, CBRS: 2.479, AMD: 2.397, JNJ: 1.681,
  MSFT: 2.624, NVDA: 2.873, XOM: 2.359, AMZN: 3.057, 其他: 2,
  "18.2%": 2.492, "11.7%": 2.332, "8.0%": 2.113, "7.0%": 2.113, "5.2%": 2.113, "5.1%": 1.953,
  "2.2%": 2.113, "1.9%": 1.953, "1.7%": 1.953, "1.6%": 1.953, "1.4%": 1.953, "1.2%": 1.953,
  "1.1%": 1.793, "31.8%": 2.492,
};
const fixtureWidth = (label) => fixtureWidths[label] ?? label.length * 0.6;

describe("treemap layout", () => {
  const layout = treemapLayout(items, 600, 400);

  it("gives every item a tile with area in proportion to its value", () => {
    expect(layout).toHaveLength(5);
    expect(area(tile(layout, "AAPL")) / area(tile(layout, "MSFT"))).toBeCloseTo(1.5, 1);
    const total = layout.reduce((sum, t) => sum + area(t), 0);
    expect(area(tile(layout, "other")) / total).toBeCloseTo(0.15);
  });

  it("places the largest item at the top left of the shared chart", () => {
    expect(layout[0]).toMatchObject({ item: { id: "AAPL" }, x: 0.5, y: 0.5 });
  });

  it("puts Other at the bottom right even when it outweighs every holding", () => {
    const withLargeOther = items.map((item) => item.rest ? { ...item, value: 85 } : item);
    const layout = treemapLayout(withLargeOther, 600, 400);
    expect(layout[0].item.id).toBe("AAPL");
    const last = layout.at(-1);
    expect(last.item.id).toBe("other");
    expect(last.x + last.w).toBeCloseTo(599.5);
    expect(last.y + last.h).toBeCloseTo(399.5);
    expect(area(last) / layout.reduce((sum, t) => sum + area(t), 0)).toBeCloseTo(0.5);
  });

  it("sizes tile text to the box, capped at 28px, with detail lines only when they fit", () => {
    const big = tile(layout, "AAPL").text;
    expect(big.font).toBe(28);
    expect(big.lines).toEqual(["30.0%", "−0.80%"]);
  });

  it("stacks share classes in a narrow tile and keeps their combined weight visible", () => {
    const company = { id: "alphabet", label: "GOOGL / GOOG", value: 1, detail: ["2.1%"] };
    const [narrow] = treemapLayout([company], 58, 82);
    expect(narrow.text).toMatchObject({ labels: ["GOOGL", "GOOG"], lines: ["2.1%"] });
    const [wide] = treemapLayout([company], 200, 82);
    expect(wide.text.labels).toEqual(["GOOGL / GOOG"]);
  });

  it("fits the ticker and weight side by side on a wide, shallow tile", () => {
    const [shallow] = treemapLayout([screenshotItems.find((item) => item.id === "XOM")], 195, 30);
    expect(shallow.text).toMatchObject({ inline: true, labels: ["XOM"], lines: ["1.2%"] });
  });

  it.each([[680, 320], [914, 562], [1100, 600]])("keeps the screenshot labels inside the chart at %i × %i", (w, h) => {
    const packed = treemapLayout(screenshotItems, w, h, fixtureWidth);
    expect(packed).toHaveLength(screenshotItems.length);
    expect(packed.filter((t) => !t.text)).toEqual([]);
    expect(tile(packed, "XOM").text.lines).toContain("1.2%");
    expect(tile(packed, "AMZN").text.lines).toContain("1.1%");
    const other = packed.at(-1);
    expect(other.item.label).toBe("其他");
    expect(other.x + other.w).toBeCloseTo(w - 0.5);
    expect(other.y + other.h).toBeCloseTo(h - 0.5);
  });

  it("keeps a tiny Other at the bottom right without dropping named labels", () => {
    const dense = Array.from({ length: 90 }, (_, i) => ({
      id: "T" + i, label: "T" + i, value: 99.7 / 90, detail: ["1.1%"],
    }));
    const packed = treemapLayout([...dense, { id: "other", label: "其他", value: 0.3, rest: true, detail: ["0.3%"] }], 680, 320, fixtureWidth);
    expect(packed.slice(0, -1).filter((t) => !t.text)).toEqual([]);
    expect(packed.at(-1).item.id).toBe("other");
    const other = packed.at(-1);
    expect(other.x + other.w).toBeCloseTo(679.5);
    expect(other.y + other.h).toBeCloseTo(319.5);
  });
});

describe("daily change tile colour", () => {
  it("deepens from the neutral tile colour to full gain or loss colour at ±3%", () => {
    expect(changeTileColor(0).background).toBe("color-mix(in srgb,var(--tu) 18%,var(--tz))");
    expect(changeTileColor(-3).background).toBe("color-mix(in srgb,var(--td) 92%,var(--tz))");
    expect(changeTileColor(9).background).toContain("92%");
    const mid = changeTileColor(1.5);
    expect(mid.background).toBe("color-mix(in srgb,var(--tu) 55%,var(--tz))");
    expect(mid.color).toBe("contrast-color(" + mid.background + ")");
  });
});

describe("treemap component", () => {
  it("colours tiles with the caller's colour function and marks the selected tile", () => {
    const html = renderToStaticMarkup(
      <Treemap
        width={600}
        height={400}
        items={items}
        selected="AAPL"
        color={(item) => ({ background: item.id === "AAPL" ? "var(--td)" : "var(--tu)", color: "#fff" })}
      />,
    );
    expect(html).toMatch(/class="ch-tm on"[^>]*background:var\(--td\)[^>]*>.*AAPL/);
    expect(html).toMatch(/class="ch-tm rest"[^>]*><b[^>]*><span>其他<\/span><\/b><span[^>]*>15\.0%<\/span>/);
    expect(html).toContain("height:400px");
  });

  it("keeps the ticker and share visible and actionable when a tile is too narrow", () => {
    const html = renderToStaticMarkup(<Treemap width={400} height={320} color={() => ({})} onSelect={() => {}} items={[
      { id: "BIG", label: "BIG", value: 98.9, detail: ["98.9%"] },
      { id: "SMALL", label: "SMALL", value: 1.1, detail: ["1.1%"] },
    ]} />);
    expect(html).toMatch(/class="ch-tm-labels" style="justify-content:flex-end"><button[^>]*>SMALL 1\.1%<\/button>/);
    expect(html).toContain('class="ch-tm-leaders" aria-hidden="true"');
  });

  it("pins Other to the far right at full height and renders nested ETF sub-tiles when refined", () => {
    const placed = treemapLayout(
      [
        { id: "AVGO", label: "AVGO", value: 48.2, detail: ["48.2%"] },
        { id: "ORCL", label: "ORCL", value: 20, detail: ["20.0%"] },
        { id: "other", label: "其他", value: 31.8, rest: true, selectable: true, detail: ["31.8%"] },
      ],
      1000,
      400,
      fixtureWidth,
      { pinOtherRight: true, gap: 5 },
    );
    const other = placed.at(-1);
    expect(other.item.id).toBe("other");
    expect(other.x).toBeCloseTo(684.5);
    expect(other.y).toBeCloseTo(2.5);
    expect(other.w).toBeCloseTo(313);
    expect(other.h).toBeCloseTo(395);

    const html = renderToStaticMarkup(
      <Treemap
        width={1000}
        height={400}
        refined
        layoutOptions={{ pinOtherRight: true, gap: 5 }}
        color={() => ({})}
        onSelect={() => {}}
        items={[
          { id: "AVGO", label: "AVGO", value: 68.2, detail: ["68.2%"] },
          {
            id: "other",
            label: "其他",
            value: 31.8,
            rest: true,
            selectable: true,
            detail: ["31.8%"],
            subItems: [
              { id: "etf:VGS", label: "VGS", value: 20, share: "20.0%", inside: "63%", accent: "var(--s1)" },
              { id: "etf:IVV", label: "IVV", value: 11.8, share: "11.8%", inside: "37%", accent: "var(--s2)" },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain("ch-tm rest has-sub");
    expect(html).toContain("ch-tm-sub");
    expect(html).toContain("VGS");
    expect(html).toContain("IVV");

    const semanticHtml = renderToStaticMarkup(
      <Treemap
        width={1000}
        height={400}
        refined
        layoutOptions={{ pinOtherRight: true, gap: 5 }}
        color={() => ({})}
        onSelectSubItem={() => {}}
        items={[
          { id: "AVGO", label: "AVGO", value: 68.2, detail: ["68.2%"] },
          {
            id: "other",
            label: "其他",
            value: 31.8,
            rest: true,
            selectable: true,
            detail: ["31.8%"],
            subItems: [
              { id: "etf:IVV", label: "IVV", value: 16.7, share: "16.7%", inside: "52.7%", change: 0.0064, colorMode: "day", isEtf: true, tailCountLabel: "尾部 488 项", preview: "META · LLY · TSLA…", accent: "var(--s1)" },
              { id: "etf:SPMO", label: "SPMO", value: 15.1, share: "15.1%", inside: "47.3%", change: -0.0092, colorMode: "day", isEtf: true, tailCountLabel: "尾部 91 项", accent: "var(--s2)" },
            ],
          },
        ]}
      />,
    );
    expect(semanticHtml).toContain("ch-tm-sub semantic click");
    expect(semanticHtml).toContain("var(--tm-up-1)");
    expect(semanticHtml).toContain("META · LLY · TSLA…");
    expect(semanticHtml).toContain("合并全部尾部 ↗");
  });

  it("offers the merged view when a residual is too small for a sub-tile", () => {
    const html = renderToStaticMarkup(
      <Treemap width={1000} height={400} refined color={() => ({})} onSelectSubItem={() => {}} items={[
        { id: "main", label: "Main", value: 69.99 },
        {
          id: "other", label: "其他", value: 30.01, rest: true, mergeSubItems: true, detail: ["30.0%"],
          subItems: [{ id: "etf:IVV", label: "IVV", value: 30, isEtf: true }],
        },
      ]} />,
    );
    expect(html).toContain("合并全部尾部 ↗");
  });

  it("keeps Level-1 ETF bucket tiles absolutely positioned side by side", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../ui/charts/charts.css"), "utf8");
    const bucketRule = css.match(/\.ch-tmap\.refined\s+\.ch-tm\.bucket\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bucketRule).not.toMatch(/position\s*:\s*relative/);

    const html = renderToStaticMarkup(
      <Treemap
        width={900}
        height={400}
        refined
        layoutOptions={{ gap: 5 }}
        color={() => ({})}
        onSelect={() => {}}
        items={[
          { id: "etf:IVV", label: "IVV", value: 16.9, selectable: true, bucketDrillable: true, bucketAccent: "var(--s1)", detail: ["16.9%", "占「其他」53.1%"] },
          { id: "etf:SPMO", label: "SPMO", value: 14.9, selectable: true, bucketDrillable: true, bucketAccent: "var(--s2)", detail: ["14.9%", "占「其他」46.9%"] },
        ]}
      />,
    );
    expect(html).toContain("IVV");
    expect(html).toContain("SPMO");
    expect(html).toContain("left:2.5px");
  });
});
