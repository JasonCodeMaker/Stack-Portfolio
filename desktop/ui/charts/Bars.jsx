import React from "react";
import "./charts.css";

// Small inline bars drawn with positioned spans (prototype review `.cb`, allocation `.b`/`.bl`),
// so they sit inside table and grid rows and follow the row width.

const p = (n) => `${+n.toFixed(4)}%`;

/** [largest gain, largest loss] for a set of signed values, each at least 1. */
export function divergingScale(values) {
  return [Math.max(1, ...values), Math.max(1, ...values.map((v) => -v))];
}

/**
 * Signed bar around a zero line (contribution rows). Gains go right in the gain colour,
 * losses left in the loss colour. `scale` = divergingScale(all values in the list).
 */
export function DivergingBar({ value, scale: [maxGain, maxLoss], title }) {
  const total = maxGain + maxLoss,
    zero = (maxLoss / total) * 100,
    width = (Math.abs(value) / total) * 100;
  return (
    <span className="ch-diverge" title={title}>
      <u style={{ left: p(zero) }} />
      <i style={{ left: p(value >= 0 ? zero : zero - width), width: p(Math.max(width, 0.6)), background: value >= 0 ? "var(--up)" : "var(--down)" }} />
    </span>
  );
}

/** Plain bar `value / max` wide. */
export function Bar({ value, max, color = "var(--s1)", title }) {
  return (
    <span className="ch-bar" title={title}>
      <i style={{ width: p(Math.max(0.4, (value / max) * 100)), background: color }} />
    </span>
  );
}

/**
 * Rows sorted from largest to smallest: label, bar, formatted value (allocation distributions).
 * rows: [{ key, label, value, muted?, onClick?, title? }] — `muted` greys residual rows (cash, 未分类…).
 */
export function RankedBars({ rows, format }) {
  const sorted = [...rows].sort((a, b) => b.value - a.value),
    max = Math.max(...sorted.map((r) => r.value), 1e-9);
  return (
    <div className="ch-rank">
      {sorted.map((r) => (
        <div
          key={r.key}
          className={`ch-rank-row${r.muted ? " muted" : ""}${r.onClick ? " click" : ""}`}
          onClick={r.onClick}
          title={r.title}
        >
          <span className="ch-rank-name">{r.label}</span>
          <Bar value={r.value} max={max} color={r.muted ? "var(--l3)" : "var(--s1)"} />
          <span className="ch-rank-value">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Inline bullet: actual bar, target tick and the allowed deviation band (target ± tolerance),
 * all in the same unit and drawn against `max`.
 */
export function BulletBar({ actual, target, tolerance, max, title }) {
  const from = Math.max(0, target - tolerance),
    to = Math.min(max, target + tolerance),
    at = (v) => (v / max) * 100;
  return (
    <span className="ch-bullet" title={title}>
      <i className="ch-bullet-band" style={{ left: p(at(from)), width: p(at(to - from)) }} />
      <i className="ch-bullet-act" style={{ width: p(Math.min(100, at(actual))) }} />
      <i className="ch-bullet-tick" style={{ left: p(at(target)) }} />
    </span>
  );
}

/** Two-part stacked bar (company exposure: held directly, then through ETFs). */
export function StackedBar({ first, second, max, colors = ["var(--s1)", "var(--s2)"], title }) {
  const a = (first / max) * 100,
    b = (second / max) * 100;
  return (
    <span className="ch-bar ch-stack" title={title}>
      <i style={{ width: p(a), background: colors[0] }} />
      <i style={{ left: p(a), width: p(b), background: colors[1], marginLeft: first > 0 ? 1 : 0 }} />
    </span>
  );
}
