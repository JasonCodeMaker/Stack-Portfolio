import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { canonicalIdentity } from "../allocation/domain/identifiers";
import { api, aud, fmt, kind, num, signedPct, types, Delta } from "./common";
import { HoldingEditor } from "./HoldingEditor";
import { Detail, useRowKeys, useShell } from "./Shell";
import { closeTimeLabel, quoteDetails, quoteStatus } from "./MarketQuotes";
import { useI18n } from "./i18n.jsx";
import "./holdings.css";

const price = (n) => new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
const sorts = {
  name: (r) => r.ticker,
  value: (r) => r.audValue,
  gain: (r) => r.gainAud,
  rate: (r) => r.gainRate,
};
const categoryIds = ["all", "stock", "etf"];

function sum(rows, value) {
  const values = rows.map(value);
  return values.some((n) => n == null) ? null : values.reduce((total, n) => total + n, 0);
}

function amountWithCash(value, cash) {
  return value == null || cash == null ? null : value + cash;
}

function HoldingsTotals({ d, rows, filtered }) {
  const { t } = useI18n();
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
    <div className="holdings-totals" role="group" aria-label={t("holdings.totalsAria")}>
      <span>
        <span className="cap">{t("holdings.totalValue")}</span> <b className="holdings-total-value">{aud(total, 2)}</b>{" "}
        <span className="cap">{t("holdings.breakdownInline", { securities: aud(securities, 2), cash: aud(cash, 2) })}</span>
      </span>
      <span><span className="cap">{t("holdings.cost")}</span> <b>{missingCost ? t("common.pending") : aud(cost, 2)}</b></span>
      <span>
        <span className="cap">{t("holdings.unrealised")}</span>{" "}
        <b>{missingCost ? t("common.pending") : <Delta amount={gain} rate={gain != null && cost > 0 ? gain / cost : null} />}</b>
      </span>
      <span>
        <span className="cap">{d.currentMarket ? t("overview.recentCloseChange") : t("overview.closeChange") + (d.today?.date ? " · " + d.today.date : "")}</span>{" "}
        <b><Delta amount={change} /></b>
      </span>
      <span><span className="cap">{t("holdings.realised")}</span> <b><Delta amount={realised} /></b></span>
      <span><span className="cap">{t("holdings.dividends")}</span> <b>{aud(dividends, 2)}</b></span>
    </div>
  );
}

const cashRowId = (account) => "cash-account:" + account.id;

function AccountCard({ account, rows, filtered, sort, setSort, selectedId, arrival, select, selectCash, current }) {
  const { t, intlLocale, sourceLabel } = useI18n();
  const title = useId();
  const cash = account.valuation.cash;
  const total = filtered ? amountWithCash(sum(rows, (r) => r.audValue), cash) : account.valuation.total;
  const sortOrder = (key) => sort.key === key ? (sort.down ? "descending" : "ascending") : undefined;
  const sortable = (key, label) => (
    <button
      type="button"
      className="holdings-sort"
      aria-label={t("holdings.sortAria", { label })}
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
        <span className="cap">
          {t("holdings.accountSummary", {
            count: rows.length,
            summary: current && total == null
              ? t("holdings.valuedSubtotal", { value: aud(account.known, 2) })
              : t("holdings.marketValueLabel", { value: aud(total, 2) }),
          })}
        </span>
      </div>
      <div className="holdings-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" aria-sort={sortOrder("name")}>{sortable("name", t("holdings.col.security"))}</th>
              <th scope="col">{t("holdings.col.qty")}</th>
              <th scope="col" className="hide-n">{t("holdings.col.cost")}</th>
              <th scope="col" aria-sort={sortOrder("value")}>{sortable("value", t("holdings.col.value"))}</th>
              <th scope="col" aria-sort={sortOrder("gain") || sortOrder("rate")}>
                {sortable("gain", t("holdings.col.gain"))} <span className="hide-n">/ {sortable("rate", t("holdings.col.rate"))}</span>
              </th>
              <th scope="col">{current ? t("holdings.col.price") : t("holdings.col.closeContrib")}</th>
              <th scope="col">{current ? t("holdings.col.vsPrevClose") : t("holdings.col.quotePct")}</th>
              <th scope="col" className="hide-n">{t("holdings.col.realised")}</th>
              <th scope="col" className="hide-n">{t("holdings.col.dividends")}</th>
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
                  <td className="hide-n">{r.costLocal == null ? <span className="warn">{t("common.pending")}</span> : aud(r.costAud, 2)}</td>
                  <td>{aud(r.audValue, 2)}</td>
                  <td>{r.costLocal == null ? <span className="warn">{t("common.pending")}</span> : <Delta amount={r.gainAud} rate={r.gainRate} />}</td>
                  <td>{current ? (
                    <span title={quoteDetails(r.marketQuote, t, intlLocale, sourceLabel)}>
                      {r.price == null ? "—" : r.localCurrency + " " + price(r.price)}
                      <small>{quoteStatus(r.marketQuote, t, intlLocale)}</small>
                    </span>
                  ) : <Delta amount={r.today?.change} />}</td>
                  <td><Delta rate={quote?.change} />{quote && <small title={current ? t("holdings.brisbaneTime") : undefined}>{closeTimeLabel(quote.closedAt, quote.date, intlLocale)}</small>}</td>
                  <td className="hide-n">{r.realised ? <Delta amount={r.realised} /> : "—"}</td>
                  <td className="hide-n">{r.dividends ? aud(r.dividends, 2) : "—"}</td>
                </tr>
              );
            })}
            <tr data-row={cashRowId(account)}
              className={"holdings-cash click" + (selectedId === cashRowId(account) ? " sel" : "")}
              onClick={() => selectCash(account)}>
              <td><button type="button" className="ticker" aria-label={t("holdings.cashAccountAria", { account: account.name })}>{t("holdings.cashLabel")}</button></td>
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
  const { t, typeLabel } = useI18n();
  if (error) return <p className="cap warn" role="status">{error}</p>;
  if (events == null) return <p className="cap" role="status">{t("holdings.historyLoading")}</p>;
  if (!events.length) return <p className="cap">{t("holdings.historyEmpty")}</p>;
  return (
    <>
      {events.length === historyLimit && <p className="cap">{t("holdings.recentCount", { limit: historyLimit })}</p>}
      <div className="holdings-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{t("holdings.col.date")}</th>
              <th scope="col">{t("holdings.col.type")}</th>
              <th scope="col">{t("holdings.col.qty")}</th>
              <th scope="col">{t("holdings.col.amount")}</th>
            </tr>
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
                    {typeLabel(e.activityType)}
                    {accounts.length > 1 && <small title={name}>{name}</small>}
                  </td>
                  <td>{e.quantity == null ? "—" : num(e.quantity)}</td>
                  <td>
                    {amount == null ? "—" : e.currency + " " + fmt(amount, 2)}
                    {Boolean(Number(e.fee)) && <small>{t("holdings.feeInline", { amount: fmt(e.fee, 2) })}</small>}
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
  const { t, intlLocale, kindLabel, sourceLabel } = useI18n();
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
          {security.type && <span className="tag">{kindLabel(security.type)}</span>}
          {security.mic && <span className="tag">{security.mic}</span>}
          {currency && <span className="tag">{currency}</span>}
          {!row && <span className="tag">{events?.some((e) => e.activityType === "SELL") ? t("holdings.soldOut") : t("holdings.noCurrentPosition")}</span>}
        </div>
        {group && (
          <div className="dl">
            <div><span className="cap">{t("holdings.col.value")}</span><b>{aud(group.value, 2)}</b></div>
            <div>
              <span className="cap">{t("holdings.unrealised")}</span>
              <b>{missingCost ? <span className="warn">{t("common.pending")}</span> : <Delta amount={group.gain} />}</b>
              {gainRate != null && <span className="cap">{t("holdings.detail.returnRate", { rate: signedPct(gainRate) })}</span>}
            </div>
            <div><span className="cap">{t("holdings.detail.costWithFee")}</span><b>{missingCost ? t("common.pending") : aud(group.cost, 2)}</b></div>
            <div>
              {showQuote ? (
                <>
                  <span className="cap">
                    {d.currentMarket ? t("holdings.col.vsPrevClose") : t("holdings.detail.quoteChange")}
                    {quote && " · " + (d.currentMarket ? t("holdings.brisbanePrefix") : "") + closeTimeLabel(quote.closedAt, quote.date, intlLocale)}
                  </span>
                  {quote ? <b>{d.currentMarket ? <><Delta rate={quote.change} /> · {currency} {fmt(quote.amount, 2)}</> :
                    <Delta amount={quote.amount} rate={quote.change} />}</b> : <b>{t("holdings.detail.unverifiedChange")}</b>}
                </>
              ) : (
                <>
                  <span className="cap">{t("holdings.col.closeContrib")}{closeDate && " · " + closeDate}</span><b><Delta amount={daily?.change} /></b>
                  {daily?.priceChange && (
                    <span className="cap">{t("holdings.detail.quotePctDay", { date: daily.priceChange.date, pct: signedPct(daily.priceChange.change), currency })}</span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <section>
          <h3>{group ? t("holdings.detail.priceAndCost") : t("holdings.detail.cumulativeIncome")}</h3>
          <table>
            <tbody>
              <tr><th scope="row">{t("holdings.detail.totalShares")}</th><td><b>{num(group?.quantity ?? 0)}</b></td></tr>
              {quantities.map((a) => <tr key={a.id}><th scope="row">{a.name}</th><td>{num(a.quantity)}</td></tr>)}
              {row && (
                <>
                  <tr><th scope="row">{t("holdings.detail.avgBuyPrice")}</th><td>{missingCost ? t("common.pending") : withinCurrency(average)}</td></tr>
                  <tr>
                    <th scope="row">{t("holdings.col.price")}</th>
                    <td title={[sourceLabel(row.quoteSource), row.priceUpdatedAt].filter(Boolean).join(" · ")}>{withinCurrency(row.price)}</td>
                  </tr>
                  {d.currentMarket && <tr><th scope="row">{t("holdings.detail.quoteStatus")}</th><td>{quoteDetails(row.marketQuote, t, intlLocale, sourceLabel)}</td></tr>}
                  {row.fx && currency !== "AUD" && (
                    <tr><th scope="row">{t("holdings.detail.fxRate")}</th><td title={[sourceLabel(row.fxSource), row.fxDate].filter(Boolean).join(" · ")}>1 {currency} = {num(row.fx)} AUD</td></tr>
                  )}
                </>
              )}
              {showQuote && daily?.change != null && (
                <tr><th scope="row">{t("holdings.col.closeContrib")}{closeDate && " · " + closeDate}</th><td><Delta amount={daily.change} /></td></tr>
              )}
              <tr><th scope="row">{t("holdings.realised")}</th><td><Delta amount={security.realised} /></td></tr>
              <tr><th scope="row">{t("holdings.dividends")}</th><td>{aud(security.dividends, 2)}</td></tr>
            </tbody>
          </table>
          {row?.costReceipt && (
            <p className="cap">
              {t("holdings.detail.costReceipt", {
                day: row.costReceipt.day,
                reference: row.costReceipt.reference,
                historical: row.costReceipt.historicalAud != null
                  ? t("holdings.detail.costHistoricalAud", { amount: aud(row.costReceipt.historicalAud, 2) })
                  : "",
              })}
            </p>
          )}
          {row?.evidence && (
            <p className="cap">
              {t("holdings.detail.evidenceQty", {
                day: row.evidence.day,
                ref: row.evidence.quantityReference,
                qty: num(row.evidence.quantity),
                ledgerQty: num(row.evidence.ledgerQuantity),
              })}
            </p>
          )}
        </section>
        <section>
          <h3>{t("holdings.detail.relatedActivity")}</h3>
          <DetailHistory events={events} error={error} accounts={d.byAccount} />
        </section>
        {row && (
          <section>
            <h3>{t("holdings.detail.repairSection")}</h3>
            <div className="row m0 holdings-repairs">
              <button className="btn sm" type="button" onClick={() => openRepair({ row, action: "cost" })}>{t("editor.title.cost")}</button>
              <button className="btn sm" type="button" onClick={() => openRepair({ row, action: "price" })}>{t("editor.title.price")}</button>
              {currency !== "AUD" && <button className="btn sm" type="button" onClick={() => openRepair({ row, action: "fx" })}>{t("editor.title.fx")}</button>}
              <button className="btn sm" type="button" onClick={() => openRepair({ row, action: "type" })}>{t("editor.title.type")}</button>
            </div>
          </section>
        )}
      </div>
    </Detail>
  );
}

export function Holdings({ d, initial = {}, run }) {
  const { t } = useI18n();
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
            placeholder={t("holdings.searchPlaceholder")}
            aria-label={t("holdings.searchAria")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="seg" role="group" aria-label={t("holdings.categoryAria")}>
            {categoryIds.map((id) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "on" : ""}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {t(`holdings.filter.${id}`)}
              </button>
            ))}
          </span>
          <span className="cap" role="status">
            {filtered
              ? t("holdings.showingCount", { shown: rows.length, total: securities.length })
              : t("holdings.totalCount", { total: securities.length })}
          </span>
          <span className="sp" />
          <button className="btn" type="button" onClick={() => setRepair({ action: "position" })}>{t("holdings.addHolding")}</button>
        </div>
        <HoldingsTotals {...{ d, rows, filtered }} />
        {!rows.length && <p className="card cap">{t("holdings.noMatch")}</p>}
        <div className="col">
          {rowsByAccount.map(({ account, rows }) => (
            <AccountCard key={account.id} current={Boolean(d.currentMarket)}
              {...{ account, rows, filtered, sort, setSort, selectedId, arrival, select, selectCash }} />
          ))}
        </div>
      </div>
      {aspect === "21:9" && (
        <div ref={setDock} className="holdings-inspector">
          {!cash && !security && (
            <section className="card">
              <h2>{t("holdings.inspectorPlaceholderTitle")}</h2>
              <p className="cap">{t("holdings.inspectorPlaceholderBody")}</p>
            </section>
          )}
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
  const { t } = useI18n();
  const rows = account.rows.filter((row) => row.type === "cash");
  return (
    <Detail title={t("holdings.cashModalTitle", { account: account.name })} onClose={onClose} wide dock={dock}>
      <div className="holdings-detail">
        <p className="cap">{t("holdings.cashValueHeader", { value: aud(account.valuation.cash, 2) })}</p>
        {rows.length ? (
          <table>
            <thead>
              <tr>
                <th>{t("holdings.col.currency")}</th>
                <th>{t("holdings.col.nativeBalance")}</th>
                <th>{t("holdings.col.audValue")}</th>
              </tr>
            </thead>
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
        ) : <p className="cap">{t("holdings.noCashBalance")}</p>}
        {account.cashUnverified && <p className="warn">{t("holdings.cashUnverified")}</p>}
      </div>
    </Detail>
  );
}
