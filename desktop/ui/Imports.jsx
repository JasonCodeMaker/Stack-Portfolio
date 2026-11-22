import React, { useEffect, useState, useRef } from "react";
import { FileUp, CloudDownload, FileText } from "lucide-react";
import { HoldingEditor, SecurityFields, listingLabel, marketNames } from "./HoldingEditor";
import { ImportPreview } from "./ImportPreview";
import {
  api,
  num,
  fmt,
  aud,
  types,
  Table,
  Card,
  Field,
  Tabs,
  Empty,
  Modal,
  AccountSelect,
} from "./common";
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
function StatementLines({ cash, setCash, positions, setPositions, listings = [], opening = false }) {
  const change = (rows, set, i, patch) => set(rows.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  return (
    <div className="statement-lines">
      <fieldset>
        <legend>结单上的现金余额</legend>
        {cash.map((v, i) => (
          <div className="inline-form" key={i}>
            <Field label="币种">
              <input
                aria-label={"现金币种 " + (i + 1)}
                maxLength={3}
                value={v.currency}
                onChange={(e) => change(cash, setCash, i, { currency: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="余额">
              <input
                type="number"
                step="any"
                value={v.value}
                onChange={(e) => change(cash, setCash, i, { value: e.target.value })}
              />
            </Field>
            <button onClick={() => setCash(cash.filter((_, n) => n !== i))}>移除</button>
          </div>
        ))}
        <button className="text-btn" onClick={() => setCash([...cash, { currency: "", value: "" }])}>
          添加币种
        </button>
      </fieldset>
      <fieldset>
        <legend>结单上的证券持仓</legend>
        {positions.map((v, i) => (
          <div className="inline-form" key={i}>
            <Field label="证券代码">
              <input
                value={v.symbol}
                onChange={(e) =>
                  change(positions, setPositions, i, {
                    symbol: e.target.value.toUpperCase(),
                    assetId: "",
                    mic: "",
                  })
                }
              />
            </Field>
            <Field label="股数／份额">
              <input
                type="number"
                step="any"
                value={v.quantity}
                onChange={(e) => change(positions, setPositions, i, { quantity: e.target.value })}
              />
            </Field>
            {opening && listings.some((a) => a.symbol === v.symbol) && (
              <Field label="已有上市证券">
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
              </Field>
            )}
            {opening && (
              <>
                <Field label="交易币种">
                  <input
                    readOnly={!!v.assetId}
                    value={v.currency || ""}
                    maxLength={3}
                    onChange={(e) =>
                      change(positions, setPositions, i, { currency: e.target.value.toUpperCase() })
                    }
                  />
                </Field>
                <Field label="上市市场">
                  <input
                    readOnly={!!v.assetId}
                    list="statement-markets"
                    value={v.mic || ""}
                    onChange={(e) =>
                      change(positions, setPositions, i, { mic: e.target.value.toUpperCase() })
                    }
                  />
                </Field>
                <Field label="当日市价（可选）">
                  <input
                    type="number"
                    step="any"
                    value={v.price || ""}
                    onChange={(e) => change(positions, setPositions, i, { price: e.target.value })}
                  />
                </Field>
                <Field label="类别">
                  <select
                    value={v.kind || "EQUITY"}
                    onChange={(e) => change(positions, setPositions, i, { kind: e.target.value })}
                  >
                    <option value="EQUITY">股票</option>
                    <option value="ETF">ETF</option>
                  </select>
                </Field>
              </>
            )}
            <button onClick={() => setPositions(positions.filter((_, n) => n !== i))}>移除</button>
          </div>
        ))}
        <button
          className="text-btn"
          onClick={() =>
            setPositions([...positions, { symbol: "", quantity: "", currency: opening ? "AUD" : "" }])
          }
        >
          添加证券
        </button>
      </fieldset>
      <datalist id="statement-markets">
        {Object.entries(marketNames).map(([mic, label]) => (
          <option key={mic} value={mic}>
            {label}
          </option>
        ))}
      </datalist>
    </div>
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
  return choices?.map((c) => (
    <Field key={c.record + c.symbol} label={c.symbol + " 对应多个上市证券，请选择"}>
      <select defaultValue="" onChange={(e) => e.target.value && resolve(c, e.target.value)}>
        <option value="">选择上市证券</option>
        {c.candidates.map((a) => (
          <option key={a.id} value={a.id}>
            {listingLabel(a)}
          </option>
        ))}
      </select>
    </Field>
  ));
}
export function Imports({ d, mode, run, initial = {}, onPage }) {
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
  const [mapping, setMapping] = useState(d.brokerAccounts);
  const [nav, setNav] = useState("");
  const [amend, setAmend] = useState(null),
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
  }
  useEffect(() => {
    let a = true;
    if (tab === "history" && account)
      api
        .history({ account, limit: 100, offset, text: search })
        .then((v) => {
          if (a) setLedger(v);
        })
        .catch((e) => run(() => Promise.reject(e)));
    return () => {
      a = false;
    };
  }, [tab, account, offset, search, d]);
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
    setTab("check");
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
  const accountReports = d.quantityReports
    .filter((r) => r.account === account)
    .sort((a, b) => b.day.localeCompare(a.day));
  const change = (k, v) => setForm({ ...form, [k]: v });
  async function edit(v) {
    setAmend(v);
    setRevisions(await api.corrections({ id: v.id }));
    setForm({
      ...blank,
      date: String(v.date).slice(0, 10),
      currency: v.currency,
      amount: String(v.amount ?? ""),
      quantity: String(v.quantity ?? ""),
      price: String(v.unitPrice ?? ""),
      fee: String(v.fee ?? 0),
      note: v.comment || "",
      reason: "",
    });
    setModal("amend");
  }
  const batches = d.batches.filter((b) =>
    broker === "both" ? Object.values(mapping).includes(b.account) : b.account === account,
  );
  // A booked record replaced by its broker original stays in the book but out of the default list.
  const superseded = (v) => v.metadata?.supersededBy || String(v.status).toUpperCase() === "VOID";
  const entries = ledger.filter((v) => voided || !superseded(v));
  const sources = { MANUAL: "手工录入", WEBULL: "Webull", IBKR: "IBKR" };
  if (!d.accounts.some((a) => a.active))
    return (
      <Card title="导入与对账">
        <Empty>请先建立一个券商账户。</Empty>
        <button className="primary" onClick={() => onPage("settings", { tab: "book" })}>
          建立账户
        </button>
      </Card>
    );
  return (
    <>
      <div className="page-controls">
        <Tabs
          items={[
            ["file", "记录与同步"],
            ["check", "和券商结单核对"],
            ["history", "交易流水"],
            ["opening", "从这一天开始记录"],
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab !== "file" && <AccountSelect data={d} value={account} set={selectAccount} />}
      </div>
      {tab === "file" && (
        <>
          <Card
            title="更新投资记录"
            action={
              <Tabs
                items={[
                  ["both", "两家一起"],
                  ["ibkr", "IBKR"],
                  ["webull", "Webull AU"],
                ]}
                value={broker}
                onChange={chooseBroker}
              />
            }
          >
            <div className="import-options">
              <button onClick={() => prepare(demo ? "sample" : "live")}>
                <CloudDownload />
                <b>同步券商</b>
                <small>{demo ? "预览示例券商记录" : "预览交易和账户余额"}</small>
              </button>
              <button onClick={() => setModal("file")}>
                <FileUp />
                <b>导入文件</b>
                <small>IBKR 结单或 Webull 成交记录</small>
              </button>
              <button onClick={() => setModal("entry")}>
                <FileText />
                <b>手工补一条</b>
                <small>买卖、持仓或资金收支</small>
              </button>
            </div>
            <details
              className="account-mapping"
              open={
                Object.keys(mapping).some((b) => (b === broker || broker === "both") && !mapping[b]) ||
                undefined
              }
            >
              <summary>
                入账账户 ·{" "}
                {(broker === "both" ? ["ibkr", "webull"] : [broker])
                  .map((b) => d.accounts.find((a) => a.id === mapping[b])?.name || "待选择")
                  .join("、")}
              </summary>
              <div className="form-grid">
                {(broker === "both" ? ["ibkr", "webull"] : [broker]).map((b) => (
                  <Field key={b} label={b.toUpperCase() + " 入账账户"}>
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
                  </Field>
                ))}
              </div>
            </details>
          </Card>
          {Object.values(reports)
            .filter(Boolean)
            .map((r) => (
              <section
                key={r.broker}
                className="broker-result"
                aria-label={r.broker.toUpperCase() + " 同步结果"}
              >
                <h2>{r.broker.toUpperCase()}</h2>
                {r.loading ? (
                  <p role="status">正在读取券商记录…</p>
                ) : r.error ? (
                  <div className="notice">
                    <span>{r.error}</span>
                    <button onClick={() => prepare(r.sourceKind, r.broker)}>单独重试</button>
                    {!demo && (
                      <button onClick={() => onPage("settings", { tab: "connections", broker: r.broker })}>
                        连接券商
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <ListingChoices
                      choices={r.choices}
                      resolve={(c, id) =>
                        run(async () => {
                          await api.rememberListing({ ...c, assetId: id });
                          updateReport(r.broker, {
                            ...(await api.preview({ token: r.token })),
                            sourceKind: r.sourceKind,
                          });
                        }, false)
                      }
                    />
                    <ImportPreview
                      key={r.token || "saved"}
                      result={r}
                      done={!!r.done}
                      accounts={d.accounts}
                      confirm={() => commit(r)}
                      close={() => updateReport(r.broker, null)}
                      reconcile={(result) => {
                        selectAccount(result.account, true);
                        useStatement(result.statement || { date: d.date });
                      }}
                    />
                  </>
                )}
              </section>
            ))}
          {!Object.values(reports).some(Boolean) && batches.length > 0 && (
            <Card title="最近导入批次">
              <Table head={["文件或连接", "时间", ["新增", "num"], ["重复", "num"], ["更正", "num"]]}>
                {batches.slice(0, 8).map((b) => (
                  <tr key={b.id}>
                    <td>{b.source}</td>
                    <td>{new Date(b.created).toLocaleString("zh-CN")}</td>
                    <td className="num">{b.data.imported}</td>
                    <td className="num">{b.data.duplicate}</td>
                    <td className="num">{(b.data.updated || 0) + (b.data.repaired || 0)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}
      {tab === "check" && (
        <>
          {accountReports.length > 0 && (
            <Card title="已补录的股数凭据">
              {accountReports.map((r) => (
                <div className="evidence-line" key={r.day + r.asset}>
                  <b>
                    {r.symbol} · {r.day}
                  </b>
                  <span>
                    {r.reference} 记载 {num(r.quantity)} 股，账本可解释 {num(r.ledgerQuantity)} 股。
                  </span>
                  <strong>
                    {Number(r.difference) ? "相差 " + num(Math.abs(r.difference)) + " 股" : "股数吻合"}
                  </strong>
                  <button
                    className="text-btn"
                    onClick={() => {
                      setSearch(r.symbol);
                      setOffset(0);
                      setTab("history");
                    }}
                  >
                    查看相关流水
                  </button>
                </div>
              ))}
            </Card>
          )}
          <Card
            title="核对同日券商结单"
            action={
              webullSample ? (
                <button
                  className="soft"
                  onClick={() => {
                    setModal("statement");
                  }}
                >
                  查看示例月结单
                </button>
              ) : null
            }
          >
            <div className="form-grid">
              <Field label="结单日期">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setCompare(null);
                  }}
                />
              </Field>
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
              {!pos.length && <label className="check">
                <input type="checkbox" checked={noSecurities} onChange={(e) => {setNoSecurities(e.target.checked);setCompare(null);}}/>
                结单显示证券持仓为零
              </label>}
              <Field label="结单同日总资产（AUD，可选）">
                <input
                  type="number"
                  step=".01"
                  value={nav}
                  onChange={(e) => {
                    setNav(e.target.value);
                    setCompare(null);
                  }}
                />
              </Field>
            </div>
            <div className="actions">
              <button
                className="primary"
                onClick={() => run(async () => setCompare(await api.compare(compareArgs())), false)}
              >
                比较结单
              </button>
              <button onClick={() => openManual(false)}>补录一笔流水</button>
              {!demo && nav.trim() && (
                <button
                  onClick={() =>
                    run(
                      () => api.recordAccountValue({ ...compareArgs(), positions: pos }),
                      "已保存同日券商估值",
                    )
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
                  compare.rows
                    .filter((r) => r.symbol && Math.abs(Number(r.delta)) > 1e-8)
                    .map((r) => (
                      <p className="warning" key={r.label}>
                        {d.accounts.find((a) => a.id === account)?.name} 的 {r.symbol} 比结单
                        {Number(r.delta) < 0 ? "少" : "多"} {num(Math.abs(Number(r.delta)))} 股
                      </p>
                    ))}
                <Table head={["核对项", "结单", "本地账本", "差异", "来源"]}>
                  {compare.rows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td>{num(r.expected)}</td>
                      <td>{num(r.actual)}</td>
                      <td className={r.delta == null || Number(r.delta) !== 0 ? "warning" : "positive"}>
                        {r.delta == null ? "待核对" : num(r.delta)}
                      </td>
                      <td>
                        <button
                          className="text-btn"
                          onClick={() => {
                            setSearch(r.label.startsWith("总资产") ? "" : r.label.split(" ")[0]);
                            setTab("history");
                          }}
                        >
                          查流水
                        </button>
                      </td>
                    </tr>
                  ))}
                </Table>
                <p className={compare.ok ? "positive" : "warning"}>
                  {compare.ok ? "本地账本与所填结单一致。" : "请检查凭证及相关流水，再次比较。"}{" "}
                  {compare.warnings.join(" ")}
                </p>
                {compare.ok && (
                  <>
                    <label className="check">
                      <input type="checkbox" checked={flow} onChange={(e) => setFlow(e.target.checked)} />
                      已核对期间资金流水及所有币种余额
                    </label>
                    <button
                      className="primary"
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
          </Card>
        </>
      )}
      {tab === "history" && (
        <Card
          title="交易与资金流水"
          action={
            <button className="primary" onClick={() => openManual(false)}>
              补录流水
            </button>
          }
        >
          <div className="toolbar">
            <input
              aria-label="筛选流水"
              placeholder="按证券、来源或凭证搜索"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
            <label className="check">
              <input type="checkbox" checked={voided} onChange={(e) => setVoided(e.target.checked)} />
              显示已冲销的重复记录
            </label>
          </div>
          {entries.length ? (
            <Table
              head={[
                "日期",
                "类型",
                "证券",
                ["数量 × 单价", "num"],
                ["金额", "num"],
                ["费用", "num"],
                "来源 / 凭证",
                "",
              ]}
            >
              {entries.map((v) => {
                const traded = Number(v.quantity) && v.unitPrice != null;
                const amount = v.amount ?? (traded ? Number(v.quantity) * Number(v.unitPrice) : null);
                const execution = v.metadata?.ibkrExecution, fx = v.metadata?.fx;
                return (
                  <tr key={v.id}>
                    <td>{String(v.date).slice(0, 10)}</td>
                    <td>
                      {v.metadata?.fx
                        ? "换汇" + (v.activityType === "TRANSFER_OUT" ? "卖出" : "买入")
                        : types[v.activityType] || v.activityType}
                      {superseded(v) && <small>已冲销重复流水</small>}
                      {fx?.sourceCurrency && fx.destinationCurrency && <small>{execution?.autoFx && "自动换汇 · "}{fx.sourceCurrency} → {fx.destinationCurrency}</small>}
                    </td>
                    <td>{v.assetSymbol || "—"}</td>
                    <td className="num">
                      {Number(v.quantity)
                        ? num(v.quantity) + (v.unitPrice != null ? " × " + num(v.unitPrice) : "")
                        : fx?.sourceCurrency && Number(fx.impliedRate) > 0
                          ? "1 " + fx.sourceCurrency + " = " + num(fx.impliedRate) + " " + fx.destinationCurrency : "—"}
                    </td>
                    <td className="num">{amount == null ? "—" : v.currency + " " + fmt(amount, 2)}</td>
                    <td className="num">{Number(v.fee) ? v.currency + " " + num(v.fee) : "—"}</td>
                    <td>
                      {sources[v.sourceSystem] || v.sourceSystem || "原账本"}
                      <small>{v.sourceRecordId || v.comment}</small>
                    </td>
                    <td>
                      <button onClick={() => run(() => edit(v), false)}>核对 / 更正</button>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty>{ledger.length ? "这一页只有已冲销的重复记录。" : "没有找到流水。"}</Empty>
          )}
          <div className="actions">
            <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>
              上一页
            </button>
            <button disabled={ledger.length < 100} onClick={() => setOffset(offset + 100)}>
              下一页
            </button>
          </div>
        </Card>
      )}
      {tab === "opening" && (
        <Card title="从这一天开始记录">
          <p>选择开始跟踪的日期，按结单分别填写证券和现金。期初资产会作为计算起点。</p>
          <div className="form-grid">
            <Field label="期初日期">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <StatementLines
              cash={openCash}
              setCash={setOpenCash}
              positions={openPos}
              setPositions={setOpenPos}
              listings={d.listings}
              opening
            />
          </div>
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                await api.opening({
                  account,
                  date,
                  cash: cashAmounts(openCash),
                  positions: openPos,
                });
                setTab("history");
              }, "期初余额已保存")
            }
          >
            保存期初余额
          </button>
        </Card>
      )}
      {modal === "file" && (
        <Modal title="导入券商文件" close={() => setModal(null)}>
          {["ibkr", "webull"].map((b) => (
            <div className="actions" key={b}>
              <Field label={b.toUpperCase() + " 入账账户"}>
                <AccountSelect
                  data={d}
                  value={mapping[b]}
                  set={(id) => setMapping({ ...mapping, [b]: id })}
                />
              </Field>
              <button
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
        </Modal>
      )}
      {modal === "entry" && (
        <Modal title="手工补一条" close={() => setModal(null)}>
          <Field label="所属账户">
            <AccountSelect data={d} value={account} set={selectAccount} />
          </Field>
          <div className="actions">
            <button onClick={() => openManual(false, "BUY")}>补一笔买卖</button>
            <button onClick={() => setModal("position")}>补持仓</button>
            <button onClick={() => openManual()}>补资金流水</button>
          </div>
        </Modal>
      )}
      {modal === "position" && (
        <HoldingEditor d={d} run={run} account={account} action="position" close={() => setModal(null)} />
      )}
      {modal === "statement" && (
        <Modal title="Webull Australia · 示例月结单" close={() => setModal(null)}>
          <dl>
            <dt>结单日期</dt>
            <dd>2026-10-30</dd>
            <dt>期末持仓</dt>
            <dd>A200 200 股 · BHP 150 股</dd>
            <dt>期末现金</dt>
            <dd>AUD 7,600.00</dd>
            <dt>10 月 28 日 · 银行入金</dt>
            <dd>AUD 1,000.00</dd>
            <dt>入金凭证</dt>
            <dd>WB-OCT-DEP-01</dd>
          </dl>
          <div className="actions">
            <button
              className="primary"
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
            <button onClick={() => openManual(true)}>按凭证补录入金</button>
          </div>
        </Modal>
      )}
      {modal === "manual" && (
        <Modal title="补录账本流水" close={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.manual({ account, ...form });
                setModal(null);
                setCompare(null);
              }, "流水已入账");
            }}
          >
            <div className="form-grid">
              <Field label="类型">
                <select
                  value={form.type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      type: e.target.value,
                      assetId: "",
                      symbol: "",
                      mic: "",
                      linkDividend: false,
                    })
                  }
                >
                  {Object.entries(types).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              {["BUY", "SELL", "DIVIDEND"].includes(form.type) &&
              (form.type !== "DIVIDEND" || form.symbol || form.linkDividend) ? (
                <SecurityFields d={d} form={form} setForm={setForm} />
              ) : (
                form.type === "DIVIDEND" && (
                  <button type="button" className="text-btn" onClick={() => change("linkDividend", true)}>
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
                <Field key={k} label={l}>
                  <input
                    required={!["note", "fee", "mic", "group"].includes(k)}
                    type={t}
                    step="any"
                    value={form[k]}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </Field>
              ))}
            </div>
            <button className="primary" type="submit">
              确认记入 {d.accounts.find((a) => a.id === account)?.name}
            </button>
          </form>
        </Modal>
      )}
      {modal === "amend" && amend && (
        <Modal title="按凭证更正流水" close={() => setModal(null)}>
          <p>
            {types[amend.activityType] || amend.activityType} · {amend.assetSymbol || amend.currency} ·{" "}
            {amend.sourceRecordId || "原账本"}
          </p>
          <div className="form-grid">
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
              <Field key={k} label={l}>
                <input type={t} step="any" value={form[k]} onChange={(ev) => change(k, ev.target.value)} />
              </Field>
            ))}
          </div>
          {revisions.map((v, i) => (
            <p key={i}>
              {v.created.slice(0, 10)} · {v.reason}
            </p>
          ))}
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                await api.amend({ ...form, account, id: amend.id, prior: JSON.stringify(amend) });
                setModal(null);
              }, "流水已更正，原始记录及依据已保留")
            }
          >
            保存更正
          </button>
        </Modal>
      )}
    </>
  );
}
