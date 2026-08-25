import type { ReactNode } from "react";
import type { AllocationRow, ExposureRow, PortfolioWarning } from "@/types/domain";

export function formatAud(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Incomplete";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(value);
}

export function formatNative(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 6 }).format(value);
}

export function StatusBadge({ value, tone }: { value: string; tone?: "neutral" | "good" | "warning" | "critical" }): JSX.Element {
  return <span className={`status-badge status-${tone ?? value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</span>;
}

export function MetricCard({ label, value, detail, icon, tone }: { label: string; value: string; detail?: string; icon: string; tone?: string }): JSX.Element {
  return <div className={`metric-card ${tone ? `metric-${tone}` : ""}`}>
    <div className="metric-card-top"><span className="metric-icon">{icon}</span><span className="eyebrow">{label}</span></div>
    <div className="metric-value">{value}</div>
    {detail && <div className="metric-detail">{detail}</div>}
  </div>;
}

export function WarningList({ warnings }: { warnings: PortfolioWarning[] }): JSX.Element | null {
  if (!warnings.length) return null;
  return <div className="warning-stack">
    {warnings.map((warning) => <div className={`warning-card warning-${warning.severity}`} key={warning.id}>
      <div className="warning-mark">{warning.severity === "critical" ? "!" : "i"}</div>
      <div><strong>{warning.title}</strong><p>{warning.detail}</p></div>
    </div>)}
  </div>;
}

interface ChartRow {
  key: string;
  label: string;
  value: number;
  weight: number | null;
  color?: string;
  meta?: string;
}

const chartColors = ["#65d6a7", "#7ca7ff", "#f8c86b", "#e18cff", "#ff927d", "#62d3e8", "#a9b7c9"];

export function AllocationChart({ title, subtitle, rows, valueLabel = "Value" }: { title: string; subtitle: string; rows: ChartRow[]; valueLabel?: string }): JSX.Element {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return <div className="panel chart-panel">
    <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="chart-note">Top 10</span></div>
    {rows.length === 0 ? <div className="empty-chart">No valued holdings yet.</div> : <div className="chart-list">
      {rows.map((row, index) => <div className="chart-row" key={row.key}>
        <div className="chart-row-head"><span className="legend-dot" style={{ background: row.color ?? chartColors[index % chartColors.length] }} /> <span className="chart-label">{row.label}</span><span className="chart-value">{row.weight === null ? "—" : `${(row.weight * 100).toFixed(1)}%`}</span></div>
        <div className="chart-track"><span style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: row.color ?? chartColors[index % chartColors.length] }} /></div>
        <div className="chart-meta"><span>{valueLabel}</span><strong>{formatAud(row.value)}</strong>{row.meta && <span>{row.meta}</span>}</div>
      </div>)}
    </div>}
  </div>;
}

export function SectionHeader({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }): JSX.Element {
  return <div className="section-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action}</div>;
}

export function EmptyState({ icon, title, detail, action }: { icon: string; title: string; detail: string; action?: ReactNode }): JSX.Element {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{detail}</p>{action}</div>;
}

export function Button({ children, onClick, variant = "secondary", disabled = false, type = "button" }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "quiet" | "danger"; disabled?: boolean; type?: "button" | "submit" }): JSX.Element {
  return <button className={`button button-${variant}`} onClick={onClick} disabled={disabled} type={type}>{children}</button>;
}

export function TableShell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="table-shell"><table>{children}</table></div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }): JSX.Element {
  return <label className="toggle-row">{label && <span>{label}</span>}<button type="button" className={`toggle ${checked ? "toggle-on" : ""}`} aria-pressed={checked} onClick={() => onChange(!checked)}><span /></button></label>;
}

export function topAllocationRows(rows: AllocationRow[], limit = 10): ChartRow[] {
  if (rows.length <= limit) return rows.map((row) => ({ key: row.key, label: row.label, value: row.valueAud, weight: row.weight, meta: row.type }));
  const visible = rows.slice(0, limit);
  const other = rows.slice(limit);
  return [
    ...visible.map((row) => ({ key: row.key, label: row.label, value: row.valueAud, weight: row.weight, meta: row.type })),
    { key: "other", label: "Other", value: other.reduce((sum, row) => sum + row.valueAud, 0), weight: other.every((row) => row.weight !== null) ? other.reduce((sum, row) => sum + (row.weight ?? 0), 0) : null, meta: "View-only aggregation" },
  ];
}

export function topExposureRows(rows: ExposureRow[], limit = 10): ChartRow[] {
  if (rows.length <= limit) return rows.map((row) => ({ key: row.key, label: row.label, value: row.totalAud, weight: row.portfolioWeight, meta: row.type }));
  const visible = rows.slice(0, limit);
  const other = rows.slice(limit);
  return [
    ...visible.map((row) => ({ key: row.key, label: row.label, value: row.totalAud, weight: row.portfolioWeight, meta: row.type })),
    { key: "other", label: "Other", value: other.reduce((sum, row) => sum + row.totalAud, 0), weight: other.every((row) => row.portfolioWeight !== null) ? other.reduce((sum, row) => sum + (row.portfolioWeight ?? 0), 0) : null, meta: "View-only aggregation" },
  ];
}
