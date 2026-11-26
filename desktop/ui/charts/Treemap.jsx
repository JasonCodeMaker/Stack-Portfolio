import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { inlineLabelGap, subTreemapLayout, treemapLayout } from "./treemapLayout.js";
import { useWidth } from "./useWidth.js";
import { useI18n } from "../i18n.jsx";
import "./charts.css";

/**
 * Tile colour for a daily change in percent: the gain or loss colour mixed into the neutral
 * tile colour, from 18% at 0 to 92% at ±3% or more. Text follows the resulting colour in both themes.
 */
export function changeTileColor(changePct) {
  const mix = Math.round(18 + Math.min(1, Math.abs(changePct) / 3) * 74);
  const background = `color-mix(in srgb,var(${changePct >= 0 ? "--tu" : "--td"}) ${mix}%,var(--tz))`;
  return { background, color: `contrast-color(${background})` };
}

/**
 * Calibrated step colour for refined treemap tiles in both Light and Dark themes.
 */
export function refinedTileColor(changePct) {
  let background;
  if (changePct >= 1.5) background = "var(--tm-up-2)";
  else if (changePct >= 0) background = "var(--tm-up-1)";
  else if (changePct <= -8) background = "var(--tm-down-4)";
  else if (changePct <= -4) background = "var(--tm-down-3)";
  else if (changePct <= -2) background = "var(--tm-down-2)";
  else background = "var(--tm-down-1)";
  return { background, color: "var(--tm-tile-text)" };
}

function textMeasurer(element) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;
  const { fontFamily } = getComputedStyle(element);
  const widths = new Map();
  return (label, weight) => {
    const key = weight + " " + label;
    if (!widths.has(key)) {
      context.font = weight + " 100px " + fontFamily;
      widths.set(key, context.measureText(label).width / 100);
    }
    return widths.get(key);
  };
}

function useCalloutPositions(chart, labels, outside) {
  const [positions, setPositions] = useState(new Map());
  useLayoutEffect(() => {
    const list = labels.current;
    if (!list) return;
    const measure = () => {
      const origin = chart.current.getBoundingClientRect();
      setPositions(new Map(Array.from(list.children, (label) => {
        const { left, top, width } = label.getBoundingClientRect();
        return [label.dataset.item, { x: left + width / 2 - origin.left, y: top - origin.top }];
      })));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [chart, labels, outside]);
  return positions;
}

function calloutAlignment(outside, width) {
  if (outside.length !== 1) return undefined;
  const [{ x, w }] = outside;
  const center = (x + w / 2) / width;
  if (center < 1 / 3) return "flex-start";
  return center > 2 / 3 ? "flex-end" : "center";
}

function subTileAppearance(subItem) {
  if (subItem.colorMode === "sources" && subItem.isEtf) {
    return {
      semantic: true,
      style: { background: "var(--tm-how-etf)", color: "var(--tm-tile-text)", borderColor: "rgba(255,255,255,0.22)" },
    };
  }
  if (subItem.colorMode !== "sources" && subItem.change != null) {
    const tone = refinedTileColor(subItem.change * 100);
    return {
      semantic: true,
      style: { ...tone, borderColor: "rgba(255,255,255,0.18)" },
    };
  }
  return { semantic: false, style: { borderLeftColor: subItem.accent } };
}

function OtherNestedTile({ item, text, w, h, onSelectSubItem }) {
  const { t } = useI18n();
  const showNested = Boolean(item.subItems?.length && w >= 120 && h >= 130);
  if (!showNested) {
    return (
      <>
        <b style={{ fontSize: text.font }}>{text.labels.map((line, i) => <span key={i}>{line}</span>)}</b>
        {text.lines.map((line, i) => <span key={i} style={{ fontSize: text.detailFont }}>{line}</span>)}
      </>
    );
  }
  const headH = 38;
  const subBoxes = subTreemapLayout(item.subItems, Math.max(16, w - 16), Math.max(16, h - headH - 8));
  const interactive = typeof onSelectSubItem === "function";
  const HeaderAction = interactive ? "button" : "small";
  const mergeSubItems = item.mergeSubItems ?? (item.subItems.length > 1);
  const headerActionTarget = mergeSubItems ? "ALL" : item.subItems[0]?.id;
  return (
    <div className="ch-tm-other-nest">
      <div className="ch-tm-other-head">
        <span>
          <b><span>{item.label}</span></b> <em className="ch-tm-other-pct">{item.detail?.[0]}</em>
        </span>
        {w > 135 && (
          <HeaderAction
            type={interactive ? "button" : undefined}
            className="ch-tm-drill-badge"
            onClick={interactive && headerActionTarget ? () => onSelectSubItem(headerActionTarget) : undefined}
          >
            {interactive && mergeSubItems
              ? t("alloc.tail.mergedBtn")
              : item.subItems[0]?.isEtf
                ? t("tm.drillIntoEtf")
                : t("alloc.tail.openBucket")}
          </HeaderAction>
        )}
      </div>
      {subBoxes.map((sb) => {
        const sw = Math.max(0, sb.w - 4);
        const sh = Math.max(0, sb.h - 4);
        if (sw < 16 || sh < 16) return null;
        const appearance = subTileAppearance(sb.item);
        const SubTag = interactive ? "button" : "div";
        const showEtfBadge = sb.item.isEtf && sw > 84 && sh > 46;
        const showTailMeta = Boolean(sb.item.tailCountLabel) && sw > 78 && sh > 78;
        const showPreview = Boolean(sb.item.preview) && sw > 95 && sh > 130;
        const showChangePill = sb.item.colorMode !== "sources" && sb.item.change != null && sw > 108 && sh > 56;
        return (
          <SubTag
            key={sb.item.id}
            type={interactive ? "button" : undefined}
            className={`ch-tm-sub ${appearance.semantic ? "semantic" : ""} ${interactive ? "click" : ""}`.trim()}
            title={sb.item.title}
            onClick={interactive ? () => onSelectSubItem(sb.item.id) : undefined}
            style={{
              left: 8 + sb.x + 2,
              top: headH + sb.y + 2,
              width: sw,
              height: sh,
              ...appearance.style,
            }}
          >
            <div className="ch-tm-sub-top">
              <div className="ch-tm-sub-head">
                <strong className="ch-tm-sub-tk">{sb.item.label}</strong>
                {showEtfBadge && <span className="ch-tm-sub-badge">{t("alloc.tail.etfBadge")}</span>}
              </div>
              {showTailMeta && <div className="ch-tm-sub-meta">{sb.item.tailCountLabel}</div>}
              {showPreview && <div className="ch-tm-sub-preview">{sb.item.preview}</div>}
            </div>
            {sh > 36 && sw > 44 && (
              <div className="ch-tm-sub-bot">
                <div className="ch-tm-sub-row">
                  <small>{sb.item.share}</small>
                  {showChangePill && (
                    <span className="ch-tm-badge-dark">
                      {sb.item.change >= 0 ? "▲" : "▼"} {Math.abs(sb.item.change * 100).toFixed(2)}%
                    </span>
                  )}
                </div>
                {sw > 96 && sh > 88 && sb.item.inside && (
                  <small className="ch-tm-sub-in">{sb.item.inside}{t("tm.shareSuffix")}</small>
                )}
              </div>
            )}
          </SubTag>
        );
      })}
    </div>
  );
}

function RefinedTileBody({ item, w, h, text }) {
  const { t } = useI18n();
  const primary = item.primaryTicker ?? item.label;
  const shareText = item.share ?? item.detail?.[0] ?? "";
  const isCompact = w < 110 || h < 82;
  const isTiny = h < 54 || w < 64;
  const tickerFont = isTiny
    ? Math.min(text.font, 13)
    : isCompact
      ? Math.min(Math.max(13, Math.round(Math.min(w, h) * 0.17)), 16)
      : Math.min(Math.max(15, Math.round(Math.min(w * 0.14, h * 0.18))), 22);

  if (isTiny) {
    return (
      <div className="ch-tm-card" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <b style={{ fontSize: tickerFont }}>{primary}</b>
        {shareText && w >= 68 && <span className="ch-tm-pct">{shareText}</span>}
      </div>
    );
  }

  if (item.cash) {
    return (
      <div className="ch-tm-card">
        <div className="ch-tm-card-top">
          <div className="ch-tm-title-row">
            <span className="ch-tm-cash-head">
              <Wallet size={isCompact ? 12 : 14} strokeWidth={2} aria-hidden="true" />
              <b style={{ fontSize: tickerFont }}>{primary}</b>
            </span>
            {w >= 145 && h >= 72 && item.cashBadge && (
              <span className="ch-tm-cash-title">{item.cashBadge}</span>
            )}
          </div>
        </div>
        <div className="ch-tm-card-bot">
          <div className="ch-tm-pct-stack">
            <span className="ch-tm-pct">{shareText}</span>
            {w >= 118 && h >= 92 && item.cashAmount && (
              <span className="ch-tm-cash-amt">{item.cashAmount}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (item.bucketAccent) {
    return (
      <div className="ch-tm-card">
        <div className="ch-tm-card-top">
          <div className="ch-tm-title-row">
            <b style={{ fontSize: tickerFont }}>{primary}</b>
            {item.bucketDrillable && w >= 110 && h >= 68 && (
              <small className="ch-tm-drill-badge">{t("tm.drillBtn")}</small>
            )}
          </div>
          {w >= 140 && h >= 92 && item.bucketSub && (
            <span className="ch-tm-fullname">{item.bucketSub}</span>
          )}
        </div>
        <div className="ch-tm-card-bot">
          <div className="ch-tm-pct-stack">
            <span className="ch-tm-pct">{item.bucketMainPct ?? shareText}</span>
            {w >= 120 && h >= 76 && item.bucketSubPct && (
              <span className="ch-tm-bucket-sub">{item.bucketSubPct}</span>
            )}
          </div>
          {w >= 145 && h >= 92 && item.bucketAmount && (
            <span className="ch-tm-bucket-sub">{item.bucketAmount}</span>
          )}
        </div>
      </div>
    );
  }

  const showSecondary = Boolean(item.secondaryTicker && w >= 128);
  const showFullName = Boolean(item.name && item.name !== primary && w >= 124 && h >= 88);
  const showChangePill = item.colorMode !== "sources" && item.change != null && w >= 116 && h >= 72;
  const showUnquotedPill = item.colorMode !== "sources" && item.change == null && w >= 102 && h >= 72;
  const showHowSub = item.colorMode === "sources" && item.sources && w >= 150 && h >= 76;

  return (
    <div className="ch-tm-card">
      <div className="ch-tm-card-top">
        <div className="ch-tm-title-row">
          <div className="ch-tm-ticker-wrap">
            <b style={{ fontSize: tickerFont }}>{primary}</b>
            {showSecondary && <span className="ch-tm-sec">/ {item.secondaryTicker}</span>}
          </div>
        </div>
        {showFullName && <span className="ch-tm-fullname">{item.name}</span>}
      </div>
      <div className="ch-tm-card-bot">
        <span className="ch-tm-pct">{shareText}</span>
        {showChangePill && (
          <span className="ch-tm-badge-dark">
            {item.change >= 0 ? "▲" : "▼"} {Math.abs(item.change * 100).toFixed(2)}%
          </span>
        )}
        {showUnquotedPill && <span className="ch-tm-badge-soft">{t("tm.unquoted")}</span>}
        {showHowSub && (
          <span className="ch-tm-how-sub">{t("tm.directShort")} {item.directPct} · {t("tm.etfShort")} {item.etfPct}</span>
        )}
      </div>
    </div>
  );
}

export function Treemap({ items, height, width: fixedWidth, color, selected, onSelect, onSelectSubItem, layoutOptions, refined = false }) {
  const [ref, measured] = useWidth();
  const ready = measured > 0;
  const width = fixedWidth ?? measured;
  const measureWidth = useMemo(() => ready ? textMeasurer(ref.current) : undefined, [ready, ref]);
  const { tiles, outside } = useMemo(() => {
    const tiles = treemapLayout(items, width, height, measureWidth, layoutOptions);
    return { tiles, outside: tiles.filter((tile) => !tile.text) };
  }, [items, width, height, measureWidth, layoutOptions]);
  const labels = useRef(null);
  const positions = useCalloutPositions(ref, labels, outside);
  const [hover, setHover] = useState(null);
  const [focus, setFocus] = useState(null);
  const linked = hover ?? focus;
  const canSelect = (item) => onSelect && (item.selectable === true || (!item.rest && item.selectable !== false));
  const describe = (item) => item.title ?? [item.label, ...(item.detail ?? [])].join(" · ");

  return (
    <div className="ch-tmap-with-labels">
      <div ref={ref} className={`ch-tmap ${refined ? "refined" : ""}`} style={{ height }}>
        {tiles.map(({ item, x, y, w, h, text }) => {
          const hasSub = Boolean(refined && item.rest && item.subItems?.length && text && w >= 120 && h >= 130);
          const subInteractive = hasSub && typeof onSelectSubItem === "function";
          const clickable = !subInteractive && canSelect(item);
          const interactive = Boolean(text && clickable);
          const Tile = interactive ? "button" : "div";
          const active = item.id === selected || item.id === linked;
          const isCompact = refined && !item.rest && (w < 110 || h < 82);
          const className = [
            "ch-tm",
            item.rest && "rest",
            item.cash && "cash",
            item.bucketAccent && "bucket",
            hasSub && "has-sub",
            isCompact && "compact",
            active && "on",
            text?.inline && !refined && "inline",
            !text && clickable && "linked-tile",
          ].filter(Boolean).join(" ");
          const tileStyle = {
            left: x,
            top: y,
            width: w,
            height: h,
            ...(text?.inline && !refined ? { columnGap: inlineLabelGap } : {}),
            ...(item.rest ? {} : color(item)),
            ...(item.bucketAccent ? { borderLeftColor: item.bucketAccent } : {}),
          };

          return (
            <Tile
              key={item.id}
              type={interactive ? "button" : undefined}
              aria-label={interactive ? describe(item) : undefined}
              aria-pressed={interactive ? item.id === selected : undefined}
              aria-hidden={text ? undefined : true}
              className={className}
              style={tileStyle}
              title={subInteractive ? undefined : describe(item)}
              onClick={clickable ? () => onSelect(item) : undefined}
              onPointerEnter={text ? undefined : () => setHover(item.id)}
              onPointerLeave={text ? undefined : () => setHover(null)}
            >
              {text &&
                (refined && item.rest ? (
                  <OtherNestedTile item={item} text={text} w={w} h={h} onSelectSubItem={onSelectSubItem} />
                ) : refined ? (
                  <RefinedTileBody item={item} w={w} h={h} text={text} />
                ) : (
                  <>
                    <b style={{ fontSize: text.font }}>{text.labels.map((line, i) => <span key={i}>{line}</span>)}</b>
                    {text.lines.map((line, i) => <span key={i} style={{ fontSize: text.detailFont }}>{line}</span>)}
                  </>
                ))}
            </Tile>
          );
        })}
      </div>
      {outside.length > 0 && (
        <>
          <div className="ch-tm-labels" ref={labels} style={{ justifyContent: calloutAlignment(outside, width) }}>
            {outside.map(({ item }) => {
              const clickable = canSelect(item);
              const Label = clickable ? "button" : "span";
              return (
                <Label
                  key={item.id}
                  data-item={item.id}
                  type={clickable ? "button" : undefined}
                  tabIndex={clickable ? undefined : 0}
                  className={clickable ? "btn" : item.rest ? "ch-tm-rest-label" : undefined}
                  title={describe(item)}
                  aria-label={clickable ? describe(item) : undefined}
                  aria-pressed={clickable ? item.id === selected : undefined}
                  onClick={clickable ? () => onSelect(item) : undefined}
                  onPointerEnter={() => setHover(item.id)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setFocus(item.id)}
                  onBlur={() => setFocus(null)}
                >
                  {[item.label, item.detail?.[0]].filter(Boolean).join(" ")}
                </Label>
              );
            })}
          </div>
          <svg className="ch-tm-leaders" aria-hidden="true">
            {outside.map(({ item, x, y, w, h }) => {
              const end = positions.get(String(item.id));
              if (!end) return null;
              const startX = x + w / 2, startY = y + h / 2;
              const elbowY = height + 4;
              return (
                <g key={item.id} className={item.id === (linked ?? selected) ? "on" : undefined} data-item={item.id}>
                  <path d={"M " + startX + " " + startY + " V " + elbowY + " L " + end.x + " " + end.y} />
                  <circle cx={startX} cy={startY} r={2} />
                </g>
              );
            })}
          </svg>
        </>
      )}
    </div>
  );
}
