// PROTOTYPE — Variant B "Workspace tabs".
// A compact value line, then three top-level tabs that each own one question completely.
// Nothing is rendered outside the tabs, so no dimension can appear twice:
//   Holdings     → what you bought, grouped by type, with the accounts that hold each one
//   Look-through → ranked bars (direct vs. via funds) for companies / sectors / countries / assets
//   Rebalance    → target rails + suggested moves
import { Fragment, useMemo, useState } from "react";
import { Alert, AlertDescription, AnimatedToggleGroup, Badge, Button, Card, Page, PageContent, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@wealthfolio/ui";
import { buildComposition, type CompositionSlice } from "./composition";
import { accountLabel, aud, CASH_COLOR, CATEGORICAL, HATCH, pct, signedPct, sliceSubtitle, usePrototypeModel, type AllocationPageProps, type PrototypeModel } from "./shared";
import type { VisualizationNode } from "@/domain/visualization";

type Tab = "holdings" | "look-through" | "rebalance";
type View = "companies" | "sectors" | "countries" | "assets";

const DIRECT = CATEGORICAL[2];
const VIA = CATEGORICAL[0];

export function VariantB(props: AllocationPageProps): JSX.Element {
  const model = usePrototypeModel(props);
  const [tab, setTab] = useState<Tab>("look-through");
  return <Page className="portfolio-insights proto pb">
    <PageHeader
      heading="Allocation"
      actions={<div className="pi-header-actions">
        <Button variant="outline" onClick={() => undefined}>{accountLabel(props.selectedAccounts)}</Button>
        <Button variant="outline" onClick={() => void props.onRefresh()}>Refresh</Button>
      </div>}
    />
    <PageContent className="pb-content">
      <div className="pb-hero">
        <div className="pb-total"><span>Portfolio value</span><strong>{aud(model.total)}</strong></div>
        <dl>
          <div><dt>Invested</dt><dd>{aud(model.investedAud)}</dd></div>
          <div><dt>Cash</dt><dd>{aud(model.cashAud)} <small>{pct(model.total ? model.cashAud / model.total : null)}</small></dd></div>
          <div><dt>Accounts</dt><dd>{props.selectedAccounts.map((account) => account.name).join(", ")}</dd></div>
        </dl>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="pb-tabs-root">
        <TabsList className="pb-tabs">
          <TabsTrigger value="holdings">Holdings <em>{model.holdingCount}</em></TabsTrigger>
          <TabsTrigger value="look-through">Look-through <em>{pct(model.coverage)} covered</em></TabsTrigger>
          <TabsTrigger value="rebalance">Rebalance {model.moves.length > 0 ? <em className="is-warn">{model.moves.length} to review</em> : <em>on track</em>}</TabsTrigger>
        </TabsList>
        <TabsContent value="holdings"><HoldingsTab props={props} model={model} /></TabsContent>
        <TabsContent value="look-through"><LookThroughTab props={props} model={model} /></TabsContent>
        <TabsContent value="rebalance"><RebalanceTab model={model} /></TabsContent>
      </Tabs>
    </PageContent>
  </Page>;
}

function HoldingsTab({ props, model }: { props: AllocationPageProps; model: PrototypeModel }): JSX.Element {
  const groups = useMemo(() => {
    const byKey = new Map<string, { name: string; accounts: Set<string> }>();
    for (const holding of props.portfolio.holdings) {
      if (!holding.identityKey) continue;
      const entry = byKey.get(holding.identityKey) ?? { name: holding.name, accounts: new Set<string>() };
      entry.accounts.add(holding.accountName);
      byKey.set(holding.identityKey, entry);
    }
    const defs: Array<{ key: string; label: string; types: string[]; color: string }> = [
      { key: "etf", label: "ETFs", types: ["etf"], color: CATEGORICAL[2] },
      { key: "stock", label: "Individual stocks", types: ["stock"], color: CATEGORICAL[0] },
      { key: "cash", label: "Cash", types: ["cash"], color: CASH_COLOR },
      { key: "other", label: "Other", types: ["fixed-income", "derivative", "other", "unknown"], color: "#b1aa9a" },
    ];
    return defs.map((def) => {
      const rows = props.portfolio.instrumentAllocation.filter((row) => def.types.includes(row.type)).map((row) => ({ ...row, name: byKey.get(row.key)?.name ?? row.label, accounts: [...(byKey.get(row.key)?.accounts ?? [])] }));
      const valueAud = rows.reduce((sum, row) => sum + row.valueAud, 0);
      return { ...def, rows, valueAud, weight: model.total ? valueAud / model.total : null };
    }).filter((group) => group.rows.length > 0);
  }, [props.portfolio, model.total]);
  const max = Math.max(...props.portfolio.instrumentAllocation.map((row) => row.weight ?? 0), 0.0001);
  return <Card className="pb-card">
    <div className="pb-card-head"><div><h2>What you bought</h2><p>Each line is something you can trade. Holdings in several accounts are combined.</p></div></div>
    <div className="pb-mix">{groups.map((group) => <span key={group.key} style={{ flexGrow: group.valueAud }}><i style={{ background: group.color }} /><b>{group.label}</b>{pct(group.weight)}</span>)}</div>
    <table className="proto-table">
      <thead><tr><th>Holding</th><th>Accounts</th><th>Share of portfolio</th><th className="num">Value</th></tr></thead>
      <tbody>{groups.map((group) => <Fragment key={group.key}>
        <tr className="pb-group-row"><td colSpan={2}><i style={{ background: group.color }} />{group.label}<small>{group.rows.length}</small></td><td>{pct(group.weight)}</td><td className="num">{aud(group.valueAud)}</td></tr>
        {group.rows.map((row) => <tr key={row.key}>
          <td><span className="pb-holding"><strong>{row.label}</strong><small>{row.name}</small></span></td>
          <td>{row.accounts.map((account) => <Badge key={account} variant="outline" className="pb-account">{account}</Badge>)}</td>
          <td><span className="proto-share"><span><span style={{ width: `${((row.weight ?? 0) / max) * 100}%`, background: group.color }} /></span>{pct(row.weight)}</span></td>
          <td className="num">{aud(row.valueAud)}</td>
        </tr>)}
      </Fragment>)}</tbody>
    </table>
  </Card>;
}

interface RankedRow {
  key: string;
  label: string;
  sub?: string;
  valueAud: number;
  weight: number | null;
  directAud: number;
  viaEtfsAud: number;
  pattern?: "cash" | "hatch" | "group";
  slice?: CompositionSlice;
}

function LookThroughTab({ props, model }: { props: AllocationPageProps; model: PrototypeModel }): JSX.Element {
  const [view, setView] = useState<View>("companies");
  const [open, setOpen] = useState<string | null>(null);
  const composition = useMemo(() => buildComposition(props.exposure, 15), [props.exposure]);
  const toRow = (node: VisualizationNode): RankedRow => ({ key: node.key, label: node.label, valueAud: node.valueAud, weight: node.weight, directAud: node.directAud, viaEtfsAud: node.viaEtfsAud, pattern: node.label === "Cash" ? "cash" : node.label === "Not looked through" ? "hatch" : undefined });
  const companyRows = composition.filter((slice) => slice.kind === "company").map(sliceRow);
  const bucketRows = composition.filter((slice) => slice.kind !== "company").map(sliceRow);
  const rows: RankedRow[] = view === "companies" ? companyRows : model.dimensions[view].map(toRow);
  const extra: RankedRow[] = view === "companies" ? bucketRows : [];
  // Scale to the largest ranked row; bigger aggregate rows get a broken bar instead of squashing the ranking.
  const max = Math.max(...rows.map((row) => row.weight ?? 0), 0.0001);

  return <Card className="pb-card">
    <div className="pb-card-head">
      <div><h2>What you own underneath</h2><p>Funds are opened up and merged with shares you hold directly. Bars add up to 100% of your portfolio.</p></div>
      <AnimatedToggleGroup<View> size="sm" value={view} onValueChange={(value) => { setView(value); setOpen(null); }} items={[{ value: "companies", label: "Companies" }, { value: "sectors", label: "Sectors" }, { value: "countries", label: "Countries" }, { value: "assets", label: "Asset classes" }]} />
    </div>
    {model.unresolved.length > 0 && <Alert variant="warning" className="pb-alert"><AlertDescription>{model.unresolved.map((row) => row.asset.symbol).join(", ")} can't be looked through yet — {pct(model.total ? model.unresolvedAud / model.total : null)} of your portfolio is shown as “{view === "companies" ? "Fund holdings not available" : "Unclassified"}”. <Button variant="link" size="sm">Fix data</Button></AlertDescription></Alert>}
    <div className="pb-key"><span><i style={{ background: DIRECT }} />Held directly</span><span><i style={{ background: VIA }} />Through funds</span></div>
    <div className="pb-ranked" role="list">
      {rows.map((row, index) => <RankedLine key={row.key} rank={index + 1} row={row} max={max} open={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)} />)}
      {extra.length > 0 && <div className="pb-divider">Rest of your portfolio</div>}
      {extra.map((row) => <RankedLine key={row.key} rank={null} row={row} max={max} open={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)} />)}
    </div>
  </Card>;
}

function sliceRow(slice: CompositionSlice): RankedRow {
  return {
    key: slice.key,
    label: slice.label,
    sub: slice.kind === "company" ? `${slice.ticker ?? ""} · ${slice.sector ?? "Unclassified"}` : sliceSubtitle(slice),
    valueAud: slice.valueAud,
    weight: slice.weight,
    directAud: slice.directAud,
    viaEtfsAud: slice.viaEtfsAud,
    pattern: slice.kind === "cash" ? "cash" : slice.kind === "unresolved" ? "hatch" : slice.kind === "other-companies" ? "group" : undefined,
    slice,
  };
}

function RankedLine({ rank, row, max, open, onToggle }: { rank: number | null; row: RankedRow; max: number; open: boolean; onToggle: () => void }): JSX.Element {
  const broken = (row.weight ?? 0) > max * 1.001;
  const fit = broken ? max / (row.weight ?? 1) : 1;
  const scale = (value: number) => `${((row.weight ?? 0) * (row.valueAud > 0 ? value / row.valueAud : 0) * fit / max) * 100}%`;
  const solid = row.pattern === "cash" ? CASH_COLOR : row.pattern === "hatch" ? HATCH : row.pattern === "group" ? "#878580" : null;
  return <div role="listitem" className={`pb-line ${open ? "is-open" : ""}`}>
    <button type="button" onClick={onToggle} aria-expanded={open}>
      <span className="pb-rank">{rank ?? ""}</span>
      <span className="pb-label"><strong>{row.label}</strong>{row.sub && <small>{row.sub}</small>}</span>
      <span className={`pb-bar ${broken ? "is-broken" : ""}`} title={broken ? "Bar shortened to fit the scale" : undefined}>
        {solid
          ? <span style={{ width: scale(row.valueAud), background: solid }} />
          : <><span style={{ width: scale(row.directAud), background: DIRECT }} /><span style={{ width: scale(row.viaEtfsAud), background: VIA }} /></>}
      </span>
      <span className="pb-weight">{pct(row.weight)}</span>
      <span className="pb-value">{aud(row.valueAud)}</span>
    </button>
    {open && <div className="pb-detail">
      {row.slice ? <>
        {row.slice.direct.map((item) => <div key={`d-${item.label}`}><span><i style={{ background: DIRECT }} />Direct · {item.label}</span><b>{aud(item.amountAud)}</b></div>)}
        {row.slice.viaFunds.map((item) => <div key={`f-${item.label}`}><span><i style={{ background: row.slice?.kind === "unresolved" ? "#cecdc3" : VIA }} />{row.slice?.kind === "unresolved" ? `${item.label} · no holdings data` : `Via ${item.label}`}</span><b>{aud(item.amountAud)}</b></div>)}
        {row.slice.kind === "other-companies" && <p>{row.slice.memberCount} companies outside the top 15, combined into one row across all your funds. Switch to Sectors to see where they sit.</p>}
      </> : <>
        <div><span><i style={{ background: DIRECT }} />Held directly</span><b>{aud(row.directAud)}</b></div>
        <div><span><i style={{ background: VIA }} />Through funds</span><b>{aud(row.viaEtfsAud)}</b></div>
      </>}
    </div>}
  </div>;
}

function RebalanceTab({ model }: { model: PrototypeModel }): JSX.Element {
  if (!model.rebalance.configured) return <Card className="pb-card pb-empty"><h2>Set your targets</h2><p>Give each ETF a target, plus one for individual stocks and one for cash.</p><Button>Set targets</Button></Card>;
  const scale = Math.max(...model.plan.map((row) => Math.max(row.weight ?? 0, (row.targetWeight ?? 0) + model.rebalance.tolerance)), 0.05) * 1.1;
  const tol = model.rebalance.tolerance;
  return <div className="pb-rebalance">
    <Card className="pb-card">
      <div className="pb-card-head"><div><h2>Current vs. target</h2><p>Bar = current share · line = target · shaded = allowed drift (±{pct(tol)})</p></div><Button size="sm" variant="outline">Edit targets</Button></div>
      <div className="pb-rails">{model.plan.map((row) => {
        const target = row.targetWeight ?? 0;
        return <div key={row.key} className="pb-rail">
          <span className="pb-rail-label"><strong>{row.label}</strong><small>{row.children.length ? row.children.map((child) => child.label).join(", ") : aud(row.valueAud)}</small></span>
          <span className="pb-rail-track">
            <span className="pb-rail-band" style={{ left: `${(Math.max(0, target - tol) / scale) * 100}%`, width: `${((Math.min(scale, target + tol) - Math.max(0, target - tol)) / scale) * 100}%` }} />
            <span className={`pb-rail-fill pb-${row.status}`} style={{ width: `${((row.weight ?? 0) / scale) * 100}%` }} />
            <span className="pb-rail-target" style={{ left: `${(target / scale) * 100}%` }} />
          </span>
          <span className="pb-rail-nums"><b>{pct(row.weight)}</b><small>target {pct(row.targetWeight)}</small></span>
          <span className={`pb-rail-drift pb-${row.status}`}>{signedPct(row.drift)}</span>
        </div>;
      })}</div>
    </Card>
    <Card className="pb-card pb-moves">
      <div className="pb-card-head"><div><h2>Suggested moves</h2><p>Brings every bucket back to target. Nothing is traded for you.</p></div></div>
      {model.moves.length === 0 ? <p className="pb-moves-empty">Everything is within ±{pct(tol)}.</p> : <ul>{model.moves.map((row) => <li key={row.key}>
        <span className={`pb-move-verb pb-${row.status}`}>{row.status === "overweight" ? "Trim" : "Add"}</span>
        <span><strong>{row.label}</strong><small>{pct(row.weight)} → {pct(row.targetWeight)}</small></span>
        <b>{aud(Math.abs(row.adjustmentAud ?? 0))}</b>
      </li>)}</ul>}
    </Card>
  </div>;
}
