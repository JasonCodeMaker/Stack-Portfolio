import React, { useState } from "react";
import { ArrowUpRight, Layers3, SlidersHorizontal } from "lucide-react";
import { buildCoreSatelliteAllocation, buildBreakdownNodes } from "../../src/domain/visualization";
import { buildRebalanceModel } from "../../src/domain/rebalance";
import { buildComposition, buildPlanRows } from "../../src/domain/composition";
import { squarify } from "../../src/domain/compositionLayout";
import { api, aud, fmt, pct, num, kind, signedPct, Card, Field, Modal, Tabs, Table, Empty } from "./common";
const labels = {
  "Individual stocks": "个股合计",
  Cash: "现金",
  "Other investments": "其他投资",
  "Other companies": "其他公司",
  "Other assets": "其他资产",
  "Bonds & fixed income": "债券与固收",
  "Fund holdings not available": "未取得成分的基金",
  Unclassified: "未分类",
  "Not looked through": "未穿透",
  Stock: "股票",
  ETF: "ETF",
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
function FundData({ d, run }) {
  const [id, select] = useState(d.etfData[0]?.asset.etfKey || ""),
    [text, setText] = useState(""),
    [date, setDate] = useState(d.date),
    [parsed, setParsed] = useState(null),
    [all, setAll] = useState(false),
    [dialog, setDialog] = useState("");
  const f = d.etfData.find((e) => e.asset.etfKey === id) || d.etfData[0];
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
      <Card
        title="基金成分与数据来源"
        action={
          <select
            aria-label="选择基金"
            value={key}
            onChange={(e) => {
              select(e.target.value);
              setParsed(null);
              setText("");
            }}
          >
            {d.etfData.map((e) => (
              <option key={e.asset.etfKey} value={e.asset.etfKey}>
                {e.asset.symbol}
              </option>
            ))}
          </select>
        }
      >
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
        <div className="actions">
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
        </div>
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
export function Allocation({ d, run, initial = {} }) {
  const [tab, setTab] = useState(initial.tab || "exposure"),
    [lens, setLens] = useState("companies"),
    [chosen, setChosen] = useState(null),
    [target, setTarget] = useState(null),
    [tol, setTol] = useState("5"),
    [q, setQ] = useState(""),
    [limit, setLimit] = useState(15);
  const [targetScope, setTargetScope] = useState("strategy");
  const targetSettings = targetScope === "strategy" ? d.targets : d.instrumentTargets || d.targets;
  const p = d.portfolio,
    e = d.exposure,
    units =
      targetScope === "strategy"
        ? buildCoreSatelliteAllocation(p.instrumentAllocation, p.totalAud)
        : p.instrumentAllocation,
    reb = buildRebalanceModel(units, p.totalAud, targetSettings),
    plan = buildPlanRows(reb, p.instrumentAllocation);
  const slices = buildComposition(e, 12),
    tiles = squarify(slices, { x: 0, y: 0, w: 900, h: 220 });
  const nodes =
    lens === "companies"
      ? e.rows.map((r) => ({ ...r, valueAud: r.totalAud, weight: r.portfolioWeight }))
      : buildBreakdownNodes(lens, p.instrumentAllocation, p.holdings, e, p.totalAud);
  const weights = nodes.filter((r) => r.type === "stock").sort((a, b) => b.valueAud - a.valueAud);
  const listed = nodes.filter(
    (n) =>
      lens !== "companies" || ((n.label || "") + " " + (n.ticker || "")).toLowerCase().includes(q.toLowerCase()),
  );
  function startTargets() {
    setTarget(
      Object.fromEntries(units.map((r) => [r.key, String((targetSettings.targets[r.key] || 0) * 100)])),
    );
    setTol(String(targetSettings.tolerance * 100));
  }
  return (
    <>
      <div className="page-controls">
        <Tabs
          items={[
            ["exposure", "穿透与分布"],
            ["targets", "配置目标"],
            ["funds", "ETF 成分"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "exposure" && (
        <>
          <Card title="组合构成" action={<span className="muted">可穿透资产覆盖率 {pct(e.coverage)}</span>}>
            {tiles.length ? (
              <div className="mosaic">
                {tiles.map((t, i) => (
                  <button
                    key={t.key}
                    className={"tile shade" + (i % 6)}
                    style={{
                      left: t.x / 9 + "%",
                      top: t.y / 2.2 + "%",
                      width: t.w / 9 + "%",
                      height: t.h / 2.2 + "%",
                    }}
                    title={lab(t.label) + " · " + aud(t.valueAud)}
                    onClick={() => setChosen(t)}
                  >
                    {t.w > 70 && t.h > 25 && (
                      <>
                        <strong>{lab(t.ticker || t.label)}</strong>
                        {t.h > 42 && <small>{aud(t.valueAud)}</small>}
                      </>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <Empty>没有可估值的持仓。</Empty>
            )}
            <div className="legend">
              <span>面积按已估值金额计算</span>
              <span>直接持股与各 ETF 贡献可点开查看</span>
            </div>
          </Card>
          <Card
            title="配置明细"
            action={
              <select
                aria-label="分析维度"
                value={lens}
                onChange={(ev) => {
                  setLens(ev.target.value);
                  setLimit(15);
                }}
              >
                {Object.entries({
                  companies: "公司",
                  holdings: "买入的证券",
                  sectors: "行业",
                  countries: "国家",
                  assets: "资产类别",
                  accounts: "账户",
                  currencies: "持仓币种",
                }).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            }
          >
            {lens === "companies" && (
              <div className="toolbar">
                <input
                  placeholder="筛选公司或证券"
                  aria-label="筛选公司"
                  value={q}
                  onChange={(ev) => setQ(ev.target.value)}
                />
                <span className="muted">
                  前五大公司占组合{" "}
                  {pct(
                    p.totalAud ? weights.slice(0, 5).reduce((s, r) => s + r.valueAud, 0) / p.totalAud : null,
                  )}
                </span>
              </div>
            )}
            <Table head={["名称", ["直接持有", "num"], ["通过 ETF", "num"], ["合计（AUD）", "num"], ["组合占比", "num"]]}>
              {listed.slice(0, q ? listed.length : limit).map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.sources ? (
                      <button className="text-btn" onClick={() => setChosen(r)}>
                        {lab(r.label)} <ArrowUpRight size={13} />
                      </button>
                    ) : (
                      lab(r.label)
                    )}
                  </td>
                  <td className="num">{aud(r.directAud)}</td>
                  <td className="num">{aud(r.viaEtfsAud)}</td>
                  <td className="num">{aud(r.valueAud, 2)}</td>
                  <td className="num">{pct(p.totalAud == null ? null : r.weight)}</td>
                </tr>
              ))}
            </Table>
            {!q && listed.length > limit && (
              <div className="actions">
                <button onClick={() => setLimit(listed.length)}>显示全部 {listed.length} 项</button>
                <span className="muted">已列出占比最高的 {limit} 项</span>
              </div>
            )}
          </Card>
        </>
      )}
      {tab === "targets" && (
        <Card
          title="持仓与目标权重"
          action={
            <button className="primary" disabled={!units.length} onClick={startTargets}>
              <SlidersHorizontal size={15} />
              编辑目标
            </button>
          }
        >
          <div className="toolbar">
            <Tabs
              items={[
                ["strategy", "ETF、个股组和现金组"],
                ["instruments", "逐只证券与现金"],
              ]}
              value={targetScope}
              onChange={setTargetScope}
            />
            <span className="muted">允许偏离 ±{pct(targetSettings.tolerance)}</span>
          </div>
          <Table head={["配置项", ["实际", "num"], ["目标", "num"], ["偏离", "num"], "状态", ["回到目标需要", "num"]]}>
            {plan.map((r) => {
              const off = ["underweight", "overweight"].includes(r.status);
              return (
                <tr key={r.key}>
                  <td>
                    {lab(r.label)}
                    <small>{r.children.map((x) => lab(x.label)).join(" · ")}</small>
                  </td>
                  <td className="num">{pct(r.weight)}</td>
                  <td className="num">{pct(r.targetWeight)}</td>
                  <td className={"num " + (off ? "warning" : "")}>{r.drift == null ? "—" : signedPct(r.drift, 1)}</td>
                  <td>
                    {
                      {
                        underweight: "低于目标",
                        overweight: "高于目标",
                        "on-target": "范围内",
                        unconfigured: "待设置",
                      }[r.status]
                    }
                  </td>
                  <td className="num">
                    {r.adjustmentAud == null || !off
                      ? "—"
                      : (r.adjustmentAud > 0 ? "买入 " : "卖出 ") + aud(Math.abs(r.adjustmentAud), 2)}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
      {tab === "funds" && <FundData d={d} run={run} />}
      {chosen && (
        <Modal title={lab(chosen.label) + " · 来源"} close={() => setChosen(null)}>
          <dl>
            <dt>直接持有</dt>
            <dd>{aud(chosen.directAud, 2)}</dd>
            <dt>通过 ETF</dt>
            <dd>{aud(chosen.viaEtfsAud, 2)}</dd>
          </dl>
          <Table head={["账户", "贡献来源", "金额"]}>
            {chosen.sources.map((s, i) => (
              <tr key={i}>
                <td>{s.accountName}</td>
                <td>{s.kind === "direct" ? "直接持有" : s.path?.join(" → ") || s.etfSymbol || s.reason}</td>
                <td>{aud(s.amountAud, 2)}</td>
              </tr>
            ))}
          </Table>
        </Modal>
      )}
      {target && (
        <Modal title="编辑配置目标" close={() => setTarget(null)}>
          <div className="form-grid">
            {units.map((r) => (
              <Field key={r.key} label={lab(r.label) + " (%)"}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step=".1"
                  value={target[r.key]}
                  onChange={(ev) => setTarget({ ...target, [r.key]: ev.target.value })}
                />
              </Field>
            ))}
            <Field label="允许偏离（百分点）">
              <input
                type="number"
                min=".5"
                max="25"
                step=".5"
                value={tol}
                onChange={(ev) => setTol(ev.target.value)}
              />
            </Field>
          </div>
          <div className="actions">
            <b>
              合计{" "}
              {fmt(
                Object.values(target).reduce((n, v) => n + Number(v), 0),
                1,
              )}
              %
            </b>
            <button
              className="primary"
              onClick={() =>
                run(async () => {
                  await api.targets({
                    scope: targetScope,
                    schemaVersion: 1,
                    tolerance: Number(tol) / 100,
                    targets: Object.fromEntries(Object.entries(target).map(([k, v]) => [k, Number(v) / 100])),
                  });
                  setTarget(null);
                }, "配置目标已保存")
              }
            >
              保存目标
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
