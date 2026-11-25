import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { area, curveLinear, curveStepAfter, line } from "d3-shape";
import { lineLayout, MARGIN } from "./lineLayout.js";
import { useWidth } from "./useWidth.js";
import "./charts.css";

const identity = (v) => String(v);
const TICK_LABEL_GAP = 8;

/**
 * Shared line chart (prototype kit `K.line`, plus the hover crosshair and tooltip from spec §1.5).
 * Width follows the container; `height` comes from the caller (the shell's main-chart height).
 *
 * series:  [{ name, color, values, width?, dash?, step?, area?: true | "sign" }]
 *          `width` emphasises a line (bold end label); `area` fills to zero ("sign" = gain/loss colours).
 *          `axis: "right"` plots an independently scaled line with the `formatRightAxis` formatter.
 * dates:   date per index (ISO strings), used for the x axis and the tooltip heading.
 * between: [i, j] fills between series i (above = gain colour) and series j (below = loss colour).
 * bands:   [{ from, to, label?, color? }] shaded index intervals with a top rule and label.
 * markers: [{ index, value, label?, color? }] dots with a label.
 * zero, lo, hi, labels, padRight: see lineLayout.
 * formatAxis(v), formatValue(v, series), formatDate(date): text formatting.
 * onSelect(date), onZoom(from, to): optional observation and range selection.
 * width / hoverIndex: fixed values for static rendering and tests.
 */
export function LineChart({
  series,
  dates,
  height,
  width: fixedWidth,
  zero,
  lo,
  hi,
  labels = true,
  padRight,
  between,
  bands = [],
  markers = [],
  formatAxis = identity,
  formatRightAxis = identity,
  formatValue,
  formatDate = identity,
  formatAxisDate,
  hoverIndex,
  ariaLabel,
  onSelect,
  onZoom,
}) {
  const [ref, measured] = useWidth();
  const width = fixedWidth ?? measured;
  const [hover, setHover] = useState(null);
  const [keyboardIndex, setKeyboardIndex] = useState(null);
  const [drag, setDrag] = useState(null);
  const [padLeft, setPadLeft] = useState(MARGIN.left);
  const axisRef = useRef(null);
  const dragStart = useRef(null);
  const navigable = Boolean(dates?.length);
  const selectable = navigable && Boolean(onSelect || onZoom);
  const id = useId().replace(/:/g, "");
  const shown = hoverIndex ?? keyboardIndex ?? hover;

  let svg = null,
    tip = null,
    announcement = "",
    tickText = "";
  if (width > 0 && series.length) {
    const l = lineLayout({ width, height, series, dates, zero, lo, hi, labels, padLeft, padRight, formatAxisDate });
    const { plot, x, y } = l;
    const tickLabels = l.ticks.map(({ value }) => formatAxis(value));
    tickText = tickLabels.join("\n");
    const defined = (v) => Number.isFinite(v);
    const pathOf = (s) =>
      line()
        .defined(defined)
        .x((_, i) => x(i))
        .y((v) => l.seriesY(s, v))
        .curve(s.step ? curveStepAfter : curveLinear)(s.values);
    const fillTo = (s, base) =>
      area()
        .defined(defined)
        .x((_, i) => x(i))
        .y0(base)
        .y1((v) => y(v))
        .curve(s.step ? curveStepAfter : curveLinear)(s.values);

    const defs = [],
      fills = [];
    if (between) {
      const [a, b] = [series[between[0]], series[between[1]]];
      defs.push(
        <clipPath key="bu" id={`${id}bu`}>
          <path d={fillTo(a, plot.bottom)} />
        </clipPath>,
        <clipPath key="bd" id={`${id}bd`}>
          <path d={fillTo(a, plot.top)} />
        </clipPath>,
      );
      fills.push(
        <path key="bu" className="ch-between" d={fillTo(b, plot.top)} style={{ fill: "var(--up)", opacity: 0.16 }} clipPath={`url(#${id}bu)`} />,
        <path key="bd" className="ch-between" d={fillTo(b, plot.bottom)} style={{ fill: "var(--down)", opacity: 0.18 }} clipPath={`url(#${id}bd)`} />,
      );
    }
    const zeroLine = y(Math.max(l.domain[0], Math.min(l.domain[1], 0)));
    series.forEach((s, i) => {
      if (!s.area) return;
      const sign = s.area === "sign";
      defs.push(
        <clipPath key={`p${i}`} id={`${id}p${i}`}>
          <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={Math.max(0, zeroLine - plot.top)} />
        </clipPath>,
        <clipPath key={`n${i}`} id={`${id}n${i}`}>
          <rect x={plot.left} y={zeroLine} width={plot.right - plot.left} height={Math.max(0, plot.bottom - zeroLine)} />
        </clipPath>,
      );
      const d = fillTo(s, zeroLine);
      fills.push(
        <path key={`p${i}`} className="ch-area" d={d} style={{ fill: sign ? "var(--up)" : s.color, opacity: 0.18 }} clipPath={`url(#${id}p${i})`} />,
        <path key={`n${i}`} className="ch-area" d={d} style={{ fill: sign ? "var(--down)" : s.color, opacity: 0.2 }} clipPath={`url(#${id}n${i})`} />,
      );
    });

    const indexAt = (event) => {
      const box = event.currentTarget.getBoundingClientRect();
      return l.nearestIndex(event.clientX - box.left);
    };
    const onMove = (event) => {
      const index = indexAt(event);
      setKeyboardIndex(null);
      setHover(index);
      if (dragStart.current?.pointerId === event.pointerId && onZoom)
        setDrag([dragStart.current.index, index]);
    };
    const startDrag = (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const index = indexAt(event);
      dragStart.current = { pointerId: event.pointerId, index, x: event.clientX };
      event.currentTarget.setPointerCapture(event.pointerId);
    };
    const finishDrag = (event) => {
      const start = dragStart.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const index = indexAt(event);
      dragStart.current = null;
      setDrag(null);
      if (onZoom && start.index !== index && Math.abs(event.clientX - start.x) >= 4)
        onZoom(dates[Math.min(index, start.index)], dates[Math.max(index, start.index)]);
      else onSelect?.(dates[index]);
    };
    const clearTip = () => {
      setKeyboardIndex(null);
      setHover(null);
    };
    const onKeyDown = (event) => {
      const last = l.count - 1;
      const index = Math.min(shown ?? last, last);
      if (event.key === "ArrowLeft") setKeyboardIndex(Math.max(0, index - 1));
      else if (event.key === "ArrowRight") setKeyboardIndex(Math.min(last, index + 1));
      else if (event.key === "Home") setKeyboardIndex(0);
      else if (event.key === "End") setKeyboardIndex(last);
      else if (event.key === "Enter" && onSelect) onSelect(dates[index]);
      else if (event.key === "Escape") {
        clearTip();
        return;
      } else return;
      event.preventDefault();
    };

    const hx = shown != null && shown < l.count ? x(shown) : null;
    svg = (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        aria-description={navigable ? "按左右方向键查看每日数值，Home 和 End 跳到起点和终点。" +
          (onSelect ? "按 Enter 打开当日明细。" : "") : undefined}
        tabIndex={navigable ? 0 : undefined}
        className={selectable ? "ch-selectable" : undefined}
        onPointerMove={onMove}
        onPointerLeave={() => { if (!dragStart.current) setHover(null); }}
        onPointerDown={selectable ? startDrag : undefined}
        onPointerUp={selectable ? finishDrag : undefined}
        onPointerCancel={selectable ? () => {
          dragStart.current = null;
          setDrag(null);
          clearTip();
        } : undefined}
        onKeyDown={navigable ? onKeyDown : undefined}
        onBlur={navigable ? clearTip : undefined}
      >
        {defs.length > 0 && <defs>{defs}</defs>}
        <g ref={axisRef}>
          {l.ticks.map((t, i) => (
            <g key={t.value}>
              <line className="ch-grid" x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} />
              <text className="ch-axis" x={plot.left - TICK_LABEL_GAP} y={t.y + 4} textAnchor="end">
                {tickLabels[i]}
              </text>
            </g>
          ))}
        </g>
        {l.rightTicks.map((t) => (
          <g key={t.value}>
            <line className="ch-grid" x1={plot.right} x2={plot.right + 5} y1={t.y} y2={t.y} />
            <text className="ch-axis" x={plot.right + 8} y={t.y + 4}>{formatRightAxis(t.value)}</text>
          </g>
        ))}
        {l.zeroY != null && <line className="ch-zero" x1={plot.left} x2={plot.right} y1={l.zeroY} y2={l.zeroY} />}
        {l.xLabels.map((t, i) => (
          <text key={i} className="ch-axis" x={t.x} y={height - 6} textAnchor={t.anchor}>
            {t.text}
          </text>
        ))}
        {bands.map((b, i) => {
          const color = b.color ?? "var(--down)",
            left = x(b.from),
            w = Math.max(2, x(b.to) - left);
          return (
            <g key={`band${i}`}>
              <rect className="ch-band" x={left} y={plot.top} width={w} height={plot.bottom - plot.top} style={{ fill: color, opacity: 0.08 }} />
              <line x1={left} x2={left + w} y1={plot.top + 1} y2={plot.top + 1} style={{ stroke: color, strokeWidth: 2 }} />
              {b.label && (
                <text className="ch-note" x={left + 4} y={plot.bottom - 6} style={{ fill: color }}>
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
        {drag && (
          <rect
            className="ch-selection"
            x={x(Math.min(...drag))}
            y={plot.top}
            width={Math.abs(x(drag[0]) - x(drag[1]))}
            height={plot.bottom - plot.top}
          />
        )}
        {fills}
        {series.map((s, i) => (
          <path
            key={`s${i}`}
            className="ch-series"
            d={pathOf(s)}
            strokeWidth={s.width ?? 1.5}
            strokeDasharray={s.dash}
            style={{ stroke: s.color }}
          />
        ))}
        {l.endLabels.map((e) => (
          <text key={`e${e.series}`} className={e.strong ? "ch-end strong" : "ch-end"} x={e.x} y={e.y}>
            {e.name}
          </text>
        ))}
        {markers.map((m, i) => {
          const color = m.color ?? "var(--down)";
          return (
            <g key={`m${i}`}>
              <circle className="ch-marker" cx={x(m.index)} cy={y(m.value)} r={3.5} style={{ fill: color }} />
              {m.label && (
                <text className="ch-note strong" x={x(m.index) + 7} y={y(m.value) + 12} style={{ fill: color }}>
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
        {hx != null && (
          <g pointerEvents="none">
            <line className="ch-cross" x1={hx} x2={hx} y1={plot.top} y2={plot.bottom} />
            {series.map((s, i) =>
              defined(s.values[shown]) ? (
                <circle key={i} className="ch-dot" cx={hx} cy={l.seriesY(s, s.values[shown])} r={3.5} style={{ fill: s.color }} />
              ) : null,
            )}
          </g>
        )}
      </svg>
    );

    if (hx != null && !drag) {
      const flip = hx > (plot.left + plot.right) / 2;
      const valueText = formatValue ?? ((v) => formatAxis(v));
      const rows = series.filter((s) => defined(s.values[shown]) || s.axis === "right").map((s) => ({
        name: s.name, color: s.color, value: defined(s.values[shown]) ? valueText(s.values[shown], s) : "暂无",
      }));
      const date = dates?.[shown] == null ? "" : formatDate(dates[shown]);
      if (keyboardIndex != null) announcement = [date, ...rows.map((r) => r.name + " " + r.value)].join("，");
      tip = (
        <div
          className="ch-tip"
          style={{ left: flip ? hx - 12 : hx + 12, top: plot.top, transform: flip ? "translateX(-100%)" : undefined }}
        >
          {date && <div className="ch-tip-date">{date}</div>}
          {rows.map((row) => (
            <div key={row.name} className="ch-tip-row">
              <i style={{ background: row.color }} />
              <span>{row.name}</span>
              <b>{row.value}</b>
            </div>
          ))}
        </div>
      );
    }
  }

  useLayoutEffect(() => {
    if (!axisRef.current) return;
    const labels = axisRef.current.querySelectorAll("text");
    const widest = Math.max(0, ...Array.from(labels, (label) => label.getBBox().width));
    setPadLeft(Math.max(MARGIN.left, Math.ceil(widest) + TICK_LABEL_GAP + 4));
  }, [tickText]);

  return (
    <div ref={ref} className="ch-line" style={{ height }}>
      {svg}
      {tip}
      {navigable && <div className="ch-announcement" role="status">{announcement}</div>}
    </div>
  );
}
