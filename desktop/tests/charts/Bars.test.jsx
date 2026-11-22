import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BulletBar, DivergingBar, divergingScale, RankedBars, StackedBar } from "../../ui/charts/Bars.jsx";

const html = (el) => renderToStaticMarkup(el);
const pct = (s, prop) => {
  const m = s.match(new RegExp(`${prop}:([-\\d.]+)%`));
  return m ? +m[1] : null;
};

describe("diverging bar", () => {
  it("scales gains and losses separately so the zero line sits between the largest of each", () => {
    expect(divergingScale([300, -100, 50])).toEqual([300, 100]);
    expect(divergingScale([20, 30])).toEqual([30, 1]);
  });

  it("draws a gain to the right of the zero line in the gain colour", () => {
    const out = html(<DivergingBar value={150} scale={[300, 100]} />);
    const [zero, bar] = out.match(/style="[^"]*"/g);
    expect(pct(zero, "left")).toBe(25);
    expect(pct(bar, "left")).toBe(25);
    expect(pct(bar, "width")).toBe(37.5);
    expect(bar).toContain("var(--up)");
  });

  it("draws a loss to the left of the zero line in the loss colour", () => {
    const out = html(<DivergingBar value={-100} scale={[300, 100]} />);
    const bar = out.match(/style="[^"]*"/g)[1];
    expect(pct(bar, "left")).toBe(0);
    expect(pct(bar, "width")).toBe(25);
    expect(bar).toContain("var(--down)");
  });

  it("keeps a tiny value visible as a sliver", () => {
    const bar = html(<DivergingBar value={0} scale={[300, 100]} />).match(/style="[^"]*"/g)[1];
    expect(pct(bar, "width")).toBe(0.6);
  });
});

describe("ranked bars", () => {
  const rows = [
    { key: "jp", label: "日本", value: 5 },
    { key: "cash", label: "现金", value: 8, muted: true },
    { key: "us", label: "美国", value: 60 },
    { key: "au", label: "澳大利亚", value: 27 },
  ];

  it("lists rows from largest to smallest with bars relative to the largest", () => {
    const out = html(<RankedBars rows={rows} format={(v) => `${v.toFixed(1)}%`} />);
    const labels = [...out.matchAll(/class="ch-rank-name"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["美国", "澳大利亚", "现金", "日本"]);
    expect(out).toContain("60.0%");
    const widths = [...out.matchAll(/width:([\d.]+)%/g)].map((m) => +m[1]);
    expect(widths[0]).toBe(100);
    expect(widths[1]).toBe(45);
  });

  it("greys out residual rows such as cash", () => {
    const out = html(<RankedBars rows={rows} format={String} />);
    expect(out).toMatch(/class="ch-rank-row muted"[\s\S]*?var\(--l3\)/);
    expect(out.match(/var\(--s1\)/g)).toHaveLength(3);
  });
});

describe("bullet bar", () => {
  it("shows the actual bar, the target tick and the allowed band around the target", () => {
    const out = html(<BulletBar actual={40} target={45} tolerance={5} max={50} />);
    const band = out.match(/class="ch-bullet-band" style="([^"]*)"/)[1];
    expect(pct(band, "left")).toBe(80);
    expect(pct(band, "width")).toBe(20);
    expect(pct(out.match(/class="ch-bullet-act" style="([^"]*)"/)[1], "width")).toBe(80);
    expect(pct(out.match(/class="ch-bullet-tick" style="([^"]*)"/)[1], "left")).toBe(90);
  });

  it("clips the band at zero when the tolerance exceeds the target", () => {
    const band = html(<BulletBar actual={2} target={3} tolerance={5} max={20} />).match(/class="ch-bullet-band" style="([^"]*)"/)[1];
    expect(pct(band, "left")).toBe(0);
    expect(pct(band, "width")).toBe(40);
  });
});

describe("two-part stacked bar", () => {
  it("puts the direct part first and the look-through part after it", () => {
    const out = html(<StackedBar first={3} second={1} max={8} />);
    const [a, b] = [...out.matchAll(/<i style="([^"]*)"/g)].map((m) => m[1]);
    expect(pct(a, "width")).toBe(37.5);
    expect(a).toContain("var(--s1)");
    expect(pct(b, "left")).toBe(37.5);
    expect(pct(b, "width")).toBe(12.5);
    expect(b).toContain("var(--s2)");
  });
});
