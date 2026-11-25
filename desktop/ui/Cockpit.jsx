import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { canonicalIdentity } from "../allocation/domain/identifiers";
import { api, aud, fmt, kind, num, signedPct, types, Delta } from "./common";
import { HoldingEditor } from "./HoldingEditor";
import { Detail, useRowKeys, useShell } from "./Shell";
import { closeTimeLabel, quoteDetails, quoteStatus } from "./MarketQuotes";
import "./holdings.css";

const price = (n) => new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
const sorts = {
  name: (r) => r.ticker,
  value: (r) => r.audValue,
  gain: (r) => r.gainAud,
  rate: (r) => r.gainRate,
};
const categories = [["all", "全部"], ["stock", "股票"], ["etf", "ETF"]];

function sum(rows, value) {
  const values = rows.map(value);
  return values.some((n) => n == null) ? null : values.reduce((total, n) => total + n, 0);
}

function amountWithCash(value, cash) {
  return value == null || cash == null ? null : value + cash;
}

function HoldingsTotals({ d, rows, filtered }) {
  const securities = filtered ? sum(rows, (r) => r.audValue) : d.securities;
  const cash = d.valuation.cash;
  const total = filtered ? amountWithCash(securities, cash) : d.valuation.total;
  const cost = sum(rows, (r) => r.costAud);
  const gain = sum(rows, (r) => r.gainAud);
  const missingCost = rows.some((r) => r.costLocal == null);
  const change = d.currentMarket
    ? (filtered ? sum(rows, (r) => r.recentCloseChange) : d.currentMarket.recentCloseChange.total)
    : (filtered ? sum(rows, (r) => r.today?.change) : d.today?.change);
  const realised = filtered ? sum(rows, (r) => r.realised) : d.cumulative.realised;
  const dividends = filtered ? sum(rows, (r) => r.dividends) : d.cumulative.dividends;
  return (
    <div className="holdings-totals" role="group" aria-label="持仓合计">
      <span>
        <span className="cap">合计市值</span> <b className="holdings-total-value">{aud(total, 2)}</b>{" "}
        <span className="cap">证券 {aud(securities, 2)} + 现金 {aud(cash, 2)}</span>
      </span>
      <span><span className="cap">成本</span> <b>{missingCost ? "待补" : aud(cost, 2)}</b></span>
      <span>
        <span className="cap">未实现盈亏</span>{" "}
        <b>{missingCost ? "待补" : <Delta amount={gain} rate={gain != null && cost > 0 ? gain / cost : null} />}</b>
      </span>
      <span>
        <span className="cap">{d.currentMarket ? "最近收盘变动" : "收盘变动" + (d.today?.date ? " · " + d.today.date : "")}</span>{" "}
        <b><Delta amount={change} /></b>
      </span>
      <span><span className="cap">累计已实现</span> <b><Delta amount={realised} /></b></span>
      <span><span className="cap">累计分红</span> <b>{aud(dividends, 2)}</b></span>
    </div>
  );
}

const cashRowId = (account) => "cash-account:" + account.id;

function AccountCard({ account, rows, filtered, sort, setSort, selectedId, arrival, select, selectCash, current }) {
  const title = useId();
  const cash = account.valuation.cash;
  const total = filtered ? amountWithCash(sum(rows, (r) => r.audValue), cash) : account.valuation.total;
  const sortOrder = (key) => sort.key === key ? (sort.down ? "descending" : "ascending") : undefined;
  const sortable = (key, label) => (
    <button
      type="button"
      className="holdings-sort"
      aria-label={"按" + label + "排序"}
      onClick={() => setSort({ key, down: sort.key === key ? !sort.down : key !== "name" })}
    >
      {label}
      {sort.key === key && (sort.down ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUp size={12} aria-hidden="true" />)}
    </button>
  );

  return (
    <section className="card holdings-card" aria-labelledby={title}>
      <div className="row holdings-card-head">
        <h2 id={title}>{account.name}</h2>
        <span className="cap">{rows.length} 只 · {current && total == null ? "可估值小计 " + aud(account.known, 2) : "市值 " + aud(total, 2)}</span>
      </div>
      <div className="holdings-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" aria-sort={sortOrder("name")}>{sortable("name", "证券")}</th>
              <th scope="col">股数</th>
              <th scope="col" className="hide-n">成本</th>
              <th scope="col" aria-sort={sortOrder("value")}>{sortable("value", "市值")}</th>
              <th scope="col" aria-sort={sortOrder("gain") || sortOrder("rate")}>
                {sortable("gain", "未实现盈亏")} <span className="hide-n">/ {sortable("rate", "盈亏率")}</span>
              </th>
              <th scope="col">{current ? "现价" : "收盘贡献"}</th>
              <th scope="col">{current ? "较本市场前收盘" : "报价涨跌幅"}</th>
              <th scope="col" className="hide-n">累计已实现</th>
              <th scope="col" className="hide-n">累计分红</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const quote = r.quoteChange === undefined ? r.today?.priceChange : r.quoteChange;
              return (
                <tr
                  key={r.id}
                  data-holding-row={r.id}
                  data-row={r.id}
                  className={"click" + (selectedId === r.id ? " sel" : "") + (arrival === r.id ? " holdings-arrival" : "")}
                  onClick={() => select(r.id)}
                >
                  <td>
                    <div className="holdings-security">
                      <button type="button" className="ticker">{r.ticker}</button>
                      {r.name && <i className="holdings-name" title={r.name}>{r.name}</i>}
                    </div>
                  </td>
                  <td>{num(r.rawQuantity)}</td>
                  <td className="hide-n">{r.costLocal == null ? <span className="warn">待补</span> : aud(r.costAud, 2)}</td>
                  <td>{aud(r.audValue, 2)}</td>
                  <td>{r.costLocal == null ? <span className="warn">待补</span> : <Delta amount={r.gainAud} rate={r.gainRate} />}</td>
                  <td>{current ? (
                    <span title={quoteDetails(r.marketQuote)}>
                      {r.price == null ? "—" : r.localCurrency + " " + price(r.price)}
                      <small>{quoteStatus(r.marketQuote)}</small>
                    </span>
                  ) : <Delta amount={r.today?.change} />}</td>
                  <td><Delta rate={quote?.change} />{quote && <small title={current ? "布里斯班时间" : undefined}>{closeTimeLabel(quote.closedAt, quote.date)}</small>}</td>
                  <td className="hide-n">{r.realised ? <Delta amount={r.realised} /> : "—"}</td>
                  <td className="hide-n">{r.dividends ? aud(r.dividends, 2) : "—"}</td>
                </tr>
              );
            })}
            <tr data-row={cashRowId(account)}
              className={"holdings-cash click" + (selectedId === cashRowId(account) ? " sel" : "")}
              onClick={() => selectCash(account)}>
              <td><button type="button" className="ticker" aria-label={account.name + "现金"}>现金</button></td>
              <td />
              <td className="hide-n" />
              <td>{aud(cash, 2)}</td>
              <td />
              <td />
              <td />
              <td className="hide-n" />
              <td className="hide-n" />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

const holdingKey = (r) => JSON.stringify([r.identityKey, r.localCurrency]);
const listingKey = (a) => JSON.stringify([canonicalIdentity(a).key || "asset:" + a.id, a.currency]);

function linkedSecurity(d, { assetId, symbol }) {
  if (!assetId && symbol) {
    const listings = d.listings.filter((a) => a.symbol.toUpperCase() === symbol.toUpperCase());
    if (new Set(listings.map(listingKey)).size !== 1) return null;
    assetId = listings[0].id;
  }
  if (!assetId) return null;
  const listing = d.listings.find((a) => a.id === assetId);
  const key = listing && listingKey(listing);
  const rows = d.rows.filter((r) => r.type !== "cash" && (r.assetId === assetId || (key && holdingKey(r) === key)));
  const row = rows.sort((a, b) => (b.audValue ?? -Infinity) - (a.audValue ?? -Infinity))[0];
  return { assetId, symbol, rowId: row?.id };
}

// A review link can point to a listing with history but no open position.
export function selectedSecurity(d, selection) {
  if (!selection) return null;
  const { assetId, rowId, symbol } = selection;
  const listing = d.listings.find((a) => a.id === assetId);
  const origin = d.rows.find((r) => r.type !== "cash" && r.assetId === assetId);
  const key = origin ? holdingKey(origin) : listing && listingKey(listing);
  const group = d.holdings.securities.find((s) => s.key === key);
  const rows = group ? d.rows.filter((r) => group.rowIds.includes(r.id)) : [];
  const row = rows.find((r) => r.id === rowId) || rows[0];
  const ids = new Set([assetId, ...rows.map((r) => r.assetId)]);
  for (const a of d.listings) if (listingKey(a) === key) ids.add(a.id);
  const closed = d.byAccount.flatMap((a) => a.cumulative.closed
    .filter((h) => ids.has(h.assetId))
    .map((h) => ({ ...h, accountId: a.id })),
  );
  return {
    ticker: row?.ticker || listing?.symbol || symbol || assetId,
    name: row?.name || listing?.name,
    currency: row?.localCurrency || listing?.currency,
    mic: row?.mic || listing?.mic,
    type: row?.type || d.settings.typeOverrides[assetId],
    ids: [...ids],
    row,
    rows,
    group,
    closed,
    daily: group?.today ?? d.today?.securities?.find((r) => r.key === key),
    realised: sum([...rows, ...closed], (r) => r.realised),
    dividends: sum([...rows, ...closed], (r) => r.dividends),
  };
}

const historyLimit = 60;
function DetailHistory({ events, error, accounts }) {
  if (error) return <p className="cap warn" role="status">{error}</p>;
  if (events == null) return <p className="cap" role="status">正在读取流水…</p>;
  if (!events.length) return <p className="cap">没有相关流水。</p>;
  return (
    <>
      {events.length === historyLimit && <p className="cap">最近 {historyLimit} 笔</p>}
      <div className="holdings-table-scroll">
        <table>
          <thead>
            <tr><th scope="col">日期</th><th scope="col">类型</th><th scope="col">数量</th><th scope="col">金额</th></tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const amount = e.amount ?? (e.unitPrice != null && e.quantity != null ? Number(e.unitPrice) * Number(e.quantity) : null);
              const execution = e.metadata?.ibkrExecution;
              const name = accounts.find((a) => a.id === e.accountId)?.name;
              return (
                <tr key={e.id}>
                  <td>{e.date.slice(0, 10)}</td>
                  <td title={execution?.fxRateToBase ? "1 " + execution.currency + " = " + num(execution.fxRateToBase) + " " + execution.baseCurrency : undefined}>
                    {e.activityType === "DIVIDEND" ? "分红" : types[e.activityType] || e.activityType}
                    {accounts.length > 1 && <small title={name}>{name}</small>}
                  </td>
                  <td>{e.quantity == null ? "—" : num(e.quantity)}</td>
                  <td>
                    {amount == null ? "—" : e.currency + " " + fmt(amount, 2)}
                    {Boolean(Number(e.fee)) && <small>费用 {fmt(e.fee, 2)}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SecurityDetail({ d, security, onClose, openRepair, dock }) {
  const [history, setHistory] = useState(null);
  const { row, rows, group, closed, daily, currency } = security;
  const quote = group?.quoteChange;
  const showQuote = quote !== undefined;
  const closeDate = d.today?.date;
  const request = JSON.stringify([d.selected, d.date, security.ids]);
  const { events, error } = history?.request === request ? history : {};
  useEffect(() => {
    let active = true;
    api.history({ accountIds: d.selected, assetIds: security.ids, through: d.date, limit: historyLimit })
      .then((events) => {
        if (active) setHistory({ request, events });
      })
      .catch((e) => { if (active) setHistory({ request, error: e.message }); });
    return () => { active = false; };
  }, [d, request]);

  const quantities = d.byAccount.flatMap(({ id, name }) => {
    const held = rows.filter((r) => r.accountId === id);
    if (held.length || closed.some((r) => r.accountId === id) || events?.some((e) => e.accountId === id))
      return [{ id, name, quantity: sum(held, (r) => Number(r.rawQuantity)) }];
    return [];
  });
  const quantity = Number(group?.quantity ?? 0);
  const localCost = sum(rows, (r) => r.costLocal);
  const average = quantity > 0 && localCost != null ? localCost / quantity : null;
  const gainRate = group?.gain != null && group.cost > 0 ? group.gain / group.cost : null;
  const missingCost = rows.some((r) => r.costLocal == null);
  const withinCurrency = (n) => n == null ? "—" : currency + " " + price(n);
  return (
    <Detail title={security.ticker} onClose={onClose} wide={dock !== undefined} dock={dock}>
      <div className="holdings-detail">
        <div className="row m0 holdings-detail-meta">
          {security.name && security.name !== security.ticker && <span className="cap">{security.name}</span>}
          {row && <span className="tag">{row.accountName}</span>}
          {security.type && <span className="tag">{kind[security.type]}</span>}
          {security.mic && <span className="tag">{security.mic}</span>}
          {currency && <span className="tag">{currency}</span>}
          {!row && <span className="tag">{events?.some((e) => e.activityType === "SELL") ? "已卖清" : "当前无持仓"}</span>}
        </div>
        {group && (
          <div className="dl">
            <div><span className="cap">市值</span><b>{aud(group.value, 2)}</b></div>
            <div>
              <span className="cap">未实现盈亏</span>
              <b>{missingCost ? <span className="warn">待补</span> : <Delta amount={group.gain} />}</b>
              {gainRate != null && <span className="cap">盈亏率 {signedPct(gainRate)}</span>}
            </div>
            <div><span className="cap">成本（含费用）</span><b>{missingCost ? "待补" : aud(group.cost, 2)}</b></div>
            <div>
              {showQuote ? (
                <>
                  <span className="cap">{d.currentMarket ? "较本市场前收盘" : "报价涨跌"}{quote && " · " + (d.currentMarket ? "布里斯班 " : "") + closeTimeLabel(quote.closedAt, quote.date)}</span>
                  {quote ? <b>{d.currentMarket ? <><Delta rate={quote.change} /> · {currency} {fmt(quote.amount, 2)}</> :
                    <Delta amount={quote.amount} rate={quote.change} />}</b> : <b>暂无可核实涨跌</b>}
                </>
              ) : (
                <>
                  <span className="cap">收盘贡献{closeDate && " · " + closeDate}</span><b><Delta amount={daily?.change} /></b>
                  {daily?.priceChange && (
                    <span className="cap">{daily.priceChange.date} 涨跌幅 {signedPct(daily.priceChange.change)}（{currency}）</span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <section>
          <h3>{group ? "价格与成本" : "累计收益"}</h3>
          <table>
            <tbody>
              <tr><th scope="row">合计股数</th><td><b>{num(group?.quantity ?? 0)}</b></td></tr>
              {quantities.map((a) => <tr key={a.id}><th scope="row">{a.name}</th><td>{num(a.quantity)}</td></tr>)}
              {row && (
                <>
                  <tr><th scope="row">买入均价</th><td>{missingCost ? "待补" : withinCurrency(average)}</td></tr>
                  <tr>
                    <th scope="row">现价</th>
                    <td title={[row.quoteSource, row.priceUpdatedAt].filter(Boolean).join(" · ")}>{withinCurrency(row.price)}</td>
                  </tr>
                  {d.currentMarket && <tr><th scope="row">报价状态</th><td>{quoteDetails(row.marketQuote)}</td></tr>}
                  {row.fx && currency !== "AUD" && (
                    <tr><th scope="row">汇率</th><td title={[row.fxSource, row.fxDate].filter(Boolean).join(" · ")}>1 {currency} = {num(row.fx)} AUD</td></tr>
                  )}
                </>
              )}
              {showQuote && daily?.change != null && (
                <tr><th scope="row">收盘贡献{closeDate && " · " + closeDate}</th><td><Delta amount={daily.change} /></td></tr>
              )}
              <tr><th scope="row">累计已实现盈亏</th><td><Delta amount={security.realised} /></td></tr>
              <tr><th scope="row">累计分红</th><td>{aud(security.dividends, 2)}</td></tr>
            </tbody>
          </table>
          {row?.costReceipt && (
            <p className="cap">成本凭据 · {row.costReceipt.day} · {row.costReceipt.reference}
              {row.costReceipt.historicalAud != null && " · 凭据中的历史澳元成本 " + aud(row.costReceipt.historicalAud, 2)}
            </p>
          )}
          {row?.evidence && (
            <p className="cap">{row.evidence.day} · {row.evidence.quantityReference} 记载 {num(row.evidence.quantity)} 股，账本当日可解释 {num(row.evidence.ledgerQuantity)} 股。</p>
          )}
        </section>
        <section>
          <h3>关联流水</h3>
          <DetailHistory events={events} error={error} accounts={d.byAccount} />
        </section>
        {row && (
          <section>
            <h3>补数据</h3>
            <div className="row m0 holdings-repairs">
              <button className="btn sm" type="button" onClick={() => openRepair({ row, action: "cost" })}>补成本</button>
              <button className="btn sm" type="button" onClick={() => openRepair({ row, action: "price" })}>补报价</button>
              {currency !== "AUD" && <button className="btn sm" type="button" onClick={() => openRepair({ row, action: "fx" })}>补汇率</button>}
              <button className="btn sm" type="button" onClick={() => openRepair({ row, action: "type" })}>更正证券类别</button>
            </div>
          </section>
        )}
      </div>
    </Detail>
  );
}

export function Holdings({ d, initial = {}, run }) {
  const [q, setQ] = useState(initial.search || ""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState({ key: "value", down: true }),
    [selection, setSelection] = useState(() => linkedSecurity(d, initial)),
    [arrival, setArrival] = useState(selection?.rowId),
    [repair, setRepair] = useState(null);
  const { aspect } = useShell();
  const [dock, setDock] = useState(null);
  const root = useRef(null);
  const returnTo = useRef(null);
  const cash = d.byAccount.find((account) => account.id === selection?.cashAccountId);
  const security = useMemo(() => selection?.cashAccountId ? null : selectedSecurity(d, selection), [d, selection]);
  const selectedId = cash ? cashRowId(cash) : security?.row?.id;
  const rowButton = (id) => id && root.current?.querySelector('[data-row="' + CSS.escape(id) + '"] .ticker');

  useEffect(() => {
    if (!arrival) return;
    const timer = setTimeout(() => setArrival(null), 1200);
    return () => clearTimeout(timer);
  }, [arrival]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const button = rowButton(selectedId);
      button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (arrival && !document.querySelector("dialog[open]")) button?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, aspect, arrival]);
  useLayoutEffect(() => {
    if (selection || repair || returnTo.current == null) return;
    const { rowId, scrollTop } = returnTo.current;
    returnTo.current = null;
    const pane = root.current?.closest(".pane");
    if (pane && scrollTop != null) pane.scrollTop = scrollTop;
    const target = rowButton(rowId) || root.current?.querySelector('input[type="search"]');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection, repair]);

  const closeDetail = () => {
    returnTo.current = { rowId: selectedId };
    setSelection(null);
  };
  const query = q.trim().toLowerCase();
  const filtered = filter !== "all" || Boolean(query);
  const securities = d.rows.filter((r) => r.type !== "cash");
  const value = sorts[sort.key];
  const rowsByAccount = d.byAccount.map((account) => ({
    account,
    rows: account.rows
      .filter((r) =>
        r.type !== "cash" &&
        (filter === "all" || r.type === filter) &&
        (r.ticker + " " + r.name).toLowerCase().includes(query),
      )
      .sort((a, b) => {
        const x = value(a), y = value(b);
        if (x == null || y == null) return (x == null) - (y == null);
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * (sort.down ? -1 : 1);
      }),
  }));
  const rows = rowsByAccount.flatMap(({ rows }) => rows);
  const selectCash = (account) => {
    setArrival(null);
    setSelection({ cashAccountId: account.id });
    if (!document.querySelector("dialog[open]")) rowButton(cashRowId(account))?.focus({ preventScroll: true });
  };
  const select = (id) => {
    const cashAccount = d.byAccount.find((account) => cashRowId(account) === id);
    if (cashAccount) return selectCash(cashAccount);
    const row = securities.find((r) => r.id === id);
    if (!row) return;
    setArrival(null);
    setSelection({ assetId: row.assetId, symbol: row.ticker, rowId: id });
    if (!document.querySelector("dialog[open]")) rowButton(id)?.focus({ preventScroll: true });
  };
  const rowKeys = useRowKeys(rowsByAccount.flatMap(({ account, rows }) => [...rows.map((r) => r.id), cashRowId(account)]), selectedId, select);

  return (
    <div className="holdings" ref={root} onKeyDown={(e) => {
      if (!repair && e.target.closest("[data-row], .insp, dialog")) rowKeys(e);
    }}>
      <div className="holdings-master">
        <div className="row m0 holdings-tools">
          <input
            className="btn"
            type="search"
            placeholder="搜索代码或名称"
            aria-label="搜索持仓"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="seg" role="group" aria-label="证券类别">
            {categories.map(([id, name]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "on" : ""}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {name}
              </button>
            ))}
          </span>
          <span className="cap" role="status">{filtered ? "显示 " + rows.length + " / " + securities.length + " 只" : securities.length + " 只证券"}</span>
          <span className="sp" />
          <button className="btn" type="button" onClick={() => setRepair({ action: "position" })}>＋ 补持仓</button>
        </div>
        <HoldingsTotals {...{ d, rows, filtered }} />
        {!rows.length && <p className="card cap">没有匹配的证券。</p>}
        <div className="col">
          {rowsByAccount.map(({ account, rows }) => (
            <AccountCard key={account.id} current={Boolean(d.currentMarket)}
              {...{ account, rows, filtered, sort, setSort, selectedId, arrival, select, selectCash }} />
          ))}
        </div>
      </div>
      {aspect === "21:9" && (
        <div ref={setDock} className="holdings-inspector">
          {!cash && !security && <section className="card"><h2>持仓明细</h2><p className="cap">选择一项证券或现金查看明细。</p></section>}
        </div>
      )}
      {cash && <CashDetail account={cash} onClose={closeDetail} dock={dock} />}
      {security && (
        <SecurityDetail
          d={d}
          security={security}
          onClose={closeDetail}
          dock={dock}
          openRepair={(next) => setRepair({ ...next, scrollTop: root.current?.closest(".pane")?.scrollTop })}
        />
      )}
      {repair && (
        <HoldingEditor
          d={d}
          run={run}
          action={repair.action}
          row={repair.row}
          close={(saved) => {
            if (saved && repair.row) {
              returnTo.current = { rowId: repair.row.id, scrollTop: repair.scrollTop };
              setSelection(null);
            }
            setRepair(null);
          }}
        />
      )}
    </div>
  );
}

function CashDetail({ account, onClose, dock }) {
  const rows = account.rows.filter((row) => row.type === "cash");
  return (
    <Detail title={account.name + " · 现金"} onClose={onClose} wide dock={dock}>
      <div className="holdings-detail">
        <p className="cap">现金市值 {aud(account.valuation.cash, 2)}</p>
        {rows.length ? (
          <table>
            <thead><tr><th>币种</th><th>原币余额</th><th>市值（AUD）</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.localCurrency}</th>
                  <td>{fmt(row.nativeValue ?? row.rawQuantity, 2)}</td>
                  <td>{aud(row.audValue, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="cap">暂无现金余额。</p>}
        {account.cashUnverified && <p className="warn">现金余额待核对。</p>}
      </div>
    </Detail>
  );
}
