import React, { useEffect, useState, useRef } from "react";
import { FileUp, CloudDownload, FileText } from "lucide-react";
import { HoldingEditor, SecurityFields, listingLabel, marketNames } from "./HoldingEditor";
import { BrokerResult } from "./ImportPreview";
import { Detail, Grid, useRowKeys, useShell } from "./Shell";
import { checkLayout, quantityGaps, syncLayout } from "./importsLayout.js";
import { api, num, fmt, types, Empty, Modal } from "./common";
import "./imports.css";

const blank = {
  type: "DEPOSIT",
  currency: "AUD",
  amount: "",
  date: "",
  reference: "",
  note: "",
  symbol: "",
  quantity: "",
  price: "",
  mic: "",
  fee: "0",
  kind: "EQUITY",
  group: "",
};
const tabs = [
  ["file", "记录与同步"],
  ["check", "和券商结单核对"],
  ["history", "交易流水"],
  ["opening", "从这一天开始记录"],
];
const brokerTabs = [
  ["both", "两家一起"],
  ["ibkr", "IBKR"],
  ["webull", "Webull AU"],
];
const PAGE = 100;

function Seg({ items, value, onChange }) {
  return (
    <span className="seg">
      {items.map(([id, label]) => (
        <button
          type="button"
          key={id}
          aria-pressed={value === id}
          className={value === id ? "on" : ""}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
function F({ label, children }) {
  return (
    <label className="f">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Panel({ title, action, children, className = "" }) {
  return (
    <section className={"card " + className} aria-label={title}>
      <div className="row">
        <h2>{title}</h2>
        <span className="sp" />
        {action}
      </div>
      {children}
    </section>
  );
}
function AccountOptions({ d, value, set, className }) {
  return (
    <select className={className} aria-label="账本账户" value={value || ""} onChange={(e) => set(e.target.value)}>
      {!value && <option value="">选择账户</option>}
      {d.accounts
        .filter((a) => a.active)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </select>
  );
}

function StatementLines({ cash, setCash, positions, setPositions, listings = [], opening = false }) {
  const change = (rows, set, i, patch) => set(rows.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  const remove = (rows, set, i) => (
    <button type="button" className="btn" onClick={() => set(rows.filter((_, n) => n !== i))}>
      移除
    </button>
  );
  return (
    <>
      <div className="sub">现金</div>
      {cash.map((v, i) => (
        <div className="line" key={i}>
          <input
            aria-label={"现金币种 " + (i + 1)}
            placeholder="币种"
            maxLength={3}
            value={v.currency}
            onChange={(e) => change(cash, setCash, i, { currency: e.target.value.toUpperCase() })}
          />
          <input
            aria-label={"现金余额 " + (i + 1)}
            placeholder="余额"
            type="number"
            step="any"
            value={v.value}
            onChange={(e) => change(cash, setCash, i, { value: e.target.value })}
          />
          {remove(cash, setCash, i)}
        </div>
      ))}
      <button type="button" className="lnk cap" onClick={() => setCash([...cash, { currency: "", value: "" }])}>
        ＋ 添加币种
      </button>
      <div className="sub">证券持仓</div>
      {positions.map((v, i) =>
        opening ? (
          <div className="line full" key={i}>
            <F label="证券代码">
              <input
                value={v.symbol}
                onChange={(e) =>
                  change(positions, setPositions, i, { symbol: e.target.value.toUpperCase(), assetId: "", mic: "" })
                }
              />
            </F>
            <F label="股数／份额">
              <input
                type="number"
                step="any"
                value={v.quantity}
                onChange={(e) => change(positions, setPositions, i, { quantity: e.target.value })}
              />
            </F>
            {listings.some((a) => a.symbol === v.symbol) && (
              <F label="已有上市证券">
                <select
                  value={v.assetId || ""}
                  onChange={(e) => {
                    const match = listings.find((a) => a.id === e.target.value);
                    change(
                      positions,
                      setPositions,
                      i,
                      match
                        ? { assetId: match.id, mic: match.mic, currency: match.currency, kind: match.kind }
                        : { assetId: "", mic: "" },
                    );
                  }}
                >
                  <option value="">手动填写市场及币种</option>
                  {listings
                    .filter((a) => a.symbol === v.symbol)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {listingLabel(a)}
                      </option>
                    ))}
                </select>
              </F>
            )}
            <F label="交易币种">
              <input
                readOnly={!!v.assetId}
                value={v.currency || ""}
                maxLength={3}
                onChange={(e) => change(positions, setPositions, i, { currency: e.target.value.toUpperCase() })}
              />
            </F>
            <F label="上市市场">
              <input
                readOnly={!!v.assetId}
                list="statement-markets"
                value={v.mic || ""}
                onChange={(e) => change(positions, setPositions, i, { mic: e.target.value.toUpperCase() })}
              />
            </F>
            <F label="当日市价（可选）">
              <input
                type="number"
                step="any"
                value={v.price || ""}
                onChange={(e) => change(positions, setPositions, i, { price: e.target.value })}
              />
            </F>
            <F label="类别">
              <select
                value={v.kind || "EQUITY"}
                onChange={(e) => change(positions, setPositions, i, { kind: e.target.value })}
              >
                <option value="EQUITY">股票</option>
                <option value="ETF">ETF</option>
              </select>
            </F>
            {remove(positions, setPositions, i)}
          </div>
        ) : (
          <div className="line" key={i}>
            <input
              aria-label={"证券代码 " + (i + 1)}
              placeholder="证券代码"
              value={v.symbol}
              onChange={(e) =>
                change(positions, setPositions, i, { symbol: e.target.value.toUpperCase(), assetId: "", mic: "" })
              }
            />
            <input
              aria-label={"股数 " + (i + 1)}
              placeholder="股数／份额"
              type="number"
              step="any"
              value={v.quantity}
              onChange={(e) => change(positions, setPositions, i, { quantity: e.target.value })}
            />
            {remove(positions, setPositions, i)}
          </div>
        ),
      )}
      <button
        type="button"
        className="lnk cap"
        onClick={() => setPositions([...positions, { symbol: "", quantity: "", currency: opening ? "AUD" : "" }])}
      >
        ＋ 添加证券
      </button>
      {opening && (
        <datalist id="statement-markets">
          {Object.entries(marketNames).map(([mic, label]) => (
            <option key={mic} value={mic}>
              {label}
            </option>
          ))}
        </datalist>
      )}
    </>
  );
}
function cashAmounts(entries) {
  const amounts = {};
  for (const v of entries) {
    if (v.value === "" && !v.currency) continue;
    if (v.value === "" || !/^[A-Z]{3}$/.test(v.currency) || v.currency in amounts)
      throw Error("请逐项填写币种和余额，同一币种填写一次。");
    amounts[v.currency] = v.value;
  }
  return amounts;
}
function ListingChoices({ choices, resolve }) {
  if (!choices?.length) return null;
  return (
    <div className="fg">
      {choices.map((c) => (
        <F key={c.record + c.symbol} label={c.symbol + " 对应多个上市证券，请选择"}>
          <select defaultValue="" onChange={(e) => e.target.value && resolve(c, e.target.value)}>
            <option value="">选择上市证券</option>
            {c.candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {listingLabel(a)}
              </option>
            ))}
          </select>
        </F>
      ))}
    </div>
  );
}
export function Imports({ d, mode, run, initial = {}, onPage }) {
  const { cols } = useShell();
  const [tab, setTab] = useState(initial.tab || "file"),
    [broker, setBroker] = useState(initial.broker || "both");
  const defaultAccount =
    initial.account ||
    (initial.broker &&
      d.accounts.find((a) => a.active && a.name.toLowerCase().includes(initial.broker))?.id) ||
    d.selected[0] ||
    "";
  const [account, setAccount] = useState(defaultAccount),
    [reports, setReports] = useState({});
  const started = useRef(false);
  const requests = useRef({});
  const [ledger, setLedger] = useState([]),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState(null);
  const [form, setForm] = useState({ ...blank, date: d.date }),
    [date, setDate] = useState(d.date),
    [cash, setCash] = useState([{ currency: "AUD", value: "" }]),
    [pos, setPos] = useState([]),
    [noSecurities, setNoSecurities] = useState(false),
    [compare, setCompare] = useState(null),
    [flow, setFlow] = useState(false);
  const [openCash, setOpenCash] = useState([]),
    [openPos, setOpenPos] = useState([]);
  const [mapping, setMapping] = useState(() => initial.account && ["ibkr","webull"].includes(initial.broker)
    ? {...d.brokerAccounts,[initial.broker]:initial.account} : d.brokerAccounts);
  const [nav, setNav] = useState("");
  const [amend, setAmend] = useState(null),
    [amendForm, setAmendForm] = useState({}),
    [revisions, setRevisions] = useState([]),
    [voided, setVoided] = useState(false);
  const demo = mode === "demo",
    webullSample = demo && account === "demo-webull";
  function selectAccount(next, keepImport = false) {
    if (next === account) return;
    setAccount(next);
    if (!keepImport) {
      setReports({});
    }
    setCompare(null);
    setFlow(false);
    setCash([{ currency: "AUD", value: "" }]);
    setPos([]);
    setNoSecurities(false);
    setNav("");
    setOffset(0);
    setAmend(null);
  }
  useEffect(() => {
    let a = true;
    if (tab === "history" && account)
      api
        .history({ account, limit: PAGE, offset, text: search })
        .then((v) => {
          if (a) setLedger(v);
        })
        .catch((e) => run(() => Promise.reject(e)));
    return () => {
      a = false;
    };
  }, [tab, account, offset, search, d]);
  function chooseTab(next) {
    setTab(next);
    setAmend(null);
  }
  function chooseBroker(b) {
    requests.current = {};
    setBroker(b);
    if (b !== "both") selectAccount(mapping[b] || "");
    setReports({});
  }
  function updateReport(b, result) {
    setReports((prev) => ({ ...prev, [b]: result }));
  }
  async function prepare(source, which = broker, id = which === "both" ? "" : mapping[which]) {
    if (which === "both") {
      if (mapping.ibkr && mapping.ibkr === mapping.webull)
        return run(() => {
          throw Error("请给两家券商选择不同的入账账户。");
        }, false);
      return Promise.all(["ibkr", "webull"].map((b) => prepare(source, b, mapping[b])));
    }
    const request = Symbol();
    requests.current[which] = request;
    if (source !== "file") updateReport(which, { broker: which, loading: true });
    await run(async () => {
      try {
        if (!id) throw Error("请选择这家券商的入账账户。");
        const v = await api.preview({ source, broker: which, account: id });
        if (v && requests.current[which] === request) updateReport(which, { ...v, sourceKind: source });
      } catch (e) {
        if (requests.current[which] === request)
          updateReport(which, {
            broker: which,
            account: id,
            sourceKind: source,
            error: String(e.message).replace(/^Error invoking remote method '.*?': (?:Error: )?/, ""),
          });
      }
    }, false);
  }
  useEffect(() => {
    if (!initial.sync || started.current) return;
    started.current = true;
    prepare(demo ? "sample" : "live", initial.broker);
  }, []);
  async function commit(r) {
    await run(async () => {
      const v = await api.commit({ token: r.token });
      updateReport(r.broker, { ...v, done: true });
    }, "已保存该券商的记录");
  }
  function useStatement(v) {
    setDate(v.date);
    setCash(Object.entries(v.cash || {}).map(([currency, value]) => ({ currency, value })));
    setNoSecurities(Array.isArray(v.positions) && v.positions.length === 0);
    setPos((v.positions || []).map((p) => ({ ...p })));
    setNav(v.base === "AUD" && v.nav != null ? String(v.nav) : "");
    setCompare(null);
    setFlow(false);
    chooseTab("check");
  }
  function compareArgs() {
    return {
      account,
      date,
      cash: cashAmounts(cash),
      positions: pos.length || noSecurities ? pos : undefined,
      nav: nav.trim() || null,
      flowsReviewed: flow,
      source: webullSample ? "示例 Webull 月结单" : "券商结单",
    };
  }
  function openManual(sample = false, type = "DEPOSIT") {
    setForm(
      sample
        ? {
            ...blank,
            date: "2026-10-28",
            type: "DEPOSIT",
            currency: "AUD",
            amount: "1000",
            reference: "WB-OCT-DEP-01",
            note: "月结单 · 银行入金",
          }
        : { ...blank, date: d.date, type },
    );
    setModal("manual");
  }
  const accountName = d.accounts.find((a) => a.id === account)?.name;
  const accountReports = d.quantityReports
    .filter((r) => r.account === account)
    .sort((a, b) => b.day.localeCompare(a.day));
  const change = (k, v) => setForm({ ...form, [k]: v });
  const changeAmend = (k, v) => setAmendForm({ ...amendForm, [k]: v });
  async function edit(v) {
    setAmend(v);
    setAmendForm({
      date: String(v.date).slice(0, 10),
      currency: v.currency,
      amount: String(v.amount ?? ""),
      quantity: String(v.quantity ?? ""),
      price: String(v.unitPrice ?? ""),
      fee: String(v.fee ?? 0),
      note: v.comment || "",
      reason: "",
    });
    setRevisions([]);
    setRevisions(await api.corrections({ id: v.id }));
  }
  const batches = d.batches.filter((b) =>
    broker === "both" ? Object.values(mapping).includes(b.account) : b.account === account,
  );
  // A booked record replaced by its broker original stays in the book but out of the default list.
  const superseded = (v) => v.metadata?.supersededBy || String(v.status).toUpperCase() === "VOID";
  const entries = ledger.filter((v) => voided || !superseded(v));
  const sources = { MANUAL: "手工录入", WEBULL: "Webull", IBKR: "IBKR" };
  const rowKeys = useRowKeys(
    entries.map((v) => v.id),
    amend?.id,
    (id) => {
      const v = entries.find((e) => e.id === id);
      if (v) run(() => edit(v), false);
    },
  );
  if (!d.accounts.some((a) => a.active))
    return (
      <div className="imp imp-page">
        <Panel title="导入与对账" className="cap880">
          <Empty>请先建立一个券商账户。</Empty>
          <button className="btn pri" onClick={() => onPage("settings", { tab: "book" })}>
            建立账户
          </button>
        </Panel>
      </div>
    );

  const brokers = broker === "both" ? ["ibkr", "webull"] : [broker];
  const update = (
    <Panel title="更新投资记录" action={<Seg items={brokerTabs} value={broker} onChange={chooseBroker} />}>
      <div className="opts">
        <button type="button" onClick={() => prepare(demo ? "sample" : "live")}>
          <CloudDownload size={22} strokeWidth={1.8} />
          <b>同步券商</b>
          <small>{demo ? "预览示例券商记录" : "预览交易和账户余额"}</small>
        </button>
        <button type="button" onClick={() => setModal("file")}>
          <FileUp size={22} strokeWidth={1.8} />
          <b>导入文件</b>
          <small>IBKR 结单或 Webull 成交记录</small>
        </button>
        <button type="button" onClick={() => setModal("entry")}>
          <FileText size={22} strokeWidth={1.8} />
          <b>手工补一条</b>
          <small>买卖、持仓或资金收支</small>
        </button>
      </div>
      <details
        className="account-mapping"
        open={Object.keys(mapping).some((b) => brokers.includes(b) && !mapping[b]) || undefined}
      >
        <summary>
          入账账户 · {brokers.map((b) => d.accounts.find((a) => a.id === mapping[b])?.name || "待选择").join("、")}
        </summary>
        <div className="fg">
          {brokers.map((b) => (
            <F key={b} label={b.toUpperCase() + " 入账账户"}>
              <select
                value={mapping[b]}
                onChange={(e) => {
                  delete requests.current[b];
                  setMapping({ ...mapping, [b]: e.target.value });
                  if (!reports[b]?.error) updateReport(b, null);
                  if (broker === b) selectAccount(e.target.value, true);
                }}
              >
                <option value="">选择账户</option>
                {d.accounts
                  .filter((a) => a.active && a.mode === "TRANSACTIONS")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </F>
          ))}
        </div>
      </details>
    </Panel>
  );
  const previews = ["ibkr", "webull"].filter((b) => reports[b]);
  const brokerCard = (r) => (
    <BrokerResult
      report={r}
      accounts={d.accounts}
      onConfirm={() => commit(r)}
      onClose={() => updateReport(r.broker, null)}
      onRetry={() => prepare(r.sourceKind, r.broker)}
      onConnect={demo ? null : () => onPage("settings", { tab: "connections", broker: r.broker })}
      onReconcile={(result) => {
        selectAccount(result.account, true);
        useStatement(result.statement || { date: d.date });
      }}
    >
      <ListingChoices
        choices={r.choices}
        resolve={(c, id) =>
          run(async () => {
            await api.rememberListing({ ...c, assetId: id });
            updateReport(r.broker, { ...(await api.preview({ token: r.token })), sourceKind: r.sourceKind });
          }, false)
        }
      />
    </BrokerResult>
  );
  const batchCard = batches.length > 0 && (
    <Panel title="最近导入批次">
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>文件或连接</th>
              <th className="l">时间</th>
              <th>新增</th>
              <th>重复</th>
              <th>更正</th>
            </tr>
          </thead>
          <tbody>
            {batches.slice(0, 8).map((b) => (
              <tr key={b.id}>
                <td>{b.source}</td>
                <td className="l">{new Date(b.created).toLocaleString("zh-CN")}</td>
                <td>{b.data.imported}</td>
                <td>{b.data.duplicate}</td>
                <td>{(b.data.updated || 0) + (b.data.repaired || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );

  const evidence = accountReports.length > 0 && (
    <Panel title="已补录的股数凭据">
      {accountReports.map((r) => (
        <div className="ev" key={r.day + r.asset}>
          <b>
            {r.symbol} · {r.day}
          </b>
          <span>
            {r.reference} 记载 {num(r.quantity)} 股，账本可解释 {num(r.ledgerQuantity)} 股。
          </span>
          <b className={Number(r.difference) ? "warn" : "up"}>
            {Number(r.difference) ? "相差 " + num(Math.abs(r.difference)) + " 股" : "股数吻合"}
          </b>
          <button
            type="button"
            className="lnk"
            onClick={() => {
              setSearch(r.symbol);
              setOffset(0);
              chooseTab("history");
            }}
          >
            查看相关流水
          </button>
        </div>
      ))}
    </Panel>
  );
  const statement = (
    <Panel
      title="核对同日券商结单"
      action={
        webullSample ? (
          <button type="button" className="btn sm" onClick={() => setModal("statement")}>
            查看示例月结单
          </button>
        ) : null
      }
    >
      <div className="fg">
        <F label="结单日期">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setCompare(null);
            }}
          />
        </F>
      </div>
      <StatementLines
        cash={cash}
        setCash={(v) => {
          setCash(v);
          setCompare(null);
        }}
        positions={pos}
        setPositions={(v) => {
          setPos(v);
          setCompare(null);
        }}
      />
      {!pos.length && (
        <label className="chk">
          <input
            type="checkbox"
            checked={noSecurities}
            onChange={(e) => {
              setNoSecurities(e.target.checked);
              setCompare(null);
            }}
          />
          结单显示证券持仓为零
        </label>
      )}
      <div className="fg">
        <F label="结单同日总资产（AUD，可选）">
          <input
            type="number"
            step=".01"
            value={nav}
            onChange={(e) => {
              setNav(e.target.value);
              setCompare(null);
            }}
          />
        </F>
      </div>
      <div className="acts">
        <button
          type="button"
          className="btn pri"
          onClick={() => run(async () => setCompare(await api.compare(compareArgs())), false)}
        >
          比较结单
        </button>
        <button type="button" className="btn" onClick={() => openManual(false)}>
          补录一笔流水
        </button>
        {!demo && nav.trim() && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              run(() => api.recordAccountValue({ ...compareArgs(), positions: pos }), "已保存同日券商估值")
            }
          >
            核对现金及持仓，采用券商净值
          </button>
        )}
      </div>
      {compare && (
        <>
          <ListingChoices
            choices={compare.choices}
            resolve={(c, id) =>
              run(async () => {
                await api.rememberListing({ ...c, assetId: id });
                setCompare(await api.compare(compareArgs()));
              }, false)
            }
          />
          {!compare.choices.length &&
            quantityGaps(compare.rows, accountName).map((line) => (
              <p className="warn result" key={line}>
                {line}
              </p>
            ))}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>核对项</th>
                  <th>结单</th>
                  <th>本地账本</th>
                  <th>差异</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {compare.rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{num(r.expected)}</td>
                    <td>{num(r.actual)}</td>
                    <td className={r.delta == null || Number(r.delta) !== 0 ? "warn" : "up"}>
                      {r.delta == null ? "待核对" : num(r.delta).replace(/^-/, "−")}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="lnk"
                        onClick={() => {
                          setSearch(r.label.startsWith("总资产") ? "" : r.label.split(" ")[0]);
                          chooseTab("history");
                        }}
                      >
                        查流水
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={(compare.ok ? "up" : "warn") + " result"}>
            {compare.ok ? "本地账本与所填结单一致。" : "请检查凭证及相关流水，再次比较。"} {compare.warnings.join(" ")}
          </p>
          {compare.ok && (
            <>
              <label className="chk">
                <input type="checkbox" checked={flow} onChange={(e) => setFlow(e.target.checked)} />
                已核对期间资金流水及所有币种余额
              </label>
              <button
                type="button"
                className="btn pri"
                disabled={!flow}
                onClick={() =>
                  run(async () => {
                    await api.confirmStatement(compareArgs());
                    setCompare(null);
                    setFlow(false);
                    onPage("overview");
                  }, "对账已保存")
                }
              >
                完成对账并查看总览
              </button>
            </>
          )}
        </>
      )}
    </Panel>
  );

  const history = (
    <Panel
      title="交易与资金流水"
      action={
        <button type="button" className="btn pri" onClick={() => openManual(false)}>
          补录流水
        </button>
      }
    >
      <div className="row">
        <input
          className="btn history-search"
          aria-label="筛选流水"
          placeholder="按证券、来源或凭证搜索"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <label className="chk">
          <input type="checkbox" checked={voided} onChange={(e) => setVoided(e.target.checked)} />
          显示已冲销的重复记录
        </label>
      </div>
      {entries.length ? (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th className="l">类型</th>
                <th className="l">证券</th>
                <th>数量 × 单价</th>
                <th>金额</th>
                <th className="hide-n">费用</th>
                <th className="l hide-n">来源 / 凭证</th>
                <th />
              </tr>
            </thead>
            <tbody onKeyDown={rowKeys}>
              {entries.map((v) => {
                const traded = Number(v.quantity) && v.unitPrice != null;
                const amount = v.amount ?? (traded ? Number(v.quantity) * Number(v.unitPrice) : null);
                const execution = v.metadata?.ibkrExecution,
                  fx = v.metadata?.fx;
                return (
                  <tr
                    key={v.id}
                    data-row={v.id}
                    className={"click" + (amend?.id === v.id ? " sel" : "")}
                    onClick={() => run(() => edit(v), false)}
                  >
                    <td>{String(v.date).slice(0, 10)}</td>
                    <td className="l">
                      {v.metadata?.fx
                        ? "换汇" + (v.activityType === "TRANSFER_OUT" ? "卖出" : "买入")
                        : types[v.activityType] || v.activityType}
                      {superseded(v) && <small>已冲销重复流水</small>}
                      {fx?.sourceCurrency && fx.destinationCurrency && (
                        <small>
                          {execution?.autoFx && "自动换汇 · "}
                          {fx.sourceCurrency} → {fx.destinationCurrency}
                        </small>
                      )}
                    </td>
                    <td className="l">{v.assetSymbol || "—"}</td>
                    <td>
                      {Number(v.quantity)
                        ? num(v.quantity) + (v.unitPrice != null ? " × " + num(v.unitPrice) : "")
                        : fx?.sourceCurrency && Number(fx.impliedRate) > 0
                          ? "1 " + fx.sourceCurrency + " = " + num(fx.impliedRate) + " " + fx.destinationCurrency
                          : "—"}
                    </td>
                    <td>{amount == null ? "—" : v.currency + " " + fmt(amount, 2)}</td>
                    <td className="hide-n">{Number(v.fee) ? v.currency + " " + num(v.fee) : "—"}</td>
                    <td className="l hide-n">
                      {sources[v.sourceSystem] || v.sourceSystem || "原账本"}
                      <small>{v.sourceRecordId || v.comment}</small>
                    </td>
                    <td>
                      <button type="button" className="lnk">
                        核对 / 更正
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{ledger.length ? "这一页只有已冲销的重复记录。" : "没有找到流水。"}</Empty>
      )}
      <div className="acts">
        <button type="button" className="btn" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          上一页
        </button>
        <button
          type="button"
          className="btn"
          disabled={ledger.length < PAGE}
          onClick={() => setOffset(offset + PAGE)}
        >
          下一页
        </button>
        {ledger.length > 0 && (
          <span className="cap">
            第 {offset + 1} – {offset + ledger.length} 笔
          </span>
        )}
      </div>
    </Panel>
  );

  const opening = (
    <Panel title="从这一天开始记录">
      <p className="muted">选择开始跟踪的日期，按结单分别填写证券和现金。期初资产会作为计算起点。</p>
      <div className="fg">
        <F label="期初日期">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </F>
      </div>
      <StatementLines
        cash={openCash}
        setCash={setOpenCash}
        positions={openPos}
        setPositions={setOpenPos}
        listings={d.listings}
        opening
      />
      <div className="acts">
        <button
          type="button"
          className="btn pri"
          onClick={() =>
            run(async () => {
              await api.opening({ account, date, cash: cashAmounts(openCash), positions: openPos });
              chooseTab("history");
            }, "期初余额已保存")
          }
        >
          保存期初余额
        </button>
      </div>
    </Panel>
  );

  return (
    <div className="imp imp-page">
      <div className="row m0">
        <Seg items={tabs} value={tab} onChange={chooseTab} />
        <span className="sp" />
        {tab !== "file" && <AccountOptions className="btn" d={d} value={account} set={selectAccount} />}
      </div>
      {tab === "file" && (
        <Grid
          layout={syncLayout(previews, { batches: !!batchCard })}
          panels={{
            update,
            batches: batchCard,
            ...Object.fromEntries(previews.map((b) => [b, brokerCard(reports[b])])),
          }}
        />
      )}
      {tab === "check" && (
        <div className={cols > 1 && evidence ? "cap1760" : "cap880"}>
          <Grid layout={checkLayout(!!evidence)} panels={{ statement, evidence }} />
        </div>
      )}
      {tab === "history" && history}
      {tab === "opening" && <div className="stack cap880">{opening}</div>}

      {tab === "history" && amend && (
        <Detail title="核对 / 更正流水" onClose={() => setAmend(null)}>
          <div className="imp">
            <div className="dl">
              <div>
                <span className="cap">
                  {String(amend.date).slice(0, 10)} · {types[amend.activityType] || amend.activityType}
                </span>
                <b>{amend.assetSymbol || amend.currency}</b>
              </div>
              <div>
                <span className="cap">金额</span>
                <b>
                  {amend.amount != null
                    ? amend.currency + " " + fmt(amend.amount, 2)
                    : Number(amend.quantity) && amend.unitPrice != null
                      ? amend.currency + " " + fmt(Number(amend.quantity) * Number(amend.unitPrice), 2)
                      : "—"}
                </b>
              </div>
            </div>
            <div className="cap">
              来源 {sources[amend.sourceSystem] || amend.sourceSystem || "原账本"}
              {amend.sourceRecordId && " · " + amend.sourceRecordId}
            </div>
            <div className="fg w">
              {[
                ["date", "日期", "date"],
                ...(["BUY", "SELL"].includes(amend.activityType)
                  ? [
                      ["quantity", "数量", "number"],
                      ["price", "单价", "number"],
                      ["fee", "费用", "number"],
                    ]
                  : amend.assetId && Number(amend.quantity) > 0
                    ? [["quantity", "数量", "number"]]
                    : [["amount", "金额", "number"]]),
                ["note", "备注", "text"],
                ["reason", "更正依据 / 原始凭证", "text"],
              ].map(([k, l, t]) => (
                <F key={k} label={l}>
                  <input
                    type={t}
                    step="any"
                    value={amendForm[k] ?? ""}
                    onChange={(ev) => changeAmend(k, ev.target.value)}
                  />
                </F>
              ))}
            </div>
            {revisions.map((v, i) => (
              <p className="cap" key={i}>
                {v.created.slice(0, 10)} · {v.reason}
              </p>
            ))}
            <div className="acts">
              <button
                type="button"
                className="btn pri"
                onClick={() =>
                  run(async () => {
                    await api.amend({ ...blank, ...amendForm, account, id: amend.id, prior: JSON.stringify(amend) });
                    setAmend(null);
                  }, "流水已更正，原始记录及依据已保留")
                }
              >
                保存更正
              </button>
              <button type="button" className="btn" onClick={() => setAmend(null)}>
                取消
              </button>
            </div>
          </div>
        </Detail>
      )}

      {modal === "file" && (
        <Modal title="导入券商文件" close={() => setModal(null)}>
          <div className="imp">
            {["ibkr", "webull"].map((b) => (
              <div className="fg" key={b} style={{ alignItems: "end" }}>
                <F label={b.toUpperCase() + " 入账账户"}>
                  <AccountOptions d={d} value={mapping[b]} set={(id) => setMapping({ ...mapping, [b]: id })} />
                </F>
                <button
                  type="button"
                  className="btn"
                  style={{ justifySelf: "start" }}
                  disabled={!mapping[b]}
                  onClick={() => {
                    setModal(null);
                    prepare("file", b, mapping[b]);
                  }}
                >
                  {b === "ibkr" ? "选择 Flex XML" : "选择成交 CSV"}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "entry" && (
        <Modal title="手工补一条" close={() => setModal(null)}>
          <div className="imp">
            <div className="fg">
              <F label="所属账户">
                <AccountOptions d={d} value={account} set={selectAccount} />
              </F>
            </div>
            <div className="acts">
              <button type="button" className="btn" onClick={() => openManual(false, "BUY")}>
                补一笔买卖
              </button>
              <button type="button" className="btn" onClick={() => setModal("position")}>
                补持仓
              </button>
              <button type="button" className="btn" onClick={() => openManual()}>
                补资金流水
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "position" && (
        <HoldingEditor d={d} run={run} account={account} action="position" close={() => setModal(null)} />
      )}
      {modal === "statement" && (
        <Modal title="Webull Australia · 示例月结单" close={() => setModal(null)}>
          <div className="imp">
            <table>
              <tbody>
                {[
                  ["结单日期", "2026-10-30"],
                  ["期末持仓", "A200 200 股 · BHP 150 股"],
                  ["期末现金", "AUD 7,600.00"],
                  ["10 月 28 日 · 银行入金", "AUD 1,000.00"],
                  ["入金凭证", "WB-OCT-DEP-01"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="acts">
              <button
                type="button"
                className="btn pri"
                onClick={() => {
                  useStatement({
                    date: "2026-10-30",
                    cash: { AUD: 7600 },
                    positions: [
                      { symbol: "A200", quantity: 200 },
                      { symbol: "BHP", quantity: 150 },
                    ],
                  });
                  setModal(null);
                }}
              >
                填入结单用于比较
              </button>
              <button type="button" className="btn" onClick={() => openManual(true)}>
                按凭证补录入金
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "manual" && (
        <Modal title="补录账本流水" close={() => setModal(null)}>
          <form
            className="imp"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.manual({ account, ...form });
                setModal(null);
                setCompare(null);
              }, "流水已入账");
            }}
          >
            <div className="fg">
              <F label="类型">
                <select
                  value={form.type}
                  onChange={(e) =>
                    setForm({ ...form, type: e.target.value, assetId: "", symbol: "", mic: "", linkDividend: false })
                  }
                >
                  {Object.entries(types).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </F>
              {["BUY", "SELL", "DIVIDEND"].includes(form.type) &&
              (form.type !== "DIVIDEND" || form.symbol || form.linkDividend) ? (
                <SecurityFields d={d} form={form} setForm={setForm} />
              ) : (
                form.type === "DIVIDEND" && (
                  <button type="button" className="lnk" onClick={() => change("linkDividend", true)}>
                    关联证券
                  </button>
                )
              )}
              {[
                ["date", "日期", "date"],
                ...(["BUY", "SELL"].includes(form.type) ||
                (form.type === "DIVIDEND" && (form.linkDividend || form.symbol))
                  ? []
                  : [["currency", "币种", "text"]]),
                ...(["BUY", "SELL"].includes(form.type)
                  ? [
                      ["quantity", "成交数量", "number"],
                      ["price", "成交价", "number"],
                      ["fee", "手续费", "number"],
                    ]
                  : [["amount", "金额", "number"]]),
                ...(form.type.startsWith("TRANSFER") ? [["group", "两端共用划转编号", "text"]] : []),
                ["reference", "结单凭证编号", "text"],
                ["note", "备注", "text"],
              ].map(([k, l, t]) => (
                <F key={k} label={l}>
                  <input
                    required={!["note", "fee", "mic", "group"].includes(k)}
                    type={t}
                    step="any"
                    value={form[k]}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </F>
              ))}
            </div>
            <div className="acts">
              <button className="btn pri" type="submit">
                确认记入 {accountName}
              </button>
              <button type="button" className="btn" onClick={() => setModal(null)}>
                取消
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
