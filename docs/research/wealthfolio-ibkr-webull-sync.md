# Wealthfolio 自动追踪 IBKR 与 Webull 的可行性分析

> 调研日期：2026-08-28  
> 范围：仅使用 Wealthfolio 官方网站、官方文档与官方源码，IBKR 官方 API 文档，以及 Webull 官方开发者资料。本文将问题中的“IKBR”按 **IBKR（Interactive Brokers）** 理解。

## 结论先行

1. **若目标是低维护、无人值守地每天更新，直接使用 Wealthfolio Connect。** Wealthfolio 当前支持 **Interactive Brokers（API Token）**、**Webull US（OAuth）** 和 **Webull Canada（OAuth）**；连接为只读，由 SnapTrade 提供。[支持的券商](https://wealthfolio.app/connect/brokerages/)
2. **Wealthfolio Connect 不是实时同步。** Essentials 方案目前为 US$7.99/月、最多 5 个机构连接，官方承诺是 **Daily sync**；虽然 self-hosted 源码中的本地 broker scheduler 每 4 小时运行一次，但这不保证聚合器或券商每 4 小时提供新数据。[Connect 方案与同步频率](https://wealthfolio.app/connect/)；[server scheduler 源码](https://github.com/wealthfolio/wealthfolio/blob/main/apps/server/src/main.rs)
3. **若“实时”指盘中分钟级持仓、现金和交易变化，Wealthfolio 没有现成的官方方案。** 可自行建设一个常驻的 broker adapter：分别拉取 IBKR 与 Webull，再将规范化的活动或持仓快照写入 Wealthfolio。该方案能做到约 1–5 分钟，但认证、去重、对账、故障恢复和长期维护均由自己承担。
4. **不要把实时行情与实时账户同步混为一谈。** 两家券商都支持实时行情，但行情只能更新证券价格；它不能自动补齐成交、分红、费用、入出金或成本基础。Wealthfolio 的真实收益计算依赖完整活动历史。[Wealthfolio Tracking Modes](https://wealthfolio.app/docs/concepts/tracking-modes/)
5. **对本仓库当前的 Portfolio X-Ray add-on，不建议直接塞入券商同步。** 当前 `manifest.json` 只申请账户/持仓读取权限，且该 add-on 的职责是组合穿透分析。券商同步需要新增账户、活动、快照、网络和密钥等高权限，最好做成独立 adapter/add-on 或独立服务。

## Wealthfolio 当前具备什么

### 1. Wealthfolio Connect：现成、自动、但每日更新

官方 Connect 数据流是：用户通过 SnapTrade 连接券商，聚合器获取账户、持仓和交易，Connect 将数据传到设备，最终保存在 Wealthfolio 本地数据库；官方明确写的是 daily sync。[Connect 工作方式](https://wealthfolio.app/connect/learn-more/)

对 Webull US，官方专页进一步确认同步内容包括 holdings、balances 和 transactions；登录时可能需要 trade PIN。[Webull US Portfolio Tracker](https://wealthfolio.app/portfolio-tracker/webull/)

适合：

- 希望每天自动刷新，不想维护 API 集成；
- 接受由 SnapTrade 持有券商连接凭据/API key；
- Webull 账户属于官方支持的 US 或 Canada 连接。

限制：

- 官方没有承诺成交级、秒级或分钟级更新；
- Wealthfolio 的本地定时器更频繁运行，也不能突破券商/聚合器上游的数据刷新频率；
- 当前支持列表没有列出 **Webull Australia**。若账户属于 Webull AU，不应假定 Webull US 连接可用，应先在 Connect 的实际连接列表中确认。

### 2. CSV：免费、可重复导入、但不是自动

Wealthfolio CSV importer 可将 broker statement 映射为活动，并按账户保存映射；`activities.import` 也提供校验与重复检测能力。[CSV Import](https://wealthfolio.app/docs/guide/csv-import/)；[Addon API Reference](https://wealthfolio.app/docs/addons/api-reference/)

IBKR 可用 Flex Query 生成 CSV/XML 报告；报告通过 token、query id 和版本参数请求，再以 reference code 取回。[IBKR Retrieve generated report](https://ibkrcampus.com/docs/web-api/api-reference/get-statement)

适合一次性历史回填和定期对账，不适合实时刷新。Webull 当前没有 Wealthfolio 官方专用 CSV recipe，需要使用通用映射。

### 3. Add-on API：有写入能力，但不是可靠的后台任务平台

Wealthfolio 3.7 add-on 可调用：

- `accounts.create`；
- `activities.create`、`saveMany`、`import`；
- snapshot import/save；
- `network.request`；
- add-on scoped secrets。

因此，从数据模型上看，可以编写 broker adapter。[Addon API Reference](https://wealthfolio.app/docs/addons/api-reference/)

但官方运行模型有几个关键约束：[Add-on Development](https://wealthfolio.app/docs/addons/)

- add-on 在 sandbox iframe 中运行，不能直接 `fetch`；
- 网络只能通过 host-brokered Network API，访问 manifest 声明且经用户批准的 HTTPS host；
- secrets 由 Wealthfolio 按 add-on 隔离保存；
- 声明 route 的 add-on 可以 lazy activation，不能据此假定它始终在后台运行；
- Network API 会阻止本地/私网目标且禁用 redirect，因此不适合直接访问 localhost 上的 IBKR Client Portal Gateway，也不适合作为复杂 OAuth 浏览器回调的唯一实现位置。

结论：纯 add-on 更适合“用户打开页面后手动同步”，不适合作为 24/7、分钟级、可恢复的同步守护进程。

### 4. MCP：适合外部 worker 写入，但它不是券商连接器

Wealthfolio 自带 MCP server，可用 scoped token 读取账户/持仓/活动，并在授予写权限后 draft/commit activities；desktop 只绑定 `127.0.0.1`，self-hosted 可在认证开启后提供 `/mcp`。[MCP Server](https://wealthfolio.app/docs/guide/mcp-server/)

它适合由外部常驻 worker 写回规范化活动，但 broker API 调用、调度、token 生命周期、幂等键和对账仍需自行实现。若要直接维护 holdings snapshot，则需确认 MCP 暴露的具体工具是否覆盖该写入；否则使用独立同步 add-on 或受控导入流程。

## IBKR 官方接口与限制

### 可取的数据与实时性

- `/portfolio/accounts`：必须先调用，之后才能访问账户的 portfolio endpoints；
- `/portfolio/{accountId}/ledger`：按币种返回现金余额；
- `/portfolio/{accountId}/summary`：账户权益、保证金与应计项目；
- `/portfolio2/{accountId}/positions`：官方称为 **near-real time**，并移除了旧 positions endpoint 的缓存；返回数量、均价、市价、市值及 P&L；
- `/iserver/account/trades`：实时成交/执行报告；
- WebSocket market data：可订阅 top-of-book，但需要相应实时行情订阅和 brokerage session。

来源：[IBKR Web API Documentation](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)；[Account Positions (NEW)](https://ibkrcampus.com/docs/web-api/api-reference/trading/trading-portfolio/get-uncached-positions)；[Account Management Web API](https://ibkrcampus.com/campus/ibkr-api-page/web-api-account-management/)

### 认证与运行约束

对个人账户，最易获得的官方路径仍是本机 **Client Portal Gateway**：

- live account 必须已 fully open and funded，且官方文档要求 IBKR Pro；
- Gateway 登录不能自动化；用户必须通过浏览器 **每天重新认证**；
- 一个 IBKR username 同时只能有一个 brokerage session，和 TWS/Client Portal 等可能发生 competing session；
- 只读 `/portfolio` 数据只需要外层 read-only session，而 `/iserver` 交易、成交和市场数据需要 brokerage session；
- Gateway 总限速 10 requests/s，另有 endpoint-specific pacing；例如 `/portfolio/accounts` 为 1 request/5s，`/pa/transactions` 为 1 request/15min。

来源：[Client Portal Gateway FAQ](https://ibkrcampus.com/docs/web-api/authentication/cpgw/client-portal-gateway-faq)；[Session Authentication](https://ibkrcampus.com/docs/web-api/authentication/sessions)；[Web API Documentation](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)

OAuth 1.0a/2.0 可绕过本机 Gateway，但不是普通个人开发者“拿 client id 即用”的简单路径：OAuth 1.0a first-party 需要向 IBKR 申请和获批；OAuth 2.0 需要 IBKR 分配 client id/key，并使用 `private_key_jwt`/RSA assertion，再建立 SSO/brokerage session。[OAuth 1.0a registration](https://ibkrcampus.com/docs/web-api/authentication/oauth-1a/first-party-oauth/registration-process)；[OAuth 2.0 Access Token](https://ibkrcampus.com/docs/web-api/authentication/oauth-2/access-token)

### 对同步设计的含义

- 只做持仓/余额看板：轮询 `/portfolio2/.../positions`、ledger、summary，约 1–5 分钟一次即可；不必为了行情启用 `/iserver`。
- 要同步完整交易历史：以 Flex Query 作为日终权威账本，盘中用 trades 作为增量，日终再 reconciliation。
- 需要 24/7 无人值守：Gateway 的每日交互认证是硬阻力；除非获得合适的 OAuth 接入，否则不能承诺完全无人值守。
- 多币种 margin 账户应以 IBKR 的逐币种 ledger/statement 为对账权威，不能仅从买卖活动推导现金。

## Webull 官方接口与限制

### 可取的数据与实时性

Webull OpenAPI 提供：

- HTTP：account list、balance、positions，以及历史/快照行情；
- MQTT：实时市场数据；
- gRPC：实时事件推送，目前 Trading API 明确列出的实时事件是 order status；
- account balance 与 positions 官方限速均为 2 requests/2s，足够做 1–5 分钟轮询。

来源：[About Webull OpenAPI](https://developer.webull.com/apis/docs/about-open-api/)；[Accounts](https://developer.webull.com/apis/docs/trade-api/account/)；[Trading API Overview](https://developer.webull.com/apis/docs/trade-api/overview/)；[Rate Limits](https://developer.webull.com/apis/docs/rate-limits/)

重要区别：gRPC order event 可即时告知 filled/cancelled/failed，但官方没有将账户余额和整个 positions 列为实时推送。因此成交事件后应触发一次 balance + positions refresh，并保留低频轮询作为补偿。

### 认证与运行约束

个人 Trading API 的流程是：先申请 API access（官方预计最快 1–2 个工作日），再生成 App Key/App Secret；每个请求通过 HMAC-SHA1 签名。[Trading API Application](https://developer.webull.com/apis/docs/authentication/IndividualApplicationAPI/)；[Authentication Overview](https://developer.webull.com/apis/docs/authentication/overview/)

若开启 2FA，还需要 token：首次创建后必须在 5 分钟内通过 Webull App/SMS 验证；token 可复用，但连续 15 天没有 API 调用会变为 INVALID。[Token](https://developer.webull.com/apis/docs/authentication/token/)

第三方平台若要让多个无关联 Webull 用户授权，应使用 Connect API OAuth 2.0，并通过邮件联系 Webull 注册应用、完成 sandbox 测试后上线；access token 30 分钟过期，refresh token 15 天过期，之后用户必须重新授权。[Connect API](https://developer.webull.com/apis/docs/connect-api/about-connect-api/)；[OAuth Integration Guide](https://developer.webull.com/apis/docs/connect-api/authentication/)

OpenAPI 的实时/历史 US 股票行情订阅与 Webull app/desktop 内购买的行情权限相互独立，必须为 OpenAPI 单独开通。[Market Data FAQ](https://developer.webull.com/apis/docs/market-data-api/faq/)

### 对同步设计的含义

- 自己的单一账户：优先 Trading API AK/SK，而不是为第三方平台设计的 Connect OAuth；
- positions/balance 用 1–5 分钟轮询，order event 作为即时触发器；
- 若 Wealthfolio 已使用其他行情 provider，无需为“账户同步”额外购买 Webull OpenAPI 实时行情；
- 官方主文档当前将 OpenAPI 描述为 US-market 服务。若账户是 Webull AU，应先在 Webull Developer Center 验证生产 Trading API 是否可为该具体账户/地区生成有效 key，不能仅凭 US 文档推断可用。

## 可行架构比较

| 方案 | 账户更新频率 | 运维成本 | 认证负担 | Wealthfolio 完整收益 | 评价 |
|---|---:|---:|---:|---:|---|
| Wealthfolio Connect | 官方承诺每日 | 低 | 低至中 | 可同步交易时较好 | **默认推荐**；IBKR + Webull US/Canada 已支持 |
| 定时导出/CSV/Flex | 日级或手动 | 中 | 低 | 适合完整账本 | 最适合历史回填和对账，不实时 |
| 纯 Wealthfolio add-on 直连 | 页面活动期间可分钟级 | 中至高 | 高 | 取决于映射质量 | 受 sandbox、local network、OAuth redirect 和 lazy activation 限制 |
| 外部常驻 broker adapter + MCP/add-on import | 约 1–5 分钟 | 高 | **IBKR 很高；Webull 中** | 可做到，但必须自行对账 | 唯一现实的自建分钟级方案 |
| 直接写 SQLite | 可任意 | 极高 | 同上 | 高风险 | **不推荐**；绕过 typed API、迁移和业务校验 |

## 推荐落地方案

### A. 推荐给大多数用户：Connect + 行情自动更新

1. 在 Wealthfolio Connect 订阅 Essentials；
2. 连接 Interactive Brokers；
3. 若是 Webull US/Canada，连接相应 Webull OAuth；若是 Webull AU，先确认 Connect 是否实际显示该机构；
4. 将账户设为 Transactions mode，并检查第一次同步是否含完整历史；若历史不全，先通过 IBKR Flex/券商 CSV 回填；
5. 为证券配置 Wealthfolio 内置或 custom market-data provider，用行情刷新盘中估值；
6. 每月以 IBKR/Webull statement 对账持仓、现金、分红和费用。

这套方案的语义应表述为：**账户数据每日自动同步，证券估值按行情同步周期更新**，而不是“账户实时同步”。

### B. 若必须分钟级：外部 adapter 的建议结构

```text
IBKR Gateway / Web API ─┐
                        ├─> Local broker adapter ─> Normalize + dedupe ─> Wealthfolio MCP/import
Webull Trading API ─────┘              │
                                       └─> state store + reconciliation log
```

核心规则：

- 只申请 read-only broker 权限，不实现下单；
- broker 原始 ID 作为幂等键，保存 high-water mark，禁止仅靠时间戳去重；
- IBKR：盘中 positions/ledger 轮询，trades 增量；日终 Flex statement reconciliation；
- Webull：订阅 order events，事件后刷新 positions/balance，并每 1–5 分钟补偿轮询；
- 写 Wealthfolio 前先 draft/preview；批量使用 `activities.import`/`saveMany` 的校验与重复检测；
- 区分 provisional intraday state 与 settled ledger，日终差异不得静默覆盖；
- secrets 放 OS keyring/专用 secret store，日志不得记录 App Secret、token、账户号或完整 payload；
- 设置 stale-data 指标：最后一次 broker fetch、最后一次 Wealthfolio write、最后一次 reconciliation 均单独显示。

### 建议验收标准

- 成交后 5 分钟内 Wealthfolio 出现对应 BUY/SELL；
- 分红、利息、费用、入出金在下一次日终对账后完整；
- 重启 worker、重复拉取同一时间窗不产生重复活动；
- IBKR/Webull 持仓数量与现金按币种逐项一致；
- token 失效、每日 IBKR re-auth、Webull 2FA 等情况有明确告警，不显示“已同步”；
- 行情陈旧与账户数据陈旧分别提示。

## 最终建议

先采用 **Wealthfolio Connect**，把目标定为“每天自动同步账户活动 + 盘中自动刷新行情”。这是官方支持、风险最低、与本仓库现有 Portfolio X-Ray 分析 add-on 职责最清晰的方案。

只有在确实需要成交后数分钟内更新、并愿意长期维护认证与对账服务时，才建设外部 adapter。IBKR 的每日人工重新认证是该方案最大的无人值守障碍；Webull 则要先确认账户地区的 OpenAPI 资格。即使自建，也应保留日终 statement/Flex reconciliation，因为实时接口与活动账本服务于不同目的。
