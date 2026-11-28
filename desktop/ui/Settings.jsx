// Settings (D08 Route B+): a category rail, a status strip and grouped rows with an icon on each.
// Four categories: general & appearance, accounts & broker connections, ledger & backups, market data & rules.
import React, { useEffect, useState } from "react";
import {
  Building2, ChartLine, CirclePlus, Database, FileSpreadsheet, FileText, Globe, HardDriveDownload, KeyRound, Layers,
  Link2, PenLine, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, Sun, Tag, TriangleAlert, ZoomIn,
} from "lucide-react";
import { api, Modal, kind } from "./common";
import { scopedAliasKey } from "../allocation/domain/identifiers";
import { BookBackups } from "./BookBackups";
import { FactoryResetButton } from "./FactoryReset";
import { DiagnosticsButton } from "./Diagnostics";
import { USER_SCALE_LIMITS } from "../adaptiveLayout.js";
import { aliasRows, brokerState } from "./settingsModel.js";
import { accountConnection, accountTitle, brokerNames, connectionHealth, lastBatches } from "./accountConnections.js";
import { useI18n } from "./i18n.jsx";

export const categoryIds = ["general", "accounts", "book", "market"];
const categoryIcons = { general: SlidersHorizontal, accounts: Link2, book: Database, market: ChartLine };
// Links into the page from before the redesign named three tabs.
const legacyTabs = { connections: "accounts", book: "book", data: "market" };
const ico = { size: 16, strokeWidth: 1.8, "aria-hidden": true };

function F({ label, children }) {
  return (
    <label className="f">
      <span>{label}</span>
      {children}
    </label>
  );
}
// A titled group of rows. `danger` marks the factory-reset card.
function Group({ icon: Icon, title, note, action, danger = false, children }) {
  return (
    <section className={"s-group" + (danger ? " danger-box" : "")} aria-label={title}>
      <div className="s-group-head">
        <h2>{Icon && <Icon {...ico} />}{title}</h2>
        {note}
        {action}
      </div>
      {children}
    </section>
  );
}
function Row({ icon: Icon, title, desc, danger = false, className = "", children }) {
  return (
    <div className={"s-row " + className}>
      <div className="s-row-l">
        <span className={"row-ico" + (danger ? " danger" : "")}>{Icon && <Icon {...ico} />}</span>
        <div className="s-row-info">
          <b>{title}</b>
          {desc && <span>{desc}</span>}
        </div>
      </div>
      {children && <div className="s-row-ctrl">{children}</div>}
    </div>
  );
}
function Kpi({ icon: Icon, label, value }) {
  return (
    <div className="health-kpi">
      <span className="kpi-ico"><Icon size={18} strokeWidth={1.8} aria-hidden /></span>
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
    </div>
  );
}
const errorText = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

// Re-authorises one IBKR binding in place, inside its account row.
function IbkrReauthorization({ binding, onSaved }) {
  const { t } = useI18n();
  const [queryId, setQueryId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSubmit = !busy && token.trim() && (binding.authorized || queryId.trim());

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await api.reauthorizeIbkr({ id: binding.id, queryId, token });
      setQueryId("");
      setToken("");
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ibkr-reauth" aria-label={t("settings.ibkrReauthTitle", { name: binding.name })} onSubmit={submit}>
      <div className="fg">
        <F label="Flex Query ID">
          <input
            aria-describedby={binding.authorized ? "ibkr-reauth-query-help-" + binding.id : undefined}
            disabled={busy}
            maxLength={4096}
            required={!binding.authorized}
            value={queryId}
            onChange={(e) => setQueryId(e.target.value)}
          />
        </F>
        <F label="Flex Token">
          <input
            autoComplete="off"
            disabled={busy}
            maxLength={4096}
            required
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </F>
      </div>
      {binding.authorized && (
        <p id={"ibkr-reauth-query-help-" + binding.id} className="cap">{t("settings.ibkrReauthQueryHelp")}</p>
      )}
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="acts">
        <button type="submit" className="btn pri sm" disabled={!canSubmit}>
          {busy ? t("ob.checkingBroker") : t("settings.ibkrReauthSubmit")}
        </button>
      </div>
    </form>
  );
}

export function Settings({ d, mode, appVersion, versionRow, theme = "system", onThemeChange, userScale = 1, onUserScaleChange, run, initial = {}, workspace, openHome, onSetup }) {
  const { t, languagePreference, localeOptions, changeLanguage, formatDate, formatDateTime, kindLabel, marketLabel } = useI18n();
  const securityLabel = (r) =>
    [r.name || r.ticker, r.ticker, marketLabel(r.mic), r.localCurrency].join(t("common.middot"));
  const demo = mode === "demo";
  const mapping = d.brokerAccounts || {};
  const [cat, setCat] = useState(
    categoryIds.includes(initial.cat) ? initial.cat : legacyTabs[initial.tab] || (initial.account || initial.broker ? "accounts" : "general"),
  );
  const [name, setName] = useState(""),
    [ccy, setCcy] = useState("AUD"),
    [conn, setConn] = useState(null),
    [draft, setDraft] = useState({}),
    [web, setWeb] = useState(null),
    [market, setMarket] = useState(null),
    [dialog, setDialog] = useState("");
  const [expanded, setExpanded] = useState(initial.account || (initial.broker && mapping[initial.broker]) || null);
  const [sharedChoice, setSharedChoice] = useState("ibkr");
  const [open, setOpen] = useState({ resetSync: false });
  const [disconnect, setDisconnect] = useState(null);
  const [deleteAccount, setDeleteAccount] = useState(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [asset, setAsset] = useState("fx"),
    [price, setPrice] = useState(""),
    [date, setDate] = useState(d.date),
    [fund, setFund] = useState(d.etfData[0]?.asset.etfKey || "");
  const [pm, setPm] = useState("auto"),
    [provider, setProvider] = useState("ishares"),
    [identity, setIdentity] = useState(""),
    [alias, setAlias] = useState({ provider: "manual", key: "", id: "" });
  const [override, setOverride] = useState(""),
    [type, setType] = useState("etf"),
    [reset, setReset] = useState({ broker: "ibkr", account: d.selected[0] || "" });
  useEffect(() => {
    let active = true;
    api
      .connections()
      .then((c) => {
        if (active) setConn(c);
      })
      .catch(() => {});
    api
      .marketSettings()
      .then((m) => {
        if (active) setMarket(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [d, mode]);
  useEffect(() => {
    setPm(d.settings.providerModes[fund] || "auto");
    setProvider(d.settings.pinnedProviders[fund] || "ishares");
    setIdentity(d.settings.providerIdentities[fund] || "");
  }, [fund, d.settings]);
  const toggle = (key) => setOpen({ ...open, [key]: !open[key] });
  const change = (key, v) => setDraft({ ...draft, [key]: v });
  const secured = (key) => (conn?.present?.[key] ? t("settings.secretSaved") : t("settings.secretNotConnected"));
  const saveSettings = (patch) => api.allocationSettings({ ...d.settings, ...patch });
  const rows = Array.from(new Map(d.rows.filter((r) => r.profileId).map((r) => [r.assetId, r])).values());
  const reloadConnections = async () => setConn(await api.connections());
  async function saveKeys(keys) {
    const data = Object.fromEntries(keys.filter((k) => draft[k]?.trim()).map((k) => [k, draft[k].trim()]));
    if (!Object.keys(data).length) throw Error(t("settings.missingCredentials"));
    await api.saveConnection(data);
    setDraft({});
    await reloadConnections();
  }
  const secretField = (label, k) => (
    <F key={k} label={label}>
      <input
        type="password"
        autoComplete="off"
        placeholder={secured(k)}
        value={draft[k] || ""}
        onChange={(e) => change(k, e.target.value)}
      />
    </F>
  );
  const health = connectionHealth(d.accounts, conn, mapping, demo);
  const synced = lastBatches(d.batches);
  const timeOr = (value, fallback) => (value ? formatDateTime(value) : fallback);

  // The shared (not per-account) credentials of one broker, used by accounts without their own binding.
  const sharedForm = (broker) =>
    broker === "ibkr" ? (
      <div className="shared-conn" aria-label="Interactive Brokers">
        <p className="cap">{t("settings.ibkrHelp")}</p>
        <div className="fg">
          <F label="Flex Query ID">
            <input
              value={draft["ibkr.flex-query-id"] ?? conn?.query ?? ""}
              onChange={(e) => change("ibkr.flex-query-id", e.target.value)}
            />
          </F>
          {secretField("Flex Token", "ibkr.flex-token")}
        </div>
        <div className="acts">
          <button
            className="btn pri sm"
            onClick={() => run(() => saveKeys(["ibkr.flex-query-id", "ibkr.flex-token"]), t("settings.ibkrSaved"))}
          >
            {t("settings.saveIbkr")}
          </button>
          <button className="btn sm" onClick={() => setDialog("ibkr")}>
            {t("settings.disconnectIbkr")}
          </button>
        </div>
      </div>
    ) : (
      <div className="shared-conn" aria-label="Webull Australia">
        <div className="fg">
          <F label="App Key">
            <input
              value={draft["webull.app-key"] ?? conn?.webullKey ?? ""}
              onChange={(e) => change("webull.app-key", e.target.value)}
            />
          </F>
          {secretField("App Secret", "webull.app-secret")}
        </div>
        <div className="acts">
          <button
            className="btn pri sm"
            onClick={() => run(() => saveKeys(["webull.app-key", "webull.app-secret"]), t("settings.webullSaved"))}
          >
            {t("settings.saveWebull")}
          </button>
          <button
            className="btn sm"
            onClick={() =>
              run(async () => {
                setWeb(await api.connectWebull());
                await reloadConnections();
              }, false)
            }
          >
            {t("settings.connectWebull")}
          </button>
          <button className="btn sm" onClick={() => setDialog("webull")}>
            {t("settings.disconnectWebull")}
          </button>
        </div>
        {web && <p className="cap">{web.status === "PENDING" ? t("settings.webullPending") : web.status}</p>}
        {web?.accounts.length > 0 && (
          <div className="fg">
            <F label={t("settings.webullAccount")}>
              <select
                value={conn?.webullId}
                onChange={(e) =>
                  run(async () => {
                    await api.saveConnection({ "webull.api-account-id": e.target.value });
                    await reloadConnections();
                  }, t("settings.accountLinked"))
                }
              >
                <option value="">{t("settings.chooseBrokerAccount")}</option>
                {web.accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.accountNumber || a.accountId}
                  </option>
                ))}
              </select>
            </F>
          </div>
        )}
      </div>
    );

  // What opens under an account row: its binding, the shared connection, a way to connect, or custom-account actions.
  function accountDrawer(a, state) {
    if (demo) return <p className="cap">{t("settings.conn.sampleDesc")}</p>;
    if (state.kind === "custom")
      return (
        <div className="drawer-line">
          <span className="cap">{t("settings.conn.customDesc")}</span>
          <button
            type="button"
            className="btn sm danger custom-delete-action"
            aria-label={t("custom.deleteAria", { name: a.name })}
            onClick={() => setDeleteAccount(a)}
          >
            {t("custom.delete")}
          </button>
        </div>
      );
    if (state.kind === "binding")
      return (
        <>
          {state.broker === "ibkr" ? (
            <IbkrReauthorization
              binding={{ ...state.binding, name: a.name }}
              onSaved={() => run(reloadConnections, t("settings.ibkrReauthSaved"))}
            />
          ) : (
            <div className="drawer-line">
              <span className="cap">{t("settings.conn.webullReauth")}</span>
              <button type="button" className="btn sm" onClick={onSetup}>
                <KeyRound {...ico} />
                {t("settings.ibkrReauthBtn")}
              </button>
            </div>
          )}
          {state.binding.authorized && (
            <div className="acts">
              <button type="button" className="btn sm" onClick={() => setDisconnect({ ...state.binding, name: a.name })}>
                {t("settings.disconnectAccountBtn")}
              </button>
            </div>
          )}
        </>
      );
    if (state.kind === "shared")
      return (
        <>
          <p className="cap">{t("settings.conn.sharedNote", { broker: brokerNames[state.broker] })}</p>
          {sharedForm(state.broker)}
        </>
      );
    return (
      <>
        <div className="drawer-line">
          <span className="cap">{t("settings.conn.noneDesc")}</span>
          <button type="button" className="btn pri sm" onClick={onSetup}>
            <Link2 {...ico} />
            {t("settings.conn.connectBtn")}
          </button>
        </div>
        <details className="shared-choice">
          <summary>{t("settings.conn.useShared")}</summary>
          <div className="seg" role="group" aria-label={t("settings.resetBrokerAria")}>
            {["ibkr", "webull"].map((b) => (
              <button type="button" key={b} aria-pressed={sharedChoice === b} className={sharedChoice === b ? "on" : ""}
                onClick={() => setSharedChoice(b)}>{brokerNames[b]}</button>
            ))}
          </div>
          {sharedForm(sharedChoice)}
        </details>
      </>
    );
  }

  const accountRow = (a) => {
    const state = accountConnection(a, conn, mapping, demo, t);
    const isOpen = expanded === a.id;
    const broker = state.kind === "custom" ? a.brokerName || t("custom.name") : state.broker ? brokerNames[state.broker] : null;
    const last = state.lastSuccess || synced[a.id];
    return (
      <React.Fragment key={a.id}>
        <Row
          className={"account-row" + (state.kind === "binding" ? " binding-row" : "")}
          icon={a.custom ? FileSpreadsheet : Building2}
          title={
            <>
              {a.name}
              {broker && !(state.broker && accountTitle(a.name, state.broker) === a.name) && (
                <span className="cap inline">
                  {" · "}{broker}{state.suffix ? " ···· " + state.suffix : ""}
                </span>
              )}
            </>
          }
          desc={[a.currency, a.active ? t("settings.conn.lastSync", { time: timeOr(last, t("settings.conn.never")) }) : null]
            .filter(Boolean)
            .join(t("common.middot"))}
        >
          {a.active ? (
            <>
              <span className={"tag " + state.tone}>{state.label}</span>
              <button type="button" className="btn sm" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : a.id)}>
                {isOpen ? t("settings.collapse") : t("settings.manageConnection")}
              </button>
            </>
          ) : (
            <span className="tag">{t("settings.status.archived")}</span>
          )}
        </Row>
        {isOpen && a.active && (
          <div className="cred-drawer" aria-label={a.name} role="group">
            {accountDrawer(a, state)}
          </div>
        )}
      </React.Fragment>
    );
  };

  const general = (
    <>
      <Group icon={SlidersHorizontal} title={t("settings.group.appearance")}>
        <Row icon={Sun} title={t("settings.row.theme")} desc={t("settings.row.themeDesc")}>
          <select aria-label={t("settings.themeLabel")} value={theme} onChange={(e) => onThemeChange(e.target.value)}>
            <option value="system">{t("settings.theme.system")}</option>
            <option value="light">{t("settings.theme.light")}</option>
            <option value="dark">{t("settings.theme.dark")}</option>
          </select>
        </Row>
        <Row icon={Globe} title={t("settings.row.language")} desc={t("settings.row.languageDesc")}>
          <select aria-label={t("lang.label")} value={languagePreference} onChange={(e) => changeLanguage(e.target.value)}>
            {localeOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </Row>
        {onUserScaleChange && (
          <Row icon={ZoomIn} title={t("settings.zoomLabel")} desc={<span id="zoom-shortcuts">{t("settings.row.zoomDesc")}</span>}>
            <div className="settings-zoom" role="group" aria-label={t("settings.zoomAria")} aria-describedby="zoom-shortcuts">
              <button type="button" className="btn sm" aria-label={t("settings.zoomOutAria")}
                disabled={userScale <= USER_SCALE_LIMITS.min}
                onClick={() => onUserScaleChange({ delta: -USER_SCALE_LIMITS.step })}>−</button>
              <output aria-label={t("settings.zoomCurrentAria")}>{Math.round(userScale * 100)}%</output>
              <button type="button" className="btn sm" aria-label={t("settings.zoomInAria")}
                disabled={userScale >= USER_SCALE_LIMITS.max}
                onClick={() => onUserScaleChange({ delta: USER_SCALE_LIMITS.step })}>+</button>
              <button type="button" className="btn sm" aria-label={t("settings.zoomResetAria")}
                disabled={userScale === USER_SCALE_LIMITS.default}
                onClick={() => onUserScaleChange({ reset: true })}>{t("settings.zoomResetBtn")}</button>
            </div>
          </Row>
        )}
      </Group>
      <Group icon={RefreshCw} title={t("settings.group.updates")}>
        <Row icon={RefreshCw} title={t("settings.row.version")} desc={t("settings.row.versionDesc")} className="version-row">
          {versionRow ?? <span className="cap">{t("settings.appVersion", { version: appVersion })}</span>}
        </Row>
        <Row icon={FileText} title={t("settings.row.diagnostics")} desc={t("settings.row.diagnosticsDesc")}>
          <DiagnosticsButton screen="settings" />
        </Row>
      </Group>
      <Group
        icon={TriangleAlert}
        title={t("settings.factoryReset.section")}
        note={<span className="tag warn">{t("settings.factoryReset.badge")}</span>}
        danger
      >
        <Row icon={TriangleAlert} danger title={t("settings.factoryReset.section")} desc={t("settings.factoryReset.summary")}>
          <FactoryResetButton />
        </Row>
      </Group>
    </>
  );

  const accounts = (
    <>
      {demo && <div className="notice">{t("settings.demoConnectionsNotice")}</div>}
      <Group
        icon={Link2}
        title={t("settings.group.connections")}
        action={!demo && (
          <button type="button" className="btn pri sm" onClick={onSetup}>
            <CirclePlus {...ico} />
            {t("settings.addAccount")}
          </button>
        )}
      >
        {[...d.accounts.filter((a) => a.active), ...d.accounts.filter((a) => !a.active)].map(accountRow)}
        {demo && (
          <form
            className="s-row demo-account"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.account({ name, currency: ccy });
                setName("");
              }, t("settings.accountCreated"));
            }}
          >
            <div className="fg end">
              <F label={t("settings.newAccountName")}>
                <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.newAccountPlaceholder")} />
              </F>
              <F label={t("settings.currency")}>
                <select value={ccy} onChange={(e) => setCcy(e.target.value)}>
                  <option>AUD</option>
                  <option>USD</option>
                </select>
              </F>
              <button className="btn pri">{t("settings.createAccount")}</button>
            </div>
          </form>
        )}
      </Group>
      <Group
        icon={RotateCcw}
        title={t("settings.group.resetSync")}
        action={
          <button type="button" className="btn sm" aria-expanded={open.resetSync} onClick={() => toggle("resetSync")}>
            {open.resetSync ? t("settings.collapse") : t("settings.expand")}
          </button>
        }
      >
        {open.resetSync ? (
          <Row icon={RotateCcw} danger title={t("settings.row.resetSync")} desc={t("settings.row.resetSyncDesc")}>
            <select aria-label={t("settings.resetBrokerAria")} value={reset.broker} onChange={(e) => setReset({ ...reset, broker: e.target.value })}>
              <option value="ibkr">IBKR</option>
              <option value="webull">Webull AU</option>
            </select>
            <select aria-label={t("settings.resetAccountAria")} value={reset.account} onChange={(e) => setReset({ ...reset, account: e.target.value })}>
              {d.accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm danger" onClick={() => setDialog("reset")}>
              {t("settings.resetSyncBtn")}
            </button>
          </Row>
        ) : (
          <div className="s-row"><span className="cap">{t("settings.resetSyncHint")}</span></div>
        )}
      </Group>
    </>
  );

  const book = (
    <Group icon={Database} title={t("settings.group.book")}>
      <Row
        icon={Database}
        title={demo ? t("app.demoBook") : t("app.realBookFormal")}
        desc={d.migration ? t("settings.migratedOn", { date: formatDate(d.migration.at) }) : demo ? t("settings.demoSummary") : t("settings.realSummary")}
      >
        <button className="btn sm" onClick={openHome}>
          {t("settings.switchBook")}
        </button>
      </Row>
      {d.migration && (
        <div className="s-row">
          <div className="mini">
            {[
              [t("settings.mig.accounts"), "accounts"],
              [t("settings.mig.activities"), "activities"],
              [t("settings.mig.valuations"), "valuations"],
              [t("settings.mig.allocation"), "allocation"],
              [t("settings.mig.broker"), "broker"],
            ].map(([l, k]) => (
              <span key={k}>
                <b>{d.migration[k]}</b>
                {l}
              </span>
            ))}
          </div>
        </div>
      )}
      <Row
        icon={ShieldCheck}
        title={t("settings.row.backups")}
        desc={t("settings.row.backupsDesc", { time: timeOr(conn?.lastBackup, t("settings.health.never")) })}
        className="backup-row"
      >
        <BookBackups run={run} restored={workspace} />
      </Row>
    </Group>
  );

  const quotes = (
    <div className="cred-drawer" role="group" aria-label={t("settings.manualQuotesTitle")}>
      <div className="fg">
        <F label={t("settings.securityOrFx")}>
          <select value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="fx">USD → AUD</option>
            {rows.map((r) => (
              <option key={r.assetId} value={r.assetId}>
                {r.ticker} · {r.localCurrency}
              </option>
            ))}
          </select>
        </F>
        <F label={t("settings.quoteDate")}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </F>
        <F label={t("settings.unitPriceOrFx")}>
          <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
        </F>
      </div>
      <div className="acts">
        <button
          className="btn pri sm"
          onClick={() =>
            run(async () => {
              await api.savePrice({ assetId: asset === "fx" ? null : asset, from: "USD", date, price });
              setPrice("");
            }, t("settings.quoteSaved"))
          }
        >
          {t("settings.saveQuote")}
        </button>
      </div>
    </div>
  );
  const fundSource = (
    <div className="cred-drawer" role="group" aria-label={t("settings.etfSourcesTitle")}>
      {d.etfData.length ? (
        <>
          <div className="fg">
            <F label={t("settings.fund")}>
              <select value={fund} onChange={(e) => setFund(e.target.value)}>
                {d.etfData.map((v) => (
                  <option key={v.asset.etfKey} value={v.asset.etfKey}>
                    {v.asset.symbol}
                  </option>
                ))}
              </select>
            </F>
            <F label={t("settings.providerMode")}>
              <select value={pm} onChange={(e) => setPm(e.target.value)}>
                <option value="auto">{t("settings.modeAuto")}</option>
                <option value="pinned">{t("settings.modePinned")}</option>
              </select>
            </F>
            <F label={t("settings.pinnedProvider")}>
              <select disabled={pm !== "pinned"} value={provider} onChange={(e) => setProvider(e.target.value)}>
                {["ishares", "invesco", "betashares"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </F>
            <F label={t("settings.issuerId")}>
              <input value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder={t("settings.issuerIdPlaceholder")} />
            </F>
          </div>
          <div className="acts">
            <button
              className="btn pri sm"
              onClick={() =>
                run(
                  () =>
                    saveSettings({
                      providerModes: { ...d.settings.providerModes, [fund]: pm },
                      pinnedProviders: { ...d.settings.pinnedProviders, [fund]: provider },
                      providerIdentities: { ...d.settings.providerIdentities, [fund]: identity.trim() },
                    }),
                  t("settings.fundSourceSaved"),
                )
              }
            >
              {t("settings.saveFundSource")}
            </button>
          </div>
        </>
      ) : (
        <p className="cap">{t("settings.noEtfForSource")}</p>
      )}
    </div>
  );
  const aliases = aliasRows(d.settings.aliases);
  const classes = (
    <div className="cred-drawer" role="group" aria-label={t("settings.typeAndAliasTitle")}>
      <div className="fg">
        <F label={t("settings.security")}>
          <select value={override} onChange={(e) => setOverride(e.target.value)}>
            <option value="">{t("settings.selectSecurity")}</option>
            {rows.map((r) => (
              <option key={r.assetId} value={r.assetId}>
                {securityLabel(r)}
              </option>
            ))}
          </select>
        </F>
        <F label={t("settings.classification")}>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.keys(kind)
              .filter((k) => k !== "cash")
              .map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
          </select>
        </F>
      </div>
      <div className="acts">
        <button
          className="btn pri sm"
          disabled={!override}
          onClick={() => run(() => saveSettings({ typeOverrides: { ...d.settings.typeOverrides, [override]: type } }), t("settings.typeSaved"))}
        >
          {t("settings.saveType")}
        </button>
      </div>
      <div className="sub">{t("settings.aliasHeading")}</div>
      {aliases.length > 0 && (
        <table>
          <thead>
            <tr>
              <th className="l">{t("settings.aliasProvider")}</th>
              <th className="l">{t("settings.aliasKey")}</th>
              <th className="l">{t("settings.aliasId")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {aliases.map((a) => (
              <tr key={a.key}>
                <td className="l">{a.provider}</td>
                <td className="l">{a.source}</td>
                <td className="l">{a.id}</td>
                <td>
                  <button
                    className="lnk"
                    aria-label={t("settings.removeAliasAria", { source: a.source })}
                    onClick={() =>
                      run(async () => {
                        const next = { ...d.settings.aliases };
                        delete next[a.key];
                        await saveSettings({ aliases: next });
                      }, t("settings.aliasRemoved"))
                    }
                  >
                    {t("app.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!!fund && (
        <>
          <div className="fg">
            {[
              ["provider", t("settings.aliasProvider")],
              ["key", t("settings.aliasKey")],
              ["id", t("settings.aliasId")],
            ].map(([k, l]) => (
              <F key={k} label={l}>
                <input value={alias[k]} onChange={(e) => setAlias({ ...alias, [k]: e.target.value })} />
              </F>
            ))}
          </div>
          <div className="acts">
            <button
              className="btn sm"
              disabled={!alias.key.trim() || !alias.id.trim() || !alias.provider.trim()}
              onClick={() =>
                run(
                  () =>
                    saveSettings({
                      aliases: {
                        ...d.settings.aliases,
                        [scopedAliasKey({ provider: alias.provider, etfKey: fund }, alias.key)]: alias.id.trim(),
                      },
                    }),
                  t("settings.aliasSaved"),
                )
              }
            >
              {t("settings.addAlias")}
            </button>
          </div>
        </>
      )}
    </div>
  );
  const editButton = (key, label) => (
    <button type="button" className="btn sm" aria-expanded={!!open[key]} aria-label={label} onClick={() => toggle(key)}>
      {open[key] ? t("settings.collapse") : t("settings.edit")}
    </button>
  );
  const marketPage = (
    <>
      <Group icon={ChartLine} title={t("settings.group.market")}>
        <Row icon={RefreshCw} title={t("settings.autoMarketTitle")} desc={t("settings.autoMarketDesc")}>
          <label className="chk">
            <input
              type="checkbox"
              disabled={demo || !market}
              checked={market?.autoUpdate ?? true}
              onChange={(e) =>
                run(async () => setMarket(await api.marketSettings({ autoUpdate: e.target.checked })), t("settings.marketSettingsSaved"))
              }
            />
            {t("settings.autoMarketCheck")}
          </label>
        </Row>
        <Row
          icon={HardDriveDownload}
          title={t("settings.row.updateMarket")}
          desc={market?.last ? t("settings.lastUpdated", { time: formatDateTime(market.last) }) : t("settings.neverUpdated")}
        >
          <button
            className="btn sm"
            disabled={demo}
            onClick={() =>
              run(async () => {
                const results = await api.updateMarket();
                setMarket(await api.marketSettings());
                const failed = results.filter((r) => r.error);
                return t("settings.marketUpdatedResult", {
                  count: results.filter((r) => !r.error).length,
                  failed: failed.length
                    ? t("settings.marketUpdatedFailed", {
                        items: failed
                          .map((r) => `${r.name}${t("common.openParen")}${r.error}${t("common.closeParen")}`)
                          .join(t("common.comma")),
                      })
                    : "",
                });
              }, true)
            }
          >
            {t("settings.updateMarketNow")}
          </button>
        </Row>
        <Row icon={PenLine} title={t("settings.manualQuotesTitle")} desc={t("settings.row.manualQuotesDesc")}>
          {editButton("quotes", t("settings.manualQuotesTitle"))}
        </Row>
        {open.quotes && quotes}
      </Group>
      <Group icon={Layers} title={t("settings.group.rules")}>
        <Row icon={Layers} title={t("settings.etfSourcesTitle")} desc={t("settings.row.etfDesc", { count: d.etfData.length })}>
          {editButton("fund", t("settings.etfSourcesTitle"))}
        </Row>
        {open.fund && fundSource}
        <Row icon={Tag} title={t("settings.typeAndAliasTitle")} desc={t("settings.row.rulesDesc", { count: aliases.length })}>
          {editButton("classes", t("settings.typeAndAliasTitle"))}
        </Row>
        {open.classes && classes}
      </Group>
    </>
  );

  const confirm = {
    reset: [t("settings.dialog.resetTitle"), t("settings.dialog.resetDesc"), t("settings.dialog.resetConfirm")],
    ibkr: [t("settings.dialog.disconnectTitle"), t("settings.dialog.disconnectDesc"), t("settings.dialog.disconnectConfirm")],
    webull: [t("settings.dialog.disconnectTitle"), t("settings.dialog.disconnectDesc"), t("settings.dialog.disconnectConfirm")],
  }[dialog];
  const sharedIbkr = brokerState(conn, "ibkr", demo, t);
  const marketValue = demo ? t("settings.health.sample") : timeOr(market?.last, t("settings.health.never"));
  return (
    <div className="settings">
      <div className="settings-split">
        <nav className="cat-rail" aria-label={t("settings.categoriesAria")}>
          {categoryIds.map((id) => {
            const Icon = categoryIcons[id];
            return (
              <button type="button" key={id} aria-current={cat === id ? "page" : undefined} className={"cat-btn" + (cat === id ? " on" : "")}
                onClick={() => setCat(id)}>
                <span className="cat-btn-l"><Icon {...ico} />{t(`settings.cat.${id}`)}</span>
                {id === "accounts" && d.accounts.some((a) => a.active) && (
                  <span className="tag">{d.accounts.filter((a) => a.active).length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="settings-col">
          <div className="health-strip" role="group" aria-label={t("settings.health.aria")}>
            <Kpi
              icon={Link2}
              label={t("settings.health.brokers")}
              value={demo ? sharedIbkr.label : health.total ? t("settings.health.brokersValue", health) : t("settings.health.noBrokers")}
            />
            <Kpi icon={ChartLine} label={t("settings.health.market")} value={marketValue} />
            <Kpi icon={ShieldCheck} label={t("settings.health.backup")} value={timeOr(conn?.lastBackup, t("settings.health.never"))} />
          </div>
          {cat === "general" && general}
          {cat === "accounts" && accounts}
          {cat === "book" && book}
          {cat === "market" && marketPage}
        </div>
      </div>
      {disconnect && <Modal title={t("settings.disconnectAccountTitle", { name: disconnect.name })} close={() => setDisconnect(null)}>
        <p>{t("settings.disconnectAccountDesc")}</p>
        <div className="acts"><button className="btn" onClick={() => setDisconnect(null)}>{t("app.cancel")}</button>
          <button className="btn pri" onClick={() => run(async () => {
            await api.disconnectAccount({ id: disconnect.id }); setDisconnect(null); await reloadConnections();
          }, t("settings.accountDisconnected"))}>{t("settings.confirmDisconnect")}</button></div>
      </Modal>}
      {deleteAccount && (
        <Modal title={t("custom.deleteTitle", { name: deleteAccount.name })}
          close={() => { if (!deletingAccount) setDeleteAccount(null); }}>
          <p>{t("custom.deleteDescription")}</p>
          <p className="muted">{t("custom.deleteTransfers")}</p>
          <div className="acts">
            <button type="button" className="btn" disabled={deletingAccount}
              onClick={() => setDeleteAccount(null)}>{t("app.cancel")}</button>
            <button type="button" className="btn custom-delete-action" disabled={deletingAccount}
              onClick={async () => {
                setDeletingAccount(true);
                try {
                  await run(async () => {
                    await api.deleteCustomAccount({ account: deleteAccount.id });
                    setDeleteAccount(null);
                    setExpanded(null);
                  }, t("custom.deleted"));
                } finally {
                  setDeletingAccount(false);
                }
              }}>{t("custom.confirmDelete")}</button>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm[0]} close={() => setDialog("")}>
          <p className="muted">{confirm[1]}</p>
          <div className="acts">
            <button
              className="btn pri"
              onClick={() =>
                run(async () => {
                  if (dialog === "reset") await api.resetSync(reset);
                  else
                    await api.saveConnection(
                      dialog === "ibkr"
                        ? { "ibkr.flex-query-id": null, "ibkr.flex-token": null }
                        : {
                            "webull.app-key": null,
                            "webull.api-account-id": null,
                            "webull.app-secret": null,
                            "webull.access-token": null,
                          },
                    );
                  setDialog("");
                  await reloadConnections();
                }, t("settings.updated"))
              }
            >
              {confirm[2]}
            </button>
            <button className="btn" onClick={() => setDialog("")}>
              {t("app.cancel")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
