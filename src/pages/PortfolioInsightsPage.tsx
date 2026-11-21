import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Input,
  Page,
  PageContent,
  PageHeader,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@wealthfolio/ui";
import { buildComposition, buildPlanRows, type CompositionSlice } from "@/domain/composition";
import { buildRebalanceModel } from "@/domain/rebalance";
import { buildBreakdownNodes, buildCoreSatelliteAllocation, concentrationOf } from "@/domain/visualization";
import {
  CardHead,
  CompositionCard,
  DIRECT_COLOR,
  ExposureCard,
  fundSymbols,
  moveLabel,
  TargetDots,
  VIA_FUNDS_COLOR,
  type ExposureRowData,
} from "@/components/portfolioVisualizations";
import type {
  AllocationRow,
  EtfDataRow,
  ExposureModel,
  ExposureSource,
  PortfolioAccount,
  PortfolioModel,
  RebalanceSettings,
} from "@/types/domain";

interface Props {
  portfolio: PortfolioModel;
  exposure: ExposureModel;
  activeAccounts: PortfolioAccount[];
  selectedAccounts: PortfolioAccount[];
  etfData: EtfDataRow[];
  rebalanceSettings: RebalanceSettings;
  onSaveRebalance: (settings: RebalanceSettings) => Promise<void>;
  onSaveAccountSelection: (accountIds: string[]) => Promise<void>;
  onRefresh: () => Promise<void>;
  onRefreshEtf: (etfKey: string) => Promise<void>;
}

/** Companies named individually in the composition; the rest fold into "Other companies". */
const NAMED_COMPANIES = 12;

const currency = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("en-AU", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : percent.format(value));

export function PortfolioInsightsPage(props: Props): JSX.Element {
  const [targetOpen, setTargetOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [selected, setSelected] = useState<CompositionSlice | null>(null);
  const { portfolio, exposure } = props;
  const total = portfolio.totalAud;

  const composition = useMemo(() => buildComposition(exposure, NAMED_COMPANIES), [exposure]);
  const coreSatellite = useMemo(() => buildCoreSatelliteAllocation(portfolio.instrumentAllocation, total), [portfolio.instrumentAllocation, total]);
  const rebalance = useMemo(() => buildRebalanceModel(coreSatellite, total, props.rebalanceSettings), [coreSatellite, total, props.rebalanceSettings]);
  const plan = useMemo(() => buildPlanRows(rebalance, portfolio.instrumentAllocation), [rebalance, portfolio.instrumentAllocation]);
  const exposureRows = useMemo((): ExposureRowData[] => ([
    { lens: "sectors", label: "Sectors", note: "Look-through" },
    { lens: "countries", label: "Countries", note: "Look-through" },
    { lens: "assets", label: "Asset classes", note: "Look-through" },
    { lens: "accounts", label: "Accounts", note: "As purchased" },
    { lens: "currencies", label: "Currency", note: "As purchased" },
  ] as const).map((row) => ({ ...row, nodes: buildBreakdownNodes(row.lens, portfolio.instrumentAllocation, portfolio.holdings, exposure, total) })), [portfolio, exposure, total]);

  const cashAud = portfolio.instrumentAllocation.filter((row) => row.type === "cash").reduce((sum, row) => sum + row.valueAud, 0);
  const investedAud = total === null ? null : total - cashAud;
  const unresolvedEtfs = props.etfData.filter((row) => row.status !== "Fresh");
  const unresolvedAud = composition.find((slice) => slice.kind === "unresolved")?.valueAud ?? 0;
  const moves = plan.filter((row) => row.status === "overweight" || row.status === "underweight").sort((a, b) => Math.abs(b.adjustmentAud ?? 0) - Math.abs(a.adjustmentAud ?? 0));
  const hasHoldings = portfolio.instrumentAllocation.length > 0;

  return <Page className="portfolio-insights">
    <PageHeader
      heading="Allocation"
      text="What you own, what it's made of, and how it compares with your plan."
      actions={<div className="pi-header-actions">
        <Button variant="outline" onClick={() => setAccountsOpen(true)}>{accountLabel(props.selectedAccounts)}</Button>
        <Button variant="outline" onClick={() => void props.onRefresh()}>Refresh</Button>
      </div>}
    />
    <PageContent className="pi-content">
      <Card className="pi-strip">
        <Stat label="Portfolio value" value={total === null ? "—" : currency.format(total)} detail={`${portfolio.instrumentAllocation.length} holdings · ${props.selectedAccounts.length} ${props.selectedAccounts.length === 1 ? "account" : "accounts"}`} />
        <Stat label="Invested" value={investedAud === null ? "—" : currency.format(investedAud)} detail={pct(total ? (investedAud ?? 0) / total : null)} />
        <Stat label="Cash" value={total === null ? "—" : currency.format(cashAud)} detail={pct(total ? cashAud / total : null)} />
        <Stat label="Look-through coverage" value={pct(exposure.coverage)} detail={unresolvedEtfs.length ? `${symbols(unresolvedEtfs)} not looked through` : portfolio.etfs.length ? "All funds looked through" : "No funds to look through"} />
      </Card>

      {portfolio.warnings.length > 0
        ? <Alert variant="warning" className="pi-alert"><AlertTitle>Allocation cannot be fully calculated yet</AlertTitle><AlertDescription>{plainWarning(portfolio)} <Button variant="link" size="sm" onClick={() => setDataOpen(true)}>Fix data</Button></AlertDescription></Alert>
        : unresolvedEtfs.length > 0 && <Alert variant="warning" className="pi-alert"><AlertDescription><strong>{symbols(unresolvedEtfs)}</strong> can't be looked through yet, so {pct(total ? unresolvedAud / total : null)} of your portfolio is hatched below. <Button variant="link" size="sm" onClick={() => setDataOpen(true)}>Fix data</Button></AlertDescription></Alert>}

      {!hasHoldings ? <Card className="pi-card"><EmptyData /></Card> : <>
        <Answers composition={composition} exposure={exposure} rebalance={{ configured: rebalance.configured, tolerance: rebalance.tolerance }} moves={moves} onSetTargets={() => setTargetOpen(true)} />
        <CompositionCard slices={composition} allocation={portfolio.instrumentAllocation} otherCompaniesLimit={NAMED_COMPANIES} onSelect={setSelected} />
        <ExposureCard rows={exposureRows} />
        <Card className="pi-card">
          <CardHead
            title="Holdings vs. target"
            detail={rebalance.configured ? <><span className="pi-dot-key" /> current · <span className="pi-target-key" /> target · shaded = allowed drift (±{pct(rebalance.tolerance)})</> : "Each ETF has its own target; individual stocks and cash are grouped."}
            action={rebalance.configured ? <Button size="sm" variant="outline" onClick={() => setTargetOpen(true)}>Edit targets</Button> : undefined}
          />
          {rebalance.configured
            ? <TargetDots rows={plan} tolerance={rebalance.tolerance} />
            : <div className="pi-empty pi-empty-action"><strong>Set your core–satellite targets first</strong><p>Set a target for each ETF, Individual stocks as one group, and Cash as one group.</p><Button onClick={() => setTargetOpen(true)}>Set targets</Button></div>}
        </Card>
      </>}
    </PageContent>

    <TargetSheet open={targetOpen} onOpenChange={setTargetOpen} allocation={coreSatellite} settings={props.rebalanceSettings} onSave={props.onSaveRebalance} />
    <AccountSheet open={accountsOpen} onOpenChange={setAccountsOpen} accounts={props.activeAccounts} selected={props.selectedAccounts} onSave={props.onSaveAccountSelection} />
    <DataSheet open={dataOpen} onOpenChange={setDataOpen} etfs={props.etfData} warnings={portfolio.warnings.map((warning) => warning.detail)} onRefreshEtf={props.onRefreshEtf} />
    <SourceSheet slice={selected} etfData={props.etfData} onOpenChange={(open) => { if (!open) setSelected(null); }} />
  </Page>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return <div className="pi-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Answers({ composition, exposure, rebalance, moves, onSetTargets }: {
  composition: CompositionSlice[];
  exposure: ExposureModel;
  rebalance: { configured: boolean; tolerance: number };
  moves: ReturnType<typeof buildPlanRows>;
  onSetTargets: () => void;
}): JSX.Element {
  const companies = composition.filter((slice) => slice.kind === "company");
  const biggest = companies[0];
  const concentration = concentrationOf(companies);
  const companyCount = exposure.rows.filter((row) => row.type === "stock").length;
  const topCount = Math.min(10, companyCount);
  const allCompaniesWeight = composition.filter((slice) => slice.kind === "company" || slice.kind === "other-companies").reduce((sum, slice) => sum + (slice.weight ?? 0), 0);
  const funds = biggest ? fundSymbols(biggest.sources) : [];
  return <div className="pi-answers">
    <Card className="pi-answer">
      <span className="pi-answer-q">Biggest single exposure</span>
      {biggest ? <>
        <p className="pi-answer-a"><strong>{biggest.label}</strong> is <strong>{pct(biggest.weight)}</strong> of your portfolio</p>
        <div className="pi-answer-split" aria-hidden="true"><span style={{ flexGrow: biggest.directAud, background: DIRECT_COLOR }} /><span style={{ flexGrow: biggest.viaEtfsAud, background: VIA_FUNDS_COLOR }} /></div>
        <ul className="pi-answer-legs">
          {biggest.directAud > 0 && <li><i style={{ background: DIRECT_COLOR }} />Held directly<b>{currency.format(biggest.directAud)}</b></li>}
          {biggest.viaEtfsAud > 0 && <li><i style={{ background: VIA_FUNDS_COLOR }} />Via {funds.join(", ")}<b>{currency.format(biggest.viaEtfsAud)}</b></li>}
        </ul>
      </> : <p className="pi-answer-a">No company exposure yet</p>}
    </Card>
    <Card className="pi-answer">
      <span className="pi-answer-q">How concentrated</span>
      {companyCount > 0 ? <>
        <p className="pi-answer-a">Your top {topCount} {topCount === 1 ? "company is" : "companies are"} <strong>{pct(concentration.top10)}</strong></p>
        <dl className="pi-answer-steps"><div><dt>Top 1</dt><dd>{pct(concentration.top1)}</dd></div><div><dt>Top 5</dt><dd>{pct(concentration.top5)}</dd></div><div><dt>Top 10</dt><dd>{pct(concentration.top10)}</dd></div></dl>
        {companyCount > 10 && <p className="pi-answer-detail">The other {companyCount - 10} companies add up to {pct(allCompaniesWeight - (concentration.top10 ?? 0))}.</p>}
      </> : <p className="pi-answer-a">No company exposure yet</p>}
    </Card>
    <Card className={`pi-answer ${moves.length ? "pi-answer-warn" : ""}`}>
      <span className="pi-answer-q">Against your plan</span>
      {!rebalance.configured
        ? <><p className="pi-answer-a">No targets set yet</p><Button size="sm" variant="outline" onClick={onSetTargets}>Set targets</Button></>
        : moves.length
          ? <><p className="pi-answer-a"><strong>{moves.length}</strong> {moves.length === 1 ? "bucket is" : "buckets are"} outside ±{pct(rebalance.tolerance)}</p>
            <ul className="pi-answer-moves">{moves.slice(0, 3).map((row) => <li key={row.key}><span className={`pi-answer-verb pi-${row.status}`}>{row.status === "overweight" ? "Trim" : "Add"}</span>{row.label}<b>{moveLabel(row).replace(/^(Trim|Add) /, "")}</b></li>)}</ul></>
          : <p className="pi-answer-a">Everything is within <strong>±{pct(rebalance.tolerance)}</strong> of target</p>}
    </Card>
  </div>;
}

function EmptyData(): JSX.Element {
  return <div className="pi-empty"><strong>No allocation to show yet</strong><p>Open Fix data above to see which holdings need a price or exchange rate.</p></div>;
}

function TargetSheet({ open, onOpenChange, allocation, settings, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; allocation: AllocationRow[]; settings: RebalanceSettings; onSave: (settings: RebalanceSettings) => Promise<void> }): JSX.Element {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tolerance, setTolerance] = useState(String(settings.tolerance * 100));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(allocation.map((row) => [row.key, String((settings.targets[row.key] ?? 0) * 100)])));
    setTolerance(String(settings.tolerance * 100));
  }, [open, allocation, settings]);
  const total = allocation.reduce((sum, row) => sum + numberValue(draft[row.key]), 0);
  const valid = Math.abs(total - 100) < 0.01;
  const save = async () => {
    setSaving(true);
    try {
      const targets = Object.fromEntries(allocation.flatMap((row): Array<[string, number]> => {
        const value = numberValue(draft[row.key]) / 100;
        return value > 0 ? [[row.key, value]] : [];
      }));
      await onSave({ schemaVersion: 1, tolerance: Math.min(25, Math.max(0.5, numberValue(tolerance))) / 100, targets });
      onOpenChange(false);
    } finally { setSaving(false); }
  };
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="pi-sheet"><SheetHeader><SheetTitle>Core–satellite targets</SheetTitle><SheetDescription>Each ETF has its own target. Individual stocks and cash are each managed as one combined allocation bucket.</SheetDescription></SheetHeader>
    <div className="pi-sheet-body"><label className="pi-tolerance"><span>Drift tolerance</span><div><Input type="number" min="0.5" max="25" step="0.5" value={tolerance} onChange={(event) => setTolerance(event.target.value)} /><span>%</span></div></label>
      <div className="pi-target-list">{allocation.map((row) => <label key={row.key}><span><strong>{row.label}</strong><small>{row.type} · current {row.weight === null ? "—" : percent.format(row.weight)}</small></span><div><Input type="number" min="0" max="100" step="0.1" value={draft[row.key] ?? "0"} onChange={(event) => setDraft((current) => ({ ...current, [row.key]: event.target.value }))} /><span>%</span></div></label>)}</div>
    </div><SheetFooter className="pi-sheet-footer"><span className={valid ? "pi-total-valid" : "pi-total-invalid"}>Total {total.toFixed(1)}%</span><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!valid || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save targets"}</Button></SheetFooter>
  </SheetContent></Sheet>;
}

function AccountSheet({ open, onOpenChange, accounts, selected, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; accounts: PortfolioAccount[]; selected: PortfolioAccount[]; onSave: (ids: string[]) => Promise<void> }): JSX.Element {
  const [ids, setIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setIds(selected.map((account) => account.id)); }, [open, selected]);
  const save = async () => { setSaving(true); try { await onSave(ids); onOpenChange(false); } finally { setSaving(false); } };
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="pi-sheet"><SheetHeader><SheetTitle>Included accounts</SheetTitle><SheetDescription>Choose which Wealthfolio accounts are included in this analysis.</SheetDescription></SheetHeader><div className="pi-sheet-body pi-account-list">{accounts.map((account) => <label key={account.id}><input type="checkbox" checked={ids.includes(account.id)} onChange={(event) => setIds((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} /><span><strong>{account.name}</strong><small>{account.currency}</small></span></label>)}</div><SheetFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={ids.length === 0 || saving} onClick={() => void save()}>{saving ? "Saving…" : "Apply"}</Button></SheetFooter></SheetContent></Sheet>;
}

function DataSheet({ open, onOpenChange, etfs, warnings, onRefreshEtf }: { open: boolean; onOpenChange: (open: boolean) => void; etfs: EtfDataRow[]; warnings: string[]; onRefreshEtf: (key: string) => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="pi-sheet"><SheetHeader><SheetTitle>Data coverage</SheetTitle><SheetDescription>Missing fund data stays visible and is never treated as zero.</SheetDescription></SheetHeader><div className="pi-sheet-body">{warnings.map((warning, index) => <Alert variant="warning" key={index}><AlertDescription>{warning}</AlertDescription></Alert>)}<div className="pi-data-list">{etfs.map((row) => <div key={row.asset.etfKey}><span><strong>{row.asset.symbol}</strong><small>{row.failureReason ?? `${row.snapshot?.holdings.length ?? 0} constituents`}</small></span><Badge variant={row.status === "Fresh" ? "success" : "warning"}>{row.status}</Badge><Button variant="outline" size="sm" disabled={busy === row.asset.etfKey} onClick={() => { setBusy(row.asset.etfKey); void onRefreshEtf(row.asset.etfKey).finally(() => setBusy(null)); }}>{busy === row.asset.etfKey ? "Refreshing…" : "Refresh"}</Button></div>)}</div></div></SheetContent></Sheet>;
}
function SourceSheet({ slice, etfData, onOpenChange }: { slice: CompositionSlice | null; etfData: EtfDataRow[]; onOpenChange: (open: boolean) => void }): JSX.Element {
  if (!slice) return <></>;
  const groups = groupSources(slice.sources, etfData);
  return <Sheet open onOpenChange={onOpenChange}><SheetContent className="pi-sheet"><SheetHeader>
    <SheetTitle>{slice.label}{slice.kind === "company" && slice.ticker ? <span className="pi-sheet-ticker">{slice.ticker}</span> : null}</SheetTitle>
    <SheetDescription>{currency.format(slice.valueAud)} · {pct(slice.weight)} of portfolio{slice.kind === "other-companies" ? ` · ${slice.memberCount} companies` : ""}</SheetDescription>
  </SheetHeader><div className="pi-sheet-body pi-source-list">
    {groups.map((group) => <section key={group.title}><h3>{group.title}</h3>{group.items.map((item) => <div key={item.label}><span>{item.label}{item.detail && <small>{item.detail}</small>}</span><strong>{currency.format(item.amountAud)}</strong></div>)}</section>)}
  </div></SheetContent></Sheet>;
}

interface SourceGroup {
  title: string;
  items: Array<{ label: string; detail?: string; amountAud: number }>;
}

/** Sums sources that share a label, so a group of hundreds of companies reads as a few lines. */
function groupSources(sources: ExposureSource[], etfData: EtfDataRow[]): SourceGroup[] {
  const sum = (entries: Array<{ label: string; detail?: string; amountAud: number }>) => {
    const totals = new Map<string, { label: string; detail?: string; amountAud: number }>();
    for (const entry of entries) {
      const current = totals.get(entry.label) ?? { ...entry, amountAud: 0 };
      current.amountAud += entry.amountAud;
      totals.set(entry.label, current);
    }
    return [...totals.values()].sort((a, b) => b.amountAud - a.amountAud);
  };
  const groups: SourceGroup[] = [
    { title: "Held directly", items: sum(sources.flatMap((source) => source.kind === "direct" ? [{ label: source.accountName, amountAud: source.amountAud }] : [])) },
    { title: "Through funds", items: sum(sources.flatMap((source) => source.kind === "etf" ? [{ label: `${source.etfSymbol} · ${source.accountName}`, amountAud: source.amountAud }] : [])) },
    {
      title: "Not looked through",
      items: sum(sources.flatMap((source) => source.kind === "residual" || source.kind === "opaque"
        ? [{ label: `${source.etfSymbol} · ${source.accountName}`, detail: etfData.find((row) => row.asset.symbol === source.etfSymbol)?.failureReason ?? source.reason, amountAud: source.amountAud }]
        : [])),
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}

function symbols(rows: EtfDataRow[]): string {
  return rows.map((row) => row.asset.symbol).join(", ");
}
function numberValue(value: string | undefined): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function accountLabel(accounts: PortfolioAccount[]): string { if (accounts.length === 0) return "No accounts"; if (accounts.length === 1) return accounts[0].name; return `${accounts.length} accounts`; }
function plainWarning(portfolio: PortfolioModel): string {
  const count = portfolio.holdings.filter((holding) => holding.audValue === null).length;
  if (count > 0) return `${count} holding${count === 1 ? " needs" : "s need"} a usable price or AUD exchange rate.`;
  return portfolio.warnings[0]?.detail ?? "Some holdings need attention.";
}
