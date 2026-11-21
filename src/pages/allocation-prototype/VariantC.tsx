// PROTOTYPE — Variant C "Answers first" (with A's value strip and "What you own" map).
// Value strip, then three plain-language answers, then the composition map (the only
// company-level view), then every other dimension as one 100% bar (click to open its
// numbers inline), then a dot plot of holdings against targets.
import { useState } from "react";
import { Alert, AlertDescription, Button, Card, Page, PageContent, PageHeader } from "@wealthfolio/ui";
import { ValueStrip, WhatYouOwn } from "./blocks";
import type { CompositionSlice } from "./composition";
import {
  accountLabel, aud, categoryBackground, categoryColor, CATEGORICAL, foldCategories, inkFor, LENSES, pct, signedPct,
  SourcesSheet, usePrototypeModel, type AllocationPageProps, type Lens, type PrototypeModel,
} from "./shared";

interface Segment {
  key: string;
  label: string;
  short: string;
  sub?: string;
  valueAud: number;
  weight: number | null;
  background: string;
  darkText: boolean;
  directAud: number;
  viaEtfsAud: number;
  slice?: CompositionSlice;
}

export function VariantC(props: AllocationPageProps): JSX.Element {
  const model = usePrototypeModel(props);
  const [open, setOpen] = useState<Lens | null>(null);
  const [selected, setSelected] = useState<CompositionSlice | null>(null);
  // Companies are left out here: the "What you own" map above is the one company-level view.
  const rows: Array<{ key: Lens; label: string; note: string; segments: Segment[] }> = LENSES.map((lens) => ({
    key: lens.key,
    label: lens.label,
    note: lens.lookThrough ? "Look-through" : "As purchased",
    segments: foldCategories(model.dimensions[lens.key], 6).map((node, index) => ({
      key: node.key, label: node.label, short: node.label, valueAud: node.valueAud, weight: node.weight,
      background: categoryBackground(lens.key, node.label, index), darkText: node.label === "Cash" || node.label === "Not looked through" || node.label === "Other" || inkFor(categoryColor(lens.key, node.label, index)) !== "#fff",
      directAud: node.directAud, viaEtfsAud: node.viaEtfsAud,
    })),
  }));
  const biggest = model.companies[0];
  const tailCount = model.companies.length - 10;
  const tailWeight = model.companies.slice(10).reduce((sum, row) => sum + (row.weight ?? 0), 0);

  return <Page className="portfolio-insights proto pc">
    <PageHeader
      heading="Allocation"
      text="What you own, what it's made of, and how it compares with your plan."
      actions={<div className="pi-header-actions">
        <Button variant="outline" onClick={() => undefined}>{accountLabel(props.selectedAccounts)}</Button>
        <Button variant="outline" onClick={() => void props.onRefresh()}>Refresh</Button>
      </div>}
    />
    <PageContent className="pc-content">
      <ValueStrip model={model} props={props} />

      {model.unresolved.length > 0 && <Alert variant="warning" className="pc-alert"><AlertDescription><strong>{model.unresolved.map((row) => row.asset.symbol).join(", ")}</strong> can't be looked through yet, so {pct(model.total ? model.unresolvedAud / model.total : null)} of your portfolio is hatched below. <Button variant="link" size="sm">Fix data</Button></AlertDescription></Alert>}

      <div className="pc-answers">
        {biggest && <Card className="pc-answer">
          <span className="pc-q">Biggest single exposure</span>
          <p className="pc-a"><strong>{biggest.label}</strong> is <strong>{pct(biggest.weight)}</strong> of your portfolio</p>
          <div className="pc-split" aria-hidden="true"><span style={{ flexGrow: biggest.directAud, background: CATEGORICAL[2] }} /><span style={{ flexGrow: biggest.viaEtfsAud, background: CATEGORICAL[0] }} /></div>
          <ul className="pc-legs">
            <li><i style={{ background: CATEGORICAL[2] }} />Held directly<b>{aud(biggest.directAud)}</b></li>
            <li><i style={{ background: CATEGORICAL[0] }} />Via {biggest.viaFunds.map((fund) => fund.label).join(", ")}<b>{aud(biggest.viaEtfsAud)}</b></li>
          </ul>
        </Card>}
        <Card className="pc-answer">
          <span className="pc-q">How concentrated</span>
          <p className="pc-a">Your top 10 companies are <strong>{pct(model.concentration.top10)}</strong></p>
          <dl className="pc-steps"><div><dt>Top 1</dt><dd>{pct(model.concentration.top1)}</dd></div><div><dt>Top 5</dt><dd>{pct(model.concentration.top5)}</dd></div><div><dt>Top 10</dt><dd>{pct(model.concentration.top10)}</dd></div></dl>
          <p className="pc-detail">The other {tailCount} companies add up to {pct(tailWeight)}.</p>
        </Card>
        <Card className={`pc-answer ${model.moves.length ? "pc-answer-warn" : ""}`}>
          <span className="pc-q">Against your plan</span>
          {model.moves.length
            ? <><p className="pc-a"><strong>{model.moves.length}</strong> {model.moves.length === 1 ? "bucket is" : "buckets are"} outside ±{pct(model.rebalance.tolerance)}</p>
              <ul className="pc-moves">{model.moves.slice(0, 3).map((row) => <li key={row.key}><span className={`pc-verb pc-${row.status}`}>{row.status === "overweight" ? "Trim" : "Add"}</span>{row.label}<b>{aud(Math.abs(row.adjustmentAud ?? 0))}</b></li>)}</ul></>
            : <p className="pc-a">Everything is within <strong>±{pct(model.rebalance.tolerance)}</strong> of target</p>}
        </Card>
      </div>

      <WhatYouOwn model={model} props={props} title="Portfolio composition" headerInside onSelect={setSelected} />

      <Card className="pc-glance">
        <div className="pc-head"><div><h2>Where it's exposed</h2><p>Every bar is 100% of your portfolio. Click one to see its numbers.</p></div></div>
        {rows.map((row) => {
          const isOpen = open === row.key;
          const lead = row.segments[0];
          return <div key={row.key} className={`pc-row ${isOpen ? "is-open" : ""}`}>
            <button type="button" className="pc-row-head" onClick={() => setOpen(isOpen ? null : row.key)} aria-expanded={isOpen}>
              <span className="pc-row-label"><strong>{row.label}</strong><small>{row.note}</small></span>
              <span className="pc-bar">{row.segments.map((segment) => <span key={segment.key} title={`${segment.label} ${pct(segment.weight)}`} style={{ flexGrow: segment.valueAud, background: segment.background, color: segment.darkText ? "var(--foreground)" : "#fff" }}>{(segment.weight ?? 0) >= 0.07 ? `${segment.short} ${pct(segment.weight)}` : ""}</span>)}</span>
              <span className="pc-row-lead">{lead ? <>{lead.short} <b>{pct(lead.weight)}</b></> : null}</span>
              <span className="pc-chevron">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && <div className="pc-row-body">
              {row.segments.map((segment) => <button type="button" key={segment.key} className="pc-item" disabled={!segment.slice} onClick={() => segment.slice && setSelected(segment.slice)}>
                <i style={{ background: segment.background }} />
                <span><strong>{segment.label}</strong><small>{segment.sub ?? (segment.viaEtfsAud > 0 ? `${aud(segment.directAud)} direct · ${aud(segment.viaEtfsAud)} via funds` : "")}</small></span>
                <b>{pct(segment.weight)}</b>
                <em>{aud(segment.valueAud)}</em>
              </button>)}
            </div>}
          </div>;
        })}
      </Card>

      <Card className="pc-plan">
        <div className="pc-head"><div><h2>Holdings vs. target</h2><p><span className="pc-dot-key" /> current · <span className="pc-target-key" /> target · shaded = allowed drift</p></div><Button size="sm" variant="outline">Edit targets</Button></div>
        <PlanDots model={model} />
      </Card>
    </PageContent>
    <SourcesSheet slice={selected} etfData={props.etfData} onClose={() => setSelected(null)} />
  </Page>;
}

function PlanDots({ model }: { model: PrototypeModel }): JSX.Element {
  const tol = model.rebalance.tolerance;
  const scale = Math.max(...model.plan.map((row) => Math.max(row.weight ?? 0, (row.targetWeight ?? 0) + tol)), 0.05) * 1.08;
  const at = (value: number) => `${(Math.max(0, Math.min(scale, value)) / scale) * 100}%`;
  return <div className="pc-dots">
    <div className="pc-dots-axis"><span /><span className="pc-axis">{[0, 0.1, 0.2, 0.3].filter((tick) => tick <= scale).map((tick) => <em key={tick} style={{ left: at(tick) }}>{pct(tick).replace(".0", "")}</em>)}</span><span /><span /></div>
    {model.plan.map((row) => {
      const target = row.targetWeight ?? 0;
      return <div key={row.key} className="pc-dot-row">
        <span className="pc-dot-label"><strong>{row.label}</strong>{row.children.length > 0 && <small>{row.children.map((child) => child.label).join(" · ")}</small>}</span>
        <span className="pc-dot-track">
          <span className="pc-dot-band" style={{ left: at(target - tol), width: `calc(${at(target + tol)} - ${at(target - tol)})` }} />
          <span className="pc-dot-target" style={{ left: at(target) }} />
          <span className="pc-dot-link" style={{ left: at(Math.min(target, row.weight ?? 0)), width: `calc(${at(Math.max(target, row.weight ?? 0))} - ${at(Math.min(target, row.weight ?? 0))})` }} />
          <span className={`pc-dot pc-${row.status}`} style={{ left: at(row.weight ?? 0) }} />
        </span>
        <span className="pc-dot-nums">{pct(row.weight)} <small>vs {pct(row.targetWeight)}</small></span>
        <span className={`pc-dot-action pc-${row.status}`}>{row.status === "overweight" ? `Trim ${aud(Math.abs(row.adjustmentAud ?? 0))}` : row.status === "underweight" ? `Add ${aud(Math.abs(row.adjustmentAud ?? 0))}` : `${signedPct(row.drift)} · ok`}</span>
      </div>;
    })}
  </div>;
}
