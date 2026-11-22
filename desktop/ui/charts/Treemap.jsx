import React from "react";
import { treemapLayout } from "./treemapLayout.js";
import { useWidth } from "./useWidth.js";
import "./charts.css";

/**
 * Tile colour for a daily change in percent: the gain or loss colour mixed into the neutral
 * tile colour, from 18% at 0 to 92% at ±3% or more; text turns white once the tile is dark enough.
 */
export function changeTileColor(changePct) {
  const mix = Math.round(18 + Math.min(1, Math.abs(changePct) / 3) * 74);
  return {
    background: `color-mix(in srgb,var(${changePct >= 0 ? "--tu" : "--td"}) ${mix}%,var(--tz))`,
    color: mix >= 52 ? "#fff" : "var(--tm-ink)",
  };
}

/**
 * Grouped treemap (allocation company map). Width follows the container; `height` comes from the caller.
 * groups:   see treemapLayout — named items get a coloured tile, `rest` items the grey 「其他」 block.
 * color(item) → { background, color }  tile fill and text colour, chosen by the caller.
 * title(item) → hover text; onSelect(item) on click; selected = item id drawn with an outline.
 */
export function Treemap({ groups, height, width: fixedWidth, color, title, selected, onSelect }) {
  const [ref, measured] = useWidth();
  const width = fixedWidth ?? measured;
  const layout = width > 0 ? treemapLayout(groups, width, height) : { groups: [], tiles: [] };
  const box = (t) => ({ left: t.x, top: t.y, width: t.w, height: t.h });
  const Tile = onSelect ? "button" : "div";

  return (
    <div ref={ref} className="ch-tmap" style={{ height }}>
      {layout.groups
        .filter((g) => g.header)
        .map((g) => (
          <div key={`h-${g.key}`} className="ch-tmh" style={{ left: g.header.x, top: g.header.y, width: g.header.w }}>
            <b>{g.header.label}</b>
            {g.header.caption ? `　${g.header.caption}` : ""}
          </div>
        ))}
      {layout.tiles.map((t) =>
        t.rest ? (
          <div key={t.item.id} className="ch-tm rest" style={box(t)} title={title?.(t.item)}>
            {t.text}
          </div>
        ) : (
          <Tile
            key={t.item.id}
            type={onSelect ? "button" : undefined}
            aria-label={onSelect ? title?.(t.item) || t.item.label : undefined}
            aria-pressed={onSelect ? t.item.id === selected : undefined}
            className={t.item.id === selected ? "ch-tm on" : "ch-tm"}
            style={{ ...box(t), ...color(t.item) }}
            title={title?.(t.item)}
            onClick={onSelect ? () => onSelect(t.item) : undefined}
          >
            {t.font != null && <b style={{ fontSize: t.font }}>{t.item.label}</b>}
            {t.lines.map((line, i) => (
              <span key={i} style={{ fontSize: t.detailFont, opacity: i ? 0.82 : undefined }}>
                {line}
              </span>
            ))}
          </Tile>
        ),
      )}
    </div>
  );
}
