import React, { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { buildCoreSatelliteAllocation, buildBreakdownNodes } from "../allocation/domain/visualization";
import { buildRebalanceModel } from "../allocation/domain/rebalance";
import { HoldingEditor } from "./HoldingEditor";
import { api, aud, fmt, pct, num, kind, Card, Field, Modal, Tabs, Table, Empty } from "./common";
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
function FundData({ d, run, initialFund }) {
  const [text, setText] = useState(""),
    [date, setDate] = useState(d.date),
    [parsed, setParsed] = useState(null),
    [all, setAll] = useState(false),
    [dialog, setDialog] = useState("");
  const f = d.etfData.find((e) => e.asset.etfKey === initialFund) || d.etfData[0];
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
function WeightBar({ value, target = false }) {
  return (
    <span className={"weight-track" + (target ? " target" : "")} aria-hidden="true">
      <i style={{ width: Math.max(0, Math.min(100, (value || 0) * 100)) + "%" }} />
    </span>
  );
}

function AllocationLine({ label, note, value, weight, onClick }) {
  const title = (
    <>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </>
  );
  return (
    <div className="allocation-line">
      {onClick ? (
        <button className="line-title" onClick={onClick}>
          {title}
          <ArrowUpRight size={13} />
        </button>
      ) : (
        <div>{title}</div>
      )}
      <WeightBar value={weight} />
      <strong>{pct(weight)}</strong>
      <span className="allocation-money">{aud(value, 2)}</span>
    </div>
  );
}

const sectorLabel = (s) =>
  ({
    Technology: "科技",
    Financials: "金融",
    Healthcare: "医疗保健",
    Materials: "原材料",
    "Consumer Discretionary": "非必需消费",
    "Consumer Staples": "必需消费",
    Industrials: "工业",
    Energy: "能源",
    "Real Estate": "房地产",
    Utilities: "公用事业",
    "Communication Services": "通信服务",
    "Health Care": "医疗保健",
  })[s] ||
  s ||
  "行业待分类";

function CompanyView({ d }) {
  const [query, search] = useState(""),
    [chosen, choose] = useState(null);
  const { rows } = d.exposure,
    total = d.portfolio.totalAud;
  const weight = (v) => (total > 0 ? v / total : null);
  const companies = rows.filter((r) => r.type === "stock");
  const filtered = companies.filter((r) =>
    (r.label + " " + (r.ticker || "")).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const shown = query.trim() ? filtered : filtered.slice(0, 12);
  const tail = query.trim() ? [] : filtered.slice(12);
  const sectors = Map.groupBy(tail, (r) => sectorLabel(r.sector));
  const render = (r) => (
    <AllocationLine
      key={r.key}
      label={r.label}
      note={r.ticker}
      value={r.totalAud}
      weight={weight(r.totalAud)}
      onClick={() => choose(r)}
    />
  );
  const sourceGroups = Map.groupBy(chosen?.sources || [], (s) =>
    JSON.stringify([s.accountId, s.etfSymbol || ""]),
  );
  return (
    <Card
      title="实际投了哪些公司"
      action={
        <input
          aria-label="查找公司"
          placeholder="查找公司或代码"
          value={query}
          onChange={(e) => search(e.target.value)}
        />
      }
    >
      {shown.map(render)}
      {!shown.length && <Empty>没有符合条件的公司。</Empty>}
      {!query.trim() &&
        rows
          .filter((r) => r.type !== "stock" && r.type !== "cash")
          .map((r) => (
            <AllocationLine
              key={r.key}
              label={r.type === "etf" ? r.ticker || "基金" : lab(r.label)}
              note={r.type === "etf" ? "成分待更新" : kind[r.type]}
              value={r.totalAud}
              weight={weight(r.totalAud)}
              onClick={() => choose(r)}
            />
          ))}
      {!query.trim() && d.cash !== 0 && <div className="allocation-cash">
        <AllocationLine label="账户现金" value={d.cash} weight={d.cash != null ? weight(d.cash) : null}/>
      </div>}
      {!!tail.length && (
        <details className="company-tail">
          <summary>
            其余 {tail.length} 家公司 <span>{pct(weight(tail.reduce((n, r) => n + r.totalAud, 0)))}</span>
          </summary>
          {[...sectors].map(([sector, members]) => (
            <details key={sector}>
              <summary>
                {sector} · {members.length} 家
              </summary>
              {members.map(render)}
            </details>
          ))}
        </details>
      )}
      {chosen && (
        <Modal
          title={(chosen.type === "etf" ? chosen.ticker : lab(chosen.label)) + " · 持有来源"}
          close={() => choose(null)}
        >
          <strong>
            {aud(chosen.totalAud, 2)} · 占组合 {pct(weight(chosen.totalAud))}
          </strong>
          <Table head={["账户", "持有方式", ["金额（AUD）", "num"]]}>
            {[...sourceGroups].map(([key, group]) => (
              <tr key={key}>
                <td>{group[0].accountName}</td>
                <td>{group[0].etfSymbol ? "通过 " + group[0].etfSymbol + " 持有" : "直接持有"}</td>
                <td className="num">
                  {aud(
                    group.reduce((sum, s) => sum + s.amountAud, 0),
                    2,
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Modal>
      )}
    </Card>
  );
}

function Targets({ d, run }) {
  const hasStrategy =
    Object.keys(d.targets.targets).length || Object.keys(d.globalTargets?.strategy.targets || {}).length;
  const hasIndividual =
    Object.keys(d.instrumentTargets.targets).length ||
    Object.keys(d.globalTargets?.instruments.targets || {}).length;
  const [scope, setScope] = useState(hasStrategy && !hasIndividual ? "strategy" : "instruments");
  const [editKey, select] = useState(null),
    [input, setInput] = useState(""),
    [tolerance, setTolerance] = useState("");
  const settings = scope === "strategy" ? d.targets : d.instrumentTargets;
  const global = d.globalTargets?.[scope].targets || {};
  const accountLabel = d.globalTargets ? d.byAccount.map((a) => a.name).join("、") : "全部账户";
  const p = d.portfolio;
  const instruments = [...p.instrumentAllocation];
  for (const security of d.holdings.securities) {
    const row = d.rows.find((r) => r.id === security.rowIds[0]);
    if (!instruments.some((v) => v.key === row.identityKey))
      instruments.push({
        key: row.identityKey,
        label: row.ticker,
        type: row.type,
        valueAud: null,
        weight: null,
      });
  }
  const items = scope === "strategy" ? buildCoreSatelliteAllocation(instruments, p.totalAud) : instruments;
  if (scope === "strategy") {
    for (const row of d.rows.filter((r) => r.audValue == null)) {
      const key = row.type === "etf" ? row.identityKey : row.type === "cash" ? "strategy:cash" :
        row.type === "stock" ? "strategy:individual-stocks" : "strategy:other";
      const group = items.find((r) => r.key === key);
      if (group) group.weight = null;
      else items.push({ key, label: row.type === "stock" ? "个股合计" : row.type === "cash" ? "现金" : "其他投资", type:row.type, valueAud:null, weight:null });
    }
  }
  for (const key of new Set([...Object.keys(settings.targets), ...Object.keys(global)])) {
    if (items.some((r) => r.key === key)) continue;
    const holding = d.rows.find((r) => r.identityKey === key);
    const label =
      { "strategy:cash": "现金", "strategy:individual-stocks": "个股合计", "strategy:other": "其他投资" }[
        key
      ] ||
      holding?.ticker ||
      d.listings.find((a) => "asset:" + a.id === key)?.symbol ||
      key.split(":").at(-1);
    items.push({ key, label, valueAud: holding ? null : 0, weight: p.totalAud > 0 && !holding ? 0 : null });
  }
  const { rows } = buildRebalanceModel(items, p.totalAud, settings);
  rows.sort((a, b) => Number(a.type === "cash") - Number(b.type === "cash"));
  function start(r) {
    select(r.key);
    setInput(r.targetWeight == null ? "" : String(Number((r.targetWeight * 100).toFixed(6))));
    setTolerance(String(settings.tolerance * 100));
  }
  const editing = rows.find((r) => r.key === editKey);
  return (
    <Card title="配置目标" action={<span className="muted">{accountLabel} · 含现金</span>}>
      <Tabs
        items={[
          ["instruments", "逐只证券"],
          ["strategy", "按组设置"],
        ]}
        value={scope}
        onChange={setScope}
      />
      {!rows.length && <Empty>有持仓后可设置配置目标。</Empty>}
      {rows.map((r) => (
        <div className="target-row" key={r.key}>
          <div>
            <b>{lab(r.label)}</b>
            <small>
              {r.targetWeight != null
                ? r.drift == null
                  ? "待估值"
                  : Math.abs(r.drift) < 0.000001
                    ? "符合目标"
                    : (r.drift > 0 ? "高于" : "低于") +
                      "目标 " +
                      fmt(Math.abs(r.drift) * 100, 1) +
                      " 个百分点" +
                      (r.status === "on-target" ? " · 允许范围内" : "")
                : "未设当前范围目标"}
            </small>
          </div>
          <div className="paired-bars">
            <div>
              实际 <WeightBar value={r.weight} />
              <b>{pct(r.weight)}</b>
            </div>
            {r.targetWeight != null && (
              <div>
                目标 <WeightBar value={r.targetWeight} target />
                <b>{pct(r.targetWeight)}</b>
              </div>
            )}
            {global[r.key] != null && <small>全部账户目标 {pct(global[r.key])}</small>}
          </div>
          <button
            aria-label={lab(r.label) + " · " + (r.targetWeight == null ? "设定目标" : "编辑目标")}
            onClick={() => start(r)}
          >
            {r.targetWeight == null ? "设定目标" : "编辑目标"}
          </button>
        </div>
      ))}
      {editing && (
        <Modal title={lab(editing.label) + " · 配置目标"} close={() => select(null)}>
          <p>
            {accountLabel} · 实际占比 {pct(editing.weight)}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const targets = { ...settings.targets };
              if (input.trim() === "") delete targets[editKey];
              else targets[editKey] = Number(input) / 100;
              run(async () => {
                await api.targets({ scope, ids: d.selected, tolerance: Number(tolerance) / 100, targets });
                select(null);
              }, "配置目标已保存");
            }}
          >
            <Field label="目标占总资产（%，留空移除目标）">
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </Field>
            <details>
              <summary>允许偏离范围</summary>
              <Field label="允许偏离（百分点）">
                <input
                  type="number"
                  min=".5"
                  max="25"
                  required
                  step="any"
                  value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)}
                />
              </Field>
            </details>
            <button className="primary">保存目标</button>
          </form>
        </Modal>
      )}
    </Card>
  );
}

export function Allocation({ d, run, initial = {} }) {
  const [tab, setTab] = useState(initial.tab || "holdings"),
    [lens, setLens] = useState("sectors");
  const [chosen, choose] = useState(null),
    [fund, openFund] = useState(null),
    [repair, setRepair] = useState(null);
  const p = d.portfolio,
    weight = (v) => (v != null && p.totalAud > 0 ? v / p.totalAud : null);
  const selected = d.holdings.securities.find((g) => g.key === chosen);
  function open(g) {
    const row = d.rows.find((r) => g.rowIds.includes(r.id));
    if (row?.etfKey) openFund(row.etfKey);
    else choose(g.key);
  }
  return (
    <>
      <div className="page-controls">
        <Tabs
          items={[
            ["holdings", "我买的证券"],
            ["companies", "实际投了哪些公司"],
            ["targets", "配置目标"],
            ["breakdown", "其他分布"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {d.portfolio.totalAud == null && d.rows.length > 0 && (
        <p className="notice">
          组合占比需要完整的证券市值和现金余额。{d.issues[0]?.reason || "当前估值有待核对"}。
        </p>
      )}
      {tab === "holdings" && (
        <Card title="我买的证券" action={<span className="muted">按市值排序 · AUD</span>}>
          {d.holdings.securities.map((g) => (
            <AllocationLine
              key={g.key}
              label={g.ticker}
              note={[g.name, g.mic, g.localCurrency, g.type === "etf" && "查看基金成分"]
                .filter(Boolean)
                .join(" · ")}
              value={g.value}
              weight={weight(g.value)}
              onClick={() => open(g)}
            />
          ))}
          {!d.holdings.securities.length && <Empty>当前账户没有证券持仓。</Empty>}
          <div className="allocation-cash">
            <AllocationLine label="账户现金" value={d.cash} weight={weight(d.cash)} />
          </div>
        </Card>
      )}
      {tab === "companies" && <CompanyView key={d.selected.join()} d={d} />}
      {tab === "targets" && <Targets key={d.selected.join()} d={d} run={run} />}
      {tab === "breakdown" && (
        <Card
          title="组合分布"
          action={
            <select aria-label="分布维度" value={lens} onChange={(e) => setLens(e.target.value)}>
              {Object.entries({
                sectors: "行业",
                countries: "国家",
                assets: "资产类别",
                accounts: "账户",
                currencies: "币种",
              }).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          }
        >
          {buildBreakdownNodes(lens, p.instrumentAllocation, p.holdings, d.exposure, p.totalAud).map((r) => (
            <AllocationLine
              key={r.key}
              label={lens === "sectors" ? sectorLabel(lab(r.label)) : lab(r.label)}
              value={r.valueAud}
              weight={weight(r.valueAud)}
            />
          ))}
        </Card>
      )}
      {fund && (
        <Modal
          wide
          title={(d.etfData.find((f) => f.asset.etfKey === fund)?.asset.symbol || "ETF") + " · 基金成分"}
          close={() => openFund(null)}
        >
          <FundData d={d} run={run} initialFund={fund} />
        </Modal>
      )}
      {selected && (
        <Modal title={selected.ticker + " · 直接持有"} close={() => choose(null)}>
          {d.rows
            .filter((r) => selected.rowIds.includes(r.id))
            .map((r) => (
              <div className="actions" key={r.id}>
                <b>{r.accountName}</b> {num(r.quantity)} 股／份 · {aud(r.audValue, 2)}
                {r.type === "unknown" && <button onClick={() => setRepair(r)}>确认类别</button>}
              </div>
            ))}
        </Modal>
      )}
      {repair && <HoldingEditor d={d} run={run} action="type" row={repair} close={() => setRepair(null)} />}
    </>
  );
}
