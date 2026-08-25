import { Button, EmptyState, SectionHeader, StatusBadge, TableShell, formatAud, formatNative, formatPercent, formatQuantity } from "@/components/ui";
import type { NormalizedHolding, PortfolioModel } from "@/types/domain";

export function HoldingsPage({ portfolio, onGoToSettings }: { portfolio: PortfolioModel; onGoToSettings: () => void }): JSX.Element {
  return <div className="page-stack">
    <SectionHeader eyebrow="Audit trail" title="Holdings" detail="Account-level rows stay untouched so every value can be traced back to Wealthfolio." action={<span className="data-source-pill"><span className="pulse-dot" />Wealthfolio source</span>} />
    {portfolio.holdings.length === 0 ? <EmptyState icon="▤" title="No holdings to show" detail="Select at least one active Wealthfolio account to see its raw holdings." action={<Button onClick={onGoToSettings} variant="primary">Choose accounts</Button>} /> : <div className="panel table-panel">
      <div className="table-toolbar"><div><strong>{portfolio.holdings.length} holding{portfolio.holdings.length === 1 ? "" : "s"}</strong><span>Same ticker in two accounts remains two rows.</span></div><span className="table-toolbar-note">Portfolio weights use current AUD total only when complete</span></div>
      <TableShell><thead><tr><th>Ticker</th><th>Name</th><th>Account</th><th>Type</th><th className="numeric">Quantity</th><th>Currency</th><th className="numeric">Native value</th><th className="numeric">AUD value</th><th className="numeric">Weight</th><th>Price updated</th><th>Status</th></tr></thead><tbody>
        {portfolio.holdings.map((holding) => <HoldingRow key={holding.id} holding={holding} totalAud={portfolio.totalAud} />)}
      </tbody></TableShell>
      </div>}
  </div>;
}

function HoldingRow({ holding, totalAud }: { holding: NormalizedHolding; totalAud: number | null }): JSX.Element {
  const weight = holding.audValue !== null && totalAud && totalAud > 0 && holding.status === "valued" ? holding.audValue / totalAud : null;
  const tone = holding.status === "valued" ? "good" : holding.status === "unsupported-position" || holding.status === "unsupported-currency" ? "critical" : "warning";
  return <tr>
    <td><strong className="ticker-cell">{holding.ticker}</strong></td>
    <td><span className="name-cell">{holding.name}</span></td>
    <td><span className="account-cell"><span className="account-avatar">{holding.accountName.slice(0, 1).toUpperCase()}</span>{holding.accountName}</span></td>
    <td><span className="type-label">{holding.type}</span></td>
    <td className="numeric">{formatQuantity(holding.quantity)}</td>
    <td><span className="currency-label">{holding.localCurrency}</span></td>
    <td className="numeric">{formatNative(holding.nativeValue, holding.localCurrency)}</td>
    <td className="numeric value-strong">{holding.audValue === null ? "—" : formatAud(holding.audValue)}</td>
    <td className="numeric">{formatPercent(weight)}</td>
    <td><span className="date-cell">{holding.priceUpdatedAt ? new Date(holding.priceUpdatedAt).toLocaleDateString() : "—"}</span></td>
    <td><StatusBadge value={holding.status === "valued" ? "Valued" : holding.status.replace(/-/g, " ")} tone={tone} /></td>
  </tr>;
}
