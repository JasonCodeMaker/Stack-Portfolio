import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronRight, Search, TriangleAlert, WalletCards } from "lucide-react";
import {
  api,
  aud,
  fmt,
  pct,
  num,
  kind,
  types,
  signedAud,
  signedPct,
  tone,
  Delta,
  Card,
  Modal,
  Tabs,
  Table,
  Empty,
} from "./common";
import { TimeChart, seriesColors } from "./Chart";

export const periods = [
  ["1m", "近 1 月"],
  ["3m", "近 3 月"],
  ["ytd", "今年"],
  ["all", "全部"],
];
const periodName = (id) => periods.find(([k]) => k === id)?.[1] || "期间";
// Securities by value, then cash.
const byValue = (a, b) =>
  (a.type === "cash") - (b.type === "cash") || (b.audValue ?? -Infinity) - (a.audValue ?? -Infinity);
const price = (n) => new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);

function Trend({ d }) {
  if (!d.points.some((p) => p.value != null)) return <Empty>这个期间缺少可核对的估值。</Empty>;
  return (
    <TimeChart
      label="总资产与期初资产加期间净入金的每日走势"
      points={d.points}
      height={292}
      format={(v) => aud(v, 0)}
      axisFormat={(v) => fmt(v)}
      series={[
        { id: "value", name: "总资产", color: seriesColors.portfolio, value: (p) => p.value },
        { id: "basis", name: "期初资产＋期间净入金", color: "#8b9188", dashed: true, value: (p) => p.basis },
      ]}
      band={(shown) => (shown.length === 2 ? { upper: "value", lower: "basis" } : null)}
      tooltip={(p) =>
        p.value != null &&
        p.basis != null && (
          <div className="chart-tip-row total">
            <span>期间盈亏</span>
            <b>
              <Delta amount={p.value - p.basis} digits={0} />
            </b>
          </div>
        )
      }
    />
  );
}

// What one account holds, largest first, with the cash it keeps.
function AccountAssets({ account, total, heading = true }) {
  const rows = [...account.rows].sort(byValue);
  const listed = rows.reduce((sum, r) => sum + (r.audValue || 0), 0);
  const difference = account.total == null ? 0 : account.total - listed;
  return (
    <section className="asset-group">
      {heading && (
        <header>
          <h3>{account.name}</h3>
          <span className="muted">{pct(total ? account.total / total : null)}</span>
          <strong>{aud(account.total, 2)}</strong>
        </header>
      )}
      {rows.length ? (
        <Table head={["资产", ["数量", "num"], ["市值（AUD）", "num"], ["浮动盈亏", "num"]]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <b>{r.type === "cash" ? r.localCurrency + " 现金" : r.ticker}</b>
                {r.type !== "cash" && <small>{r.name}</small>}
              </td>
              <td className="num">{r.type === "cash" ? "—" : num(r.quantity)}</td>
              <td className="num">{aud(r.audValue, 2)}</td>
              <td className="num">
                {r.type === "cash" ? "—" : <Delta amount={r.gainAud} rate={r.gainRate} digits={0} />}
              </td>
            </tr>
          ))}
          {Math.abs(difference) >= 0.5 && (
            <tr className="adjustment">
              <td>
                券商净值调整
                <small>券商账户净值与按最新报价逐只估值的差额</small>
              </td>
              <td className="num">—</td>
              <td className="num">{signedAud(difference)}</td>
              <td className="num">—</td>
            </tr>
          )}
        </Table>
      ) : (
        <p className="muted">这个账户在估值日没有持仓或现金。</p>
      )}
    </section>
  );
}

function ValuationBasis({ d }) {
  return (
    <details className="basis">
      <summary>估值依据</summary>
      {d.byAccount.map((a) => (
        <p key={a.id}>
          <b>{a.name}</b>
          {a.valuationSource
            ? "采用" + a.valuationSource + "的同日账户净值" + (a.unrealized != null ? "，券商显示未实现盈亏" + (a.approximatePnl ? "约 " : " ") + signedAud(a.unrealized) : "")
            : a.total == null
              ? "估值不完整，" + (a.warnings[0] || "缺少报价或汇率")
              : "按各持仓最新报价和现金余额折算为澳元"}
          。
        </p>
      ))}
      {d.originalValue != null && <p>Wealthfolio 同日原始估值为 {aud(d.originalValue, 2)}。</p>}
    </details>
  );
}

// One line per account and a combined line. Transfers between the selected accounts
// cancel out in the combined line, so it may differ from the sum above it.
function ResultTable({ d, columns }) {
  return (
    <Table head={["账户", ...columns.map((c) => [c.label, "num"])]}>
      {d.byAccount.map((a) => (
        <tr key={a.id}>
          <td>{a.name}</td>
          {columns.map((c) => (
            <td key={c.label} className="num">
              {c.cell(a.result, a.total)}
            </td>
          ))}
        </tr>
      ))}
      {d.byAccount.length > 1 && (
        <tr className="sum">
          <td>合计</td>
          {columns.map((c) => (
            <td key={c.label} className="num">
              {c.cell(d.result, d.total)}
            </td>
          ))}
        </tr>
      )}
    </Table>
  );
}

const money = (n) => aud(n, 2);
const lifetimeColumns = [
  { label: "累计净投入", cell: (r) => money(r.lifetime?.invested) },
  { label: "现值", cell: (r, total) => money(total) },
  { label: "累计盈亏", cell: (r) => <Delta amount={r.lifetime?.gain} /> },
  { label: "收益率", cell: (r) => <Delta rate={r.lifetime?.rate} /> },
];

export function Overview({ d, onPage }) {
  const [detail, setDetail] = useState(null);
  const period = d.result.period,
    life = d.result.lifetime,
    span = periodName(d.period);
  const account = detail?.account && d.byAccount.find((a) => a.id === detail.account);
  const go = (page, init) => {
    setDetail(null);
    onPage(page, init);
  };
  // Cost and unrealised result of a security held in several accounts are combined.
  const gains = new Map();
  for (const r of d.rows) {
    if (r.type === "cash") continue;
    const g = gains.get(r.identityKey) || { cost: 0, gain: 0, known: true };
    if (r.costAud == null || r.gainAud == null) g.known = false;
    else {
      g.cost += r.costAud;
      g.gain += r.gainAud;
    }
    gains.set(r.identityKey, g);
  }
  const cards = [
    {
      id: "total",
      label: "总资产",
      value: d.total == null ? aud(d.known, 2) : aud(d.total, 2),
      caption:
        d.total == null
          ? "已估值小计，另有资产待补报价"
          : "证券 " + aud(d.securities) + " · 现金 " + aud(d.cash),
    },
    {
      id: "invested",
      label: "累计净投入",
      value: aud(life?.invested, 2),
      caption: life ? "自 " + life.since + " 起转入减转出" : "资金流水待核对",
    },
    {
      id: "lifetime",
      label: "累计盈亏",
      value: signedAud(life?.gain),
      direction: tone(life?.gain),
      caption: life ? "累计收益率 " + signedPct(life.rate) : "现值 − 累计净投入",
    },
    {
      id: "period",
      label: span + "盈亏",
      value: signedAud(period?.gain),
      direction: tone(period?.gain),
      caption: period
        ? "收益率 " + signedPct(period.rate) + " · 净入金 " + aud(period.flows)
        : "待核对估值与资金流水",
    },
  ];
  return (
    <>
      <div className="metrics">
        {cards.map((c, i) => (
          <button
            key={c.id}
            className={"metric " + (i === 0 ? "hero-metric" : "")}
            aria-label={c.label + " " + c.value + "，查看明细"}
            onClick={() => setDetail({ kind: c.id })}
          >
            <span>
              {c.label}
              <ChevronRight size={15} />
            </span>
            <strong className={c.direction || ""}>{c.value}</strong>
            <small>{c.caption}</small>
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
          title={"资产走势 · " + span}
          action={
            <span className="muted">
              {d.fromOpening ? "自首笔记录 " : ""}
              {d.start} 至 {d.date} · AUD
            </span>
          }
        >
          <Trend d={d} />
        </Card>
        <Card title="账户">
          <div className="account-list">
            {d.byAccount.map((a, i) => (
              <button key={a.id} onClick={() => setDetail({ kind: "account", account: a.id })}>
                <span className={"account-emblem c" + (i % 3)}>
                  <WalletCards size={18} />
                </span>
                <div>
                  <header>
                    <b>{a.name}</b>
                    <strong>{aud(a.total, 2)}</strong>
                  </header>
                  <div className="bar" aria-hidden="true">
                    <i style={{ width: (d.total && a.total ? (100 * a.total) / d.total : 0) + "%" }} />
                  </div>
                  <dl>
                    <dt>占总资产</dt>
                    <dd>{a.total == null ? "待核对" : pct(d.total ? a.total / d.total : null)}</dd>
                    <dt>累计净投入</dt>
                    <dd>{aud(a.result.lifetime?.invested)}</dd>
                    <dt>累计盈亏</dt>
                    <dd>
                      <Delta amount={a.result.lifetime?.gain} rate={a.result.lifetime?.rate} digits={0} />
                    </dd>
                    <dt>{span}盈亏</dt>
                    <dd>
                      <Delta amount={a.result.period?.gain} rate={a.result.period?.rate} digits={0} />
                    </dd>
                  </dl>
                </div>
                <ChevronRight size={16} />
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
        <Table head={["证券", "类型", ["市值（AUD）", "num"], ["资产占比", "num"], ["浮动盈亏", "num"]]}>
          {d.portfolio.instrumentAllocation
            .filter((r) => r.type !== "cash")
            .slice(0, 5)
            .map((r) => {
              const g = gains.get(r.key);
              return (
                <tr key={r.key}>
                  <td>
                    <button className="ticker" onClick={() => onPage("holdings", { search: r.label })}>
                      {r.label}
                    </button>
                  </td>
                  <td>{kind[r.type]}</td>
                  <td className="num">{aud(r.valueAud, 2)}</td>
                  <td className="num">{pct(r.weight)}</td>
                  <td className="num">
                    {g?.known && g.cost > 0 ? <Delta amount={g.gain} rate={g.gain / g.cost} digits={0} /> : "—"}
                  </td>
                </tr>
              );
            })}
        </Table>
      </Card>
      {detail?.kind === "total" && (
        <Modal wide title={"总资产 · " + aud(d.total ?? d.known, 2)} close={() => setDetail(null)}>
          <p className="muted">估值日 {d.date}，按账户列出持仓和现金。</p>
          {d.byAccount.map((a) => (
            <AccountAssets key={a.id} account={a} total={d.total} />
          ))}
          <ValuationBasis d={d} />
          <div className="actions">
            <button className="primary" onClick={() => go("holdings")}>
              查看全部持仓
            </button>
          </div>
        </Modal>
      )}
      {account && (
        <Modal wide title={account.name + " · " + aud(account.total, 2)} close={() => setDetail(null)}>
          <dl className="stat-grid">
            <div>
              <dt>累计净投入</dt>
              <dd>{money(account.result.lifetime?.invested)}</dd>
            </div>
            <div>
              <dt>累计盈亏</dt>
              <dd>
                <Delta amount={account.result.lifetime?.gain} rate={account.result.lifetime?.rate} />
              </dd>
            </div>
            <div>
              <dt>{span}盈亏</dt>
              <dd>
                <Delta amount={account.result.period?.gain} rate={account.result.period?.rate} />
              </dd>
            </div>
            <div>
              <dt>现金</dt>
              <dd>{money(account.cash)}</dd>
            </div>
          </dl>
          <AccountAssets account={account} total={d.total} heading={false} />
          <div className="actions">
            <button className="primary" onClick={() => go("holdings", { account: account.id })}>
              查看该账户持仓
            </button>
            <button onClick={() => go("imports", { tab: "history", account: account.id })}>查看资金与交易流水</button>
          </div>
        </Modal>
      )}
      {detail?.kind === "invested" && (
        <Modal wide title={"累计净投入 · " + money(life?.invested)} close={() => setDetail(null)}>
          <p className="muted">
            净投入 = 累计转入 − 累计转出，自各账户有记录之日起计。合计行不含所选账户之间的互相划转。
          </p>
          <ResultTable
            d={d}
            columns={[
              { label: "累计转入", cell: (r) => money(r.lifetime?.contributed) },
              { label: "累计转出", cell: (r) => money(r.lifetime?.withdrawn) },
              { label: "累计净投入", cell: (r) => money(r.lifetime?.invested) },
              { label: "现值", cell: (r, total) => money(total) },
            ]}
          />
          <div className="actions">
            <button onClick={() => go("imports", { tab: "history" })}>查看资金流水</button>
          </div>
        </Modal>
      )}
      {detail?.kind === "lifetime" && (
        <Modal wide title={"累计盈亏 · " + signedAud(life?.gain)} close={() => setDetail(null)}>
          <p className="muted">
            累计盈亏 = 现值 − 累计净投入，包含已实现盈亏、分红、费用和汇率变动。收益率 = 累计盈亏 ÷ 累计转入。
          </p>
          <ResultTable d={d} columns={lifetimeColumns} />
          <div className="actions">
            <button className="primary" onClick={() => go("performance")}>
              与指数比较
            </button>
            <button onClick={() => go("holdings")}>查看各持仓浮动盈亏</button>
          </div>
        </Modal>
      )}
      {detail?.kind === "period" && (
        <Modal wide title={span + "盈亏 · " + signedAud(period?.gain)} close={() => setDetail(null)}>
          <p className="muted">
            {d.start} 至 {d.date}。盈亏 = 期末资产 − 期初资产 − 期间净入金；收益率 = 盈亏 ÷（期初资产 + 期间转入的资金）。
            {d.fromOpening && "所选账户自 " + d.start + " 起才有记录，此前资产为零，此后转入的资金都计入期间净入金。"}
          </p>
          <ResultTable
            d={d}
            columns={[
              { label: "期初资产", cell: (r) => money(r.period?.start) },
              { label: "期间净入金", cell: (r) => money(r.period?.flows) },
              { label: "期末资产", cell: (r, total) => money(total) },
              { label: "盈亏", cell: (r) => <Delta amount={r.period?.gain} /> },
              { label: "收益率", cell: (r) => <Delta rate={r.period?.rate} /> },
            ]}
          />
          <p className="muted">
            「策略复盘」使用剔除出入金影响的时间加权收益率，便于和指数比较，数值会与这里不同。
          </p>
          <div className="actions">
            <button className="primary" onClick={() => go("performance")}>
              与指数比较
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

const sorts = {
  value: (r) => r.audValue,
  gain: (r) => r.gainAud,
  rate: (r) => r.gainRate,
  name: (r) => r.ticker,
};
function holdingTotal(rows, field) {
  return rows.every((r) => r[field] != null) ? rows.reduce((sum, r) => sum + r[field], 0) : null;
}
export function Holdings({ d, initial = {}, onPage }) {
  const [q, setQ] = useState(initial.search || ""),
    [filter, setFilter] = useState("all"),
    [account, setAccount] = useState(initial.account || ""),
    [sort, setSort] = useState({ key: "value", down: true }),
    [selectedId, select] = useState(null),
    [events, setEvents] = useState(null),
    [error, setError] = useState("");
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
  const securities = scoped.filter((r) => r.type !== "cash");
  const cash = scoped.filter((r) => r.type === "cash");
  const cost = securities.length ? holdingTotal(securities, "costAud") : null;
  const gain = securities.length ? holdingTotal(securities, "gainAud") : null;
  const sortable = (key, label) => (
    <button
      type="button"
      className="sort"
      aria-label={"按" + label + "排序"}
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
          <dd>{aud(holdingTotal(cash, "audValue"), 2)}</dd>
        </div>
        <div>
          <dt>持仓成本</dt>
          <dd>{aud(cost, 2)}</dd>
        </div>
        <div>
          <dt>浮动盈亏</dt>
          <dd><Delta amount={gain} rate={gain != null && cost > 0 ? gain / cost : null} /></dd>
        </div>
      </dl>
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
          <Empty>没有符合条件的持仓。</Empty>
        ) : (
          <Table
            head={[
              sortable("name", "证券 / 现金"),
              "账户",
              ["数量", "num"],
              ["现价", "num"],
              ["成本均价", "num"],
              [sortable("value", "市值（AUD）"), "num"],
              ["占比", "num"],
              [sortable("gain", "浮动盈亏"), "num"],
              [sortable("rate", "盈亏率"), "num"],
              "报价日期",
            ]}
          >
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => select(r.id)}>
                <td>
                  <button className="ticker" onClick={() => select(r.id)}>
                    {r.ticker}
                  </button>
                  <small>{r.type === "cash" ? "现金" : r.name}</small>
                </td>
                <td>{r.accountName}</td>
                <td className="num">{r.type === "cash" ? fmt(r.quantity, 2) : num(r.quantity)}</td>
                <td className="num">
                  {r.type === "cash" ? "—" : r.price == null ? "待报价" : r.localCurrency + " " + fmt(r.price, 2)}
                  {r.type !== "cash" && r.quoteSource && <small>{r.quoteSource}</small>}
                </td>
                <td className="num">
                  {r.averageCost == null ? "—" : r.localCurrency + " " + fmt(r.averageCost, 2)}
                </td>
                <td className="num">
                  {aud(r.audValue, 2)}
                  {r.localCurrency !== "AUD" && (
                    <small>
                      {r.localCurrency} {fmt(r.nativeValue, 2)}
                    </small>
                  )}
                </td>
                <td className="num">{pct(d.total && r.audValue != null ? r.audValue / d.total : null)}</td>
                <td className="num">{r.type === "cash" ? "—" : <Delta amount={r.gainAud} />}</td>
                <td className="num">{r.type === "cash" ? "—" : <Delta rate={r.gainRate} />}</td>
                <td>
                  {r.priceUpdatedAt || "待报价"}
                  {r.quoteObservedAt && <small>券商快照读取日</small>}
                  {r.stale && <small className="warning">报价较旧</small>}
                  {r.issue && <small className="warning">{r.issue}</small>}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="muted table-note">
          成本按买入均价计算并含手续费，澳元成本按每笔买入当日汇率折算，因此浮动盈亏包含汇率变动。
        </p>
      </Card>
      {row && (
        <Modal
          wide
          title={row.ticker + " · " + row.accountName}
          close={() => {
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
                <dd>{row.averageCost == null ? "流水不足以计算成本" : row.localCurrency + " " + fmt(row.averageCost, 4)}</dd>
                <dt>{row.localCurrency} 计价的市值 · 盈亏</dt>
                <dd>
                  {row.localCurrency} {fmt(row.nativeValue, 2)}
                  {row.gainLocal != null && " · " + (row.gainLocal > 0 ? "+" : row.gainLocal < 0 ? "−" : "") + fmt(Math.abs(row.gainLocal), 2)}
                </dd>
              </>
            )}
            <dt>{row.quoteObservedAt ? "券商快照读取日" : "报价日期"}</dt>
            <dd>{row.priceUpdatedAt || "—"}</dd>
            {row.localCurrency !== "AUD" && (
              <>
                <dt>兑澳元汇率 · 日期</dt>
                <dd>
                  {num(row.fx)} · {row.fxDate || "—"}
                </dd>
              </>
            )}
          </dl>
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
                  <td>{e.metadata?.fx ? "换汇" : types[e.activityType] || e.activityType}</td>
                  <td className="num">
                    {e.currency}{" "}
                    {Number(e.quantity) ? num(e.quantity) + (e.unitPrice != null ? " × " + num(e.unitPrice) : "") : num(e.amount)}
                  </td>
                  <td className="num">{Number(e.fee) ? num(e.fee) : "—"}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="muted">当前持仓来自期初余额或历史持仓快照，没有逐笔流水。</p>
          )}
        </Modal>
      )}
    </>
  );
}
