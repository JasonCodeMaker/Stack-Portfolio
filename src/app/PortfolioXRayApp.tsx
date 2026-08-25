import { useState } from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { AppLayout, type PageId } from "@/components/Layout";
import { Button } from "@/components/ui";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import { OverviewPage } from "@/pages/OverviewPage";
import { HoldingsPage } from "@/pages/HoldingsPage";
import { XRayPage } from "@/pages/XRayPage";
import { EtfDataPage } from "@/pages/EtfDataPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function PortfolioXRayApp({ ctx }: { ctx: AddonContext }): JSX.Element {
  const [page, setPage] = useState<PageId>("overview");
  const data = usePortfolioData(ctx);

  const navigateToPerformance = () => {
    void ctx.api.navigation.navigate("/performance").catch((error: unknown) => {
      ctx.api.toast.error(error instanceof Error ? error.message : "Unable to open Wealthfolio Performance");
    });
  };

  const content = data.loading && !data.lastLoadedAt ? <div className="loading-state"><div className="loading-orbit">X</div><h2>Reading Wealthfolio</h2><p>Loading selected accounts, current values, and cached ETF data…</p></div> : data.error && !data.lastLoadedAt ? <div className="error-state"><div className="empty-icon">!</div><h2>Portfolio X-Ray could not load</h2><p>{data.error}</p><Button onClick={() => void data.refresh()} variant="primary">Retry</Button></div> : <>
    {data.error && <div className="global-error"><span>!</span>{data.error}<button onClick={() => void data.refresh()}>Retry</button></div>}
    {page === "overview" && <OverviewPage ctx={ctx} portfolio={data.portfolio} exposure={data.exposure} fxQuote={data.fxQuote} etfData={data.etfData} baseCurrency={data.baseCurrency} selectedAccounts={data.selectedAccounts} newlyIncludedAccounts={data.newlyIncludedAccounts} onNavigatePerformance={navigateToPerformance} onRefreshFx={() => void data.refresh({ forceFx: true })} onGoToSettings={() => setPage("settings")} />}
    {page === "holdings" && <HoldingsPage portfolio={data.portfolio} onGoToSettings={() => setPage("settings")} />}
    {page === "xray" && <XRayPage exposure={data.exposure} hasHoldings={data.portfolio.holdings.length > 0} onGoToSettings={() => setPage("settings")} />}
    {page === "etf-data" && <EtfDataPage etfData={data.etfData} onRefreshEtf={data.refreshEtf} onSaveSnapshot={data.saveSnapshot} onDisableSnapshot={data.disableSnapshot} />}
    {page === "settings" && <SettingsPage activeAccounts={data.activeAccounts} selectedAccounts={data.selectedAccounts} settings={data.settings} holdings={data.holdings} etfData={data.etfData} hasTwelveDataKey={data.hasTwelveDataKey} hasAlphaVantageKey={data.hasAlphaVantageKey} onSaveAccountSelection={data.saveAccountSelection} onSaveSecret={data.saveSecret} onDeleteSecret={data.deleteSecret} onSetLiveFxPolling={data.setLiveFxPolling} onSetTypeOverride={data.setTypeOverride} onSetProviderMode={data.setProviderMode} onSetPinnedProvider={data.setPinnedProvider} />}
  </>;
  return <AppLayout page={page} onPageChange={setPage} accounts={data.selectedAccounts}>{content}</AppLayout>;
}
