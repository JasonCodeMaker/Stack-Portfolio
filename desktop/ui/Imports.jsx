import React, { useEffect, useState } from "react";
import { FileUp, CloudDownload, FileText, Check, History, ArrowRight } from "lucide-react";
import { ImportPreview } from "./ImportPreview";
import {
  api,
  num,
  aud,
  types,
  Table,
  Card,
  Field,
  Tabs,
  Empty,
  Modal,
  AccountSelect,
  parseCash,
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
function parsePositions(text, opening = false) {
  if (!text.trim()) return [];
  return text
    .trim()
    .split(/\r?\n/)
    .map((s) => {
      const [symbol, quantity, currency, mic, price, kind] = s.trim().split(/[\s,，]+/);
      if (!symbol || quantity == null || !Number.isFinite(Number(quantity)) || (opening && !currency))
        throw Error("请核对持仓行中的代码、数量及币种。");
      return { symbol, quantity, currency, mic, price, kind };
    });
}
export function Imports({ d, mode, run, initial = {}, onPage }) {
  const [tab, setTab] = useState(initial.tab || "file"),
    [broker, setBroker] = useState("webull");
  const defaultAccount =
    initial.account || d.accounts.find((a) => /webull/i.test(a.name))?.id || d.selected[0] || "";
  const [account, setAccount] = useState(defaultAccount),
    [preview, setPreview] = useState(null),
    [last, setLast] = useState(null);
  const [ledger, setLedger] = useState([]),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState(null);
  const [form, setForm] = useState({ ...blank, date: d.date }),
    [date, setDate] = useState(d.date),
    [cash, setCash] = useState(""),
    [pos, setPos] = useState(""),
    [compare, setCompare] = useState(null),
    [flow, setFlow] = useState(false);
  const [openCash, setOpenCash] = useState(""),
    [openPos, setOpenPos] = useState("");
  const [mapping, setMapping] = useState({
    ibkr: d.accounts.find((a) => /ibkr|interactive/i.test(a.name))?.id || "",
    webull: d.accounts.find((a) => /webull/i.test(a.name))?.id || "",
  });
  const [nav, setNav] = useState("");
  const [amend, setAmend] = useState(null),
    [revisions, setRevisions] = useState([]);
  const demo = mode === "demo",
    webullSample = demo && account === "demo-webull";
  function selectAccount(next, keepImport = false) {
    if (next === account) return;
    setAccount(next);
    if (!keepImport) {
      setPreview(null);
      setLast(null);
    }
    setCompare(null);
    setFlow(false);
    setCash("");
    setPos("");
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
  function accountFor(b) {
    return (
      d.accounts.find((a) => (b === "ibkr" ? /ibkr|interactive/i : /webull/i).test(a.name))?.id || account
    );
  }
  function chooseBroker(b) {
    setBroker(b);
    if (b !== "both") selectAccount(accountFor(b));
    setPreview(null);
    setLast(null);
  }
  async function prepare(source) {
    await run(async () => {
      const v = await api.preview({ source, broker, account, mapping });
      if (v) {
        setPreview(v);
        setLast(null);
      }
    }, false);
  }
  async function commit() {
    await run(async () => {
      const v = await api.commit({ token: preview.token });
      setLast(v);
      setPreview(null);
    });
  }
  function useStatement(v) {
    setDate(v.date);
    setCash(
      Object.entries(v.cash || {})
        .map(([k, n]) => k + " " + n)
        .join("\n"),
    );
    setPos((v.positions || []).map((p) => [p.symbol, p.quantity, p.currency, p.mic].filter(v => v != null && v !== "").join(" ")).join("\n"));
    setNav(v.base === "AUD" && v.nav != null ? String(v.nav) : "");
    setCompare(null);
    setFlow(false);
    setTab("check");
  }
  function compareArgs() {
    return {
      account,
      date,
      cash: parseCash(cash),
      positions: pos.trim() ? parsePositions(pos) : undefined,
      nav: nav.trim() || null,
      flowsReviewed: flow,
      source: webullSample ? "示例 Webull 月结单" : "券商结单",
    };
  }
  function openManual(sample = false) {
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
        : { ...blank, date: d.date },
    );
    setModal("manual");
  }
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
  if (!d.accounts.some((a) => a.active))
    return (
      <Card title="导入与对账">
        <Empty>请先建立一个券商账户。</Empty>
        <button className="primary" onClick={() => onPage("settings")}>
          建立账户
        </button>
      </Card>
    );
  return (
    <>
      <div className="page-controls">
        <Tabs
          items={[
            ["file", "导入与同步"],
            ["check", "结单对账"],
            ["history", "交易流水"],
            ["opening", "期初余额"],
          ]}
          value={tab}
          onChange={setTab}
        />
        {(tab !== "file" || broker !== "both") && <AccountSelect data={d} value={account} set={selectAccount} />}
      </div>
      {tab === "file" && (
        <>
          <Card
            title="选择券商数据"
            action={
              <Tabs
                items={[
                  ["webull", "Webull AU"],
                  ["ibkr", "IBKR"],
                  ["both", "两家一起"],
                ]}
                value={broker}
                onChange={chooseBroker}
              />
            }
          >
            {broker === "both" && (
              <div className="form-grid">
                {[
                  ["ibkr", "IBKR 入账账户"],
                  ["webull", "Webull 入账账户"],
                ].map(([k, l]) => (
                  <Field key={k} label={l}>
                    <select
                      value={mapping[k]}
                      onChange={(e) => {
                        setMapping({ ...mapping, [k]: e.target.value });
                        setPreview(null);
                        setLast(null);
                      }}
                    >
                      <option value="">选择账户</option>
                      {d.accounts
                        .filter((a) => a.active)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                ))}
              </div>
            )}
            <div className="import-options">
              {broker !== "both" && (
                <button onClick={() => prepare("file")}>
                  <FileUp />
                  <b>选择{broker === "ibkr" ? " Flex XML" : "成交 CSV"}</b>
                  <small>预览文件中的新增、重复和待核对记录</small>
                </button>
              )}
              {demo ? (
                <button onClick={() => prepare("sample")}>
                  <FileText />
                  <b>载入示例文件</b>
                  <small>
                    {broker === "both" ? "分别查看 IBKR 结单和 Webull 成交" : broker === "ibkr" ? "一笔 AAPL 买入和同期现金、持仓结单" : "一笔 BHP 买入，可重复导入"}
                  </small>
                </button>
              ) : (
                <button onClick={() => prepare("live")}>
                  <CloudDownload />
                  <b>从券商拉取</b>
                  <small>
                    {broker === "both" ? "IBKR Flex 报表和 Webull AU 近六个月流水及账户金额" : broker === "ibkr" ? "最近 365 天的 Activity Flex 记录" : "最近六个月的流水及本次账户金额"}
                  </small>
                </button>
              )}
            </div>
            {!demo && (
              <button className="text-btn" onClick={() => onPage("settings", { tab: "connections" })}>
                管理券商连接 <ArrowRight size={15} />
              </button>
            )}
          </Card>
          {(preview || last) && (
            <ImportPreview
              key={preview?.token || "result"}
              result={preview || last}
              done={Boolean(last)}
              accounts={d.accounts}
              confirm={commit}
              close={() => setPreview(null)}
              reconcile={(r) => {
                selectAccount(r.account, true);
                useStatement(r.statement || { date: d.date });
              }}
            />
          )}
          {d.batches.length > 0 && (
            <Card title="最近导入批次">
              <Table head={["文件或连接", "时间", "新增", "重复", "更正"]}>
                {d.batches
                  .filter((b) => broker === "both" ? Object.values(mapping).includes(b.account) : b.account === account)
                  .slice(0, 8)
                  .map((b) => (
                    <tr key={b.id}>
                      <td>{b.source}</td>
                      <td>{new Date(b.created).toLocaleString("zh-CN")}</td>
                      <td>{b.data.imported}</td>
                      <td>{b.data.duplicate}</td>
                      <td>{(b.data.updated || 0) + (b.data.repaired || 0)}</td>
                    </tr>
                  ))}
              </Table>
            </Card>
          )}
        </>
      )}
      {tab === "check" && (
        <>
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
              <Field label="各币种期末现金（每行一项）">
                <textarea
                  value={cash}
                  placeholder={"AUD 7600\nUSD 2000"}
                  onChange={(e) => {
                    setCash(e.target.value);
                    setCompare(null);
                  }}
                />
              </Field>
              <Field label="结单持仓（代码和数量，每行一项）">
                <textarea
                  value={pos}
                  placeholder={"BHP 150\nA200 200"}
                  onChange={(e) => {
                    setPos(e.target.value);
                    setCompare(null);
                  }}
                />
              </Field>
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
                <button onClick={() => run(() => api.recordAccountValue({ ...compareArgs(), positions: parsePositions(pos) }), "已保存同日券商估值")}>
                  核对现金及持仓，采用券商净值
                </button>
              )}
            </div>
            {compare && (
              <>
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
          </div>
          {ledger.length ? (
            <Table head={["日期", "活动", "证券", "数量 / 金额", "币种", "来源 / 凭证", ""]}>
              {ledger.map((v) => (
                <tr key={v.id}>
                  <td>{String(v.date).slice(0, 10)}</td>
                  <td>{types[v.activityType] || v.activityType}{v.metadata?.supersededBy && <small>已冲销重复流水</small>}</td>
                  <td>{v.assetSymbol || "—"}</td>
                  <td>{num(v.quantity ?? v.amount)}</td>
                  <td>{v.currency}</td>
                  <td>
                    {v.sourceSystem || "原账本"}
                    <small>{v.sourceRecordId || v.comment}</small>
                  </td>
                  <td>
                    <button onClick={() => run(() => edit(v), false)}>核对 / 更正</button>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>没有找到流水。</Empty>
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
        <Card title="从一份结单建立期初余额">
          <p>选择开始跟踪的日期，按结单分别填写证券和现金。期初资产会作为计算起点。</p>
          <div className="form-grid">
            <Field label="期初日期">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="现金（币种 余额）">
              <textarea
                value={openCash}
                onChange={(e) => setOpenCash(e.target.value)}
                placeholder="AUD 10000"
              />
            </Field>
            <Field label="持仓（代码 数量 币种 交易所 单价 类型）">
              <textarea
                value={openPos}
                onChange={(e) => setOpenPos(e.target.value)}
                placeholder="AAPL 10 USD XNAS 180 EQUITY"
              />
            </Field>
          </div>
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                await api.opening({
                  account,
                  date,
                  cash: parseCash(openCash),
                  positions: parsePositions(openPos, true),
                });
                setTab("history");
              }, "期初余额已保存")
            }
          >
            保存期初余额
          </button>
        </Card>
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
                <select value={form.type} onChange={(e) => change("type", e.target.value)}>
                  {Object.entries(types).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              {[
                ["date", "日期", "date"],
                ["currency", "币种", "text"],
                ...(["BUY", "SELL"].includes(form.type)
                  ? [
                      ["symbol", "证券代码", "text"],
                      ["mic", "交易所代码", "text"],
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
