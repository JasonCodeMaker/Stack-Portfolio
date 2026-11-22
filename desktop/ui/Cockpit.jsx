import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Search } from "lucide-react";
import { api, aud, fmt, pct, num, types, Delta, Card, Tabs, Table, Empty } from "./common";
import { HoldingEditor } from "./HoldingEditor";
import { Detail, useRowKeys } from "./Shell";

export { Overview } from "./Overview";
const price = (n) => new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);

const sorts = {
  value: (r) => r.audValue,
  gain: (r) => r.gainAud,
  rate: (r) => r.gainRate,
  name: (r) => r.ticker,
};
function holdingTotal(rows, field) {
  return rows.every((r) => r[field] != null) ? rows.reduce((sum, r) => sum + r[field], 0) : null;
}
export function Holdings({ d, initial = {}, onPage, run }) {
  const [q, setQ] = useState(initial.search || ""),
    [filter, setFilter] = useState("all"),
    [account, setAccount] = useState(initial.account || ""),
    [sort, setSort] = useState({ key: "value", down: true }),
    [selectedId, select] = useState(null),
    [events, setEvents] = useState(null),
    [error, setError] = useState("");
  const [repair, setRepair] = useState(null);
  const returnTo = useRef(null);
  useLayoutEffect(() => {
    if (repair || !returnTo.current) return;
    const id = returnTo.current;
    returnTo.current = null;
    const row = document.querySelector('[data-holding-row="' + CSS.escape(id) + '"] .ticker');
    const target = row || document.querySelector('[aria-label="搜索持仓"]');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [repair]);
  const row = d.rows.find((r) => r.id === selectedId);
  useEffect(() => {
    if (!row) return;
    let active = true;
    setEvents(null);
    setError("");
    api
      .history({ account: row.accountId, text: row.profileId || row.ticker, limit: 60 })
      .then((v) => {
        if (active) setEvents(v.filter((e) => !e.metadata?.supersededBy && e.status !== "VOID"));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [row]);
  const scoped = d.rows.filter((r) => !account || r.accountId === account);
  const value = sorts[sort.key];
  const rows = scoped
    .filter(
      (r) =>
        (filter === "all" || r.type === filter) &&
        (r.ticker + " " + r.name + " " + r.accountName).toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => {
      const x = value(a),
        y = value(b);
      if (x == null || y == null) return (x == null) - (y == null);
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * (sort.down ? -1 : 1);
    });
  const listed = d.byAccount
    .filter((a) => !account || a.id === account)
    .flatMap((a) => [
      ...rows.filter((r) => r.accountId === a.id && r.type !== "cash"),
      ...rows.filter((r) => r.accountId === a.id && r.type === "cash"),
    ])
    .map((r) => r.id);
  const rowKeys = useRowKeys(listed, selectedId, select);
  const securities = scoped.filter((r) => r.type !== "cash");
  const cash = account ? d.byAccount.find((a) => a.id === account)?.itemizedCash : d.itemizedCash;
  const cost = securities.length ? holdingTotal(securities, "costAud") : null;
  const known = securities.filter((r) => r.gainAud != null);
  const gain = known.length ? holdingTotal(known, "gainAud") : null;
  const knownCost = holdingTotal(known, "costAud");
  const sortable = (key, label) => (
    <button
      type="button"
      className="sort"
      aria-label={"按" + label + "排序"}
      title={sort.key === key ? (sort.down ? "当前降序" : "当前升序") : "按此列排序"}
      onClick={() => setSort({ key, down: sort.key === key ? !sort.down : key !== "name" })}
    >
      {label}
      {sort.key === key && (sort.down ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
    </button>
  );
  return (
    <>
      <dl className="stat-grid page-stats">
        <div>
          <dt>证券市值</dt>
          <dd>{aud(holdingTotal(securities, "audValue"), 2)}</dd>
        </div>
        <div>
          <dt>现金</dt>
          <dd>{aud(cash, 2)}</dd>
        </div>
        <div>
          <dt>持仓成本</dt>
          <dd>{aud(cost, 2)}</dd>
        </div>
        <div>
          <dt>
            {known.length === securities.length
              ? "持仓账面盈亏"
              : "已知账面盈亏 · " + known.length + "/" + securities.length + " 笔持仓"}
          </dt>
          <dd>
            <Delta amount={gain} rate={gain != null && knownCost > 0 ? gain / knownCost : null} />
          </dd>
        </div>
      </dl>
      <Card
        title="按账户查看持仓"
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
          <div className="toolbar-group">
            {d.byAccount.length > 1 && (
              <select aria-label="按账户筛选" value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">全部账户</option>
                {d.byAccount.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
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
        </div>
        {!rows.length ? (
          <Empty>没有符合条件的持仓或现金。</Empty>
        ) : (
          <div onKeyDown={rowKeys}>
          {d.byAccount
            .filter((a) => !account || a.id === account)
            .map((a) => {
              const holdings = rows.filter((r) => r.accountId === a.id && r.type !== "cash");
              const balances = rows.filter((r) => r.accountId === a.id && r.type === "cash");
              if (!holdings.length && !balances.length) return null;
              return (
                <section className="holding-account" key={a.id}>
                  <header>
                    <h3>{a.name}</h3>
                    <small>账户记录截至 {a.balanceDate || "暂无记录"}</small>
                  </header>
                  {holdings.length > 0 && (
                    <Table
                      head={[
                        sortable("name", "证券"),
                        ["股数／份额", "num"],
                        [sortable("value", "市值（AUD）"), "num"],
                        ["总成本（AUD）", "num"],
                        [sortable("gain", "账面盈亏（AUD）"), "num"],
                        [sortable("rate", "盈亏率"), "num"],
                        "",
                      ]}
                    >
                      {holdings.map((r) => (
                        <tr
                          key={r.id}
                          data-holding-row={r.id}
                          data-row={r.id}
                          className={selectedId === r.id ? "sel" : undefined}
                        >
                          <td>
                            <button className="ticker" onClick={() => select(r.id)}>
                              {r.ticker}
                            </button>
                            <small>{[r.name, r.mic, r.localCurrency].filter(Boolean).join(" · ")}</small>
                            {r.type === "unknown" && (
                              <button
                                className="text-btn"
                                onClick={() => setRepair({ row: r, action: "type" })}
                              >
                                确认类别
                              </button>
                            )}
                            {r.evidence && Number(r.evidence.difference) !== 0 && (
                              <button className="text-btn" onClick={() => select(r.id)}>
                                股数相差 {num(Math.abs(r.evidence.difference))} 股
                              </button>
                            )}
                          </td>
                          <td className="num">{num(r.quantity)}</td>
                          <td className="num">{aud(r.audValue, 2)}</td>
                          <td className="num">
                            {r.costAud != null ? aud(r.costAud, 2) : r.costLocal != null ? "待补汇率" : (
                              <button
                                className="text-btn"
                                onClick={() => setRepair({ row: r, action: "cost" })}
                              >
                                补成本
                              </button>
                            )}
                          </td>
                          <td className="num">
                            <Delta amount={r.gainAud} />
                          </td>
                          <td className="num">
                            <Delta rate={r.gainRate} />
                          </td>
                          <td>
                            <button
                              className="text-btn"
                              onClick={() => setRepair({ row: r, action: r.price && !r.fx ? "fx" : "price" })}
                            >
                              {r.price && !r.fx ? "补汇率" : "补报价"}
                            </button>
                            {r.stale && <small>报价截至 {r.priceUpdatedAt}</small>}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                  {balances.length > 0 && (
                    <div className="cash-balances">
                      <b>{a.cash == null ? "现金余额 · 待核对" : "现金余额"}</b>
                      {balances.map((r) => (
                        <button key={r.id} data-row={r.id} className="text-btn" onClick={() => select(r.id)}>
                          {r.localCurrency} {fmt(r.quantity, 2)}
                          {r.localCurrency !== "AUD" && "（" + aud(r.audValue, 2) + "）"}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Card>
      {row && (
        <Detail
          wide
          title={row.ticker + " · " + row.accountName}
          onClose={() => {
            select(null);
            setEvents(null);
          }}
        >
          <p className="muted">{row.type === "cash" ? "现金余额" : row.name}</p>
          <dl className="stat-grid">
            <div>
              <dt>市值（AUD）</dt>
              <dd>{aud(row.audValue, 2)}</dd>
            </div>
            <div>
              <dt>持仓成本（AUD）</dt>
              <dd>{aud(row.costAud, 2)}</dd>
            </div>
            <div>
              <dt>浮动盈亏</dt>
              <dd>{row.type === "cash" ? "—" : <Delta amount={row.gainAud} rate={row.gainRate} />}</dd>
            </div>
            <div>
              <dt>占总资产</dt>
              <dd>{pct(d.total && row.audValue != null ? row.audValue / d.total : null)}</dd>
            </div>
          </dl>
          <dl>
            <dt>数量</dt>
            <dd>{row.rawQuantity}</dd>
            {row.type !== "cash" && (
              <>
                <dt>现价 · 来源</dt>
                <dd>
                  {row.price == null ? "缺少报价" : row.localCurrency + " " + price(row.price)}
                  {row.quoteSource && " · " + row.quoteSource}
                </dd>
                <dt>成本均价</dt>
                <dd>
                  {row.averageCost == null
                    ? "流水不足以计算成本"
                    : row.localCurrency + " " + fmt(row.averageCost, 4)}
                </dd>
                <dt>{row.localCurrency} 计价的市值 · 盈亏</dt>
                <dd>
                  {row.localCurrency} {fmt(row.nativeValue, 2)}
                  {row.gainLocal != null &&
                    " · " +
                      (row.gainLocal > 0 ? "+" : row.gainLocal < 0 ? "−" : "") +
                      fmt(Math.abs(row.gainLocal), 2)}
                </dd>
              </>
            )}
            <dt>{row.quoteObservedAt ? "券商快照读取日" : "报价日期"}</dt>
            <dd>{row.priceUpdatedAt || "—"}</dd>
            {row.localCurrency !== "AUD" && (
              <>
                <dt>{row.type === "cash" ? "现金折算汇率" : "市值与成本折算汇率"}</dt>
                <dd>
                  {row.fx == null ? "待补汇率" : "1 " + row.localCurrency + " = " + num(row.fx) + " AUD"}
                  {row.fxSource && " · " + row.fxSource} {row.fxDate}
                </dd>
              </>
            )}
          </dl>
          {row.type !== "cash" && (
            <div className="actions">
              <button onClick={() => setRepair({ row, action: "cost" })}>补成本</button>
              <button onClick={() => setRepair({ row, action: "price" })}>补报价</button>
              {row.localCurrency !== "AUD" && (
                <button onClick={() => setRepair({ row, action: "fx" })}>补汇率</button>
              )}
              <button onClick={() => setRepair({ row, action: "type" })}>更正类别</button>
            </div>
          )}
          {row.costReceipt && (
            <p className="muted">
              成本凭据 · {row.costReceipt.day} · {row.costReceipt.reference}
              {row.costReceipt.historicalAud != null && " · 凭据中的历史澳元成本 " + aud(row.costReceipt.historicalAud, 2)}
            </p>
          )}
          {row.evidence && (
            <p className="notice">
              {row.evidence.day} · {row.evidence.quantityReference} 记载 {num(row.evidence.quantity)}{" "}
              股，账本当日可解释 {num(row.evidence.ledgerQuantity)} 股。
            </p>
          )}
          {row.issue && <p className="warning">{row.issue}</p>}
          <h3>关联流水</h3>
          {error ? (
            <p className="warning">{error}</p>
          ) : !events ? (
            <p className="muted">正在读取流水…</p>
          ) : events.length ? (
            <Table head={["日期", "记录", ["数量 × 单价 / 金额", "num"], ["费用", "num"]]}>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{String(e.date).slice(0, 10)}</td>
                  <td>{e.metadata?.fx ? "换汇" : types[e.activityType] || e.activityType}
                    {e.metadata?.ibkrExecution?.fxRateToBase && !e.metadata?.fx && <small>
                      1 {e.metadata.ibkrExecution.currency} = {num(e.metadata.ibkrExecution.fxRateToBase)} {e.metadata.ibkrExecution.baseCurrency}（成交报表）
                    </small>}
                  </td>
                  <td className="num">
                    {e.currency}{" "}
                    {Number(e.quantity)
                      ? num(e.quantity) + (e.unitPrice != null ? " × " + num(e.unitPrice) : "")
                      : num(e.amount)}
                  </td>
                  <td className="num">{Number(e.fee) ? num(e.fee) : "—"}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="muted">当前持仓来自期初余额或历史持仓快照，没有逐笔流水。</p>
          )}
        </Detail>
      )}
      {repair && (
        <HoldingEditor
          d={d}
          run={run}
          {...repair}
          close={(saved) => {
            if (saved && !selectedId) returnTo.current = repair.row.id;
            setRepair(null);
          }}
        />
      )}
    </>
  );
}
