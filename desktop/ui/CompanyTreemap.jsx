import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Wallet } from "lucide-react";
import { buildCompanyMapModel } from "../allocation/domain/composition";
import { layoutCompanyMap, squarify } from "../allocation/domain/compositionLayout";
import { aud, pct, signedPct, Empty } from "./common";
import { useI18n } from "./i18n";

const SERIES_COLORS = ["#17805b", "#2a78d6", "#eb6834", "#6250d6", "#eda100", "#7F8F85"];
const GUTTER = 5;
const CANVAS_HEIGHT = 430;

function localizeBucket(b, t) {
  if (!b) return b;
  if (b.kind === "residual") {
    return {
      ...b,
      ticker: t("tm.bucket.residual"),
      label: t("tm.bucket.residualLabel"),
      subtitle: t("tm.bucket.residualSub"),
    };
  }
  if (b.kind === "small-direct") {
    return {
      ...b,
      ticker: t("tm.bucket.smallDirect"),
      label: t("tm.bucket.smallDirectLabel"),
      subtitle: t("tm.bucket.smallDirectSub"),
    };
  }
  if (b.kind === "other-assets") {
    return {
      ...b,
      ticker: t("label.otherAssets"),
      label: t("label.otherAssets"),
    };
  }
  return b;
}

function buildDayChangeLookup(rows) {
  const byHoldingId = new Map();
  const byTickerAcc = new Map();
  for (const r of rows || []) {
    if (r.type === "cash") continue;
    if (r.dayChangeRate != null && Number.isFinite(r.dayChangeRate)) {
      byHoldingId.set(r.id, { rate: r.dayChangeRate, aud: r.audValue ?? 0 });
      const tk = String(r.ticker || "").trim().toUpperCase();
      if (tk) {
        const w = Math.max(1, r.audValue ?? 0);
        const cur = byTickerAcc.get(tk) || { weightedSum: 0, totalW: 0 };
        cur.weightedSum += r.dayChangeRate * w;
        cur.totalW += w;
        byTickerAcc.set(tk, cur);
      }
    }
  }
  const byTicker = new Map();
  for (const [tk, acc] of byTickerAcc) {
    if (acc.totalW > 0) byTicker.set(tk, acc.weightedSum / acc.totalW);
  }
  return { byHoldingId, byTicker };
}

function resolveNodeDayChange(node, lookup) {
  if (!node || node.kind === "cash") return null;
  let weightedSum = 0;
  let totalW = 0;
  for (const src of node.sources || []) {
    if (src.kind !== "direct") continue;
    const hit = lookup.byHoldingId.get(src.holdingId);
    if (hit && hit.rate != null) {
      const w = Math.max(1, src.amountAud || hit.aud || 0);
      weightedSum += hit.rate * w;
      totalW += w;
    }
  }
  if (totalW > 0) return weightedSum / totalW;
  const p = String(node.primaryTicker || "").trim().toUpperCase();
  const full = String(node.ticker || "").trim().toUpperCase();
  return lookup.byTicker.get(p) ?? lookup.byTicker.get(full) ?? null;
}

function getTileTone(node, dayRate, colorMode) {
  if (node.kind === "cash") return { className: "tm-tile tm-tile-cash", style: undefined, unquoted: false };
  if (colorMode === "how" && node.kind === "company") {
    const directPct = node.valueAud > 0 ? Math.round((node.directAud / node.valueAud) * 100) : 0;
    return {
      className: "tm-tile tm-tile-quoted",
      style: {
        background: `linear-gradient(90deg, var(--tm-how-direct) 0%, var(--tm-how-direct) ${directPct}%, var(--tm-how-etf) ${directPct}%, var(--tm-how-etf) 100%)`,
      },
      unquoted: false,
    };
  }
  if (dayRate == null) return { className: "tm-tile tm-tile-unquoted", style: undefined, unquoted: true };
  if (dayRate >= 0) {
    return {
      className: dayRate >= 0.012 ? "tm-tile tm-tile-up2" : "tm-tile tm-tile-up1",
      style: undefined,
      unquoted: false,
    };
  }
  const abs = Math.abs(dayRate);
  const cls =
    abs >= 0.08
      ? "tm-tile-down4"
      : abs >= 0.04
        ? "tm-tile-down3"
        : abs >= 0.015
          ? "tm-tile-down2"
          : "tm-tile-down1";
  return { className: `tm-tile ${cls}`, style: undefined, unquoted: false };
}

function TileInner({ node, dayRate, w, h, colorMode }) {
  const { t } = useI18n();
  const pad = w > 120 && h > 90 ? "11px 13px" : "7px 9px";
  if (node.kind === "cash") {
    const compact = w < 90 || h < 54;
    return (
      <div className="tm-inner" style={{ padding: pad }}>
        <div className="tm-inner-top tm-cash-head">
          <span className={`tm-cash-title ${w > 110 ? "lg" : ""}`}>
            <Wallet size={13} aria-hidden="true" />
            <span>{t("cash.plain")}</span>
          </span>
          {w > 125 && <span className="tm-pill-soft">{t("tm.balance")}</span>}
        </div>
        {!compact ? (
          <div>
            <div className="tm-val">{pct(node.weight)}</div>
            {h > 78 && w > 120 && <div className="tm-sub">{aud(node.valueAud)}</div>}
          </div>
        ) : (
          <div className="tm-val sm">{pct(node.weight)}</div>
        )}
      </div>
    );
  }

  const isHow = colorMode === "how";
  const canTitle = w >= 42 && h >= 26;
  const canPct = w >= 48 && h >= 42;
  const canSub = w >= 68 && h >= 64;
  const canFullName = w >= 145 && h >= 112 && node.label && node.label !== node.ticker;
  const sizeCls =
    w >= 200 && h >= 140 ? "xl" : w >= 125 && h >= 90 ? "lg" : w >= 78 && h >= 54 ? "md" : "sm";

  return (
    <div className="tm-inner" style={{ padding: pad }}>
      <div className="tm-inner-top">
        {canTitle && (
          <div className="tm-title-row">
            <span className={`tm-ticker ${sizeCls}`}>{node.primaryTicker || node.ticker}</span>
            {node.secondaryTicker && w > 105 && <span className="tm-ticker-sec">{node.secondaryTicker}</span>}
          </div>
        )}
        {canFullName && <div className="tm-name">{node.label}</div>}
      </div>
      <div className="tm-inner-bot">
        {canPct && <span className={`tm-val ${w >= 135 && h >= 96 ? "lg" : "sm"}`}>{pct(node.weight)}</span>}
        {canSub &&
          (isHow ? (
            <span className="tm-sub">
              {t("tm.directShort")} {pct(node.valueAud > 0 ? node.directAud / node.valueAud : 0)} · ETF{" "}
              {pct(node.valueAud > 0 ? node.viaEtfsAud / node.valueAud : 0)}
            </span>
          ) : dayRate == null ? (
            <span className="tm-pill-soft">{t("tm.unquoted")}</span>
          ) : (
            <span className="tm-pill-dark">
              {dayRate >= 0 ? "▲" : "▼"} {Math.abs(dayRate * 100).toFixed(2)}%
            </span>
          ))}
      </div>
    </div>
  );
}

export function CompanyTreemap({ d, onInspect }) {
  const { t, cashLabel } = useI18n();
  const [viewMode, setViewMode] = useState("tree");
  const [colorMode, setColorMode] = useState("day");
  const [zoomPath, setZoomPath] = useState([]);
  const [otherUnit, setOtherUnit] = useState("total");
  const [selectedKey, setSelectedKey] = useState(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: CANVAS_HEIGHT });

  const rawModel = useMemo(() => buildCompanyMapModel(d.exposure), [d.exposure]);
  const model = useMemo(
    () => ({
      ...rawModel,
      otherBuckets: rawModel.otherBuckets.map((b) => localizeBucket(b, t)),
    }),
    [rawModel, t],
  );
  const dayLookup = useMemo(() => buildDayChangeLookup(d.rows), [d.rows]);

  // Keep drill-down & selection valid when account filters or underlying data change.
  useEffect(() => {
    if (zoomPath.length >= 1 && model.otherBuckets.length === 0) setZoomPath([]);
    else if (zoomPath.length === 2 && !model.otherBuckets.some((b) => b.key === zoomPath[1])) {
      setZoomPath(["OTHER"]);
    }
    if (selectedKey && !model.leftNodes.some((n) => n.key === selectedKey)) {
      setSelectedKey(null);
    }
  }, [model, zoomPath, selectedKey]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (zoomPath.length > 0) setZoomPath((prev) => prev.slice(0, -1));
      else if (selectedKey) setSelectedKey(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomPath.length, selectedKey]);

  useEffect(() => {
    if (viewMode !== "tree" || !canvasRef.current) return;
    const el = canvasRef.current;
    const measure = () => {
      if (el.clientWidth > 0) setSize({ w: el.clientWidth, h: el.clientHeight || CANVAS_HEIGHT });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, zoomPath.length]);

  const depth = zoomPath.length;
  const activeBucket = depth === 2 ? model.otherBuckets.find((b) => b.key === zoomPath[1]) : null;
  const selectedNode = depth === 0 && selectedKey ? model.leftNodes.find((n) => n.key === selectedKey) : null;
  const selectedDayRate = selectedNode ? resolveNodeDayChange(selectedNode, dayLookup) : null;
  const top1DayRate = model.top1 ? resolveNodeDayChange(model.top1, dayLookup) : null;

  const box = { x: 0, y: 0, w: size.w, h: size.h };
  const topLayout = depth === 0 && size.w > 40 ? layoutCompanyMap(model.leftNodes, model.otherTotalAud, box) : null;
  const level1Boxes = depth === 1 && size.w > 40 ? squarify(model.otherBuckets, box) : [];
  const level2Items = useMemo(() => {
    if (!activeBucket) return [];
    const items = activeBucket.members.map((m) => ({
      ...m,
      kind: "member",
      primaryTicker: m.ticker || m.label,
    }));
    if (activeBucket.restValueAud > 0) {
      const restTicker = t("tm.restCount", { count: activeBucket.restCount });
      items.push({
        key: `${activeBucket.key}:rest`,
        kind: "rest",
        ticker: restTicker,
        primaryTicker: restTicker,
        label: t("tm.restLabel"),
        valueAud: activeBucket.restValueAud,
        weight: model.totalAud > 0 ? activeBucket.restValueAud / model.totalAud : null,
      });
    }
    return items;
  }, [activeBucket, model.totalAud, t]);
  const level2Boxes = depth === 2 && size.w > 40 ? squarify(level2Items, box) : [];

  const barRows = useMemo(() => {
    const rows = model.leftNodes.map((n) =>
      n.kind === "cash" ? { ...n, primaryTicker: t("cash.plain"), label: t("cash.plain") } : n,
    );
    if (model.otherTotalAud > 0) {
      rows.push({
        key: "OTHER",
        kind: "other",
        ticker: t("tm.otherTicker"),
        primaryTicker: t("tm.otherPrimary"),
        label: t("tm.otherDrillLabel", { count: model.otherBuckets.length }),
        valueAud: model.otherTotalAud,
        weight: model.otherWeight,
        directAud: model.otherBuckets
          .filter((b) => b.kind === "small-direct" || b.kind === "other-assets")
          .reduce((s, b) => s + b.valueAud, 0),
        viaEtfsAud: model.otherBuckets
          .filter((b) => b.kind !== "small-direct" && b.kind !== "other-assets")
          .reduce((s, b) => s + b.valueAud, 0),
      });
    }
    return rows.sort((a, b) => b.valueAud - a.valueAud);
  }, [model, t]);
  const maxBarAud = barRows[0]?.valueAud || 1;

  if (!model.totalAud || (!model.leftNodes.length && !model.otherBuckets.length)) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>{t("tm.title")}</h2>
          <span className="muted">{t("tm.coverage", { pct: pct(d.exposure.coverage) })}</span>
        </div>
        <Empty>{t("tm.noValuableHoldings")}</Empty>
      </section>
    );
  }

  return (
    <section className="card tm-card">
      <div className="tm-header">
        <div className="tm-header-title">
          <h2>{t("tm.title")}</h2>
          <span className="muted">{t("tm.subtitle", { pct: pct(d.exposure.coverage) })}</span>
        </div>
        <div className="tm-header-controls">
          <div className="tabs" role="group" aria-label={t("tm.viewSwitchAria")}>
            <button
              type="button"
              className={viewMode === "tree" ? "on" : ""}
              aria-pressed={viewMode === "tree"}
              onClick={() => setViewMode("tree")}
            >
              {t("tm.view.tree")}
            </button>
            <button
              type="button"
              className={viewMode === "bars" ? "on" : ""}
              aria-pressed={viewMode === "bars"}
              onClick={() => setViewMode("bars")}
            >
              {t("tm.view.bars")}
            </button>
          </div>
          <div className="tabs" role="group" aria-label={t("tm.colorSwitchAria")}>
            <button
              type="button"
              className={colorMode === "day" ? "on" : ""}
              aria-pressed={colorMode === "day"}
              onClick={() => setColorMode("day")}
            >
              {t("tm.color.day")}
            </button>
            <button
              type="button"
              className={colorMode === "how" ? "on" : ""}
              aria-pressed={colorMode === "how"}
              onClick={() => setColorMode("how")}
            >
              {t("tm.color.how")}
            </button>
          </div>
        </div>
      </div>

      {/* Clean 3-Column KPI Strip */}
      <div className="tm-kpis">
        <div>
          <span className="tm-kpi-k">{t("tm.kpi.top1")}</span>
          <strong className="tm-kpi-v">
            {model.top1 ? (
              <>
                {model.top1.label} {pct(model.top1.weight)}
                {top1DayRate != null && (
                  <small className={top1DayRate >= 0 ? "gain" : "loss"}>{signedPct(top1DayRate)}</small>
                )}
              </>
            ) : (
              "—"
            )}
          </strong>
          <span className="tm-kpi-d">
            {model.top1 && model.totalAud > 0
              ? t("tm.kpi.top1Detail", {
                  direct: pct(model.top1.directAud / model.totalAud),
                  etf: pct(model.top1.viaEtfsAud / model.totalAud),
                })
              : "—"}
          </span>
        </div>
        <div>
          <span className="tm-kpi-k">{t("tm.kpi.top5")}</span>
          <strong className="tm-kpi-v">{pct(model.top5Weight)}</strong>
          <span className="tm-kpi-d">{model.top5.map((c) => c.ticker).join(t("common.comma")) || "—"}</span>
        </div>
        <div>
          <span className="tm-kpi-k">{t("tm.kpi.named")}</span>
          <strong className="tm-kpi-v">
            {t("tm.kpi.namedCount", { count: model.namedCompanies.length, pct: pct(model.namedWeight) })}
          </strong>
          <span className="tm-kpi-d">
            {model.cashNode ? t("tm.kpi.cashPrefix", { pct: pct(model.cashNode.weight) }) : ""}
            {model.otherTotalAud > 0
              ? t("tm.kpi.otherSuffix", { pct: pct(model.otherWeight) })
              : t("tm.kpi.allNamed")}
          </span>
        </div>
      </div>

      {/* Contextual Drill-Down Bar */}
      {depth > 0 && (
        <div className="tm-drillbar">
          <div className="tm-drillbar-left">
            <button
              type="button"
              className="tm-back-btn"
              onClick={() => setZoomPath((prev) => prev.slice(0, -1))}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>{t(depth === 2 ? "tm.backToOther" : "tm.backToMap")}</span>
              <span className="muted">(Esc)</span>
            </button>
            <span className="tm-drillpath">
              {depth === 1 ? (
                t("tm.drillPathOther", { pct: pct(model.otherWeight) })
              ) : (
                <>
                  <button type="button" className="text-btn" onClick={() => setZoomPath(["OTHER"])}>
                    {t("tm.otherTicker")} {pct(model.otherWeight)}
                  </button>
                  <span className="muted"> › </span>
                  {t("tm.drillPathTail", { ticker: activeBucket?.ticker || "", pct: pct(activeBucket?.weight) })}
                </>
              )}
            </span>
          </div>
          {depth === 1 ? (
            <div className="tabs" role="group" aria-label={t("tm.unitSwitchAria")}>
              <button
                type="button"
                className={otherUnit === "total" ? "on" : ""}
                aria-pressed={otherUnit === "total"}
                onClick={() => setOtherUnit("total")}
              >
                {t("tm.unit.total")}
              </button>
              <button
                type="button"
                className={otherUnit === "inside" ? "on" : ""}
                aria-pressed={otherUnit === "inside"}
                onClick={() => setOtherUnit("inside")}
              >
                {t("tm.unit.inside")}
              </button>
            </div>
          ) : (
            <span className="muted">{t("tm.escHint")}</span>
          )}
        </div>
      )}

      {/* Main Visualization */}
      {viewMode === "bars" ? (
        <div className="tm-bars">
          {barRows.map((row) => {
            const isOther = row.kind === "other";
            const isCash = row.kind === "cash";
            const wPct = (row.valueAud / maxBarAud) * 100;
            const dayRate = isOther || isCash ? null : resolveNodeDayChange(row, dayLookup);
            const directPct = row.valueAud > 0 ? (row.directAud / row.valueAud) * 100 : 0;
            return (
              <button
                type="button"
                key={row.key}
                className={`tm-bar-row ${isOther ? "other" : ""} ${selectedKey === row.key ? "sel" : ""}`}
                onClick={() => {
                  if (isOther) {
                    setSelectedKey(null);
                    setZoomPath(["OTHER"]);
                    setViewMode("tree");
                  } else {
                    setSelectedKey((prev) => (prev === row.key ? null : row.key));
                  }
                }}
              >
                <div className="tm-bar-label">
                  <div className="tm-bar-title">
                    <strong>{row.primaryTicker || row.ticker}</strong>
                    {isOther && <span className="tm-bar-tag">{t("tm.tag.drillEtf")}</span>}
                  </div>
                  <small>{cashLabel(row.label)}</small>
                </div>
                <div className="tm-bar-track">
                  {colorMode === "how" && !isCash ? (
                    <div className="tm-bar-split" style={{ width: `${wPct}%` }}>
                      <i style={{ width: `${directPct}%`, background: "var(--tm-how-direct)" }} />
                      <i style={{ width: `${100 - directPct}%`, background: "var(--tm-how-etf)" }} />
                    </div>
                  ) : (
                    <div
                      className={`tm-bar-fill ${isCash ? "cash" : isOther ? "other" : dayRate == null ? "unquoted" : dayRate >= 0 ? "up" : "down"}`}
                      style={{ width: `${wPct}%` }}
                    />
                  )}
                </div>
                <div className="tm-bar-num">
                  <strong>{pct(row.weight)}</strong>
                  <small className={dayRate == null ? "" : dayRate >= 0 ? "gain" : "loss"}>
                    {isOther
                      ? t("tm.itemsCount", { count: model.otherBuckets.length })
                      : isCash
                        ? aud(row.valueAud)
                        : colorMode === "how"
                          ? `${t("tm.directShort")} ${pct(row.valueAud > 0 ? row.directAud / row.valueAud : 0)}`
                          : dayRate == null
                            ? t("tm.unquoted")
                            : signedPct(dayRate)}
                  </small>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div
          ref={canvasRef}
          className={`tm-canvas ${depth > 0 ? "tm-zoom-in" : ""}`}
          style={{ height: CANVAS_HEIGHT }}
        >
          {depth === 0 &&
            topLayout &&
            topLayout.leftBoxes.map((b) => {
              const x = b.x + GUTTER / 2;
              const y = b.y + GUTTER / 2;
              const w = Math.max(0, b.w - GUTTER);
              const h = Math.max(0, b.h - GUTTER);
              if (w < 6 || h < 6) return null;
              const dayRate = resolveNodeDayChange(b, dayLookup);
              const tone = getTileTone(b, dayRate, colorMode);
              return (
                <button
                  type="button"
                  key={b.key}
                  className={tone.className}
                  data-selected={selectedKey === b.key}
                  style={{ left: x, top: y, width: w, height: h, ...tone.style }}
                  title={`${cashLabel(b.label)} · ${pct(b.weight)} · ${aud(b.valueAud)}`}
                  onClick={() => setSelectedKey((prev) => (prev === b.key ? null : b.key))}
                >
                  <TileInner node={b} dayRate={dayRate} w={w} h={h} colorMode={colorMode} />
                </button>
              );
            })}

          {depth === 0 &&
            topLayout?.otherBox &&
            (() => {
              const ob = topLayout.otherBox;
              const ox = ob.x + GUTTER / 2;
              const oy = ob.y + GUTTER / 2;
              const ow = Math.max(0, ob.w - GUTTER);
              const oh = Math.max(0, ob.h - GUTTER);
              if (ow < 16 || oh < 16) return null;
              const headerH = 38;
              const subBox = {
                x: 8,
                y: headerH,
                w: Math.max(16, ow - 16),
                h: Math.max(16, oh - headerH - 8),
              };
              const subBoxes = squarify(model.otherBuckets, subBox);
              return (
                <button
                  type="button"
                  className="tm-tile tm-tile-other"
                  style={{ left: ox, top: oy, width: ow, height: oh }}
                  title={t("tm.otherTooltip", { pct: pct(model.otherWeight) })}
                  onClick={() => {
                    setSelectedKey(null);
                    setZoomPath(["OTHER"]);
                  }}
                >
                  <div className="tm-other-wrap">
                    <div className="tm-other-head">
                      <span>
                        <strong>{t("tm.otherTicker")}</strong>{" "}
                        <span className="tm-other-pct">{pct(model.otherWeight)}</span>
                      </span>
                      {ow > 125 && <span className="tm-drill-pill">{t("tm.drillIntoEtf")}</span>}
                    </div>
                    {subBoxes.map((sb, i) => {
                      const sw = Math.max(0, sb.w - 4);
                      const sh = Math.max(0, sb.h - 4);
                      if (sw < 14 || sh < 14) return null;
                      const accent = SERIES_COLORS[i % SERIES_COLORS.length];
                      return (
                        <div
                          key={sb.key}
                          className="tm-subtile"
                          style={{
                            left: sb.x + 2,
                            top: sb.y + 2,
                            width: sw,
                            height: sh,
                            borderLeftColor: accent,
                          }}
                        >
                          <div className="tm-subtile-tk">{sb.ticker}</div>
                          {sh > 36 && sw > 44 && (
                            <div className="tm-subtile-row">
                              <span>{pct(sb.weight)}</span>
                              {sw > 96 && sb.shareOfOther != null && (
                                <small>{t("tm.ofOtherShort", { pct: pct(sb.shareOfOther) })}</small>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </button>
              );
            })()}

          {depth === 1 &&
            level1Boxes.map((b, i) => {
              const x = b.x + GUTTER / 2;
              const y = b.y + GUTTER / 2;
              const w = Math.max(0, b.w - GUTTER);
              const h = Math.max(0, b.h - GUTTER);
              if (w < 6 || h < 6) return null;
              const accent = SERIES_COLORS[i % SERIES_COLORS.length];
              const clickable = b.members.length > 0;
              const mainPct = otherUnit === "total" ? pct(b.weight) : pct(b.shareOfOther);
              const subPct =
                otherUnit === "total"
                  ? t("tm.ofOtherPrefix", { pct: pct(b.shareOfOther) })
                  : t("tm.ofTotalPrefix", { pct: pct(b.weight) });
              return (
                <button
                  type="button"
                  key={b.key}
                  className={`tm-tile tm-tile-bucket ${clickable ? "" : "static"}`}
                  style={{
                    left: x,
                    top: y,
                    width: w,
                    height: h,
                    borderLeftColor: accent,
                    cursor: clickable ? "pointer" : "default",
                  }}
                  onClick={() => clickable && setZoomPath(["OTHER", b.key])}
                >
                  <div className="tm-bucket-inner" style={{ padding: w > 125 && h > 85 ? "12px 14px" : "8px 10px" }}>
                    <div className="tm-bucket-top">
                      <div className="tm-bucket-titles">
                        <strong>{b.ticker}</strong>
                        {w > 130 && h > 72 && (
                          <small>{b.subtitle || (b.memberCount ? t("tm.bucket.tailCount", { count: b.memberCount }) : b.label)}</small>
                        )}
                      </div>
                      {clickable && w > 115 && <span className="tm-drill-pill">{t("tm.drillBtn")}</span>}
                    </div>
                    <div className="tm-bucket-bot">
                      <strong>{mainPct}</strong>
                      {w > 105 && (
                        <span>
                          {subPct} · {aud(b.valueAud)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

          {depth === 2 &&
            level2Boxes.map((b) => {
              const x = b.x + GUTTER / 2;
              const y = b.y + GUTTER / 2;
              const w = Math.max(0, b.w - GUTTER);
              const h = Math.max(0, b.h - GUTTER);
              if (w < 6 || h < 6) return null;
              const isRest = b.kind === "rest";
              const dayRate = isRest ? null : resolveNodeDayChange(b, dayLookup);
              const tone = isRest
                ? { className: "tm-tile tm-tile-rest", style: undefined }
                : getTileTone({ kind: "company" }, dayRate, "day");
              return (
                <div
                  key={b.key}
                  className={tone.className}
                  style={{ left: x, top: y, width: w, height: h, cursor: "default" }}
                  title={`${b.label} · ${pct(b.weight)} · ${aud(b.valueAud)}`}
                >
                  <div className="tm-inner" style={{ padding: "8px 10px" }}>
                    <div className="tm-inner-top">
                      <div className="tm-ticker sm">{b.ticker || b.label}</div>
                      {w > 110 && h > 68 && b.label !== b.ticker && <div className="tm-name">{b.label}</div>}
                    </div>
                    <div className="tm-inner-bot">
                      <span className="tm-val sm">{pct(b.weight)}</span>
                      {w > 95 && dayRate != null && <span className="tm-pill-dark">{signedPct(dayRate)}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {selectedNode && (
        <div className="tm-detail-strip">
          <div className="tm-detail-main">
            <div className="tm-detail-head">
              <strong>
                {cashLabel(selectedNode.label)}
                {selectedNode.kind === "company" ? ` (${selectedNode.ticker})` : ""}
              </strong>
              <span className="tm-pill-soft">
                {t("tm.stripShare", { pct: pct(selectedNode.weight), amount: aud(selectedNode.valueAud, 2) })}
              </span>
              {selectedDayRate != null ? (
                <span className={selectedDayRate >= 0 ? "gain" : "loss"}>{signedPct(selectedDayRate)}</span>
              ) : (
                <span className="muted">
                  {selectedNode.kind === "cash" ? t("tm.multiCurrencyCash") : t("tm.unquoted")}
                </span>
              )}
            </div>
            <div className="tm-detail-sub">
              {selectedNode.kind === "cash"
                ? (selectedNode.cashParts || [])
                    .map((c) => `${cashLabel(c.label)} ${pct(c.weight)} (${aud(c.valueAud)})`)
                    .join(" + ")
                : t("tm.stripDetail", {
                    direct: aud(selectedNode.directAud),
                    etf: aud(selectedNode.viaEtfsAud),
                    etfs: selectedNode.etfBreakdown.length
                      ? t("common.openParen") +
                        selectedNode.etfBreakdown.map((e) => `${e.etfSymbol} ${pct(e.weight)}`).join(" · ") +
                        t("common.closeParen")
                      : "",
                  })}
            </div>
          </div>
          <div className="tm-detail-actions">
            {onInspect && selectedNode.sources?.length > 0 && (
              <button type="button" className="text-btn" onClick={() => onInspect(selectedNode)}>
                {t("tm.inspectByAccount")} <ArrowUpRight size={13} />
              </button>
            )}
            <button type="button" className="tm-close-strip" onClick={() => setSelectedKey(null)}>
              {t("tm.closeStrip")}
            </button>
          </div>
        </div>
      )}

      <div className="tm-footer">
        <span>{t(colorMode === "how" ? "tm.footerHow" : "tm.footerDay")}</span>
        {colorMode === "how" ? (
          <div className="tm-legend-how">
            <span>
              <i style={{ background: "var(--tm-how-direct)" }} />
              {t("tm.legend.direct")}
            </span>
            <span>
              <i style={{ background: "var(--tm-how-etf)" }} />
              {t("tm.legend.etf")}
            </span>
            <span>
              <i className="cash" />
              {t("cash.plain")}
            </span>
          </div>
        ) : (
          <div className="tm-legend-scale">
            <span>−8%+</span>
            <span className="tm-swatches">
              <i style={{ background: "var(--tm-down-4)" }} />
              <i style={{ background: "var(--tm-down-3)" }} />
              <i style={{ background: "var(--tm-down-1)" }} />
              <i style={{ background: "var(--tm-unquoted-bg)", border: "1px solid var(--tm-unquoted-border)" }} />
              <i style={{ background: "var(--tm-up-1)" }} />
              <i style={{ background: "var(--tm-up-2)" }} />
            </span>
            <span>+3%+</span>
          </div>
        )}
      </div>
    </section>
  );
}
