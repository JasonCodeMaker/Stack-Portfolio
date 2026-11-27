import React, { useEffect, useState, useRef } from "react";
import { FileUp, CloudDownload, FileText } from "lucide-react";
import { HoldingEditor, SecurityFields, listingLabel, marketNames } from "./HoldingEditor";
import { BrokerResult } from "./ImportPreview";
import { CustomCsvImport } from "./CustomCsvImport";
import { CustomManualEntry } from "./CustomManualEntry";
import { Detail, Grid, useRowKeys, useShell } from "./Shell";
import { checkLayout, quantityGaps, syncLayout } from "./importsLayout.js";
import { api, num, fmt, types, Empty, Modal } from "./common";
import { tMain, useI18n } from "./i18n.jsx";
import "./imports.css";

const blank = {
  type: "DEPOSIT",
  currency: "AUD",
  amount: "",
  date: "",
  reference: "",
  note: "",
  symbol: "",
  quantity: "",
  price: "",
  mic: "",
  fee: "0",
  kind: "EQUITY",
  group: "",
};
const tabIds = ["file", "check", "history", "opening"];
const brokerIds = ["both", "ibkr", "webull"];
const PAGE = 100;

function Seg({ items, value, onChange }) {
  return (
    <span className="seg">
      {items.map(([id, label]) => (
        <button
          type="button"
          key={id}
          aria-pressed={value === id}
          className={value === id ? "on" : ""}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
function F({ label, children }) {
  return (
    <label className="f">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Panel({ title, action, children, className = "" }) {
  return (
    <section className={"card " + className} aria-label={title}>
      <div className="row">
        <h2>{title}</h2>
        <span className="sp" />
        {action}
      </div>
      {children}
    </section>
  );
}
function AccountOptions({ d, value, set, className, brokerOnly = false }) {
  const { t } = useI18n();
  return (
    <select className={className} aria-label={t("app.accountSelectAria")} value={value || ""} onChange={(e) => set(e.target.value)}>
      {!value && <option value="">{t("app.selectAccount")}</option>}
      {d.accounts
        .filter((a) => a.active && (!brokerOnly || !a.custom))
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </select>
  );
}

function StatementLines({ cash, setCash, positions, setPositions, listings = [], opening = false }) {
  const { t, marketLabel } = useI18n();
  const change = (rows, set, i, patch) => set(rows.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  const remove = (rows, set, i) => (
    <button type="button" className="btn" onClick={() => set(rows.filter((_, n) => n !== i))}>
      {t("app.remove")}
    </button>
  );
  return (
    <>
      <div className="sub">{t("imports.cashSection")}</div>
      {cash.map((v, i) => (
        <div className="line" key={i}>
          <input
            aria-label={t("imports.cashCcyAria", { n: i + 1 })}
            placeholder={t("imports.cashCcyPlaceholder")}
            maxLength={3}
            value={v.currency}
            onChange={(e) => change(cash, setCash, i, { currency: e.target.value.toUpperCase() })}
          />
          <input
            aria-label={t("imports.cashBalAria", { n: i + 1 })}
            placeholder={t("imports.cashBalPlaceholder")}
            type="number"
            step="any"
            value={v.value}
            onChange={(e) => change(cash, setCash, i, { value: e.target.value })}
          />
          {remove(cash, setCash, i)}
        </div>
      ))}
      <button type="button" className="lnk cap" onClick={() => setCash([...cash, { currency: "", value: "" }])}>
        {t("imports.addCurrency")}
      </button>
      <div className="sub">{t("imports.securitiesSection")}</div>
      {positions.map((v, i) =>
        opening ? (
          <div className="line full" key={i}>
            <F label={t("editor.symbol")}>
              <input
                value={v.symbol}
                onChange={(e) =>
                  change(positions, setPositions, i, { symbol: e.target.value.toUpperCase(), assetId: "", mic: "" })
                }
              />
            </F>
            <F label={t("imports.qtyPlaceholder")}>
              <input
                type="number"
                step="any"
                value={v.quantity}
                onChange={(e) => change(positions, setPositions, i, { quantity: e.target.value })}
              />
            </F>
            {listings.some((a) => a.symbol === v.symbol) && (
              <F label={t("imports.existingListing")}>
                <select
                  aria-label={t("imports.existingListing")}
                  value={v.assetId || ""}
                  onChange={(e) => {
                    const match = listings.find((a) => a.id === e.target.value);
                    change(
                      positions,
                      setPositions,
                      i,
                      match
                        ? { assetId: match.id, mic: match.mic, currency: match.currency, kind: match.kind }
                        : { assetId: "", mic: "" },
                    );
                  }}
                >
                  <option value="">{t("imports.manualMarketCurrency")}</option>
                  {listings
                    .filter((a) => a.symbol === v.symbol)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {listingLabel(a, marketLabel)}
                      </option>
                    ))}
                </select>
              </F>
            )}
            <F label={t("editor.tradeCurrency")}>
              <input
                readOnly={!!v.assetId}
                value={v.currency || ""}
                maxLength={3}
                onChange={(e) => change(positions, setPositions, i, { currency: e.target.value.toUpperCase() })}
              />
            </F>
            <F label={t("editor.exchangeMarket")}>
              <input
                readOnly={!!v.assetId}
                list="statement-markets"
                value={v.mic || ""}
                onChange={(e) => change(positions, setPositions, i, { mic: e.target.value.toUpperCase() })}
              />
            </F>
            <F label={t("imports.dayPriceOpt")}>
              <input
                type="number"
                step="any"
                value={v.price || ""}
                onChange={(e) => change(positions, setPositions, i, { price: e.target.value })}
              />
            </F>
            <F label={t("imports.categoryLabel")}>
              <select
                value={v.kind || "EQUITY"}
                onChange={(e) => change(positions, setPositions, i, { kind: e.target.value })}
              >
                <option value="EQUITY">{t("editor.type.EQUITY")}</option>
                <option value="ETF">{t("editor.type.ETF")}</option>
              </select>
            </F>
            {remove(positions, setPositions, i)}
          </div>
        ) : (
          <div className="line" key={i}>
            <input
              aria-label={t("imports.tickerAria", { n: i + 1 })}
              placeholder={t("imports.tickerPlaceholder")}
              value={v.symbol}
              onChange={(e) =>
                change(positions, setPositions, i, { symbol: e.target.value.toUpperCase(), assetId: "", mic: "" })
              }
            />
            <input
              aria-label={t("imports.qtyAria", { n: i + 1 })}
              placeholder={t("imports.qtyPlaceholder")}
              type="number"
              step="any"
              value={v.quantity}
              onChange={(e) => change(positions, setPositions, i, { quantity: e.target.value })}
            />
            {remove(positions, setPositions, i)}
          </div>
        ),
      )}
      <button
        type="button"
        className="lnk cap"
        onClick={() => setPositions([...positions, { symbol: "", quantity: "", currency: opening ? "AUD" : "" }])}
      >
        {t("imports.addSecurity")}
      </button>
      {opening && (
        <datalist id="statement-markets">
          {Object.keys(marketNames).map((mic) => (
            <option key={mic} value={mic}>
              {marketLabel(mic)}
            </option>
          ))}
        </datalist>
      )}
    </>
  );
}
function cashAmounts(entries) {
  const amounts = {};
  for (const v of entries) {
    if (v.value === "" && !v.currency) continue;
    if (v.value === "" || !/^[A-Z]{3}$/.test(v.currency) || v.currency in amounts)
      throw Error(tMain("imports.cashDuplicateLineError"));
    amounts[v.currency] = v.value;
  }
  return amounts;
}
function ListingChoices({ choices, resolve }) {
  const { t, marketLabel } = useI18n();
  if (!choices?.length) return null;
  return (
    <div className="fg">
      {choices.map((c) => (
        <F key={c.record + c.symbol} label={t("imports.multiListingChoice", { symbol: c.symbol })}>
          <select defaultValue="" onChange={(e) => e.target.value && resolve(c, e.target.value)}>
            <option value="">{t("editor.selectListing")}</option>
            {c.candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {listingLabel(a, marketLabel)}
              </option>
            ))}
          </select>
        </F>
      ))}
    </div>
  );
}
export function Imports({ d, mode, run, initial = {}, onPage }) {
  const { t, formatDateTime, typeLabel, sourceLabel } = useI18n();
  const { cols } = useShell();
  const [tab, setTab] = useState(initial.tab || "file"),
    [broker, setBroker] = useState(initial.broker || "both");
  const defaultAccount =
    initial.account ||
    (initial.broker &&
      d.accounts.find((a) => a.active && a.name.toLowerCase().includes(initial.broker))?.id) ||
    d.selected[0] ||
    "";
  const [account, setAccount] = useState(defaultAccount),
    [reports, setReports] = useState({});
  const started = useRef(false);
  const requests = useRef({});
  const [ledger, setLedger] = useState([]),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState(null);
  const [connectingFunds, setConnectingFunds] = useState(false);
  const [form, setForm] = useState({ ...blank, date: d.date }),
    [date, setDate] = useState(d.date),
    [cash, setCash] = useState([{ currency: "AUD", value: "" }]),
    [pos, setPos] = useState([]),
    [noSecurities, setNoSecurities] = useState(false),
    [compare, setCompare] = useState(null),
    [flow, setFlow] = useState(false);
  const [openCash, setOpenCash] = useState([]),
    [openPos, setOpenPos] = useState([]);
  const [mapping, setMapping] = useState(() => initial.account && ["ibkr","webull"].includes(initial.broker)
    ? {...d.brokerAccounts,[initial.broker]:initial.account} : d.brokerAccounts);
  const [nav, setNav] = useState("");
  const [amend, setAmend] = useState(null),
    [amendForm, setAmendForm] = useState({}),
    [revisions, setRevisions] = useState([]),
    [voided, setVoided] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [affectedAccounts, setAffectedAccounts] = useState(null);
  const [manualType, setManualType] = useState("DEPOSIT");
  const destination = d.accounts.find((a) => a.id === account);
  const custom = Boolean(destination?.custom);
  const hasCustom = d.accounts.some((a) => a.custom && a.active);
  const deletesGroup = Boolean(deleteTarget?.group && deleteTarget.activityType.startsWith("TRANSFER_"));
  const demo = mode === "demo",
    webullSample = demo && account === "demo-webull";
  function selectAccount(next, keepImport = false) {
    if (next === account) return;
    setAccount(next);
    setLedger([]);
    setOpenCash([]);
    setOpenPos([]);
    if (!keepImport) {
      setReports({});
    }
    setCompare(null);
    setFlow(false);
    setCash([{ currency: "AUD", value: "" }]);
    setPos([]);
    setNoSecurities(false);
    setNav("");
    setOffset(0);
    setAmend(null);
    setDeleteTarget(null);
  }
  useEffect(() => {
    let a = true;
    if (tab === "history" && account)
      api
        .history({ account, limit: PAGE, offset, text: search })
        .then((v) => {
          if (a) setLedger(v);
        })
        .catch((e) => run(() => Promise.reject(e)));
    return () => {
      a = false;
    };
  }, [tab, account, offset, search, d]);
  function chooseTab(next) {
    setTab(next);
    setAmend(null);
    setDeleteTarget(null);
  }
  function chooseBroker(b) {
    requests.current = {};
    setBroker(b);
    if (b !== "both") selectAccount(mapping[b] || "");
    setReports({});
  }
  function updateReport(b, result) {
    setReports((prev) => ({ ...prev, [b]: result }));
  }
  async function prepare(source, which = broker, id = which === "both" ? "" : mapping[which]) {
    if (which === "both") {
      if (mapping.ibkr && mapping.ibkr === mapping.webull)
        return run(() => {
          throw Error(t("imports.distinctAccountsError"));
        }, false);
      return Promise.all(["ibkr", "webull"].map((b) => prepare(source, b, mapping[b])));
    }
    const request = Symbol();
    requests.current[which] = request;
    if (source !== "file") updateReport(which, { broker: which, loading: true });
    await run(async () => {
      try {
        if (!id) throw Error(t("imports.selectTargetError"));
        const v = await api.preview({ source, broker: which, account: id });
        if (v && requests.current[which] === request) updateReport(which, { ...v, sourceKind: source });
      } catch (e) {
        if (requests.current[which] === request)
          updateReport(which, {
            broker: which,
            account: id,
            sourceKind: source,
            error: String(e.message).replace(/^Error invoking remote method '.*?': (?:Error: )?/, ""),
          });
      }
    }, false);
  }
  useEffect(() => {
    if (!initial.sync || started.current) return;
    started.current = true;
    prepare(demo ? "sample" : "live", initial.broker);
  }, []);
  async function commit(r) {
    await run(async () => {
      const v = await api.commit({ token: r.token });
      updateReport(r.broker, { ...v, done: true });
    }, t("imports.savedBrokerMsg"));
  }
  function useStatement(v) {
    setDate(v.date);
    setCash(Object.entries(v.cash || {}).map(([currency, value]) => ({ currency, value })));
    setNoSecurities(Array.isArray(v.positions) && v.positions.length === 0);
    setPos((v.positions || []).map((p) => ({ ...p })));
    setNav(v.base === "AUD" && v.nav != null ? String(v.nav) : "");
    setCompare(null);
    setFlow(false);
    chooseTab("check");
  }
  function compareArgs() {
    return {
      account,
      date,
      cash: cashAmounts(cash),
      positions: pos.length || noSecurities ? pos : undefined,
      nav: nav.trim() || null,
      flowsReviewed: flow,
      source: webullSample ? t("imports.sampleStatementSource") : t("imports.brokerStatementSource"),
    };
  }
  function openManual(sample = false, type = "DEPOSIT") {
    if (custom) {
      setManualType(type);
      setModal("manual");
      return;
    }
    setForm(
      sample
        ? {
            ...blank,
            date: "2026-10-28",
            type: "DEPOSIT",
            currency: "AUD",
            amount: "1000",
            reference: "WB-OCT-DEP-01",
            note: t("imports.sampleDepositNote"),
          }
        : { ...blank, date: d.date, type },
    );
    setModal("manual");
  }
  const accountName = destination?.name;
  const activityLabel = (event) => typeLabel(event.metadata?.customRecord?.type || event.activityType);
  const accountReports = d.quantityReports
    .filter((r) => r.account === account)
    .sort((a, b) => b.day.localeCompare(a.day));
  const change = (k, v) => setForm({ ...form, [k]: v });
  const changeAmend = (k, v) => setAmendForm({ ...amendForm, [k]: v });
  async function edit(v) {
    setAmend(v);
    setAmendForm({
      date: String(v.date).slice(0, 10),
      currency: v.currency,
      amount: String(v.amount ?? ""),
      quantity: String(v.quantity ?? ""),
      price: String(v.unitPrice ?? ""),
      fee: String(v.fee ?? 0),
      toCurrency: v.metadata?.customRecord?.to_currency || "",
      toAmount: v.metadata?.customRecord?.to_amount || "",
      note: v.comment || "",
      reason: "",
    });
    setRevisions([]);
    setRevisions(await api.corrections({ id: v.id }));
  }
  const batches = d.batches.filter((b) =>
    broker === "both" ? Object.values(mapping).includes(b.account) : b.account === account,
  );
  // A booked record replaced by its broker original stays in the book but out of the default list.
  const superseded = (v) => v.metadata?.supersededBy || String(v.status).toUpperCase() === "VOID";
  const entries = ledger.filter((v) => voided || !superseded(v));
  const sources = { MANUAL: t("source.manual"), CUSTOM_CSV: t("custom.csv"), WEBULL: "Webull", IBKR: "IBKR" };
  const rowKeys = useRowKeys(
    entries.map((v) => v.id),
    amend?.id,
    (id) => {
      const v = entries.find((e) => e.id === id);
      if (v && !superseded(v)) run(() => edit(v), false);
    },
  );
  if (!d.accounts.some((a) => a.active))
    return (
      <div className="imp imp-page">
        <Panel title={t("imports.needAccountTitle")} className="cap880">
          <Empty>{t("imports.needAccountEmpty")}</Empty>
          <button className="btn pri" onClick={() => onPage("settings", { tab: "book" })}>
            {t("imports.createAccountBtn")}
          </button>
        </Panel>
      </div>
    );

  const brokers = broker === "both" ? ["ibkr", "webull"] : [broker];
  const update = (
    <Panel
      title={t("imports.updatePanelTitle")}
      action={<Seg items={brokerIds.map((id) => [id, t(`imports.broker.${id}`)])} value={broker} onChange={chooseBroker} />}
    >
      <div className="opts">
        <button type="button" onClick={() => prepare(demo ? "sample" : "live")}>
          <CloudDownload size={22} strokeWidth={1.8} />
          <b>{t("imports.opt.sync")}</b>
          <small>{t(demo ? "imports.opt.syncDemo" : "imports.opt.syncLive")}</small>
        </button>
        <button type="button" onClick={() => setModal("file")}>
          <FileUp size={22} strokeWidth={1.8} />
          <b>{t("imports.opt.file")}</b>
          <small>{t("imports.opt.fileSub")}</small>
        </button>
        <button type="button" onClick={() => setModal("entry")}>
          <FileText size={22} strokeWidth={1.8} />
          <b>{t("imports.opt.manual")}</b>
          <small>{t("imports.opt.manualSub")}</small>
        </button>
      </div>
      <details
        className="account-mapping"
        open={Object.keys(mapping).some((b) => brokers.includes(b) && !mapping[b]) || undefined}
      >
        <summary>
          {t("imports.mappingSummary", {
            names: brokers.map((b) => d.accounts.find((a) => a.id === mapping[b])?.name || t("imports.pendingSelect")).join(t("common.comma")),
          })}
        </summary>
        <div className="fg">
          {brokers.map((b) => (
            <F key={b} label={t("imports.targetAccountLabel", { broker: b.toUpperCase() })}>
              <select
                value={mapping[b]}
                onChange={(e) => {
                  delete requests.current[b];
                  setMapping({ ...mapping, [b]: e.target.value });
                  if (!reports[b]?.error) updateReport(b, null);
                  if (broker === b) selectAccount(e.target.value, true);
                }}
              >
                <option value="">{t("app.selectAccount")}</option>
                {d.accounts
                  .filter((a) => a.active && a.mode === "TRANSACTIONS" && !a.custom)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </F>
          ))}
        </div>
      </details>
    </Panel>
  );
  const previews = ["ibkr", "webull"].filter((b) => reports[b]);
  const brokerCard = (r) => (
    <BrokerResult
      report={r}
      accounts={d.accounts}
      onConfirm={() => commit(r)}
      onClose={() => updateReport(r.broker, null)}
      onRetry={() => prepare(r.sourceKind, r.broker)}
      onConnect={demo ? null : () => onPage("settings", { tab: "connections", broker: r.broker })}
      onReconcile={(result) => {
        selectAccount(result.account, true);
        useStatement(result.statement || { date: d.date });
      }}
    >
      {!r.done && r.webullFundsStatus && r.webullFundsStatus !== "loaded" && (
        <div className="notice" role="status">
          <span>{t({
            login: "imports.webullFundsLogin",
            verification: "imports.webullFundsVerification",
            unavailable: "imports.webullFundsError",
          }[r.webullFundsStatus])}</span>
          <button
            type="button"
            className="btn sm"
            disabled={connectingFunds}
            onClick={async () => {
              const activeRequest = requests.current.webull;
              setConnectingFunds(true);
              try {
                const status = await run(() => api.connectWebullFunds({ account: r.account }), false);
                if (requests.current.webull !== activeRequest) return;
                if (status === "loaded") await prepare("live", "webull", r.account);
                if (status === "unavailable") updateReport("webull", { ...r, webullFundsStatus: status });
              } finally {
                setConnectingFunds(false);
              }
            }}
          >
            {t("imports.webullFundsConnect")}
          </button>
        </div>
      )}
      <ListingChoices
        choices={r.choices}
        resolve={(c, id) =>
          run(async () => {
            await api.rememberListing({ ...c, assetId: id });
            updateReport(r.broker, { ...(await api.preview({ token: r.token })), sourceKind: r.sourceKind });
          }, false)
        }
      />
    </BrokerResult>
  );
  const batchCard = batches.length > 0 && (
    <Panel title={t("imports.recentBatches")}>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{t("imports.col.source")}</th>
              <th className="l">{t("imports.col.time")}</th>
              <th>{t("imports.col.imported")}</th>
              <th>{t("imports.col.duplicate")}</th>
              <th>{t("imports.col.repaired")}</th>
            </tr>
          </thead>
          <tbody>
            {batches.slice(0, 8).map((b) => (
              <tr key={b.id}>
                <td>{sourceLabel(b.source)}</td>
                <td className="l">{formatDateTime(b.created)}</td>
                <td>{b.data.imported}</td>
                <td>{b.data.duplicate}</td>
                <td>{(b.data.updated || 0) + (b.data.repaired || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );

  const evidence = accountReports.length > 0 && (
    <Panel title={t("imports.evidenceTitle")}>
      {accountReports.map((r) => (
        <div className="ev" key={r.day + r.asset}>
          <b>
            {r.symbol} · {r.day}
          </b>
          <span>
            {t("imports.evidenceDesc", {
              ref: sourceLabel(r.reference),
              qty: num(r.quantity),
              ledgerQty: num(r.ledgerQuantity),
            })}
          </span>
          <b className={Number(r.difference) ? "warn" : "up"}>
            {Number(r.difference)
              ? t("imports.evidenceGap", { diff: num(Math.abs(r.difference)) })
              : t("imports.evidenceMatch")}
          </b>
          <button
            type="button"
            className="lnk"
            onClick={() => {
              setSearch(r.symbol);
              setOffset(0);
              chooseTab("history");
            }}
          >
            {t("imports.viewRelatedActivity")}
          </button>
        </div>
      ))}
    </Panel>
  );
  const statement = (
    <Panel
      title={t("imports.reconcileTitle")}
      action={
        webullSample ? (
          <button type="button" className="btn sm" onClick={() => setModal("statement")}>
            {t("imports.viewSampleStatement")}
          </button>
        ) : null
      }
    >
      <div className="fg">
        <F label={t("imports.statementDate")}>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setCompare(null);
            }}
          />
        </F>
      </div>
      <StatementLines
        cash={cash}
        setCash={(v) => {
          setCash(v);
          setCompare(null);
        }}
        positions={pos}
        setPositions={(v) => {
          setPos(v);
          setCompare(null);
        }}
      />
      {!pos.length && (
        <label className="chk">
          <input
            type="checkbox"
            checked={noSecurities}
            onChange={(e) => {
              setNoSecurities(e.target.checked);
              setCompare(null);
            }}
          />
          {t("imports.zeroHoldings")}
        </label>
      )}
      <div className="fg">
        <F label={t("imports.statementNavOpt")}>
          <input
            type="number"
            step=".01"
            value={nav}
            onChange={(e) => {
              setNav(e.target.value);
              setCompare(null);
            }}
          />
        </F>
      </div>
      <div className="acts">
        <button
          type="button"
          className="btn pri"
          onClick={() => run(async () => setCompare(await api.compare(compareArgs())), false)}
        >
          {t("imports.compareBtn")}
        </button>
        <button type="button" className="btn" onClick={() => openManual(false)}>
          {t("imports.addOneFlowBtn")}
        </button>
        {!demo && nav.trim() && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              run(() => api.recordAccountValue({ ...compareArgs(), positions: pos }), t("imports.brokerNavSaved"))
            }
          >
            {t("imports.adoptBrokerNavBtn")}
          </button>
        )}
      </div>
      {compare && (
        <>
          <ListingChoices
            choices={compare.choices}
            resolve={(c, id) =>
              run(async () => {
                await api.rememberListing({ ...c, assetId: id });
                setCompare(await api.compare(compareArgs()));
              }, false)
            }
          />
          {!compare.choices.length &&
            quantityGaps(compare.rows, accountName, t).map((line) => (
              <p className="warn result" key={line}>
                {line}
              </p>
            ))}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{t("imports.col.item")}</th>
                  <th>{t("imports.col.statement")}</th>
                  <th>{t("imports.col.local")}</th>
                  <th>{t("imports.col.diff")}</th>
                  <th>{t("imports.col.ledgerLink")}</th>
                </tr>
              </thead>
              <tbody>
                {compare.rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{num(r.expected)}</td>
                    <td>{num(r.actual)}</td>
                    <td className={r.delta == null || Number(r.delta) !== 0 ? "warn" : "up"}>
                      {r.delta == null ? t("common.pending") : num(r.delta).replace(/^-/, "−")}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="lnk"
                        onClick={() => {
                          setSearch(r.symbol ? r.symbol : "");
                          chooseTab("history");
                        }}
                      >
                        {t("imports.viewLedger")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={(compare.ok ? "up" : "warn") + " result"}>
            {compare.ok ? t("imports.matchOk") : t("imports.matchMismatch")} {compare.warnings.join(" ")}
          </p>
          {compare.ok && (
            <>
              <label className="chk">
                <input type="checkbox" checked={flow} onChange={(e) => setFlow(e.target.checked)} />
                {t("imports.flowsChecked")}
              </label>
              <button
                type="button"
                className="btn pri"
                disabled={!flow}
                onClick={() =>
                  run(async () => {
                    await api.confirmStatement(compareArgs());
                    setCompare(null);
                    setFlow(false);
                    onPage("overview");
                  }, t("imports.reconcileSaved"))
                }
              >
                {t("imports.completeReconcile")}
              </button>
            </>
          )}
        </>
      )}
    </Panel>
  );

  const history = (
    <Panel
      title={t("imports.historyTitle")}
      action={
        <button type="button" className="btn pri" disabled={!account} onClick={() => openManual(false)}>
          {t("imports.addEntryBtn")}
        </button>
      }
    >
      <div className="row">
        <input
          className="btn history-search"
          aria-label={t("imports.filterLedgerAria")}
          placeholder={t("imports.filterLedgerPlaceholder")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <label className="chk">
          <input type="checkbox" checked={voided} onChange={(e) => setVoided(e.target.checked)} />
          {t("imports.showVoided")}
        </label>
      </div>
      {entries.length ? (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{t("imports.col.date")}</th>
                <th className="l">{t("imports.col.type")}</th>
                <th className="l">{t("imports.col.security")}</th>
                <th>{t("imports.col.qtyPrice")}</th>
                <th>{t("imports.col.amount")}</th>
                <th className="hide-n">{t("imports.col.fee")}</th>
                <th className="l hide-n">{t("imports.col.sourceRef")}</th>
                <th />
              </tr>
            </thead>
            <tbody onKeyDown={rowKeys}>
              {entries.map((v) => {
                const traded = Number(v.quantity) && v.unitPrice != null;
                const amount = v.amount ?? (traded ? Number(v.quantity) * Number(v.unitPrice) : null);
                const execution = v.metadata?.ibkrExecution,
                  fx = v.metadata?.fx;
                return (
                  <tr
                    key={v.id}
                    data-row={v.id}
                    className={"click" + (amend?.id === v.id ? " sel" : "")}
                    onClick={superseded(v) ? undefined : () => run(() => edit(v), false)}
                  >
                    <td>{String(v.date).slice(0, 10)}</td>
                    <td className="l">
                      {v.metadata?.fx && !v.metadata?.customRecord
                        ? (v.activityType === "TRANSFER_OUT" ? t("imports.fxSell") : t("imports.fxBuy"))
                        : activityLabel(v)}
                      {superseded(v) && <small>{t(v.metadata?.deletedByUser ? "imports.deletedTag" : "imports.voidedTag")}</small>}
                      {fx?.sourceCurrency && fx.destinationCurrency && (
                        <small>
                          {execution?.autoFx && t("imports.autoFxTag")}
                          {fx.sourceCurrency} → {fx.destinationCurrency}
                        </small>
                      )}
                    </td>
                    <td className="l">{v.assetSymbol || "—"}</td>
                    <td>
                      {Number(v.quantity)
                        ? num(v.quantity) + (v.unitPrice != null ? " × " + num(v.unitPrice) : "")
                        : fx?.sourceCurrency && Number(fx.impliedRate) > 0
                          ? "1 " + fx.sourceCurrency + " = " + num(fx.impliedRate) + " " + fx.destinationCurrency
                          : "—"}
                    </td>
                    <td>{amount == null ? "—" : v.currency + " " + fmt(amount, 2)}
                      {fx && v.metadata?.customRecord && <small>→ {fx.destinationCurrency} {fmt(fx.destinationAmount, 2)}</small>}
                    </td>
                    <td className="hide-n">{Number(v.fee) ? v.currency + " " + num(v.fee) : "—"}</td>
                    <td className="l hide-n">
                      {sources[v.sourceSystem] || sourceLabel(v.sourceSystem || "旧账本")}
                      <small>{v.sourceRecordId || v.comment}</small>
                    </td>
                    <td className="history-actions">
                      {!superseded(v) && <>
                        <button type="button" className="lnk">{t("imports.amendBtn")}</button>
                        <button type="button" className="lnk" onClick={(event) => {
                          event.stopPropagation();
                          run(async () => {
                            setAffectedAccounts(v.group ? await api.activityAccounts({ account: v.accountId, event: v.id }) : null);
                            setDeleteTarget(v);
                          }, false);
                        }}>{t("imports.deleteBtn")}</button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{ledger.length ? t("imports.onlyVoidedOnPage") : t("imports.noEntries")}</Empty>
      )}
      <div className="acts">
        <button type="button" className="btn" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          {t("imports.prevPage")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={ledger.length < PAGE}
          onClick={() => setOffset(offset + PAGE)}
        >
          {t("imports.nextPage")}
        </button>
        {ledger.length > 0 && (
          <span className="cap">
            {t("imports.pageRange", { from: offset + 1, to: offset + ledger.length })}
          </span>
        )}
      </div>
    </Panel>
  );

  const opening = (
    <Panel title={t("imports.openingTitle")}>
      <p className="muted">{t("imports.openingDesc")}</p>
      <div className="fg">
        <F label={t("imports.openingDate")}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </F>
      </div>
      <StatementLines
        cash={openCash}
        setCash={setOpenCash}
        positions={openPos}
        setPositions={setOpenPos}
        listings={d.listings}
        opening
      />
      <div className="acts">
        <button
          type="button"
          className="btn pri"
          onClick={() =>
            run(async () => {
              await api.opening({ account, date, cash: cashAmounts(openCash), positions: openPos });
              chooseTab("history");
            }, t("imports.openingSaved"))
          }
        >
          {t("imports.saveOpening")}
        </button>
      </div>
    </Panel>
  );

  return (
    <div className="imp imp-page">
      <div className="row m0">
        <Seg items={tabIds.map((id) => [id, t(custom && id === "opening" ? "custom.opening" : `imports.tab.${id}`)])} value={tab} onChange={chooseTab} />
        <span className="sp" />
        {(tab !== "file" || hasCustom) && <AccountOptions className="btn" d={d} value={account} set={selectAccount} />}
      </div>
      {tab === "file" && custom && (
        <CustomCsvImport key={account} account={destination} run={run}
          onManual={() => openManual(false)} onOpening={() => chooseTab("opening")} onHistory={() => chooseTab("history")} />
      )}
      {tab === "file" && !custom && (
        <Grid
          layout={syncLayout(previews, { batches: !!batchCard })}
          panels={{
            update,
            batches: batchCard,
            ...Object.fromEntries(previews.map((b) => [b, brokerCard(reports[b])])),
          }}
        />
      )}
      {tab === "check" && (
        <div className={cols > 1 && evidence ? "cap1760" : "cap880"}>
          <Grid layout={checkLayout(!!evidence)} panels={{ statement, evidence }} />
        </div>
      )}
      {tab === "history" && history}
      {tab === "opening" && <div className="stack cap880">{opening}</div>}

      {tab === "history" && amend && (
        <Detail title={t("imports.amendModalTitle")} onClose={() => setAmend(null)}>
          <div className="imp">
            <div className="dl">
              <div>
                <span className="cap">
                  {String(amend.date).slice(0, 10)} · {activityLabel(amend)}
                </span>
                <b>{amend.assetSymbol || amend.currency}</b>
              </div>
              <div>
                <span className="cap">{t("imports.amend.amount")}</span>
                <b>
                  {amend.amount != null
                    ? amend.currency + " " + fmt(amend.amount, 2)
                    : Number(amend.quantity) && amend.unitPrice != null
                      ? amend.currency + " " + fmt(Number(amend.quantity) * Number(amend.unitPrice), 2)
                      : "—"}
                </b>
              </div>
            </div>
            <div className="cap">
              {t("imports.sourceWord")} {sources[amend.sourceSystem] || sourceLabel(amend.sourceSystem || "旧账本")}
              {amend.sourceRecordId && " · " + amend.sourceRecordId}
            </div>
            <div className="fg w">
              {[
                ["date", t("imports.field.date"), "date"],
                ...(["BUY", "SELL"].includes(amend.activityType)
                  ? [
                      ["quantity", t("imports.amend.qty"), "number"],
                      ["price", t("imports.amend.price"), "number"],
                      ["fee", t("imports.amend.fee"), "number"],
                    ]
                  : amend.assetId && Number(amend.quantity) > 0
                    ? [["quantity", t("imports.amend.qty"), "number"]]
                    : [["amount", t("imports.amend.amount"), "number"]]),
                ...(amend.metadata?.customRecord?.type === "FX_CONVERSION" ? [
                  ["toCurrency", t("custom.toCurrency"), "text"],
                  ["toAmount", t("custom.toAmount"), "number"],
                  ["fee", t("imports.field.fee"), "number"],
                ] : []),
                ["note", t("imports.field.note"), "text"],
                ["reason", t("imports.amend.reason"), "text"],
              ].map(([k, l, kindType]) => (
                <F key={k} label={l}>
                  <input
                    type={kindType}
                    step="any"
                    value={amendForm[k] ?? ""}
                    onChange={(ev) => changeAmend(k, ev.target.value)}
                  />
                </F>
              ))}
            </div>
            {revisions.map((v, i) => (
              <p className="cap" key={i}>
                {v.created.slice(0, 10)} · {v.reason}
              </p>
            ))}
            <div className="acts">
              <button
                type="button"
                className="btn pri"
                onClick={() =>
                  run(async () => {
                    await api.amend({ ...blank, ...amendForm, account, id: amend.id, prior: JSON.stringify(amend) });
                    setAmend(null);
                  }, t("imports.amendSaved"))
                }
              >
                {t("imports.saveAmend")}
              </button>
              <button type="button" className="btn" onClick={() => setAmend(null)}>
                {t("app.cancel")}
              </button>
            </div>
          </div>
        </Detail>
      )}

      {tab === "history" && deleteTarget && (
        <Modal title={t("imports.deleteTitle")} close={() => setDeleteTarget(null)}>
          <p>{t("imports.deleteDescription", {
            date: String(deleteTarget.date).slice(0, 10),
            type: activityLabel(deleteTarget),
          })}</p>
          {deletesGroup && <p>{t("imports.deleteGroup")}</p>}
          {deletesGroup && affectedAccounts && <p>{t("custom.affected", { names: affectedAccounts.names.join(t("common.comma")) })}</p>}
          <div className="acts">
            <button type="button" className="btn" onClick={() => setDeleteTarget(null)}>{t("app.cancel")}</button>
            <button type="button" className="btn pri" onClick={() => run(async () => {
              await api.deleteActivity({
                id: deleteTarget.id,
                account: deleteTarget.accountId,
                prior: JSON.stringify(deleteTarget),
                deleteGroup: deletesGroup,
                groupMembers: affectedAccounts?.members,
              });
              requests.current = {};
              setReports({});
              setDeleteTarget(null);
              setAmend(null);
            }, t("imports.deleteSaved"))}>{t("imports.confirmDelete")}</button>
          </div>
        </Modal>
      )}

      {modal === "file" && (
        <Modal title={t("imports.fileModalTitle")} close={() => setModal(null)}>
          <div className="imp">
            {["ibkr", "webull"].map((b) => (
              <div className="fg" key={b} style={{ alignItems: "end" }}>
                <F label={t("imports.targetAccountLabel", { broker: b.toUpperCase() })}>
                  <AccountOptions d={d} brokerOnly value={mapping[b]} set={(id) => setMapping({ ...mapping, [b]: id })} />
                </F>
                <button
                  type="button"
                  className="btn"
                  style={{ justifySelf: "start" }}
                  disabled={!mapping[b]}
                  onClick={() => {
                    setModal(null);
                    prepare("file", b, mapping[b]);
                  }}
                >
                  {t(b === "ibkr" ? "imports.chooseIbkrXml" : "imports.chooseWebullCsv")}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "entry" && (
        <Modal title={t("imports.manualPickTitle")} close={() => setModal(null)}>
          <div className="imp">
            <div className="fg">
              <F label={t("imports.belongAccount")}>
                <AccountOptions d={d} value={account} set={selectAccount} />
              </F>
            </div>
            <div className="acts">
              <button type="button" className="btn" onClick={() => openManual(false, "BUY")}>
                {t("imports.manualBuySell")}
              </button>
              <button type="button" className="btn" onClick={() => setModal("position")}>
                {t("imports.manualHolding")}
              </button>
              <button type="button" className="btn" onClick={() => openManual()}>
                {t("imports.manualCashFlow")}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "position" && (
        <HoldingEditor d={d} run={run} account={account} action="position" close={() => setModal(null)} />
      )}
      {modal === "statement" && (
        <Modal title={t("imports.sampleModalTitle")} close={() => setModal(null)}>
          <div className="imp">
            <table>
              <tbody>
                {[
                  [t("imports.statementDate"), "2026-10-30"],
                  [t("imports.sampleEndingPositions"), t("imports.sampleEndingPositionsVal")],
                  [t("imports.sampleEndingCash"), "AUD 7,600.00"],
                  [t("imports.sampleDepositDate"), "AUD 1,000.00"],
                  [t("imports.sampleDepositRef"), "WB-OCT-DEP-01"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="acts">
              <button
                type="button"
                className="btn pri"
                onClick={() => {
                  useStatement({
                    date: "2026-10-30",
                    cash: { AUD: 7600 },
                    positions: [
                      { symbol: "A200", quantity: 200 },
                      { symbol: "BHP", quantity: 150 },
                    ],
                  });
                  setModal(null);
                }}
              >
                {t("imports.fillForCompare")}
              </button>
              <button type="button" className="btn" onClick={() => openManual(true)}>
                {t("imports.addSampleDeposit")}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "manual" && custom && (
        <CustomManualEntry d={d} account={destination} type={manualType} run={run}
          close={() => setModal(null)} onSaved={() => {
            setModal(null);
            setCompare(null);
            setOffset(0);
            setSearch("");
            chooseTab("history");
          }} />
      )}
      {modal === "manual" && !custom && (
        <Modal title={t("imports.manualModalTitle")} close={() => setModal(null)}>
          <form
            className="imp"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.manual({ account, ...form });
                setModal(null);
                setCompare(null);
              }, t("imports.entryBooked"));
            }}
          >
            <div className="fg">
              <F label={t("imports.field.type")}>
                <select
                  value={form.type}
                  onChange={(e) =>
                    setForm({ ...form, type: e.target.value, assetId: "", symbol: "", mic: "", linkDividend: false })
                  }
                >
                  {Object.keys(types).map((k) => (
                    <option key={k} value={k}>
                      {typeLabel(k)}
                    </option>
                  ))}
                </select>
              </F>
              {["BUY", "SELL", "DIVIDEND"].includes(form.type) &&
              (form.type !== "DIVIDEND" || form.symbol || form.linkDividend) ? (
                <SecurityFields d={d} form={form} setForm={setForm} />
              ) : (
                form.type === "DIVIDEND" && (
                  <button type="button" className="lnk" onClick={() => change("linkDividend", true)}>
                    {t("imports.linkDividend")}
                  </button>
                )
              )}
              {[
                ["date", t("imports.field.date"), "date"],
                ...(["BUY", "SELL"].includes(form.type) ||
                (form.type === "DIVIDEND" && (form.linkDividend || form.symbol))
                  ? []
                  : [["currency", t("imports.field.currency"), "text"]]),
                ...(["BUY", "SELL"].includes(form.type)
                  ? [
                      ["quantity", t("imports.field.qty"), "number"],
                      ["price", t("imports.field.price"), "number"],
                      ["fee", t("imports.field.fee"), "number"],
                    ]
                  : [["amount", t("imports.field.amount"), "number"]]),
                ...(form.type.startsWith("TRANSFER") ? [["group", t("imports.field.transferGroup"), "text"]] : []),
                ["reference", t("imports.field.reference"), "text"],
                ["note", t("imports.field.note"), "text"],
              ].map(([k, l, kindType]) => (
                <F key={k} label={l}>
                  <input
                    required={!["note", "fee", "mic", "group"].includes(k)}
                    type={kindType}
                    step="any"
                    value={form[k]}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </F>
              ))}
            </div>
            <div className="acts">
              <button className="btn pri" type="submit">
                {t("imports.confirmBookTo", { account: accountName })}
              </button>
              <button type="button" className="btn" onClick={() => setModal(null)}>
                {t("app.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
