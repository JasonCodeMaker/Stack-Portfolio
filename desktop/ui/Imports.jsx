// Imports (D08 Route B+): an account list on the left and a workspace on the right, with 一键更新全部账户 above.
// Sync, file import, manual entry, statement reconciliation and opening balances open inline in the workspace.
import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Building2, ChevronRight, CloudDownload, FileSpreadsheet, FileText, Flag, Layers, PenLine, RefreshCw, Scale, Search, Upload,
} from "lucide-react";
import { HoldingEditor, SecurityFields, listingLabel, marketNames } from "./HoldingEditor";
import { BrokerResult } from "./ImportPreview";
import { CustomCsvImport } from "./CustomCsvImport";
import { CustomManualEntry } from "./CustomManualEntry";
import { Detail, useRowKeys } from "./Shell";
import { quantityGaps } from "./importsLayout.js";
import { accountBroker, accountConnection, accountTitle, brokerNames, lastBatches, syncTargets } from "./accountConnections.js";
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
const PAGE = 100;

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
const errorText = (e) => String(e.message || e).replace(/^Error invoking remote method '.*?': (?:Error: )?/, "");
const ico = { size: 16, strokeWidth: 1.8, "aria-hidden": true };

// One action of the workspace: an icon, a name and what it does.
function Tile({ icon: Icon, title, sub, onClick, disabled = false, active = false }) {
  return (
    <button type="button" className={"tile-btn" + (active ? " on" : "")} disabled={disabled} onClick={onClick}>
      <span className="tile-head"><Icon {...ico} /><span>{title}</span></span>
      <small>{sub}</small>
    </button>
  );
}
// A form or result that opens inside the workspace card, in place of a dialog.
function Drawer({ icon: Icon, title, action, onClose, children }) {
  const { t } = useI18n();
  return (
    <section className="inline-drawer" aria-label={title}>
      <div className="drawer-head">
        <h3>{Icon && <Icon {...ico} />}{title}</h3>
        <span className="sp" />
        {action}
        <button type="button" className="btn sm" onClick={onClose}>{t("imports.drawer.close")}</button>
      </div>
      {children}
    </section>
  );
}

export function Imports({ d, mode, run, initial = {}, onPage }) {
  const { t, formatDateTime, typeLabel, sourceLabel } = useI18n();
  const demo = mode === "demo";
  const active = d.accounts.filter((a) => a.active);
  const mapping = useMemo(
    () => (initial.account && ["ibkr", "webull"].includes(initial.broker)
      ? { ...d.brokerAccounts, [initial.broker]: initial.account }
      : d.brokerAccounts || {}),
    [d.brokerAccounts],
  );
  const initialAccount = active.some((a) => a.id === initial.account)
    ? initial.account
    : ["ibkr", "webull"].includes(initial.broker) ? mapping[initial.broker] || "" : "";
  const [sel, setSel] = useState(initialAccount || "all");
  const [account, setAccount] = useState(
    initialAccount || d.selected.find((id) => active.some((a) => a.id === id)) || active[0]?.id || "",
  );
  const [drawer, setDrawer] = useState({ check: "reconcile", opening: "opening" }[initial.tab] || null);
  const [returnTo, setReturnTo] = useState(null);
  const [conn, setConn] = useState(null);
  const [reports, setReports] = useState({});
  const started = useRef(false);
  const requests = useRef({});
  const historyRef = useRef(null);
  // The ledger of all accounts starts folded; one account's ledger starts open.
  const [historyOpen, setHistoryOpen] = useState(Boolean(initialAccount) || initial.tab === "history");
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
  const selected = sel === "all" ? null : d.accounts.find((a) => a.id === sel);
  const deletesGroup = Boolean(deleteTarget?.group && deleteTarget.activityType.startsWith("TRANSFER_"));
  const webullSample = demo && account === "demo-webull";
  useEffect(() => {
    let live = true;
    api
      .connections()
      .then((c) => {
        if (live) setConn(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [d, mode]);
  // Forms work on one account; switching it clears what was being entered for the previous one.
  function chooseAccount(next) {
    if (next === account) return;
    setAccount(next);
    setOpenCash([]);
    setOpenPos([]);
    setCompare(null);
    setFlow(false);
    setCash([{ currency: "AUD", value: "" }]);
    setPos([]);
    setNoSecurities(false);
    setNav("");
  }
  function selectAccount(next) {
    setSel(next);
    setHistoryOpen(next !== "all");
    setDrawer(null);
    setReturnTo(null);
    setOffset(0);
    setLedger([]);
    setAmend(null);
    setDeleteTarget(null);
    if (next !== "all") chooseAccount(next);
  }
  useEffect(() => {
    // A folded ledger is not read until it is opened.
    if (!historyOpen) return;
    let live = true;
    api
      .history({ account: sel === "all" ? "" : sel, limit: PAGE, offset, text: search })
      .then((v) => {
        if (live) setLedger(v);
      })
      .catch((e) => run(() => Promise.reject(e)));
    return () => {
      live = false;
    };
  }, [sel, offset, search, d, historyOpen]);
  const toggleDrawer = (next) => {
    setReturnTo(null);
    setDrawer(drawer === next ? null : next);
  };
  // Links into the ledger (after saving an entry, from reconciliation) open it before scrolling to it.
  const showHistory = () => {
    setHistoryOpen(true);
    requestAnimationFrame(() => historyRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }));
  };
  function updateReport(id, result) {
    setReports((prev) => {
      const next = { ...prev };
      if (result) next[id] = result;
      else delete next[id];
      return next;
    });
  }
  async function prepare(source, broker, id) {
    if (!id) return;
    const request = Symbol();
    requests.current[id] = request;
    if (source !== "file") updateReport(id, { broker, account: id, loading: true });
    await run(async () => {
      try {
        const v = await api.preview({ source, broker, account: id });
        if (v && requests.current[id] === request) updateReport(id, { ...v, broker, account: id, sourceKind: source });
      } catch (e) {
        if (requests.current[id] === request) updateReport(id, { broker, account: id, sourceKind: source, error: errorText(e) });
      }
    }, false);
  }
  // 一键更新全部账户: every active broker account with a known broker, each in its own result card.
  async function updateAll() {
    selectAccount("all");
    let current = conn;
    if (!current && !demo) {
      current = await api.connections().catch(() => null);
      if (current) setConn(current);
    }
    const targets = syncTargets(d.accounts, current, mapping, demo);
    if (!targets.length)
      return run(() => {
        throw Error(t("imports.updateAllNone"));
      }, false);
    await Promise.all(targets.map((target) => prepare(demo ? "sample" : "live", target.broker, target.account)));
  }
  useEffect(() => {
    if (!initial.sync || started.current) return;
    started.current = true;
    if (initialAccount && initial.broker !== "both") prepare(demo ? "sample" : "live", initial.broker, initialAccount);
    else updateAll();
  }, []);
  async function commit(r) {
    await run(async () => {
      const v = await api.commit({ token: r.token });
      updateReport(r.account, { ...v, broker: r.broker, account: r.account, done: true });
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
    setReturnTo(null);
    setDrawer("reconcile");
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
    setReturnTo(drawer === "reconcile" ? "reconcile" : null);
    setModal(null);
    setManualType(type);
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
    setDrawer("manual");
  }
  function manualSaved() {
    setCompare(null);
    setDrawer(returnTo);
    setReturnTo(null);
    if (!returnTo) {
      setOffset(0);
      setSearch("");
      showHistory();
    }
  }
  function reconcileFrom(id) {
    if (sel !== "all" || !id) return toggleDrawer("reconcile");
    selectAccount(id);
    setDrawer("reconcile");
  }
  const accountName = destination?.name;
  const nameOf = (id) => d.accounts.find((a) => a.id === id)?.name || "—";
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
  const batches = d.batches.filter((b) => sel === "all" || b.account === sel);
  const synced = lastBatches(d.batches);
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
  if (!active.length)
    return (
      <div className="imp imp-page">
        <Panel title={t("imports.needAccountTitle")} className="cap880">
          <Empty>{t("imports.needAccountEmpty")}</Empty>
          <button className="btn pri" onClick={() => onPage("settings", { cat: "accounts" })}>
            {t("imports.createAccountBtn")}
          </button>
        </Panel>
      </div>
    );

  const states = Object.fromEntries(active.map((a) => [a.id, accountConnection(a, conn, mapping, demo, t)]));
  const allTone = Object.values(states).some((s) => s.tone === "warn")
    ? "warn"
    : Object.values(states).some((s) => s.tone === "up") ? "up" : "muted";
  const selectedState = selected && states[selected.id];
  const selectedBroker = selected && !selected.custom ? accountBroker(selected, conn, mapping) : null;
  const lastLine = (id) => {
    const time = states[id]?.lastSuccess || synced[id];
    return time ? t("imports.lastSync", { time: formatDateTime(time) }) : t("imports.neverSynced");
  };
  const fileBrokers = (a) => {
    if (a.mode && a.mode !== "TRANSACTIONS") return [];
    const b = accountBroker(a, conn, mapping);
    return b ? [b] : ["ibkr", "webull"];
  };
  const fileButton = (b, id) => (
    <button
      key={b}
      type="button"
      className="btn sm"
      onClick={() => {
        setDrawer(null);
        prepare("file", b, id);
      }}
    >
      <Upload {...ico} />
      {t(b === "ibkr" ? "imports.chooseIbkrXml" : "imports.chooseWebullCsv")}
    </button>
  );

  const master = (
    <nav className="acct-list" aria-label={t("imports.accountsAria")}>
      <button
        type="button"
        className={"acct-item" + (sel === "all" ? " on" : "")}
        aria-current={sel === "all" ? "true" : undefined}
        onClick={() => selectAccount("all")}
      >
        <span className="acct-ico"><Layers {...ico} /></span>
        <span className="acct-item-body">
          <span className="acct-item-top">
            <span>{t("imports.allAccounts")}</span>
            <span className={"dot " + allTone} />
          </span>
          <span className="cap">{t("imports.allAccountsSub", { count: active.length })}</span>
        </span>
      </button>
      <div className="acct-group-label">{t("imports.subAccounts")}</div>
      <div className="acct-children">
        {active.map((a) => {
          const s = states[a.id];
          const broker = a.custom ? a.brokerName || t("custom.name") : s.broker ? brokerNames[s.broker] : t("settings.conn.notConnected");
          return (
            <button
              type="button"
              key={a.id}
              className={"acct-item" + (sel === a.id ? " on" : "")}
              aria-current={sel === a.id ? "true" : undefined}
              title={s.label}
              onClick={() => selectAccount(a.id)}
            >
              <span className="acct-ico">{a.custom ? <FileSpreadsheet {...ico} /> : <Building2 {...ico} />}</span>
              <span className="acct-item-body">
                <span className="acct-item-top">
                  <span className="acct-name">{a.name}</span>
                  <span className={"dot " + s.tone} />
                </span>
                <span className="cap">{broker} · {lastLine(a.id)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );

  const tiles =
    sel === "all" ? (
      <>
        <Tile icon={RefreshCw} title={t("imports.updateAll")} sub={t(demo ? "imports.opt.syncDemo" : "imports.updateAllSub")} onClick={updateAll} />
        <Tile icon={Upload} title={t("imports.tile.file")} sub={t("imports.tile.fileSubAll")} active={drawer === "file"} onClick={() => toggleDrawer("file")} />
        <Tile icon={PenLine} title={t("imports.tile.manual")} sub={t("imports.tile.manualSub")} active={drawer === "manual"}
          onClick={() => (drawer === "manual" ? setDrawer(null) : openManual(false))} />
        <Tile icon={Scale} title={t("imports.tile.reconcile")} sub={t("imports.tile.reconcileAllSub")} active={drawer === "reconcile"}
          onClick={() => setDrawer(drawer === "reconcile" ? null : "reconcile")} />
      </>
    ) : selected.custom ? (
      <>
        <Tile icon={FileSpreadsheet} title={t("custom.import")} sub={t("imports.tile.csvSub")} active={drawer === "file"} onClick={() => toggleDrawer("file")} />
        <Tile icon={PenLine} title={t("imports.tile.manual")} sub={t("imports.tile.manualSub")} active={drawer === "manual"}
          onClick={() => (drawer === "manual" ? setDrawer(null) : openManual(false))} />
        <Tile icon={Scale} title={t("imports.tile.reconcile")} sub={t("imports.tile.reconcileSub")} active={drawer === "reconcile"} onClick={() => toggleDrawer("reconcile")} />
      </>
    ) : (
      <>
        <Tile
          icon={CloudDownload}
          title={selectedBroker ? t("imports.tile.syncOne", { broker: brokerNames[selectedBroker] }) : t("imports.opt.sync")}
          sub={selectedBroker ? t(demo ? "imports.opt.syncDemo" : "imports.tile.syncOneSub") : t("imports.tile.syncNeedsConnection")}
          disabled={!selectedBroker || (selectedState && !selectedState.syncable)}
          onClick={() => prepare(demo ? "sample" : "live", selectedBroker, selected.id)}
        />
        <Tile
          icon={Upload}
          title={t("imports.tile.file")}
          sub={t(selectedBroker ? "imports.tile.fileSub" : "imports.opt.fileSub")}
          active={drawer === "file"}
          onClick={() => {
            const brokers = fileBrokers(selected);
            if (brokers.length === 1) prepare("file", brokers[0], selected.id);
            else toggleDrawer("file");
          }}
        />
        <Tile icon={PenLine} title={t("imports.tile.manual")} sub={t("imports.tile.manualSub")} active={drawer === "manual"}
          onClick={() => (drawer === "manual" ? setDrawer(null) : openManual(false))} />
        <Tile icon={Scale} title={t("imports.tile.reconcile")} sub={t("imports.tile.reconcileSub")} active={drawer === "reconcile"} onClick={() => toggleDrawer("reconcile")} />
      </>
    );

  const brokerCard = (r) => (
    <BrokerResult
      key={r.account}
      report={r}
      title={accountTitle(nameOf(r.account), r.broker)}
      accounts={d.accounts}
      onConfirm={() => commit(r)}
      onClose={() => updateReport(r.account, null)}
      onRetry={() => prepare(r.sourceKind, r.broker, r.account)}
      onConnect={demo ? null : () => onPage("settings", { cat: "accounts", account: r.account })}
      onReconcile={(result) => {
        selectAccount(result.account);
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
              const activeRequest = requests.current[r.account];
              setConnectingFunds(true);
              try {
                const status = await run(() => api.connectWebullFunds({ account: r.account }), false);
                if (requests.current[r.account] !== activeRequest) return;
                if (status === "loaded") await prepare("live", "webull", r.account);
                if (status === "unavailable") updateReport(r.account, { ...r, webullFundsStatus: status });
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
            updateReport(r.account, { ...(await api.preview({ token: r.token })), broker: r.broker, account: r.account, sourceKind: r.sourceKind });
          }, false)
        }
      />
    </BrokerResult>
  );
  const shownReports = [...active.map((a) => reports[a.id]), ...Object.values(reports).filter((r) => !active.some((a) => a.id === r.account))]
    .filter((r) => r && (sel === "all" || r.account === sel));

  const evidence = accountReports.length > 0 && (
    <Panel title={t("imports.evidenceTitle")} className="evidence">
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
              showHistory();
            }}
          >
            {t("imports.viewRelatedActivity")}
          </button>
        </div>
      ))}
    </Panel>
  );
  const accountPicker = sel === "all" && (
    <div className="fg">
      <F label={t("imports.belongAccount")}>
        <AccountOptions d={d} value={account} set={chooseAccount} />
      </F>
    </div>
  );
  const statement = (
    <Drawer
      icon={Scale}
      title={t("imports.drawer.reconcile", { account: accountName || "" })}
      onClose={() => setDrawer(null)}
      action={
        webullSample ? (
          <button type="button" className="btn sm" onClick={() => setModal("statement")}>
            {t("imports.viewSampleStatement")}
          </button>
        ) : null
      }
    >
      {accountPicker}
      <div className={"reconcile-grid" + (evidence ? " two" : "")}>
        <div className="reconcile-form">
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
              disabled={!account}
              onClick={() => run(async () => setCompare(await api.compare(compareArgs())), false)}
            >
              {t("imports.compareBtn")}
            </button>
            <button type="button" className="btn" disabled={!account} onClick={() => openManual(false)}>
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
                              showHistory();
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
        </div>
        {evidence}
      </div>
    </Drawer>
  );

  const manual = (
    <Drawer icon={PenLine} title={t("imports.drawer.manual", { account: accountName || "" })} onClose={() => setDrawer(returnTo)}>
      {accountPicker}
      {custom ? (
        <CustomManualEntry
          key={account + manualType}
          inline
          d={d}
          account={destination}
          type={manualType}
          run={run}
          close={() => setDrawer(returnTo)}
          onSaved={manualSaved}
        />
      ) : (
        <form
          className="imp"
          aria-label={t("imports.manualModalTitle")}
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.manual({ account, ...form });
              manualSaved();
            }, t("imports.entryBooked"));
          }}
        >
          <div className="acts manual-kinds">
            <button type="button" className="btn sm" disabled={!account} onClick={() => setModal("position")}>
              {t("imports.manualHolding")}
            </button>
          </div>
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
            <button className="btn pri" type="submit" disabled={!account}>
              {t("imports.confirmBookTo", { account: accountName || "" })}
            </button>
            <button type="button" className="btn" onClick={() => setDrawer(returnTo)}>
              {t("app.cancel")}
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );

  const opening = selected && (
    <Drawer icon={Flag} title={t("imports.drawer.opening", { account: selected.name })} onClose={() => setDrawer(null)}>
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
              setDrawer(null);
              showHistory();
            }, t("imports.openingSaved"))
          }
        >
          {t("imports.saveOpening")}
        </button>
      </div>
    </Drawer>
  );

  const files = (
    <Drawer icon={Upload} title={selected?.custom ? t("custom.import") : t("imports.tile.file")} onClose={() => setDrawer(null)}>
      {selected?.custom ? (
        <CustomCsvImport key={selected.id} embedded account={selected} run={run} onHistory={showHistory} />
      ) : (
        <div className="file-targets">
          {(selected ? [selected] : active).map((a) => (
            <div className="file-target" key={a.id}>
              <span className="acct-ico">{a.custom ? <FileSpreadsheet {...ico} /> : <Building2 {...ico} />}</span>
              <span className="file-target-name">
                <b>{a.name}</b>
                <span className="cap">
                  {a.custom ? t("custom.csv") : states[a.id].broker ? brokerNames[states[a.id].broker] : t("settings.conn.notConnected")}
                </span>
              </span>
              <span className="sp" />
              {a.custom ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    selectAccount(a.id);
                    setDrawer("file");
                  }}
                >
                  <FileSpreadsheet {...ico} />
                  {t("custom.import")}
                </button>
              ) : (
                fileBrokers(a).map((b) => fileButton(b, a.id))
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );

  const workspaceTitle = selected ? selected.name : t("imports.allWorkspace");
  const workspace = (
    <section className="card workspace" aria-label={workspaceTitle}>
      <div className="ws-head">
        <div className="ws-title">
          <h2>{selected ? (selected.custom ? <FileSpreadsheet {...ico} /> : <Building2 {...ico} />) : <Layers {...ico} />}{workspaceTitle}</h2>
          <p className="cap">
            {selected
              ? [selected.custom ? selected.brokerName || t("custom.name") : selectedBroker ? brokerNames[selectedBroker] : t("settings.conn.notConnected"),
                 selectedState?.label, lastLine(selected.id)].filter(Boolean).join(t("common.middot"))
              : t("imports.allWorkspaceSub")}
          </p>
        </div>
        {selected && (
          <button type="button" className={"btn sm" + (drawer === "opening" ? " on" : "")} aria-expanded={drawer === "opening"} onClick={() => toggleDrawer("opening")}>
            <Flag {...ico} />
            {t(selected.custom ? "custom.opening" : "imports.tile.opening")}
          </button>
        )}
      </div>
      <div className="action-tiles" role="group" aria-label={t("imports.actionsAria")}>
        {tiles}
      </div>
      {drawer === "file" && files}
      {drawer === "manual" && manual}
      {drawer === "reconcile" && statement}
      {drawer === "opening" && opening}
      {shownReports.length > 0 && <div className="sync-results">{shownReports.map(brokerCard)}</div>}
    </section>
  );

  const batchCard = batches.length > 0 && (
    <Panel title={t("imports.recentBatches")} className="batches">
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{t("imports.col.source")}</th>
              {sel === "all" && <th className="l">{t("imports.col.account")}</th>}
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
                {sel === "all" && <td className="l">{nameOf(b.account)}</td>}
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

  const history = (
    <section className={"card history" + (historyOpen ? "" : " folded")} aria-label={t("imports.historyTitle")} ref={historyRef}>
      <div className="row">
        <h2>
          <button type="button" className="fold-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>
            <ChevronRight {...ico} className="fold-chevron" />
            <FileText {...ico} />
            {t("imports.ledgerFor", { account: selected ? selected.name : t("imports.allAccounts") })}
          </button>
        </h2>
        <span className="sp" />
        {historyOpen && <>
        <span className="search-box">
          <Search {...ico} />
          <input
            className="btn history-search"
            type="search"
            aria-label={t("imports.filterLedgerAria")}
            placeholder={t("imports.filterLedgerPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </span>
        <label className="chk">
          <input type="checkbox" checked={voided} onChange={(e) => setVoided(e.target.checked)} />
          {t("imports.showVoided")}
        </label>
        </>}
      </div>
      {historyOpen && <>
      {entries.length ? (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{t("imports.col.date")}</th>
                {sel === "all" && <th className="l">{t("imports.col.account")}</th>}
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
                    {sel === "all" && <td className="l">{nameOf(v.accountId)}</td>}
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
      </>}
    </section>
  );

  return (
    <div className="imp imp-page">
      <div className="imp-head">
        <p className="cap">{t("imports.pageSub")}</p>
        <span className="sp" />
        <button type="button" className="btn pri update-all" onClick={updateAll}>
          <RefreshCw {...ico} />
          {t("imports.updateAll")}
        </button>
      </div>
      <div className="master-detail">
        {master}
        <div className="detail-col">
          {workspace}
          {history}
          {batchCard}
        </div>
      </div>

      {amend && (
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
                  ["currency", t("custom.fromCurrency"), "text"],
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
                    await api.amend({ ...blank, ...amendForm, account: amend.accountId || account, id: amend.id, prior: JSON.stringify(amend) });
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

      {deleteTarget && (
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
    </div>
  );
}
