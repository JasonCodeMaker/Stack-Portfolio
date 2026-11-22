import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

// Series colours passed the categorical checks together (lightness band, chroma floor,
// colour-vision separation and contrast on the white card surface).
export const seriesColors = { portfolio: "#0b7a53", SP500TR: "#2a78d6", XNDX: "#eb6834" };

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return width;
}

// Round tick values which cover [min, max] in about `count` steps.
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count,
    power = 10 ** Math.floor(Math.log10(raw)),
    unit = [1, 2, 2.5, 5, 10].find((u) => u * power >= raw) * power;
  const ticks = [];
  for (let v = Math.ceil(min / unit) * unit; v <= max + unit * 1e-9; v += unit)
    ticks.push(Math.abs(v) < unit * 1e-9 ? 0 : v);
  return ticks;
}

/**
 * A daily line chart with a legend, direct end labels, a crosshair and one tooltip for all series.
 * `series` items: { id, name, color, value(point), dashed }.
 * `band(shown)` names an upper series and a lower series or level; the space between them is
 * shaded by which is ahead.
 * `tooltip(point)` returns extra rows shown under the series values.
 */
export function TimeChart({
  points,
  series,
  format,
  axisFormat = format,
  label,
  height = 250,
  zero = false,
  band,
  tooltip,
  selected,
  onSelect,
  onZoom,
  zones,
}) {
  const box = useRef(null),
    width = useWidth(box);
  const [hover, setHover] = useState(null),
    [drag, setDrag] = useState(null),
    [hidden, setHidden] = useState([]);
  const start = useRef(null);
  useEffect(() => setHover(null), [points]);
  const shown = series.filter((s) => !hidden.includes(s.id));
  const shade = band?.(shown) || null;
  const values = points.flatMap((p) => shown.map((s) => s.value(p))).filter((v) => v != null);
  const left = 62,
    gutter = 78,
    top = 12,
    right = Math.max(left + 40, width - gutter),
    bottom = height - 26;
  let min = Math.min(...values, ...(zero ? [0] : [])),
    max = Math.max(...values, ...(zero ? [0] : []));
  if (!values.length) [min, max] = [0, 1];
  const pad = Math.max((max - min) * 0.1, Math.abs(max) * 0.004, 1e-6);
  min -= pad;
  max += pad;
  const x = (i) => left + ((right - left) * i) / Math.max(1, points.length - 1);
  const y = (v) => bottom - ((v - min) / (max - min)) * (bottom - top);
  const ticks = niceTicks(min, max, 4);
  // Date ticks keep clear of the full dates printed at both ends.
  const stepX = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((right - left) / 96))));
  const dateTicks = points
    .map((_, i) => i)
    .filter((i) => i % stepX === 0 && (i === 0 || x(i) - x(0) >= 84) && x(points.length - 1) - x(i) >= 96);
  if (points.length > 1) dateTicks.push(points.length - 1);
  const pinned = points.findIndex((p) => p.date === selected);
  const active = hover != null && points[hover] ? hover : null;
  function indexAt(e) {
    const rect = box.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - left) / (right - left);
    return Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
  }
  function path(s) {
    let d = "",
      continuous = false;
    const lone = [];
    points.forEach((p, i) => {
      const v = s.value(p);
      if (v == null) return void (continuous = false);
      d += (continuous ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
      if (!continuous && (i === points.length - 1 || s.value(points[i + 1]) == null)) lone.push(i);
      continuous = true;
    });
    return { d, lone };
  }
  // Runs of days on which both band series have a value, drawn as closed shapes between them.
  function bandShapes() {
    const upper = series.find((s) => s.id === shade.upper),
      lower = typeof shade.lower === "number" ? { value: () => shade.lower } : series.find((s) => s.id === shade.lower);
    const runs = [];
    let run = [];
    points.forEach((p, i) => {
      const a = upper.value(p),
        b = lower.value(p);
      if (a == null || b == null) {
        if (run.length > 1) runs.push(run);
        run = [];
      } else run.push([x(i), y(a), y(b)]);
    });
    if (run.length > 1) runs.push(run);
    return runs.map((r) => ({
      between:
        "M" + r.map(([px, ya]) => px.toFixed(1) + "," + ya.toFixed(1)).join("L") +
        "L" + [...r].reverse().map(([px, , yb]) => px.toFixed(1) + "," + yb.toFixed(1)).join("L") + "Z",
      above:
        "M" + r[0][0].toFixed(1) + "," + top + "L" + r.map(([px, , yb]) => px.toFixed(1) + "," + yb.toFixed(1)).join("L") +
        "L" + r.at(-1)[0].toFixed(1) + "," + top + "Z",
      below:
        "M" + r[0][0].toFixed(1) + "," + bottom + "L" + r.map(([px, , yb]) => px.toFixed(1) + "," + yb.toFixed(1)).join("L") +
        "L" + r.at(-1)[0].toFixed(1) + "," + bottom + "Z",
    }));
  }
  // End labels sit in the right gutter. Labels that would overlap are spread and tied back with a leader.
  const ends = shown
    .map((s) => {
      const i = points.findLastIndex((p) => s.value(p) != null);
      return i < 0 ? null : { s, i, v: s.value(points[i]), at: y(s.value(points[i])) };
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
  ends.forEach((e, k) => {
    e.label = k ? Math.max(e.at, ends[k - 1].label + 15) : e.at;
  });
  const overflow = ends.length ? ends.at(-1).label - (bottom - 2) : 0;
  if (overflow > 0) for (let k = ends.length - 1; k >= 0; k--) ends[k].label = Math.min(ends[k].label, bottom - 2 - (ends.length - 1 - k) * 15);
  const reading = active != null ? points[active] : null;
  const tipLeft = active != null && x(active) > left + (right - left) * 0.58;
  const idPrefix = useRef("c" + Math.random().toString(36).slice(2, 8)).current;
  return (
    <div className="chart">
      <div className="chart-legend" role="group" aria-label="图例，点按可隐藏或显示曲线">
        {series.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={!hidden.includes(s.id)}
            className={hidden.includes(s.id) ? "off" : ""}
            disabled={series.length < 2}
            onClick={() =>
              setHidden(
                hidden.includes(s.id)
                  ? hidden.filter((id) => id !== s.id)
                  : shown.length > 1
                    ? [...hidden, s.id]
                    : hidden,
              )
            }
          >
            <i className={s.dashed ? "dashed" : ""} style={{ borderTopColor: s.color }} />
            {s.name}
          </button>
        ))}
      </div>
      <div className="chart-plot" ref={box} style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            tabIndex={0}
            aria-label={label}
            className={onZoom ? "zoomable" : ""}
            onPointerDown={(e) => {
              if (e.button !== 0 || !onZoom) return;
              const i = indexAt(e);
              start.current = { i, pixel: e.clientX };
              setDrag([i, i]);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const i = indexAt(e);
              setHover(i);
              if (start.current) setDrag([start.current.i, i]);
            }}
            onPointerUp={(e) => {
              const i = indexAt(e),
                a = start.current;
              start.current = null;
              setDrag(null);
              if (a && a.i !== i && Math.abs(e.clientX - a.pixel) >= 4)
                onZoom(points[Math.min(a.i, i)].date, points[Math.max(a.i, i)].date);
              else onSelect?.(points[i].date);
            }}
            onPointerLeave={() => {
              if (!start.current) setHover(null);
            }}
            onPointerCancel={() => {
              start.current = null;
              setDrag(null);
              setHover(null);
            }}
            onKeyDown={(e) => {
              const from = active ?? points.length - 1;
              if (e.key === "ArrowLeft") setHover(Math.max(0, from - 1));
              else if (e.key === "ArrowRight") setHover(Math.min(points.length - 1, from + 1));
              else if (e.key === "Enter" && active != null) onSelect?.(points[active].date);
              else if (e.key === "Escape") setHover(null);
              else return;
              e.preventDefault();
            }}
            onBlur={() => setHover(null)}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line className={"chart-grid" + (zero && v === 0 ? " base" : "")} x1={left} x2={right} y1={y(v)} y2={y(v)} />
                <text className="chart-tick" x={left - 8} y={y(v) + 4} textAnchor="end">
                  {axisFormat(v)}
                </text>
              </g>
            ))}
            {zones && (
              <>
                <text className="chart-zone" x={left + 6} y={top + 11}>{zones[0]}</text>
                <text className="chart-zone" x={left + 6} y={bottom - 6}>{zones[1]}</text>
              </>
            )}
            {dateTicks.map((i) => (
              <text
                key={i}
                className="chart-tick"
                x={x(i)}
                y={height - 6}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              >
                {i === 0 || i === points.length - 1 ? points[i].date : points[i].date.slice(5)}
              </text>
            ))}
            {shade &&
              bandShapes().map((shape, k) => (
                <g key={k}>
                  <clipPath id={idPrefix + "a" + k}>
                    <path d={shape.above} />
                  </clipPath>
                  <clipPath id={idPrefix + "b" + k}>
                    <path d={shape.below} />
                  </clipPath>
                  <path d={shape.between} className="chart-ahead" clipPath={"url(#" + idPrefix + "a" + k + ")"} />
                  <path d={shape.between} className="chart-behind" clipPath={"url(#" + idPrefix + "b" + k + ")"} />
                </g>
              ))}
            {drag && (
              <rect
                className="chart-drag"
                x={x(Math.min(...drag))}
                y={top}
                width={Math.abs(x(drag[0]) - x(drag[1]))}
                height={bottom - top}
              />
            )}
            {shown.map((s) => {
              const { d, lone } = path(s);
              return (
                <g key={s.id}>
                  <path d={d} className="chart-line" stroke={s.color} strokeDasharray={s.dashed ? "6 4" : undefined} />
                  {lone.map((i) => (
                    <circle key={i} cx={x(i)} cy={y(s.value(points[i]))} r="2.5" fill={s.color} />
                  ))}
                </g>
              );
            })}
            {ends.map((e) => (
              <g key={e.s.id}>
                {Math.abs(e.label - e.at) > 1 || e.i < points.length - 1 ? (
                  <line className="chart-leader" x1={x(e.i) + 5} y1={e.at} x2={right + 8} y2={e.label} stroke={e.s.color} />
                ) : null}
                <circle className="chart-dot" cx={x(e.i)} cy={e.at} r="4" fill={e.s.color} />
                <text className="chart-end" x={right + 12} y={e.label + 4}>
                  {format(e.v)}
                </text>
              </g>
            ))}
            {pinned >= 0 && onSelect && (
              <g className="chart-pin">
                <line x1={x(pinned)} x2={x(pinned)} y1={top} y2={bottom} />
                <path d={"M" + (x(pinned) - 5) + "," + (top - 9) + "h10l-5,7z"} />
              </g>
            )}
            {active != null && (
              <g>
                <line className="chart-cross" x1={x(active)} x2={x(active)} y1={top} y2={bottom} />
                {shown.map(
                  (s) =>
                    s.value(reading) != null && (
                      <circle key={s.id} className="chart-dot" cx={x(active)} cy={y(s.value(reading))} r="4.5" fill={s.color} />
                    ),
                )}
              </g>
            )}
          </svg>
        )}
        {reading && !drag && (
          <div
            className="chart-tip"
            role="status"
            style={
              tipLeft
                ? { right: width - x(active) + 14, top: top + 4 }
                : { left: x(active) + 14, top: top + 4 }
            }
          >
            <time>
              {reading.date}
              {active === pinned && onSelect && " · 观察日"}
            </time>
            {shown.map((s) => (
              <div key={s.id} className="chart-tip-row">
                <i className={s.dashed ? "dashed" : ""} style={{ borderTopColor: s.color }} />
                <span>{s.name}</span>
                <b>{s.value(reading) == null ? "暂无" : format(s.value(reading))}</b>
              </div>
            ))}
            {tooltip?.(reading)}
          </div>
        )}
      </div>
    </div>
  );
}
