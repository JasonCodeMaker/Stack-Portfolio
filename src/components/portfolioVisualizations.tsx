import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { AnimatedToggleGroup, Card } from "@wealthfolio/ui";
import type { CompositionSlice, PlanRow } from "@/domain/composition";
import { layoutComposition, squarify, type Placed } from "@/domain/compositionLayout";
import { NOT_LOOKED_THROUGH, topNodesWithOther, type VisualizationNode } from "@/domain/visualization";
import type { AllocationRow, ExposureSource } from "@/types/domain";

const currency = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("en-AU", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : percentFormat.format(value));

export type CompositionMode = "look-through" | "purchased";
export type ExposureLens = "sectors" | "countries" | "assets" | "accounts" | "currencies";

// Chart colours are CSS variables (see styles.css) so light and dark themes each get a
// palette validated against their own card surface. Categorical slots are assigned in a
// fixed order; sectors always keep the same slot.
const category = (index: number) => `var(--pi-cat-${index + 1})`;
const DARK_INK_SLOT = category(3);
const OTHER = "var(--pi-other)";
const GROUP = "var(--pi-group)";
const CASH = "var(--pi-cash)";
const HATCH_FILL = "url(#pi-hatch)";
const HATCH_SWATCH = "var(--pi-hatch)";
const INK = "var(--foreground)";
export const DIRECT_COLOR = category(2);
export const VIA_FUNDS_COLOR = category(0);

const SECTOR_ORDER = ["Information Technology", "Financials", "Communication Services", "Consumer Discretionary", "Health Care", "Materials", "Industrials"];
const SECTOR_SHORT: Record<string, string> = {
  "Information Technology": "Tech", Financials: "Financials", "Communication Services": "Comms", "Consumer Discretionary": "Cons. disc.",
  "Health Care": "Health", Materials: "Materials", Industrials: "Industrials", "Consumer Staples": "Staples", Energy: "Energy",
  Utilities: "Utilities", "Real Estate": "Property",
};

export function sectorColor(sector: string | undefined): string {
  const index = sector ? SECTOR_ORDER.indexOf(sector) : -1;
  return index >= 0 ? category(index) : OTHER;
}

function inkOn(fill: string): string {
  return fill === DARK_INK_SLOT ? "#100f0f" : "#fff";
}

export interface CompositionTile {
  key: string;
  label: string;
  sub: string;
  valueAud: number;
  weight: number | null;
  fill: string;
  swatch: string;
  ink: string;
  slice?: CompositionSlice;
}

export function compositionTiles(mode: CompositionMode, slices: CompositionSlice[], allocation: AllocationRow[]): CompositionTile[] {
  if (mode === "purchased") {
    return allocation.map((row) => {
      const fill = row.type === "etf" ? category(2) : row.type === "stock" ? category(0) : row.type === "cash" ? CASH : OTHER;
      const sub = row.type === "etf" ? "ETF" : row.type === "stock" ? "Stock" : row.type === "cash" ? "Cash" : "Other";
      return { key: row.key, label: row.label, sub, valueAud: row.valueAud, weight: row.weight, fill, swatch: fill, ink: fill === CASH || fill === OTHER ? INK : inkOn(fill) };
    });
  }
  return slices.map((slice) => {
    const base = { key: slice.key, valueAud: slice.valueAud, weight: slice.weight, slice };
    if (slice.kind === "company") {
      const fill = sectorColor(slice.sector);
      return { ...base, label: slice.ticker ?? slice.label, sub: slice.label, fill, swatch: fill, ink: fill === OTHER ? INK : inkOn(fill) };
    }
    if (slice.kind === "other-companies") return { ...base, label: slice.label, sub: `${slice.memberCount} smaller companies`, fill: GROUP, swatch: GROUP, ink: "#fff" };
    if (slice.kind === "unresolved") return { ...base, label: slice.label, sub: fundSymbols(slice.sources).join(", "), fill: HATCH_FILL, swatch: HATCH_SWATCH, ink: INK };
    const fill = slice.kind === "cash" ? CASH : OTHER;
    return { ...base, label: slice.label, sub: "Held directly and inside funds", fill, swatch: fill, ink: INK };
  });
}

/** Funds a slice comes from, largest first. */
export function fundSymbols(sources: ExposureSource[]): string[] {
  const totals = new Map<string, number>();
  for (const source of sources) if (source.kind !== "direct") totals.set(source.etfSymbol, (totals.get(source.etfSymbol) ?? 0) + source.amountAud);
  return [...totals].sort((a, b) => b[1] - a[1]).map(([symbol]) => symbol);
}

export interface ExposureSegment {
  key: string;
  label: string;
  valueAud: number;
  weight: number | null;
  directAud: number;
  viaEtfsAud: number;
  swatch: string;
  ink: string;
}

export function exposureSegments(lens: ExposureLens, nodes: VisualizationNode[]): ExposureSegment[] {
  return topNodesWithOther(nodes, 6).map((node, index) => {
    const swatch = node.label === "Cash" ? CASH
      : node.label === NOT_LOOKED_THROUGH ? HATCH_SWATCH
        : node.label === "Other" || node.label === "Unclassified" ? OTHER
          : lens === "sectors" ? sectorColor(node.label)
            : category(index);
    const neutral = swatch === CASH || swatch === HATCH_SWATCH || swatch === OTHER;
    return { key: node.key, label: node.label, valueAud: node.valueAud, weight: node.weight, directAud: node.directAud, viaEtfsAud: node.viaEtfsAud, swatch, ink: neutral ? INK : inkOn(swatch) };
  });
}

export function CompositionCard({ slices, allocation, otherCompaniesLimit, onSelect }: {
  slices: CompositionSlice[];
  allocation: AllocationRow[];
  otherCompaniesLimit: number;
  onSelect: (slice: CompositionSlice) => void;
}): JSX.Element {
  const [mode, setMode] = useState<CompositionMode>("look-through");
  const [active, setActive] = useState<string | null>(null);
  const tiles = compositionTiles(mode, slices, allocation);
  const select = (tile: CompositionTile) => { if (tile.slice) onSelect(tile.slice); };
  return <Card className="pi-card pi-composition">
    <CardHead
      title="Portfolio composition"
      detail={mode === "look-through" ? "Funds are opened up and merged with the shares you hold directly. Area = share of portfolio." : "The holdings you actually bought. Area = share of portfolio."}
      action={<AnimatedToggleGroup<CompositionMode> size="sm" value={mode} onValueChange={setMode} items={[{ value: "look-through", label: "Look-through" }, { value: "purchased", label: "As purchased" }]} />}
    />
    {tiles.length === 0 ? <div className="pi-visual-empty">No valued holdings to chart.</div> : <div className="pi-composition-body">
      <CompositionMap tiles={tiles} active={active} otherCompaniesLimit={otherCompaniesLimit} onHover={setActive} onSelect={select} />
      <ol className="pi-composition-legend">
        {tiles.map((tile) => <li key={tile.key} className={active && active !== tile.key ? "is-dim" : ""} onMouseEnter={() => setActive(tile.key)} onMouseLeave={() => setActive(null)}>
          <button type="button" onClick={() => select(tile)} disabled={!tile.slice}>
            <i style={{ background: tile.swatch }} />
            <span><strong>{tile.label}</strong><small>{tile.sub}</small></span>
            <b>{percent(tile.weight)}</b>
          </button>
        </li>)}
        <li className="pi-composition-total"><span>Total</span><b>{percent(tiles.reduce((sum, tile) => sum + (tile.weight ?? 0), 0))}</b></li>
      </ol>
    </div>}
    <footer className="pi-composition-key">
      {mode === "look-through"
        ? <>{SECTOR_ORDER.map((sector) => <Key key={sector} color={sectorColor(sector)} label={sector} />)}<Key color={OTHER} label="Other sectors" /><Key color={GROUP} label="Other companies" /><Key color={CASH} label="Cash" /><Key color={HATCH_SWATCH} label={NOT_LOOKED_THROUGH} /></>
        : <><Key color={category(2)} label="ETF" /><Key color={category(0)} label="Stock" /><Key color={CASH} label="Cash" /></>}
    </footer>
    <HatchPattern />
  </Card>;
}

function Key({ color, label }: { color: string; label: string }): JSX.Element {
  return <span><i style={{ background: color }} />{label}</span>;
}

export function CardHead({ title, detail, action }: { title: string; detail: ReactNode; action?: ReactNode }): JSX.Element {
  return <div className="pi-card-head"><div><h2>{title}</h2><p>{detail}</p></div>{action}</div>;
}

interface Hover {
  title: string;
  lines: string[];
  x: number;
  y: number;
}

function CompositionMap({ tiles, active, otherCompaniesLimit, onHover, onSelect }: {
  tiles: CompositionTile[];
  active: string | null;
  otherCompaniesLimit: number;
  onHover: (key: string | null) => void;
  onSelect: (tile: CompositionTile) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const named = tiles.filter((tile) => !tile.slice || tile.slice.kind === "company");
  const rest = tiles.filter((tile) => tile.slice && tile.slice.kind !== "company");
  const layout = layoutComposition(named, rest, { x: 0, y: 0, w: size.w, h: size.h });
  const show = (event: ReactMouseEvent, key: string, title: string, lines: string[]) => {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return;
    onHover(key);
    setHover({ title, lines, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  const hide = () => { onHover(null); setHover(null); };
  const linesFor = (tile: CompositionTile) => [tile.sub, `${currency.format(tile.valueAud)} · ${percent(tile.weight)}`, ...(tile.slice && tile.slice.viaEtfsAud > 0 && tile.slice.kind === "company" ? [`Direct ${currency.format(tile.slice.directAud)} · Via funds ${currency.format(tile.slice.viaEtfsAud)}`] : [])];

  return <div ref={ref} className="pi-composition-map" role="img" aria-label="Portfolio composition map" onMouseLeave={hide}>
    {size.w > 0 && <svg width={size.w} height={size.h}>
      {[...layout.named, ...layout.rest].map((tile) => tile.slice?.kind === "other-companies"
        ? <OtherCompaniesTile key={tile.key} tile={tile} dim={Boolean(active && active !== tile.key)} limit={otherCompaniesLimit} onMove={(event, title, lines) => show(event, tile.key, title, lines)} onClick={() => onSelect(tile)} />
        : <Tile key={tile.key} tile={tile} dim={Boolean(active && active !== tile.key)} onMove={(event) => show(event, tile.key, tile.label, linesFor(tile))} onClick={() => onSelect(tile)} />)}
    </svg>}
    {hover && <div className="pi-chart-tooltip pi-composition-tooltip" style={{ left: Math.max(0, Math.min(hover.x + 14, size.w - 220)), top: hover.y + 14 }}><strong>{hover.title}</strong>{hover.lines.map((line) => <span key={line}>{line}</span>)}</div>}
  </div>;
}

function Tile({ tile, dim, onMove, onClick }: { tile: Placed<CompositionTile>; dim: boolean; onMove: (event: ReactMouseEvent) => void; onClick: () => void }): JSX.Element {
  const showLabel = tile.w > 44 && tile.h > 34;
  const showSub = tile.w > 104 && tile.h > 70;
  return <g className="pi-tile" opacity={dim ? 0.3 : 1} onMouseMove={onMove} onClick={onClick}>
    <rect x={tile.x + 1} y={tile.y + 1} width={Math.max(0, tile.w - 2)} height={Math.max(0, tile.h - 2)} rx={4} style={{ fill: tile.fill }} />
    {showLabel && <text x={tile.x + 8} y={tile.y + 19} className="pi-tile-label" style={{ fill: tile.ink }}>{clip(tile.label, tile.w / 7.5)}</text>}
    {showLabel && <text x={tile.x + 8} y={tile.y + 34} className="pi-tile-value" style={{ fill: tile.ink }}>{percent(tile.weight)}</text>}
    {showSub && <text x={tile.x + 8} y={tile.y + tile.h - 10} className="pi-tile-sub" style={{ fill: tile.ink }}>{clip(tile.sub, tile.w / 6.2)}</text>}
  </g>;
}

function OtherCompaniesTile({ tile, dim, limit, onMove, onClick }: { tile: Placed<CompositionTile>; dim: boolean; limit: number; onMove: (event: ReactMouseEvent, title: string, lines: string[]) => void; onClick: () => void }): JSX.Element {
  const header = 22;
  const slice = tile.slice;
  const sectors = squarify(slice?.bySector ?? [], { x: tile.x + 3, y: tile.y + header, w: tile.w - 6, h: tile.h - header - 3 });
  const summary = [`${slice?.memberCount ?? 0} companies outside the top ${limit}`, `${currency.format(tile.valueAud)} · ${percent(tile.weight)}`];
  return <g className="pi-tile" opacity={dim ? 0.3 : 1} onClick={onClick}>
    <rect x={tile.x + 1} y={tile.y + 1} width={Math.max(0, tile.w - 2)} height={Math.max(0, tile.h - 2)} rx={4} style={{ fill: GROUP }} onMouseMove={(event) => onMove(event, "Other companies", summary)} />
    {tile.w > 60 && <text x={tile.x + 8} y={tile.y + 15} className="pi-tile-label" style={{ fill: "#fff" }}>{clip(`Other companies · ${slice?.memberCount ?? ""} · ${percent(tile.weight)}`, tile.w / 7)}</text>}
    {sectors.map((sector) => {
      const showLabel = sector.w > 52 && sector.h > 30;
      const box = { x: sector.x + 1, y: sector.y + 1, width: Math.max(0, sector.w - 2), height: Math.max(0, sector.h - 2), rx: 3 };
      return <g key={sector.sector} onMouseMove={(event) => onMove(event, `Other companies · ${sector.sector}`, [`${sector.count} companies`, `${currency.format(sector.valueAud)} · ${percent(sector.weight)}`])}>
        <rect {...box} style={{ fill: "var(--card)" }} />
        <rect {...box} style={{ fill: sectorColor(sector.sector), fillOpacity: 0.3 }} />
        {showLabel && <text x={sector.x + 7} y={sector.y + 16} className="pi-tile-sub pi-tile-strong" style={{ fill: INK }}>{clip(SECTOR_SHORT[sector.sector] ?? sector.sector, sector.w / 6.5)}</text>}
        {showLabel && <text x={sector.x + 7} y={sector.y + 29} className="pi-tile-sub" style={{ fill: INK }}>{percent(sector.weight)}</text>}
      </g>;
    })}
  </g>;
}

function HatchPattern(): JSX.Element {
  return <svg width="0" height="0" className="pi-defs" aria-hidden="true"><defs>
    <pattern id="pi-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <rect width="8" height="8" style={{ fill: "var(--pi-hatch-b)" }} />
      <rect width="4" height="8" style={{ fill: "var(--pi-hatch-a)" }} />
    </pattern>
  </defs></svg>;
}

export interface ExposureRowData {
  lens: ExposureLens;
  label: string;
  note: string;
  nodes: VisualizationNode[];
}

export function ExposureCard({ rows }: { rows: ExposureRowData[] }): JSX.Element {
  const [open, setOpen] = useState<ExposureLens | null>(null);
  return <Card className="pi-card">
    <CardHead title="Where it's exposed" detail="Every bar is 100% of your portfolio. Click one to see its numbers." />
    {rows.map((row) => {
      const segments = exposureSegments(row.lens, row.nodes);
      const isOpen = open === row.lens;
      const lead = segments[0];
      return <div key={row.lens} className={`pi-exposure-row ${isOpen ? "is-open" : ""}`}>
        <button type="button" className="pi-exposure-head" onClick={() => setOpen(isOpen ? null : row.lens)} aria-expanded={isOpen}>
          <span className="pi-exposure-label"><strong>{row.label}</strong><small>{row.note}</small></span>
          <span className="pi-exposure-bar">{segments.map((segment) => <span key={segment.key} title={`${segment.label} ${percent(segment.weight)}`} style={{ flexGrow: segment.valueAud, background: segment.swatch, color: segment.ink }}>{(segment.weight ?? 0) >= 0.07 ? `${segment.label} ${percent(segment.weight)}` : ""}</span>)}</span>
          <span className="pi-exposure-lead">{lead ? <>{lead.label} <b>{percent(lead.weight)}</b></> : "—"}</span>
          <span className="pi-exposure-chevron" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen && <div className="pi-exposure-body">
          {segments.map((segment) => <div key={segment.key} className="pi-exposure-item">
            <i style={{ background: segment.swatch }} />
            <span><strong>{segment.label}</strong><small>{segment.viaEtfsAud > 0 ? `${currency.format(segment.directAud)} direct · ${currency.format(segment.viaEtfsAud)} via funds` : ""}</small></span>
            <b>{percent(segment.weight)}</b>
            <em>{currency.format(segment.valueAud)}</em>
          </div>)}
        </div>}
      </div>;
    })}
  </Card>;
}

export function TargetDots({ rows, tolerance }: { rows: PlanRow[]; tolerance: number }): JSX.Element {
  const scale = Math.max(...rows.map((row) => Math.max(row.weight ?? 0, (row.targetWeight ?? 0) + tolerance)), 0.05) * 1.08;
  const at = (value: number) => `${(Math.max(0, Math.min(scale, value)) / scale) * 100}%`;
  const span = (from: number, to: number) => ({ left: at(Math.min(from, to)), width: `calc(${at(Math.max(from, to))} - ${at(Math.min(from, to))})` });
  const ticks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].filter((tick) => tick <= scale);
  return <div className="pi-dots">
    <div className="pi-dots-axis" aria-hidden="true"><span /><span className="pi-dots-ticks">{ticks.map((tick) => <em key={tick} style={{ left: at(tick) }}>{Math.round(tick * 100)}%</em>)}</span><span /><span /></div>
    {rows.map((row) => {
      const target = row.targetWeight ?? 0;
      const current = row.weight ?? 0;
      return <div key={row.key} className="pi-dot-row">
        <span className="pi-dot-label"><strong>{row.label}</strong>{row.children.length > 0 && <small>{row.children.map((child) => child.label).join(" · ")}</small>}</span>
        <span className="pi-dot-track" role="img" aria-label={`${row.label}: ${percent(row.weight)} now, target ${percent(row.targetWeight)}`}>
          <span className="pi-dot-band" style={span(target - tolerance, target + tolerance)} />
          <span className="pi-dot-target" style={{ left: at(target) }} />
          <span className="pi-dot-link" style={span(target, current)} />
          <span className={`pi-dot pi-${row.status}`} style={{ left: at(current) }} />
        </span>
        <span className="pi-dot-nums">{percent(row.weight)} <small>vs {percent(row.targetWeight)}</small></span>
        <span className={`pi-dot-action pi-${row.status}`}>{moveLabel(row)}</span>
      </div>;
    })}
  </div>;
}

export function moveLabel(row: PlanRow): string {
  const amount = currency.format(Math.abs(row.adjustmentAud ?? 0));
  if (row.status === "overweight") return `Trim ${amount}`;
  if (row.status === "underweight") return `Add ${amount}`;
  if (row.drift === null) return "—";
  return `${row.drift > 0 ? "+" : row.drift < 0 ? "−" : ""}${percentFormat.format(Math.abs(row.drift))} · ok`;
}

function clip(value: string, max: number): string {
  const limit = Math.max(3, Math.floor(max));
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
