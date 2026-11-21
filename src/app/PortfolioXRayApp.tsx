import type { AddonContext } from "@wealthfolio/addon-sdk";
import { Button } from "@wealthfolio/ui";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import { PortfolioInsightsPage } from "@/pages/PortfolioInsightsPage";

export function PortfolioXRayApp({ ctx }: { ctx: AddonContext }): JSX.Element {
  const data = usePortfolioData(ctx);
  if (data.loading && !data.lastLoadedAt) {
    return <div className="pi-state"><div className="pi-spinner" /><h2>Loading allocation</h2><p>Reading holdings and fund data…</p></div>;
  }
  if (data.error && !data.lastLoadedAt) {
    return <div className="pi-state"><h2>Allocation could not load</h2><p>{data.error}</p><Button onClick={() => void data.refresh()}>Retry</Button></div>;
  }
  return <>
    {data.error && <div className="pi-global-error">{data.error}<Button variant="outline" size="sm" onClick={() => void data.refresh()}>Retry</Button></div>}
    <PortfolioInsightsPage
      portfolio={data.portfolio}
      exposure={data.exposure}
      activeAccounts={data.activeAccounts}
      selectedAccounts={data.selectedAccounts}
      etfData={data.etfData}
      rebalanceSettings={data.rebalanceSettings}
      onSaveRebalance={data.saveRebalance}
      onSaveAccountSelection={data.saveAccountSelection}
      onRefresh={() => data.refresh()}
      onRefreshEtf={data.refreshEtf}
    />
  </>;
}
