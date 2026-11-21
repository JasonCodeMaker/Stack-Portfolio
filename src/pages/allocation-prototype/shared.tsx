// PROTOTYPE — data derivation, formatting and palette shared by the layout variants.
// Layout lives in each variant; only non-visual plumbing belongs here.
import { useMemo } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@wealthfolio/ui";
import { buildRebalanceModel } from "@/domain/rebalance";
import { buildBreakdownNodes, buildCoreSatelliteAllocation, type BreakdownLens, type VisualizationNode } from "@/domain/visualization";
import { allCompanies, buildComposition, buildDimension, buildPlanRows, type CompositionSlice } from "./composition";
import type { EtfDataRow, ExposureModel, PortfolioAccount, PortfolioModel, RebalanceSettings } from "@/types/domain";

export interface AllocationPageProps {
  portfolio: PortfolioModel;
  exposure: ExposureModel;
  expandedExposure: ExposureModel;
  activeAccounts: PortfolioAccount[];
  selectedAccounts: PortfolioAccount[];
  etfData: EtfDataRow[];
  rebalanceSettings: RebalanceSettings;
  onSaveRebalance: (settings: RebalanceSettings) => Promise<void>;
  onSaveAccountSelection: (accountIds: string[]) => Promise<void>;
  onRefresh: () => Promise<void>;
  onRefreshEtf: (etfKey: string) => Promise<void>;
}

export type Lens = Exclude<BreakdownLens, "holdings">;

export const LENSES: Array<{ key: Lens; label: string; lookThrough: boolean }> = [
  { key: "sectors", label: "Sectors", lookThrough: true },
  { key: "countries", label: "Countries", lookThrough: true },
  { key: "assets", label: "Asset classes", lookThrough: true },
  { key: "accounts", label: "Accounts", lookThrough: false },
  { key: "currencies", label: "Currency", lookThrough: false },
];

export function usePrototypeModel(props: AllocationPageProps) {
  return useMemo(() => {
    const { portfolio, exposure } = props;
    const total = portfolio.totalAud;
    const composition = buildComposition(exposure, 12);
    const companies = allCompanies(exposure);
    const coreSatellite = buildCoreSatelliteAllocation(portfolio.instrumentAllocation, total);
    const rebalance = buildRebalanceModel(coreSatellite, total, props.rebalanceSettings);
    const plan = buildPlanRows(rebalance, portfolio.instrumentAllocation);
    const moves = plan
      .filter((row) => row.status === "overweight" || row.status === "underweight")
      .sort((a, b) => Math.abs(b.adjustmentAud ?? 0) - Math.abs(a.adjustmentAud ?? 0));
    const dimensions = Object.fromEntries(LENSES.map((lens) => [lens.key, lens.key === "sectors" || lens.key === "countries" || lens.key === "assets"
      ? buildDimension(lens.key, exposure)
      : buildBreakdownNodes(lens.key, portfolio.instrumentAllocation, portfolio.holdings, exposure, total)])) as Record<Lens, VisualizationNode[]>;
    const cashAud = portfolio.instrumentAllocation.filter((row) => row.type === "cash").reduce((sum, row) => sum + row.valueAud, 0);
    const unresolved = props.etfData.filter((row) => row.status !== "Fresh");
    const unresolvedAud = composition.find((row) => row.kind === "unresolved")?.valueAud ?? 0;
    const topCompanies = composition.filter((row) => row.kind === "company");
    const concentration = {
      top1: companies[0]?.weight ?? null,
      top5: sumWeights(companies.slice(0, 5)),
      top10: sumWeights(companies.slice(0, 10)),
    };
    return {
      total,
      investedAud: total === null ? null : total - cashAud,
      cashAud,
      coverage: exposure.coverage,
      composition,
      companies,
      topCompanies,
      otherCompanies: composition.find((row) => row.kind === "other-companies") ?? null,
      rebalance,
      plan,
      moves,
      dimensions,
      unresolved,
      unresolvedAud,
      concentration,
      holdingCount: portfolio.instrumentAllocation.length,
    };
  }, [props]);
}

export type PrototypeModel = ReturnType<typeof usePrototypeModel>;

function sumWeights(rows: CompositionSlice[]): number | null {
  return rows.every((row) => row.weight !== null) ? rows.reduce((sum, row) => sum + (row.weight ?? 0), 0) : null;
}

const audFormat = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const pctFormat = new Intl.NumberFormat("en-AU", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const aud = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : audFormat.format(value));
export const pct = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : pctFormat.format(value));
export const signedPct = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${pctFormat.format(Math.abs(value))}`);

// Categorical order validated with the dataviz checker against the Wealthfolio card surface
// (lightness band, chroma floor, CVD and normal-vision separation all pass). Drawn from the
// host's Flexoki ramps so it sits with the rest of the app.
export const CATEGORICAL = ["#1c9a8e", "#da702c", "#205ea6", "#be9207", "#8b7ec8", "#66800b", "#ce5d97"] as const;
export const OTHER_COLOR = "#b1aa9a";
export const GROUP_COLOR = "#878580";
export const CASH_COLOR = "#dad8ce";
export const HATCH = "repeating-linear-gradient(135deg, #cecdc3 0 4px, #e6e4d9 4px 8px)";

const SECTOR_ORDER = ["Information Technology", "Financials", "Communication Services", "Consumer Discretionary", "Health Care", "Materials", "Industrials"];

export function sectorColor(sector: string | undefined): string {
  const index = sector ? SECTOR_ORDER.indexOf(sector) : -1;
  return index >= 0 ? CATEGORICAL[index] : OTHER_COLOR;
}

export function sectorLegend(): Array<{ label: string; color: string }> {
  return [...SECTOR_ORDER.map((label) => ({ label, color: sectorColor(label) })), { label: "Other sectors", color: OTHER_COLOR }];
}

/** Colour for a composition slice: companies by sector, buckets by kind. */
export function sliceFill(slice: CompositionSlice): string {
  if (slice.kind === "company") return sectorColor(slice.sector);
  if (slice.kind === "other-companies") return GROUP_COLOR;
  if (slice.kind === "cash") return CASH_COLOR;
  return OTHER_COLOR;
}

export function sliceBackground(slice: CompositionSlice): string {
  return slice.kind === "unresolved" ? HATCH : sliceFill(slice);
}

/** Colour for a breakdown category. Sectors keep their fixed colour everywhere. */
export function categoryColor(lens: Lens, label: string, index: number): string {
  if (label === "Cash") return CASH_COLOR;
  if (label === "Unclassified" || label === "Not looked through" || label === "Other") return OTHER_COLOR;
  if (lens === "sectors") return sectorColor(label);
  return CATEGORICAL[index] ?? OTHER_COLOR;
}

export function categoryBackground(lens: Lens, label: string, index: number): string {
  return label === "Not looked through" ? HATCH : categoryColor(lens, label, index);
}

/** Dark or light label ink for text drawn on a fill. */
export function inkFor(fill: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!match) return "#100f0f";
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? "#100f0f" : "#fff";
}

export function foldCategories(nodes: VisualizationNode[], limit: number): VisualizationNode[] {
  if (nodes.length <= limit + 1) return nodes;
  const rest = nodes.slice(limit);
  return [...nodes.slice(0, limit), {
    key: "fold:other",
    label: "Other",
    valueAud: rest.reduce((sum, row) => sum + row.valueAud, 0),
    weight: rest.every((row) => row.weight !== null) ? rest.reduce((sum, row) => sum + (row.weight ?? 0), 0) : null,
    directAud: rest.reduce((sum, row) => sum + row.directAud, 0),
    viaEtfsAud: rest.reduce((sum, row) => sum + row.viaEtfsAud, 0),
  }];
}

export function accountLabel(accounts: PortfolioAccount[]): string {
  if (accounts.length === 0) return "No accounts";
  if (accounts.length === 1) return accounts[0].name;
  return `${accounts.length} accounts`;
}

export function sliceSubtitle(slice: CompositionSlice): string {
  if (slice.kind === "other-companies") return `${slice.memberCount} smaller companies`;
  if (slice.kind === "unresolved") return slice.viaFunds.map((fund) => fund.label).join(", ") || "Funds without holdings data";
  if (slice.kind === "cash") return "Held directly and inside funds";
  return slice.ticker ? `${slice.ticker} · ${slice.sector ?? "Unclassified"}` : slice.sector ?? "";
}

/** Plain-language list of where a slice comes from, e.g. "direct + IVV, NDQ". */
export function sourceSummary(slice: CompositionSlice): string {
  const parts: string[] = [];
  if (slice.directAud > 0) parts.push("direct");
  if (slice.viaFunds.length) parts.push(slice.viaFunds.slice(0, 3).map((fund) => fund.label).join(", "));
  return parts.join(" + ");
}

export function SourcesSheet({ slice, etfData, onClose }: { slice: CompositionSlice | null; etfData: EtfDataRow[]; onClose: () => void }): JSX.Element | null {
  if (!slice) return null;
  const reasons = slice.kind === "unresolved"
    ? slice.viaFunds.map((fund) => ({ fund: fund.label, reason: etfData.find((row) => row.asset.symbol === fund.label)?.failureReason ?? "No holdings data" }))
    : [];
  return <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="pi-sheet proto-sheet">
      <SheetHeader>
        <SheetTitle>{slice.label}{slice.ticker && slice.kind === "company" ? <span className="proto-sheet-ticker">{slice.ticker}</span> : null}</SheetTitle>
        <SheetDescription>{aud(slice.valueAud)} · {pct(slice.weight)} of portfolio{slice.kind === "other-companies" ? ` · ${slice.memberCount} companies` : ""}</SheetDescription>
      </SheetHeader>
      <div className="proto-sheet-body">
        {slice.direct.length > 0 && <section><h3>Held directly</h3>{slice.direct.map((row) => <div key={row.label}><span>{row.label}</span><strong>{aud(row.amountAud)}</strong></div>)}</section>}
        {slice.viaFunds.length > 0 && slice.kind !== "unresolved" && <section><h3>Through funds</h3>{slice.viaFunds.map((row) => <div key={row.label}><span>{row.label}</span><strong>{aud(row.amountAud)}</strong></div>)}</section>}
        {reasons.length > 0 && <section><h3>Why it can't be looked through</h3>{reasons.map((row) => <div key={row.fund} className="proto-sheet-reason"><span><strong>{row.fund}</strong><small>{row.reason}</small></span></div>)}</section>}
      </div>
    </SheetContent>
  </Sheet>;
}
