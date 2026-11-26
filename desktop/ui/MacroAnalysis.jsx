import React, { useEffect, useState } from "react";
import { api } from "./common";
import { Icon } from "./icons";
import { LineChart } from "./charts/LineChart";
import { useI18n } from "./i18n.jsx";
import "./macroAnalysis.css";

const ranges = [30, 90, 365];
const day = 86_400_000;
const eastern = "America/New_York";
const fromDate = (date) => new Date(date + "T00:00:00Z");

const SENTIMENT_ZONES = [
  { key: "extremeFear", range: "0–24", min: 0, max: 24, color: "var(--macro-g1)" },
  { key: "fear", range: "25–44", min: 25, max: 44, color: "var(--macro-g2)" },
  { key: "neutral", range: "45–55", min: 45, max: 55, color: "var(--macro-g3)" },
  { key: "greed", range: "56–74", min: 56, max: 74, color: "var(--macro-g4)" },
  { key: "extremeGreed", range: "75–100", min: 75, max: 100, color: "var(--macro-g5)" },
];
const ZONE_BOUNDS = [0, 25, 45, 56, 75, 100];

function zoneIndexOf(score) {
  if (!Number.isFinite(score)) return -1;
  for (let i = 4; i >= 0; i--) {
    if (score >= ZONE_BOUNDS[i]) return i;
  }
  return 0;
}

function useMacroFormats() {
  const { intlLocale, t } = useI18n();
  const date = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeZone: "UTC" });
  const shortDate = new Intl.DateTimeFormat(intlLocale, { month: "numeric", day: "numeric", timeZone: "UTC" });
  const monthDay = new Intl.DateTimeFormat(intlLocale, { month: "long", day: "numeric", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long", timeZone: "UTC" });
  const monthOnly = new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "short", timeZone: "UTC" });
  const weekday = new Intl.DateTimeFormat(intlLocale, { weekday: "long", timeZone: "UTC" });
  const easternTime = new Intl.DateTimeFormat(intlLocale, {
    timeZone: eastern, dateStyle: "medium", timeStyle: "short",
  });
  const easternClock = new Intl.DateTimeFormat(intlLocale, {
    timeZone: eastern, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const easternIsoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: eastern, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const localClock = new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit", minute: "2-digit", hour12: false,
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
    shortDate: (value) => shortDate.format(fromDate(value)),
    monthDay: (value) => monthDay.format(fromDate(value)),
    month: (value) => month.format(fromDate(value + "-01")),
    monthOnly: (value) => monthOnly.format(fromDate(value + "-01")),
    weekday: (value) => weekday.format(fromDate(value)),
    time: (value) => easternTime.format(new Date(value)),
    etClock: (value) => easternClock.format(new Date(value)),
    etIsoDate: (value) => easternIsoDate.format(new Date(value)),
    localClock: (value) => localClock.format(new Date(value)),
    rate: (value) => rate.format(value / 100),
    headline: (value) => headline.format(value / 100),
    bp: bp.format,
    number: decimal.format,
  };
}

function SentimentGauge({ score, activeZone, ariaLabel }) {
  const cx = 120;
  const cy = 118;
  const r = 94;
  const point = (angle, radius = r) => {
    const rad = (angle * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy - radius * Math.sin(rad)];
  };
  const hasScore = Number.isFinite(score);
  const clamped = hasScore ? Math.max(0, Math.min(100, score)) : 0;
  const [tipX, tipY] = point(180 - clamped * 1.8, r - 22);

  return (
    <svg className="macro-gauge" viewBox="0 -12 240 154" role="img" aria-label={ariaLabel}>
      {SENTIMENT_ZONES.map((zone, index) => {
        const a0 = 180 - ZONE_BOUNDS[index] * 1.8 - (index > 0 ? 1 : 0);
        const a1 = 180 - ZONE_BOUNDS[index + 1] * 1.8 + (index < 4 ? 1 : 0);
        const [x0, y0] = point(a0);
        const [x1, y1] = point(a1);
        return (
          <path
            key={zone.key}
            className="macro-gauge-arc"
            d={`M${x0.toFixed(1)},${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`}
            stroke={hasScore ? zone.color : "rgba(255,255,255,0.22)"}
            opacity={hasScore ? (index === activeZone ? 1 : 0.36) : 0.5}
          />
        );
      })}
      {hasScore && (
        <>
          <line
            x1={cx}
            y1={cy}
            x2={tipX.toFixed(1)}
            y2={tipY.toFixed(1)}
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="7" fill="currentColor" />
        </>
      )}
      <text className="macro-gauge-tick" x={cx - r} y={cy + 20} textAnchor="middle">0</text>
      <text className="macro-gauge-tick" x={cx} y={cy - r - 16} textAnchor="middle">50</text>
      <text className="macro-gauge-tick" x={cx + r} y={cy + 20} textAnchor="middle">100</text>
    </svg>
  );
}

function SentimentHero({ fmt, sentiment, loading }) {
  const { t } = fmt;
  const hasScore = Number.isFinite(sentiment?.score);
  const activeZone = hasScore ? zoneIndexOf(sentiment.score) : -1;
  const ratingText = hasScore && sentiment?.rating ? t("macro.sentiment.rating." + sentiment.rating) : "";
  const ariaLabel = hasScore
    ? `${t("macro.sentiment.title")} ${fmt.number(sentiment.score)} ${ratingText}`
    : t("macro.sentiment.title");

  return (
    <section className="card hero macro-sentiment" aria-labelledby="macro-sentiment-heading">
      <div className="macro-chead">
        <h2 id="macro-sentiment-heading" className="macro-heading">
          <Icon name="gauge" />
          <span>{t("macro.sentiment.title")}</span>
        </h2>
        <span className="sp" />
        {hasScore && sentiment?.updatedAt && (
          <time className="cap" dateTime={sentiment.updatedAt}>
            {t("macro.sentiment.updatedAt", { time: fmt.time(sentiment.updatedAt) })}
          </time>
        )}
      </div>

      <div className="macro-fg-body">
        <div className="macro-fg-dial">
          <div className="macro-fg-svg-wrap">
            <SentimentGauge score={sentiment?.score} activeZone={activeZone} ariaLabel={ariaLabel} />
          </div>
          {hasScore ? (
            <>
              <div className="macro-fg-score">
                {fmt.number(sentiment.score)}
                <small>/ 100</small>
              </div>
              <div className="macro-fg-rating">
                <i
                  className="macro-dot"
                  style={{ background: activeZone >= 0 ? SENTIMENT_ZONES[activeZone].color : "currentColor" }}
                />
                <span>{ratingText}</span>
              </div>
            </>
          ) : (
            <p className="macro-fg-empty">
              {t(loading ? "macro.sentiment.refreshing" : "macro.sentiment.unavailable")}
            </p>
          )}
        </div>

        <div className="macro-fg-side">
          <div className="macro-zones" role="list" aria-label={t("macro.sentiment.scaleAria")}>
            {SENTIMENT_ZONES.map((zone, index) => (
              <div
                key={zone.key}
                role="listitem"
                className={"macro-zone" + (index === activeZone ? " on" : "")}
                style={{ background: zone.color }}
              >
                <em>{t("macro.sentiment.rating." + zone.key)}</em>
                <small>{zone.range}</small>
              </div>
            ))}
          </div>
          <p className="macro-fg-method">{t("macro.sentiment.method")}</p>
        </div>
      </div>

      <div className="note macro-fg-foot">
        <span>{t("macro.sentiment.note")}</span>
        <span className="macro-fg-sep">·</span>
        <span>{t("macro.sentiment.source", { name: sentiment?.source ?? "Fear & Greed Flow" })}</span>
        {sentiment?.status === "stale" && (
          <>
            <span className="macro-fg-sep">·</span>
            <span className="macro-fg-stale">{t("macro.sentiment.stale")}</span>
          </>
        )}
      </div>
    </section>
  );
}

function CpiCalendar({ fmt, reading, loading, nowMs }) {
  const { t } = fmt;
  const latest = reading?.latest;
  const schedule = reading?.schedule;

  const items = [];
  if (schedule?.upcoming) {
    const isoDate = fmt.etIsoDate(schedule.upcoming.scheduledAt);
    const days = Math.max(0, Math.round((fromDate(isoDate) - fromDate(fmt.etIsoDate(nowMs))) / day));
    items.push({
      id: "upcoming",
      tag: t("macro.cpi.next"),
      tagTone: "ok",
      referenceMonth: schedule.upcoming.referenceMonth,
      isoDate,
      timestamp: schedule.upcoming.scheduledAt,
      days,
      sub: `${fmt.shortDate(isoDate)} · ${t("macro.cpi.countdownShort", { days })}`,
      isNext: true,
    });
  }
  if (schedule?.awaiting) {
    const isoDate = fmt.etIsoDate(schedule.awaiting.scheduledAt);
    items.push({
      id: "awaiting",
      tag: t("macro.cpi.awaiting"),
      tagTone: "wn",
      referenceMonth: schedule.awaiting.referenceMonth,
      isoDate,
      timestamp: schedule.awaiting.scheduledAt,
      sub: `${fmt.shortDate(isoDate)} · ${t("macro.cpi.awaiting")}`,
      isNext: true,
    });
  }
  if (latest) {
    const ts = latest.publishedAt ?? latest.scheduledAt;
    const isoDate = ts ? fmt.etIsoDate(ts) : latest.referenceMonth + "-01";
    const resultText = Number.isFinite(latest.yearOverYearPct)
      ? t("macro.cpi.yoyShort", { value: fmt.headline(latest.yearOverYearPct) })
      : t("macro.cpi.indexShort", { value: fmt.number(latest.indexValue) });
    items.push({
      id: "latest",
      tag: t("macro.cpi.latestTag"),
      tagTone: "ok",
      referenceMonth: latest.referenceMonth,
      isoDate,
      timestamp: ts,
      sub: ts ? `${fmt.shortDate(isoDate)} · ${resultText}` : resultText,
      isNext: false,
    });
  }

  const [selectedId, setSelectedId] = useState(null);
  const active = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const activeDayNum = active ? Number(active.isoDate.slice(8, 10)) : "—";
  const activeMonthNum = active ? Number(active.isoDate.slice(5, 7)) : null;

  return (
    <section className="card macro-cpi" aria-labelledby="macro-cpi-heading">
      <div className="macro-chead">
        <h2 id="macro-cpi-heading" className="macro-heading">
          <Icon name="calendar" />
          <span>{t("macro.cpi.title")}</span>
        </h2>
        <span className="sp" />
        <span className="cap">{t("macro.sentiment.source", { name: reading?.source ?? "U.S. Bureau of Labor Statistics" })}</span>
      </div>

      {active ? (
        <div className="macro-cpi-wrap">
          <div className="macro-leaf-col">
            <div className="macro-leaf-wrap">
              <div className="macro-leaf" key={active.id}>
                <div className="macro-rings" aria-hidden="true"><i /><i /></div>
                <div className={"macro-leaf-top" + (active.isNext ? "" : " pub")}>
                  {active.isoDate.slice(0, 4)} · {activeMonthNum ? fmt.monthOnly(active.isoDate.slice(0, 7)).replace(/^\d+\S*\s*/, "") : ""}
                </div>
                <div className="macro-leaf-day">{activeDayNum}</div>
                <div className="macro-leaf-wd">{fmt.weekday(active.isoDate)}</div>
                {active.timestamp && (
                  <div className="macro-leaf-foot">
                    {fmt.etClock(active.timestamp)} ET<br />
                    {t("macro.cpi.localTime", { time: fmt.localClock(active.timestamp) })}
                  </div>
                )}
              </div>
            </div>
            {active.id === "upcoming" ? (
              <div className="macro-cd">
                <span>{t("macro.cpi.countdown", { days: active.days })}</span>
              </div>
            ) : (
              <div className="macro-cd">
                <span className={"tag " + active.tagTone}>{active.tag}</span>
              </div>
            )}
          </div>

          <div className="macro-cpi-list" role="list">
            {items.map((item) => {
              const dayPart = Number(item.isoDate.slice(8, 10));
              const monthPart = Number(item.isoDate.slice(5, 7));
              return (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  className={"macro-rel" + (item.id === active.id ? " on" : "")}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="macro-rel-d">
                    <span>{dayPart}<small>{monthPart}</small></span>
                  </span>
                  <span className="macro-rel-tx">
                    <b>{fmt.month(item.referenceMonth)}</b>
                    <span className="cap">{item.sub}</span>
                  </span>
                  <span className={"tag " + item.tagTone}>{item.tag}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="cap">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</p>
      )}

      <div className="macro-cpi-summary">
        <div className="macro-sbox res">
          <div className="macro-sbox-head">
            <span className="cap">{t("macro.cpi.latest")}</span>
            {latest && <span className="tag ok">{fmt.month(latest.referenceMonth)}</span>}
          </div>
          {latest ? (
            <>
              <div className="macro-sbox-big">
                {Number.isFinite(latest.yearOverYearPct)
                  ? fmt.headline(latest.yearOverYearPct)
                  : fmt.number(latest.indexValue)}
              </div>
              <span className="cap">
                {Number.isFinite(latest.yearOverYearPct)
                  ? `${t("macro.cpi.yoy")} · ${t("macro.cpi.index", { value: fmt.number(latest.indexValue) })}`
                  : `${t("macro.cpi.index", { value: fmt.number(latest.indexValue) })} · ${t("macro.cpi.missingComparison")}`}
              </span>
              {reading.status === "stale" && <span className="macro-stale cap">{t("macro.sentiment.stale")}</span>}
            </>
          ) : (
            <span className="cap">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</span>
          )}
        </div>

        <div className="macro-sbox">
          <div className="macro-sbox-head">
            <span className="cap">{schedule?.awaiting ? t("macro.cpi.awaiting") : t("macro.cpi.next")}</span>
            {(schedule?.upcoming || schedule?.awaiting) && (
              <span className="tag">{fmt.month((schedule.upcoming ?? schedule.awaiting).referenceMonth)}</span>
            )}
          </div>
          {schedule?.upcoming ? (
            (() => {
              const isoDate = fmt.etIsoDate(schedule.upcoming.scheduledAt);
              const days = Math.max(0, Math.round((fromDate(isoDate) - fromDate(fmt.etIsoDate(nowMs))) / day));
              return (
                <>
                  <div className="macro-sbox-big">{fmt.monthDay(isoDate)}</div>
                  <span className="cap">
                    {t("macro.cpi.countdownShort", { days })} · {fmt.etClock(schedule.upcoming.scheduledAt)} ET
                    <br />
                    {t("macro.cpi.localTime", { time: fmt.localClock(schedule.upcoming.scheduledAt) })} · {t("macro.cpi.noForecast")}
                  </span>
                </>
              );
            })()
          ) : schedule?.awaiting ? (
            <>
              <div className="macro-sbox-big">{t("macro.cpi.awaiting")}</div>
              <span className="cap">
                {fmt.time(schedule.awaiting.scheduledAt)} · {t("macro.cpi.noForecast")}
              </span>
            </>
          ) : (
            <span className="cap">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</span>
          )}
        </div>
      </div>

      {(schedule?.status === "bundled" || schedule?.status === "stale") && (
        <p className={schedule.status === "stale" ? "macro-stale cap" : "cap"}>
          {t(schedule.status === "bundled" ? "macro.cpi.bundledSchedule" : "macro.cpi.staleSchedule")}
        </p>
      )}
    </section>
  );
}

function TreasuryUnified({ fmt, reading, loading }) {
  const { t } = fmt;
  const [range, setRange] = useState(30);
  const data = reading?.data;
  const latest = data?.latest;
  const history = data?.history ?? [];
  const end = latest?.date;
  const endTime = end && Date.parse(end);
  const first = history.find((row) => Number.isFinite(row.valuePct))?.date;
  const supported = ranges.filter((days) => days === 30 || (first && endTime - Date.parse(first) >= (days - 7) * day));
  const selected = supported.includes(range) ? range : 30;
  // Preserve null values within the visible history so the shared chart leaves a gap.
  const points = end ? history.filter(({ date }) => date <= end && Date.parse(date) >= endTime - selected * day) : [];
  const last = points.findLastIndex((point) => Number.isFinite(point.valuePct));
  const validValues = points.map((p) => p.valuePct).filter(Number.isFinite);
  const periodHigh = validValues.length ? Math.max(...validValues) : null;
  const periodLow = validValues.length ? Math.min(...validValues) : null;
  const periodFirst = validValues.length ? validValues[0] : null;
  const periodLast = validValues.length ? validValues[validValues.length - 1] : null;
  const periodChangeBp = periodFirst != null && periodLast != null ? Math.round((periodLast - periodFirst) * 100) : null;
  const vsPressureBp = latest ? Math.round((latest.valuePct - 4.5) * 100) : null;
  // Map 2.5%..6.5% onto 0..100% (loose <3.5% = 25%, neutral 3.5-4.5% = 25%, elevated >4.5% = 50%).
  const regimePct = latest
    ? Math.max(4, Math.min(96, ((latest.valuePct - 2.5) / 4.0) * 100))
    : null;

  return (
    <section className="card macro-tsy" aria-labelledby="macro-treasury-heading">
      <div className="macro-tsy-body">
        <div className="macro-tsy-main">
          <div className="macro-chead">
            <h2 id="macro-treasury-heading" className="macro-heading">
              <Icon name="performance" />
              <span>{t("macro.treasury.title")}</span>
            </h2>
            <span className="sp" />
            {supported.length > 1 && (
              <div className="seg" role="group" aria-label={t("macro.treasury.range")}>
                {supported.map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={days === selected ? "on" : ""}
                    aria-pressed={days === selected}
                    onClick={() => setRange(days)}
                  >
                    {t("macro.treasury.range." + days)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {latest ? (
            <div className="macro-kpi-row">
              <div className="macro-kpi-v">{fmt.rate(latest.valuePct)}</div>
              <div className="macro-kpi-d">
                {data.changeBp === null || !data.previous
                  ? t("macro.treasury.compareUnavailable")
                  : t("macro.treasury.change", { bp: fmt.bp(data.changeBp), date: fmt.date(data.previous.date) })}
              </div>
              <span className="sp" />
              <div className="cap macro-kpi-meta">
                <span>{t("macro.treasury.observed", { date: fmt.date(latest.date) })}</span>
                <span>{t("macro.sentiment.source", { name: reading?.source ?? "Federal Reserve Board" })}</span>
                {reading.publication?.status === "awaiting" && (
                  <span className="macro-stale">{t("macro.treasury.awaiting")}</span>
                )}
                {reading.status === "stale" && (
                  <span className="macro-stale">{t("macro.sentiment.stale")}</span>
                )}
              </div>
            </div>
          ) : (
            <p className="cap">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</p>
          )}

          {last >= 0 ? (
            <div className="chart macro-trend-chart">
              <LineChart
                key={selected}
                ariaLabel={t("macro.treasury.trend")}
                dates={points.map((point) => point.date)}
                series={[
                  {
                    name: t("macro.treasury.title"),
                    color: "var(--s1)",
                    values: points.map((point) => point.valuePct),
                    width: 2.2,
                    area: true,
                  },
                  {
                    name: t("macro.treasury.pressureLine"),
                    color: "var(--warn)",
                    values: points.map(() => 4.5),
                    dash: "5 4",
                    width: 1.2,
                  },
                ]}
                markers={[{ index: last, value: points[last].valuePct, color: "var(--s1)" }]}
                height={240}
                labels={false}
                formatAxis={fmt.rate}
                formatValue={fmt.rate}
                formatDate={fmt.date}
              />
            </div>
          ) : (
            <p className="cap">{t(loading ? "macro.sentiment.refreshing" : "common.noData")}</p>
          )}

          {validValues.length > 0 && (
            <div className="macro-stats">
              <div>
                <span className="cap">{t("macro.treasury.stat.high")}</span>
                <b>{fmt.rate(periodHigh)}</b>
              </div>
              <div>
                <span className="cap">{t("macro.treasury.stat.low")}</span>
                <b>{fmt.rate(periodLow)}</b>
              </div>
              <div>
                <span className="cap">{t("macro.treasury.stat.change")}</span>
                <b>{periodChangeBp != null ? `${fmt.bp(periodChangeBp)} bp` : "—"}</b>
              </div>
              <div>
                <span className="cap">{t("macro.treasury.stat.vsPressure")}</span>
                <b>{vsPressureBp != null ? `${fmt.bp(vsPressureBp)} bp` : "—"}</b>
              </div>
            </div>
          )}
        </div>

        <aside className="macro-tsy-decoder" aria-label={t("macro.treasury.decoder.titleFallback")}>
          <h3>
            {latest
              ? t("macro.treasury.decoder.title", { rate: fmt.rate(latest.valuePct) })
              : t("macro.treasury.decoder.titleFallback")}
          </h3>
          <div className="macro-def">
            {t("macro.treasury.decoder.def")}
            <b>{t("macro.treasury.decoder.defHighlight")}</b>
          </div>

          <div>
            <div className="cap">{t("macro.treasury.decoder.level")}</div>
            <div className="macro-reg-bar">
              <i className="z1" style={{ width: "25%" }} />
              <i className="z2" style={{ width: "25%" }} />
              <i className="z3" style={{ width: "50%" }} />
              {regimePct != null && latest && (
                <b style={{ left: `${regimePct.toFixed(1)}%` }}>
                  <em>{fmt.rate(latest.valuePct)}</em>
                </b>
              )}
            </div>
            <div className="macro-reg-lab">
              <span style={{ width: "25%" }}>{t("macro.treasury.decoder.loose")}<br />&lt;3.5%</span>
              <span style={{ width: "25%" }}>{t("macro.treasury.decoder.neutral")}<br />3.5–4.5%</span>
              <span style={{ width: "50%" }}>{t("macro.treasury.decoder.high")}<br />&gt;4.5%</span>
            </div>
          </div>

          <div className="macro-imp-list">
            <div className="macro-imp up-press">
              <b aria-hidden="true">↑</b>
              <div>
                <h4>{t("macro.treasury.decoder.upTitle")}</h4>
                <p>{t("macro.treasury.decoder.upDesc")}</p>
              </div>
            </div>
            <div className="macro-imp down-lift">
              <b aria-hidden="true">↓</b>
              <div>
                <h4>{t("macro.treasury.decoder.downTitle")}</h4>
                <p>{t("macro.treasury.decoder.downDesc")}</p>
              </div>
            </div>
          </div>

          <p className="cap">{t("macro.treasury.decoder.cpiLink")}</p>
        </aside>
      </div>
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

  const phase = snapshot?.market?.phase;
  const phaseTone = phase === "regular" ? "open" : phase === "closed" ? "closed" : "ext";

  return (
    <div className="macro-page">
      <div className="macro-toolbar">
        <div className="macro-status-bar">
          <span className={"macro-phase-pill " + phaseTone}>
            <i aria-hidden="true" />
            <span>{t(phase ? "macro.market." + phase : "macro.market.title")}</span>
          </span>
          <span className="cap">
            <time dateTime={new Date(clock).toISOString()}>
              {t("macro.market.time", { time: fmt.time(clock) })}
            </time>
          </span>
        </div>
        <div className="macro-refresh">
          <p className="cap" role="status">{result && t(result)}</p>
          <button
            type="button"
            className="btn"
            disabled={refreshing}
            onClick={() => {
              setResult("");
              setRefreshing(true);
              setRequest((value) => value + 1);
            }}
          >
            {t(refreshing ? "macro.sentiment.refreshing" : "macro.sentiment.refresh")}
          </button>
        </div>
      </div>

      <div className="macro-top-grid">
        <SentimentHero fmt={fmt} sentiment={snapshot?.sentiment} loading={refreshing} />
        <CpiCalendar fmt={fmt} reading={snapshot?.cpi} loading={refreshing} nowMs={clock} />
      </div>

      <TreasuryUnified fmt={fmt} reading={snapshot?.treasury} loading={refreshing} />
    </div>
  );
}
