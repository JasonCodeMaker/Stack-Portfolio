// PROTOTYPE — blocks shared by variants A and C: the value strip and the "What you own"
// composition section (squarified map + ranked legend + colour key).
import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { AnimatedToggleGroup, Card } from "@wealthfolio/ui";
import type { CompositionSlice } from "./composition";
import {
  aud, CASH_COLOR, CATEGORICAL, GROUP_COLOR, inkFor, pct, sectorColor, sectorLegend, sliceBackground, sliceFill, sliceSubtitle,
  type AllocationPageProps, type PrototypeModel,
} from "./shared";

export function ValueStrip({ model, props }: { model: PrototypeModel; props: AllocationPageProps }): JSX.Element {
  return <Card className="pa-strip">
    <Stat label="Portfolio value" value={aud(model.total)} detail={`${model.holdingCount} holdings · ${props.selectedAccounts.length} accounts`} />
    <Stat label="Invested" value={aud(model.investedAud)} detail={pct(model.total ? (model.investedAud ?? 0) / model.total : null)} />
    <Stat label="Cash" value={aud(model.cashAud)} detail={pct(model.total ? model.cashAud / model.total : null)} />
    <Stat label="Look-through coverage" value={pct(model.coverage)} detail={model.unresolved.length ? `${model.unresolved.map((row) => row.asset.symbol).join(", ")} not looked through` : "All funds looked through"} />
  </Card>;
}

/**
 * `headerInside` puts the title, description and mode switch inside the card (variant C's
 * card style); otherwise they sit above the card as a numbered section heading (variant A).
 */
export function WhatYouOwn({ model, props, step, title = "What you own", headerInside = false, onSelect }: {
  model: PrototypeModel;
  props: AllocationPageProps;
  step?: number;
  title?: string;
  headerInside?: boolean;
  onSelect: (slice: CompositionSlice) => void;
}): JSX.Element {
  const [mode, setMode] = useState<Mode>("look-through");
  const [active, setActive] = useState<string | null>(null);
  const tiles: Tile[] = mode === "look-through"
    ? model.composition.map((slice) => ({
      key: slice.key,
      label: slice.kind === "company" ? slice.ticker ?? slice.label : slice.label,
      sub: slice.kind === "company" ? slice.label : sliceSubtitle(slice),
      valueAud: slice.valueAud,
      weight: slice.weight,
      fill: slice.kind === "unresolved" ? "url(#proto-hatch)" : sliceFill(slice),
      background: sliceBackground(slice),
      darkText: slice.kind === "cash" || slice.kind === "unresolved" || inkFor(sliceFill(slice)) !== "#fff",
      slice,
    }))
    : props.portfolio.instrumentAllocation.map((row) => {
      const fill = row.type === "etf" ? CATEGORICAL[2] : row.type === "stock" ? CATEGORICAL[0] : CASH_COLOR;
      return { key: row.key, label: row.label, sub: row.type === "etf" ? "ETF" : row.type === "stock" ? "Stock" : "Cash", valueAud: row.valueAud, weight: row.weight, fill, background: fill, darkText: row.type === "cash" };
    });
  const select = (tile: Tile) => { if (tile.slice) onSelect(tile.slice); };
  const detail = mode === "look-through" ? "Funds are opened up and merged with the shares you hold directly. Area = share of portfolio." : "The holdings you actually bought. Area = share of portfolio.";
  const toggle = <AnimatedToggleGroup<Mode> size="sm" value={mode} onValueChange={setMode} items={[{ value: "look-through", label: "Look-through" }, { value: "purchased", label: "As purchased" }]} />;

  return <section className="pa-section">
    {!headerInside && <SectionHead step={step} title={title} detail={detail}>{toggle}</SectionHead>}
    <Card className={`pa-comp-card ${headerInside ? "pa-comp-card-inset" : ""}`}>
      {headerInside && <div className="pa-card-head"><div><h2>{title}</h2><p>{detail}</p></div>{toggle}</div>}
      <div className="pa-comp">
        <CompositionMap tiles={tiles} active={active} onHover={setActive} onSelect={select} />
        <ol className="pa-legend">
          {tiles.map((tile) => <li key={tile.key} className={active && active !== tile.key ? "is-dim" : ""} onMouseEnter={() => setActive(tile.key)} onMouseLeave={() => setActive(null)}>
            <button type="button" onClick={() => select(tile)} disabled={!tile.slice}>
              <i style={{ background: tile.background }} />
              <span><strong>{tile.label}</strong><small>{tile.sub}</small></span>
              <b>{pct(tile.weight)}</b>
            </button>
          </li>)}
          <li className="pa-legend-total"><span>Total</span><b>{pct(tiles.reduce((sum, tile) => sum + (tile.weight ?? 0), 0))}</b></li>
        </ol>
      </div>
      <footer className="pa-comp-foot">
        {mode === "look-through"
          ? <>{sectorLegend().map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}<span><i style={{ background: GROUP_COLOR }} />Other companies</span><span><i style={{ background: CASH_COLOR }} />Cash</span><span><i className="pa-hatch" />Not looked through</span></>
          : <><span><i style={{ background: CATEGORICAL[2] }} />ETF</span><span><i style={{ background: CATEGORICAL[0] }} />Stock</span><span><i style={{ background: CASH_COLOR }} />Cash</span></>}
      </footer>
    </Card>
    <HatchDefs />
  </section>;
}

type Mode = "look-through" | "purchased";

type Tile = {
  key: string;
  label: string;
  sub: string;
  valueAud: number;
  weight: number | null;
  fill: string;
  background: string;
  darkText: boolean;
  slice?: CompositionSlice;
};

interface Box { x: number; y: number; w: number; h: number }
type Placed<T> = T & Box;

function Stat({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return <div className="pa-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export function SectionHead({ step, title, detail, children }: { step?: number; title: string; detail: string; children?: ReactNode }): JSX.Element {
  return <header className="pa-section-head">
    <div>{step !== undefined && <span className="pa-step">{step}</span>}<div><h2>{title}</h2><p>{detail}</p></div></div>
    {children}
  </header>;
}

const SECTOR_SHORT: Record<string, string> = {
  "Information Technology": "Tech", Financials: "Financials", "Communication Services": "Comms", "Consumer Discretionary": "Cons. disc.",
  "Health Care": "Health", Materials: "Materials", Industrials: "Industrials", "Consumer Staples": "Staples", Energy: "Energy",
  Utilities: "Utilities", "Real Estate": "Property", Unclassified: "Unclassified",
};

/**
 * Named companies are squarified on the left; everything that is not a named company
 * (Other companies, cash, funds we could not open) is stacked in a column on the right,
 * so the tail can never become the headline tile. Area stays proportional to value.
 */
function CompositionMap({ tiles, active, onHover, onSelect }: { tiles: Tile[]; active: string | null; onHover: (key: string | null) => void; onSelect: (tile: Tile) => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ title: string; lines: string[]; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const named = tiles.filter((tile) => !tile.slice || tile.slice.kind === "company");
  const rest = tiles.filter((tile) => tile.slice && tile.slice.kind !== "company");
  const namedValue = named.reduce((sum, tile) => sum + tile.valueAud, 0);
  const restValue = rest.reduce((sum, tile) => sum + tile.valueAud, 0);
  const leftW = restValue > 0 ? size.w * (namedValue / (namedValue + restValue)) : size.w;
  const placedNamed = squarify(named, { x: 0, y: 0, w: leftW, h: size.h });
  let cursor = 0;
  const placedRest = rest.map((tile) => {
    const h = size.h * (tile.valueAud / restValue);
    const placed = { ...tile, x: leftW, y: cursor, w: size.w - leftW, h };
    cursor += h;
    return placed;
  });

  const show = (event: ReactMouseEvent, title: string, lines: string[], key: string) => {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return;
    onHover(key);
    setHover({ title, lines, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  const hide = () => { onHover(null); setHover(null); };
  const tileLines = (tile: Tile) => [tile.sub, `${aud(tile.valueAud)} · ${pct(tile.weight)}`, ...(tile.slice && tile.slice.viaEtfsAud > 0 ? [`Direct ${aud(tile.slice.directAud)} · Via funds ${aud(tile.slice.viaEtfsAud)}`] : [])];

  return <div ref={ref} className="pa-treemap" role="img" aria-label="Portfolio composition map" onMouseLeave={hide}>
    {size.w > 0 && <svg width={size.w} height={size.h}>
      {placedNamed.map((tile) => <TileRect key={tile.key} tile={tile} dim={Boolean(active && active !== tile.key)} onMove={(event) => show(event, tile.label, tileLines(tile), tile.key)} onClick={() => onSelect(tile)} />)}
      {placedRest.map((tile) => tile.slice?.kind === "other-companies"
        ? <OtherCompanies key={tile.key} tile={tile} dim={Boolean(active && active !== tile.key)} onMove={(event, title, lines) => show(event, title, lines, tile.key)} onClick={() => onSelect(tile)} />
        : <TileRect key={tile.key} tile={tile} dim={Boolean(active && active !== tile.key)} onMove={(event) => show(event, tile.label, tileLines(tile), tile.key)} onClick={() => onSelect(tile)} />)}
    </svg>}
    {hover && <div className="proto-tooltip pa-map-tooltip" style={{ left: Math.min(hover.x + 14, size.w - 220), top: hover.y + 14 }}><strong>{hover.title}</strong>{hover.lines.map((line) => <span key={line}>{line}</span>)}</div>}
  </div>;
}

function TileRect({ tile, dim, onMove, onClick }: { tile: Placed<Tile>; dim: boolean; onMove: (event: ReactMouseEvent) => void; onClick: () => void }): JSX.Element {
  const ink = tile.darkText ? "#100f0f" : "#fff";
  const showLabel = tile.w > 44 && tile.h > 34;
  const showSub = tile.w > 104 && tile.h > 70;
  return <g className="pa-tile" opacity={dim ? 0.3 : 1} onMouseMove={onMove} onClick={onClick}>
    <rect x={tile.x + 1} y={tile.y + 1} width={Math.max(0, tile.w - 2)} height={Math.max(0, tile.h - 2)} rx={4} fill={tile.fill} />
    {showLabel && <text x={tile.x + 8} y={tile.y + 19} fill={ink} className="pa-tile-label">{clip(tile.label, tile.w / 7.5)}</text>}
    {showLabel && <text x={tile.x + 8} y={tile.y + 34} fill={ink} className="pa-tile-value">{pct(tile.weight)}</text>}
    {showSub && <text x={tile.x + 8} y={tile.y + tile.h - 10} fill={ink} className="pa-tile-sub">{clip(tile.sub, tile.w / 6.2)}</text>}
  </g>;
}

function OtherCompanies({ tile, dim, onMove, onClick }: { tile: Placed<Tile>; dim: boolean; onMove: (event: ReactMouseEvent, title: string, lines: string[]) => void; onClick: () => void }): JSX.Element {
  const header = 22;
  const sectors = (tile.slice?.bySector ?? []).map((row) => ({ ...row, key: row.sector, valueAud: row.valueAud }));
  const placed = squarify(sectors, { x: tile.x + 3, y: tile.y + header, w: tile.w - 6, h: tile.h - header - 3 });
  return <g className="pa-tile" opacity={dim ? 0.3 : 1} onClick={onClick}>
    <rect x={tile.x + 1} y={tile.y + 1} width={Math.max(0, tile.w - 2)} height={Math.max(0, tile.h - 2)} rx={4} fill={GROUP_COLOR} onMouseMove={(event) => onMove(event, "Other companies", [`${tile.slice?.memberCount ?? 0} companies outside the top ${12}`, `${aud(tile.valueAud)} · ${pct(tile.weight)}`, "Split by sector below"])} />
    <text x={tile.x + 8} y={tile.y + 15} fill="#fff" className="pa-tile-label">{clip(`Other companies · ${tile.slice?.memberCount ?? ""} · ${pct(tile.weight)}`, tile.w / 7)}</text>
    {placed.map((row) => {
      const showLabel = row.w > 52 && row.h > 30;
      return <g key={row.key} onMouseMove={(event) => onMove(event, `Other companies · ${row.sector}`, [`${row.count} companies`, `${aud(row.valueAud)} · ${pct(row.weight)}`])}>
        <rect x={row.x + 1} y={row.y + 1} width={Math.max(0, row.w - 2)} height={Math.max(0, row.h - 2)} rx={3} fill={sectorColor(row.sector)} fillOpacity={0.38} />
        <rect x={row.x + 1} y={row.y + 1} width={Math.max(0, row.w - 2)} height={Math.max(0, row.h - 2)} rx={3} fill="#fffcf0" fillOpacity={0.35} />
        {showLabel && <text x={row.x + 7} y={row.y + 16} fill="#100f0f" className="pa-tile-sub pa-tile-strong">{clip(SECTOR_SHORT[row.sector] ?? row.sector, row.w / 6.5)}</text>}
        {showLabel && <text x={row.x + 7} y={row.y + 29} fill="#100f0f" className="pa-tile-sub">{pct(row.weight)}</text>}
      </g>;
    })}
  </g>;
}

function squarify<T extends { valueAud: number }>(items: T[], box: Box): Array<Placed<T>> {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.valueAud), 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const nodes = items.filter((item) => item.valueAud > 0).map((item) => ({ item, area: item.valueAud * scale })).sort((a, b) => b.area - a.area);
  const out: Array<Placed<T>> = [];
  let rect = { ...box };
  let row: typeof nodes = [];
  const worst = (candidate: typeof nodes, side: number) => {
    const sum = candidate.reduce((acc, node) => acc + node.area, 0);
    const max = Math.max(...candidate.map((node) => node.area));
    const min = Math.min(...candidate.map((node) => node.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const flush = () => {
    const sum = row.reduce((acc, node) => acc + node.area, 0);
    if (rect.w >= rect.h) {
      const width = sum / rect.h;
      let y = rect.y;
      for (const node of row) { const h = node.area / width; out.push({ ...node.item, x: rect.x, y, w: width, h }); y += h; }
      rect = { x: rect.x + width, y: rect.y, w: rect.w - width, h: rect.h };
    } else {
      const height = sum / rect.w;
      let x = rect.x;
      for (const node of row) { const w = node.area / height; out.push({ ...node.item, x, y: rect.y, w, h: height }); x += w; }
      rect = { x: rect.x, y: rect.y + height, w: rect.w, h: rect.h - height };
    }
    row = [];
  };
  for (const node of nodes) {
    const side = Math.min(rect.w, rect.h);
    if (row.length && worst([...row, node], side) > worst(row, side)) flush();
    row.push(node);
  }
  if (row.length) flush();
  return out;
}

export function HatchDefs(): JSX.Element {
  return <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><defs>
    <pattern id="proto-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="#e6e4d9" /><rect width="4" height="8" fill="#cecdc3" /></pattern>
  </defs></svg>;
}

function clip(value: string, max: number): string {
  const limit = Math.max(3, Math.floor(max));
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}