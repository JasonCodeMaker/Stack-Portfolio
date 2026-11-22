import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronRight, Search, WalletCards } from "lucide-react";
import {
  api,
  aud,
  fmt,
  pct,
  num,
  kind,
  types,
  signedAud,
  tone,
  Delta,
  Card,
  Modal,
  Tabs,
  Table,
  Empty,
} from "./common";
import { HoldingEditor } from "./HoldingEditor";
import { Detail, useRowKeys } from "./Shell";
import { TimeChart, seriesColors } from "./Chart";
import { PeriodControl } from "./FilterControls";
import { isCustom, periodLabels } from "./filters.js";

const periodName = (filters) => (isCustom(filters) ? "期间" : periodLabels[filters.period]);
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
  const securities = rows.filter((r) => r.type !== "cash");
  const cash = rows.filter((r) => r.type === "cash");
  return (
    <section className="asset-group">
      {heading && (
        <header>
          <h3>{account.name}</h3>
          <span className="muted">{pct(total ? account.total / total : null)}</span>
          <strong>{aud(account.total, 2)}</strong>
        </header>
      )}
      {securities.length > 0 && (
        <Table head={["证券", ["股数／份额", "num"], ["市值（AUD）", "num"], ["账面盈亏（AUD）", "num"]]}>
          {securities.map((r) => (
            <tr key={r.id}>
              <td>
                <b>{r.ticker}</b>
                <small>{r.name}</small>
              </td>
              <td className="num">{num(r.rawQuantity)}</td>
              <td className="num">{aud(r.audValue, 2)}</td>
              <td className="num">
                <Delta amount={r.gainAud} rate={r.gainRate} />
              </td>
            </tr>
          ))}
        </Table>
      )}
      {cash.length > 0 && (
        <div className="cash-balances">
          <b>现金余额</b>
          {cash.map((r) => (
            <span key={r.id}>
              {r.localCurrency} 现金 {fmt(r.quantity, 2)}
              {r.localCurrency !== "AUD" && "（" + aud(r.audValue, 2) + "）"}
            </span>
          ))}
        </div>
      )}
      {account.valuationSource && (
        <dl className="valuation-breakdown">
          <div><dt>券商净值 · {account.valuationSource}</dt><dd>{aud(account.total, 2)}</dd></div>
          <div><dt>逐项估值（证券＋现金）</dt><dd>{aud(account.itemizedTotal, 2)}</dd></div>
          <div><dt>待核差额（净值减逐项估值）</dt><dd>{account.valuationDifference == null ? "待补报价或汇率" : signedAud(account.valuationDifference)}</dd></div>
        </dl>
      )}
      {!rows.length && <p className="muted">这个账户在估值日没有持仓或现金。</p>}
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
];

export function Overview({ d, run, onPage, filters, onFilters }) {
  const [detail, setDetail] = useState(null);
  const [repair, setRepair] = useState(null);
  const period = d.result.period,
    life = d.result.lifetime,
    span = periodName(filters);
  const account = detail?.account && d.byAccount.find((a) => a.id === detail.account);
  const go = (page, init) => {
    setDetail(null);
    onPage(page, init);
  };
  const { securities, count, gain } = d.holdings;
  const brokerValued = d.byAccount.some(a => a.valuationSource);
  const pending = securities.filter((g) => g.gain == null);
  const selectedGroup = securities.find((g) => g.key === detail?.key);
  // The review shares the account scope and the period.
  const openPeriod = () => go("performance");
  const groupRows = (group) => d.rows.filter((r) => group.rowIds.includes(r.id));
  const need = (r) =>
    r.price == null ? ["price", "补报价"] : r.fx == null ? ["fx", "补汇率"] : ["cost", "补成本"];
  function repairGain(group) {
    const missing = groupRows(group).filter((row) => row.gainAud == null);
    if (missing.length === 1) {
      const [row] = missing;
      setRepair({row, action:need(row)[0]});
    } else setDetail({kind:"security", key:group.key});
  }
  return (
    <>
      <PeriodControl
        filters={filters}
        range={{ from: d.start, to: d.end ?? d.date }}
        valuationDate={d.date}
        onChange={onFilters}
      />
      <section className="overview-totals" aria-label="当前资产与账面盈亏">
        <button
          className="metric hero-metric"
          aria-label={"总资产 " + aud(d.total ?? d.known, 2) + "，查看明细"}
          aria-describedby={brokerValued ? "overview-valuation overview-difference" : "overview-valuation"}
          onClick={() => setDetail({ kind: "total" })}
        >
          <span>
            {d.total == null ? "总资产 · 已估值小计" : "总资产"}
            <ChevronRight size={16} />
          </span>
          <strong>{aud(d.total ?? d.known, 2)}</strong>
          <small id="overview-valuation">
            证券市值 {aud(d.securities, 2)}　·　现金 {aud(d.itemizedCash, 2)}
          </small>
          {brokerValued && (
            <small className="valuation-note" id="overview-difference">
              {d.byAccount.every(a => a.valuationSource) ? "按券商净值" : "含券商净值"} · 逐项估值 {aud(d.itemizedTotal, 2)}
              {d.valuationDifference == null ? " · 差额待补资料"
                : Math.abs(d.valuationDifference) >= 0.005 ? " · 待核差额 " + signedAud(d.valuationDifference)
                : d.byAccount.some(a => Math.abs(a.valuationDifference) >= 0.005) ? " · 分账户差额待核对" : " · 金额吻合"}
            </small>
          )}
        </button>
        <button className="metric" onClick={() => setDetail({ kind: "gain" })}>
          <span>
            {pending.length ? "已知持仓账面盈亏" : "持仓账面盈亏"}
            <ChevronRight size={16} />
          </span>
          <strong className={tone(gain)}>{signedAud(gain)}</strong>
          <small>
            {pending.length
              ? "已计入 " +
                count +
                "/" +
                securities.length +
                " 只 · " +
                pending
                  .slice(0, 2)
                  .map((r) => r.ticker)
                  .join("、") +
                " 待补资料"
              : "截至 " + d.date + " · " + count + " 只证券"}
          </small>
        </button>
      </section>
      <Card
        title="全部证券持仓"
        action={
          <button className="text-btn" onClick={() => go("holdings")}>
            按账户查看 <ArrowUpRight size={15} />
          </button>
        }
      >
        {securities.length ? (
          <Table
            head={[
              "证券",
              ["股数／份额", "num"],
              ["市值（AUD）", "num"],
              ["账面盈亏（AUD）", "num"],
              ["组合占比", "num"],
            ]}
          >
            {securities.map((g) => (
              <tr key={g.key}>
                <td>
                  <button className="ticker" onClick={() => setDetail({ kind: "security", key: g.key })}>
                    {g.ticker}
                  </button>
                  <small>{[g.name, g.mic, g.localCurrency].filter(Boolean).join(" · ")}</small>
                </td>
                <td className="num">{num(g.quantity)}</td>
                <td className="num">{aud(g.value, 2)}</td>
                <td className="num">
                  {g.gain != null ? (
                    <Delta amount={g.gain} />
                  ) : (
                    <button className="text-btn" onClick={() => repairGain(g)}>
                      {g.value == null ? "补估值资料" : "补成本"}
                    </button>
                  )}
                </td>
                <td className="num">{pct(d.total > 0 && g.value != null ? g.value / d.total : null)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>所选账户在估值日没有证券持仓。</Empty>
        )}
      </Card>
      {d.issues.length > 0 && (
        <details className="card data-issues">
          <summary>有 {d.issues.length} 项数据待核对</summary>
          {d.issues.map((issue, i) => {
            const row = issue.rowId && d.rows.find((r) => r.id === issue.rowId);
            return (
              <div key={i}>
                <span>
                  {issue.account} · {issue.reason}
                </span>
                {row ? (
                  <button className="text-btn" onClick={() => setRepair({ row, action: issue.action })}>
                    {issue.action === "fx" ? "补汇率" : "补报价"}
                  </button>
                ) : (
                  <button
                    className="text-btn"
                    onClick={() => go("imports", { tab: "check", account: issue.id })}
                  >
                    和券商结单核对
                  </button>
                )}
              </div>
            );
          })}
        </details>
      )}
      <div className="dashboard-grid">
        <Card title="历史表现">
          <div className="history-results">
            <button onClick={openPeriod} aria-label={span + "盈亏 " + signedAud(period?.gain) + "，进入复盘"}>
              <span>
                {span}盈亏 <ArrowUpRight size={14} />
              </span>
              <Delta amount={period?.gain} />
            </button>
            <button onClick={() => setDetail({ kind: "lifetime" })}>
              <span>
                自开始记录累计盈亏 <ChevronRight size={14} />
              </span>
              <Delta amount={life?.gain} />
            </button>
          </div>
          <Trend d={d} />
          <div className="actions">
            <span className="muted">
              {d.start} 至 {d.end ?? d.date}
            </span>
            <button className="text-btn" onClick={() => setDetail({ kind: "period" })}>
              查看期间计算
            </button>
            <button className="text-btn" onClick={() => setDetail({ kind: "invested" })}>
              累计净投入 {aud(life?.invested)}
            </button>
          </div>
        </Card>
        <Card title="账户余额">
          <div className="account-list">
            {d.byAccount.map((a) => (
              <button key={a.id} onClick={() => setDetail({ kind: "account", account: a.id })}>
                <WalletCards size={18} />
                <div>
                  <b>{a.name}</b>
                  <strong>{aud(a.total, 2)}</strong>
                  <small>账户记录截至 {a.balanceDate || "暂无记录"}</small>
                </div>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </Card>
      </div>
      {(detail?.kind === "gain" || selectedGroup) && (
        <Modal
          wide
          title={selectedGroup ? selectedGroup.ticker + " · 各账户持仓" : "持仓账面盈亏明细"}
          close={() => setDetail(null)}
        >
          <p className="muted">每只证券的原币市值减去剩余股份的含费买入成本，再按估值汇率折成澳元。</p>
          <Table
            head={["证券／账户", ["股数／份额", "num"], ["市值（AUD）", "num"], ["账面盈亏（AUD）", "num"]]}
          >
            {(selectedGroup ? groupRows(selectedGroup) : d.rows.filter((r) => r.type !== "cash")).map((r) => (
              <tr key={r.id}>
                <td>
                  {r.ticker}
                  <small>{r.accountName}</small>
                </td>
                <td className="num">{num(r.quantity)}</td>
                <td className="num">{aud(r.audValue, 2)}</td>
                <td className="num">
                  {r.gainAud != null ? (
                    <Delta amount={r.gainAud} />
                  ) : (
                    <button onClick={() => setRepair({ row: r, action: need(r)[0] })}>{need(r)[1]}</button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Modal>
      )}
      {repair && <HoldingEditor {...repair} d={d} run={run} close={() => setRepair(null)} />}
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
                <Delta amount={account.result.lifetime?.gain} />
              </dd>
            </div>
            <div>
              <dt>{span}盈亏</dt>
              <dd>
                <Delta amount={account.result.period?.gain} rate={account.result.period?.twr} />
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
            <button onClick={() => go("imports", { tab: "history", account: account.id })}>
              查看资金与交易流水
            </button>
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
            累计盈亏 = 现值 − 累计净投入，包含已实现盈亏、分红、费用和汇率变动。
          </p>
          <ResultTable d={d} columns={lifetimeColumns} />
          <div className="actions">
            <button className="primary" onClick={openPeriod}>
              与指数比较
            </button>
            <button onClick={() => go("holdings")}>查看各持仓浮动盈亏</button>
          </div>
        </Modal>
      )}
      {detail?.kind === "period" && (
        <Modal wide title={span + "盈亏 · " + signedAud(period?.gain)} close={() => setDetail(null)}>
          <p className="muted">
            {d.start} 至 {d.end ?? d.date}。盈亏 = 期末资产 − 期初资产 − 期间净入金，按每日收盘估值。
            {d.fromOpening &&
              "所选账户自 " + d.start + " 起才有记录，此前资产为零，此后转入的资金都计入期间净入金。"}
          </p>
          <ResultTable
            d={d}
            columns={[
              { label: "期初资产", cell: (r) => money(r.period?.start) },
              { label: "期间净入金", cell: (r) => money(r.period?.flows) },
              { label: "期末资产", cell: (r) => money(r.period?.end) },
              { label: "盈亏", cell: (r) => <Delta amount={r.period?.gain} /> },
              { label: "时间加权收益率", cell: (r) => <Delta rate={r.period?.twr} /> },
            ]}
          />
          <p className="muted">
            时间加权收益率剔除出入金影响，与「收益复盘」同一期间的数字一致。
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
