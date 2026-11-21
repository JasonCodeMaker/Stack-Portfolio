// PROTOTYPE — Variant A "Guided scroll".
// One column that reads top to bottom as three numbered questions:
//   1. What you own      → corrected composition map + ranked legend (the only composition view)
//   2. Where it's exposed → one breakdown card with a lens switch (the only sector/country view)
//   3. Plan vs. actual    → one holdings table that also carries targets (the only holdings list)
import { useState } from "react";
import { Alert, AlertDescription, AnimatedToggleGroup, Button, Card, Page, PageContent, PageHeader } from "@wealthfolio/ui";
import type { CompositionSlice } from "./composition";
import { SectionHead, ValueStrip, WhatYouOwn } from "./blocks";
import {
  accountLabel, aud, categoryBackground, foldCategories, LENSES, pct, signedPct, SourcesSheet, usePrototypeModel,
  type AllocationPageProps, type Lens,
} from "./shared";

export function VariantA(props: AllocationPageProps): JSX.Element {
  const model = usePrototypeModel(props);
  const [lens, setLens] = useState<Lens>("sectors");
  const [selected, setSelected] = useState<CompositionSlice | null>(null);

  return <Page className="portfolio-insights proto pa">
    <PageHeader
      heading="Allocation"
      text="What you own, what it's made of, and how it compares with your plan."
      actions={<div className="pi-header-actions">
        <Button variant="outline" onClick={() => undefined}>{accountLabel(props.selectedAccounts)}</Button>
        <Button variant="outline" onClick={() => void props.onRefresh()}>Refresh</Button>
      </div>}
    />
    <PageContent className="pa-content">
      <ValueStrip model={model} props={props} />

      {model.unresolved.length > 0 && <Alert variant="warning" className="pa-alert">
        <AlertDescription><strong>{model.unresolved.map((row) => row.asset.symbol).join(", ")}</strong> has no holdings data, so {aud(model.unresolvedAud)} ({pct(model.total ? model.unresolvedAud / model.total : null)}) is shown as “Fund holdings not available”. <Button variant="link" size="sm">Fix data</Button></AlertDescription>
      </Alert>}

      <WhatYouOwn model={model} props={props} step={1} onSelect={setSelected} />

      <section className="pa-section">
        <SectionHead step={2} title="Where it's exposed" detail={LENSES.find((item) => item.key === lens)?.lookThrough ? "Look-through: fund holdings are included." : "Based on what you bought, not what funds hold."}>
          <AnimatedToggleGroup<Lens> size="sm" value={lens} onValueChange={setLens} items={LENSES.map((item) => ({ value: item.key, label: item.label }))} />
        </SectionHead>
        <Card className="pa-card"><Breakdown lens={lens} model={model} /></Card>
      </section>

      <section className="pa-section">
        <SectionHead step={3} title="Plan vs. actual" detail={model.rebalance.configured ? `Each ETF has its own target; stocks and cash are grouped. Allowed drift ±${pct(model.rebalance.tolerance)}.` : "Set targets to see drift."}>
          <Button size="sm" variant="outline">Edit targets</Button>
        </SectionHead>
        <Card className="pa-card"><PlanTable model={model} /></Card>
      </section>
    </PageContent>
    <SourcesSheet slice={selected} etfData={props.etfData} onClose={() => setSelected(null)} />
  </Page>;
}

function Breakdown({ lens, model }: { lens: Lens; model: ReturnType<typeof usePrototypeModel> }): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const nodes = model.dimensions[lens];
  const bar = foldCategories(nodes, 6);
  const lookThrough = LENSES.find((item) => item.key === lens)?.lookThrough ?? false;
  const rows = showAll ? nodes : nodes.slice(0, 8);
  const max = Math.max(...nodes.map((node) => node.weight ?? 0), 0.0001);
  return <div className="pa-breakdown">
    <div className="proto-strip" aria-hidden="true">{bar.map((node, index) => <span key={node.key} title={`${node.label} ${pct(node.weight)}`} style={{ flexGrow: node.valueAud, background: categoryBackground(lens, node.label, index) }} />)}</div>
    <table className="proto-table">
      <thead><tr><th>{LENSES.find((item) => item.key === lens)?.label.replace(/s$/, "")}</th><th>Share</th><th className="num">Value</th>{lookThrough && <><th className="num">Direct</th><th className="num">Via funds</th></>}</tr></thead>
      <tbody>{rows.map((node, index) => <tr key={node.key}>
        <td><span className="proto-name"><i style={{ background: categoryBackground(lens, node.label, Math.min(index, 6)) }} />{node.label}</span></td>
        <td><span className="proto-share"><span><span style={{ width: `${((node.weight ?? 0) / max) * 100}%` }} /></span>{pct(node.weight)}</span></td>
        <td className="num">{aud(node.valueAud)}</td>
        {lookThrough && <><td className="num muted">{node.directAud ? aud(node.directAud) : "—"}</td><td className="num muted">{node.viaEtfsAud ? aud(node.viaEtfsAud) : "—"}</td></>}
      </tr>)}</tbody>
    </table>
    {nodes.length > 8 && <div className="proto-more"><Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show less" : `Show all ${nodes.length}`}</Button></div>}
  </div>;
}

function PlanTable({ model }: { model: ReturnType<typeof usePrototypeModel> }): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const range = Math.max(model.rebalance.tolerance * 3, ...model.plan.map((row) => Math.abs(row.drift ?? 0)));
  return <table className="proto-table pa-plan">
    <thead><tr><th>Holding</th><th className="num">Value</th><th className="num">Current</th><th className="num">Target</th><th className="pa-drift-head">Drift from target</th><th>Suggested</th></tr></thead>
    <tbody>{model.plan.flatMap((row) => {
      const expanded = open[row.key];
      const main = <tr key={row.key} className={row.children.length ? "is-group" : ""}>
        <td>{row.children.length > 0
          ? <button type="button" className="pa-expand" onClick={() => setOpen((state) => ({ ...state, [row.key]: !state[row.key] }))}><span>{expanded ? "▾" : "▸"}</span><strong>{row.label}</strong><small>{row.children.length}</small></button>
          : <strong className="pa-holding">{row.label}</strong>}</td>
        <td className="num">{aud(row.valueAud)}</td>
        <td className="num">{pct(row.weight)}</td>
        <td className="num muted">{pct(row.targetWeight)}</td>
        <td><DriftBar drift={row.drift} tolerance={model.rebalance.tolerance} range={range} status={row.status} /></td>
        <td><Suggestion status={row.status} amount={row.adjustmentAud} /></td>
      </tr>;
      const children = expanded ? row.children.map((child) => <tr key={child.key} className="is-child"><td><span className="pa-child">{child.label}</span></td><td className="num">{aud(child.valueAud)}</td><td className="num">{pct(child.weight)}</td><td /><td /><td /></tr>) : [];
      return [main, ...children];
    })}</tbody>
  </table>;
}

function DriftBar({ drift, tolerance, range, status }: { drift: number | null; tolerance: number; range: number; status: string }): JSX.Element {
  if (drift === null) return <span className="muted">—</span>;
  const half = 50;
  const width = Math.min(half, (Math.abs(drift) / range) * half);
  const band = (tolerance / range) * half;
  return <span className="pa-drift">
    <span className="pa-drift-track">
      <span className="pa-drift-band" style={{ left: `${half - band}%`, width: `${band * 2}%` }} />
      <span className={`pa-drift-fill pa-${status}`} style={drift >= 0 ? { left: "50%", width: `${width}%` } : { left: `${half - width}%`, width: `${width}%` }} />
      <span className="pa-drift-zero" />
    </span>
    <b className={`pa-${status}`}>{signedPct(drift)}</b>
  </span>;
}

function Suggestion({ status, amount }: { status: string; amount: number | null }): JSX.Element {
  if (status === "overweight") return <span className="pa-suggest pa-overweight">Trim {aud(Math.abs(amount ?? 0))}</span>;
  if (status === "underweight") return <span className="pa-suggest pa-underweight">Add {aud(Math.abs(amount ?? 0))}</span>;
  if (status === "on-target") return <span className="pa-suggest muted">Within range</span>;
  return <span className="muted">—</span>;
}
