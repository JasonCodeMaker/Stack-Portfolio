import { useEffect, useMemo, useState } from "react";
import type { Account, AddonContext } from "@wealthfolio/addon-sdk";
import { fetchIbkrFlexReport, type IbkrFlexAudit } from "@/ibkrFlex";
import { fetchMockActivities } from "@/mockBroker";
import { resetImportedKeysForMappings, runSync, type BrokerSource } from "@/syncEngine";
import type { BrokerAccountMapping, BrokerId, SyncRunResult } from "@/types";
import {
  checkWebullToken,
  createWebullToken,
  fetchWebullReport,
  listWebullAccounts,
  type WebullAccount,
  type WebullAudit,
} from "@/webullOpenApi";
import { createWealthfolioHost } from "@/wealthfolioHost";

const EMPTY_MAPPING: BrokerAccountMapping = { ibkr: "", webull: "" };
const IBKR_QUERY_STORAGE = "ibkr.flex-query-id";
const IBKR_TOKEN_SECRET = "ibkr.flex-token";
const WEBULL_APP_KEY_STORAGE = "webull.app-key";
const WEBULL_ACCOUNT_STORAGE = "webull.api-account-id";
const WEBULL_APP_SECRET = "webull.app-secret";
const WEBULL_ACCESS_TOKEN = "webull.access-token";

function guessMapping(accounts: Account[]): BrokerAccountMapping {
  return {
    ibkr: accounts.find((account) => /ibkr|interactive brokers/i.test(account.name))?.id ?? "",
    webull: accounts.find((account) => /webull/i.test(account.name))?.id ?? "",
  };
}

export function BrokerSyncApp({ ctx }: { ctx: AddonContext }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mapping, setMapping] = useState<BrokerAccountMapping>(EMPTY_MAPPING);
  const [dryRun, setDryRun] = useState(true);
  const [mode, setMode] = useState<"live" | "mock">("live");
  const [ibkrQueryId, setIbkrQueryId] = useState("");
  const [ibkrTokenInput, setIbkrTokenInput] = useState("");
  const [ibkrTokenSaved, setIbkrTokenSaved] = useState(false);
  const [webullAppKey, setWebullAppKey] = useState("");
  const [webullAppSecretInput, setWebullAppSecretInput] = useState("");
  const [webullAppSecretSaved, setWebullAppSecretSaved] = useState(false);
  const [webullTokenSaved, setWebullTokenSaved] = useState(false);
  const [webullTokenStatus, setWebullTokenStatus] = useState<string>("");
  const [webullAccounts, setWebullAccounts] = useState<WebullAccount[]>([]);
  const [webullApiAccountId, setWebullApiAccountId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncRunResult | null>(null);
  const [ibkrAudit, setIbkrAudit] = useState<IbkrFlexAudit | null>(null);
  const [webullAudit, setWebullAudit] = useState<WebullAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mockSource = useMemo(() => ({ fetch: fetchMockActivities }), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      ctx.api.accounts.getAll(),
      ctx.api.storage.get(IBKR_QUERY_STORAGE),
      ctx.api.secrets.get(IBKR_TOKEN_SECRET),
      ctx.api.storage.get(WEBULL_APP_KEY_STORAGE),
      ctx.api.storage.get(WEBULL_ACCOUNT_STORAGE),
      ctx.api.secrets.get(WEBULL_APP_SECRET),
      ctx.api.secrets.get(WEBULL_ACCESS_TOKEN),
    ]).then(([loaded, queryId, token, appKey, apiAccountId, appSecret, accessToken]) => {
      if (!active) return;
      const eligible = loaded.filter((account) => account.isActive && !account.isArchived && account.trackingMode === "TRANSACTIONS");
      setAccounts(eligible);
      setMapping(guessMapping(eligible));
      setIbkrQueryId(queryId ?? "");
      setIbkrTokenSaved(Boolean(token));
      setWebullAppKey(appKey ?? "");
      setWebullApiAccountId(apiAccountId ?? "");
      setWebullAppSecretSaved(Boolean(appSecret));
      setWebullTokenSaved(Boolean(accessToken));
      setWebullTokenStatus(accessToken ? "Saved — check connection" : "");
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load Broker Sync settings"));
    return () => { active = false; };
  }, [ctx]);

  async function syncNow() {
    setRunning(true);
    setError(null);
    setResult(null);
    setIbkrAudit(null);
    setWebullAudit(null);
    try {
      let source: BrokerSource = mockSource;
      let activeMapping = mapping;
      let latestIbkrAudit: IbkrFlexAudit | null = null;
      let latestWebullAudit: WebullAudit | null = null;
      if (mode === "live") {
        const [ibkrToken, webullAppSecret, webullAccessToken] = await Promise.all([
          ctx.api.secrets.get(IBKR_TOKEN_SECRET),
          ctx.api.secrets.get(WEBULL_APP_SECRET),
          ctx.api.secrets.get(WEBULL_ACCESS_TOKEN),
        ]);
        const ibkrReady = Boolean(mapping.ibkr && ibkrQueryId.trim() && ibkrToken);
        const webullReady = Boolean(mapping.webull && webullAppKey.trim() && webullAppSecret && webullAccessToken && webullApiAccountId);
        if (!ibkrReady && !webullReady) throw new Error("Configure and map at least one live broker before syncing.");
        source = { fetch: async (broker) => {
          if (broker === "ibkr" && ibkrReady && ibkrToken) {
            const report = await fetchIbkrFlexReport(ctx.api.network, { queryId: ibkrQueryId, token: ibkrToken });
            latestIbkrAudit = report.audit;
            return report.activities;
          }
          if (broker === "webull" && webullReady && webullAppSecret && webullAccessToken) {
            const report = await fetchWebullReport(ctx.api.network, {
              appKey: webullAppKey,
              appSecret: webullAppSecret,
              accessToken: webullAccessToken,
              accountId: webullApiAccountId,
            });
            latestWebullAudit = report.audit;
            return report.activities;
          }
          return [];
        } };
        activeMapping = { ibkr: ibkrReady ? mapping.ibkr : "", webull: webullReady ? mapping.webull : "" };
      }
      const next = await runSync(source, createWealthfolioHost(ctx), activeMapping, dryRun);
      setResult(next);
      setIbkrAudit(latestIbkrAudit);
      setWebullAudit(latestWebullAudit);
      if (!dryRun && (next.imported > 0 || next.updated > 0)) {
        ctx.api.toast.success(`Imported ${next.imported}; repaired ${next.updated} existing activities`);
      }
      if (next.failed > 0) ctx.api.toast.error(`${next.failed} activities failed to save`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Broker sync failed";
      setError(message);
      ctx.api.toast.error(message);
    } finally {
      setRunning(false);
    }
  }

  async function resetSyncHistory() {
    const activeMapping = mapping;
    if (!window.confirm("Reset Broker Sync history for the selected account? Existing Wealthfolio activities will not be deleted.")) return;

    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const removed = await resetImportedKeysForMappings(createWealthfolioHost(ctx), activeMapping);
      ctx.api.toast.success(removed > 0
        ? `Reset ${removed} imported-record markers for the selected account`
        : "No Broker Sync history was stored for the selected account");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to reset Broker Sync history";
      setError(message);
      ctx.api.toast.error(message);
    } finally {
      setRunning(false);
    }
  }

  async function saveIbkrSettings() {
    const queryId = ibkrQueryId.trim();
    if (!queryId) return setError("IBKR Flex Query ID is required.");
    if (!ibkrTokenSaved && !ibkrTokenInput.trim()) return setError("IBKR Flex token is required.");
    setError(null);
    await ctx.api.storage.set(IBKR_QUERY_STORAGE, queryId);
    if (ibkrTokenInput.trim()) await ctx.api.secrets.set(IBKR_TOKEN_SECRET, ibkrTokenInput.trim());
    setIbkrTokenInput("");
    setIbkrTokenSaved(true);
    ctx.api.toast.success("IBKR Flex settings saved securely");
  }

  async function clearIbkrSettings() {
    await Promise.all([ctx.api.storage.delete(IBKR_QUERY_STORAGE), ctx.api.secrets.delete(IBKR_TOKEN_SECRET)]);
    setIbkrQueryId("");
    setIbkrTokenInput("");
    setIbkrTokenSaved(false);
  }

  async function saveWebullCredentials(): Promise<{ appKey: string; appSecret: string }> {
    const appKey = webullAppKey.trim();
    const savedSecret = await ctx.api.secrets.get(WEBULL_APP_SECRET);
    const appSecret = webullAppSecretInput.trim() || savedSecret || "";
    if (!appKey) throw new Error("Webull App Key is required.");
    if (!appSecret) throw new Error("Webull App Secret is required.");
    await ctx.api.storage.set(WEBULL_APP_KEY_STORAGE, appKey);
    if (webullAppSecretInput.trim()) await ctx.api.secrets.set(WEBULL_APP_SECRET, webullAppSecretInput.trim());
    setWebullAppSecretInput("");
    setWebullAppSecretSaved(true);
    return { appKey, appSecret };
  }

  async function connectWebull() {
    setRunning(true);
    setError(null);
    try {
      const credentials = await saveWebullCredentials();
      let token = await ctx.api.secrets.get(WEBULL_ACCESS_TOKEN);
      let tokenResult = token
        ? await checkWebullToken(ctx.api.network, credentials, token)
        : await createWebullToken(ctx.api.network, credentials);
      if (tokenResult.status === "INVALID" || tokenResult.status === "EXPIRED") {
        tokenResult = await createWebullToken(ctx.api.network, credentials);
      }
      token = tokenResult.token;
      await ctx.api.secrets.set(WEBULL_ACCESS_TOKEN, token);
      setWebullTokenSaved(true);
      setWebullTokenStatus(tokenResult.status);
      if (tokenResult.status === "PENDING") {
        ctx.api.toast.success("Webull verification requested. Approve it in the Webull app, then click Check verification.");
        return;
      }
      if (tokenResult.status !== "NORMAL") throw new Error(`Webull token status is ${tokenResult.status}.`);
      const loadedAccounts = await listWebullAccounts(ctx.api.network, { ...credentials, accessToken: token });
      if (loadedAccounts.length === 0) throw new Error("Webull connected, but no OpenAPI trading account was returned.");
      setWebullAccounts(loadedAccounts);
      const selected = loadedAccounts.some((account) => account.accountId === webullApiAccountId)
        ? webullApiAccountId
        : loadedAccounts[0].accountId;
      setWebullApiAccountId(selected);
      await ctx.api.storage.set(WEBULL_ACCOUNT_STORAGE, selected);
      ctx.api.toast.success("Webull OpenAPI connected");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to connect Webull";
      setError(message);
      ctx.api.toast.error(message);
    } finally {
      setRunning(false);
    }
  }

  async function selectWebullApiAccount(accountId: string) {
    setWebullApiAccountId(accountId);
    if (accountId) await ctx.api.storage.set(WEBULL_ACCOUNT_STORAGE, accountId);
    else await ctx.api.storage.delete(WEBULL_ACCOUNT_STORAGE);
  }

  async function clearWebullSettings() {
    await Promise.all([
      ctx.api.storage.delete(WEBULL_APP_KEY_STORAGE),
      ctx.api.storage.delete(WEBULL_ACCOUNT_STORAGE),
      ctx.api.secrets.delete(WEBULL_APP_SECRET),
      ctx.api.secrets.delete(WEBULL_ACCESS_TOKEN),
    ]);
    setWebullAppKey("");
    setWebullAppSecretInput("");
    setWebullAppSecretSaved(false);
    setWebullTokenSaved(false);
    setWebullTokenStatus("");
    setWebullAccounts([]);
    setWebullApiAccountId("");
  }

  function accountSelect(broker: BrokerId, label: string) {
    return <label className="bs-field">
      <span>{label}</span>
      <select value={mapping[broker]} onChange={(event) => setMapping((current) => ({ ...current, [broker]: event.target.value }))}>
        <option value="">Do not sync</option>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}
      </select>
    </label>;
  }

  const canRun = (mode === "live"
    ? Boolean(
      (mapping.ibkr && ibkrQueryId.trim() && ibkrTokenSaved)
      || (mapping.webull && webullAppKey.trim() && webullAppSecretSaved && webullTokenSaved && webullApiAccountId),
    )
    : Boolean(mapping.ibkr || mapping.webull)) && !running;
  const canReset = Boolean(mapping.ibkr || mapping.webull) && !running;
  const liveLabel = [
    mapping.ibkr && ibkrQueryId.trim() && ibkrTokenSaved ? "IBKR" : "",
    mapping.webull && webullTokenSaved && webullApiAccountId ? "Webull" : "",
  ].filter(Boolean).join(" + ") || "broker";
  return <main className="bs-shell">
    <section className="bs-card bs-hero">
      <div>
        <p className="bs-kicker">Broker data phase</p>
        <h1>Broker Sync</h1>
        <p>Manual, on-demand synchronization using the official IBKR Flex and Webull Australia OpenAPI services.</p>
      </div>
      <span className="bs-badge">{mode === "live" ? "Live mode" : "Mock mode"}</span>
    </section>

    <section className="bs-card">
      <h2>Data source</h2>
      <label className="bs-field bs-mode"><span>Mode</span><select value={mode} onChange={(event) => setMode(event.target.value as "live" | "mock")}>
        <option value="live">Real broker data</option><option value="mock">Deterministic mock data</option>
      </select></label>
    </section>

    {mode === "live" && <section className="bs-card">
      <h2>IBKR Flex</h2>
      <p className="bs-muted">The token is stored in Wealthfolio's system keyring and is never displayed again. Configure the Flex Query timezone as UTC.</p>
      <div className="bs-grid">
        <label className="bs-field"><span>Flex Query ID</span><input value={ibkrQueryId} onChange={(event) => setIbkrQueryId(event.target.value)} placeholder="e.g. 1234567" /></label>
        <label className="bs-field"><span>Flex token {ibkrTokenSaved ? "(saved)" : ""}</span><input type="password" value={ibkrTokenInput} onChange={(event) => setIbkrTokenInput(event.target.value)} placeholder={ibkrTokenSaved ? "Leave blank to keep saved token" : "Paste token locally"} /></label>
      </div>
      <div className="bs-actions">
        <button className="bs-button" onClick={() => void saveIbkrSettings()}>Save IBKR settings</button>
        {ibkrTokenSaved && <button className="bs-button bs-secondary" onClick={() => void clearIbkrSettings()}>Clear credentials</button>}
      </div>
    </section>}

    {mode === "live" && <section className="bs-card">
      <h2>Webull Australia OpenAPI</h2>
      <p className="bs-muted">App Secret and access token are stored in Wealthfolio's system keyring. They are used only to sign requests to api.webull.com.au.</p>
      <div className="bs-grid">
        <label className="bs-field"><span>App Key</span><input value={webullAppKey} onChange={(event) => setWebullAppKey(event.target.value)} placeholder="Paste locally" /></label>
        <label className="bs-field"><span>App Secret {webullAppSecretSaved ? "(saved)" : ""}</span><input type="password" value={webullAppSecretInput} onChange={(event) => setWebullAppSecretInput(event.target.value)} placeholder={webullAppSecretSaved ? "Leave blank to keep saved secret" : "Paste locally"} /></label>
      </div>
      <div className="bs-actions">
        <button className="bs-button" disabled={running} onClick={() => void connectWebull()}>{webullTokenSaved ? "Check verification / connection" : "Start Webull verification"}</button>
        {webullAppSecretSaved && <button className="bs-button bs-secondary" disabled={running} onClick={() => void clearWebullSettings()}>Clear Webull credentials</button>}
      </div>
      {webullTokenStatus && <p className="bs-muted">Token status: {webullTokenStatus}</p>}
      {webullTokenStatus === "PENDING" && <p className="bs-warning">In the Webull app, open Menu → Messages → OpenAPI Notifications → Check Now, complete SMS verification within 5 minutes, then click the button again.</p>}
      {(webullAccounts.length > 0 || webullApiAccountId) && <label className="bs-field"><span>Webull OpenAPI account</span><select value={webullApiAccountId} onChange={(event) => void selectWebullApiAccount(event.target.value)}>
        {webullAccounts.length === 0 && <option value={webullApiAccountId}>{webullApiAccountId} (saved)</option>}
        {webullAccounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.accountNumber}{account.accountType ? ` (${account.accountType})` : ""}</option>)}
      </select></label>}
      <p className="bs-warning">Sync imports every completed stock/ETF order and cash activity Webull returns across the API's maximum six-month history. Webull Australia does not guarantee the cash endpoint, so a missing or empty cash ledger is reported as a warning while all other available records continue to import.</p>
    </section>}

    <section className="bs-card">
      <h2>Account mapping</h2>
      <p className="bs-muted">Only active Wealthfolio accounts using Transactions tracking are shown.</p>
      <div className="bs-grid">
        {accountSelect("ibkr", "IBKR")}
        {accountSelect("webull", "Webull Australia")}
      </div>
      {accounts.length === 0 && <p className="bs-warning">Create an active Transactions account in Wealthfolio before testing.</p>}
    </section>

    <section className="bs-card">
      <label className="bs-toggle">
        <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
        <span><strong>Dry Run</strong><small>Validate and preview without writing activities.</small></span>
      </label>
      <div className="bs-actions">
        <button className="bs-button" disabled={!canRun} onClick={() => void syncNow()}>
          {running ? "Working…" : dryRun ? `Preview ${mode === "live" ? liveLabel : "mock"} update` : `Import ${mode === "live" ? liveLabel : "mock"} update`}
        </button>
        <button className="bs-button bs-secondary" disabled={!canReset} onClick={() => void resetSyncHistory()}>
          Reset selected account sync history
        </button>
      </div>
      <p className="bs-muted">Reset clears this add-on's imported-record markers only. It does not delete Wealthfolio activities.</p>
    </section>

    {error && <section className="bs-card bs-error"><strong>Sync failed</strong><p>{error}</p></section>}
    {ibkrAudit && <section className="bs-card">
      <h2>IBKR statement checks</h2>
      <p className="bs-muted">
        Detected {ibkrAudit.fxExecutions} FX executions and {ibkrAudit.openPositions} open positions
        {ibkrAudit.period ? ` from ${ibkrAudit.period.from} to ${ibkrAudit.period.to}` : ""}.
      </p>
      {(ibkrAudit.baseCurrency || ibkrAudit.accountCapabilities) && <p className="bs-muted">
        Account: {ibkrAudit.baseCurrency ?? "unknown base currency"}{ibkrAudit.accountCapabilities ? ` · ${ibkrAudit.accountCapabilities}` : ""}.
      </p>}
      {Object.keys(ibkrAudit.endingCashByCurrency).length > 0 && <p className="bs-muted">
        IBKR ending cash: {Object.entries(ibkrAudit.endingCashByCurrency).map(([currency, amount]) => `${currency} ${amount}`).join("; ")}.
      </p>}
      {Object.keys(ibkrAudit.openPositionValueByCurrency).length > 0 && <p className="bs-muted">
        IBKR marked positions: {Object.entries(ibkrAudit.openPositionValueByCurrency).map(([currency, amount]) => `${currency} ${amount}`).join("; ")}.
      </p>}
      {ibkrAudit.reportedNavBase !== undefined && <p className="bs-muted">
        IBKR ending NAV: {ibkrAudit.baseCurrency ?? "base currency"} {ibkrAudit.reportedNavBase}.
      </p>}
      {ibkrAudit.warnings.map((warning) => <p className="bs-warning" key={warning}>{warning}</p>)}
    </section>}
    {webullAudit && <section className="bs-card">
      <h2>Webull statement checks</h2>
      <p className="bs-muted">
        Read {webullAudit.orders} filled orders and {webullAudit.cashActivities} cash activities from the latest six-month window.
      </p>
      {webullAudit.warnings.map((warning) => <p className="bs-warning" key={warning}>{warning}</p>)}
    </section>}
    {result && <section className="bs-card">
      <h2>{result.dryRun ? "Preview result" : "Import result"}</h2>
      <div className="bs-stats">
        <div><strong>{result.fetched}</strong><span>Fetched</span></div>
        <div><strong>{result.alreadyImported}</strong><span>Previously imported</span></div>
        <div><strong>{result.valid}</strong><span>Ready</span></div>
        <div><strong>{result.invalid}</strong><span>Invalid</span></div>
        <div><strong>{result.duplicates}</strong><span>Wealthfolio duplicates</span></div>
        <div><strong>{result.imported}</strong><span>Imported</span></div>
        <div><strong>{result.updated}</strong><span>Repaired</span></div>
        <div><strong>{result.failed}</strong><span>Failed</span></div>
      </div>
      {result.errors.map((message, index) => <p className="bs-warning" key={`${index}:${message}`}>{message}</p>)}
      {result.dryRun && (result.valid > 0 || result.duplicates > 0) && <p className="bs-muted">Turn off Dry Run to import new records and repair matching existing activities with the latest broker asset mapping.</p>}
    </section>}
  </main>;
}
