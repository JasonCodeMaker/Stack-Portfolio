// Settings (spec §4.6): three tabs of cards, one column up to 880 wide or at most two columns up to 1760.
import React, { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { api, Modal, kind } from "./common";
import { Grid, useShell } from "./Shell";
import { scopedAliasKey } from "../allocation/domain/identifiers";
import { BookBackups } from "./BookBackups";
import { USER_SCALE_LIMITS } from "../adaptiveLayout.js";
import { aliasRows, brokerState, cardColumns } from "./settingsModel.js";
import { useI18n } from "./i18n.jsx";

const tabIds = ["connections", "book", "data"];

function F({ label, children }) {
  return (
    <label className="f">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Panel({ title, action, children }) {
  return (
    <section className="card" aria-label={title}>
      <div className="row">
        <h2>{title}</h2>
        <span className="sp" />
        {action}
      </div>
      {children}
    </section>
  );
}
function Fold({ title, children }) {
  return (
    <details className="card" open>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function IbkrReauthorization({ binding, close, onSaved }) {
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
      onSaved();
    } catch (e) {
      setError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("settings.ibkrReauthTitle", { name: binding.name })}
      close={() => { if (!busy) close(); }}
    >
      <form className="stack" onSubmit={submit}>
        <F label="Flex Query ID">
          <input
            autoFocus={!binding.authorized}
            aria-describedby={binding.authorized ? "ibkr-reauth-query-help" : undefined}
            disabled={busy}
            maxLength={4096}
            required={!binding.authorized}
            value={queryId}
            onChange={(e) => setQueryId(e.target.value)}
          />
        </F>
        {binding.authorized && (
          <p id="ibkr-reauth-query-help" className="cap">{t("settings.ibkrReauthQueryHelp")}</p>
        )}
        <F label="Flex Token">
          <input
            autoFocus={binding.authorized}
            autoComplete="off"
            disabled={busy}
            maxLength={4096}
            required
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </F>
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="acts">
          <button type="button" className="btn" disabled={busy} onClick={close}>{t("app.cancel")}</button>
          <button type="submit" className="btn pri" disabled={!canSubmit}>
            {busy ? t("ob.checkingBroker") : t("settings.ibkrReauthSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Settings({ d, mode, theme = "system", onThemeChange, userScale = 1, onUserScaleChange, run, initial = {}, workspace, openHome, onPage, onSetup }) {
  const { t, languagePreference, localeOptions, changeLanguage, formatDate, formatDateTime, kindLabel, marketLabel } = useI18n();
  const securityLabel = (r) =>
    [r.name || r.ticker, r.ticker, marketLabel(r.mic), r.localCurrency].join(t("common.middot"));
  const demo = mode === "demo";
  const hasCustom = d.accounts.some((account) => account.custom && account.active);
  const { cols } = useShell();
  const [tab, setTab] = useState(initial.tab || "connections"),
    [name, setName] = useState(""),
    [ccy, setCcy] = useState("AUD"),
    [conn, setConn] = useState(null),
    [draft, setDraft] = useState({}),
    [web, setWeb] = useState(null),
    [market, setMarket] = useState(null),
    [dialog, setDialog] = useState("");
  const [disconnect, setDisconnect] = useState(null);
  const [reauthorize, setReauthorize] = useState(null);
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
  const change = (key, v) => setDraft({ ...draft, [key]: v });
  const secured = (key) => (conn?.present[key] ? t("settings.secretSaved") : t("settings.secretNotConnected"));
  const saveSettings = (patch) => api.allocationSettings({ ...d.settings, ...patch });
  const rows = Array.from(new Map(d.rows.filter((r) => r.profileId).map((r) => [r.assetId, r])).values());
  async function saveKeys(keys) {
    const data = Object.fromEntries(keys.filter((k) => draft[k]?.trim()).map((k) => [k, draft[k].trim()]));
    if (!Object.keys(data).length) throw Error(t("settings.missingCredentials"));
    await api.saveConnection(data);
    setDraft({});
    setConn(await api.connections());
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
  const brokerStatus = (state, b) => (
    <div className="status">
      <span className={"dot " + state.tone} />
      <b>{state.label}</b>
      <span className="cap">
        {state.lastSuccess ? t("settings.lastSuccess", { time: formatDateTime(state.lastSuccess) }) : t("settings.noSyncYet")}
      </span>
      <span className="sp" />
      {state.canUpdate && (
        <button className="btn sm" onClick={() => onPage("imports", { broker: b, sync: true })}>
          {t("settings.updateNowBtn")}
        </button>
      )}
    </div>
  );
  const ibkr = brokerState(conn, "ibkr", demo, t),
    webull = brokerState(conn, "webull", demo, t);

  const cards = {
    ibkr: (
      <Panel title="Interactive Brokers">
        {brokerStatus(ibkr, "ibkr")}
        <details open={ibkr.needsAuth || initial.broker === "ibkr"}>
          <summary>{ibkr.needsAuth ? t("settings.ibkrSectionConnect") : t("settings.ibkrSectionAuth")}</summary>
          <p className="muted">{t("settings.ibkrHelp")}</p>
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
              className="btn pri"
              disabled={demo}
              onClick={() => run(() => saveKeys(["ibkr.flex-query-id", "ibkr.flex-token"]), t("settings.ibkrSaved"))}
            >
              {t("settings.saveIbkr")}
            </button>
            <button className="btn" disabled={demo} onClick={() => setDialog("ibkr")}>
              {t("settings.disconnectIbkr")}
            </button>
          </div>
        </details>
      </Panel>
    ),
    webull: (
      <Panel title="Webull Australia">
        {brokerStatus(webull, "webull")}
        <details open={webull.needsAuth || initial.broker === "webull"}>
          <summary>{webull.needsAuth ? t("settings.webullSectionConnect") : t("settings.webullSectionAuth")}</summary>
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
              className="btn pri"
              disabled={demo}
              onClick={() => run(() => saveKeys(["webull.app-key", "webull.app-secret"]), t("settings.webullSaved"))}
            >
              {t("settings.saveWebull")}
            </button>
            <button
              className="btn"
              disabled={demo}
              onClick={() =>
                run(async () => {
                  setWeb(await api.connectWebull());
                  setConn(await api.connections());
                }, false)
              }
            >
              {t("settings.connectWebull")}
            </button>
          </div>
          {web && (
            <p className="muted">
              {web.status === "PENDING" ? t("settings.webullPending") : web.status}
            </p>
          )}
          {web?.accounts.length > 0 && (
            <div className="fg">
              <F label={t("settings.webullAccount")}>
                <select
                  value={conn?.webullId}
                  onChange={(e) =>
                    run(async () => {
                      await api.saveConnection({ "webull.api-account-id": e.target.value });
                      setConn(await api.connections());
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
          <div className="acts">
            <button className="btn" disabled={demo} onClick={() => setDialog("webull")}>
              {t("settings.disconnectWebull")}
            </button>
          </div>
        </details>
      </Panel>
    ),
    market: (
      <Panel title={t("settings.autoMarketTitle")}>
        <p className="muted">{t("settings.autoMarketDesc")}</p>
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
        <div className="acts">
          <button
            className="btn"
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
          <span className="cap">
            {market?.last ? t("settings.lastUpdated", { time: formatDateTime(market.last) }) : t("settings.neverUpdated")}
          </span>
        </div>
      </Panel>
    ),
    reset: (
      <Fold title={t("settings.resetSyncSummary")}>
        <div className="acts">
          <select
            className="btn"
            aria-label={t("settings.resetBrokerAria")}
            value={reset.broker}
            onChange={(e) => setReset({ ...reset, broker: e.target.value })}
          >
            <option value="ibkr">IBKR</option>
            <option value="webull">Webull AU</option>
          </select>
          <select
            className="btn"
            aria-label={t("settings.resetAccountAria")}
            value={reset.account}
            onChange={(e) => setReset({ ...reset, account: e.target.value })}
          >
            {d.accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setDialog("reset")}>
            {t("settings.resetSyncBtn")}
          </button>
        </div>
      </Fold>
    ),
    book: (
      <Panel title={t("settings.currentBook")}>
        <div className="bsum">
          <span className="av">
            <Database size={24} strokeWidth={1.8} />
          </span>
          <div>
            <b>{demo ? t("app.demoBook") : t("app.realBookFormal")}</b>
            <p className="cap">
              {d.migration
                ? t("settings.migratedOn", { date: formatDate(d.migration.at) })
                : demo
                  ? t("settings.demoSummary")
                  : t("settings.realSummary")}
            </p>
          </div>
        </div>
        {d.migration && (
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
        )}
        <div className="acts">
          <button className="btn" onClick={openHome}>
            {t("settings.switchBook")}
          </button>
          <BookBackups run={run} restored={workspace} />
        </div>
      </Panel>
    ),
    accounts: (
      <Panel title={t("settings.accountsTitle")} action={!demo && <button type="button" className="btn pri" onClick={onSetup}>{t("ob.btn.addAccount")}</button>}>
        <table>
          <thead>
            <tr>
              <th className="l">{t("settings.col.name")}</th>
              <th className="l">{t("settings.col.currency")}</th>
              <th className="l">{t("settings.col.status")}</th>
              {hasCustom && <th />}
            </tr>
          </thead>
          <tbody>
            {d.accounts.map((a) => (
              <tr key={a.id}>
                <td className="l account-name">{a.name}{a.custom && <small className="muted"> · {a.brokerName || t("custom.name")}</small>}</td>
                <td className="l">{a.currency}</td>
                <td className="l">{a.active ? t("settings.status.active") : t("settings.status.archived")}</td>
                {hasCustom && <td>
                  {a.custom && a.active && <button type="button" className="lnk" onClick={() => onPage("imports", { account: a.id })}>{t("custom.openLedger")}</button>}
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
        {demo && <form
          className="fg end"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.account({ name, currency: ccy });
              setName("");
            }, t("settings.accountCreated"));
          }}
        >
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
        </form>}
      </Panel>
    ),
    price: (
      <Panel title={t("settings.manualQuotesTitle")}>
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
            className="btn pri"
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
      </Panel>
    ),
    fund: (
      <Fold title={t("settings.etfSourcesTitle")}>
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
                <input
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  placeholder={t("settings.issuerIdPlaceholder")}
                />
              </F>
            </div>
            <div className="acts">
              <button
                className="btn pri"
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
          <p className="muted">{t("settings.noEtfForSource")}</p>
        )}
      </Fold>
    ),
    classes: (
      <Fold title={t("settings.typeAndAliasTitle")}>
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
            className="btn pri"
            disabled={!override}
            onClick={() =>
              run(
                () => saveSettings({ typeOverrides: { ...d.settings.typeOverrides, [override]: type } }),
                t("settings.typeSaved"),
              )
            }
          >
            {t("settings.saveType")}
          </button>
        </div>
        <div className="sub">{t("settings.aliasHeading")}</div>
        {aliasRows(d.settings.aliases).length > 0 && (
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
              {aliasRows(d.settings.aliases).map((a) => (
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
                          const aliases = { ...d.settings.aliases };
                          delete aliases[a.key];
                          await saveSettings({ aliases });
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
                className="btn"
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
      </Fold>
    ),
  };
  const keys = {
    connections: ["ibkr", "webull", "market", "reset"],
    book: ["book", "accounts"],
    data: ["price", "fund", "classes"],
  }[tab];
  const confirm = {
    reset: [t("settings.dialog.resetTitle"), t("settings.dialog.resetDesc"), t("settings.dialog.resetConfirm")],
    ibkr: [t("settings.dialog.disconnectTitle"), t("settings.dialog.disconnectDesc"), t("settings.dialog.disconnectConfirm")],
    webull: [t("settings.dialog.disconnectTitle"), t("settings.dialog.disconnectDesc"), t("settings.dialog.disconnectConfirm")],
  }[dialog];
  return (
    <div className="settings">
      <div className="row">
        <div className="seg" role="group" aria-label={t("settings.tabsAria")}>
          {tabIds.map((id) => (
            <button
              type="button"
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? "on" : ""}
              onClick={() => setTab(id)}
            >
              {t(`settings.tab.${id}`)}
            </button>
          ))}
        </div>
        <label className="row m0">
          <span className="cap">{t("settings.themeLabel")}</span>
          <select className="btn" value={theme} onChange={(e) => onThemeChange(e.target.value)}>
            <option value="system">{t("settings.theme.system")}</option>
            <option value="light">{t("settings.theme.light")}</option>
            <option value="dark">{t("settings.theme.dark")}</option>
          </select>
        </label>
        <label className="row m0">
          <span className="cap">{t("lang.label")}</span>
          <select
            className="btn"
            aria-label={t("lang.label")}
            value={languagePreference}
            onChange={(e) => changeLanguage(e.target.value)}
          >
            {localeOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        {onUserScaleChange && (
          <div className="row m0 settings-zoom" role="group" aria-label={t("settings.zoomAria")} aria-describedby="zoom-shortcuts">
            <span className="cap">{t("settings.zoomLabel")}</span>
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
            <span className="cap" id="zoom-shortcuts">Ctrl + / − / 0</span>
          </div>
        )}
      </div>
      {tab === "connections" && demo && <div className="notice">{t("settings.demoConnectionsNotice")}</div>}
      {tab === "connections" && !demo && (
        <Panel title={t("settings.perAccountTitle")} action={<button className="btn pri" onClick={onSetup}>{t("settings.addOrReauthBtn")}</button>}>
          <p className="muted">{t("settings.perAccountDesc")}</p>
          {conn?.bindings?.map(a => <div className="row binding-row" key={a.id}>
            <strong>{a.name}</strong>
            <span className="cap">
              {a.broker === "ibkr" ? "IBKR" : "Webull AU"} ···· {a.suffix} · {a.authorized ? t("settings.bindingAuthSaved") : t("settings.bindingNeedsReauth")}
            </span>
            <span className="sp" />
            {a.broker === "ibkr" && (
              <button className="btn sm" onClick={() => setReauthorize(a)}>{t("settings.ibkrReauthBtn")}</button>
            )}
            {a.authorized && <>
              <button className="btn sm" onClick={() => onPage("imports", {broker:a.broker, account:a.id, sync:true})}>
                {t("settings.previewSyncBtn")}
              </button>
              <button className="btn sm" onClick={() => setDisconnect(a)}>
                {t("settings.disconnectAccountBtn")}
              </button>
            </>}
          </div>)}
          <p className="cap">{t("settings.genericConnNote")}</p>
        </Panel>
      )}
      {reauthorize && (
        <IbkrReauthorization
          binding={reauthorize}
          close={() => setReauthorize(null)}
          onSaved={() => {
            setReauthorize(null);
            run(async () => setConn(await api.connections()), t("settings.ibkrReauthSaved"));
          }}
        />
      )}
      {disconnect && <Modal title={t("settings.disconnectAccountTitle", { name: disconnect.name })} close={() => setDisconnect(null)}>
        <p>{t("settings.disconnectAccountDesc")}</p>
        <div className="acts"><button className="btn" onClick={() => setDisconnect(null)}>{t("app.cancel")}</button>
          <button className="btn pri" onClick={() => run(async () => {
            await api.disconnectAccount({id:disconnect.id}); setDisconnect(null); setConn(await api.connections());
          }, t("settings.accountDisconnected"))}>{t("settings.confirmDisconnect")}</button></div>
      </Modal>}
      {cols === 1 ? (
        <div className="stack">{keys.map((k) => <React.Fragment key={k}>{cards[k]}</React.Fragment>)}</div>
      ) : (
        <Grid layout={cardColumns(keys)} panels={cards} />
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
                  setConn(await api.connections());
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
