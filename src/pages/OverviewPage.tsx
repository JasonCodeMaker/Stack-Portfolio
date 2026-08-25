import type { AddonContext } from "@wealthfolio/addon-sdk";
import { formatRelativeAge, getQuoteFreshness } from "@/domain/currency";
import { topExposureRows, topAllocationRows, AllocationChart, Button, EmptyState, MetricCard, SectionHeader, StatusBadge, WarningList, formatAud, formatPercent } from "@/components/ui";
import type { EtfDataRow, FxQuote, PortfolioAccount, PortfolioModel, ExposureModel } from "@/types/domain";

export function OverviewPage({
  ctx,
  portfolio,
  exposure,
  fxQuote,
  etfData,
  baseCurrency,
  selectedAccounts,
  newlyIncludedAccounts,
  onNavigatePerformance,
  onRefreshFx,
  onGoToSettings,
}: {
  ctx: AddonContext;
  portfolio: PortfolioModel;
  exposure: ExposureModel;
  fxQuote: FxQuote | null;
  etfData: EtfDataRow[];
  baseCurrency: string | null;
  selectedAccounts: PortfolioAccount[];
  newlyIncludedAccounts: PortfolioAccount[];
  onNavigatePerformance: () => void;
  onRefreshFx: () => void;
  onGoToSettings: () => void;
}): JSX.Element {
  const freshness = fxQuote ? getQuoteFreshness(fxQuote.fetchedAt) : null;
  const warnings = [...portfolio.warnings];
  if (baseCurrency && baseCurrency !== "AUD") {
    warnings.unshift({ id: "base-currency", severity: "critical", title: "Wealthfolio base currency is not AUD", detail: `Portfolio X-Ray is designed for AUD valuation. Current Wealthfolio base currency: ${baseCurrency}.` });
  }
  if (!fxQuote && portfolio.holdings.some((holding) => holding.localCurrency === "USD")) {
    warnings.unshift({ id: "missing-fx", severity: "critical", title: "USD/AUD quote unavailable", detail: "USD holdings remain visible in native currency, but AUD totals and percentages are incomplete. Configure Twelve Data or refresh Wealthfolio rates." });
  }
  if (newlyIncludedAccounts.length) {
    warnings.unshift({ id: "new-accounts", severity: "info", title: "New active account included", detail: `${newlyIncludedAccounts.map((account) => account.name).join(", ")} was included for X-Ray analysis. You can change this in Settings.` });
  }

  const empty = portfolio.holdings.length === 0;
  const noValue = !empty && portfolio.totalAud === null;
  return <div className="page-stack">
    <SectionHeader eyebrow="Portfolio intelligence" title="Overview" detail={`${selectedAccounts.length} selected account${selectedAccounts.length === 1 ? "" : "s"} · current values from Wealthfolio`} action={<Button onClick={onRefreshFx} variant="quiet">↻ Refresh X-Ray</Button>} />
    {empty ? <EmptyState icon="◈" title="No holdings in the selected accounts" detail="Choose active Wealthfolio accounts in Settings to begin your Portfolio X-Ray." action={<Button onClick={onGoToSettings} variant="primary">Open Settings</Button>} /> : <>
      <div className="metric-grid">
        <MetricCard label="Total portfolio" value={portfolio.totalAud === null ? "Incomplete" : formatAud(portfolio.totalAud)} detail={noValue ? "Missing values remain visible" : "Supported holdings and cash in AUD"} icon="◎" tone={noValue ? "warning" : "green"} />
        <MetricCard label="USD / AUD" value={fxQuote ? fxQuote.rate.toFixed(4) : "—"} detail={fxQuote ? `${fxQuote.provider === "twelvedata" ? "Twelve Data" : "Wealthfolio"} · ${formatRelativeAge(fxQuote.fetchedAt)}` : "No usable quote"} icon="↗" tone={freshness === "Warning" ? "warning" : "blue"} />
        <MetricCard label="ETFs" value={String(etfData.length)} detail={`${etfData.filter((row) => row.snapshot).length} with constituent data`} icon="◫" tone="purple" />
        <MetricCard label="Look-through coverage" value={exposure.coverage === null ? "—" : formatPercent(exposure.coverage)} detail={exposure.eligibleValueAud > 0 ? `${formatAud(exposure.coveredValueAud)} of eligible value` : "Cash excluded from coverage"} icon="⌁" tone={exposure.coverage !== null && exposure.coverage >= 0.95 ? "green" : "warning"} />
      </div>
      {freshness && <div className="quote-strip"><span className="quote-live-dot" /><strong>USD/AUD {freshness.toLowerCase()}</strong><span>{fxQuote?.provider === "twelvedata" ? "Twelve Data" : "Wealthfolio fallback"}</span><span>Fetched {fxQuote ? new Date(fxQuote.fetchedAt).toLocaleString() : "—"}</span><button onClick={onRefreshFx}>Refresh</button></div>}
      <WarningList warnings={warnings} />
      <div className="chart-grid">
        <AllocationChart title="Instrument Allocation" subtitle="What instruments did you buy? ETFs stay intact." rows={topAllocationRows(portfolio.instrumentAllocation)} valueLabel="AUD value" />
        <AllocationChart title="True Exposure" subtitle="What companies and asset classes move with you?" rows={topExposureRows(exposure.rows)} valueLabel="Exposure" />
      </div>
      <div className="insight-row">
        <div className="panel insight-card"><div className="insight-icon">✓</div><div><span className="eyebrow">Value conservation</span><strong>{Math.abs(exposure.valueConservationDelta) < 0.5 ? "Balanced" : "Needs review"}</strong><p>{Math.abs(exposure.valueConservationDelta) < 0.5 ? "Every supported dollar is represented in True Exposure." : `${formatAud(Math.abs(exposure.valueConservationDelta))} is not reconciled.`}</p></div></div>
        <div className="panel insight-card"><div className="insight-icon">↗</div><div><span className="eyebrow">Native performance</span><strong>Keep benchmarks in Wealthfolio</strong><p>Portfolio X-Ray never replaces Wealthfolio's TWR, IRR, or benchmark engine.</p><Button onClick={onNavigatePerformance} variant="quiet">Open Performance →</Button></div></div>
      </div>
    </>}
    {warnings.length > 0 && !empty && <div className="page-footnote"><StatusBadge value="Disclosure" tone="neutral" /> X-Ray calculations use only supported, valued holdings; unresolved value remains visible in residual or opaque buckets.</div>}
    <span className="visually-hidden">{ctx.api ? "Wealthfolio connected" : ""}</span>
  </div>;
}
