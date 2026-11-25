import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { aud, Delta, Empty, fmt, pct, signedAud, signedPct } from "./common";
import { Detail, useMainChartHeight, useRowKeys, useShell } from "./Shell";
import { SecurityDetail, selectedSecurity } from "./Cockpit";
import { HoldingEditor } from "./HoldingEditor";
import { LineChart, seriesColor } from "./charts";
import { PeriodControl } from "./FilterControls";
import { FxCard, FxPanel, RecentCloseDates } from "./MarketQuotes";
import { isCustom, periodLabel } from "./filters.js";
import { periodPresets } from "../periods.js";
import { useI18n } from "./i18n.jsx";
import { Icon } from "./icons";
import { ClassicOverviewLayout, DailyOverviewLayout } from "./OverviewLayouts";
import "./overview.css";
import "./overview-daily.css";

const amount = (n) => fmt(n, 2);
const closeRate = (value, change) =>
  value != null && change != null && value > change ? change / (value - change) : null;
const axis = new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: 2 });
const percentAxis = new Intl.NumberFormat("en-AU", { style: "percent", maximumFractionDigits: 2 });
const breakdownKeys = ["unrealised", "realised", "income", "fees", "fx"];

function Metric({ label, value, caption }) {
  return (
    <div className="card kpi">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {caption && <div className="d cap">{caption}</div>}
    </div>
  );
}

function AssetTrend({ points, view, onViewChange, daily }) {
  const { t } = useI18n();
  const { aspect } = useShell();
  const wideHeight = daily ? { min: 235, max: 360, below: 370 } : { min: 220, max: 235 };
  const [fit, height] = useMainChartHeight(aspect === "21:9" ? wideHeight : { max: 360 });
  const gain = view === "gain";
  const series = gain
    ? [{ name: t("overview.series.gain"), values: points.map((p) => p.gain), color: "var(--l1)", width: 2, area: "sign" }]
    : [
        { name: t("overview.series.invested"), values: points.map((p) => p.invested), color: "var(--l3)", step: true, dash: "4 3" },
        { name: t("overview.series.value"), values: points.map((p) => p.value), color: seriesColor(0), width: 2 },
        {
          name: t("overview.series.netContribRate"),
          values: points.map((p) => p.netContributionRate),
          color: seriesColor(2),
          axis: "right",
          dash: "1 4",
          width: 2,
        },
      ];
  return (
    <section className="card overview-trend" aria-label={t("overview.trendTitle")}>
      <div className="row">
        <h2 className="overview-icon-heading"><Icon name="performance" />{t("overview.trendTitle")}</h2>
        <div className="seg" role="group" aria-label={t("overview.trendViewAria")}>
          {[["value", t("overview.trendValueLabel")], ["gain", t("overview.trendGainLabel")]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={view === key ? "on" : ""}
              aria-pressed={view === key}
              onClick={() => onViewChange(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart overview-chart" ref={fit} style={{ height }}>
        {series.some((s) => s.values.some(Number.isFinite)) ? (
          <LineChart
            ariaLabel={gain ? t("overview.trendGainLabel") : t("overview.trendValueLabel")}
            dates={points.map((p) => p.date)}
            series={series}
            height={height}
            zero={gain}
            between={gain ? undefined : [1, 0]}
            formatAxis={(v) => (gain && v > 0 ? "+" : "") + axis.format(v).replace(/K$/, "k")}
            formatRightAxis={percentAxis.format}
            formatValue={(v, s) => (s.axis === "right" ? signedPct(v) : gain ? signedAud(v) : aud(v, 2))}
          />
        ) : (
          <Empty>{t("common.noData")}</Empty>
        )}
      </div>
    </section>
  );
}

function AssetDetails({ d, onClose }) {
  const { t } = useI18n();
  const { cash, total } = d.valuation;
  return (
    <Detail title={t("overview.assetDetailsTitle")} onClose={onClose}>
      <div className="dl">
        <div><span className="cap">{t("overview.securitiesValue")}</span><b>{amount(d.securities)}</b></div>
        <div><span className="cap">{t("overview.cashValue")}</span><b>{amount(cash)}</b></div>
      </div>
      <div className="overview-table">
        <table>
          <thead><tr><th>{t("overview.col.account")}</th><th>{t("overview.col.securities")}</th><th>{t("overview.col.cash")}</th><th>{t("overview.col.total")}</th></tr></thead>
          <tbody>
            {d.byAccount.map((a) => (
              <tr key={a.id}>
                <td title={a.name}><b>{a.name}</b></td>
                <td>{amount(a.securities)}</td>
                <td>{amount(a.valuation.cash)}</td>
                <td>{amount(a.valuation.total)}</td>
              </tr>
            ))}
            <tr>
              <td><b>{t("overview.col.total")}</b></td>
              <td>{amount(d.securities)}</td>
              <td>{amount(cash)}</td>
              <td><b>{amount(total)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Detail>
  );
}

function TopHoldings({ top, total, unpriced, canStack, live, selected, openHolding, viewAll }) {
  const { t } = useI18n();
  const share = total > 0 ? top.reduce((sum, s) => sum + s.value, 0) / total : null;
  const maxGain = Math.max(0, ...top.map((s) => Math.abs(s.cumulativeGain ?? 0)));
  return (
    <section className="card top-holdings" aria-label={t("overview.top5Title")}>
      <div className="row"><h2>{t("overview.top5Title")}</h2><span className="sp" />
        <button type="button" className="overview-all" onClick={viewAll}>{t("overview.viewAll")} <span aria-hidden="true">›</span></button>
      </div>
      {unpriced || !top.length ? <Empty>{unpriced ? t("overview.topUnpricedEmpty") : t("overview.topEmpty")}</Empty> : <>
        <p className="cap holding-caption">{t("overview.holdingCaption")}</p>
        {canStack && share != null && share <= 1 + 1e-12 && <div className="concentration">
          <div className="split cap"><span>{t("overview.top5Share")} <b>{pct(share)}</b></span>
            <span>{t("overview.restAndCashShare", { pct: pct(Math.max(0, 1 - share)) })}</span></div>
          <div className="concentration-track">{top.map((s, i) =>
            <i key={s.key} title={s.ticker + " " + pct(s.value / total)}
              style={{ width: Math.max(0, s.value / total) * 100 + "%", "--holding-color": "var(--s" + (i + 1) + ")" }} />
          )}</div>
        </div>}
        <table aria-label={t("overview.top5TableAria")} className="holding-list"><tbody>
          {top.map((s, i) => {
            const gain = s.cumulativeGain;
            const half = maxGain && Math.abs(gain ?? 0) / maxGain * 50;
            const pp = s.weightChangePp;
            const badge = s.newPosition ? t("overview.newPosition") : pp == null ? "—" : signedPct(pp / 100).replace("%", " pp");
            return (
              <tr key={s.key} data-row={s.key} className={selected === s.key ? "click sel" : "click"} onClick={() => openHolding(s.key)}>
                <td className="holding-id">
                  <i className="holding-dot" style={{ "--holding-color": "var(--s" + (i + 1) + ")" }} />
                  <button type="button" className="ticker">{s.ticker}</button>
                  <span className="holding-name cap" title={s.name}>{s.name}</span>
                  <span className="cap">{pct(total > 0 ? s.value / total : null)}</span>
                  <span className={"weight-badge " + (pp > 0.005 ? "up" : pp < -0.005 ? "down" : "")}
                    title={t("overview.weightChangeTitle")}>{badge}</span>
                </td>
                <td className="holding-value">{aud(s.value, 2)}</td>
                <td className="holding-result">
                  <span><small className="cap">{t("overview.prevDayShort")}</small>
                    <Delta amount={live ? s.recentCloseChange : s.today?.change}
                      rate={live ? s.quoteChange?.change : s.today?.priceChange?.change} /></span>
                  <span className="pnl-track" aria-hidden="true"><i style={{
                    left: (gain < 0 ? 50 - half : 50) + "%", width: half + "%",
                    "--movement-color": gain < 0 ? "var(--down)" : "var(--up)",
                  }} /></span>
                  <b title={t("overview.cumulativeGainTitle")}>
                    {gain == null ? t("common.pending") : <Delta amount={gain} rate={s.cost > 0 ? gain / s.cost : null} />}</b>
                </td>
              </tr>
            );
          })}
        </tbody></table>
      </>}
    </section>
  );
}

function Accounts({ accounts, total, live }) {
  const { t } = useI18n();
  const { aspect } = useShell();
  return (
    <section className="card overview-accounts" aria-label={t("overview.accountsTitle")}>
      <div className="row"><h2 className="overview-icon-heading"><Icon name="wallet" />{t("overview.accountsTitle")}</h2><span className="cap">{live ? t("overview.recentCloseChange") : t("overview.closeChange")}</span></div>
      {!accounts.length && <Empty>{t("overview.accountsEmpty")}</Empty>}
      {!!accounts.length && (
        <div className="overview-account-list" role="group" aria-label={t("overview.accountListAria")}
          tabIndex={aspect === "21:9" && accounts.length > 2 ? 0 : undefined}>
        {accounts.map((a) => {
        const value = a.valuation.total;
        const share = value != null && total > 0 ? value / total : null;
        const change = a.recentCloseChange;
        const audOnly = a.rows.every((r) => r.localCurrency === "AUD") && !a.cashUnverified;
        return (
          <article className="account-block" key={a.id} aria-label={a.name}>
            <div className="split">
              <div className="account-name"><b>{a.name}</b>{live ? <RecentCloseDates closes={change.closes} /> :
                a.today?.date && <time className="close-badge">{a.today.date}</time>}</div>
              <div className="account-balance"><b>{aud(value, 2)}</b><span className="cap">{pct(share)}</span></div>
            </div>
            <div className="account-share"><i style={{ width: Math.max(0, Math.min(1, share ?? 0)) * 100 + "%" }} /></div>
            <div className="split account-change">
              <b><Delta amount={live ? change.total : a.today?.change} rate={live ? closeRate(value, change.total) : a.today?.twr} /></b>
              {live && <span className="attribution"><span>{t("overview.stockMove")} <Delta amount={change.price} currency={false} /></span>
                {audOnly ? <small className="cap">{t("overview.pureAud")}</small> :
                  <span>{t("overview.fxMove")} <Delta amount={change.fx} currency={false} /></span>}</span>}
            </div>
          </article>
        );
        })}
        </div>
      )}
    </section>
  );
}

export function Overview({ d, onPage, filters, onFilters, run, layout = "classic" }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState(null);
  const [repair, setRepair] = useState(null);
  const [view, setView] = useState("value");
  const { aspect } = useShell();
  const root = useRef(null);
  const lastHolding = useRef(null);
  const dailyId = useId();
  const period = d.summary;
  // The opening calculation baseline can precede the first recorded valuation.
  const preset = period?.period.preset ?? (isCustom(filters) ? "custom" : filters.period);
  const points = period?.earliest ? d.points.filter((point) => point.date >= period.earliest) : d.points;
  const span = periodPresets.includes(preset) ? periodLabel(preset, t) : t("period.fallback");
  const market = d.currentMarket;
  const valueLabel = market ? t("overview.currentValuation") : t("overview.totalAssets");
  const periodFx = d.breakdown?.parts.fx;
  const items = d.breakdown?.items ?? breakdownKeys.map((key) => ({ key, label: t(`overview.breakdown.${key}`), value: null }));
  const maxPart = Math.max(1, ...items.map((item) => Math.abs(item.value)));
  const breakdown = (
    <section className="card overview-breakdown" aria-label={t("overview.breakdownTitle")}>
      <div className="row"><h2>{t("overview.breakdownTitle")}</h2></div>
      <dl>
        {items.map(({ key, label, value }) => (
          <div key={key}>
            <dt className="cap">{label}</dt>
            <dd><Delta amount={value} currency={false} /></dd>
            <span aria-hidden="true" className="breakdown-track"><i style={{
              width: Math.abs(value ?? 0) / maxPart * 100 + "%",
              background: value < 0 ? "var(--down)" : "var(--up)",
            }} /></span>
          </div>
        ))}
      </dl>
    </section>
  );
  const { total } = d.valuation;
  const daily = layout === "daily";
  const incomplete = daily ? total == null : market?.incomplete;
  const balance = aud(incomplete ? d.known : total, 2);
  const asOf = daily ? d.date : !market && d.today?.date;
  const missingQuotes = daily && incomplete ? [...new Set(d.rows
    .filter(row => row.type !== "cash" && row.price == null)
    .map(row => row.ticker || row.symbol).filter(Boolean))] : [];
  const top = d.holdings.securities.filter((s) => s.value != null).slice(0, 5);
  const group = d.holdings.securities.find((s) => s.key === detail?.key);
  // The listing is shared across accounts. Use its largest position for account-specific repairs.
  const largestPosition = (s) => s && d.rows
    .filter((r) => s.rowIds.includes(r.id))
    .sort((a, b) => (b.audValue ?? -Infinity) - (a.audValue ?? -Infinity))[0];
  const position = largestPosition(group);
  const security = position && selectedSecurity(d, { assetId: position.assetId, rowId: position.id });
  const holdingButton = (key) => root.current?.querySelector(`[data-row="${CSS.escape(key)}"] .ticker`);
  const openHolding = (key) => {
    lastHolding.current = key;
    holdingButton(key)?.focus({ preventScroll: true });
    setDetail({ kind: "holding", key });
  };
  const holdingKeys = useRowKeys(top.map((s) => s.key), group?.key, security ? openHolding : undefined);
  const closeDetail = () => setDetail(null);

  useLayoutEffect(() => {
    // Docking or closing the inspector can rebuild the grid and unmount the focused ticker.
    if (lastHolding.current && document.activeElement === document.body) {
      holdingButton(lastHolding.current)?.focus({ preventScroll: true });
    }
  }, [aspect, detail, repair]);

  function viewAllHoldings() {
    const first = largestPosition(top[0]);
    onPage("holdings", first && { assetId: first.assetId, symbol: top[0].ticker });
  }

  const openAssets = () => {
    lastHolding.current = null;
    setDetail({ kind: "assets" });
  };
  const panels = {
    breakdown,
    total: (
      <button
        type="button"
        className="card kpi hero overview-total"
        aria-label={t("overview.totalAssetsAria", { label: valueLabel, value: incomplete ? t("overview.incompleteSubtotal") + " " + balance : balance })}
        aria-describedby={asOf ? dailyId + " " + dailyId + "-date" : dailyId}
        onClick={openAssets}
      >
        <span className="k overview-total-label">
          <span>{valueLabel}</span>
          {asOf && <time dateTime={asOf} id={dailyId + "-date"}>{daily ? t("overview.daily.asOf", { date: asOf }) : asOf}</time>}
        </span>
        <span className="v">{balance}</span>
        <span className="d" id={dailyId}>
          {incomplete ? <span>{t("overview.incompleteSubtotal")}{missingQuotes.length > 0 && " · " + t("overview.daily.missingQuotes", { symbols: missingQuotes.join(", ") })}</span> : market ?
            <><Delta amount={market.recentCloseChange.total} rate={closeRate(total, market.recentCloseChange.total)} /> <span className="cap">{t("overview.recentCloseChange")}</span></> :
            <><Delta amount={d.today?.change} rate={d.today?.twr} currency={false} /> <span className="cap">{t("overview.closeChange")}</span></>}
        </span>
      </button>
    ),
    holdingsGain: (
      <Metric label={t("overview.holdingsGain")}
        value={d.holdings.openGain == null ? t("common.pending") : <Delta amount={d.holdings.openGain} />}
        caption={d.holdings.cost == null ? t("overview.costPending") : t("overview.returnRateCaption", {
          rate: signedPct(d.holdings.cost > 0 && d.holdings.openGain != null ? d.holdings.openGain / d.holdings.cost : null),
          cost: aud(d.holdings.cost, 2),
        })}
      />
    ),
    periodGain: (
      <Metric
        label={t("overview.periodGain", { period: span })}
        value={<Delta amount={period?.gain} currency={false} />}
        caption={t("overview.openingCaption", { value: amount(period?.startValue) })}
      />
    ),
    returnRate: (
      <Metric label={t("overview.twr")} value={<Delta rate={period?.twr} />}
        caption={period?.annualised != null && t("overview.annualisedCaption", { rate: signedPct(period.annualised) })} />
    ),
    netFlow: (
      <Metric
        label={t("overview.periodNetFlow", { period: span })}
        value={amount(period?.netFlow)}
        caption={t("overview.cumulativeCaption", { value: amount(period?.cumulativeNetFlow) })}
      />
    ),
    trend: (
      <AssetTrend daily={daily} points={points} view={view} onViewChange={setView} />
    ),
    holdings: (
      <TopHoldings top={top} total={d.portfolio.totalAud} live={Boolean(market)} selected={group?.key}
        unpriced={d.holdings.securities.some((s) => s.value == null)}
        canStack={d.rows.every((r) => r.audValue != null && r.audValue >= 0)}
        openHolding={openHolding} viewAll={viewAllHoldings} />
    ),
    accounts: (
      <Accounts accounts={d.byAccount} total={total} live={Boolean(market)} />
    ),
    fx: (
      <FxCard fx={d.fx} span={span} periodGain={periodFx}
        open={() => { lastHolding.current = null; setDetail({ kind: "fx" }); }} />
    ),
  };

  return (
    <div className="overview" ref={root} onKeyDown={(e) => {
      if (!repair && e.target.closest("[data-row], .insp, dialog")) holdingKeys(e);
    }}>
      <PeriodControl
        filters={filters}
        range={d.start && { from: d.start, to: d.end ?? d.date }}
        valuationDate={d.date}
        onChange={onFilters}
      />
      {daily
        ? <DailyOverviewLayout d={d} wide={aspect === "21:9"} panels={panels} openAssets={openAssets} />
        : <ClassicOverviewLayout wide={aspect === "21:9"} panels={panels} />}
      {detail?.kind === "assets" && <AssetDetails d={d} onClose={closeDetail} />}
      {detail?.kind === "fx" && <FxPanel fx={d.fx} periodGain={periodFx} close={closeDetail} />}
      {security && <SecurityDetail d={d} security={security} onClose={closeDetail} openRepair={setRepair} />}
      {repair && (
        <HoldingEditor d={d} run={run} action={repair.action} row={repair.row} close={(saved) => {
          if (saved) closeDetail();
          setRepair(null);
        }} />
      )}
    </div>
  );
}
