import React from "react";
import { aud, pct, signedAud } from "./common";

import { useI18n } from "./i18n";
import { RecentCloseDates } from "./MarketQuotes";

const digits = value => Math.round(value * 100) % 100 === 0 ? 0 : 2;
const amount = (value, t) => Number.isFinite(value) ? aud(value, digits(value)) : t("overview.daily.unpriced");

export function AssetComposition({ d, onDetails }) {
  const { t } = useI18n();
  const { cash, total } = d.valuation;
  const missingPrice = d.securities == null;
  const priced = d.rows.filter(row => row.type !== "cash" && Number.isFinite(row.audValue));
  const securities = missingPrice && priced.length ? priced.reduce((sum, row) => sum + row.audValue, 0) : d.securities;
  const reconciled = total > 0 && Number.isFinite(cash) && Number.isFinite(d.securities)
    && Math.abs(cash + d.securities - total) < 0.005;
  const cashShare = reconciled ? cash / total : null;
  const amounts = [
    { name: t("overview.cashValue"), value: cash, share: cashShare },
    { name: t(missingPrice ? "overview.daily.priced" : "overview.daily.securities"), value: securities,
      share: reconciled ? securities / total : null },
  ];
  return <section className="daily-composition" aria-label={t("overview.daily.mix")}>
    <header className="daily-composition-head"><h2>{t("overview.daily.mix")}</h2>
      <button type="button" className="overview-all" onClick={onDetails}>{t("overview.daily.details")} ›</button>
    </header>
    <dl>{amounts.map(row => <div key={row.name}>
      <dt>{row.name}</dt>
      <dd><strong>{amount(row.value, t)}</strong>{row.share != null && <small>{pct(row.share)}</small>}</dd>
    </div>)}</dl>
  </section>;
}

// Match the entire close before naming its contributors, including non-security items.
function rankedContributions(today, smallLabel) {
  const rows = today?.securities;
  if (!Number.isFinite(today?.change) || !rows?.length ||
      rows.some(row => !Number.isFinite(row.change) || row.key === "unreconciled")) return null;
  const sum = rows.reduce((value, row) => value + row.change, 0);
  if (Math.abs(sum - today.change) >= 0.005) return null;
  const visible = rows.filter(row => Math.abs(row.change) >= 0.005);
  const smallTotal = rows.reduce((total, row) =>
    total + (Math.abs(row.change) < 0.005 ? row.change : 0), 0);
  if (Math.abs(smallTotal) >= 0.005) visible.push({ key: "small-movements", label: smallLabel, change: smallTotal });
  return visible.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

function closeData(d) {
  if (!d.currentMarket) return d.today;
  const securities = d.holdings.securities.map(s => ({ key: s.key, label: s.ticker, change: s.recentCloseChange }));
  const cash = d.byAccount.flatMap(a => a.rows.filter(r => r.type === "cash").map(r => ({
    key: r.id, label: a.name + " · " + r.localCurrency, change: r.recentCloseChange,
  })));
  return { change: d.currentMarket.recentCloseChange.total, securities: [...securities, ...cash] };
}

export function CloseDrivers({ d }) {
  const { t } = useI18n();
  const today = closeData(d);
  const closes = d.currentMarket && Array.from(new Map(d.byAccount.flatMap(a =>
    a.recentCloseChange.closes.map(c => [c.at, c]))).values());
  const rows = rankedContributions(today, t("overview.daily.smallGroup"));
  const zeroLabel = today?.securities?.some(row => row.change !== 0) ? "overview.daily.small" : "overview.daily.zero";
  const peak = Math.abs(rows?.[0]?.change ?? 0);
  const losses = rows?.some(row => row.change < 0);
  const net = Number.isFinite(today?.change) ? signedAud(today.change, digits(today.change)) : t("overview.daily.unverified");
  return <details className="daily-close-drivers">
    <summary><span>{t("overview.daily.drivers")}</span><strong>{net}</strong></summary>
    {closes && <RecentCloseDates closes={closes}/>}
    {today?.previous && today?.date && <small>{today.previous} – {today.date}</small>}
    {rows?.length ? <table aria-label={t("overview.daily.drivers")}><tbody>
      {rows.map(row => <tr key={row.key}>
        <th scope="row">{row.label}</th>
        <td className="daily-impact-cell" aria-hidden="true"><span className={"daily-impact-track" + (losses ? " split-axis" : "")}>
          <i className={row.change < 0 ? "fall" : "rise"} style={{width:(losses ? 50 : 100) * Math.abs(row.change) / peak + "%"}}/>
        </span></td>
        <td className={"daily-impact-amount " + (row.change < 0 ? "loss" : "gain")}>{signedAud(row.change, digits(row.change))}</td>
      </tr>)}
    </tbody></table> : <p className="cap">{t(rows ? zeroLabel : "overview.daily.noClose")}</p>}
  </details>;
}
