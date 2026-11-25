import React from "react";
import { useI18n } from "./i18n";
import { Icon } from "./icons";
import { AssetComposition, CloseDrivers } from "./DailyOverviewDetails";

export function ClassicOverviewLayout({ wide, panels }) {
  const { t } = useI18n();
  const returnDetails = <>{panels.breakdown}{panels.fx}</>;
  return (
    <div className="overview-layout">
      <div className="overview-main">
        <section className="kpis" aria-label={t("overview.kpisAria")}>
          {panels.total}
          {panels.holdingsGain}
          {panels.periodGain}
          {panels.returnRate}
          {panels.netFlow}
        </section>
        <div className="overview-primary">
          {panels.trend}
          {!wide && returnDetails}
          {panels.holdings}
        </div>
      </div>
      <div className="overview-rail">
        {panels.accounts}
        {wide && returnDetails}
      </div>
    </div>
  );
}

export function DailyOverviewLayout({ d, wide, panels, openAssets }) {
  const { t } = useI18n();
  return (
    <div className={wide ? "daily-groups overview-layout" : "daily-groups"}>
      <div className="overview-main">
        <section className="card daily-group daily-assets" aria-label={t("overview.daily.assets")}>
          <div className="daily-balance-summary">
            <div className="daily-native-part">
              {panels.total}
            </div>
            <AssetComposition d={d} onDetails={openAssets}/>
          </div>
          <div className="daily-native-part">
            {panels.trend}
          </div>
          {!wide && <div className="daily-native-part daily-account-band">{panels.accounts}</div>}
        </section>
        <section className="card daily-group daily-positions" aria-label={t("overview.daily.positions")}>
          <header className="daily-group-head">
            <h2 className="overview-icon-heading"><Icon name="holdings" />{t("overview.daily.positions")}</h2>
            <div className="daily-native-part">
              {panels.holdingsGain}
            </div>
          </header>
          <CloseDrivers d={d}/>
          <div className="daily-native-part">
            {panels.holdings}
          </div>
        </section>
      </div>
      <div className="overview-rail">
        {wide && <div className="card daily-group daily-wide-accounts"><div className="daily-native-part">{panels.accounts}</div></div>}
        <section className="card daily-group daily-period" aria-label={t("overview.daily.period")}>
          <header className="daily-group-head">
            <h2 className="overview-icon-heading"><Icon name="periodReturn" />{t("overview.daily.period")}</h2>
          </header>
          <div className="daily-period-metrics">
            <div className="daily-native-part">
              {panels.periodGain}
            </div>
            <div className="daily-native-part">
              {panels.returnRate}
            </div>
            <div className="daily-native-part">
              {panels.netFlow}
            </div>
          </div>
          <div className="daily-period-details">
            <div className="daily-native-part">{panels.breakdown}</div>
            <div className="daily-native-part">
              {panels.fx}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
