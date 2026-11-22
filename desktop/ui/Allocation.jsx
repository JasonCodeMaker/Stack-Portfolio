import React, { useMemo, useState } from "react";
import { buildComposition } from "../allocation/domain/composition";
import { buildBreakdownNodes } from "../allocation/domain/visualization";
import { buildRebalanceModel, CASH_TARGET, fullTargetTotal, OTHER_INVESTMENTS, STOCKS_TARGET } from "../allocation/domain/rebalance";
import { api, aud, directedPct, fmt, pct, Card, Delta, Field, Modal, Table, Empty } from "./common";
import { BulletBar, RankedBars, StackedBar, Treemap, changeTileColor } from "./charts";
import { Detail, Grid, useMainChartHeight, useRowKeys, useShell } from "./Shell";
import "./allocation.css";
const labels = {
  "Individual stocks": "个股",
  Cash: "现金",
  "Other investments": "其他投资",
  "Other companies": "其他公司",
  "Other assets": "其他资产",
  "Bonds & fixed income": "债券与固收",
  "Fund holdings not available": "未取得成分的基金",
  Unclassified: "未分类",
  "Not looked through": "未穿透",
  Equity: "股票",
  "Fixed income": "固收",
  Derivatives: "衍生品",
  Other: "其他",
  "United States": "美国",
  Australia: "澳大利亚",
  Japan: "日本",
  "United Kingdom": "英国",
  Canada: "加拿大",
  "Mixed/Conflicting": "未分类",
};
const lab = (s) => labels[s] || String(s ?? "").replace(/^([A-Z]{3}) cash$/, "$1 现金");
const status = {
  Fresh: "最新",
  Stale: "已过期",
  Warning: "需要更新",
  Critical: "过期",
  Invalid: "无效",
  Missing: "缺少成分",
  Unsupported: "待手工补充",
};
function FundData({ d, run, initialFund }) {
  const [text, setText] = useState(""),
    [date, setDate] = useState(d.date),
    [parsed, setParsed] = useState(null),
    [all, setAll] = useState(false),
    [dialog, setDialog] = useState("");
  const f = d.etfData.find((e) => e.asset.etfKey === initialFund);
  if (!f) return <Empty>所选账户还没有 ETF。</Empty>;
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
      <Card title="基金成分与数据来源">
        <div className="mini-stats">
          <span>
            <b>{s?.provider || "—"}</b>数据来源
          </span>
          <span>
            <b>{s?.asOfDate || "—"}</b>成分日期
          </span>
          <span>
            <b>{pct(f.resolvedWeight)}</b>已覆盖权重
          </span>
          <span>
            <b>{status[f.status] || f.status}</b>成分状态
          </span>
        </div>
        <details><summary>更新或管理成分表</summary><div className="actions">
          <button onClick={() => run(() => api.fundRefresh({ asset: f.asset }), "基金成分已更新")}>
            刷新成分
          </button>
          <button disabled={!s} onClick={() => run(() => api.fundExport({ key }), false)}>
            导出 CSV
          </button>
          <button onClick={() => setDialog("import")}>导入或粘贴 CSV</button>
          <button disabled={!s} onClick={() => setDialog("disable")}>
            停用成分表
          </button>
        </div></details>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          展开权重不超过 1% 的成分
        </label>
        <Table head={["代码", "名称", "基金内权重", "行业", "国家"]}>
          {[...rows]
            .sort((a, b) => b.weight - a.weight)
            .map((r, i) => (
              <tr key={i}>
                <td>{r.symbol || "—"}</td>
                <td>{r.name}</td>
                <td>{pct(r.weight)}</td>
                <td>{r.sector || "—"}</td>
                <td>{r.country || "—"}</td>
              </tr>
            ))}
          {!all && small.length > 0 && (
            <tr>
              <td>其他</td>
              <td>
                {small.length} 项 · {f.asset.symbol}
              </td>
              <td>{pct(small.reduce((n, r) => n + r.weight, 0))}</td>
              <td>—</td>
              <td>—</td>
            </tr>
          )}
        </Table>
      </Card>
      {dialog === "disable" && (
        <Modal title={"停用 " + f.asset.symbol + " 成分表"} close={() => setDialog("")}>
          <p>该基金会保留在总资产中，等待新的成分数据。</p>
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                await api.fundDisable({ key });
                setDialog("");
              }, "成分表已停用")
            }
          >
            确认停用
          </button>
        </Modal>
      )}
      {dialog === "import" && (
        <Modal title={"导入 " + f.asset.symbol + " 成分"} close={() => setDialog("")}>
          <Field label="成分日期">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setParsed(null);
              }}
            />
          </Field>
          <Field label="粘贴 CSV（symbol 或 name，以及 weight）">
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
            <button onClick={() => check(true)}>选择 CSV 文件</button>
            <button onClick={() => check(false)}>预览粘贴数据</button>
          </div>
          {parsed && (
            <>
              <p>
                {parsed.rows.length} 行 · 权重合计 {pct(parsed.weightSum)} · {parsed.detectedUnit}
              </p>
              <p>{[...parsed.missingFields, ...parsed.issues, parsed.validation.message].join(" ")}</p>
              <Table head={["名称", "权重"]}>
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
                  }, "成分表已保存")
                }
              >
                确认保存成分表
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
const sectorLabels = {
  Technology: "科技",
  "Information Technology": "科技",
  Financials: "金融",
  Healthcare: "医疗保健",
  "Health Care": "医疗保健",
  Materials: "原材料",
  "Consumer Discretionary": "非必需消费",
  "Consumer Staples": "必需消费",
  Industrials: "工业",
  Energy: "能源",
  "Real Estate": "房地产",
  Utilities: "公用事业",
  Communication: "通信服务",
  "Communication Services": "通信服务",
};
const sectorLabel = (sector) => sectorLabels[sector] || (sector ? lab(sector) : "未分类");
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
  return <span className="alloc-key"><span><i className="alloc-direct" />直接持有</span><span><i className="alloc-via" />通过 ETF</span></span>;
}

const scaleSteps = [-3, -1.5, -0.25, 0.25, 1.5, 3];
function DailyKey() {
  return (
    <span className="alloc-scale" aria-label="今日涨跌幅从负 3% 至正 3%">
      −3% {scaleSteps.map((n) => <i key={n} style={{ background: changeTileColor(n).background }} />)} +3%
    </span>
  );
}

function CompanySources({ company, holdings, weight, dayChange, day, onClose, onPage }) {
  const groups = [...Map.groupBy(company.sources, (s) => holdings.get(s.holdingId)?.assetId ?? s.holdingId)];
  const rowKeys = useRowKeys(groups.filter(([, sources]) => holdings.has(sources[0].holdingId)).map(([key]) => key));
  return (
    <Detail title={company.label + (company.ticker ? " · " + company.ticker : "")} onClose={onClose}>
      <dl className="alloc-source-stats">
        <div>
          <dt>占总资产（穿透后）</dt>
          <dd>{pct(weight(company.totalAud))}</dd>
          <span className="cap">{aud(company.totalAud, 2)}</span>
        </div>
        <div>
          <dt>今日涨跌幅</dt>
          <dd><Delta rate={dayChange} /></dd>
          <span className="cap">{day}</span>
        </div>
      </dl>
      <p className="cap">这些钱从哪来</p>
      <Table head={["来源", ["占总资产", "num"], ["金额（AUD）", "num"]]} onKeyDown={rowKeys}>
        {groups.map(([key, sources]) => {
          const source = sources[0], holding = holdings.get(source.holdingId);
          const direct = source.kind === "direct";
          const label = direct ? "直接持有" : "通过 " + (holding?.ticker || source.etfSymbol) + " 持有";
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

function CompanyBars({ companies, others, weight, select, selected }) {
  const [query, setQuery] = useState("");
  const max = Math.max(1, companies[0]?.valueAud ?? 0);
  const text = query.trim().toLowerCase();
  const matches = (c) => (c.label + " " + (c.ticker || "")).toLowerCase().includes(text);
  const companyRow = (c) => (
    <button type="button" className="alloc-company-bar" key={c.key} aria-pressed={selected === c.key} onClick={() => select(c.key)}>
      <span title={c.label}>{c.label} <small>{c.ticker}</small></span>
      <StackedBar first={c.directAud} second={c.viaEtfsAud} max={max} title={"直接 " + pct(weight(c.directAud)) + " · 通过 ETF " + pct(weight(c.viaEtfsAud))} />
      <strong>{pct(weight(c.valueAud))}</strong>
    </button>
  );
  return (
    <>
      {companies.map(companyRow)}
      {!!others.length && (
        <details className="alloc-company-tail">
          <summary>其他公司 <span className="cap">{others.length} 家 · {pct(weight(sumBy(others, "valueAud")))}</span></summary>
          <input className="btn" aria-label="查找其他公司" placeholder="查找公司或代码" value={query} onChange={(e) => setQuery(e.target.value)} />
          {others.filter(matches).map(companyRow)}
        </details>
      )}
    </>
  );
}

function restItem(id, label, value, weight, title) {
  return { id, label, value, rest: true, detail: [pct(weight(value))], title };
}

function CompanyChart({ d, weight, holdings, onPage, openFund }) {
  const [view, setView] = useState("tree"), [color, setColor] = useState("day"), [chosen, choose] = useState(null);
  const [ref, height] = useMainChartHeight({ min: 320, max: 700, below: 38 });
  const { companies, tail, sectors, remaining, waiting } = useMemo(() => {
    const slices = buildComposition(d.exposure);
    const companies = slices.filter((c) => c.kind === "company");
    const remaining = slices.filter((c) => c.kind !== "company" && c.kind !== "other-companies" && c.kind !== "unresolved");
    const named = new Set(companies.map((c) => c.key));
    const tail = d.exposure.rows.filter((r) => r.type === "stock" && !named.has(r.key)).map((row) => ({
      ...row,
      valueAud: row.totalAud,
    }));
    const sectors = slices.find((slice) => slice.kind === "other-companies")?.bySector ?? [];
    const funds = d.exposure.rows.filter((r) => r.type === "etf");
    const waiting = funds.filter((r) => r.sources.some((s) => s.kind === "opaque"));
    const residual = funds.filter((r) => !waiting.includes(r));
    if (residual.length) remaining.push({ key: "fund-residual", label: "Not looked through", valueAud: sumBy(residual, "totalAud") });
    return { companies, tail, sectors, remaining, waiting };
  }, [d.exposure]);
  const top = companies[0], topFive = companies.slice(0, 5);
  const day = (key) => d.today?.companies?.[key] ?? null;

  const groups = new Map();
  const add = (sector, item) => {
    const label = sectorLabel(sector);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  };
  for (const company of companies) {
    const change = day(company.key), ticker = company.ticker || company.label;
    add(company.sector, {
      id: company.key,
      label: ticker,
      value: company.valueAud,
      direct: company.directAud,
      change,
      detail: color === "day" ? [pct(weight(company.valueAud)), directedPct(change)] : [pct(weight(company.valueAud))],
      title: `${company.label} · ${ticker} · 占总资产 ${pct(weight(company.valueAud))} · 直接 ${pct(weight(company.directAud))} + 通过 ETF ${pct(weight(company.viaEtfsAud))} · 今日 ${directedPct(change)}`,
    });
  }
  // Combine aliases which have the same displayed sector before drawing that sector's grey block.
  for (const [label, parts] of Map.groupBy(sectors, (r) => sectorLabel(r.sector))) {
    add(label, restItem("other:" + label, "其他", sumBy(parts, "valueAud"), weight, label + " · 其他 " + sumBy(parts, "count") + " 家"));
  }
  const neutral = remaining.map((r) => restItem(r.key, lab(r.label), r.valueAud, weight));
  const missing = waiting.map((r) => restItem(r.key, r.ticker || "基金", r.totalAud, weight, (r.ticker || "基金") + " · 成分待更新"));
  if (neutral.length) groups.set("未穿透与现金", neutral);
  if (missing.length) groups.set("成分待更新", missing);
  const tree = [...groups].map(([label, items]) => ({ key: label, label, caption: pct(weight(sumBy(items, "value"))), items }));
  const tileColor = (item) => {
    if (color === "sources") {
      const split = item.direct / item.value * 100;
      return { background: `linear-gradient(90deg,var(--s1) ${split}%,var(--s2) ${split}%)`, color: "var(--alloc-source-ink)" };
    }
    return item.change == null ? { background: "var(--tz)", color: "var(--l1)" } : changeTileColor(item.change * 100);
  };
  const current = d.exposure.rows.find((r) => r.key === chosen);

  return (
    <section className="card alloc-company" aria-labelledby="allocation-company-title">
      <div className="row">
        <h2 id="allocation-company-title">钱最终投在哪些公司</h2>
        <span className="cap">穿透 ETF 后，占总资产</span>
        <span className="sp" />
        <Segmented label="公司敞口图" items={[["tree", "方框图"], ["bars", "条形"]]} value={view} select={setView} />
        {view === "tree" && <Segmented label="方框着色" items={[["day", "今日涨跌"], ["sources", "持有方式"]]} value={color} select={setColor} />}
      </div>
      <dl className="alloc-company-stats">
        <div>
          <dt className="cap">最大单一公司</dt>
          <dd title={top?.label}>{top ? top.label + " " + pct(weight(top.valueAud)) : "—"}</dd>
          {top && <span className="cap">直接 {pct(weight(top.directAud))} + 通过 ETF {pct(weight(top.viaEtfsAud))}</span>}
        </div>
        <div>
          <dt className="cap">前五大公司合计</dt>
          <dd>{pct(weight(sumBy(topFive, "valueAud")))}</dd>
          <span className="cap">{topFive.map((c) => c.ticker || c.label).join("、")}</span>
        </div>
        <div>
          <dt className="cap">逐家列出</dt>
          <dd>{companies.length} 家，共 {pct(weight(sumBy(companies, "valueAud")))}</dd>
          {!!tail.length && <span className="cap">其余 {tail.length} 家合计 {pct(weight(sumBy(tail, "valueAud")))}，按行业并成灰块</span>}
        </div>
      </dl>
      <div ref={ref}>
        {view === "tree" ? (
          <>
            {tree.length ? (
              <Treemap groups={tree} height={height} color={tileColor} title={(item) => item.title} onSelect={(item) => choose(item.id)} selected={chosen} />
            ) : <Empty>所选账户暂无公司敞口。</Empty>}
            {!!tree.length && (
              <div className="row alloc-chart-footer">
                <span className="cap">方框越大，占比越高。点方框查看来源。</span>
                <span className="sp" />
                {color === "sources" ? <ExposureKey /> : <DailyKey />}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="row"><ExposureKey /></div>
            {companies.length ? (
              <CompanyBars companies={companies} others={tail} weight={weight} select={choose} selected={chosen} />
            ) : <Empty>所选账户暂无公司敞口。</Empty>}
            {remaining.map((r) => <div className="alloc-exposure-remainder cap" key={r.key}>{lab(r.label)} <span>{pct(weight(r.valueAud))}</span></div>)}
          </>
        )}
      </div>
      {!!waiting.length && (
        <div className="alloc-funds">
          <b>成分待更新</b>
          {waiting.map((r) => {
            const row = holdings.get(r.sources[0]?.holdingId);
            return (
              <div className="alloc-exposure-remainder" key={r.key}>
                {row?.etfKey ? <button className="alloc-link" type="button" onClick={() => openFund(row.etfKey)}>{r.ticker || row.ticker}</button> : <span>{r.ticker || "基金"}</span>}
                <span>{aud(r.totalAud, 2)} · {pct(weight(r.totalAud))}</span>
              </div>
            );
          })}
        </div>
      )}
      {current && <CompanySources company={current} holdings={holdings} weight={weight} dayChange={day(current.key)} day={d.today?.date} onClose={() => choose(null)} onPage={onPage} />}
    </section>
  );
}

const dimensions = [
  ["sectors", "行业"],
  ["countries", "国家"],
  ["assets", "资产类别"],
  ["accounts", "账户"],
  ["currencies", "币种"],
];

function Distributions({ d, expanded, onExpand }) {
  const { cols } = useShell();
  const open = expanded ?? cols === 3, p = d.portfolio;
  return (
    <details className="card alloc-distributions" open={open}>
      <summary onClick={(e) => { e.preventDefault(); onExpand(!open); }}>
        <h2>其他分布</h2><span className="cap">行业、国家、资产类别、账户、币种</span>
      </summary>
      {open && (
        <div className="alloc-distribution-grid">
          {dimensions.map(([key, title]) => {
            const weight = p.totalAud > 0;
            const nodes = buildBreakdownNodes(key, p.instrumentAllocation, p.holdings, d.exposure, p.totalAud);
            const rows = nodes.map((r) => {
              const label = key === "sectors" ? sectorLabel(r.label) : key === "accounts" ? r.label : lab(r.label);
              return { key: r.key, label, value: weight ? r.valueAud / p.totalAud : r.valueAud, muted: /现金|未分类|未穿透|其他/.test(label), title: aud(r.valueAud, 2) };
            });
            return <section key={key}><h3>{title}</h3><RankedBars rows={rows} format={weight ? pct : aud} /></section>;
          })}
        </div>
      )}
    </details>
  );
}

function targetModel(d, weight) {
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
    { key: STOCKS_TARGET, label: "个股", name: stocks.length + " 只个股合计", members: stocks, valueAud: amount(STOCKS_TARGET) },
    { key: CASH_TARGET, label: "现金", name: d.byAccount.length + " 个账户合计", valueAud: d.valuation ? d.valuation.cash : d.cash },
  );
  const model = buildRebalanceModel(items.map((r) => ({ ...r, weight: weight(r.valueAud) })), d.portfolio.totalAud, d.targets);
  const valueAud = amount(OTHER_INVESTMENTS);
  const other = valueAud ? { valueAud, weight: weight(valueAud) } : null;
  return { ...model, other };
}

function changeTrade(row) {
  return (row.adjustmentAud > 0 ? "买入 " : "卖出 ") + aud(Math.abs(row.adjustmentAud));
}

function driftText(drift) {
  if (drift === null) return "—";
  if (Math.abs(drift) <= Number.EPSILON) return "符合目标";
  return (drift > 0 ? "高于目标 " : "低于目标 ") + fmt(Math.abs(drift) * 100, 1) + " 个百分点";
}

function TargetCard({ d, model, holdings, weight, open, openFund, onPage }) {
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
        <h2 id="allocation-target-title">离目标差多少</h2>
        <span className="cap">每只 ETF、个股、现金</span>
        <span className="sp" />
        <button type="button" className="btn sm" onClick={open} disabled={!d.selected.length}>设置目标</button>
      </div>
      <div className={"alloc-target-summary" + (outside.length ? " outside" : "")}>
        {!configured ? (
          <b>未设当前范围目标</b>
        ) : outside.length ? (
          <><b>{outside.length} 项超出允许范围</b><span>{outside.map((r) => changeTrade(r) + " " + r.label).join("，")}</span></>
        ) : (
          <b>{rows.every((r) => r.drift !== null) ? "都在允许范围内" : "已计算偏离的项目都在允许范围内"}</b>
        )}
        {worst && <small>最大偏离 {worst.label} · {driftText(worst.drift)}</small>}
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
                <span className="alloc-target-value"><b>{pct(r.weight)}</b><span className="cap">目标 {pct(r.targetWeight)}</span></span>
              </div>
              <BulletBar
                actual={r.weight} target={r.targetWeight} tolerance={tolerance} max={max}
                title={"实际 " + pct(r.weight) + " · 目标 " + pct(r.targetWeight) + " · 允许偏离 " + toleranceText}
              />
              <div className="alloc-target-line">
                {r.drift != null ? (
                  <>
                    <span className={out ? "warn" : "cap"}>{driftText(r.drift)}</span>
                    <span className="cap">{out ? "超出允许偏离" : "在允许偏离内"} {toleranceText}</span>
                    <span className="sp" />
                    {out ? <b>{changeTrade(r)}</b> : <span className="cap">不用调</span>}
                  </>
                ) : <span className="cap">{r.targetWeight == null ? "未设当前范围目标" : "—"}</span>}
              </div>
              {!!r.members?.length && (
                <details className="alloc-members">
                  <summary>看这 {r.members.length} 只个股</summary>
                  <div>
                    {r.members.map((stock) => (
                      <button type="button" className="alloc-link" key={stock.key} aria-label={stock.ticker} onClick={() => holdingPage(onPage, holdings.get(stock.rowIds[0]))}>
                        {stock.ticker} <span className="cap">{pct(weight(stock.value))}</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
              {r.etfKey && <button className="alloc-link alloc-fund-link" type="button" aria-label={r.label + " 基金成分"} onClick={() => openFund(r.etfKey)}>基金成分</button>}
            </section>
          );
        })}
        {other && (
          <section className="alloc-target-row" aria-label="其他投资">
            <div className="alloc-target-line">
              <b>其他投资</b><span className="sp" /><span><b>{pct(other.weight)}</b> <span className="cap">{aud(other.valueAud)}</span></span>
            </div>
            <BulletBar actual={other.weight} max={max} title={"其他投资 " + aud(other.valueAud)} />
          </section>
        )}
      </div>
      <div className="alloc-key alloc-target-key">
        <span><i className="alloc-direct" />实际</span>
        <span><i className="alloc-target-tick" />目标</span>
        <span><i className="alloc-target-band" />允许偏离</span>
      </div>
    </section>
  );
}

const percentInput = (weight) => weight == null ? "" : String(Number((weight * 100).toPrecision(16)));

function TargetEditor({ d, model, run, close }) {
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
  const active = d.byAccount.map((a) => a.name).join("、");
  async function submit(e) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    await run(async () => {
      await api.targets({ ids: d.selected, tolerance: Number(tolerance) / 100, targets });
      close();
    }, "配置目标已保存");
    setSaving(false);
  }
  return (
    <Modal title="设置目标" close={close}>
      <form className="alloc-target-form" onSubmit={submit}>
        <p className="cap">{active} · 按含现金总资产计算。目标合计须等于 100%。</p>
        <Table head={["项目", ["实际", "num"], ["目标", "num"]]}>
          {rows.map((r) => (
            <tr key={r.key}>
              <td><b>{r.label}</b>{r.name && <small>{r.name}</small>}</td>
              <td className="num">{pct(r.weight)}</td>
              <td className="num">
                <input className="btn" type="number" aria-label={r.label + " 目标（%）"} min="0" max="100" step="any"
                  value={values[r.key] ?? ""} onChange={(e) => setValues({ ...values, [r.key]: e.target.value })} disabled={saving}
                /> %
              </td>
            </tr>
          ))}
        </Table>
        <label className="alloc-tolerance">
          允许偏离（百分点）
          <span>± <input className="btn" type="number" aria-label="允许偏离（百分点）" min="0.5" max="25" step="any" required value={tolerance} onChange={(e) => setTolerance(e.target.value)} disabled={saving} /></span>
        </label>
        <div className="row">
          <span role="status" className={complete ? "up" : "warn"}>
            合计 <b>{fmt(total * 100, 2)}%</b>{!complete && " · 须等于 100%"}
          </span>
          <span className="sp" />
          {canFill && <button type="button" className="alloc-link" onClick={() => setValues(Object.fromEntries(rows.map((r) => [r.key, percentInput(r.weight)])))} disabled={saving}>按现在的占比填</button>}
        </div>
        <div className="row m0">
          <button type="submit" className="btn pri" disabled={!valid || saving}>{saving ? "正在保存…" : "保存目标"}</button>
          <button type="button" className="btn" onClick={close}>取消</button>
        </div>
      </form>
    </Modal>
  );
}

export function Allocation({ d, run, onPage }) {
  const [fund, setFund] = useState(null), [expanded, setExpanded] = useState(null), [editing, setEditing] = useState(false);
  const holdings = new Map(d.rows.map((r) => [r.id, r]));
  const weight = (amount) => amount != null && d.portfolio.totalAud > 0 ? amount / d.portfolio.totalAud : null;
  const model = targetModel(d, weight);
  return (
    <>
      <Grid
        layout={{ 1: [["companies", "targets", "distributions"]], 2: [["companies", "distributions"], ["targets"]], 3: [["companies"], ["targets"], ["distributions"]] }}
        panels={{
          companies: <CompanyChart key={d.selected.join()} d={d} weight={weight} holdings={holdings} openFund={setFund} onPage={onPage} />,
          targets: <TargetCard d={d} model={model} holdings={holdings} weight={weight} open={() => setEditing(true)} openFund={setFund} onPage={onPage} />,
          distributions: <Distributions d={d} expanded={expanded} onExpand={setExpanded} />,
        }}
      />
      {editing && <TargetEditor d={d} model={model} run={run} close={() => setEditing(false)} />}
      {fund && (
        <Modal wide title={(d.etfData.find((f) => f.asset.etfKey === fund)?.asset.symbol || "ETF") + " · 基金成分"} close={() => setFund(null)}>
          <FundData key={fund} d={d} run={run} initialFund={fund} />
        </Modal>
      )}
    </>
  );
}
