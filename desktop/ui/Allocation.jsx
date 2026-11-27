import React, { useEffect, useMemo, useState } from "react";
import { buildComposition } from "../allocation/domain/composition";
import { buildBreakdownNodes } from "../allocation/domain/visualization";
import { buildRebalanceModel, CASH_TARGET, fullTargetTotal, OTHER_INVESTMENTS, STOCKS_TARGET } from "../allocation/domain/rebalance";
import { api, aud, directedPct, fmt, pct, Card, Delta, Field, Modal, Table, Empty } from "./common";
import { Bar, BulletBar, RankedBars, StackedBar, Treemap, refinedTileColor } from "./charts";
import { Detail, useRowKeys, useShell } from "./Shell";
import { useI18n } from "./i18n.jsx";
import "./allocation.css";

function FundData({ d, run, initialFund }) {
  const { t, allocationLabel } = useI18n();
  const [text, setText] = useState(""),
    [date, setDate] = useState(d.date),
    [parsed, setParsed] = useState(null),
    [all, setAll] = useState(false),
    [dialog, setDialog] = useState("");
  const f = d.etfData.find((e) => e.asset.etfKey === initialFund);
  if (!f) return <Empty>{t("alloc.noEtfs")}</Empty>;
  const key = f.asset.etfKey,
    s = f.snapshot,
    small = (s?.holdings || []).filter((r) => r.weight <= 0.01);
  const rows = all ? s?.holdings || [] : (s?.holdings || []).filter((r) => r.weight > 0.01);
  async function check(fromFile) {
    await run(async () => {
      const r = await api.fundCsv({ key, date, text, fromFile });
      if (r) setParsed(r);
    }, false);
  }
  return (
    <>
      <Card title={t("alloc.fundTitle")}>
        <div className="mini-stats">
          <span>
            <b>{s?.provider || "—"}</b>{t("alloc.stat.provider")}
          </span>
          <span>
            <b>{s?.asOfDate || "—"}</b>{t("alloc.stat.asOfDate")}
          </span>
          <span>
            <b>{pct(f.resolvedWeight)}</b>{t("alloc.stat.coverage")}
          </span>
          <span>
            <b>{t(`alloc.status.${f.status}`) || f.status}</b>{t("alloc.stat.status")}
          </span>
        </div>
        <details><summary>{t("alloc.manageSummary")}</summary><div className="actions">
          <button onClick={() => run(() => api.fundRefresh({ asset: f.asset }), t("alloc.fundRefreshed"))}>
            {t("alloc.refreshFund")}
          </button>
          <button disabled={!s} onClick={() => run(() => api.fundExport({ key }), false)}>
            {t("alloc.exportCsv")}
          </button>
          <button onClick={() => setDialog("import")}>{t("alloc.importCsv")}</button>
          <button disabled={!s} onClick={() => setDialog("disable")}>
            {t("alloc.disableFund")}
          </button>
        </div></details>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t("alloc.showSmallHoldings")}
        </label>
        <Table head={[t("alloc.col.symbol"), t("alloc.col.name"), t("alloc.col.fundWeight"), t("alloc.col.sector"), t("alloc.col.country")]}>
          {[...rows]
            .sort((a, b) => b.weight - a.weight)
            .map((r, i) => (
              <tr key={i}>
                <td>{r.symbol || "—"}</td>
                <td>{r.name}</td>
                <td>{pct(r.weight)}</td>
                <td>{r.sector ? allocationLabel(r.sector) : "—"}</td>
                <td>{r.country ? allocationLabel(r.country) : "—"}</td>
              </tr>
            ))}
          {!all && small.length > 0 && (
            <tr>
              <td>{t("alloc.tile.other")}</td>
              <td>
                {t("alloc.otherItems", { count: small.length, symbol: f.asset.symbol })}
              </td>
              <td>{pct(small.reduce((n, r) => n + r.weight, 0))}</td>
              <td>—</td>
              <td>—</td>
            </tr>
          )}
        </Table>
      </Card>
      {dialog === "disable" && (
        <Modal title={t("alloc.disableTitle", { symbol: f.asset.symbol })} close={() => setDialog("")}>
          <p>{t("alloc.disableDesc")}</p>
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                await api.fundDisable({ key });
                setDialog("");
              }, t("alloc.fundDisabled"))
            }
          >
            {t("alloc.disableConfirm")}
          </button>
        </Modal>
      )}
      {dialog === "import" && (
        <Modal title={t("alloc.importTitle", { symbol: f.asset.symbol })} close={() => setDialog("")}>
          <Field label={t("alloc.holdingsDate")}>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setParsed(null);
              }}
            />
          </Field>
          <Field label={t("alloc.pasteCsv")}>
            <textarea
              rows={5}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setParsed(null);
              }}
              placeholder={
                "symbol,name,weight,mic,country,sector\nAAPL,Apple,7%,XNAS,United States,Technology"
              }
            />
          </Field>
          <div className="actions">
            <button onClick={() => check(true)}>{t("alloc.chooseCsvFile")}</button>
            <button onClick={() => check(false)}>{t("alloc.previewPasted")}</button>
          </div>
          {parsed && (
            <>
              <p>
                {t("alloc.parsedSummary", {
                  count: parsed.rows.length,
                  sum: pct(parsed.weightSum),
                  unit: parsed.detectedUnit,
                })}
              </p>
              <p>{[...parsed.missingFields, ...parsed.issues, parsed.validation.message].join(" ")}</p>
              <Table head={[t("alloc.col.name"), t("alloc.col.weight")]}>
                {parsed.rows.slice(0, 8).map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{pct(r.weight)}</td>
                  </tr>
                ))}
              </Table>
              <button
                className="primary"
                disabled={!parsed.validation.accepted || parsed.missingFields.length > 0}
                onClick={() =>
                  run(async () => {
                    await api.fundSave({ snapshot: parsed.validation.snapshot, version: f.version });
                    setDialog("");
                    setParsed(null);
                  }, t("alloc.fundSaved"))
                }
              >
                {t("alloc.confirmSaveFund")}
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
const sumBy = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0);
const holdingPage = (onPage, holding) => onPage("holdings", { assetId: holding.assetId, symbol: holding.ticker || holding.label });

function Segmented({ label, items, value, select }) {
  return (
    <span className="seg" role="group" aria-label={label}>
      {items.map(([key, name]) => (
        <button key={key} type="button" className={key === value ? "on" : ""} aria-pressed={key === value} onClick={() => select(key)}>
          {name}
        </button>
      ))}
    </span>
  );
}

function ExposureKey() {
  const { t } = useI18n();
  return <span className="alloc-key"><span><i className="alloc-direct" />{t("alloc.legend.direct")}</span><span><i className="alloc-via" />{t("alloc.legend.viaEtf")}</span></span>;
}

const scaleSteps = [-8, -4, -2, -0.5, 0.5, 2];
function DailyKey() {
  const { t } = useI18n();
  return (
    <span className="alloc-scale" aria-label={t("alloc.dayScaleAria")}>
      −8%+ {scaleSteps.map((n) => <i key={n} style={{ background: refinedTileColor(n).background }} />)} +3%
    </span>
  );
}

function CompanySources({ company, holdings, weight, dayChange, day, onClose, onPage }) {
  const { t, allocationLabel } = useI18n();
  const groups = [...Map.groupBy(company.sources, (s) => holdings.get(s.holdingId)?.assetId ?? s.holdingId)];
  const rowKeys = useRowKeys(groups.filter(([, sources]) => holdings.has(sources[0].holdingId)).map(([key]) => key));
  const companyTitle = allocationLabel(company.label);
  return (
    <Detail title={companyTitle + (company.ticker ? " · " + company.ticker : "")} onClose={onClose}>
      <dl className="alloc-source-stats">
        <div>
          <dt>{t("alloc.companyShareAfterLook")}</dt>
          <dd>{pct(weight(company.totalAud))}</dd>
          <span className="cap">{aud(company.totalAud, 2)}</span>
        </div>
        <div>
          <dt>{t("alloc.dayChangeCol")}</dt>
          <dd><Delta rate={dayChange} /></dd>
          <span className="cap">{day}</span>
        </div>
      </dl>
      <p className="cap">{t("alloc.whereFrom")}</p>
      <Table head={[t("alloc.col.source"), [t("alloc.col.share"), "num"], [t("alloc.col.amountAud"), "num"]]} onKeyDown={rowKeys}>
        {groups.map(([key, sources]) => {
          const source = sources[0], holding = holdings.get(source.holdingId);
          const direct = source.kind === "direct";
          const label = direct ? t("alloc.directHolding") : t("alloc.viaEtfHolding", { etf: holding?.ticker || source.etfSymbol });
          const value = sumBy(sources, "amountAud");
          return (
            <tr key={key} data-row={holding ? key : undefined} className={holding ? "click" : undefined}
              onClick={holding ? () => holdingPage(onPage, holding) : undefined}>
              <td>
                {holding ? <button className="alloc-link" type="button">{label}</button> : <b>{label}</b>}
                {direct && holding && <span className="cap alloc-source-ticker">{holding.ticker}</span>}
              </td>
              <td className="num">{pct(weight(value))}</td>
              <td className="num">{aud(value, 2)}</td>
            </tr>
          );
        })}
      </Table>
    </Detail>
  );
}

function CompanyBars({ items, select, selected }) {
  const max = Math.max(...items.map((item) => item.value));
  return (
    <div className="alloc-company-bars">
      {items.map((item) => {
        const Row = item.selectable ? "button" : "div";
        const name = item.name ?? item.label;
        return (
          <Row key={item.id} className="alloc-company-bar" title={item.title}
            type={item.selectable ? "button" : undefined}
            aria-label={item.selectable ? item.title : undefined}
            aria-pressed={item.selectable ? item.id === selected : undefined}
            onClick={item.selectable ? () => select(item.id) : undefined}>
            <span>{name} {item.label !== name && <small>{item.label}</small>}</span>
            {item.sources ? <StackedBar {...item.sources} max={max} /> : <Bar value={item.value} max={max} color="var(--l3)" />}
            <strong>{item.detail[0]}</strong>
          </Row>
        );
      })}
    </div>
  );
}

const TAIL_SECTOR_COLORS = ["var(--s2)", "var(--s1)", "var(--s4)", "var(--s3)", "var(--s5)", "var(--s6)"];
const sectorColor = (sector, index) =>
  sector === "Unclassified" ? "var(--l3)" : TAIL_SECTOR_COLORS[index % TAIL_SECTOR_COLORS.length];

const TAIL_INITIAL_LIMIT = 100;
const tailSector = (sector) => (!sector || sector === "Mixed/Conflicting" ? "Unclassified" : sector);
const tailBucketLabel = (bucket, t, allocationLabel) =>
  bucket?.kind === "opaque" ? t("alloc.tail.opaqueLabel", { ticker: bucket.ticker }) : allocationLabel(bucket?.label);

function TailExplorer({
  tailScope,
  setTailScope,
  buckets,
  canMergeTail,
  mergedTail,
  otherAud,
  etfDayChange,
  weight,
  openFund,
  chosen,
  choose,
  height,
}) {
  const { t, allocationLabel } = useI18n();
  const [sectorFilter, setSectorFilter] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("weight");
  const [overlapOnly, setOverlapOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const isMerged = tailScope === "ALL";
  const activeBucket = isMerged ? null : buckets.find((b) => b.key === tailScope) ?? buckets[0];
  const activeKind = activeBucket?.kind;

  useEffect(() => {
    setSectorFilter(null);
    setOverlapOnly(false);
    setShowAll(false);
    if (isMerged || activeKind !== "etf") setSortBy((prev) => (prev === "fundWeight" ? "weight" : prev));
  }, [tailScope, isMerged, activeKind]);

  const rawMembers = isMerged ? mergedTail.members : (activeBucket?.allMembers ?? []);
  const sectors = isMerged ? mergedTail.sectors : (activeBucket?.sectors ?? []);
  const scopeTotalAud = isMerged ? mergedTail.totalAud : (activeBucket?.valueAud ?? 0);
  const unattributedAud = isMerged ? mergedTail.unattributedAud : (activeBucket?.unattributedAud ?? 0);
  const activeEtfDay = activeBucket?.kind === "etf" ? etfDayChange(activeBucket.etfKey) : null;
  const bucketColorMap = useMemo(
    () => new Map(buckets.map((b, i) => [b.key, `var(--s${(i % 6) + 1})`])),
    [buckets],
  );
  const sectorPalette = useMemo(
    () => new Map(sectors.map((s, i) => [s.sector, sectorColor(s.sector, i)])),
    [sectors],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rawMembers.filter((m) => {
      const sec = tailSector(m.sector);
      if (sectorFilter && sec !== sectorFilter) return false;
      if (isMerged && overlapOnly && !m.overlaps) return false;
      if (q) {
        const secLabel = allocationLabel(sec).toLowerCase();
        const hay = `${m.ticker || ""} ${m.label || ""} ${secLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      if (sortBy === "sector") {
        return allocationLabel(tailSector(a.sector)).localeCompare(allocationLabel(tailSector(b.sector)))
          || b.valueAud - a.valueAud;
      }
      if (sortBy === "fundWeight" && !isMerged) {
        return (b.fundWeight ?? b.valueAud) - (a.fundWeight ?? a.valueAud);
      }
      return b.valueAud - a.valueAud;
    });
  }, [rawMembers, sectorFilter, isMerged, overlapOnly, search, sortBy, allocationLabel]);

  const visibleRows = showAll ? filtered : filtered.slice(0, TAIL_INITIAL_LIMIT);
  const showUnattributedRow =
    unattributedAud > 0 && !search.trim() && !overlapOnly && (!sectorFilter || sectorFilter === "Unclassified");
  const maxAud = rawMembers[0]?.valueAud || 1;
  const scopeItems = [
    ...buckets.map((b) => [b.key, t("alloc.tail.bucketTab", {
      ticker: allocationLabel(b.kind === "etf" ? b.label : b.ticker), pct: pct(b.weight),
    })]),
    ...(canMergeTail ? [["ALL", t("alloc.tail.mergedTab", { pct: pct(weight(otherAud)) })]] : []),
  ];

  return (
    <div className="alloc-tail-explorer" style={{ minHeight: height }}>
      <div className="row alloc-drillbar">
        <button type="button" className="btn sm" onClick={() => setTailScope(null)}>
          {t("alloc.backPrefix")}{t("alloc.backMap")} (Esc)
        </button>
        <span className="alloc-drillpath">
          {t("alloc.tile.other")} {pct(weight(otherAud))} {" › "}
          <b>{isMerged ? t("alloc.tail.mergedTab", { pct: pct(weight(otherAud)) }) : tailBucketLabel(activeBucket, t, allocationLabel)}</b>
        </span>
        <span className="sp" />
        <Segmented label={t("alloc.tail.scopeAria")} items={scopeItems} value={isMerged ? "ALL" : activeBucket?.key} select={setTailScope} />
      </div>

      <div className="alloc-tail-summary">
        {isMerged ? (
          <>
            <span>{t("alloc.tail.mergedSummary", { pct: pct(mergedTail.weight), amount: aud(mergedTail.totalAud), count: rawMembers.length })}</span>
            {mergedTail.overlapCount > 0 && (
              <span className="tag">{t("alloc.tail.overlapBadge", { count: mergedTail.overlapCount })}</span>
            )}
          </>
        ) : activeBucket?.kind === "etf" ? (
          <>
            {activeEtfDay != null && (
              <span className="alloc-tail-etf-day">
                <span className="cap">{t("alloc.tail.etfToday")}</span> <Delta rate={activeEtfDay} />
              </span>
            )}
            <span className="sp" />
            {activeBucket.etfKey && (
              <button type="button" className="alloc-link" onClick={() => openFund(activeBucket.etfKey)}>
                {t("alloc.tail.manageFund")}
              </button>
            )}
          </>
        ) : (
          <>
            <span><b>{tailBucketLabel(activeBucket, t, allocationLabel)}</b> · {pct(activeBucket?.weight)} · {aud(activeBucket?.valueAud)}</span>
            {activeBucket?.subtitle && <span className="cap">{allocationLabel(activeBucket.subtitle)}</span>}
            <span className="sp" />
            {activeBucket?.kind === "opaque" && activeBucket.etfKey && (
              <button type="button" className="alloc-link" onClick={() => openFund(activeBucket.etfKey)}>
                {t("alloc.tail.manageFund")}
              </button>
            )}
          </>
        )}
      </div>

      {sectors.length > 0 && scopeTotalAud > 0 && (
        <div className="alloc-tail-sectors">
          <div className="row m0">
            <span className="alloc-tail-sec-title">{t("alloc.tail.sectorHeading")}</span>
            <span className="sp" />
            <span className="cap">{t("alloc.tail.sectorCoverage", { pct: pct(weight(scopeTotalAud)) })}</span>
          </div>
          <div className="alloc-sector-bar" role="group" aria-label={t("alloc.tail.sectorHeading")}>
            {sectors.map((s) => {
              const pctW = (s.valueAud / scopeTotalAud) * 100;
              if (pctW <= 0) return null;
              const active = sectorFilter === s.sector;
              const dimmed = Boolean(sectorFilter && !active);
              const label = allocationLabel(s.sector);
              return (
                <button
                  key={s.sector}
                  type="button"
                  className={active ? "on" : dimmed ? "dim" : undefined}
                  style={{ width: `${pctW}%`, background: sectorPalette.get(s.sector) }}
                  title={`${label} · ${t("alloc.tile.ofTotal", { pct: pct(s.weight) })} · ${aud(s.valueAud)}`}
                  aria-label={`${label} ${pct(s.weight)}`}
                  aria-pressed={active}
                  onClick={() => setSectorFilter((prev) => (prev === s.sector ? null : s.sector))}
                />
              );
            })}
          </div>
          <div className="alloc-sector-chips">
            {sectors.slice(0, 7).map((s) => {
              const active = sectorFilter === s.sector;
              return (
                <button
                  key={s.sector}
                  type="button"
                  className={active ? "on" : undefined}
                  aria-pressed={active}
                  onClick={() => setSectorFilter((prev) => (prev === s.sector ? null : s.sector))}
                >
                  <i style={{ background: active ? "var(--on-accent)" : sectorPalette.get(s.sector) }} />
                  <span>{allocationLabel(s.sector)} {pct(s.weight)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="row alloc-tail-toolbar">
        <input
          type="search"
          className="btn alloc-tail-search"
          aria-label={t("alloc.tail.searchPlaceholder")}
          placeholder={t("alloc.tail.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {sectorFilter && (
          <button type="button" className="btn sm" onClick={() => setSectorFilter(null)}>
            {t("alloc.tail.clearSector", { sector: allocationLabel(sectorFilter) })}
          </button>
        )}
        {isMerged && mergedTail.overlapCount > 0 && (
          <button
            type="button"
            className={"btn sm" + (overlapOnly ? " pri" : "")}
            aria-pressed={overlapOnly}
            onClick={() => setOverlapOnly((v) => !v)}
          >
            {t("alloc.tail.overlapOnly", { count: mergedTail.overlapCount })}
          </button>
        )}
        <span className="sp" />
        {(rawMembers.length > 0 || !showUnattributedRow) && (
          <span className="cap">{t("alloc.tail.countNote", { shown: visibleRows.length, total: filtered.length })}</span>
        )}
        <select
          className="btn sm"
          aria-label={t("alloc.tail.sortWeight")}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="weight">{t("alloc.tail.sortWeight")}</option>
          {!isMerged && activeBucket?.kind === "etf" && <option value="fundWeight">{t("alloc.tail.sortFundWeight")}</option>}
          <option value="sector">{t("alloc.tail.sortSector")}</option>
        </select>
      </div>

      <div className="alloc-tail-table-wrap">
        <Table
          head={[
            t("alloc.tail.colCompany"),
            [t("alloc.tail.colSector"), "left"],
            [t("alloc.tail.colSource"), "left"],
            t("alloc.tail.colBar"),
            [t("alloc.tail.colShare"), "num"],
            [!isMerged && activeBucket?.kind === "etf" ? t("alloc.tail.colFundWeight") : t("alloc.tail.colAmount"), "num"],
          ]}
        >
          {visibleRows.length === 0 && !showUnattributedRow ? (
            <tr>
              <td colSpan={6} className="alloc-tail-empty">{t("alloc.tail.noMatch")}</td>
            </tr>
          ) : (
            visibleRows.map((m) => {
              const sec = tailSector(m.sector);
              const secColor = sectorPalette.get(sec) || "var(--l3)";
              const sources = m.sources ?? [];
              return (
                <tr
                  key={m.key}
                  className={"click" + (chosen === m.key ? " sel" : "")}
                  onClick={() => choose(chosen === m.key ? null : m.key)}
                >
                  <td>
                    <button type="button" className="alloc-link">{m.ticker || m.label}</button>
                    {m.ticker && m.label !== m.ticker && <i className="alloc-tail-name">{m.label}</i>}
                  </td>
                  <td className="left">
                    <span className="alloc-tail-sec-cell">
                      <i style={{ background: secColor }} />
                      {allocationLabel(sec)}
                    </span>
                  </td>
                  <td className="left">
                    <span className={"tag" + (m.overlaps ? " overlap" : "")}>
                      {sources.map((s) => allocationLabel(s.key.startsWith("etf:") ? s.label : s.ticker)).join(" + ") || "—"}
                    </span>
                  </td>
                  <td>
                    <span className="alloc-tail-bar" aria-hidden="true">
                      {isMerged && sources.length > 1 ? (
                        sources.map((s) => (
                          <i
                            key={s.key}
                            style={{
                              width: `${Math.max(2, (s.valueAud / maxAud) * 100)}%`,
                              background: bucketColorMap.get(s.key) || secColor,
                            }}
                          />
                        ))
                      ) : (
                        <i style={{ width: `${Math.max(4, (m.valueAud / maxAud) * 100)}%`, background: secColor }} />
                      )}
                    </span>
                  </td>
                  <td className="num"><b>{pct(m.weight)}</b></td>
                  <td className="num">
                    {!isMerged && activeBucket?.kind === "etf" ? pct(m.fundWeight) : aud(m.valueAud, 2)}
                  </td>
                </tr>
              );
            })
          )}
          {showUnattributedRow && (
            <tr className="alloc-tail-unattributed">
              <td colSpan={4}>{t("alloc.tail.unattributed")}</td>
              <td className="num"><b>{pct(weight(unattributedAud))}</b></td>
              <td className="num">
                {!isMerged && activeKind === "etf"
                  ? pct(activeBucket?.etfTotalAud > 0 ? unattributedAud / activeBucket.etfTotalAud : null)
                  : aud(unattributedAud, 2)}
              </td>
            </tr>
          )}
        </Table>
      </div>
      {!showAll && filtered.length > visibleRows.length && (
        <div className="alloc-tail-more">
          <button type="button" className="btn sm" onClick={() => setShowAll(true)}>
            {t("alloc.tail.showAll", { count: filtered.length })}
          </button>
        </div>
      )}
    </div>
  );
}

function CompanyChart({ d, weight, holdings, openFund, chosen, choose, height }) {
  const { t, allocationLabel } = useI18n();
  const [view, setView] = useState("tree"),
    [color, setColor] = useState("day"),
    [tailScope, setTailScope] = useState(null);
  const totalAud = d.portfolio.totalAud;
  const { named, otherAud, otherBuckets, mergedTail, companies: topFive, waiting } = useMemo(
    () => buildComposition(d.exposure, totalAud),
    [d.exposure, totalAud],
  );
  const top = topFive[0], namedCompanies = named.filter((row) => row.type === "stock");
  const day = (key) => d.today?.companies?.[key] ?? null;

  const etfDayLookup = useMemo(() => {
    const byEtfKey = new Map();
    const etfKeyByHoldingId = new Map(d.rows.map((row) => [row.id, row.etfKey]));
    const todayDate = d.today?.date;
    const datedRate = (quote) => (!todayDate || quote?.date === todayDate) ? quote?.change ?? null : null;
    const rateFor = (row) => row.type === "etf"
      ? datedRate(row.today?.priceChange) ?? datedRate(row.quoteChange) : null;
    for (const s of d.holdings?.securities ?? []) {
      const key = etfKeyByHoldingId.get(s.rowIds?.[0]);
      const rate = rateFor(s);
      if (key && rate != null) byEtfKey.set(key, rate);
    }
    for (const r of d.rows ?? []) {
      const rate = rateFor(r);
      if (r.etfKey && rate != null && !byEtfKey.has(r.etfKey)) byEtfKey.set(r.etfKey, rate);
    }
    return byEtfKey;
  }, [d.holdings, d.rows, d.today?.date]);
  const etfDayChange = (key) => etfDayLookup.get(key) ?? null;

  const visibleOtherBuckets = useMemo(() => {
    const meaningful = otherBuckets.filter((b) => !(b.key === "residual" && (b.weight ?? 0) < 0.0005));
    return meaningful.length > 0 ? meaningful : otherBuckets;
  }, [otherBuckets]);
  const canMergeTail = otherBuckets.length > 1;
  const defaultTailScope = canMergeTail ? "ALL" : otherBuckets[0]?.key ?? null;

  useEffect(() => {
    if (tailScope == null) return;
    const validScope = tailScope === "ALL" ? canMergeTail : visibleOtherBuckets.some((b) => b.key === tailScope);
    if (!validScope) {
      setTailScope(defaultTailScope);
    }
  }, [canMergeTail, defaultTailScope, visibleOtherBuckets, tailScope]);

  useEffect(() => {
    if (view !== "tree" || tailScope == null || chosen) return undefined;
    const onKeyDown = (event) => {
      // A dialog above the view takes Esc first (matches Inspector in Shell.jsx).
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setTailScope(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, tailScope, chosen]);

  const splitTicker = (raw) => {
    const parts = String(raw || "").split(" / ");
    return { primaryTicker: parts[0], secondaryTicker: parts.slice(1).join(" / ") || null };
  };

  const tiles = named.map((row) => {
    const selectable = row.type === "stock";
    const change = day(row.key), name = allocationLabel(row.label), label = allocationLabel(row.ticker || row.label);
    const { primaryTicker, secondaryTicker } = row.type === "cash"
      ? { primaryTicker: label, secondaryTicker: null }
      : splitTicker(label);
    const share = row.weight < 0.0105 ? ">1%" : pct(row.weight);
    const sources = row.type !== "etf" && row.directAud >= 0 && row.viaEtfsAud >= 0
      ? {
          first: row.directAud,
          second: row.viaEtfsAud,
          title: t("alloc.tile.sourcesTitle", { direct: pct(weight(row.directAud)), etf: pct(weight(row.viaEtfsAud)) }),
        }
      : null;
    const directPct = row.totalAud > 0 && row.directAud >= 0 ? pct(row.directAud / row.totalAud) : null;
    const etfPct = row.totalAud > 0 && row.viaEtfsAud >= 0 ? pct(row.viaEtfsAud / row.totalAud) : null;
    const cashInfo = row.type === "cash" ? { cashAmount: aud(row.totalAud), cashBadge: "AUD / USD" } : {};
    return {
      id: row.key,
      label,
      primaryTicker,
      secondaryTicker,
      name,
      share,
      value: row.totalAud,
      selectable,
      cash: row.type === "cash",
      change,
      colorMode: color,
      sources,
      directPct,
      etfPct,
      ...cashInfo,
      detail: color === "day" && change != null ? [share, directedPct(change)] : [share],
      title: [
        name === label ? name : `${name} · ${label}`,
        t("alloc.tile.shareText", { share }),
        sources?.title,
        change != null && t("alloc.tile.todayText", { pct: directedPct(change) }),
      ].filter(Boolean).join(" · "),
    };
  }).sort((a, b) => b.value - a.value);

  if (otherAud > 0) {
    const subItems = visibleOtherBuckets.map((bucket, i) => {
      const isEtf = bucket.kind === "etf";
      const change = isEtf ? etfDayChange(bucket.etfKey) : null;
      const previewTickers = bucket.allMembers.slice(0, 3).map((m) => m.ticker || m.label).filter(Boolean);
      const preview = previewTickers.length > 0 ? `${previewTickers.join(" · ")}…` : undefined;
      return {
        id: bucket.key,
        label: allocationLabel(isEtf ? bucket.label : bucket.ticker),
        value: bucket.valueAud,
        share: pct(bucket.weight),
        inside: bucket.shareOfOther != null ? pct(bucket.shareOfOther) : undefined,
        accent: `var(--s${(i % 6) + 1})`,
        isEtf,
        change,
        colorMode: color,
        tailCountLabel: bucket.memberCount > 0 ? t("alloc.tail.itemsShort", { count: bucket.memberCount }) : undefined,
        preview,
        title: [
          tailBucketLabel(bucket, t, allocationLabel),
          t("alloc.tile.ofTotal", { pct: pct(bucket.weight) }),
          bucket.shareOfOther != null && t("alloc.tile.ofOther", { pct: pct(bucket.shareOfOther) }),
          change != null && t("alloc.tile.todayText", { pct: directedPct(change) }),
        ].filter(Boolean).join(" · "),
      };
    });
    tiles.push({
      id: "composition:other",
      label: t("alloc.tile.other"),
      value: otherAud,
      rest: true,
      selectable: visibleOtherBuckets.length > 0,
      detail: [pct(weight(otherAud))],
      subItems,
      mergeSubItems: canMergeTail,
      title: t("alloc.tile.otherTitle", { pct: pct(weight(otherAud)) }),
    });
  }

  const tileColor = (item) => {
    if (item.cash || item.bucketAccent) return {};
    if (color === "sources" && item.sources) {
      const split = item.sources.first / item.value * 100;
      return {
        background: `linear-gradient(90deg,var(--tm-how-direct) ${split}%,var(--tm-how-etf) ${split}%)`,
        color: "var(--tm-tile-text)",
      };
    }
    return color === "day" && item.change != null
      ? refinedTileColor(item.change * 100)
      : {
          background: "var(--tm-unquoted-bg)",
          color: "var(--tm-unquoted-text)",
          boxShadow: "inset 0 0 0 1px var(--tm-unquoted-border)",
        };
  };
  const handleSelectTile = (item) => {
    if (item.id === "composition:other") {
      choose(null);
      setTailScope(defaultTailScope);
      return;
    }
    choose(item.id);
  };

  return (
    <section className="card alloc-company" aria-labelledby="allocation-company-title">
      <div className="row">
        <h2 id="allocation-company-title">{t("alloc.chartTitle")}</h2>
        <span className="cap">{t("alloc.chartSubtitle")}</span>
        <span className="sp" />
        <Segmented
          label={t("alloc.viewAria")}
          items={[["tree", t("alloc.view.tree")], ["bars", t("alloc.view.bars")]]}
          value={view}
          select={(next) => {
            setView(next);
            if (next !== "tree") setTailScope(null);
          }}
        />
        {view === "tree" && tailScope == null && (
          <Segmented label={t("alloc.colorAria")} items={[["day", t("alloc.color.day")], ["sources", t("alloc.color.sources")]]} value={color} select={setColor} />
        )}
      </div>
      <dl className="alloc-company-stats">
        <div>
          <dt className="cap">{t("alloc.kpi.top1")}</dt>
          <dd title={top?.label}>{top ? `${allocationLabel(top.label)} ${pct(weight(top.totalAud))}` : "—"}</dd>
          {top && <span className="cap">{t("alloc.tile.sourcesTitle", { direct: pct(weight(top.directAud)), etf: pct(weight(top.viaEtfsAud)) })}</span>}
        </div>
        <div>
          <dt className="cap">{t("alloc.kpi.top5")}</dt>
          <dd>{pct(weight(sumBy(topFive, "totalAud")))}</dd>
          <span className="cap">{topFive.map((c) => c.ticker || allocationLabel(c.label)).join(t("common.comma"))}</span>
        </div>
        <div>
          <dt className="cap">{t("alloc.kpi.over1")}</dt>
          <dd>{totalAud > 0 ? t("alloc.kpi.over1Val", { count: namedCompanies.length, pct: pct(weight(sumBy(namedCompanies, "totalAud"))) }) : "—"}</dd>
        </div>
      </dl>
      <div>
        {!tiles.length ? (
          <Empty>{d.exposure.rows.length ? t("alloc.empty.cantCompute") : t("alloc.empty.noAssets")}</Empty>
        ) : view === "tree" ? (
          <>
            {tailScope == null ? (
              <Treemap
                items={tiles}
                height={height}
                color={tileColor}
                onSelect={handleSelectTile}
                onSelectSubItem={(id) => {
                  choose(null);
                  setTailScope(id);
                }}
                selected={chosen}
                refined
                layoutOptions={{ pinOtherRight: true, gap: 5 }}
              />
            ) : (
              <TailExplorer
                tailScope={tailScope}
                setTailScope={setTailScope}
                buckets={visibleOtherBuckets}
                canMergeTail={canMergeTail}
                mergedTail={mergedTail}
                otherAud={otherAud}
                etfDayChange={etfDayChange}
                weight={weight}
                openFund={openFund}
                chosen={chosen}
                choose={choose}
                height={height}
              />
            )}
            <div className="row alloc-chart-footer">
              <span className="cap">
                {tailScope == null ? t("alloc.footer.root") : t("alloc.tail.footer")}
              </span>
              <span className="sp" />
              {tailScope == null && (color === "day" ? <DailyKey /> : <ExposureKey />)}
            </div>
          </>
        ) : (
          <>
            <div className="row"><ExposureKey /></div>
            <CompanyBars
              items={tiles}
              select={(id) => {
                if (id === "composition:other") {
                  choose(null);
                  setTailScope(defaultTailScope);
                  setView("tree");
                } else {
                  choose(id);
                }
              }}
              selected={chosen}
            />
          </>
        )}
      </div>
      {!!waiting.length && (
        <div className="alloc-funds">
          <b>{t("alloc.waitingFunds")}</b>
          {waiting.map((r) => {
            const row = holdings.get(r.sources[0]?.holdingId);
            return (
              <div className="alloc-exposure-remainder" key={r.key}>
                {row?.etfKey ? <button className="alloc-link" type="button" onClick={() => openFund(row.etfKey)}>{r.ticker || row.ticker}</button> : <span>{r.ticker || t("alloc.fundFallback")}</span>}
                <span>{aud(r.totalAud, 2)} · {pct(weight(r.totalAud))}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const dimensionIds = ["sectors", "countries", "assets", "accounts", "currencies"];

function Distributions({ d, expanded, onExpand }) {
  const { t, allocationLabel } = useI18n();
  const open = expanded ?? false, p = d.portfolio;
  return (
    <details className="card alloc-distributions" open={open}>
      <summary onClick={(e) => { e.preventDefault(); onExpand(!open); }}>
        <h2>{t("alloc.distTitle")}</h2><span className="cap">{t("alloc.distSub")}</span>
      </summary>
      {open && (
        <div className="alloc-distribution-grid">
          {dimensionIds.map((key) => {
            const weight = p.totalAud > 0;
            const nodes = buildBreakdownNodes(key, p.instrumentAllocation, p.holdings, d.exposure, p.totalAud);
            const rows = nodes.map((r) => {
              const label = key === "accounts" ? r.label : allocationLabel(r.label);
              return {
                key: r.key,
                label,
                value: weight ? r.valueAud / p.totalAud : r.valueAud,
                muted: /现金|未分类|未穿透|其他|cash|unclassified|not looked|other/i.test(label),
                title: aud(r.valueAud, 2),
              };
            });
            return <section key={key}><h3>{t(`alloc.dim.${key}`)}</h3><RankedBars rows={rows} format={weight ? pct : aud} /></section>;
          })}
        </div>
      )}
    </details>
  );
}

function targetModel(d, weight, t) {
  const groups = Map.groupBy(d.rows, (r) => {
    switch (r.type) {
      case "etf": return r.identityKey;
      case "stock": return STOCKS_TARGET;
      case "cash": return CASH_TARGET;
      default: return OTHER_INVESTMENTS;
    }
  });
  const amount = (key) => {
    const group = groups.get(key) ?? [];
    return group.every((r) => r.audValue != null) ? sumBy(group, "audValue") : null;
  };
  const etfs = new Map(d.targetEtfs.map((r) => [r.key, r]));
  for (const r of d.rows.filter((r) => r.type === "etf")) {
    etfs.set(r.identityKey, { key: r.identityKey, label: r.ticker, name: r.name, holding: r, etfKey: r.etfKey });
  }
  const stocks = d.holdings.securities.filter((r) => r.type === "stock");
  const items = [...etfs.values()]
    .map((r) => ({ ...r, valueAud: amount(r.key) }))
    .sort((a, b) => (b.valueAud ?? -1) - (a.valueAud ?? -1));
  items.push(
    { key: STOCKS_TARGET, label: t("alloc.label.individualStocks"), name: t("alloc.stocksBucketName", { count: stocks.length }), members: stocks, valueAud: amount(STOCKS_TARGET) },
    { key: CASH_TARGET, label: t("alloc.label.cash"), name: t("alloc.cashBucketName", { count: d.byAccount.length }), valueAud: d.valuation ? d.valuation.cash : d.cash },
  );
  const model = buildRebalanceModel(items.map((r) => ({ ...r, weight: weight(r.valueAud) })), d.portfolio.totalAud, d.targets);
  const valueAud = amount(OTHER_INVESTMENTS);
  const other = valueAud ? { valueAud, weight: weight(valueAud) } : null;
  return { ...model, other };
}

function changeTrade(row, t) {
  return t(row.adjustmentAud > 0 ? "alloc.buy" : "alloc.sell", { amount: aud(Math.abs(row.adjustmentAud)) });
}

function driftText(drift, t) {
  if (drift === null) return "—";
  if (Math.abs(drift) <= Number.EPSILON) return t("alloc.drift.onTarget");
  return t(drift > 0 ? "alloc.drift.above" : "alloc.drift.below", { pp: fmt(Math.abs(drift) * 100, 1) });
}

function TargetCard({ d, model, holdings, weight, open, openFund, onPage }) {
  const { t } = useI18n();
  const { rows, tolerance, other, configured } = model;
  const outside = rows.filter((r) => r.status === "overweight" || r.status === "underweight");
  const worst = rows.reduce((largest, r) => r.drift != null && (!largest || Math.abs(r.drift) > Math.abs(largest.drift)) ? r : largest, null);
  const max = Math.min(1, Math.max(
    0.01,
    other?.weight ?? 0,
    ...rows.map((r) => Math.max(r.weight ?? 0, r.targetWeight == null ? 0 : r.targetWeight + tolerance)),
  ) * 1.05);
  const toleranceText = "±" + percentInput(tolerance) + " pp";
  return (
    <section className="card alloc-targets" aria-labelledby="allocation-target-title">
      <div className="row">
        <h2 id="allocation-target-title">{t("alloc.targets.title")}</h2>
        <span className="cap">{t("alloc.targets.sub")}</span>
        <span className="sp" />
        <button type="button" className="btn sm" onClick={open} disabled={!d.selected.length}>{t("alloc.targets.editBtn")}</button>
      </div>
      <div className={"alloc-target-summary" + (outside.length ? " outside" : "")}>
        {!configured ? (
          <b>{t("alloc.targets.unconfigured")}</b>
        ) : outside.length ? (
          <>
            <b>{t("alloc.targets.outsideCount", { count: outside.length })}</b>
            <span>{outside.map((r) => changeTrade(r, t) + " " + r.label).join(t("common.comma"))}</span>
          </>
        ) : (
          <b>{rows.every((r) => r.drift !== null) ? t("alloc.targets.allInside") : t("alloc.targets.computedInside")}</b>
        )}
        {worst && <small>{t("alloc.targets.worstDrift", { label: worst.label, drift: driftText(worst.drift, t) })}</small>}
      </div>
      <div className="alloc-target-grid">
        {rows.map((r) => {
          const out = r.status === "overweight" || r.status === "underweight";
          return (
            <section className="alloc-target-row" key={r.key} aria-label={r.label}>
              <div className="alloc-target-line">
                <div className="alloc-target-label">
                  {r.holding ? <button type="button" className="alloc-link" onClick={() => holdingPage(onPage, r.holding)}>{r.label}</button> : <b>{r.label}</b>}
                  {r.name && <span className="cap" title={r.name}>{r.name}</span>}
                </div>
                <span className="alloc-target-value"><b>{pct(r.weight)}</b><span className="cap">{t("alloc.targets.targetValue", { pct: pct(r.targetWeight) })}</span></span>
              </div>
              <BulletBar
                actual={r.weight} target={r.targetWeight} tolerance={tolerance} max={max}
                title={t("alloc.targets.bulletTitle", { actual: pct(r.weight), target: pct(r.targetWeight), tol: toleranceText })}
              />
              <div className="alloc-target-line">
                {r.drift != null ? (
                  <>
                    <span className={out ? "warn" : "cap"}>{driftText(r.drift, t)}</span>
                    <span className="cap">{out ? t("alloc.targets.outsideBand") : t("alloc.targets.insideBand")} {toleranceText}</span>
                    <span className="sp" />
                    {out ? <b>{changeTrade(r, t)}</b> : <span className="cap">{t("alloc.targets.noAction")}</span>}
                  </>
                ) : <span className="cap">{r.targetWeight == null ? t("alloc.targets.unconfigured") : "—"}</span>}
              </div>
              {!!r.members?.length && (
                <details className="alloc-members">
                  <summary>{t("alloc.targets.membersSummary", { count: r.members.length })}</summary>
                  <div>
                    {r.members.map((stock) => (
                      <button type="button" className="alloc-link" key={stock.key} aria-label={stock.ticker} onClick={() => holdingPage(onPage, holdings.get(stock.rowIds[0]))}>
                        {stock.ticker} <span className="cap">{pct(weight(stock.value))}</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
              {r.etfKey && <button className="alloc-link alloc-fund-link" type="button" aria-label={t("alloc.targets.fundBtnAria", { label: r.label })} onClick={() => openFund(r.etfKey)}>{t("alloc.targets.fundBtn")}</button>}
            </section>
          );
        })}
        {other && (
          <section className="alloc-target-row" aria-label={t("alloc.targets.otherInvestments")}>
            <div className="alloc-target-line">
              <b>{t("alloc.targets.otherInvestments")}</b><span className="sp" /><span><b>{pct(other.weight)}</b> <span className="cap">{aud(other.valueAud)}</span></span>
            </div>
            <BulletBar actual={other.weight} max={max} title={`${t("alloc.targets.otherInvestments")} ${aud(other.valueAud)}`} />
          </section>
        )}
      </div>
      <div className="alloc-key alloc-target-key">
        <span><i className="alloc-direct" />{t("alloc.targets.keyActual")}</span>
        <span><i className="alloc-target-tick" />{t("alloc.targets.keyTarget")}</span>
        <span><i className="alloc-target-band" />{t("alloc.targets.keyBand")}</span>
      </div>
    </section>
  );
}

const percentInput = (weight) => weight == null ? "" : String(Number((weight * 100).toPrecision(16)));

function TargetEditor({ d, model, run, close }) {
  const { t } = useI18n();
  const { rows } = model;
  const [values, setValues] = useState(() => Object.fromEntries(rows.map((r) => [r.key, percentInput(r.targetWeight)])));
  const [tolerance, setTolerance] = useState(() => percentInput(model.tolerance));
  const [saving, setSaving] = useState(false);
  const targets = Object.fromEntries(rows.map((r) => [r.key, Number(values[r.key] || 0) / 100]));
  const numbers = Object.values(targets);
  const total = numbers.reduce((sum, n) => sum + n, 0);
  const complete = fullTargetTotal(numbers);
  const valid = complete && numbers.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && Number(tolerance) >= 0.5 && Number(tolerance) <= 25;
  const canFill = rows.every((r) => r.weight != null && r.weight >= 0 && r.weight <= 1) && fullTargetTotal(rows.map((r) => r.weight));
  const active = d.byAccount.map((a) => a.name).join(t("common.comma"));
  async function submit(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    await run(async () => {
      await api.targets({ ids: d.selected, tolerance: Number(tolerance) / 100, targets });
      close();
    }, t("alloc.targets.saved"));
    setSaving(false);
  }
  return (
    <Modal title={t("alloc.targets.modalTitle")} close={close}>
      <form className="alloc-target-form" onSubmit={submit}>
        <p className="cap">{t("alloc.targets.modalDesc", { accounts: active })}</p>
        <Table head={[t("alloc.targets.colItem"), [t("alloc.targets.colActual"), "num"], [t("alloc.targets.colTarget"), "num"]]}>
          {rows.map((r) => (
            <tr key={r.key}>
              <td><b>{r.label}</b>{r.name && <small>{r.name}</small>}</td>
              <td className="num">{pct(r.weight)}</td>
              <td className="num">
                <input className="btn" type="number" aria-label={t("alloc.targets.inputAria", { label: r.label })} min="0" max="100" step="any"
                  value={values[r.key] ?? ""} onChange={(e) => setValues({ ...values, [r.key]: e.target.value })} disabled={saving}
                /> %
              </td>
            </tr>
          ))}
        </Table>
        <label className="alloc-tolerance">
          {t("alloc.targets.toleranceLabel")}
          <span>± <input className="btn" type="number" aria-label={t("alloc.targets.toleranceLabel")} min="0.5" max="25" step="any" required value={tolerance} onChange={(e) => setTolerance(e.target.value)} disabled={saving} /></span>
        </label>
        <div className="row">
          <span role="status" className={complete ? "up" : "warn"}>
            {t("alloc.targets.sumLabel")}<b>{fmt(total * 100, 2)}%</b>{!complete && t("alloc.targets.mustEqual100")}
          </span>
          <span className="sp" />
          {canFill && <button type="button" className="alloc-link" onClick={() => setValues(Object.fromEntries(rows.map((r) => [r.key, percentInput(r.weight)])))} disabled={saving}>{t("alloc.targets.fillCurrent")}</button>}
        </div>
        <div className="row m0">
          <button type="submit" className="btn pri" disabled={!valid || saving}>{saving ? t("alloc.targets.saving") : t("alloc.targets.saveBtn")}</button>
          <button type="button" className="btn" onClick={close}>{t("app.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Allocation({ d, run, onPage }) {
  const { t } = useI18n();
  const [fund, setFund] = useState(null), [expanded, setExpanded] = useState(null), [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState(null);
  const { aspect } = useShell();
  const scopeKey = d.selected.join();
  const chosen = selection?.scopeKey === scopeKey ? selection.key : null;
  const choose = (key) => setSelection(key == null ? null : { key, scopeKey });
  const holdings = new Map(d.rows.map((r) => [r.id, r]));
  const weight = (amount) => amount != null && d.portfolio.totalAud > 0 ? amount / d.portfolio.totalAud : null;
  const model = targetModel(d, weight, t);
  const companies = d.exposure.rows.filter((row) => row.type === "stock" && row.totalAud != null)
    .sort((a, b) => b.totalAud - a.totalAud);
  const current = d.exposure.rows.find((row) => row.key === chosen);
  return (
    <>
      <div className="allocation-studio">
        <CompanyChart key={scopeKey} d={d} weight={weight} holdings={holdings} openFund={setFund}
          chosen={chosen} choose={choose} height={aspect === "21:9" ? 500 : 430} />
        <div className="allocation-breakdown">
          <Card title={t("alloc.companyTableTitle")}>
            {companies.length ? (
              <Table head={[t("alloc.companyCol.name"), [t("alloc.companyCol.direct"), "num"], [t("alloc.companyCol.viaEtf"), "num"], [t("alloc.companyCol.share"), "num"]]}>
                {companies.map((row) => (
                  <tr key={row.key} className={row.key === chosen ? "sel" : undefined}>
                    <td><button className="alloc-link" type="button" onClick={() => choose(row.key)}>{row.label}</button></td>
                    <td className="num">{aud(row.directAud, 2)}</td>
                    <td className="num">{aud(row.viaEtfsAud, 2)}</td>
                    <td className="num">{pct(weight(row.totalAud))}</td>
                  </tr>
                ))}
              </Table>
            ) : <Empty>{t("alloc.companyEmpty")}</Empty>}
          </Card>
        </div>
      </div>
      <div className="allocation-maintenance">
        <TargetCard d={d} model={model} holdings={holdings} weight={weight} open={() => setEditing(true)} openFund={setFund} onPage={onPage} />
        <Distributions d={d} expanded={expanded} onExpand={setExpanded} />
      </div>
      {current && <CompanySources company={current} holdings={holdings} weight={weight}
        dayChange={d.today?.companies?.[current.key]} day={d.today?.date} onClose={() => choose(null)} onPage={onPage} />}
      {editing && <TargetEditor d={d} model={model} run={run} close={() => setEditing(false)} />}
      {fund && (
        <Modal
          wide
          title={t("alloc.fundModalTitle", { symbol: d.etfData.find((f) => f.asset.etfKey === fund)?.asset.symbol || "ETF" })}
          close={() => setFund(null)}
        >
          <FundData key={fund} d={d} run={run} initialFund={fund} />
        </Modal>
      )}
    </>
  );
}
