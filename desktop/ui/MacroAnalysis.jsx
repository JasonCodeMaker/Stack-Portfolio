import React, { useEffect, useState } from "react";
import { api } from "./common";
import { Grid } from "./Shell";
import { LineChart } from "./charts/LineChart";
import { useI18n } from "./i18n.jsx";
import "./macroAnalysis.css";

const layout = {
  1: [["treasury", "cpi", "sentiment", "trend"]],
  2: [["treasury", "trend"], ["cpi", "sentiment"]],
};
const ranges = [30, 90, 365];
const day = 86_400_000;
const eastern = "America/New_York";
const fromDate = (date) => new Date(date + "T00:00:00Z");

function useMacroFormats() {
  const { intlLocale, t } = useI18n();
  const date = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long", timeZone: "UTC" });
  const eventTime = new Intl.DateTimeFormat(intlLocale, {
    timeZone: eastern, dateStyle: "medium", timeStyle: "short",
  });
  const rate = new Intl.NumberFormat(intlLocale, {
    style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const headline = new Intl.NumberFormat(intlLocale, {
    style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1,
  });
  const bp = new Intl.NumberFormat(intlLocale, { signDisplay: "exceptZero" });
  const decimal = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 3 });
  return {
    t,
    date: (value) => date.format(fromDate(value)),
    month: (value) => month.format(fromDate(value + "-01")),
    time: (value) => eventTime.format(new Date(value)),
    rate: (value) => rate.format(value / 100),
    headline: (value) => headline.format(value / 100),
    bp: bp.format,
    number: decimal.format,
  };
}

function Treasury({ fmt, reading, loading }) {
  const { t } = fmt;
  const data = reading?.data;
  const latest = data?.latest;
  return (
    <section className="card macro-card" aria-labelledby="macro-treasury-heading">
      <h2 id="macro-treasury-heading">{t("macro.treasury.title")}</h2>
      {latest ? (
        <>
          <p className="macro-value">{fmt.rate(latest.valuePct)}</p>
          <p className="macro-meta">{t("macro.treasury.observed", { date: fmt.date(latest.date) })}</p>
          <p>{data.changeBp === null || !data.previous
            ? t("macro.treasury.compareUnavailable")
            : t("macro.treasury.change", { bp: fmt.bp(data.changeBp), date: fmt.date(data.previous.date) })}</p>
          {reading.publication?.status === "awaiting" && <p className="macro-stale">{t("macro.treasury.awaiting")}</p>}
          {reading.status === "stale" && <p className="macro-stale">{t("macro.sentiment.stale")}</p>}
        </>
      ) : <p className="macro-meta">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</p>}
      <p className="macro-meta">{t("macro.sentiment.source", { name: reading?.source ?? "Federal Reserve Board" })}</p>
    </section>
  );
}

function YieldTrend({ fmt, reading, loading }) {
  const { t } = fmt;
  const [range, setRange] = useState(30);
  const data = reading?.data;
  const history = data?.history ?? [];
  const end = data?.latest.date;
  const endTime = end && Date.parse(end);
  const first = history.find((row) => Number.isFinite(row.valuePct))?.date;
  const supported = ranges.filter((days) => days === 30 || (first && endTime - Date.parse(first) >= (days - 7) * day));
  const selected = supported.includes(range) ? range : 30;
  // Preserve null values within the visible history so the shared chart leaves a gap.
  const points = end ? history.filter(({ date }) => date <= end && Date.parse(date) >= endTime - selected * day) : [];
  const last = points.findLastIndex((point) => Number.isFinite(point.valuePct));
  return (
    <section className="card macro-card" aria-labelledby="macro-trend-heading">
      <header className="card-head macro-card-head">
        <h2 id="macro-trend-heading">{t("macro.treasury.trend")}</h2>
        {supported.length > 1 && (
          <div className="seg" role="group" aria-label={t("macro.treasury.range")}>
            {supported.map((days) => (
              <button key={days} type="button" className={days === selected ? "on" : ""}
                aria-pressed={days === selected} onClick={() => setRange(days)}>
                {t("macro.treasury.range." + days)}
              </button>
            ))}
          </div>
        )}
      </header>
      {last >= 0 ? (
        <div className="chart macro-trend-chart">
          <LineChart
            key={selected}
            ariaLabel={t("macro.treasury.trend")}
            dates={points.map((point) => point.date)}
            series={[{ name: t("macro.treasury.title"), color: "var(--s2)", values: points.map((point) => point.valuePct), width: 2 }]}
            markers={[{ index: last, value: points[last].valuePct, color: "var(--s2)" }]}
            height={240}
            labels={false}
            formatAxis={fmt.rate}
            formatValue={fmt.rate}
            formatDate={fmt.date}
          />
        </div>
      ) : <p className="macro-meta">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</p>}
    </section>
  );
}

function Cpi({ fmt, reading, loading }) {
  const { t } = fmt;
  const latest = reading?.latest;
  const schedule = reading?.schedule;
  const events = [
    ["awaiting", schedule?.awaiting],
    ["next", schedule?.upcoming],
  ];
  return (
    <section className="card macro-card" aria-labelledby="macro-cpi-heading">
      <h2 id="macro-cpi-heading">{t("macro.cpi.title")}</h2>
      <div className="macro-cpi-results">
        <div className="macro-cpi-event">
          <h3>{t("macro.cpi.latest")}</h3>
          {latest ? (
            <>
              <p>{fmt.month(latest.referenceMonth)}</p>
              {Number.isFinite(latest.yearOverYearPct) ? (
                <p className="macro-value">{fmt.headline(latest.yearOverYearPct)} <span>{t("macro.cpi.yoy")}</span></p>
              ) : (
                <p>{t("macro.cpi.missingComparison")}</p>
              )}
              <p className="macro-meta">{t("macro.cpi.index", { value: fmt.number(latest.indexValue) })}</p>
              {latest.publishedAt ? (
                <time dateTime={latest.publishedAt}>{t("macro.cpi.published", { time: fmt.time(latest.publishedAt) })}</time>
              ) : latest.scheduledAt && (
                <time dateTime={latest.scheduledAt}>{t("macro.cpi.scheduled", { time: fmt.time(latest.scheduledAt) })}</time>
              )}
              {reading.status === "stale" && <p className="macro-stale">{t("macro.sentiment.stale")}</p>}
            </>
          ) : (
            <p className="macro-meta">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</p>
          )}
        </div>
        {events.map(([key, event]) => event && (
          <div key={key} className="macro-cpi-event">
            <h3>{t("macro.cpi." + key)}</h3>
            <p>{fmt.month(event.referenceMonth)}</p>
            <time dateTime={event.scheduledAt}>{t("macro.cpi.scheduled", { time: fmt.time(event.scheduledAt) })}</time>
          </div>
        ))}
        {!schedule?.upcoming && !schedule?.awaiting && (
          <div className="macro-cpi-event">
            <h3>{t("macro.cpi.next")}</h3>
            <p className="macro-meta">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</p>
          </div>
        )}
      </div>
      {schedule?.status === "bundled" && <p className="macro-meta">{t("macro.cpi.bundledSchedule")}</p>}
      {schedule?.status === "stale" && <p className="macro-stale">{t("macro.cpi.staleSchedule")}</p>}
      <p className="macro-meta">{t("macro.sentiment.source", { name: reading?.source ?? "U.S. Bureau of Labor Statistics" })}</p>
    </section>
  );
}

function Sentiment({ fmt, sentiment, loading }) {
  const { t } = fmt;
  const hasScore = Number.isFinite(sentiment?.score);
  return (
    <section className="card macro-sentiment" aria-labelledby="macro-sentiment-heading">
      <h2 id="macro-sentiment-heading">{t("macro.sentiment.title")}</h2>
      <div className="macro-sentiment-body">
        <div className="macro-sentiment-figure" aria-hidden="true">
          <div className="macro-sentiment-gauge" data-available={hasScore}>
            <span className="macro-sentiment-arc" />
            {hasScore && (
              <>
                <span className="macro-sentiment-needle" style={{ "--needle-angle": (sentiment.score * 1.8 - 90) + "deg" }} />
                <span className="macro-sentiment-hub" />
              </>
            )}
          </div>
          <div className="macro-sentiment-scale"><span>0</span><span>50</span><span>100</span></div>
        </div>
        <div className="macro-sentiment-reading">
          {hasScore ? (
            <>
              <p className="macro-sentiment-score">{fmt.number(sentiment.score)}<span> / 100</span></p>
              <p className="macro-sentiment-rating">{t("macro.sentiment.rating." + sentiment.rating)}</p>
              <time dateTime={sentiment.updatedAt}>{t("macro.sentiment.updatedAt", { time: fmt.time(sentiment.updatedAt) })}</time>
              {sentiment.status === "stale" && <p className="macro-stale">{t("macro.sentiment.stale")}</p>}
            </>
          ) : (
            <p className="macro-sentiment-rating">{t(loading ? "macro.sentiment.refreshing" : "macro.sentiment.unavailable")}</p>
          )}
          <p className="macro-meta">{t("macro.sentiment.source", { name: sentiment?.source ?? "Fear & Greed Flow" })}</p>
        </div>
      </div>
      <details className="macro-method">
        <summary>{t("macro.sentiment.methodTitle")}</summary>
        <p>{t("macro.sentiment.method")}</p>
      </details>
    </section>
  );
}

export function MacroAnalysis() {
  const fmt = useMacroFormats();
  const { t } = fmt;
  const [snapshot, setSnapshot] = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState("");
  const [clock, setClock] = useState(Date.now);

  useEffect(() => {
    let active = true;
    async function readCache() {
      const cached = await api.macroMarket().catch(() => null);
      if (active) {
        if (cached) setSnapshot(cached);
        setClock(Date.now());
      }
    }
    async function load() {
      if (request === 0) await readCache();
      if (!active) return;
      try {
        const next = await api.refreshMacroMarket();
        if (active) {
          setSnapshot(next);
          if (request > 0) {
            const partial = [next.treasury, next.cpi, next.cpi.schedule, next.sentiment]
              .some(({ status }) => status === "unavailable" || status === "stale");
            setResult(partial ? "macro.refreshPartial" : "macro.refreshDone");
          }
        }
      } catch {
        if (active) setResult("macro.refreshFailed");
      } finally {
        if (active) {
          setClock(Date.now());
          setRefreshing(false);
        }
      }
    }
    void load();
    const timer = setInterval(readCache, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [request]);

  return (
    <div className="macro-page">
      <div className="macro-toolbar">
        <div>
          <p className="macro-market-phase">{t(snapshot ? "macro.market." + snapshot.market.phase : "macro.market.title")}</p>
          <p className="macro-meta"><time dateTime={new Date(clock).toISOString()}>{t("macro.market.time", { time: fmt.time(clock) })}</time></p>
        </div>
        <div className="macro-refresh">
          <p className="macro-meta" role="status">{result && t(result)}</p>
          <button type="button" className="btn" disabled={refreshing} onClick={() => {
            setResult("");
            setRefreshing(true);
            setRequest((value) => value + 1);
          }}>
            {t(refreshing ? "macro.sentiment.refreshing" : "macro.sentiment.refresh")}
          </button>
        </div>
      </div>
      <Grid layout={layout} panels={{
        treasury: <Treasury fmt={fmt} reading={snapshot?.treasury} loading={refreshing} />,
        cpi: <Cpi fmt={fmt} reading={snapshot?.cpi} loading={refreshing} />,
        sentiment: <Sentiment fmt={fmt} sentiment={snapshot?.sentiment} loading={refreshing} />,
        trend: <YieldTrend fmt={fmt} reading={snapshot?.treasury} loading={refreshing} />,
      }} />
    </div>
  );
}
