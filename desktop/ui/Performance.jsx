import React, { useEffect, useRef, useState } from "react";
import { Bookmark, RefreshCw, TriangleAlert } from "lucide-react";
import { api, aud, fmt, num, types, signedAud, signedPct, tone, Card, Empty, Field, Modal, Table, Tabs } from "./common";
import { TimeChart, seriesColors } from "./Chart";
import { PeriodControl } from "./FilterControls";
import { accountScope, choosePreset, chooseRange, periodQuery } from "./filters.js";
import "./performance.css";

const percent = (v) => (v == null ? "—" : signedPct(v));
const points = (v) => fmt(Math.abs(v) * 100, 2) + " 个百分点";
const gapText = (v) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + points(v));
const level = (v) => Math.abs(v) < 1e-9;
const seriesOf = (review) => [{ id: "portfolio", name: "我的组合" }, ...review.series];
const errorText = (e) =>
  String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
const labels = { totalReturn: "区间收益", gap: "组合收益差", maxDrawdown: "最大回撤" };

// The answer the page exists for: the portfolio's return, and whether it is ahead of each index.
function Verdict({ review }) {
  const own = review.metrics.portfolio;
  return (
    <div className="review-metrics">
      <section className="review-metric review-primary">
        <h2>
          <i style={{ background: "#c5e8a3" }} />
          我的组合
        </h2>
        <strong className={tone(own.totalReturn,4)}>{percent(own.totalReturn)}</strong>
        <span>
          期间盈亏 <b className={tone(review.money?.gain)}>{review.money ? signedAud(review.money.gain) : "—"}</b>
          {review.contributions && review.contributions.to !== own.asOf && " · 截至 " + review.contributions.to}
        </span>
        <span>
          最大回撤 <b>{percent(own.maxDrawdown)}</b>
        </span>
        <small>
          {own.asOf
            ? "时间加权收益率 · 截至 " + own.asOf + " 收盘"
            : "这个区间还没有可比较的两个收盘估值"}
        </small>
      </section>
      {review.series.map((b) => {
        const m = review.metrics[b.id],
          direction = m.gap == null || level(m.gap) ? "" : m.gap > 0 ? "gain" : "loss";
        return (
          <section key={b.id} className="review-metric">
            <h2>
              <i style={{ background: seriesColors[b.id] }} />
              对比{b.name}
            </h2>
            <strong className={direction}>
              {m.gap == null ? (
                "暂无法比较"
              ) : level(m.gap) ? (
                "与指数持平"
              ) : (
                <>
                  <i aria-hidden="true">{m.gap > 0 ? "▲" : "▼"}</i>
                  {m.gap > 0 ? "跑赢 " : "跑输 "}
                  {points(m.gap)}
                </>
              )}
            </strong>
            <span>
              指数同期 <b>{percent(m.totalReturn)}</b>
              {m.portfolioReturn != null && m.asOf !== own.asOf && (
                <>
                  　组合 <b>{percent(m.portfolioReturn)}</b>
                </>
              )}
            </span>
            <span>
              指数最大回撤 <b>{percent(m.maxDrawdown)}</b>
            </span>
            <small>
              {m.gap == null
                ? b.first
                  ? "所选区间内缺少可同日比较的指数点位"
                  : "尚未取得这个指数的总回报数据"
                : m.asOf === own.asOf
                  ? "含分红再投资，折算为澳元 · 截至 " + m.asOf
                  : "指数数据截至 " + m.asOf + "，按该日同期比较"}
            </small>
          </section>
        );
      })}
    </div>
  );
}

function ReviewChart({ review, selected, select, zoom }) {
  const [mode, setMode] = useState("returns"),
    [table, setTable] = useState(30);
  const returns = mode === "returns";
  const lines = { portfolio: { emphasis:true }, SP500TR: { dashed:true }, XNDX: { dotted:true } };
  const series = returns
    ? seriesOf(review).map((s) => ({ ...s, ...lines[s.id], endName:s.name, color: seriesColors[s.id], value: (p) => p[s.id] }))
    : review.series.map((s) => ({
        ...s,
        ...lines[s.id],
        endName: s.name,
        name: "相对" + s.name,
        color: seriesColors[s.id],
        value: (p) => p.gaps[s.id],
      }));
  const known = review.points.some((p) => series.some((s) => s.value(p) != null));
  const rows = [...review.points].reverse();
  return (
    <Card
      title={returns ? "累计收益走势" : "组合相对指数的收益差"}
      action={
        <Tabs
          items={[
            ["returns", "累计收益"],
            ["gap", "收益差"],
          ]}
          value={mode}
          onChange={setMode}
        />
      }
    >
      {known ? (
        <>
          <TimeChart
            label="每日收益曲线，可悬停读数、点选日期或拖选复盘区间"
            points={review.points}
            series={series}
            height={300}
            zero
            format={returns ? percent : gapText}
            axisFormat={(v) => fmt(v * 100, 1) + (returns ? "%" : " pp")}
            zones={returns ? null : ["组合领先", "组合落后"]}
            band={(shown) =>
              returns
                ? shown.length === 2 && shown[0].id === "portfolio"
                  ? { upper: "portfolio", lower: shown[1].id }
                  : null
                : shown.length === 1
                  ? { upper: shown[0].id, lower: 0 }
                  : null
            }
            selected={selected}
            onSelect={select}
            onZoom={zoom}
            tooltip={(p) =>
              returns &&
              review.series.map(
                (b) =>
                  p.gaps[b.id] != null && (
                    <div key={b.id} className="chart-tip-row total">
                      <span>相对{b.name}</span>
                      <b className={tone(p.gaps[b.id], 4)}>{gapText(p.gaps[b.id])}</b>
                    </div>
                  ),
              )
            }
          />
          <p className="review-hint">
            拖选日期可比较该区间。点击曲线上的日期查看当日明细。
          </p>
          <details className="review-details">
            <summary>查看每日数据</summary>
            <Table
              head={[
                "日期",
                ["我的组合", "num"],
                ...review.series.flatMap((b) => [
                  [b.name, "num"],
                  ["收益差", "num"],
                ]),
                ["收盘净值（AUD）", "num"],
              ]}
            >
              {rows.slice(0, table).map((p) => (
                <tr key={p.date}>
                  <td>
                    <button className="text-btn" onClick={() => select(p.date)}>
                      {p.date}
                    </button>
                  </td>
                  <td className="num">{percent(p.portfolio)}</td>
                  {review.series.flatMap((b) => [
                    <td key={b.id} className="num">
                      {percent(p[b.id])}
                    </td>,
                    <td key={b.id + "gap"} className={"num " + tone(p.gaps[b.id], 4)}>
                      {gapText(p.gaps[b.id])}
                    </td>,
                  ])}
                  <td className="num">{aud(p.value, 2)}</td>
                </tr>
              ))}
            </Table>
            {rows.length > table && <button onClick={() => setTable(table + 60)}>显示更早的日期</button>}
          </details>
        </>
      ) : (
        <Empty>当前区间还没有可绘制的收益数据。可更新行情，或把起点调到有持仓的日期。</Empty>
      )}
    </Card>
  );
}

// Which data the comparison rests on, what is still missing, and how results are worked out.
function DataPanel({ review, mode, busy, updating, refresh, results }) {
  const [expanded, setExpanded] = useState(false);
  const names = Object.fromEntries(seriesOf(review).map((s) => [s.id, s.name]));
  const done = results.filter((r) => !r.error),
    failed = results.filter((r) => r.error);
  // A session still to close leaves only a gap after the latest valued day, which is routine.
  // The panel opens by itself when data is missing inside the measured period.
  const through = review.metrics.portfolio.asOf;
  const open = review.outages.some((g) => g.to >= review.origin && (!through || g.from <= through));
  return (
    <details className="card review-data" open={open || undefined}>
      <summary>
        <h2>行情与计算口径</h2>
        <span className="muted">
          {review.series.map((b) => b.name + " " + (b.last ? "至 " + b.last : "未取得")).join(" · ")} · 汇率{" "}
          {review.fx.last ? "至 " + review.fx.last : "未取得"}
        </span>
      </summary>
      <div className="review-sources">
        {review.series.map((b) => (
          <div key={b.id}>
            <b>{b.name}</b>
            <span>{b.source}</span>
            <small>{b.first ? b.first + " 至 " + b.last : "尚未缓存总回报数据"}</small>
          </div>
        ))}
        <div>
          <b>美元兑澳元</b>
          <span>{review.fx.sources.join("、") || "Yahoo Finance · AUDUSD=X"}</span>
          <small>{review.fx.first ? review.fx.first + " 至 " + review.fx.last : "尚未缓存历史汇率"}</small>
        </div>
      </div>
      {mode === "real" && (
        <div className="actions">
          <button disabled={busy || updating} onClick={() => refresh(false)}>
            <RefreshCw size={14} /> 更新指数、汇率和收盘价
          </button>
          {review.canBackfill && review.missingAssets.length > 0 && (
            <button disabled={busy || updating} onClick={() => refresh(true)}>
              用 Twelve Data 补齐 {review.missingAssets.length} 只证券的收盘价
            </button>
          )}
        </div>
      )}
      {results.length > 0 && (
        <p className="review-feedback" role="status">
          {done.length > 0 && "已更新 " + done.map((r) => r.name).join("、") + "。"}
          {failed.length > 0 && " 未能更新：" + failed.map((r) => r.name + "（" + r.error + "）").join("、") + "。"}
        </p>
      )}
      {review.outages.length > 0 && (
        <>
          <h3>数据缺口（{review.outages.length} 段）</h3>
          <ul className="review-outages">
            {(expanded ? review.outages : review.outages.slice(0, 6)).map((g) => (
              <li key={g.id + g.from}>
                <b>{names[g.id]}</b>　{g.from}
                {g.to !== g.from && " 至 " + g.to}　{g.reason}
              </li>
            ))}
          </ul>
          {!expanded && review.outages.length > 6 && (
            <button onClick={() => setExpanded(true)}>显示其余缺口</button>
          )}
          {mode === "real" && review.missingAssets.length > 0 && !review.canBackfill && (
            <p className="muted">
              自动来源没有的收盘价，可在「设置 → 报价、分类与来源」手工补录。
            </p>
          )}
        </>
      )}
      <h3>收益怎么算</h3>
      <p>
        以每日收盘估值和同期汇率折算为澳元。组合保留现金、实际分红、费用及税款。入金计在日初，出金计在日末，逐日连乘，得到不受出入金影响的时间加权收益率。所选账户间的配对划转计入内部转账。
      </p>
      <p>
        两条基准使用美元总回报指数（分红再投资），按同期汇率折算为澳元。收益差为组合累计收益率减去同期指数收益率，以百分点表示。最大回撤从区间内的峰值算到后续谷底。
      </p>
      <p>
        休市日沿用上一交易日收盘价。当日收盘价或汇率尚未取得时，结果截至最近一个可估值的收盘日；区间中段有缺口时，最大回撤暂不显示。
      </p>
    </details>
  );
}

function Contributions({ review }) {
  const [selected, select] = useState(null);
  const data = review.contributions;
  return (
    <Card
      title="这段时间的盈亏来自哪里"
      action={
        data && (
          <span className="muted">
            {data.from} 至 {data.to} · AUD
          </span>
        )
      }
    >
      {!data ? (
        <Empty>取得区间起止估值和资金流水后，可计算区间贡献。</Empty>
      ) : !data.rows.length ? (
        <Empty>区间内没有持仓或收支贡献。</Empty>
      ) : (
        <>
          <Table head={["证券或收支", ["区间贡献（AUD）", "num"], "依据"]}>
            {data.rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <b>{r.label}</b>
                  {r.listing && <small>{r.listing}</small>}
                  {r.closed && <small>期间已卖清</small>}
                </td>
                <td className={"num " + tone(r.gain)}>{r.gain == null ? "待核对" : signedAud(r.gain)}</td>
                <td>
                  {r.events.length ? (
                    <button className="text-btn" onClick={() => select(r)}>
                      {r.events.length} 笔流水
                    </button>
                  ) : r.kind === "security" ? (
                    "期初与期末持仓估值"
                  ) : r.key.startsWith("fx:") ? (
                    "期初与期末现金折算"
                  ) : (
                    "核对估值和现金记录"
                  )}
                </td>
              </tr>
            ))}
            <tr className="sum">
              <td>组合期间盈亏</td>
              <td className={"num " + tone(review.money.gain)}>{signedAud(review.money.gain)}</td>
              <td />
            </tr>
          </Table>
        </>
      )}
      {selected && (
        <Modal wide title={selected.label + " · 区间原始流水"} close={() => select(null)}>
          <Table head={["日期", "账户", "记录", "金额／成交", "费用及税款", "来源凭据"]}>
            {selected.events.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td>{review.accountNames[e.account] || e.account}</td>
                <td>{types[e.type] || e.type}</td>
                <td>
                  {e.quantity && Number(e.quantity)
                    ? num(e.quantity) + " × " + e.currency + " " + num(e.price)
                    : e.currency + " " + num(e.amount)}
                </td>
                <td>
                  {e.currency} {num(Number(e.fee || 0) + Number(e.tax || 0))}
                </td>
                <td>{e.reference}</td>
              </tr>
            ))}
          </Table>
        </Modal>
      )}
    </Card>
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
  const reading = review.points.find((p) => p.date === date);
  return (
    <Card
      title="收盘持仓与流水"
      action={
        <Field label="观察日">
          <input
            type="date"
            value={date}
            min={review.from}
            max={review.to}
            onChange={(e) => {
              if (e.target.value >= review.from && e.target.value <= review.to) select(e.target.value);
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
            自区间起点 <b className={tone(reading?.portfolio, 4)}>{percent(reading?.portfolio)}</b>
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
          <Table head={["日期", "账户", "记录", ["数量 × 单价 / 金额", "num"], ["费用", "num"]]}>
            {events.slice(0, limit).map((e) => (
              <tr key={e.id}>
                <td>
                  <button className="text-btn" onClick={() => select(e.date)}>
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

function Notes({ review, notes, opened, reopen, save, busy, accountName }) {
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
          <Table head={["对象", "指标", ["记录时", "num"], ["当前重算", "num"]]}>
            {seriesOf(review).flatMap(({ id, name }) =>
              Object.keys(labels)
                .filter((key) => key in (opened.metrics[id] || {}))
                .map((key) => {
                  const format = key === "gap" ? gapText : percent;
                  const before = format(opened.metrics[id][key]),
                    after = format(review.metrics[id][key]);
                  return (
                    <tr key={id + key}>
                      <td>{name}</td>
                      <td>{labels[key]}</td>
                      <td className="num">{before}</td>
                      <td className={"num " + (before !== after ? "review-changed" : "")}>{after}</td>
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

export function Performance({ d, mode, run, reload, filters, onFilters }) {
  // The account scope, valuation date and period are the global filters (spec §2.3).
  const scope = { ids: d.selected, ...periodQuery(filters, d.date) };
  const [version, setVersion] = useState(0),
    [loaded, setLoaded] = useState(null),
    [error, setError] = useState("");
  const [picked, setPicked] = useState(null),
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
  const names = new Map(d.accounts.map((a) => [a.id, a.name]));
  const accountName = (id) => names.get(id) || id;
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
    setOpened(note);
    setPicked(null);
    setResults([]);
    onFilters(next);
  }
  function zoom(from, to) {
    change(chooseRange(filters, from, to, d.date));
  }
  const selected = review && picked >= review.from && picked <= review.to ? picked : review?.metrics.portfolio.asOf || review?.to;
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
  async function refresh(holdings) {
    await act(async () => {
      const result = await api.refreshReview({ token: review.token, holdings });
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
  const late = review && review.origin > review.requested;
  return (
    <>
      <PeriodControl
        filters={filters}
        range={review && { from: review.from, to: review.to }}
        valuationDate={d.date}
        custom
        days
        onChange={(next) => change(next)}
      />
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
        <div className={"review-body" + (current ? "" : " stale")} aria-busy={!current}>
          {late && (
            <div className="notice">
              <TriangleAlert size={18} />
              <div>
                <b>收益从 {review.origin} 起算</b>
                <small>
                  {scope.from
                    ? "所选起点 " + review.requested + " 当日组合还不能完整估值，三条曲线都从首个可估值的收盘日起算。"
                    : "这是所选账户最早可以完整估值的收盘日。"}
                </small>
              </div>
            </div>
          )}
          <Verdict review={review} />
          <ReviewChart
            key={review.token}
            review={review}
            selected={selected}
            select={setPicked}
            zoom={zoom}
          />
          <Contributions key={"contributions" + review.token} review={review}/>
          {picked && <Modal wide title={picked + " · 当日明细"} close={() => setPicked(null)}>
            <DayDetail review={review} date={selected} select={setPicked}/>
          </Modal>}
          <Notes
            key={"notes" + review.token}
            review={review}
            notes={review.notes}
            opened={current ? opened : null}
            reopen={(note) => {
              const activeIds = d.accounts.filter((a) => a.active).map((a) => a.id),
                ids = note.ids.filter((id) => activeIds.includes(id));
              const range = chooseRange(filters, note.from, note.to, d.date);
              change(ids.length ? { ...range, ids: accountScope(ids, activeIds) } : range, note);
              setVersion((v) => v + 1);
            }}
            save={save}
            busy={busy}
            accountName={accountName}
          />
          <DataPanel
            review={review}
            mode={mode}
            busy={busy}
            updating={updating > 0}
            refresh={refresh}
            results={results}
          />
        </div>
      )}
    </>
  );
}
