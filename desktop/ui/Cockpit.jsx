import React, { useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight, Info, Search, TriangleAlert, WalletCards } from "lucide-react";
import { api, aud, fmt, pct, num, kind, types, Card, Modal, Tabs, Table, Empty } from "./common";
function Trend({ d }) {
  const values = d.points.flatMap((p) => [p.value, p.basis]).filter((v) => v != null);
  if (!values.length) return <Empty>这个期间缺少可核对的估值。</Empty>;
  const max = Math.max(...values),
    min = Math.min(...values),
    range = Math.max(max - min, max * 0.012, 1),
    lo = min - range * 0.18,
    hi = max + range * 0.18;
  const X = (i) => 68 + (i * 652) / Math.max(1, d.points.length - 1),
    Y = (v) => 20 + ((hi - v) / (hi - lo)) * 150;
  function lines(key) {
    let pen = false;
    return d.points
      .map((p, i) => {
        if (p[key] == null) {
          pen = false;
          return "";
        }
        const c = pen ? "L" : "M";
        pen = true;
        return c + X(i).toFixed(1) + " " + Y(p[key]).toFixed(1);
      })
      .join(" ");
  }
  return (
    <div className="trend">
      <svg viewBox="0 0 735 199" role="img" aria-label="总资产与期初资产加累计净投入走势">
        {[0, 0.5, 1].map((f) => {
          const v = hi - (hi - lo) * f,
            y = Y(v);
          return (
            <g key={f}>
              <text x="0" y={y + 4}>
                {fmt(v)}
              </text>
              <line x1="68" x2="720" y1={y} y2={y} className="gridline" />
            </g>
          );
        })}
        <path d={lines("basis")} className="baseline" />
        <path d={lines("value")} className="value-line" />
        {d.points
          .filter((p, i) => p.value != null && (i === 0 || i === d.points.length - 1))
          .map((p) => (
            <circle key={p.date} cx={X(d.points.indexOf(p))} cy={Y(p.value)} r="3.5" fill="#086349" />
          ))}
        <text x="68" y="195">
          {d.start}
        </text>
        <text x="720" textAnchor="end" y="195">
          {d.date}
        </text>
      </svg>
      <div className="legend">
        <span>
          <i />
          总资产
        </span>
        <span>
          <i className="dashed" />
          期初资产＋累计净投入
        </span>
      </div>
    </div>
  );
}
export function Overview({ d, onPage, setScope, options, change }) {
  const [info, setInfo] = useState("");
  const tags = [
    ["总资产", d.total, d.total == null ? "已估值小计 " + aud(d.known) : "证券市值＋账户现金"],
    ["证券市值", d.securities, "按估值日折算 AUD"],
    ["账户现金", d.cash, "按原币余额汇总"],
    ["期间投资盈亏", d.pnl, d.pnl == null ? "待核对估值与资金流水" : "期间净入金 " + aud(d.flows)],
  ];
  return (
    <>
      <div className="metrics">
        {tags.map(([label, v, caption], i) => (
          <button
            key={label}
            className={"metric " + (i === 0 ? "hero-metric" : "")}
            onClick={() => setInfo(label)}
          >
            <span>
              {label}
              <Info size={14} />
            </span>
            <strong className={i === 3 && v > 0 ? "positive" : ""}>
              {i === 3 && v > 0 ? "+" : ""}
              {aud(v)}
            </strong>
            <small>{caption}</small>
          </button>
        ))}
      </div>
      {d.issues.length > 0 && (
        <div className="notice">
          <TriangleAlert size={18} />
          <div>
            <b>有 {d.issues.length} 项待核对</b>
            <small>
              {d.issues[0].account} · {d.issues[0].reason}
            </small>
          </div>
          <button onClick={() => onPage("imports", { tab: "check", account: d.issues[0].id })}>
            查看差异 <ChevronRight size={15} />
          </button>
        </div>
      )}
      <div className="dashboard-grid">
        <Card
          title="资产走势"
          action={
            <Tabs
              items={[
                ["1m", "近 1 月"],
                ["3m", "近 3 月"],
                ["ytd", "今年"],
                ["all", "全部"],
              ]}
              value={options.period}
              onChange={(period) => change({ period })}
            />
          }
        >
          <Trend d={d} />
        </Card>
        <Card title="账户分布">
          <div className="account-bars">
            {d.byAccount.map((a, i) => (
              <button
                key={a.id}
                onClick={() => {
                  setScope([a.id]);
                  onPage("holdings");
                }}
              >
                <span className={"account-emblem c" + (i % 3)}>
                  <WalletCards size={18} />
                </span>
                <div>
                  <span>
                    {a.name}
                    <b>{aud(a.total)}</b>
                  </span>
                  <div className="bar">
                    <i style={{ width: (d.total ? (100 * a.total) / d.total : 0) + "%" }} />
                  </div>
                  <small>{a.total == null ? "现金待核对" : pct(d.total ? a.total / d.total : null)}</small>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>
      <Card
        title="前五大证券持仓"
        action={
          <button className="text-btn" onClick={() => onPage("holdings")}>
            全部持仓 <ArrowUpRight size={15} />
          </button>
        }
      >
        <Table head={["证券", "类型", "市值（AUD）", "资产占比"]}>
          {d.portfolio.instrumentAllocation
            .filter((r) => r.type !== "cash")
            .slice(0, 5)
            .map((r) => (
              <tr key={r.key}>
                <td>
                  <button className="ticker" onClick={() => onPage("holdings", { search: r.label })}>
                    {r.label}
                  </button>
                </td>
                <td>{kind[r.type]}</td>
                <td>{aud(r.valueAud, 2)}</td>
                <td>{pct(r.weight)}</td>
              </tr>
            ))}
        </Table>
      </Card>
      {info && (
        <Modal title={info} close={() => setInfo("")}>
          <dl>
            <dt>估值日期</dt>
            <dd>{d.date}</dd>
            <dt>合计证券市值</dt>
            <dd>{aud(d.securities, 2)}</dd>
            <dt>合计分币种现金</dt>
            <dd>{aud(d.cash, 2)}</dd>
            <dt>期初资产 · {d.start}</dt>
            <dd>{aud(d.startValue, 2)}</dd>
            <dt>期间净外部资金流</dt>
            <dd>{aud(d.flows, 2)}</dd>
            <dt>期末资产 − 期初资产 − 净外部资金流</dt>
            <dd>{aud(d.pnl, 2)}</dd>
          </dl>
          {d.originalValue != null && <p>Wealthfolio 同日原始估值 {aud(d.originalValue, 2)}</p>}
          <button
            className="primary"
            onClick={() => {
              setInfo("");
              onPage("holdings");
            }}
          >
            查看报价与现金来源
          </button>
        </Modal>
      )}
    </>
  );
}
export function Holdings({ d, initial = {}, onPage }) {
  const [q, setQ] = useState(initial.search || ""),
    [filter, setFilter] = useState("all"),
    [row, select] = useState(null),
    [events, setEvents] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!row) return;
    let active = true;
    api
      .history({ account: row.accountId, text: row.profileId || row.ticker, limit: 24 })
      .then((v) => {
        if (active) setEvents(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [row]);
  const rows = d.rows
    .filter(
      (r) =>
        (filter === "all" || r.type === filter) &&
        (r.ticker + " " + r.name + " " + r.accountName).toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => (b.audValue ?? -Infinity) - (a.audValue ?? -Infinity));
  return (
    <Card
      title="持仓与现金"
      action={
        <button className="text-btn" onClick={() => onPage("allocation")}>
          配置分析 <ArrowUpRight size={15} />
        </button>
      }
    >
      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input
            placeholder="搜索证券、名称或账户"
            aria-label="搜索持仓"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <Tabs
          items={[
            ["all", "全部"],
            ["stock", "股票"],
            ["etf", "ETF"],
            ["cash", "现金"],
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      {!rows.length ? (
        <Empty>没有符合条件的持仓。</Empty>
      ) : (
        <Table head={["证券 / 现金", "账户", "数量", "原币市值", "澳元市值", "报价日期", ""]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button className="ticker" onClick={() => select(r)}>
                  {r.ticker}
                </button>
                <small>{r.name}</small>
              </td>
              <td>{r.accountName}</td>
              <td>{num(r.quantity)}</td>
              <td>
                {r.localCurrency} {fmt(r.nativeValue, 2)}
              </td>
              <td>{aud(r.audValue, 2)}</td>
              <td>
                {r.priceUpdatedAt || "待报价"}
                {r.type !== "cash" && r.priceUpdatedAt && r.priceUpdatedAt < d.date && (
                  <small>沿用最近报价</small>
                )}
                {r.issue && <small className="warning">{r.issue}</small>}
              </td>
              <td>
                <button className="icon" aria-label={"查看 " + r.ticker} onClick={() => select(r)}>
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {row && (
        <Modal
          title={row.ticker + " · " + row.accountName}
          close={() => {
            select(null);
            setEvents([]);
          }}
        >
          <p>{row.name}</p>
          <dl>
            <dt>数量</dt>
            <dd>{row.rawQuantity}</dd>
            <dt>原币市值</dt>
            <dd>
              {row.localCurrency} {fmt(row.nativeValue, 2)}
            </dd>
            <dt>估值（AUD）</dt>
            <dd>{aud(row.audValue, 2)}</dd>
            <dt>报价 · 来源</dt>
            <dd>
              {num(row.price)} · {row.quoteSource || "缺少报价"}
            </dd>
            <dt>报价日期</dt>
            <dd>{row.priceUpdatedAt || "—"}</dd>
            <dt>兑澳元汇率 · 日期</dt>
            <dd>
              {num(row.fx)} · {row.fxDate || "—"}
            </dd>
          </dl>
          {row.issue && <p className="warning">{row.issue}</p>}
          <h3>关联流水</h3>
          {error ||
            (events.length ? (
              events.map((e) => (
                <p key={e.id}>
                  {String(e.date).slice(0, 10)} · {types[e.activityType] || e.activityType} · {e.currency}{" "}
                  {num(e.amount ?? e.unitPrice)}
                </p>
              ))
            ) : (
              <p>当前持仓可来自期初余额或历史持仓快照。</p>
            ))}
        </Modal>
      )}
    </Card>
  );
}
