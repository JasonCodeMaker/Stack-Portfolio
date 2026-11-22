import { scaleLinear } from "d3-scale";

// Geometry of the shared line chart, following the prototype kit's `K.line`:
// points are spaced evenly by index (one per trading day), the value range is the data
// (plus 0 when a zero line is drawn) padded by 8%, and series are labelled at their ends.
export const MARGIN = { left: 52, right: 96, rightBare: 12, top: 10, bottom: 24 };
const END_LABEL_GAP = 14;
const DAY = 864e5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pad2 = (n) => String(n).padStart(2, "0");
const toDate = (d) => (d instanceof Date ? d : new Date(`${d}T00:00:00Z`));

// Axis date text by the span shown: YY-MM beyond ~15 months, M月 beyond ~3 months, else MM-DD.
export function dateLabeler(first, last) {
  const span = toDate(last) - toDate(first);
  return (value) => {
    const d = toDate(value),
      y = d.getUTCFullYear(),
      m = d.getUTCMonth() + 1;
    if (span > 463 * DAY) return `${String(y).slice(2)}-${pad2(m)}`;
    if (span > 93 * DAY) return `${m}月`;
    return `${pad2(m)}-${pad2(d.getUTCDate())}`;
  };
}

/**
 * @param o.width, o.height  pixel size of the SVG
 * @param o.series           [{ name, values:number[], width? }] — `width` marks an emphasised line
 * @param o.dates            optional date per index (ISO "YYYY-MM-DD" or Date) for the x axis
 * @param o.zero             include 0 in the range and report `zeroY`
 * @param o.lo, o.hi         force the bottom / top of the range (no padding on that side)
 * @param o.labels           false drops line-end labels and narrows the right margin
 * @param o.padRight         override the right margin (review charts use 104)
 */
export function lineLayout({ width, height, series, dates, zero = false, lo, hi, labels = true, padRight }) {
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const plot = {
    left: MARGIN.left,
    right: width - (padRight ?? (labels ? MARGIN.right : MARGIN.rightBare)),
    top: MARGIN.top,
    bottom: height - MARGIN.bottom,
  };

  const all = series.flatMap((s) => s.values.filter(Number.isFinite)).concat(zero ? [0] : []);
  let bottom = lo ?? (all.length ? Math.min(...all) : 0),
    top = hi ?? (all.length ? Math.max(...all) : 1);
  const pad = (top - bottom) * 0.08 || 1;
  if (lo == null) bottom -= pad;
  if (hi == null) top += pad;
  const round = (v) => +v.toFixed(10);
  const domain = [round(bottom), round(top)];

  const xScale = scaleLinear().domain([0, Math.max(1, n - 1)]).range([plot.left, plot.right]);
  const yScale = scaleLinear().domain(domain).range([plot.bottom, plot.top]);
  const x = (i) => xScale(i),
    y = (v) => yScale(v);

  const tickCount = clamp(Math.floor(height / 64), 2, 6);
  const ticks = yScale.ticks(tickCount).map((value) => ({ value, y: y(value) }));
  const zeroY = zero && domain[0] < 0 && domain[1] > 0 ? y(0) : null;

  let xLabels = [];
  if (dates?.length && n > 0) {
    const label = dateLabeler(dates[0], dates[n - 1]);
    const count = Math.min(n - 1, clamp(Math.floor((plot.right - plot.left) / 120), 2, 10));
    xLabels =
      count < 1
        ? [{ x: x(0), text: label(dates[0]), anchor: "start" }]
        : Array.from({ length: count + 1 }, (_, k) => {
            const i = Math.round((k * (n - 1)) / count);
            return { x: x(i), text: label(dates[i]), anchor: k === 0 ? "start" : k === count ? "end" : "middle" };
          });
  }

  let endLabels = [];
  if (labels && n > 0) {
    const ends = series.map((s) => {
      const last = [...s.values].reverse().find(Number.isFinite);
      return last == null ? null : y(last);
    });
    const order = ends.map((_, i) => i).filter((i) => ends[i] != null).sort((a, b) => ends[a] - ends[b]);
    for (let k = 1; k < order.length; k++)
      if (ends[order[k]] - ends[order[k - 1]] < END_LABEL_GAP) ends[order[k]] = ends[order[k - 1]] + END_LABEL_GAP;
    endLabels = series
      .map((s, i) => ({ name: s.name, x: plot.right + 8, y: ends[i] + 4, strong: s.width != null, series: i }))
      .filter((l) => ends[l.series] != null);
  }

  const nearestIndex = (px) => (n < 2 ? 0 : clamp(Math.round(xScale.invert(px)), 0, n - 1));

  return { plot, domain, x, y, ticks, zeroY, xLabels, endLabels, nearestIndex, count: n };
}
