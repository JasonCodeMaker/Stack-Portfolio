import { Button, EmptyState, SectionHeader, StatusBadge, TableShell, formatAud, formatPercent } from "@/components/ui";
import type { ExposureModel, ExposureRow, ExposureSource } from "@/types/domain";
import { useState } from "react";

export function XRayPage({ exposure, hasHoldings, onGoToSettings }: { exposure: ExposureModel; hasHoldings: boolean; onGoToSettings: () => void }): JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = exposure.rows.find((row) => row.key === selectedKey) ?? null;
  return <div className="page-stack">
    <SectionHeader eyebrow="Economic exposure" title="X-Ray" detail="Direct holdings and ETF-derived exposure are consolidated into one canonical view." action={<div className="coverage-pill"><span>Coverage</span><strong>{formatPercent(exposure.coverage)}</strong></div>} />
    {!hasHoldings ? <EmptyState icon="⌁" title="Nothing to X-Ray yet" detail="Add holdings to the selected Wealthfolio accounts, then return here." action={<Button onClick={onGoToSettings} variant="primary">Choose accounts</Button>} /> : exposure.rows.length === 0 ? <EmptyState icon="⌁" title="Exposure is incomplete" detail="No holding has a usable AUD value yet. Native values remain available on Holdings." /> : <>
      <div className="xray-summary"><div><span className="eyebrow">Resolved value</span><strong>{formatAud(exposure.coveredValueAud)}</strong><span>of {formatAud(exposure.eligibleValueAud)} eligible investable value</span></div><div><span className="eyebrow">Reconciliation</span><strong className={Math.abs(exposure.valueConservationDelta) < 0.5 ? "text-green" : "text-warning"}>{Math.abs(exposure.valueConservationDelta) < 0.5 ? "Balanced" : formatAud(Math.abs(exposure.valueConservationDelta))}</strong><span>including cash, residuals, and opaque ETFs</span></div></div>
      <div className="panel table-panel">
        <div className="table-toolbar"><div><strong>{exposure.rows.length} canonical exposure{exposure.rows.length === 1 ? "" : "s"}</strong><span>Sources opens account- and ETF-level contributions.</span></div><span className="table-toolbar-note">Cash is excluded from Coverage</span></div>
        <TableShell><thead><tr><th>Ticker / bucket</th><th>Security / bucket</th><th className="numeric">Direct</th><th className="numeric">Via ETFs</th><th className="numeric">Total exposure</th><th className="numeric">Portfolio %</th><th>Sources</th><th>Sector</th><th>Country</th><th>Status</th></tr></thead><tbody>
          {exposure.rows.map((row) => <XRayRow key={row.key} row={row} selected={row.key === selectedKey} onSelect={() => setSelectedKey(row.key === selectedKey ? null : row.key)} />)}
        </tbody></TableShell>
      </div>
      {selected && <SourceDrawer row={selected} onClose={() => setSelectedKey(null)} />}
    </>}
  </div>;
}

function XRayRow({ row, selected, onSelect }: { row: ExposureRow; selected: boolean; onSelect: () => void }): JSX.Element {
  const sourceTone = row.sources.some((source) => source.kind === "opaque" || source.kind === "residual") ? "warning" : "good";
  return <tr className={selected ? "row-selected" : ""}>
    <td><strong className="ticker-cell">{row.ticker ?? "—"}</strong></td>
    <td><span className="name-cell">{row.label}</span></td>
    <td className="numeric">{row.directAud ? formatAud(row.directAud) : "—"}</td>
    <td className="numeric">{row.viaEtfsAud ? formatAud(row.viaEtfsAud) : "—"}</td>
    <td className="numeric value-strong">{formatAud(row.totalAud)}</td>
    <td className="numeric">{formatPercent(row.portfolioWeight)}</td>
    <td><button className="source-button" onClick={onSelect}><span className="source-count">{row.sources.length}</span> View Sources</button></td>
    <td>{row.sector ?? "—"}</td><td>{row.country ?? "—"}</td>
    <td><StatusBadge value={row.status ?? (row.type === "cash" ? "Cash" : "Resolved")} tone={row.status ? sourceTone : "good"} /></td>
  </tr>;
}

function SourceDrawer({ row, onClose }: { row: ExposureRow; onClose: () => void }): JSX.Element {
  const direct = row.sources.filter((source): source is Extract<ExposureSource, { kind: "direct" }> => source.kind === "direct");
  const viaEtfs = row.sources.filter((source): source is Extract<ExposureSource, { kind: "etf" }> => source.kind === "etf");
  const residual = row.sources.filter((source): source is Extract<ExposureSource, { kind: "residual" | "opaque" }> => source.kind === "residual" || source.kind === "opaque");
  return <div className="source-drawer panel"><div className="drawer-head"><div><span className="eyebrow">Exposure sources</span><h2>{row.label}</h2><strong>{formatAud(row.totalAud)}</strong></div><Button onClick={onClose} variant="quiet">Close</Button></div>
    <div className="source-columns"><SourceGroup title="Direct" sources={direct.map((source) => ({ label: source.accountName, amountAud: source.amountAud }))} /><SourceGroup title="Via ETFs" sources={viaEtfs.map((source) => ({ label: `${source.etfSymbol}${source.path.length > 1 ? ` · ${source.path.join(" → ")}` : ""}`, amountAud: source.amountAud }))} /><SourceGroup title="Residual / opaque" sources={residual.map((source) => ({ label: source.reason, amountAud: source.amountAud }))} /></div>
  </div>;
}

function SourceGroup({ title, sources }: { title: string; sources: Array<{ label: string; amountAud: number }> }): JSX.Element {
  return <div className="source-group"><span className="eyebrow">{title}</span>{sources.length === 0 ? <p className="muted">None</p> : sources.map((source, index) => <div className="source-line" key={`${source.label}-${index}`}><span>{source.label}</span><strong>{formatAud(source.amountAud)}</strong></div>)}</div>;
}
