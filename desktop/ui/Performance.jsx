import React, { useEffect, useRef, useState } from "react";
import { Bookmark, RefreshCw } from "lucide-react";
import { api, aud, directedPct, fmt, num, types, signedPct, tone, Card, Delta, Empty, Field, Table, Tabs } from "./common";
import { DivergingBar, LineChart, divergingScale, seriesColor } from "./charts";
import { Detail, useMainChartHeight, useRowKeys, useShell } from "./Shell";
import { resolvePeriod } from "../periods.js";
import { PeriodControl } from "./FilterControls";
import { isCustom, periodLabel, periodQuery, accountScope, choosePreset, chooseRange } from "./filters.js";
import { useI18n } from "./i18n.jsx";
import "./performance.css";

const gapPoints = (v) => signedPct(v).replace("%", " pp");
const errorText = (e) =>
  String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

function Metric({ title, name = title, value, format = signedPct, children }) {
  const direction = tone(value, 4);
  return (
    <section className="card kpi" aria-label={name}>
      <h2 className="k">{title}</h2>
      <strong className={"v " + direction}>
        {direction && <i aria-hidden="true">{direction === "gain" ? "▲" : "▼"}</i>}
        {format(value)}
      </strong>
      <div className="d cap">{children}</div>
    </section>
  );
}

const dateSpan = (from, to, toWord) => {
  const short = from.slice(0, 4) === to.slice(0, 4);
  return (short ? from.slice(5) : from) + " " + toWord + " " + (short ? to.slice(5) : to);
};

function Verdict({ review, benchmark, period }) {
  const { t } = useI18n();
  const own = review.metrics.portfolio;
  const index = review.metrics[benchmark.id];
  const drawdown = own.drawdown;
  const longest = index.longestUnderperformance;
  return (
    <div className="kpis review-metrics">
      <Metric name={t("review.twrAria")} title={t("review.twrTitle", { period })} value={own.totalReturn}>
        {review.measuredDays < 365
          ? t("review.lessThanYear")
          : <>{t("review.annualisedWord")} <Delta rate={own.annualised} />
              {index.annualised != null && <> · {benchmark.name} <Delta rate={index.annualised} /></>}
            </>}
        {own.asOf && review.origin > review.base && <small>{t("review.startsFrom", { origin: review.origin })}</small>}
        {own.asOf && own.asOf !== review.to && <small>{t("review.asOfClose", { date: own.asOf })}</small>}
      </Metric>
      <Metric title={t("review.vsBenchmark", { name: benchmark.name })} value={index.gap} format={gapPoints}>
        {index.gap == null ? t("review.noSamePeriodCompare") : <>{t("review.indexWord")} <Delta rate={index.totalReturn} /></>}
        {index.gap != null && index.asOf !== own.asOf && <small>{t("review.samePeriodAsOf", { date: index.asOf })}</small>}
      </Metric>
      <Metric title={t("review.metric.maxDrawdown")} value={own.maxDrawdown}>
        {drawdown?.peak ? (
          <>
            <span title={`${drawdown.peak} ${t("period.toWord")} ${drawdown.trough}`}>
              {dateSpan(drawdown.peak, drawdown.trough, t("period.toWord"))}
            </span>
            {drawdown.recovery
              ? t("review.recoveredAt", {
                  date: drawdown.recovery.slice(0, 4) === drawdown.trough.slice(0, 4)
                    ? drawdown.recovery.slice(5)
                    : drawdown.recovery,
                })
              : t("review.notRecovered")}
          </>
        ) : drawdown ? t("review.noDrawdown") : t("review.noDrawdownData")}
      </Metric>
      <Metric title={t("review.longestLagTitle", { name: benchmark.name })} value={longest?.worst} format={gapPoints}>
        {longest ? (
          <>
            <span title={`${longest.from} ${t("period.toWord")} ${longest.to}`}>
              {dateSpan(longest.from, longest.to, t("period.toWord"))}
            </span>
            {t("review.daysSuffix", { days: longest.days })}
          </>
        ) : index.gap == null ? t("review.noSamePeriodCompare") : t("review.noSignificantLag")}
      </Metric>
    </div>
  );
}

const chartModeIds = ["returns", "gap", "drawdown"];
const benchmarksOf = (review) => review.series.map((b, i) => ({
  ...b,
  color: seriesColor(i + 1),
  dash: i === 0 ? "6 3" : "2 3",
}));
const through = (point, date, value) => date && point.date <= date ? value : null;

function ReviewChart({ review, benchmarks, benchmark, chooseBenchmark, select, zoom }) {
  const { t } = useI18n();
  const [mode, setMode] = useState("returns");
  const [chartRef, height] = useMainChartHeight();
  const view = mode === "drawdown" && !review.hasQuarter ? "returns" : mode;
  const own = review.metrics.portfolio, index = review.metrics[benchmark.id];
  const to = view === "gap" ? (index.gap == null ? null : index.asOf) :
    [own.asOf, ...benchmarks.map((b) => review.metrics[b.id].asOf)].filter(Boolean).sort().at(-1);
  const points = review.points.filter((p) => p.date >= review.origin && p.date <= to);
  const dates = points.map((p) => p.date);
  const portfolio = { name: t("review.portfolioName"), color: seriesColor(0), width: 2.5 };
  const bands = [], markers = [];
  let series, label;

  if (view === "gap") {
    label = t("review.curve.gap", { name: benchmark.name });
    series = [{
      name: t("review.vsBenchmark", { name: benchmark.name }),
      color: "var(--l1)",
      width: 2,
      area: "sign",
      values: points.map((p) => p.gaps[benchmark.id]),
    }];
    const longest = index.longestUnderperformance;
    if (longest) bands.push({
      from: dates.indexOf(longest.from),
      to: dates.indexOf(longest.to),
      label: t("review.longestLagLabel", { pct: directedPct(longest.worst, " pp") }),
    });
  } else if (view === "drawdown") {
    label = t("review.curve.drawdown");
    const drawdowns = (rows) => {
      const byDate = new Map(rows?.map((p) => [p.date, p.drawdown]));
      return dates.map((date) => byDate.get(date));
    };
    series = [
      { ...portfolio, color: "var(--down)", area: true, values: drawdowns(review.drawdownSeries) },
      { ...benchmark, values: drawdowns(review.benchmarkDrawdowns[benchmark.id]) },
    ];
    if (own.drawdown?.trough) markers.push({
      index: dates.indexOf(own.drawdown.trough),
      value: own.drawdown.depth,
      label: directedPct(own.drawdown.depth),
    });
  } else {
    label = t("review.curve.returns");
    series = [
      { ...portfolio, values: points.map((p) => through(p, own.asOf, p.portfolio)) },
      ...benchmarks.map((b) => ({
        ...b,
        values: points.map((p) => through(p, review.metrics[b.id].asOf, p[b.id])),
      })),
    ];
  }

  return (
    <section className="card review-chart" aria-label={t("review.chartSectionAria")}>
      <div className="row">
        <div className="seg" role="group" aria-label={t("review.chartModeAria")}>
          {(review.hasQuarter ? chartModeIds : chartModeIds.slice(0, 2)).map((id) => (
            <button type="button" key={id} className={view === id ? "on" : ""}
              aria-pressed={view === id} onClick={() => setMode(id)}>
              {t(`review.mode.${id}`)}
            </button>
          ))}
        </div>
        <span className="sp" />
        <div className="review-benchmarks" role="group" aria-label={t("review.benchmarksAria")}>
          {benchmarks.map((b) => (
            <button type="button" className="btn sm" key={b.id} aria-pressed={benchmark.id === b.id}
              onClick={() => chooseBenchmark(b.id)}>
              <i aria-hidden="true" style={{ background: b.color }} />
              {b.name} <Delta rate={review.metrics[b.id].gap} rateUnit=" pp" />
            </button>
          ))}
        </div>
      </div>
      <div className="chart" ref={chartRef}>
        {series.some((s) => s.values.some(Number.isFinite)) ? (
          <LineChart
            ariaLabel={label}
            series={series}
            dates={dates}
            height={height}
            zero={view !== "drawdown"}
            hi={view === "drawdown" ? 0 : undefined}
            padRight={104}
            bands={bands}
            markers={markers}
            formatAxis={(v) => signedPct(v, 1).replace("%", view === "gap" ? " pp" : "%")}
            formatValue={(value) => directedPct(value, view === "gap" ? " pp" : "%")}
            onSelect={select}
            onZoom={zoom}
          />
        ) : <Empty>{t("review.chartEmpty", { label })}</Empty>}
      </div>
    </section>
  );
}

function Methods() {
  const { t } = useI18n();
  const methods = [
    [t("review.method.twrTitle"), t("review.method.twrDesc")],
    [t("review.method.annTitle"), t("review.method.annDesc")],
    [t("review.method.gapTitle"), t("review.method.gapDesc")],
    [t("review.method.ddTitle"), t("review.method.ddDesc")],
    [t("review.method.contribTitle"), t("review.method.contribDesc")],
  ];
  return (
    <dl className="review-methods">
      {methods.map(([title, text]) => (
        <div key={title}><dt>{title}</dt><dd>{text}</dd></div>
      ))}
    </dl>
  );
}

function MethodSummary({ dataPanel }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <details className="card review-method" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("review.methodSummary")}</summary>
      {open && dataPanel}
    </details>
  );
}

function UnderperformancePeriods({ review, benchmark, select }) {
  const { t } = useI18n();
  const periods = review.intervals.filter((interval) => interval.id === benchmark.id);
  return (
    <Card title={t("review.lagTitle", { name: benchmark.name })}>
      {periods.length ? (
        <Table head={[t("review.col.firstBehind"), t("review.col.lastObserved"), t("review.col.status"), [t("review.col.maxLag"), "num"]]}>
          {periods.map((interval) => (
            <tr key={interval.from}>
              <td><button type="button" className="text-btn" onClick={() => select(interval.from)}>{interval.from}</button></td>
              <td>{interval.to}</td>
              <td>{t(`review.status.${interval.status}`)}</td>
              <td className="num">{gapPoints(interval.worst)}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="cap">{review.metrics[benchmark.id].gap == null ? t("review.noSamePeriodCompare") : t("review.noLagPeriods")}</p>}
    </Card>
  );
}

const coverage = (first, last, t) => (first && last ? t("review.spanRange", { from: first, to: last }) : "—");

function DataPanel({ review, mode, disabled, refresh, results }) {
  const { t, sourceLabel } = useI18n();
  const done = results.filter((r) => !r.error),
    failed = results.filter((r) => r.error);
  return (
    <>
      <h3>{t("review.dataSources")}</h3>
      <dl className="review-methods">
        <div>
          <dt>{t("review.portfolioCloseVal")}</dt>
          <dd>{t("review.ledgerSourcesDesc")}</dd>
          <dd className="cap">{coverage(review.origin, review.metrics.portfolio.asOf, t)}</dd>
        </div>
        {review.series.map((b) => (
          <div key={b.id}>
            <dt>{b.name}</dt>
            <dd>{sourceLabel(b.source)}</dd>
            <dd className="cap">{coverage(b.first, b.last, t)}</dd>
            <dd className="cap">{t("review.rangeMaxDd")} <Delta rate={review.metrics[b.id].maxDrawdown} /></dd>
          </div>
        ))}
        <div>
          <dt>{t("review.usdToAud")}</dt>
          <dd>{review.fx.sources.map(sourceLabel).join(t("common.comma")) || "Yahoo Finance · AUDUSD=X"}</dd>
          <dd className="cap">{coverage(review.fx.first, review.fx.last, t)}</dd>
        </div>
      </dl>
      {mode === "real" && (
        <div className="actions">
          <button type="button" className="btn" disabled={disabled} onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" /> {t("review.updateMarketBtn")}
          </button>
        </div>
      )}
      {results.length > 0 && (
        <p className="review-feedback" role="status">
          {done.length > 0 && t("review.updatedItems", { items: done.map((r) => r.name).join(t("common.comma")) })}
          {failed.length > 0 && t("review.failedItems", {
            items: failed
              .map((r) => `${r.name}${t("common.openParen")}${r.error}${t("common.closeParen")}`)
              .join(t("common.comma")),
          })}
        </p>
      )}
      <h3>{t("review.calcTitle")}</h3>
      <Methods />
    </>
  );
}

function DailyTable({ review, benchmark, selected, select, docked }) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(40);
  const own = review.metrics.portfolio;
  const index = review.metrics[benchmark.id];
  const end = [own.asOf, index.asOf].filter(Boolean).sort().at(-1);
  const days = review.points.flatMap((point, i) => {
    if (!end || point.date < review.from || point.date < review.origin || point.date > end) return [];
    const cumulative = through(point, own.asOf, point.portfolio);
    const previous = review.points[i - 1]?.portfolio;
    return [{
      date: point.date,
      daily: cumulative != null && previous != null && previous > -1 ? (1 + cumulative) / (1 + previous) - 1 : null,
      cumulative,
      benchmark: through(point, index.asOf, point[benchmark.id]),
      gap: index.gap != null ? through(point, index.asOf, point.gaps[benchmark.id]) : null,
    }];
  }).reverse();
  const shown = days.slice(0, limit);
  const rowKeys = useRowKeys(shown.map((row) => row.date), selected, docked ? select : undefined);
  return (
    <div className="review-daily">
      {days.length ? (
        <Table
          head={[
            t("review.dailyCol.date"),
            [t("review.dailyCol.dayReturn"), "num"],
            [t("review.dailyCol.cumReturn"), "num"],
            [benchmark.name, "num"],
            [t("review.dailyCol.gap"), "num"],
          ]}
          onKeyDown={rowKeys}
        >
          {shown.map((row) => (
            <tr
              key={row.date}
              data-row={row.date}
              className={row.date === selected ? "click sel" : "click"}
              onClick={(e) => {
                e.currentTarget.querySelector("button").focus({ preventScroll: true });
                select(row.date);
              }}
            >
              <td><button type="button" className="text-btn" aria-pressed={docked ? row.date === selected : undefined}>{row.date}</button></td>
              <td className="num"><Delta rate={row.daily} /></td>
              <td className="num"><Delta rate={row.cumulative} /></td>
              <td className="num"><Delta rate={row.benchmark} /></td>
              <td className="num"><Delta rate={row.gap} rateUnit=" pp" /></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{t("review.noDailyData")}</Empty>}
      {days.length > limit && (
        <button type="button" className="btn sm" onClick={() => setLimit(limit + 40)}>{t("review.showEarlier")}</button>
      )}
    </div>
  );
}

const amount = (value) => <Delta amount={value} digits={Number.isInteger(value) ? 0 : 2} />;

function Breakdown({ data, period, selected, select, openHolding }) {
  const { t } = useI18n();
  const item = data?.items.find((item) => item.key === selected);
  const rowKeys = useRowKeys(item?.rows.filter((row) => row.kind === "security").map((row) => row.key) ?? []);
  return (
    <section className="card" aria-label={t("review.breakdownTitle")}>
      <div className="row">
        <h2>{t("review.breakdownTitle")}</h2>
        {data && <span className="cap">{t("review.periodTotal", { period })} {amount(data.gain)}</span>}
      </div>
      {!data ? <Empty>{t("review.noBreakdown")}</Empty> : (
        <div className="review-breakdown">
          {data.items.map(({ key, label, value }) => (
            <button type="button" key={key} aria-expanded={selected === key}
              onClick={() => select(selected === key ? null : key)}>
              <span className="cap">{label}</span>
              <b>{amount(value)}</b>
            </button>
          ))}
        </div>
      )}
      {item && (item.rows.length ? (
        <div className="tw review-drill">
          <table>
            <thead><tr><th scope="col">{t("review.bySecurityCol", { label: item.label })}</th><th scope="col">{t("review.amountCol")}</th></tr></thead>
            <tbody onKeyDown={rowKeys}>
              {item.rows.map((row) => (
                <tr key={row.key} data-row={row.kind === "security" ? row.key : undefined} className={row.kind === "security" ? "click" : undefined}
                  onClick={row.kind === "security" ? () => openHolding(row) : undefined}>
                  <td>
                    {row.kind === "security"
                      ? <button type="button" className="ticker">{row.label}</button>
                      : <span className="cap">{row.label}</span>}
                    {row.listing && <i>{row.listing}</i>}
                  </td>
                  <td>{amount(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="cap">{t("review.noPartAmount")}</p>)}
    </section>
  );
}

function Contributions({ data, total, period, expanded, setExpanded, openHolding, openEvidence }) {
  const { t } = useI18n();
  const rows = data?.rows || [];
  const scale = divergingScale(rows.map((row) => row.gain ?? 0));
  const middle = rows.length > 15 ? rows.slice(7, -7) : [];
  const folded = middle.length > 0 && !expanded;
  const shown = folded ? [...rows.slice(0, 7), ...rows.slice(-7)] : rows;
  const rowKeys = useRowKeys(shown.filter((row) => row.kind === "security" || row.events.length).map((row) => row.key));
  const middleTotal = middle.every((row) => row.gain != null) ? middle.reduce((sum, row) => sum + row.gain, 0) : null;
  const renderRow = (row) => {
    const security = row.kind === "security";
    const select = security ? () => openHolding(row) : row.events.length ? () => openEvidence(row) : undefined;
    const content = (
      <>
        <span className={security ? "" : "cap"}>
          {security ? <b title={row.listing}>{row.label}</b> : row.label}
          {row.closed && <span className="cap">{t("review.soldInPeriod")}</span>}
        </span>
        <span aria-hidden="true">
          {row.gain != null && <DivergingBar value={row.gain} scale={scale} />}
        </span>
        <span className="review-contribution-amount">{amount(row.gain)}</span>
      </>
    );
    return select ? (
      <button type="button" key={row.key} data-row={row.key} className="review-contribution" onClick={select}>
        {content}
      </button>
    ) : (
      <div key={row.key} className="review-contribution">{content}</div>
    );
  };
  return (
    <section className="card" aria-label={t("review.contribTitle")}>
      <div className="row">
        <h2>{t("review.contribTitle")}</h2>
        {data && <span className="cap">{t("review.periodTotal", { period })} {amount(total)}</span>}
      </div>
      {rows.length ? (
        <div className="review-contributions" onKeyDown={rowKeys}>
          {(folded ? rows.slice(0, 7) : rows).map(renderRow)}
          {middle.length > 0 && (
            <button type="button" className="review-fold" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {folded
                ? <>{t("review.middleSummary", { count: middle.length })} {amount(middleTotal)}{t("review.expandWord")}</>
                : t("review.topBottomOnly")}
            </button>
          )}
          {folded && rows.slice(-7).map(renderRow)}
        </div>
      ) : <Empty>{data ? t("review.noContribsRange") : t("review.noContribsYet")}</Empty>}
    </section>
  );
}

function ContributionEvidence({ row, accountName, onPage }) {
  const { t, typeLabel, sourceLabel } = useI18n();
  const rowKeys = useRowKeys(row.events.map((e) => e.id));
  return (
    <Table
      head={[
        t("review.evCol.date"),
        t("review.evCol.account"),
        t("review.evCol.record"),
        [t("review.evCol.amountTrade"), "num"],
        [t("review.evCol.feeTax"), "num"],
        t("review.evCol.source"),
      ]}
      onKeyDown={rowKeys}
    >
      {row.events.map((e) => (
        <tr key={e.id} data-row={e.id} className="click" onClick={() => onPage("imports", { tab: "history", account: e.account })}>
          <td>{e.date}</td>
          <td>{accountName(e.account)}</td>
          <td>{typeLabel(e.type)}</td>
          <td className="num">
            {Number(e.quantity)
              ? num(e.quantity) + " × " + e.currency + " " + num(e.price)
              : e.currency + " " + num(e.amount)}
          </td>
          <td className="num">
            {e.currency} {num(Number(e.fee || 0) + Number(e.tax || 0))}
          </td>
          <td>
            <span>{sourceLabel(e.reference)}</span>
            <button type="button" className="text-btn">
              {t("review.viewActivity")}
            </button>
          </td>
        </tr>
      ))}
    </Table>
  );
}

function DayDetail({ review, date, select }) {
  const { t, typeLabel } = useI18n();
  const [detail, setDetail] = useState(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("holdings");
  const [limit, setLimit] = useState(40);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError("");
    api
      .reviewDay({ ids: review.ids, date })
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [review.token, date]);
  const events = tab === "all" ? review.events : review.events.filter((e) => e.date === date);
  const shown = events.slice(0, limit);
  const rowKeys = useRowKeys(shown.map((e) => e.id), null, (id) => select(shown.find((e) => e.id === id).date));
  const reading = review.points.find((p) => p.date === date);
  return (
    <Card
      title={t("review.dayTitle")}
      action={
        <Field label={t("review.observedDate")}>
          <input
            type="date"
            value={date}
            min={review.base}
            max={review.to}
            onChange={(e) => {
              if (e.target.value >= review.base && e.target.value <= review.to) select(e.target.value);
            }}
          />
        </Field>
      }
    >
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      <div className="review-day-controls">
        {detail?.date === date && (
          <p className="review-readout">
            <span>
              {t("review.closingNav")} <b>{aud(detail.total, 2)}</b>
            </span>
            <span>
              {t("overview.cashValue")} <b>{aud(detail.cash, 2)}</b>
            </span>
            <span>
              {t("review.cashWeight")} <b>{detail.cashWeight == null ? "—" : fmt(detail.cashWeight * 100, 2) + "%"}</b>
            </span>
            <span>
              {t("review.sinceStart")} <b><Delta rate={reading?.portfolio} /></b>
            </span>
          </p>
        )}
        <Tabs
          items={[
            ["holdings", t("review.dayTab.holdings")],
            ["day", t("review.dayTab.day")],
            ["all", t("review.dayTab.all")],
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "holdings" ? (
        !detail || detail.date !== date ? (
          <small>{t("review.loadingHoldings")}</small>
        ) : (
          <>
            {detail.problems.length > 0 && <p className="warning">{detail.problems.join(t("common.comma"))}</p>}
            {detail.rows.length ? (
              <Table
                head={[
                  t("review.dayCol.account"),
                  t("review.dayCol.holding"),
                  [t("review.dayCol.qty"), "num"],
                  [t("review.dayCol.closeVal"), "num"],
                  t("review.dayCol.basis"),
                ]}
              >
                {detail.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.account}</td>
                    <td>{r.symbol}</td>
                    <td className="num">{r.cash ? fmt(r.quantity, 2) : num(r.quantity)}</td>
                    <td className="num">{aud(r.value, 2)}</td>
                    <td>
                      {r.reason || r.priceDate || "—"}
                      {r.currency !== "AUD" && <small>{t("review.fxDateTag", { date: r.fxDate || t("review.missingWord") })}</small>}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>{t("review.noDayHoldings")}</Empty>
            )}
          </>
        )
      ) : events.length ? (
        <>
          <Table
            head={[
              t("review.evCol.date"),
              t("review.evCol.account"),
              t("review.evCol.record"),
              [t("review.allCol.qtyPrice"), "num"],
              [t("review.allCol.fee"), "num"],
            ]}
            onKeyDown={rowKeys}
          >
            {shown.map((e) => (
              <tr key={e.id} data-row={e.id} className="click" onClick={() => select(e.date)}>
                <td>
                  <button type="button" className="text-btn">
                    {e.date}
                  </button>
                </td>
                <td>{e.account}</td>
                <td>
                  {typeLabel(e.type)} {e.symbol}
                  <small>{e.comment}</small>
                </td>
                <td className="num">
                  {e.currency}{" "}
                  {Number(e.quantity)
                    ? num(e.quantity) + (e.price != null ? " × " + num(e.price) : "")
                    : num(e.amount)}
                </td>
                <td className="num">{Number(e.fee) ? num(e.fee) : "—"}</td>
              </tr>
            ))}
          </Table>
          {events.length > limit && <button onClick={() => setLimit(limit + 40)}>{t("review.moreEvents")}</button>}
        </>
      ) : (
        <Empty>{t("review.noPeriodEvents")}</Empty>
      )}
    </Card>
  );
}

function Notes({ review, notes, opened, comparable, reopen, save, busy, accountName }) {
  const { t, formatDate } = useI18n();
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const draftId = useRef(null);
  const series = [{ id: "portfolio", name: t("review.portfolioName") }, ...review.series];
  const metricLabels = {
    totalReturn: t("review.metric.totalReturn"),
    gap: t("review.metric.gap"),
    maxDrawdown: t("review.metric.maxDrawdown"),
  };
  return (
    <Card
      title={t("review.notesTitle")}
      action={
        <button onClick={() => setWriting(!writing)}>
          <Bookmark size={15} /> {t("review.writeNote")}
        </button>
      }
    >
      {writing && (
        <form
          className="review-note-form"
          onSubmit={async (e) => {
            e.preventDefault();
            draftId.current ??= crypto.randomUUID();
            if (await save(draft, draftId.current)) {
              draftId.current = null;
              setDraft("");
              setWriting(false);
            }
          }}
        >
          <Field label={t("review.notePrompt")}>
            <textarea
              autoFocus
              required
              maxLength={8000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <button className="primary" disabled={busy || !draft.trim()}>
            {t("review.saveNoteBtn")}
          </button>
        </form>
      )}
      {opened && (
        <section className="review-note-comparison">
          <h3>{t("review.noteComparisonTitle")}</h3>
          <p>{opened.text}</p>
          {!comparable && <p className="cap">{t("review.notComparableNote")}</p>}
          <Table head={[t("review.noteCol.subject"), t("review.noteCol.metric"), [t("review.noteCol.atSave"), "num"], [t("review.noteCol.current"), "num"]]}>
            {series.flatMap(({ id, name }) =>
              Object.keys(metricLabels)
                .filter((key) => key in (opened.metrics[id] || {}))
                .map((key) => {
                  const unit = key === "gap" ? t("review.metric.gapUnit") : "%";
                  const before = directedPct(opened.metrics[id][key], unit),
                    after = comparable ? directedPct(review.metrics[id]?.[key], unit) : "—";
                  return (
                    <tr key={id + key}>
                      <td>{name}</td>
                      <td>{metricLabels[key]}</td>
                      <td className="num">{before}</td>
                      <td className={"num " + (comparable && before !== after ? "review-changed" : "")}>{after}</td>
                    </tr>
                  );
                }),
            )}
          </Table>
        </section>
      )}
      {notes.length ? (
        <div className="review-notes">
          {notes.map((note) => (
            <button key={note.id} onClick={() => reopen(note)}>
              <span>
                <b>
                  {note.from} – {note.to}
                </b>
                <small>
                  {t("review.recordedOn", {
                    accounts: note.ids.map(accountName).join(t("common.comma")),
                    date: formatDate(note.created),
                  })}
                </small>
              </span>
              <span>{note.text}</span>
              <span className="review-note-open">{t("review.reopenRange")}</span>
            </button>
          ))}
        </div>
      ) : (
        !writing && <p className="muted">{t("review.notesHint")}</p>
      )}
    </Card>
  );
}

export function Performance({ d, mode, run, reload, filters, onFilters, onPage }) {
  const { t } = useI18n();
  const { aspect } = useShell();
  const docked = aspect === "21:9";
  // The account scope, valuation date and period are the global filters (spec §2.3).
  const valuationDate = filters.date || d.date;
  const scope = { ids: d.selected, ...periodQuery(filters, valuationDate) };
  const [version, setVersion] = useState(0),
    [loaded, setLoaded] = useState(null),
    [error, setError] = useState("");
  const [benchmarkId, setBenchmarkId] = useState("SP500TR");
  const [part, setPart] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null),
    [opened, setOpened] = useState(null);
  const [busy, setBusy] = useState(false),
    [updating, setUpdating] = useState(0),
    [results, setResults] = useState([]);
  const lock = useRef(false),
    attempted = useRef(new Set());
  const scopeKey = JSON.stringify(scope),
    key = JSON.stringify([scope, version]);
  // The last result stays on screen, dimmed, while a new period is being worked out.
  const review = loaded?.review || null,
    current = loaded?.key === key;
  const inScope = loaded?.scopeKey === scopeKey;
  const names = new Map(d.accounts.map((a) => [a.id, a.name]));
  const accountName = (id) => names.get(id) || id;
  const activeIds = d.accounts.filter((a) => a.active).map((a) => a.id);
  const noteScopeAvailable = (note) => note.ids.length > 0 && note.ids.every((id) => activeIds.includes(id));
  const comparable = opened && noteScopeAvailable(opened) && review?.to === opened.to &&
    [review.from, review.requested].includes(opened.from) &&
    review.ids.length === opened.ids.length && opened.ids.every((id) => review.ids.includes(id));
  useEffect(() => {
    let active = true;
    setError("");
    if (scope.ids.length)
      api
        .portfolioReview(scope)
        .then((result) => {
          if (active) setLoaded({ key, scopeKey, review: result });
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    return () => {
      active = false;
    };
  }, [key]);
  // Missing closes, FX rates and index levels are fetched once per period, without being asked.
  useEffect(() => {
    if (!current || !review.autoUpdate || !review.needsData || attempted.current.has(scopeKey)) return;
    attempted.current.add(scopeKey);
    setUpdating((n) => n + 1);
    api
      .refreshReview({ token: review.token, auto: true })
      .then((result) => {
        if (!result) return;
        setResults(result);
        setVersion((v) => v + 1);
        // New closes also change the valuations shown on the other pages.
        reload();
      })
      .catch(() => {})
      .finally(() => setUpdating((n) => n - 1));
  }, [current && review.token]);
  function change(next, note = null) {
    if (next === filters && !note) return;
    setOpened(note);
    setDetail(null);
    setExpanded(false);
    setResults([]);
    onFilters(next);
  }
  function zoom(from, to) {
    change(chooseRange(filters, from, to, valuationDate));
  }
  const openDay = (date) => setDetail({ kind: "day", date });
  const selectDaily = (date) => setDetail({ kind: docked ? "daily" : "day", date });
  const openHolding = (row) => onPage("holdings", { assetId: row.assetId, symbol: row.label });
  async function act(fn) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      return await run(fn, false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    await act(async () => {
      const result = await api.refreshReview({ token: review.token });
      setResults(result);
      setVersion((v) => v + 1);
      reload();
    });
  }
  async function save(text, id) {
    return act(async () => {
      const note = await api.saveReviewNote({ token: review.token, text, id });
      setLoaded((prev) =>
        prev?.key === key
          ? {
              ...prev,
              review: { ...prev.review, notes: [note, ...prev.review.notes.filter((n) => n.id !== note.id)] },
            }
          : prev,
      );
      setOpened(note);
      return true;
    });
  }
  const benchmarks = review ? benchmarksOf(review) : [];
  const benchmark = benchmarks.find((b) => b.id === benchmarkId) || benchmarks[0];
  const period = isCustom(filters) ? t("period.customLabel") : periodLabel(filters.period, t);
  const dataPanel = review && (
    <DataPanel review={review} mode={mode} disabled={!current || busy || updating > 0} refresh={refresh} results={results} />
  );
  return (
    <>
      <PeriodControl
        filters={filters}
        range={current ? review.period : resolvePeriod(scope)}
        valuationDate={valuationDate}
        custom
        days
        onChange={(next) => change(next)}
      >
        <span className="sp" />
        <div className="review-tools">
          <button type="button" className="btn sm" disabled={!current} onClick={() => setDetail({ kind: "daily" })}>
            {t("review.btnDailyData")}
          </button>
          <button type="button" className="btn sm" disabled={!current} onClick={() => setDetail({ kind: "methods" })}>
            {t("review.btnMethods")}
          </button>
        </div>
      </PeriodControl>
      {updating > 0 && (
        <p className="review-status" role="status">
          <RefreshCw size={14} /> {t("review.updatingStatus")}
        </p>
      )}
      {error ? (
        <Card>
          <p role="alert" className="warning">
            {error}
          </p>
          <button onClick={() => change(choosePreset(filters, "ytd"))}>{t("review.resetRange")}</button>
        </Card>
      ) : !scope.ids.length ? (
        <Empty>{t("review.needAccount")}</Empty>
      ) : !review ? (
        <Card>
          <p role="status">{t("review.calculating")}</p>
        </Card>
      ) : (
        <div className={"review-body" + (current ? "" : " stale")} aria-busy={!current} inert={!current}>
          <div className="review-layout">
            <div className="review-main">
              <Verdict review={review} benchmark={benchmark} period={period} />
              <ReviewChart
                review={review}
                benchmarks={benchmarks}
                benchmark={benchmark}
                chooseBenchmark={setBenchmarkId}
                select={openDay}
                zoom={zoom}
              />
              <Breakdown
                data={review.breakdown}
                period={period}
                selected={part}
                select={setPart}
                openHolding={openHolding}
              />
              <Contributions
                data={review.contributions}
                total={review.money?.gain}
                period={period}
                expanded={expanded}
                setExpanded={setExpanded}
                openHolding={openHolding}
                openEvidence={(row) => setDetail({ kind: "source", row })}
              />
              <MethodSummary dataPanel={detail?.kind === "methods" ? null : dataPanel} />
            </div>
            <div className="review-rail">
              {(docked || !inScope || !detail?.date) && (
                <DayDetail
                  review={review}
                  date={(inScope && detail?.date) || review.metrics.portfolio.asOf || review.to}
                  select={openDay}
                />
              )}
              <UnderperformancePeriods review={review} benchmark={benchmark} select={openDay} />
              <Notes
                key={scopeKey}
                review={review}
                notes={review.notes}
                opened={current ? opened : null}
                comparable={comparable}
                reopen={(note) => {
                  if (!noteScopeAvailable(note)) {
                    setOpened(note);
                    return;
                  }
                  const date = note.to > valuationDate ? note.to : filters.date;
                  const range = chooseRange({ ...filters, date }, note.from, note.to, date || valuationDate);
                  change({ ...range, ids: accountScope(note.ids, activeIds) }, note);
                  setVersion((v) => v + 1);
                }}
                save={save}
                busy={busy}
                accountName={accountName}
              />
            </div>
          </div>
          {inScope && detail?.kind === "daily" && (docked || !detail.date) && (
            <Detail wide title={detail.date ? t("review.dayDetailTitle", { date: detail.date }) : t("review.dailyDataTitle")} onClose={() => setDetail(null)}>
              <DailyTable review={review} benchmark={benchmark} selected={detail.date} select={selectDaily} docked={docked} />
            </Detail>
          )}
          {inScope && detail?.kind === "methods" && (
            <Detail title={t("review.btnMethods")} onClose={() => setDetail(null)}>
              {dataPanel}
            </Detail>
          )}
          {inScope && !docked && detail?.date && (
            <Detail wide title={t("review.dayDetailTitle", { date: detail.date })} onClose={() => setDetail(null)}>
              <DayDetail review={review} date={detail.date} select={openDay} />
            </Detail>
          )}
          {inScope && detail?.kind === "source" && (
            <Detail wide title={t("review.sourceDetailTitle", { label: detail.row.label })} onClose={() => setDetail(null)}>
              <ContributionEvidence row={detail.row} accountName={accountName} onPage={onPage} />
            </Detail>
          )}
        </div>
      )}
    </>
  );
}
