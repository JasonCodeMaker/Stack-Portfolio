import React, { useEffect, useState } from "react";
import { Database, ExternalLink, Wifi, Link2 } from "lucide-react";
import { api, aud, Card, Field, Modal, Tabs, Table, Empty, kind } from "./common";
import { scopedAliasKey } from "../../src/domain/identifiers";
import { BookBackups } from "./BookBackups";
export function Settings({ d, mode, run, initial = {}, workspace, openHome }) {
  const [tab, setTab] = useState(initial.tab || "book"),
    [name, setName] = useState(""),
    [ccy, setCcy] = useState("AUD"),
    [conn, setConn] = useState({ present: {} }),
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
  const secured = (key) => (conn.present[key] ? "已保存，留空保留" : "尚未连接");
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
    <Field key={k} label={label}>
      <input
        type="password"
        autoComplete="off"
        placeholder={secured(k)}
        value={draft[k] || ""}
        onChange={(e) => change(k, e.target.value)}
      />
    </Field>
  );
  return (
    <>
      <div className="page-controls">
        <Tabs
          items={[
            ["book", "账本与备份"],
            ["connections", "券商与行情连接"],
            ["data", "报价、分类与来源"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "book" && (
        <>
          <Card title="当前账本">
            <div className="book-summary">
              <Database size={26} />
              <div>
                <b>{mode === "demo" ? "示例账本" : "正式账本"}</b>
                <p>
                  {d.migration
                    ? "已从 Wealthfolio 迁入 · " + new Date(d.migration.at).toLocaleDateString("zh-CN")
                    : mode === "demo"
                      ? "虚构交易、行情及结单，可用于试用。"
                      : "本机独立保存的投资记录。"}
                </p>
              </div>
            </div>
            {d.migration && (
              <div className="mini-stats">
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
            <div className="actions">
              <button onClick={openHome}>切换账本 / 迁入 Wealthfolio</button>
              <BookBackups run={run} restored={workspace} />
            </div>
          </Card>
          <Card title="账户">
            <Table head={["名称", "基础币种", "状态"]}>
              {d.accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.currency}</td>
                  <td>{a.active ? "启用" : "归档"}</td>
                </tr>
              ))}
            </Table>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api.account({ name, currency: ccy });
                  setName("");
                }, "账户已创建");
              }}
            >
              <Field label="新账户名称">
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如 IBKR"
                />
              </Field>
              <Field label="币种">
                <select value={ccy} onChange={(e) => setCcy(e.target.value)}>
                  <option>AUD</option>
                  <option>USD</option>
                </select>
              </Field>
              <button className="primary">创建账户</button>
            </form>
          </Card>
        </>
      )}
      {tab === "connections" && (
        <>
          {mode === "demo" && <div className="notice">正式账本可保存券商授权。示例账本使用随附样例。</div>}
          <Card title="Interactive Brokers · Activity Flex">
            <p className="muted">在盈透客户门户打开 Performance &amp; Reports → Flex Queries，点 Flex Web Service Configuration 的齿轮，复制 Current Token。</p>
            <div className="form-grid">
              <Field label="Flex Query ID">
                <input
                  value={draft["ibkr.flex-query-id"] ?? conn.query ?? ""}
                  onChange={(e) => change("ibkr.flex-query-id", e.target.value)}
                />
              </Field>
              {secretField("Flex Token", "ibkr.flex-token")}
            </div>
            <div className="actions">
              <button
                className="primary"
                disabled={mode === "demo"}
                onClick={() =>
                  run(() => saveKeys(["ibkr.flex-query-id", "ibkr.flex-token"]), "IBKR 连接设置已保存")
                }
              >
                保存 IBKR 设置
              </button>
              <button disabled={mode === "demo"} onClick={() => setDialog("ibkr")}>
                断开 IBKR
              </button>
            </div>
          </Card>
          <Card title="Webull Australia · OpenAPI">
            <div className="form-grid">
              <Field label="App Key">
                <input
                  value={draft["webull.app-key"] ?? conn.webullKey ?? ""}
                  onChange={(e) => change("webull.app-key", e.target.value)}
                />
              </Field>
              {secretField("App Secret", "webull.app-secret")}
            </div>
            <div className="actions">
              <button
                className="primary"
                disabled={mode === "demo"}
                onClick={() =>
                  run(() => saveKeys(["webull.app-key", "webull.app-secret"]), "Webull 设置已保存")
                }
              >
                保存 Webull 设置
              </button>
              <button
                disabled={mode === "demo"}
                onClick={() =>
                  run(async () => {
                    setWeb(await api.connectWebull());
                    setConn(await api.connections());
                  }, false)
                }
              >
                连接 / 检查手机授权
              </button>
              <button disabled={mode === "demo"} onClick={() => setDialog("webull")}>
                断开 Webull
              </button>
            </div>
            {web && (
              <p>
                {web.status === "PENDING"
                  ? "在 Webull 手机 App 打开 Menu → Messages → OpenAPI Notifications，选择最新消息，点 Check Now 完成验证，再点击这里的「检查手机授权」。"
                  : web.status}
              </p>
            )}
            {web?.accounts.length > 0 && (
              <Field label="Webull 券商账户">
                <select
                  value={conn.webullId}
                  onChange={(e) =>
                    run(async () => {
                      await api.saveConnection({ "webull.api-account-id": e.target.value });
                      setConn(await api.connections());
                    }, "账户已关联")
                  }
                >
                  {web.accounts.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.accountNumber || a.accountId}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </Card>
          <Card title="行情自动更新">
            <p className="muted">
              持仓的每日收盘价、美元兑澳元汇率和标普 500、纳斯达克 100 总回报指数来自 Yahoo Finance 与 FRED 的公开数据，无需 API
              Key。请求只包含证券代码和日期。
            </p>
            <label className="check">
              <input
                type="checkbox"
                disabled={mode === "demo" || !market}
                checked={market?.autoUpdate ?? true}
                onChange={(e) =>
                  run(async () => setMarket(await api.marketSettings({ autoUpdate: e.target.checked })), "行情更新设置已保存")
                }
              />
              打开软件和进入策略复盘时自动更新
            </label>
            <div className="actions">
              <button
                disabled={mode === "demo"}
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
              <span className="muted">
                {market?.last ? "上次更新 " + new Date(market.last).toLocaleString("zh-CN") : "尚未自动更新过"}
              </span>
            </div>
          </Card>
          <Card title="可选数据源">
            <p className="muted">
              Twelve Data 用于盘中报价，以及补齐公开来源没有的历史收盘价；Alpha Vantage 用于部分 ETF 的成分数据。不填也可以正常使用。
            </p>
            <div className="form-grid">
              {secretField("Twelve Data API Key", "twelvedata.apiKey")}
              {secretField("Alpha Vantage API Key", "alphaVantage.apiKey")}
            </div>
            <div className="actions">
              <button
                className="primary"
                disabled={mode === "demo"}
                onClick={() =>
                  run(() => saveKeys(["twelvedata.apiKey", "alphaVantage.apiKey"]), "数据源设置已保存")
                }
              >
                保存数据源设置
              </button>
              <button
                disabled={mode === "demo"}
                onClick={() =>
                  run(async () => {
                    const r = await api.refreshMarket({ ids: d.selected });
                    return (
                      "报价已更新 " +
                      r.updated +
                      " 项" +
                      (r.failed.length ? "；需核对 " + r.failed.join("、") : "")
                    );
                  }, true)
                }
              >
                用 Twelve Data 刷新盘中报价
              </button>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={d.settings.liveFxPolling}
                onChange={(e) =>
                  run(() => saveSettings({ liveFxPolling: e.target.checked }), "汇率刷新设置已保存")
                }
              />
              有 Twelve Data Key 时，每 5 分钟检查一次 USD/AUD 实时汇率
            </label>
          </Card>
          <details className="card">
            <summary>重置某个账户的券商同步标记</summary>
            <div className="actions">
              <select value={reset.broker} onChange={(e) => setReset({ ...reset, broker: e.target.value })}>
                <option value="ibkr">IBKR</option>
                <option value="webull">Webull AU</option>
              </select>
              <select value={reset.account} onChange={(e) => setReset({ ...reset, account: e.target.value })}>
                {d.accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button onClick={() => setDialog("reset")}>选择重置</button>
            </div>
          </details>
        </>
      )}
      {tab === "data" && (
        <>
          <Card title="维护结单报价">
            <div className="form-grid">
              <Field label="证券或汇率">
                <select value={asset} onChange={(e) => setAsset(e.target.value)}>
                  <option value="fx">USD → AUD</option>
                  {rows.map((r) => (
                    <option key={r.assetId} value={r.assetId}>
                      {r.ticker} · {r.localCurrency}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="报价日期">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="原币单价 / 汇率">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
            </div>
            <button
              className="primary"
              onClick={() =>
                run(async () => {
                  await api.savePrice({ assetId: asset === "fx" ? null : asset, from: "USD", date, price });
                  setPrice("");
                }, "报价已保存")
              }
            >
              保存报价
            </button>
          </Card>
          <Card title="ETF 数据源与标识">
            {d.etfData.length ? (
              <>
                <div className="form-grid">
                  <Field label="基金">
                    <select value={fund} onChange={(e) => setFund(e.target.value)}>
                      {d.etfData.map((v) => (
                        <option key={v.asset.etfKey} value={v.asset.etfKey}>
                          {v.asset.symbol}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="数据源模式">
                    <select value={pm} onChange={(e) => setPm(e.target.value)}>
                      <option value="auto">自动选择</option>
                      <option value="pinned">固定数据源</option>
                    </select>
                  </Field>
                  <Field label="固定数据源">
                    <select
                      disabled={pm !== "pinned"}
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                    >
                      {["ishares", "invesco", "betashares", "alpha-vantage"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="发行商标识">
                    <input
                      value={identity}
                      onChange={(e) => setIdentity(e.target.value)}
                      placeholder="产品 ID、CUSIP 或基金代码"
                    />
                  </Field>
                </div>
                <button
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
              </>
            ) : (
              <Empty>持有 ETF 后可设置发行商。</Empty>
            )}
          </Card>
          <Card title="证券分类与标识映射">
            <div className="inline-form">
              <Field label="证券">
                <select value={override} onChange={(e) => setOverride(e.target.value)}>
                  <option value="">选择证券</option>
                  {rows.map((r) => (
                    <option key={r.assetId} value={r.assetId}>
                      {r.ticker}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="分类">
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {Object.entries(kind)
                    .filter(([k]) => k !== "cash")
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </select>
              </Field>
              <button
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
            {!!fund && (
              <>
                <h3>当前基金的标识映射</h3>
                <div className="form-grid">
                  {[
                    ["provider", "来源"],
                    ["key", "来源标识"],
                    ["id", "规范标识"],
                  ].map(([k, l]) => (
                    <Field key={k} label={l}>
                      <input value={alias[k]} onChange={(e) => setAlias({ ...alias, [k]: e.target.value })} />
                    </Field>
                  ))}
                </div>
                <button
                  disabled={!alias.key.trim() || !alias.id.trim() || !alias.provider.trim()}
                  onClick={() =>
                    run(
                      () =>
                        saveSettings({
                          aliases: {
                            ...d.settings.aliases,
                            [scopedAliasKey({ provider: alias.provider, etfKey: fund }, alias.key)]:
                              alias.id.trim(),
                          },
                        }),
                      "标识映射已保存",
                    )
                  }
                >
                  保存映射
                </button>
              </>
            )}
            {Object.entries(d.settings.aliases).map(([k, v]) => (
              <p key={k}>
                {k} → {v}{" "}
                <button
                  onClick={() =>
                    run(async () => {
                      const aliases = { ...d.settings.aliases };
                      delete aliases[k];
                      await saveSettings({ aliases });
                    }, "映射已移除")
                  }
                >
                  移除
                </button>
              </p>
            ))}
          </Card>
        </>
      )}
      {dialog && (
        <Modal title={dialog === "reset" ? "重置同步标记" : "断开券商连接"} close={() => setDialog("")}>
          <p>
            {dialog === "reset"
              ? "下次预览会重新与本地流水比对，已入账的流水会保留。"
              : "下次在线同步时需要重新授权。已导入的历史可继续查看。"}
          </p>
          <button
            className="primary"
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
            确认
          </button>
        </Modal>
      )}
    </>
  );
}
