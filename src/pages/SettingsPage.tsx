import { useEffect, useState } from "react";
import { Button, SectionHeader, StatusBadge, Toggle } from "@/components/ui";
import type { AddonSettings, AssetType, EtfDataRow, NormalizedHolding, PortfolioAccount } from "@/types/domain";

const typeOptions: AssetType[] = ["stock", "etf", "cash", "fixed-income", "derivative", "other", "unknown"];

export function SettingsPage({
  activeAccounts,
  selectedAccounts,
  settings,
  holdings,
  etfData,
  hasTwelveDataKey,
  hasAlphaVantageKey,
  onSaveAccountSelection,
  onSaveSecret,
  onDeleteSecret,
  onSetLiveFxPolling,
  onSetTypeOverride,
  onSetProviderMode,
  onSetPinnedProvider,
}: {
  activeAccounts: PortfolioAccount[];
  selectedAccounts: PortfolioAccount[];
  settings: AddonSettings;
  holdings: NormalizedHolding[];
  etfData: EtfDataRow[];
  hasTwelveDataKey: boolean;
  hasAlphaVantageKey: boolean;
  onSaveAccountSelection: (accountIds: string[]) => Promise<void>;
  onSaveSecret: (key: string, value: string) => Promise<void>;
  onDeleteSecret: (key: string) => Promise<void>;
  onSetLiveFxPolling: (enabled: boolean) => Promise<void>;
  onSetTypeOverride: (key: string, type: AssetType) => Promise<void>;
  onSetProviderMode: (key: string, mode: "auto" | "pinned") => Promise<void>;
  onSetPinnedProvider: (key: string, provider: string) => Promise<void>;
}): JSX.Element {
  const [selectedIds, setSelectedIds] = useState(selectedAccounts.map((account) => account.id));
  const [twelveDataKey, setTwelveDataKey] = useState("");
  const [alphaVantageKey, setAlphaVantageKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setSelectedIds(selectedAccounts.map((account) => account.id)), [selectedAccounts]);

  const saveAccounts = async () => {
    await onSaveAccountSelection(selectedIds);
    setMessage("Account selection saved.");
  };
  const saveSecret = async (key: string, value: string, label: string) => {
    await onSaveSecret(key, value);
    setMessage(`${label} key saved securely through Wealthfolio.`);
    if (key.includes("twelvedata")) setTwelveDataKey("");
    else setAlphaVantageKey("");
  };
  const removeSecret = async (key: string, label: string) => {
    await onDeleteSecret(key);
    setMessage(`${label} key removed.`);
  };

  const overrideRows = holdings.filter((holding) => holding.status === "unknown-instrument" || holding.type === "unknown");
  return <div className="page-stack">
    <SectionHeader eyebrow="Addon-owned preferences" title="Settings" detail="Only Portfolio X-Ray configuration lives here. Wealthfolio remains the source of truth for accounts, holdings, prices, and performance." />
    <div className="settings-grid">
      <section className="panel settings-card"><div className="settings-heading"><div className="settings-icon">◎</div><div><h2>Included accounts</h2><p>New active accounts are included once. Explicit deselections remain deselected.</p></div></div><div className="account-select-list">{activeAccounts.length === 0 ? <p className="muted">No active Wealthfolio accounts found.</p> : activeAccounts.map((account) => <label className="account-select" key={account.id}><input type="checkbox" checked={selectedIds.includes(account.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} /><span className="account-avatar">{account.name.slice(0, 1).toUpperCase()}</span><span><strong>{account.name}</strong><em>{account.currency} · {account.isActive ? "Active" : "Inactive"}</em></span><span className="checkmark">✓</span></label>)}</div><div className="form-actions"><Button onClick={() => void saveAccounts()} variant="primary">Save account selection</Button></div></section>
      <section className="panel settings-card"><div className="settings-heading"><div className="settings-icon">↗</div><div><h2>Live USD / AUD</h2><p>Refresh while Portfolio X-Ray is visible. The quote is shared through addon storage for five-minute reuse.</p></div></div><Toggle checked={settings.liveFxPolling} onChange={(enabled) => void onSetLiveFxPolling(enabled)} label="Enable visible-page polling" /><div className="privacy-note"><span className="pulse-dot" /><div><strong>Provider-safe request</strong><p>External requests include only USD/AUD and provider authentication — never account, quantity, value, cost basis, or transaction data.</p></div></div></section>
      <section className="panel settings-card"><div className="settings-heading"><div className="settings-icon">⌘</div><div><h2>Provider keys</h2><p>Optional keys are stored through <code>ctx.api.secrets</code>. Missing keys never block cached or Manual CSV data.</p></div></div><SecretField label="Twelve Data" hasKey={hasTwelveDataKey} value={twelveDataKey} onChange={setTwelveDataKey} onSave={() => void saveSecret("twelvedata.apiKey", twelveDataKey, "Twelve Data")} onRemove={() => void removeSecret("twelvedata.apiKey", "Twelve Data")} /><SecretField label="Alpha Vantage" hasKey={hasAlphaVantageKey} value={alphaVantageKey} onChange={setAlphaVantageKey} onSave={() => void saveSecret("alphaVantage.apiKey", alphaVantageKey, "Alpha Vantage")} onRemove={() => void removeSecret("alphaVantage.apiKey", "Alpha Vantage")} /></section>
      <section className="panel settings-card"><div className="settings-heading"><div className="settings-icon">◫</div><div><h2>ETF provider modes</h2><p>Auto follows cache → issuer → Alpha Vantage → Manual. Pinned mode never silently changes source.</p></div></div>{etfData.length === 0 ? <p className="muted">ETF provider controls appear when ETFs are held.</p> : <div className="provider-list">{etfData.map((row) => <div className="provider-row" key={row.asset.etfKey}><div><strong>{row.asset.symbol}</strong><span>{row.snapshot?.provider ?? "No snapshot"}</span></div><select value={settings.providerModes[row.asset.etfKey] ?? "auto"} onChange={(event) => void onSetProviderMode(row.asset.etfKey, event.target.value as "auto" | "pinned")}><option value="auto">Auto</option><option value="pinned">Pinned</option></select>{(settings.providerModes[row.asset.etfKey] ?? "auto") === "pinned" && <select value={settings.pinnedProviders[row.asset.etfKey] ?? "alpha-vantage"} onChange={(event) => void onSetPinnedProvider(row.asset.etfKey, event.target.value)}><option value="ishares">iShares</option><option value="betashares">Betashares</option><option value="alpha-vantage">Alpha Vantage</option></select>}<StatusBadge value={row.status} tone={row.status === "Fresh" ? "good" : "warning"} /></div>)}</div>}</section>
      <section className="panel settings-card"><div className="settings-heading"><div className="settings-icon">⌁</div><div><h2>Type overrides</h2><p>Use a local override when an instrument profile is unresolved. Overrides affect only X-Ray classification.</p></div></div>{overrideRows.length === 0 ? <p className="muted">All current instrument types are resolved.</p> : <div className="override-list">{overrideRows.map((holding) => <div className="override-row" key={holding.id}><div><strong>{holding.ticker}</strong><span>{holding.name} · {holding.identityKey ?? holding.id}</span></div><select value={settings.typeOverrides[holding.profileId ?? holding.identityKey ?? holding.id] ?? holding.type} onChange={(event) => void onSetTypeOverride(holding.profileId ?? holding.identityKey ?? holding.id, event.target.value as AssetType)}>{typeOptions.map((type) => <option value={type} key={type}>{type}</option>)}</select></div>)}</div>}</section>
    </div>
    {message && <div className="inline-message">{message}</div>}
    <div className="settings-footer"><StatusBadge value="Local-first" tone="good" /><span>Settings, aliases, Manual datasets, and valid ETF caches are persisted through Wealthfolio addon storage. Secrets never enter JSON, localStorage, or source code.</span></div>
  </div>;
}

function SecretField({ label, hasKey, value, onChange, onSave, onRemove }: { label: string; hasKey: boolean; value: string; onChange: (value: string) => void; onSave: () => void; onRemove: () => void }): JSX.Element {
  return <div className="secret-field"><label><span>{label}</span><span className={hasKey ? "secret-status secret-set" : "secret-status"}>{hasKey ? "Configured" : "Not configured"}</span></label><div className="secret-input-row"><input type="password" value={value} onChange={(event) => onChange(event.target.value)} placeholder={hasKey ? "Enter a new key to replace" : "Paste optional API key"} autoComplete="off" /><Button onClick={onSave} variant="secondary" disabled={!value.trim()}>Save</Button>{hasKey && <Button onClick={onRemove} variant="quiet">Remove</Button>}</div></div>;
}
