import { useEffect, useState } from "react";
import { parseManualCsv, snapshotToCsv } from "@/domain/etf";
import { Button, EmptyState, SectionHeader, StatusBadge, TableShell, formatPercent } from "@/components/ui";
import type { CsvPreview, EtfDataRow, EtfHoldingsSnapshot } from "@/types/domain";

export function EtfDataPage({
  etfData,
  onRefreshEtf,
  onSaveSnapshot,
  onDisableSnapshot,
}: {
  etfData: EtfDataRow[];
  onRefreshEtf: (etfKey: string) => Promise<void>;
  onSaveSnapshot: (snapshot: EtfHoldingsSnapshot, expectedVersion?: number) => Promise<void>;
  onDisableSnapshot: (etfKey: string) => Promise<void>;
}): JSX.Element {
  const [selectedKey, setSelectedKey] = useState(etfData[0]?.asset.etfKey ?? "");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = etfData.find((row) => row.asset.etfKey === selectedKey) ?? etfData[0] ?? null;

  useEffect(() => {
    if (!selected && etfData[0]) setSelectedKey(etfData[0].asset.etfKey);
  }, [etfData, selected]);

  const previewCsv = () => {
    if (!selected) return;
    const result = parseManualCsv(csv, {
      etfKey: selected.asset.etfKey,
      provider: "manual",
      asOfDate: new Date().toISOString().slice(0, 10),
      fetchedAt: new Date().toISOString(),
    });
    setPreview(result);
    setMessage(null);
  };

  const saveCsv = async () => {
    if (!selected || !preview?.validation.snapshot) return;
    setBusy(true);
    setMessage(null);
    try {
      await onSaveSnapshot(preview.validation.snapshot, selected.version);
      setMessage("Manual snapshot saved. It is now the pinned local source for this ETF.");
      setPreview(null);
      setCsv("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the snapshot");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      await onRefreshEtf(selected.asset.etfKey);
      setMessage("ETF data refreshed from the configured resolver.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ETF refresh failed; the last valid snapshot is still active.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!selected?.snapshot) return;
    const blob = new Blob([snapshotToCsv(selected.snapshot)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selected.asset.symbol.toLowerCase()}-holdings.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  };

  return <div className="page-stack">
    <SectionHeader eyebrow="Look-through sources" title="ETF Data" detail="Keep provider snapshots separate from current portfolio values. As-of date and fetched time are always distinct." action={<span className="data-source-pill">Local cache · 24 hr TTL</span>} />
    {!etfData.length ? <EmptyState icon="◫" title="No ETFs in the selected accounts" detail="ETF Data appears when Wealthfolio reports an ETF holding. Direct securities do not need constituent data." /> : <>
      <div className="panel table-panel">
        <div className="table-toolbar"><div><strong>{etfData.length} ETF{etfData.length === 1 ? "" : "s"}</strong><span>Refresh only missing or stale automatic snapshots.</span></div><span className="table-toolbar-note">Manual CSV paste works in self-hosted Web/Docker</span></div>
        <TableShell><thead><tr><th>ETF</th><th>Provider</th><th>Holdings</th><th>As of</th><th>Fetched</th><th>Resolved weight</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {etfData.map((row) => <tr className={selected?.asset.etfKey === row.asset.etfKey ? "row-selected" : ""} key={row.asset.etfKey} onClick={() => setSelectedKey(row.asset.etfKey)}><td><strong className="ticker-cell">{row.asset.symbol}</strong><span className="table-subtext">{row.asset.name}</span></td><td>{row.snapshot?.provider ?? "—"}</td><td>{row.snapshot ? row.snapshot.holdings.length : "—"}</td><td>{row.snapshot?.asOfDate ?? "—"}</td><td>{row.snapshot ? new Date(row.snapshot.fetchedAt).toLocaleString() : "—"}</td><td>{formatPercent(row.resolvedWeight)}</td><td><StatusBadge value={row.status} tone={statusTone(row.status)} /></td><td><div className="row-actions"><Button onClick={() => { setSelectedKey(row.asset.etfKey); void onRefreshEtf(row.asset.etfKey); }} variant="quiet">Refresh</Button><Button onClick={() => { setSelectedKey(row.asset.etfKey); }} variant="quiet">View</Button></div></td></tr>)}
        </tbody></TableShell>
      </div>
      {selected && <div className="etf-workspace">
        <div className="panel etf-detail-card"><div className="detail-heading"><div><span className="eyebrow">Selected ETF</span><h2>{selected.asset.symbol} <span>{selected.asset.name}</span></h2></div><div className="row-actions"><Button onClick={() => void refresh()} variant="secondary" disabled={busy}>↻ Refresh</Button>{selected.snapshot && <Button onClick={exportCsv} variant="quiet">Export CSV</Button>}{selected.snapshot && <Button onClick={() => { if (selected) void onDisableSnapshot(selected.asset.etfKey); }} variant="danger">Disable snapshot</Button>}</div></div>
          {selected.snapshot ? <div className="snapshot-meta"><div><span className="eyebrow">Provider</span><strong>{selected.snapshot.provider}</strong></div><div><span className="eyebrow">As of</span><strong>{selected.snapshot.asOfDate}</strong></div><div><span className="eyebrow">Fetched</span><strong>{new Date(selected.snapshot.fetchedAt).toLocaleString()}</strong></div><div><span className="eyebrow">Weight outcome</span><strong>{selected.snapshot.normalized ? "Normalized" : selected.snapshot.weightSum < 1 ? `${formatPercent(1 - selected.snapshot.weightSum)} residual` : "100% resolved"}</strong></div></div> : <div className="missing-inline"><StatusBadge value="Missing" tone="warning" /><span>No valid snapshot yet. Paste the issuer holdings CSV to preserve the ETF as an opaque exposure until resolved.</span></div>}
          {selected.snapshot && <div className="underlying-preview"><span className="eyebrow">Current constituents</span><div className="mini-constituents">{selected.snapshot.holdings.slice(0, 8).map((holding) => <div key={`${holding.symbol}-${holding.name}`}><span>{holding.symbol ?? "—"}</span><strong>{holding.name}</strong><em>{formatPercent(holding.weight)}</em></div>)}</div>{selected.snapshot.holdings.length > 8 && <span className="muted">+ {selected.snapshot.holdings.length - 8} more retained in the snapshot</span>}</div>}
        </div>
        <div className="panel csv-card"><div className="detail-heading"><div><span className="eyebrow">Universal fallback</span><h2>Import or paste CSV</h2><p>Required: <code>symbol</code> or <code>name</code>, plus <code>weight</code>. Fractional values, percentages, and bare percentages are previewed before saving.</p></div><label className="file-button">Choose file<input type="file" accept=".csv,text/csv" onChange={(event) => readFile(event.target.files?.[0])} /></label></div>
          <textarea value={csv} onChange={(event) => setCsv(event.target.value)} placeholder={'symbol,name,weight,isin,mic,country,currency,sector,assetClass\nNVDA,NVIDIA Corp,0.084,US67066G1040,XNAS,US,USD,Technology,Equity'} rows={8} />
          <div className="form-actions"><Button onClick={previewCsv} variant="secondary" disabled={!csv.trim()}>Preview</Button>{preview?.validation.accepted && <Button onClick={() => void saveCsv()} variant="primary" disabled={busy}>{busy ? "Saving…" : "Save Manual Snapshot"}</Button>}</div>
          {preview && <CsvPreviewCard preview={preview} />}
          {message && <div className="inline-message">{message}</div>}
        </div>
      </div>}
    </>}
  </div>;
}

function statusTone(status: EtfDataRow["status"]): "good" | "warning" | "critical" | "neutral" {
  if (status === "Fresh") return "good";
  if (status === "Critical" || status === "Invalid") return "critical";
  if (status === "Missing" || status === "Warning" || status === "Stale") return "warning";
  return "neutral";
}

function CsvPreviewCard({ preview }: { preview: CsvPreview }): JSX.Element {
  return <div className="csv-preview"><div className="preview-summary"><div><span className="eyebrow">Parsed rows</span><strong>{preview.rows.length}</strong></div><div><span className="eyebrow">Detected unit</span><strong>{preview.detectedUnit}</strong></div><div><span className="eyebrow">Weight sum</span><strong>{formatPercent(preview.weightSum)}</strong></div><div><span className="eyebrow">Outcome</span><StatusBadge value={preview.validation.status} tone={preview.validation.accepted ? "good" : "critical"} /></div></div>{preview.missingFields.length > 0 && <p className="preview-error">Missing columns: {preview.missingFields.join(", ")}</p>}{preview.issues.length > 0 && <p className="preview-warning">{preview.issues.join(" ")}</p>}{preview.validation.message && <p className={preview.validation.accepted ? "preview-note" : "preview-error"}>{preview.validation.message}</p>}<div className="preview-table"><table><thead><tr><th>Symbol</th><th>Name</th><th>Weight</th><th>Country</th><th>Sector</th></tr></thead><tbody>{preview.rows.slice(0, 12).map((row, index) => <tr key={`${row.symbol}-${row.name}-${index}`}><td>{row.symbol ?? "—"}</td><td>{row.name}</td><td>{formatPercent(row.weight)}</td><td>{row.country ?? "—"}</td><td>{row.sector ?? "—"}</td></tr>)}</tbody></table></div></div>;
}
