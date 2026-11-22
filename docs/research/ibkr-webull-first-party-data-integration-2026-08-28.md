# IBKR / Webull 官方数据接入调研

> 调研日期：2026-08-28  
> 目标：为 Wealthfolio 本地 Broker Sync add-on 选择低维护、手动一键、无需保存券商密码的真实数据来源。  
> 资料范围：仅 IBKR、Webull 的官方文档、官方用户指南与官方 SDK 仓库。

## 结论

建议第一版采用混合方案：

1. **IBKR：Activity Flex Query + Flex Web Service v3。** 这是完整度和维护成本最合适的接口。用户只需一次性创建 Flex Query，并向 add-on 提供 `Query ID` 和 Flex token；每次点击同步时由 add-on 请求报表，不保存 IBKR 用户名、密码，也不需要每天启动 Client Portal Gateway。
2. **Webull Australia：官方 Trading OpenAPI 获取近期开仓/成交，并用 Webull CSV 或月度/EOFY 报表补齐和对账。** Webull AU 已正式向个人账户提供 OpenAPI，但当前 AU 文档只公开账户、余额、持仓、订单历史和订单事件，未公开完整的现金活动、股息或历史账本接口。因此，单靠 OpenAPI 不能可靠重建 Wealthfolio 所需的全部活动。
3. **不要把 Client Portal Gateway 作为 IBKR 第一版依赖。** 它需要在本机运行、浏览器人工登录并每日重新认证；对“偶尔按一次按钮更新”的价值不大，却显著增加安装、会话和支持成本。
4. **不保存券商密码。** IBKR 只保存 Flex token 和 Query ID；Webull 只保存 App Key、App Secret，以及启用 2FA 时的 API token。这些均应放入 Wealthfolio 的 add-on secret storage，界面只显示掩码，日志不得输出原值。

## 推荐架构

```text
                    手动点击“更新”
                           │
             Wealthfolio Broker Sync add-on
                ┌──────────┴──────────┐
                │                     │
       IBKR Flex Web Service    Webull AU OpenAPI
       Activity Flex XML        orders / balances /
                │               positions
                │                     │
                └──── normalize + validate ────┐
                                               │
                                  preview / dedupe / import
                                               │
                                           Wealthfolio

 Webull CSV / statement ── periodic reconciliation ──┘
```

推荐将“一键更新”定义为：

- IBKR：导入截至最近可用报表日的完整新活动；
- Webull：导入 OpenAPI 可见的近期成交；
- 页面明确显示每个券商的 `last fetched`、覆盖区间和是否需要报表对账，避免把“API 成功”误认为“账本完整”。

## IBKR

### 方案 A：Flex Web Service v3（推荐）

Flex Web Service 可以通过 HTTPS 运行用户预先保存的 Flex Query，不要求同步时再次登录 Client Portal。调用分两步：

1. `GET .../FlexWebService/SendRequest?t=<token>&q=<queryId>&v=3`；
2. 从 XML 中取得 `ReferenceCode`，再调用 `GetStatement?t=<token>&q=<referenceCode>&v=3`。

报表生成可能尚未完成，因此第二步需要有限次数的退避重试。官方要求使用 v3；`SendRequest` 限制为每秒 1 次、每个 token 每分钟最多 10 次，单次通过 `p` 或 `fd`/`td` 最多请求 365 天。[SendRequest](https://www.interactivebrokers.com/docs/web-api/api-reference/send-request)；[GetStatement](https://www.interactivebrokers.com/docs/web-api/api-reference/get-statement)；[Flex 错误码](https://www.ibkrguides.com/clientportal/performanceandstatements/flex3error.htm)

用户在 Client Portal 的 **Performance & Reports → Flex Queries** 创建 Activity Flex Query。官方支持 XML、CSV 和文本格式，并允许逐字段选择数据；保存的 Flex Queries 可覆盖前四个日历年及本年。[创建 Activity Flex Query](https://www.ibkrguides.com/clientportal/performanceandstatements/activityflex.htm)；[Flex Queries](https://www.ibkrguides.com/clientportal/performanceandstatements/flex.htm)

建议第一版使用 XML，并启用以下 section：

| Flex section | Wealthfolio 用途 |
|---|---|
| Account Information | 账户号、基础币种 |
| Trades，detail 选 Executions | BUY/SELL、数量、价格、时间、交易 ID、IB Execution ID、Conid、交易所、佣金、税、Net Cash |
| Cash Transactions | 入出金、股息、预扣税、利息及其他现金活动 |
| Transaction Fees | 不属于单笔交易佣金的独立费用 |
| Corporate Actions | 拆股、合并、股票股息等 |
| Transfers | 转入、转出 |
| Options, Exercises, Assignments and Expirations | 期权行权、指派和到期 |
| Financial Instrument Information | 符号、资产类型、币种、标的身份 |

这些都是官方 Activity Flex Query 的可选 section。[Activity Flex Query 字段目录](https://www.ibkrguides.com/reportingreference/reportguide/activity%20flex%20query%20reference.htm)；[Trades 字段](https://www.ibkrguides.com/reportingreference/reportguide/tradesfq.htm)；[Cash Transactions 字段](https://www.ibkrguides.com/reportingreference/reportguide/cash%20transactionsfq.htm)；[Transaction Fees 字段](https://www.ibkrguides.com/reportingreference/reportguide/transactionfees_afq.htm)

实现注意事项：

- 交易手续费优先取 `Trades.IB Commission`；不要再次把同一笔费用从其他 section 导入。
- 使用 `IB Execution ID`、`Trade ID` 等券商 ID 作为幂等键；缺少 ID 时才退回到账户、时间、Conid、方向、数量、价格、净现金的稳定组合键。
- 增量请求保留 2–3 天重叠窗口，并依靠幂等键去重，以覆盖晚到或被修订的报表记录。
- 首次历史回填按不超过 365 天的窗口分段。
- Flex 是报表服务，普通 Activity Flex 数据通常截至上一营业日；它适合可靠账本同步，不应标为盘中实时。IBKR 2026 Client Portal 说明也区分了上一营业日的 Activity Flex 与可含当日交易的 Trade Confirmation Flex。[Client Portal 2026 release notes](https://www.ibkrguides.com/releasenotes/cp-2026.htm)

### Flex 认证与安全

用户需要在 Client Portal 开启 Flex Web Service，创建 token，并将 token 与 Query ID 录入 add-on。官方配置允许设置 token 有效期和 IP 限制；生成新 token 会使旧 token 失效。[Flex Web Service 配置](https://www.ibkrguides.com/clientportal/performanceandstatements/flex-web-service.htm)

安全要求：

- token 只能存入 add-on secret storage；
- 不在 URL、错误文本、遥测或调试日志中打印完整请求，因为 IBKR 的协议把 token 放在 query parameter；
- UI 只允许覆盖 token，不提供明文回显；
- 提供“测试连接”和“清除凭据”按钮。

### 方案 B：Client Portal Gateway / Web API（不推荐用于第一版）

Client Portal Gateway 更接近盘中状态，但个人账户使用它需满足 live account 已 fully open and funded、使用 IBKR Pro，并在本机安装 Java 和 Gateway。登录页面及 API 客户端必须在同一台机器上；IBKR 明确不支持自动化 Gateway 登录，并要求每日重新认证。[Gateway 安装与认证](https://ibkrcampus.com/docs/web-api/authentication/cpgw/installation-authentication)；[Gateway FAQ](https://ibkrcampus.com/docs/web-api/authentication/cpgw/client-portal-gateway-faq)；[Gateway 限制](https://ibkrcampus.com/docs/web-api/authentication/cpgw/limitations-of-the-client-portal-gateway)

会话最长约 24 小时，约 6 分钟无活动会超时；官方建议大约每分钟调用 `/tickle`。一个 IBKR 用户名同时只能有一个 brokerage session，可能与 TWS、Client Portal 或移动端的活动会话冲突。[Authentication FAQ](https://ibkrcampus.com/docs/web-api/authentication/faq)；[Web API sessions 与限速](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)

有关数据接口：

- `/iserver/account/trades` 提供 execution、symbol、方向、数量、价格、commission、net amount 和 execution ID，但最多回看 7 天，未指定 `days` 时只返回当天；限速为每 5 秒 1 次。[Trade History](https://ibkrcampus.com/docs/web-api/api-reference/trading/trading-orders/get-trade-history)
- `/pa/transactions` 包含买卖、股息和 transfers，默认 90 天，并可返回是否包含实时数据；该 endpoint 限速为每 15 分钟 1 次。[Transaction History](https://ibkrcampus.com/docs/web-api/api-reference/trading/trading-portfolio-analyst/get-transactions)；[Web API pacing](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)
- `/portfolio2/{accountId}/positions` 提供 near-real-time、未缓存的持仓，但它是当前状态，不是完整活动账本。[Account Positions](https://ibkrcampus.com/docs/web-api/api-reference/trading/trading-portfolio/get-uncached-positions)

因此 Gateway 可作为未来可选的“盘中刷新”模块，但不能替代 Flex 的历史和结算账本。

### IBKR 手动导出兜底

用户可在 Client Portal 手动运行 Activity Flex Query，下载 XML/CSV/Text；标准 Activity Statement 也可下载 CSV。对第三方程序化导入，IBKR 官方指南建议使用 Activity Flex Query。[运行 statement](https://www.ibkrguides.com/clientportal/performanceandstatements/runstatement.htm)；[运行 Flex Query](https://www.ibkrguides.com/clientportal/performanceandstatements/runflex.htm)；[第三方报告说明](https://www.ibkrguides.com/clientportal/performanceandstatements/third-party-reports.htm)

## Webull Australia

### 官方零售 API 是否可用

**可用。** Webull Australia 官方网站已有 OpenAPI 申请入口，官方开发文档将 Trading API 定位为个人交易者/量化开发者使用。个人用户在 Webull AU 网站登录后，通过 Developer Tool → API Management 申请；官方预计审核最快 1–2 个工作日，批准后通过短信验证码和交易密码生成 App Key / App Secret。[Webull AU OpenAPI](https://www.webull.com.au/open-api)；[个人申请流程](https://developer.webull.com.au/apis/docs/authentication/individual-application/)

官方 AU API 当前只支持 **US stocks / ETFs**，不能据此同步 Webull AU 账户中的澳股、港股、期权或其他产品。[Trading API Overview](https://developer.webull.com.au/apis/docs/trade-api/overview/)；[Webull AU OpenAPI 产品范围](https://www.webull.com.au/open-api)

Webull 提供官方 Python 和 Java SDK。AU 生产地址为：

- HTTP Trading / Market Data：`api.webull.com.au`；
- gRPC order events：`events-api.webull.com.au`；
- MQTT market data：`data-api.webull.com.au`。

官方 Python SDK 支持 `region_id = "au"`，其官方仓库明确列出 Webull AU 客户。[AU SDK 与环境](https://developer.webull.com.au/apis/docs/sdk/)；[官方 Python SDK](https://github.com/webull-inc/webull-openapi-python-sdk)

### 认证

OpenAPI 使用 App Key / App Secret 对每个 HTTPS 请求签名，而不是保存 Webull 登录密码；App Secret 只用于本地生成 HMAC 签名，不作为 header 直接发送。若账户启用了 API 2FA，还需要用户在 Webull App 中验证 API token；官方通用 OpenAPI 文档说明验证窗口为 5 分钟，token 连续 15 天没有 API 请求会失效。[Authentication Overview](https://developer.webull.com/apis/docs/authentication/overview/)；[Token lifecycle](https://developer.webull.com/apis/docs/authentication/token/)

Webull AU 对外页面同时宣传 2FA 与 IP whitelist。若用户启用 IP whitelist，本地公网 IP 变化会导致调用失败，因此 add-on 应把这种错误显示为“请检查 Webull API IP whitelist”，而不是笼统显示认证失败。[Webull AU OpenAPI](https://www.webull.com.au/open-api)

### 当前可取的数据

Webull AU Trading API 当前官方列出：

| 数据 | 官方接口与限制 | 对 Wealthfolio 的意义 |
|---|---|---|
| 账户 | Account List，10 次/30 秒 | 发现账户并映射 |
| 余额 | Account Balance，10 次/30 秒 | 同步后对账现金总额 |
| 持仓 | Account Positions，10 次/30 秒 | 同步后对账证券数量 |
| 历史订单 | `/trading/orders/historical-orders/list`，40 次/2 秒，AU 文档说明仅过去 7 天 | 获取近期 filled orders |
| 订单详情 | Order Detail，40 次/2 秒 | 取得单笔订单/成交详情 |
| 实时订单事件 | gRPC server stream | 收到部分成交、全部成交、修改、取消、失败状态；payload 含成交价格、数量、时间、commission 和 fee 明细 |

来源：[Trading API Overview](https://developer.webull.com.au/apis/docs/trade-api/overview/)；[Order History](https://developer.webull.com.au/apis/docs/reference/order-history/)；[Trade Events](https://developer.webull.com.au/apis/docs/reference/custom/subscribe-trade-events/)

### 完整账本缺口

截至本次调研，Webull AU 官方 Trading API 的文档导航和接口总表没有列出 cash activities、dividends、deposits/withdrawals 或完整 account ledger endpoint；AU 的订单历史文档还限制为最近 7 天。由此可推断：

- 近期 BUY/SELL 可以通过 API 自动导入；
- 交易事件/详情可提供佣金和部分监管费；
- 不能仅靠当前 AU OpenAPI 保证完整导入分红、预扣税、利息、入出金和所有历史交易；
- Account Balance / Positions 只能用于发现差异，不能反推出每条活动。

这是基于当前官方 AU 接口目录的覆盖范围作出的判断，不应把 Webull US 文档中可能存在的额外 endpoint 假定为 AU 生产账户可用。[Webull AU Trading API](https://developer.webull.com.au/apis/docs/trade-api/overview/)；[Webull AU API reference](https://developer.webull.com.au/apis/docs/reference/trading/)

### Webull 导出替代方案

Webull AU 官方支持从 App 导出 filled trade records CSV：Assets → History → Export，文件通过邮件发送；单次最多 1,000 条 completed orders，最长可下载过去 24 个月。该 CSV 仍主要是交易记录，不等同于完整现金账本。[下载 Account Records](https://www.webull.com.au/help/faq/1762)；[Portfolio tracker CSV 说明](https://www.webull.com.au/help/faq/1852)

月度 statement 和 trade confirmation 可在 Webull App 的 Documents 页面查看，不能在 Desktop 查看。EOFY statement 可下载 PDF 或 Excel，并按 settlement date 显示余额。[Statements 与 trade confirmations](https://www.webull.com.au/help/faq/1306-Where-can-I-find-my-account-statements-and-trade-confirmations)；[EOFY statement](https://www.webull.com.au/help/faq/1562)

因此建议：

- 日常点击同步：API 拉最近 7 天订单，按订单 ID / 成交 ID 去重；
- 每月：用户下载 monthly statement 或 CSV，拖入 add-on 做 reconciliation；
- 首次导入超过 24 个月的历史时，以已有 statements 为来源，不能承诺只靠 CSV/API 自动回填。

## 方案比较

| 方案 | 交易 | 现金/股息/费用 | 认证维护 | 适合本项目 |
|---|---|---|---|---|
| IBKR Flex v3 | 完整执行级交易 | 完整度高，可配置 | Query ID + token；无密码、无每日登录 | **是，第一优先** |
| IBKR Client Portal Gateway | 当日/近 7 日，接近实时 | `/pa/transactions` 部分覆盖 | Java、本机 Gateway、每日登录、会话冲突 | 否，后续可选 |
| IBKR 手动 CSV/XML | 完整度高 | 完整度高 | 每次下载文件 | 兜底/首次回填 |
| Webull AU OpenAPI | 近期 US 股票订单；事件含费用 | 缺完整现金/股息账本 | App Key/Secret；可选 2FA token/IP whitelist | **用于增量交易** |
| Webull AU CSV/statements | CSV 为 filled trades；statement 更完整 | statement 用于对账 | 用户手动下载 | **必须保留** |

## 第一版实施边界

### 应实现

- IBKR Flex XML parser；
- Webull AU HMAC 签名与 Account List、Order History、Order Detail、Balance、Positions；
- 首次设置、测试连接、Dry Run、按券商单独同步；
- 原始券商 ID 去重，重叠窗口拉取；
- 每个券商独立显示最后成功时间、覆盖范围、导入/跳过/无效数量；
- Webull CSV 导入入口或至少预留 adapter seam；
- secret 清除、token 失效和 IP whitelist 的明确错误提示。

### 暂不实现

- IBKR Client Portal Gateway；
- gRPC/MQTT 常驻连接；
- 自动交易或任何下单 endpoint；
- 宣称“实时完整账本”；
- 仅靠余额/持仓差额自动生成无法审计的推测活动。

## 用户需要准备什么

### IBKR

1. Client Portal → Performance & Reports → Flex Queries；
2. 创建 Activity Flex Query，Format 选 XML，并启用本文建议的 sections/fields；
3. 开启 Flex Web Service，生成 token；
4. 在 Broker Sync 中录入 Query ID 和 token，执行测试连接；
5. 首次先 Dry Run，再分段回填历史。

### Webull AU

1. 登录 Webull AU 网站 → Developer Tool → API Management；
2. 申请个人 API 权限并等待批准；
3. 生成 App Key / App Secret；
4. 若开启 2FA，首次测试时在 Webull App 完成 API token 验证；
5. 在 Broker Sync 中录入 key/secret，只开启读取与同步路径，不调用下单接口；
6. 准备一次 Webull trade CSV 和最近一份 statement，用于首次数据对照。

## 最终建议

按以下顺序交付真实接入：

1. **先完成 IBKR Flex v3**：它能够在不保存密码的情况下覆盖 Wealthfolio 所需的大多数活动，最容易达到“按一下即完整更新”。
2. **再完成 Webull AU OpenAPI 的近 7 日交易增量**：同时把 UI 标记为“交易同步”，不要标记为“完整账户同步”。
3. **加入 Webull CSV / statement reconciliation**：这是当前官方 AU 接口覆盖不足时保证数据完整性的必要通道。

该组合满足最低维护目标：日常只点击一次；IBKR 不需要每日登录；Webull 不保存登录密码；需要人工介入的部分被限制为首次设置、凭据失效，以及 Webull 的周期性报表对账。
