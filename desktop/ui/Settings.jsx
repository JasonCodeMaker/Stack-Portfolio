// Settings (spec §4.6): three tabs of cards, one column up to 880 wide or at most two columns up to 1760.
import React, { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { api, Modal, kind } from "./common";
import { Grid, useShell } from "./Shell";
import { marketNames } from "./HoldingEditor";
import { scopedAliasKey } from "../allocation/domain/identifiers";
import { BookBackups } from "./BookBackups";
import { aliasRows, brokerState, cardColumns } from "./settingsModel.js";

const tabs = [
  ["connections", "券商连接"],
  ["book", "账本"],
  ["data", "数据"],
];

function F({ label, children }) {
  return (
    <label className="f">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Panel({ title, action, children }) {
  return (
    <section className="card" aria-label={title}>
      <div className="row">
        <h2>{title}</h2>
        <span className="sp" />
        {action}
      </div>
      {children}
    </section>
  );
}
function Fold({ title, children }) {
  return (
    <details className="card" open>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
const securityLabel = (r) =>
  [r.name || r.ticker, r.ticker, marketNames[r.mic] || r.mic || "上市地待补", r.localCurrency].join(" · ");

export function Settings({ d, mode, theme = "system", onThemeChange, run, initial = {}, workspace, openHome, onPage }) {
  const demo = mode === "demo";
  const { cols } = useShell();
  const [tab, setTab] = useState(initial.tab || "connections"),
    [name, setName] = useState(""),
    [ccy, setCcy] = useState("AUD"),
    [conn, setConn] = useState(null),
    [draft, setDraft] = useState({}),
    [web, setWeb] = useState(null),
    [market, setMarket] = useState(null),
    [dialog, setDialog] = useState("");
  const [asset, setAsset] = useState("fx"),
    [price, setPrice] = useState(""),
    [date, setDate] = useState(d.date),
    [fund, setFund] = useState(d.etfData[0]?.asset.etfKey || "");
  const [pm, setPm] = useState("auto"),
    [provider, setProvider] = useState("ishares"),
    [identity, setIdentity] = useState(""),
    [alias, setAlias] = useState({ provider: "manual", key: "", id: "" });
  const [override, setOverride] = useState(""),
    [type, setType] = useState("etf"),
    [reset, setReset] = useState({ broker: "ibkr", account: d.selected[0] || "" });
  useEffect(() => {
    let active = true;
    api
      .connections()
      .then((c) => {
        if (active) setConn(c);
      })
      .catch(() => {});
    api
      .marketSettings()
      .then((m) => {
        if (active) setMarket(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [d, mode]);
  useEffect(() => {
    setPm(d.settings.providerModes[fund] || "auto");
    setProvider(d.settings.pinnedProviders[fund] || "ishares");
    setIdentity(d.settings.providerIdentities[fund] || "");
  }, [fund, d.settings]);
  const change = (key, v) => setDraft({ ...draft, [key]: v });
  const secured = (key) => (conn?.present[key] ? "已保存，留空保留" : "尚未连接");
  const saveSettings = (patch) => api.allocationSettings({ ...d.settings, ...patch });
  const rows = Array.from(new Map(d.rows.filter((r) => r.profileId).map((r) => [r.assetId, r])).values());
  async function saveKeys(keys) {
    const data = Object.fromEntries(keys.filter((k) => draft[k]?.trim()).map((k) => [k, draft[k].trim()]));
    if (!Object.keys(data).length) throw Error("请填写要保存的连接信息。");
    await api.saveConnection(data);
    setDraft({});
    setConn(await api.connections());
  }
  const secretField = (label, k) => (
    <F key={k} label={label}>
      <input
        type="password"
        autoComplete="off"
        placeholder={secured(k)}
        value={draft[k] || ""}
        onChange={(e) => change(k, e.target.value)}
      />
    </F>
  );
  const brokerStatus = (state, b) => (
    <div className="status">
      <span className={"dot " + state.tone} />
      <b>{state.label}</b>
      <span className="cap">
        {state.lastSuccess ? "上次成功 " + new Date(state.lastSuccess).toLocaleString("zh-CN") : "尚无同步记录"}
      </span>
      <span className="sp" />
      {state.canUpdate && (
        <button className="btn sm" onClick={() => onPage("imports", { broker: b, sync: true })}>
          立即更新
        </button>
      )}
    </div>
  );
  const ibkr = brokerState(conn, "ibkr", demo),
    webull = brokerState(conn, "webull", demo);

  const cards = {
    ibkr: (
      <Panel title="Interactive Brokers">
        {brokerStatus(ibkr, "ibkr")}
        <details open={ibkr.needsAuth || initial.broker === "ibkr"}>
          <summary>{ibkr.needsAuth ? "连接 IBKR" : "授权设置"}</summary>
          <p className="muted">
            在盈透客户门户打开 Performance &amp; Reports → Flex Queries，点 Flex Web Service Configuration
            的齿轮，复制 Current Token。
          </p>
          <div className="fg">
            <F label="Flex Query ID">
              <input
                value={draft["ibkr.flex-query-id"] ?? conn?.query ?? ""}
                onChange={(e) => change("ibkr.flex-query-id", e.target.value)}
              />
            </F>
            {secretField("Flex Token", "ibkr.flex-token")}
          </div>
          <div className="acts">
            <button
              className="btn pri"
              disabled={demo}
              onClick={() => run(() => saveKeys(["ibkr.flex-query-id", "ibkr.flex-token"]), "IBKR 连接设置已保存")}
            >
              保存 IBKR 设置
            </button>
            <button className="btn" disabled={demo} onClick={() => setDialog("ibkr")}>
              断开 IBKR
            </button>
          </div>
        </details>
      </Panel>
    ),
    webull: (
      <Panel title="Webull Australia">
        {brokerStatus(webull, "webull")}
        <details open={webull.needsAuth || initial.broker === "webull"}>
          <summary>{webull.needsAuth ? "连接 Webull" : "授权与账户"}</summary>
          <div className="fg">
            <F label="App Key">
              <input
                value={draft["webull.app-key"] ?? conn?.webullKey ?? ""}
                onChange={(e) => change("webull.app-key", e.target.value)}
              />
            </F>
            {secretField("App Secret", "webull.app-secret")}
          </div>
          <div className="acts">
            <button
              className="btn pri"
              disabled={demo}
              onClick={() => run(() => saveKeys(["webull.app-key", "webull.app-secret"]), "Webull 设置已保存")}
            >
              保存 Webull 设置
            </button>
            <button
              className="btn"
              disabled={demo}
              onClick={() =>
                run(async () => {
                  setWeb(await api.connectWebull());
                  setConn(await api.connections());
                }, false)
              }
            >
              连接 / 检查手机授权
            </button>
          </div>
          {web && (
            <p className="muted">
              {web.status === "PENDING"
                ? "在 Webull 手机 App 打开 Menu → Messages → OpenAPI Notifications，选择最新消息，点 Check Now 完成验证，再点击这里的「检查手机授权」。"
                : web.status}
            </p>
          )}
          {web?.accounts.length > 0 && (
            <div className="fg">
              <F label="Webull 券商账户">
                <select
                  value={conn?.webullId}
                  onChange={(e) =>
                    run(async () => {
                      await api.saveConnection({ "webull.api-account-id": e.target.value });
                      setConn(await api.connections());
                    }, "账户已关联")
                  }
                >
                  <option value="">选择券商账户</option>
                  {web.accounts.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.accountNumber || a.accountId}
                    </option>
                  ))}
                </select>
              </F>
            </div>
          )}
          <div className="acts">
            <button className="btn" disabled={demo} onClick={() => setDialog("webull")}>
              断开 Webull
            </button>
          </div>
        </details>
      </Panel>
    ),
    market: (
      <Panel title="行情自动更新">
        <p className="muted">
          持仓的每日收盘价、美元兑澳元汇率和标普 500、纳斯达克 100 总回报指数来自 Yahoo Finance 与 FRED
          的公开数据，无需 API Key。请求只包含证券代码和日期。
        </p>
        <label className="chk">
          <input
            type="checkbox"
            disabled={demo || !market}
            checked={market?.autoUpdate ?? true}
            onChange={(e) =>
              run(async () => setMarket(await api.marketSettings({ autoUpdate: e.target.checked })), "行情更新设置已保存")
            }
          />
          打开软件和进入收益复盘时自动更新
        </label>
        <div className="acts">
          <button
            className="btn"
            disabled={demo}
            onClick={() =>
              run(async () => {
                const results = await api.updateMarket();
                setMarket(await api.marketSettings());
                const failed = results.filter((r) => r.error);
                return (
                  "已更新 " +
                  results.filter((r) => !r.error).length +
                  " 项行情" +
                  (failed.length ? "；未能更新 " + failed.map((r) => r.name + "（" + r.error + "）").join("、") : "")
                );
              }, true)
            }
          >
            立即更新行情
          </button>
          <span className="cap">
            {market?.last ? "上次更新 " + new Date(market.last).toLocaleString("zh-CN") : "尚未自动更新过"}
          </span>
        </div>
      </Panel>
    ),
    sources: (
      <Fold title="其他行情来源">
        <p className="muted">
          Twelve Data 用于盘中报价，以及补齐公开来源没有的历史收盘价；Alpha Vantage 用于部分 ETF
          的成分数据。不填也可以正常使用。
        </p>
        <div className="fg">
          {secretField("Twelve Data API Key", "twelvedata.apiKey")}
          {secretField("Alpha Vantage API Key", "alphaVantage.apiKey")}
        </div>
        <div className="acts">
          <button
            className="btn pri"
            disabled={demo}
            onClick={() => run(() => saveKeys(["twelvedata.apiKey", "alphaVantage.apiKey"]), "数据源设置已保存")}
          >
            保存数据源设置
          </button>
          <button
            className="btn"
            disabled={demo}
            onClick={() =>
              run(async () => {
                const r = await api.refreshMarket({ ids: d.selected });
                return "报价已更新 " + r.updated + " 项" + (r.failed.length ? "；需核对 " + r.failed.join("、") : "");
              }, true)
            }
          >
            用 Twelve Data 刷新盘中报价
          </button>
        </div>
        <label className="chk">
          <input
            type="checkbox"
            checked={d.settings.liveFxPolling}
            onChange={(e) => run(() => saveSettings({ liveFxPolling: e.target.checked }), "汇率刷新设置已保存")}
          />
          有 Twelve Data Key 时，每 5 分钟检查一次 USD/AUD 实时汇率
        </label>
      </Fold>
    ),
    reset: (
      <Fold title="重置某个账户的券商同步标记">
        <div className="acts">
          <select
            className="btn"
            aria-label="券商"
            value={reset.broker}
            onChange={(e) => setReset({ ...reset, broker: e.target.value })}
          >
            <option value="ibkr">IBKR</option>
            <option value="webull">Webull AU</option>
          </select>
          <select
            className="btn"
            aria-label="账户"
            value={reset.account}
            onChange={(e) => setReset({ ...reset, account: e.target.value })}
          >
            {d.accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setDialog("reset")}>
            选择重置
          </button>
        </div>
      </Fold>
    ),
    book: (
      <Panel title="当前账本">
        <div className="bsum">
          <span className="av">
            <Database size={24} strokeWidth={1.8} />
          </span>
          <div>
            <b>{demo ? "示例账本" : "正式账本"}</b>
            <p className="cap">
              {d.migration
                ? "已从 Wealthfolio 迁入 · " + new Date(d.migration.at).toLocaleDateString("zh-CN")
                : demo
                  ? "虚构交易、行情及结单，可用于试用。"
                  : "本机独立保存的投资记录。"}
            </p>
          </div>
        </div>
        {d.migration && (
          <div className="mini">
            {[
              ["账户", "accounts"],
              ["历史流水", "activities"],
              ["估值记录", "valuations"],
              ["配置数据", "allocation"],
              ["同步设置与记录", "broker"],
            ].map(([l, k]) => (
              <span key={k}>
                <b>{d.migration[k]}</b>
                {l}
              </span>
            ))}
          </div>
        )}
        <div className="acts">
          <button className="btn" onClick={openHome}>
            切换账本 / 迁入 Wealthfolio
          </button>
          <BookBackups run={run} restored={workspace} />
        </div>
      </Panel>
    ),
    accounts: (
      <Panel title="账户">
        <table>
          <thead>
            <tr>
              <th className="l">名称</th>
              <th className="l">基础币种</th>
              <th className="l">状态</th>
            </tr>
          </thead>
          <tbody>
            {d.accounts.map((a) => (
              <tr key={a.id}>
                <td className="l">{a.name}</td>
                <td className="l">{a.currency}</td>
                <td className="l">{a.active ? "启用" : "归档"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="fg end"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.account({ name, currency: ccy });
              setName("");
            }, "账户已创建");
          }}
        >
          <F label="新账户名称">
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 IBKR" />
          </F>
          <F label="币种">
            <select value={ccy} onChange={(e) => setCcy(e.target.value)}>
              <option>AUD</option>
              <option>USD</option>
            </select>
          </F>
          <button className="btn pri">创建账户</button>
        </form>
      </Panel>
    ),
    price: (
      <Panel title="维护结单报价">
        <div className="fg">
          <F label="证券或汇率">
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              <option value="fx">USD → AUD</option>
              {rows.map((r) => (
                <option key={r.assetId} value={r.assetId}>
                  {r.ticker} · {r.localCurrency}
                </option>
              ))}
            </select>
          </F>
          <F label="报价日期">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </F>
          <F label="原币单价 / 汇率">
            <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
          </F>
        </div>
        <div className="acts">
          <button
            className="btn pri"
            onClick={() =>
              run(async () => {
                await api.savePrice({ assetId: asset === "fx" ? null : asset, from: "USD", date, price });
                setPrice("");
              }, "报价已保存")
            }
          >
            保存报价
          </button>
        </div>
      </Panel>
    ),
    fund: (
      <Fold title="手动调整基金数据来源">
        {d.etfData.length ? (
          <>
            <div className="fg">
              <F label="基金">
                <select value={fund} onChange={(e) => setFund(e.target.value)}>
                  {d.etfData.map((v) => (
                    <option key={v.asset.etfKey} value={v.asset.etfKey}>
                      {v.asset.symbol}
                    </option>
                  ))}
                </select>
              </F>
              <F label="数据源模式">
                <select value={pm} onChange={(e) => setPm(e.target.value)}>
                  <option value="auto">自动选择</option>
                  <option value="pinned">固定数据源</option>
                </select>
              </F>
              <F label="固定数据源">
                <select disabled={pm !== "pinned"} value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {["ishares", "invesco", "betashares", "alpha-vantage"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </F>
              <F label="发行商标识">
                <input
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  placeholder="产品 ID、CUSIP 或基金代码"
                />
              </F>
            </div>
            <div className="acts">
              <button
                className="btn pri"
                onClick={() =>
                  run(
                    () =>
                      saveSettings({
                        providerModes: { ...d.settings.providerModes, [fund]: pm },
                        pinnedProviders: { ...d.settings.pinnedProviders, [fund]: provider },
                        providerIdentities: { ...d.settings.providerIdentities, [fund]: identity.trim() },
                      }),
                    "来源已保存",
                  )
                }
              >
                保存基金来源
              </button>
            </div>
          </>
        ) : (
          <p className="muted">持有 ETF 后可设置发行商。</p>
        )}
      </Fold>
    ),
    classes: (
      <Fold title="更正证券类别及基金成分匹配">
        <div className="fg">
          <F label="证券">
            <select value={override} onChange={(e) => setOverride(e.target.value)}>
              <option value="">选择证券</option>
              {rows.map((r) => (
                <option key={r.assetId} value={r.assetId}>
                  {securityLabel(r)}
                </option>
              ))}
            </select>
          </F>
          <F label="分类">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(kind)
                .filter(([k]) => k !== "cash")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </F>
        </div>
        <div className="acts">
          <button
            className="btn pri"
            disabled={!override}
            onClick={() =>
              run(
                () => saveSettings({ typeOverrides: { ...d.settings.typeOverrides, [override]: type } }),
                "证券分类已保存",
              )
            }
          >
            保存分类
          </button>
        </div>
        <div className="sub">当前基金的标识映射</div>
        {aliasRows(d.settings.aliases).length > 0 && (
          <table>
            <thead>
              <tr>
                <th className="l">来源</th>
                <th className="l">来源标识</th>
                <th className="l">规范标识</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {aliasRows(d.settings.aliases).map((a) => (
                <tr key={a.key}>
                  <td className="l">{a.provider}</td>
                  <td className="l">{a.source}</td>
                  <td className="l">{a.id}</td>
                  <td>
                    <button
                      className="lnk"
                      aria-label={"移除映射 " + a.source}
                      onClick={() =>
                        run(async () => {
                          const aliases = { ...d.settings.aliases };
                          delete aliases[a.key];
                          await saveSettings({ aliases });
                        }, "映射已移除")
                      }
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!!fund && (
          <>
            <div className="fg">
              {[
                ["provider", "来源"],
                ["key", "来源标识"],
                ["id", "规范标识"],
              ].map(([k, l]) => (
                <F key={k} label={l}>
                  <input value={alias[k]} onChange={(e) => setAlias({ ...alias, [k]: e.target.value })} />
                </F>
              ))}
            </div>
            <div className="acts">
              <button
                className="btn"
                disabled={!alias.key.trim() || !alias.id.trim() || !alias.provider.trim()}
                onClick={() =>
                  run(
                    () =>
                      saveSettings({
                        aliases: {
                          ...d.settings.aliases,
                          [scopedAliasKey({ provider: alias.provider, etfKey: fund }, alias.key)]: alias.id.trim(),
                        },
                      }),
                    "标识映射已保存",
                  )
                }
              >
                添加映射
              </button>
            </div>
          </>
        )}
      </Fold>
    ),
  };
  const keys = {
    connections: ["ibkr", "webull", "market", "sources", "reset"],
    book: ["book", "accounts"],
    data: ["price", "fund", "classes"],
  }[tab];
  const confirm = {
    reset: ["重置同步标记", "下次预览会重新与本地流水比对，已入账的流水会保留。", "确认重置"],
    ibkr: ["断开券商连接", "下次在线同步时需要重新授权。已导入的历史可继续查看。", "确认断开"],
    webull: ["断开券商连接", "下次在线同步时需要重新授权。已导入的历史可继续查看。", "确认断开"],
  }[dialog];
  return (
    <div className="settings">
      <div className="row">
        <div className="seg" role="group" aria-label="设置页签">
          {tabs.map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? "on" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="row m0">
          <span className="cap">主题</span>
          <select className="btn" value={theme} onChange={(e) => onThemeChange(e.target.value)}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </div>
      {tab === "connections" && demo && <div className="notice">正式账本可保存券商授权。示例账本使用随附样例。</div>}
      {cols === 1 ? (
        <div className="stack cap880">{keys.map((k) => <React.Fragment key={k}>{cards[k]}</React.Fragment>)}</div>
      ) : (
        <div className="cap1760">
          <Grid layout={cardColumns(keys)} panels={cards} />
        </div>
      )}
      {confirm && (
        <Modal title={confirm[0]} close={() => setDialog("")}>
          <p className="muted">{confirm[1]}</p>
          <div className="acts">
            <button
              className="btn pri"
              onClick={() =>
                run(async () => {
                  if (dialog === "reset") await api.resetSync(reset);
                  else
                    await api.saveConnection(
                      dialog === "ibkr"
                        ? { "ibkr.flex-query-id": null, "ibkr.flex-token": null }
                        : {
                            "webull.app-key": null,
                            "webull.api-account-id": null,
                            "webull.app-secret": null,
                            "webull.access-token": null,
                          },
                    );
                  setDialog("");
                  setConn(await api.connections());
                }, "设置已更新")
              }
            >
              {confirm[2]}
            </button>
            <button className="btn" onClick={() => setDialog("")}>
              取消
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
