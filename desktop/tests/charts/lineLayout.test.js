import { describe, expect, it } from "vitest";
import { lineLayout } from "../../ui/charts/lineLayout.js";

const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10));

describe("line chart layout", () => {
  const ramp = { name: "总资产", values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };

  it("places points evenly between the kit margins and pads the value range by 8%", () => {
    const l = lineLayout({ width: 600, height: 260, series: [ramp], dates: days("2026-10-01", 11) });
    expect(l.plot).toEqual({ left: 52, right: 504, top: 10, bottom: 236 });
    expect(l.x(0)).toBe(52);
    expect(l.x(10)).toBe(504);
    expect(l.domain).toEqual([-0.8, 10.8]);
    expect(l.y(10.8)).toBeCloseTo(10);
    expect(l.y(-0.8)).toBeCloseTo(236);
  });

  it("draws round value ticks inside the range, about one per 64px of height", () => {
    const l = lineLayout({ width: 600, height: 260, series: [ramp] });
    expect(l.ticks.map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(lineLayout({ width: 600, height: 100, series: [ramp] }).ticks.map((t) => t.value)).toEqual([0, 5, 10]);
  });

  it("includes zero in the range when a zero line is asked for", () => {
    const l = lineLayout({ width: 600, height: 260, series: [{ name: "盈亏", values: [5, 6, 8] }], zero: true });
    expect(l.domain[0]).toBeLessThan(0);
    expect(l.zeroY).toBeCloseTo(l.y(0));
    expect(lineLayout({ width: 600, height: 260, series: [{ name: "盈亏", values: [5, 6, 8] }] }).zeroY).toBeNull();
  });

  it("honours a forced upper bound such as 0 for drawdowns", () => {
    const l = lineLayout({ width: 600, height: 260, series: [{ name: "回撤", values: [0, -4, -10] }], hi: 0 });
    expect(l.domain).toEqual([-10.8, 0]);
  });

  it("spreads date labels about every 120px, anchoring the first and last at the edges", () => {
    const l = lineLayout({ width: 600, height: 260, series: [ramp], dates: days("2026-10-01", 11) });
    expect(l.xLabels).toEqual([
      { x: 52, text: "10-01", anchor: "start" },
      { x: l.x(3), text: "10-04", anchor: "middle" },
      { x: l.x(7), text: "10-08", anchor: "middle" },
      { x: 504, text: "10-11", anchor: "end" },
    ]);
  });

  it("formats date labels as month names over a quarter and as YY-MM over about fifteen months", () => {
    const half = lineLayout({ width: 400, height: 260, series: [{ name: "a", values: [1, 2] }], dates: ["2026-01-05", "2026-06-30"] });
    expect(half.xLabels.map((t) => t.text)).toEqual(["1月", "6月"]);
    const long = lineLayout({ width: 400, height: 260, series: [{ name: "a", values: [1, 2] }], dates: ["2024-03-01", "2026-11-20"] });
    expect(long.xLabels.map((t) => t.text)).toEqual(["24-03", "26-11"]);
  });

  it("does not repeat a month name when two date labels fall in the same month", () => {
    const l = lineLayout({ width: 900, height: 260, series: [{ name: "a", values: Array(120).fill(1) }], dates: days("2026-07-01", 120) });
    const texts = l.xLabels.map((t) => t.text);
    expect(texts[0]).toBe("7月");
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("labels each line at its end and pushes overlapping labels 14px apart", () => {
    const l = lineLayout({
      width: 600,
      height: 260,
      series: [
        { name: "净投入", values: [0, 10] },
        { name: "总资产", values: [0, 10.1], width: 2 },
        { name: "标普 500", values: [0, 0] },
      ],
    });
    const [a, b, c] = l.endLabels;
    expect(a.x).toBe(600 - 96 + 8);
    expect(Math.abs(b.y - a.y)).toBeGreaterThanOrEqual(14);
    expect(c.y).toBeCloseTo(l.y(0) + 4);
    expect(b.strong).toBe(true);
    expect(a.strong).toBe(false);
  });

  it("uses a 12px right margin when line-end labels are turned off", () => {
    const l = lineLayout({ width: 600, height: 260, series: [ramp], labels: false });
    expect(l.plot.right).toBe(588);
    expect(l.endLabels).toEqual([]);
  });

  it("finds the point nearest to a pointer position, clamped to the data", () => {
    const l = lineLayout({ width: 600, height: 260, series: [ramp] });
    expect(l.nearestIndex(52)).toBe(0);
    expect(l.nearestIndex(l.x(4) + 10)).toBe(4);
    expect(l.nearestIndex(l.x(4) + 30)).toBe(5);
    expect(l.nearestIndex(-50)).toBe(0);
    expect(l.nearestIndex(900)).toBe(10);
  });
});
