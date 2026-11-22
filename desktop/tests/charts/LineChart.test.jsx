import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineChart } from "../../ui/charts/LineChart.jsx";
import { lineLayout } from "../../ui/charts/lineLayout.js";

const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
const assets = { name: "总资产", color: "var(--s1)", values: [100, 104, 103, 108, 112], width: 2 };
const invested = { name: "净投入", color: "var(--l3)", values: [100, 100, 105, 105, 105], step: true, dash: "4 3" };
const render = (props) => renderToStaticMarkup(<LineChart width={600} height={260} dates={dates} {...props} />);
const count = (html, needle) => html.split(needle).length - 1;

describe("line chart", () => {
  it("takes its height from the caller and labels every line at its end instead of a legend", () => {
    const html = render({ series: [invested, assets] });
    expect(html).toContain('height="260"');
    expect(count(html, 'class="ch-series"')).toBe(2);
    expect(html).toMatch(/class="ch-end strong"[^>]*>总资产</);
    expect(html).toMatch(/class="ch-end"[^>]*>净投入</);
    expect(html).not.toContain("legend");
    expect(html).toContain("stroke:var(--s1)");
    expect(html).toContain('stroke-dasharray="4 3"');
  });

  it("draws a step line as horizontal-then-vertical moves", () => {
    const l = lineLayout({ width: 600, height: 260, series: [invested] });
    const html = render({ series: [invested] });
    const path = html.match(/class="ch-series"[^>]* d="([^"]+)"/)[1];
    // From day 2 (100) to day 3 (105): move across at 100 first, then up to 105.
    const at = (i, v) => `${l.x(i)},${+l.y(v).toFixed(3)}`;
    expect(path).toContain(`L${at(2, 100)}L${at(2, 105)}`);
  });

  it("shades the area above zero in the gain colour and below zero in the loss colour", () => {
    const gain = { name: "投资盈亏", color: "var(--l1)", values: [0, 3, -2, -4, 5], width: 2, area: "sign" };
    const html = render({ series: [gain], zero: true });
    expect(html).toContain('class="ch-zero"');
    expect(html).toMatch(/class="ch-area"[^>]*fill:var\(--up\)/);
    expect(html).toMatch(/class="ch-area"[^>]*fill:var\(--down\)/);
    expect(count(html, "<clipPath")).toBe(2);
  });

  it("colours the gap between two lines by which one is ahead", () => {
    const html = render({ series: [invested, assets], between: [1, 0] });
    expect(html).toMatch(/class="ch-between"[^>]*fill:var\(--up\)/);
    expect(html).toMatch(/class="ch-between"[^>]*fill:var\(--down\)/);
  });

  it("marks a shaded interval with its label and a point with a dot and label", () => {
    const html = render({
      series: [assets],
      bands: [{ from: 1, to: 3, label: "最长跑输 −2.10 pp" }],
      markers: [{ index: 2, value: 103, label: "−3.20%" }],
    });
    const l = lineLayout({ width: 600, height: 260, series: [assets] });
    expect(html).toMatch(new RegExp(`class="ch-band"[^>]*x="${l.x(1)}"`));
    expect(html).toContain("最长跑输 −2.10 pp");
    expect(html).toMatch(new RegExp(`<circle class="ch-marker"[^>]*cx="${l.x(2)}" cy="${l.y(103)}"`));
    expect(html).toContain("−3.20%");
  });

  it("shows no crosshair until hovered", () => {
    const html = render({ series: [invested, assets] });
    expect(html).not.toContain("ch-cross");
    expect(html).not.toContain("ch-tip");
  });

  it("shows a crosshair and the value of every series at the hovered day", () => {
    const html = render({
      series: [invested, assets],
      hoverIndex: 3,
      formatValue: (v) => `A$${v.toFixed(2)}`,
    });
    const l = lineLayout({ width: 600, height: 260, series: [invested, assets] });
    expect(html).toMatch(new RegExp(`class="ch-cross" x1="${l.x(3)}" x2="${l.x(3)}"`));
    expect(html).toContain('class="ch-tip"');
    expect(html).toContain("2026-10-04");
    expect(html).toMatch(/净投入<\/span><b>A\$105\.00/);
    expect(html).toMatch(/总资产<\/span><b>A\$108\.00/);
    expect(count(html, 'class="ch-dot"')).toBe(2);
  });
});
