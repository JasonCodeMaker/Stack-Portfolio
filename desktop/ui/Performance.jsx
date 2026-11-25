import React, { useEffect, useRef, useState } from "react";
import { Bookmark, RefreshCw } from "lucide-react";
import { api, aud, directedPct, fmt, num, types, signedPct, tone, Card, Delta, Empty, Field, Table, Tabs } from "./common";
import { DivergingBar, LineChart, divergingScale, seriesColor } from "./charts";
import { Detail, useMainChartHeight, useRowKeys, useShell } from "./Shell";
import { resolvePeriod } from "../periods.js";
import { PeriodControl } from "./FilterControls";
import { accountScope, choosePreset, chooseRange, isCustom, periodLabels, periodQuery } from "./filters.js";
import "./performance.css";

const gapPoints = (v) => signedPct(v).replace("%", " pp");
const seriesOf = (review) => [{ id: "portfolio", name: "我的组合" }, ...review.series];
const errorText = (e) =>
  String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
const labels = { totalReturn: "区间收益", gap: "组合收益差", maxDrawdown: "最大回撤" };

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

const dateSpan = (from, to) => {
  const short = from.slice(0, 4) === to.slice(0, 4);
  return (short ? from.slice(5) : from) + " 至 " + (short ? to.slice(5) : to);
};

function Verdict({ review, benchmark, period }) {
  const own = review.metrics.portfolio;
  const index = review.metrics[benchmark.id];
  const drawdown = own.drawdown;
  const longest = index.longestUnderperformance;
  return (
    <div className="kpis review-metrics">
      <Metric name="时间加权收益率" title={"时间加权收益率 · " + period} value={own.totalReturn}>
        {review.measuredDays < 365
          ? "不满一年，不显示年化"
          : <>年化 <Delta rate={own.annualised} />
              {index.annualised != null && <> · {benchmark.name} <Delta rate={index.annualised} /></>}
            </>}
        {own.asOf && review.origin > review.base && <small>收益从 {review.origin} 起算</small>}
        {own.asOf && own.asOf !== review.to && <small>截至 {own.asOf} 收盘</small>}
      </Metric>
      <Metric title={"对" + benchmark.name} value={index.gap} format={gapPoints}>
        {index.gap == null ? "暂无同期比较" : <>指数 <Delta rate={index.totalReturn} /></>}
        {index.gap != null && index.asOf !== own.asOf && <small>截至 {index.asOf} 同期比较</small>}
      </Metric>
      <Metric title="最大回撤" value={own.maxDrawdown}>
        {drawdown?.peak ? (
          <>
            <span title={drawdown.peak + " 至 " + drawdown.trough}>{dateSpan(drawdown.peak, drawdown.trough)}</span>
            {drawdown.recovery
              ? "，" + (drawdown.recovery.slice(0, 4) === drawdown.trough.slice(0, 4)
                ? drawdown.recovery.slice(5)
                : drawdown.recovery) + " 收复"
              : "，尚未收复"}
          </>
        ) : drawdown ? "这段时间没有回撤" : "暂无回撤数据"}
      </Metric>
      <Metric title={"最长跑输 · 对" + benchmark.name} value={longest?.worst} format={gapPoints}>
        {longest ? (
          <>
            <span title={longest.from + " 至 " + longest.to}>{dateSpan(longest.from, longest.to)}</span>
            {"，" + longest.days + " 天"}
          </>
        ) : index.gap == null ? "暂无同期比较" : "这段时间没有明显跑输"}
      </Metric>
    </div>
  );
}

const chartModes = [
  ["returns", "累计收益"],
  ["gap", "收益差"],
  ["drawdown", "回撤"],
];
const benchmarksOf = (review) => review.series.map((b, i) => ({
  ...b,
  color: seriesColor(i + 1),
  dash: i === 0 ? "6 3" : "2 3",
}));
const through = (point, date, value) => date && point.date <= date ? value : null;

function ReviewChart({ review, benchmarks, benchmark, chooseBenchmark, select, zoom }) {
  const [mode, setMode] = useState("returns");
  const [chartRef, height] = useMainChartHeight();
  const view = mode === "drawdown" && !review.hasQuarter ? "returns" : mode;
  const own = review.metrics.portfolio, index = review.metrics[benchmark.id];
  const to = view === "gap" ? (index.gap == null ? null : index.asOf) :
    [own.asOf, ...benchmarks.map((b) => review.metrics[b.id].asOf)].filter(Boolean).sort().at(-1);
  const points = review.points.filter((p) => p.date >= review.origin && p.date <= to);
  const dates = points.map((p) => p.date);
  const portfolio = { name: "我的组合", color: seriesColor(0), width: 2.5 };
  const bands = [], markers = [];
  let series, label;

  if (view === "gap") {
    label = "收益差曲线 · 对" + benchmark.name;
    series = [{
      name: "对" + benchmark.name,
      color: "var(--l1)",
      width: 2,
      area: "sign",
      values: points.map((p) => p.gaps[benchmark.id]),
    }];
    const longest = index.longestUnderperformance;
    if (longest) bands.push({
      from: dates.indexOf(longest.from),
      to: dates.indexOf(longest.to),
      label: "最长跑输 " + directedPct(longest.worst, " pp"),
    });
  } else if (view === "drawdown") {
    label = "回撤曲线";
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
    label = "累计收益曲线";
    series = [
      { ...portfolio, values: points.map((p) => through(p, own.asOf, p.portfolio)) },
      ...benchmarks.map((b) => ({
        ...b,
        values: points.map((p) => through(p, review.metrics[b.id].asOf, p[b.id])),
      })),
    ];
  }

  return (
    <section className="card review-chart" aria-label="收益走势">
      <div className="row">
        <div className="seg" role="group" aria-label="主图视图">
          {(review.hasQuarter ? chartModes : chartModes.slice(0, 2)).map(([id, title]) => (
            <button type="button" key={id} className={view === id ? "on" : ""}
              aria-pressed={view === id} onClick={() => setMode(id)}>
              {title}
            </button>
          ))}
        </div>
        <span className="sp" />
        <div className="review-benchmarks" role="group" aria-label="对比基准">
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
        ) : <Empty>{label}暂无数据。</Empty>}
      </div>
    </section>
  );
}

const methods = [
  ["时间加权收益率", "每日收盘估值按澳元计。入金计在日初，出金计在日末。逐日收益连乘，剔除出入金影响。"],
  ["年化收益", "区间满 365 天时，将累计收益按 (1 + R) ^ (365 / 天数) − 1 折成年收益。"],
  ["收益差", "组合累计收益减所选指数累计收益，以百分点（pp）表示。指数为分红再投资总回报，折算为澳元。按双方都可计量的最近收盘日比较。"],
  ["最大回撤与最长跑输", "最大回撤是区间内从峰值到随后谷底的最大跌幅。最长跑输从收益差转负的首个收盘日起，至追平或比较结束。"],
  ["持仓贡献", "区间内证券的澳元价差，加可归属分红并扣交易费用。现金利息等账户收支单列。"],
];

function Methods() {
  return (
    <dl className="review-methods">
      {methods.map(([title, text]) => (
        <div key={title}><dt>{title}</dt><dd>{text}</dd></div>
      ))}
    </dl>
  );
}

function MethodSummary({ dataPanel }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="card review-method" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>口径说明</summary>
      {open && dataPanel}
    </details>
  );
}

function UnderperformancePeriods({ review, benchmark, select }) {
  const periods = review.intervals.filter((interval) => interval.id === benchmark.id);
  return (
    <Card title={"跑输时段 · " + benchmark.name}>
      {periods.length ? (
        <Table head={["首次观察到落后", "最后观察日", "状态", ["最大落后", "num"]]}>
          {periods.map((interval) => (
            <tr key={interval.from}>
              <td><button type="button" className="text-btn" onClick={() => select(interval.from)}>{interval.from}</button></td>
              <td>{interval.to}</td>
              <td>{{ recovered: "已追平", interrupted: "数据中断", open: "尚未追平" }[interval.status]}</td>
              <td className="num">{gapPoints(interval.worst)}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="cap">{review.metrics[benchmark.id].gap == null ? "暂无同期比较。" : "所选期间没有跑输时段。"}</p>}
    </Card>
  );
}

const coverage = (first, last) => first && last ? first + " 至 " + last : "—";

function DataPanel({ review, mode, disabled, refresh, results }) {
  const done = results.filter((r) => !r.error),
    failed = results.filter((r) => r.error);
  return (
    <>
      <h3>数据来源</h3>
      <dl className="review-methods">
        <div>
          <dt>组合收盘估值</dt>
          <dd>账本中的历史收盘价、资金流水与汇率</dd>
          <dd className="cap">{coverage(review.origin, review.metrics.portfolio.asOf)}</dd>
        </div>
        {review.series.map((b) => (
          <div key={b.id}>
            <dt>{b.name}</dt>
            <dd>{b.source}</dd>
            <dd className="cap">{coverage(b.first, b.last)}</dd>
            <dd className="cap">区间最大回撤 <Delta rate={review.metrics[b.id].maxDrawdown} /></dd>
          </div>
        ))}
        <div>
          <dt>美元兑澳元</dt>
          <dd>{review.fx.sources.join("、") || "Yahoo Finance · AUDUSD=X"}</dd>
          <dd className="cap">{coverage(review.fx.first, review.fx.last)}</dd>
        </div>
      </dl>
      {mode === "real" && (
        <div className="actions">
          <button type="button" className="btn" disabled={disabled} onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" /> 更新指数、汇率和收盘价
          </button>
        </div>
      )}
      {results.length > 0 && (
        <p className="review-feedback" role="status">
          {done.length > 0 && "已更新 " + done.map((r) => r.name).join("、") + "。"}
          {failed.length > 0 && " 未能更新：" + failed.map((r) => r.name + "（" + r.error + "）").join("、") + "。"}
        </p>
      )}
      <h3>计算方法</h3>
      <Methods />
    </>
  );
}

function DailyTable({ review, benchmark, selected, select, docked }) {
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
        <Table head={["日期", ["当日收益", "num"], ["累计收益", "num"], [benchmark.name, "num"], ["收益差", "num"]]} onKeyDown={rowKeys}>
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
      ) : <Empty>当前区间暂无逐日收益数据。</Empty>}
      {days.length > limit && (
        <button type="button" className="btn sm" onClick={() => setLimit(limit + 40)}>显示更早的日期</button>
      )}
    </div>
  );
}

const amount = (value) => <Delta amount={value} digits={Number.isInteger(value) ? 0 : 2} />;

function Breakdown({ data, period, selected, select, openHolding }) {
  const item = data?.items.find((item) => item.key === selected);
  const rowKeys = useRowKeys(item?.rows.filter((row) => row.kind === "security").map((row) => row.key) ?? []);
  return (
    <section className="card" aria-label="盈亏构成">
      <div className="row">
        <h2>盈亏构成</h2>
        {data && <span className="cap">{period} · 合计 {amount(data.gain)}</span>}
      </div>
      {!data ? <Empty>当前区间暂无盈亏构成。</Empty> : (
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
            <thead><tr><th scope="col">{item.label} · 按证券</th><th scope="col">金额</th></tr></thead>
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
      ) : <p className="cap">这项在当前区间没有金额。</p>)}
    </section>
  );
}

function Contributions({ data, total, period, expanded, setExpanded, openHolding, openEvidence }) {
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
          {row.closed && <span className="cap"> · 期间已卖清</span>}
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
    <section className="card" aria-label="持仓贡献">
      <div className="row">
        <h2>持仓贡献</h2>
        {data && <span className="cap">{period} · 合计 {amount(total)}</span>}
      </div>
      {rows.length ? (
        <div className="review-contributions" onKeyDown={rowKeys}>
          {(folded ? rows.slice(0, 7) : rows).map(renderRow)}
          {middle.length > 0 && (
            <button type="button" className="review-fold" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {folded ? <>中间 {middle.length} 项合计 {amount(middleTotal)} · 展开</> : "只看前 7 和后 7"}
            </button>
          )}
          {folded && rows.slice(-7).map(renderRow)}
        </div>
      ) : <Empty>{data ? "区间内没有持仓或收支贡献。" : "当前区间暂无持仓贡献。"}</Empty>}
    </section>
  );
}

function ContributionEvidence({ row, accountName, onPage }) {
  const rowKeys = useRowKeys(row.events.map((e) => e.id));
  return (
    <Table head={["日期", "账户", "记录", ["金额／成交", "num"], ["费用及税款", "num"], "来源凭据"]} onKeyDown={rowKeys}>
      {row.events.map((e) => (
        <tr key={e.id} data-row={e.id} className="click" onClick={() => onPage("imports", { tab: "history", account: e.account })}>
          <td>{e.date}</td>
          <td>{accountName(e.account)}</td>
          <td>{types[e.type] || e.type}</td>
          <td className="num">
            {Number(e.quantity)
              ? num(e.quantity) + " × " + e.currency + " " + num(e.price)
              : e.currency + " " + num(e.amount)}
          </td>
          <td className="num">
            {e.currency} {num(Number(e.fee || 0) + Number(e.tax || 0))}
          </td>
          <td>
            <span>{e.reference}</span>
            <button type="button" className="text-btn">
              查看流水
            </button>
          </td>
        </tr>
      ))}
    </Table>
  );
}

function DayDetail({ review, date, select }) {
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
      title="收盘持仓与流水"
      action={
        <Field label="观察日">
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
              收盘净值 <b>{aud(detail.total, 2)}</b>
            </span>
            <span>
              现金 <b>{aud(detail.cash, 2)}</b>
            </span>
            <span>
              现金占比 <b>{detail.cashWeight == null ? "—" : fmt(detail.cashWeight * 100, 2) + "%"}</b>
            </span>
            <span>
              自区间起点 <b><Delta rate={reading?.portfolio} /></b>
            </span>
          </p>
        )}
        <Tabs
          items={[
            ["holdings", "当日持仓"],
            ["day", "当日流水"],
            ["all", "区间流水"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "holdings" ? (
        !detail || detail.date !== date ? (
          <small>正在读取持仓…</small>
        ) : (
          <>
            {detail.problems.length > 0 && <p className="warning">{detail.problems.join("、")}</p>}
            {detail.rows.length ? (
              <Table head={["账户", "证券 / 现金", ["数量", "num"], ["收盘估值（AUD）", "num"], "估值依据"]}>
                {detail.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.account}</td>
                    <td>{r.symbol}</td>
                    <td className="num">{r.cash ? fmt(r.quantity, 2) : num(r.quantity)}</td>
                    <td className="num">{aud(r.value, 2)}</td>
                    <td>
                      {r.reason || r.priceDate || "—"}
                      {r.currency !== "AUD" && <small>汇率 {r.fxDate || "缺失"}</small>}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>当日没有持仓或现金余额。</Empty>
            )}
          </>
        )
      ) : events.length ? (
        <>
          <Table head={["日期", "账户", "记录", ["数量 × 单价 / 金额", "num"], ["费用", "num"]]} onKeyDown={rowKeys}>
            {shown.map((e) => (
              <tr key={e.id} data-row={e.id} className="click" onClick={() => select(e.date)}>
                <td>
                  <button type="button" className="text-btn">
                    {e.date}
                  </button>
                </td>
                <td>{e.account}</td>
                <td>
                  {types[e.type] || e.type} {e.symbol}
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
          {events.length > limit && <button onClick={() => setLimit(limit + 40)}>更多流水</button>}
        </>
      ) : (
        <Empty>这段时间没有流水。</Empty>
      )}
    </Card>
  );
}

function Notes({ review, notes, opened, comparable, reopen, save, busy, accountName }) {
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const draftId = useRef(null);
  return (
    <Card
      title="复盘笔记"
      action={
        <button onClick={() => setWriting(!writing)}>
          <Bookmark size={15} /> 写笔记
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
          <Field label="这段时间做了什么，下次想验证什么？">
            <textarea
              autoFocus
              required
              maxLength={8000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <button className="primary" disabled={busy || !draft.trim()}>
            保存笔记与当前指标
          </button>
        </form>
      )}
      {opened && (
        <section className="review-note-comparison">
          <h3>记录时与当前重算</h3>
          <p>{opened.text}</p>
          {!comparable && <p className="cap">当前无法按此笔记原有的账户范围与期间重算。</p>}
          <Table head={["对象", "指标", ["记录时", "num"], ["当前重算", "num"]]}>
            {seriesOf(review).flatMap(({ id, name }) =>
              Object.keys(labels)
                .filter((key) => key in (opened.metrics[id] || {}))
                .map((key) => {
                  const unit = key === "gap" ? " 个百分点" : "%";
                  const before = directedPct(opened.metrics[id][key], unit),
                    after = comparable ? directedPct(review.metrics[id]?.[key], unit) : "—";
                  return (
                    <tr key={id + key}>
                      <td>{name}</td>
                      <td>{labels[key]}</td>
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
                  {note.ids.map(accountName).join("、")} · 记录于{" "}
                  {new Date(note.created).toLocaleDateString("zh-CN")}
                </small>
              </span>
              <span>{note.text}</span>
              <span className="review-note-open">重开区间</span>
            </button>
          ))}
        </div>
      ) : (
        !writing && <p className="muted">保存判断时，会一并记录账户、日期和当时的收益与回撤。</p>
      )}
    </Card>
  );
}

export function Performance({ d, mode, run, reload, filters, onFilters, onPage }) {
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
  const period = isCustom(filters) ? "自定义" : periodLabels[filters.period];
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
            逐日数据
          </button>
          <button type="button" className="btn sm" disabled={!current} onClick={() => setDetail({ kind: "methods" })}>
            数据来源与计算方法
          </button>
        </div>
      </PeriodControl>
      {updating > 0 && (
        <p className="review-status" role="status">
          <RefreshCw size={14} /> 正在更新指数、汇率和持仓收盘价…
        </p>
      )}
      {error ? (
        <Card>
          <p role="alert" className="warning">
            {error}
          </p>
          <button onClick={() => change(choosePreset(filters, "ytd"))}>重设区间</button>
        </Card>
      ) : !scope.ids.length ? (
        <Empty>请先建立或选择一个有投资记录的账户。</Empty>
      ) : !review ? (
        <Card>
          <p role="status">正在计算每日收益…</p>
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
            <Detail wide title={detail.date ? detail.date + " · 当日明细" : "逐日数据"} onClose={() => setDetail(null)}>
              <DailyTable review={review} benchmark={benchmark} selected={detail.date} select={selectDaily} docked={docked} />
            </Detail>
          )}
          {inScope && detail?.kind === "methods" && (
            <Detail title="数据来源与计算方法" onClose={() => setDetail(null)}>
              {dataPanel}
            </Detail>
          )}
          {inScope && !docked && detail?.date && (
            <Detail wide title={detail.date + " · 当日明细"} onClose={() => setDetail(null)}>
              <DayDetail review={review} date={detail.date} select={openDay} />
            </Detail>
          )}
          {inScope && detail?.kind === "source" && (
            <Detail wide title={detail.row.label + " · 区间原始流水"} onClose={() => setDetail(null)}>
              <ContributionEvidence row={detail.row} accountName={accountName} onPage={onPage} />
            </Detail>
          )}
        </div>
      )}
    </>
  );
}
