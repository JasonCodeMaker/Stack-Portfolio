import React, { useId, useState } from "react";
import { aud, Delta, Empty, fmt, pct, signedAud } from "./common";
import { Detail, Grid, useMainChartHeight } from "./Shell";
import { LineChart, seriesColor } from "./charts";
import { PeriodControl } from "./FilterControls";
import { isCustom, periodLabels } from "./filters.js";
import "./overview.css";

const layout = {
  1: [["metrics", "chart", "breakdown", ["holdings", "accounts"]]],
  2: [["metrics", "chart", "breakdown"], ["holdings", "accounts"]],
  3: [["metrics", "chart"], ["holdings"], ["accounts", "breakdown"]],
};
const amount = (n) => fmt(n, 2);
const axis = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });
const emptyBreakdown = ["未实现变动", "已实现", "分红与利息", "费用", "汇率"].map((label) => ({
  key: label,
  label,
  value: null,
}));

function Metric({ label, value, caption }) {
  return (
    <div className="card kpi">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="d cap">{caption}</div>
    </div>
  );
}

function AssetTrend({ points, view, onViewChange }) {
  const [fit, height] = useMainChartHeight();
  const gain = view === "gain";
  const series = gain
    ? [{ name: "投资盈亏", values: points.map((p) => p.gain), color: "var(--l1)", width: 2, area: "sign" }]
    : [
        { name: "净投入", values: points.map((p) => p.invested), color: "var(--l3)", step: true, dash: "4 3" },
        { name: "总资产", values: points.map((p) => p.value), color: seriesColor(0), width: 2 },
      ];
  return (
    <section className="card" aria-label="资产走势">
      <div className="row">
        <h2>资产走势</h2>
        <div className="seg" role="group" aria-label="资产走势视图">
          {[["value", "总资产与净投入"], ["gain", "投资盈亏"]].map(([key, label]) => (
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
            ariaLabel={gain ? "投资盈亏" : "总资产与净投入"}
            dates={points.map((p) => p.date)}
            series={series}
            height={height}
            zero={gain}
            between={gain ? undefined : [1, 0]}
            formatAxis={(v) =>
              (gain && v > 0 ? "+" : "") + (Math.abs(v) >= 1000 ? axis.format(v / 1000) + "k" : axis.format(v))
            }
            formatValue={(v) => (gain ? signedAud(v) : aud(v, 2))}
          />
        ) : (
          <Empty>暂无数据</Empty>
        )}
      </div>
    </section>
  );
}

function AssetDetails({ d, onClose }) {
  const { cash, total } = d.valuation;
  return (
    <Detail title="总资产明细" onClose={onClose}>
      <div className="dl">
        <div><span className="cap">证券市值</span><b>{amount(d.securities)}</b></div>
        <div><span className="cap">现金</span><b>{amount(cash)}</b></div>
      </div>
      <div className="overview-table">
        <table>
          <thead><tr><th>账户</th><th>证券</th><th>现金</th><th>合计</th></tr></thead>
          <tbody>
            {d.byAccount.map((a) => (
              <tr key={a.id}>
                <td><b>{a.name}</b></td>
                <td>{amount(a.securities)}</td>
                <td>{amount(a.valuation.cash)}</td>
                <td>{amount(a.valuation.total)}</td>
              </tr>
            ))}
            <tr>
              <td><b>合计</b></td>
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

export function Overview({ d, onPage, filters, onFilters }) {
  const [detail, setDetail] = useState(false);
  const [view, setView] = useState("value");
  const dailyId = useId();
  const period = d.summary;
  // The opening calculation baseline can precede the first recorded valuation.
  const points = period?.earliest ? d.points.filter((point) => point.date >= period.earliest) : d.points;
  const preset = period?.period.preset ?? (isCustom(filters) ? "custom" : filters.period);
  const span = periodLabels[preset] ?? "期间";
  const day = filters.date ? "当日" : "今日";
  const { total } = d.valuation;
  const top = d.holdings.securities.filter((s) => s.value != null).slice(0, 5);
  function openHolding(security) {
    // The overview row covers every account. Open the largest account position for its listing.
    const position = security && d.rows
      .filter((r) => security.rowIds.includes(r.id))
      .sort((a, b) => b.audValue - a.audValue)[0];
    onPage("holdings", position && { assetId: position.assetId, symbol: security.ticker });
  }

  return (
    <div className="overview">
      <PeriodControl
        filters={filters}
        range={d.start && { from: d.start, to: d.end ?? d.date }}
        valuationDate={d.date}
        onChange={onFilters}
      />
      <Grid
        layout={layout}
        panels={{
          metrics: (
            <section className="kpis" aria-label="关键数字">
              <button
                type="button"
                className="card kpi hero overview-total"
                aria-label={"总资产 " + aud(total, 2) + "，查看明细"}
                aria-describedby={d.today?.date ? dailyId + " " + dailyId + "-date" : dailyId}
                onClick={() => setDetail(true)}
              >
                <span className="k overview-total-label">
                  <span>总资产</span>
                  {d.today?.date && <time dateTime={d.today.date} id={dailyId + "-date"}>{d.today.date}</time>}
                </span>
                <span className="v">{aud(total, 2)}</span>
                <span className="d" id={dailyId}>
                  <Delta amount={d.today?.change} rate={d.today?.twr} currency={false} /> <span className="cap">{day}</span>
                </span>
              </button>
              <Metric
                label={span + "投资盈亏"}
                value={<Delta amount={period?.gain} currency={false} />}
                caption={"期初 " + amount(period?.startValue)}
              />
              <Metric label="时间加权收益率" value={<Delta rate={period?.twr} />} caption={span} />
              <Metric
                label={span + "净投入"}
                value={amount(period?.netFlow)}
                caption={"累计 " + amount(period?.cumulativeNetFlow)}
              />
            </section>
          ),
          chart: <AssetTrend points={points} view={view} onViewChange={setView} />,
          breakdown: (
            <section className="card overview-breakdown" aria-label="盈亏构成">
              <div className="row">
                <h2>盈亏构成</h2>
                <span className="cap">{span} · 合计 <Delta amount={d.breakdown?.gain} currency={false} /></span>
              </div>
              <dl>
                {(d.breakdown?.items ?? emptyBreakdown).map(({ key, label, value }) => (
                  <div key={key}>
                    <dt className="cap">{label}</dt>
                    <dd><Delta amount={value} currency={false} /></dd>
                  </div>
                ))}
              </dl>
            </section>
          ),
          holdings: (
            <section className="card" aria-label="前 5 大持仓">
              <div className="row">
                <h2>前 5 大持仓</h2>
                <span className="sp" />
                <button type="button" className="overview-all" onClick={() => openHolding(top[0])}>查看全部 <span aria-hidden="true">›</span></button>
              </div>
              {top.length ? (
                <div className="overview-table">
                  <table>
                    <thead><tr><th>证券</th><th>市值</th><th>占比</th><th>{day}涨跌</th></tr></thead>
                    <tbody>
                      {top.map((s) => (
                        <tr className="click" key={s.key} onClick={() => openHolding(s)}>
                          <td>
                            <button className="ticker" type="button">{s.ticker}</button>
                            {s.name && <i title={s.name}>{s.name}</i>}
                          </td>
                          <td>{amount(s.value)}</td>
                          <td>{pct(total > 0 ? s.value / total : null)}</td>
                          <td><Delta amount={s.today?.change} currency={false} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>暂无持仓</Empty>
              )}
            </section>
          ),
          accounts: (
            <section className="card" aria-label="账户">
              <div className="row"><h2>账户</h2></div>
              {d.byAccount.length ? (
                <div className="overview-table">
                  <table>
                    <thead><tr><th>账户</th><th>总值</th><th>{day}变动</th></tr></thead>
                    <tbody>
                      {d.byAccount.map((a) => (
                        <tr key={a.id}>
                          <td title={a.name}><b>{a.name}</b></td>
                          <td>{amount(a.valuation.total)}</td>
                          <td><Delta amount={a.today?.change} currency={false} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>暂无账户</Empty>
              )}
            </section>
          ),
        }}
      />
      {detail && <AssetDetails d={d} onClose={() => setDetail(false)} />}
    </div>
  );
}
