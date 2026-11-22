# Webull Australia OpenAPI → Wealthfolio 只读连接器

> 调研日期：2026-08-29  
> 目标：为已获批的 Webull Australia 个人 OpenAPI 设计本地、手动一键、行为只读的 Broker Sync。  
> 资料范围：仅 Webull Australia 官方开发者文档、官方帮助中心和 `webull-inc` 官方 SDK 仓库。未接触任何用户凭证。

## 结论

第一版应定义为 **Webull AU 成交同步器**，而不是完整账本同步器：

- OpenAPI 可以读取账户、当前余额、持仓、最近最多 6 个月的订单，以及逐单佣金和费用；
- AU API 没有官方的现金流水、入出金、股息到账、预扣税、利息或 FX 历史端点；
- 因此 API 负责新增股票成交，Webull CSV、月结单和 EOFY 报表负责历史回填与定期对账；余额和持仓仅用于发现差异，不能据此虚构 Deposit、Dividend 或 Fee 活动。

推荐的最低维护流程是：首次连接时由用户录入 App Key/App Secret，完成一次 Webull App + SMS 2FA；之后复用 API token。用户点击“更新”时顺序读取订单、获取新订单详情中的费用、预览并导入，再读取余额和持仓作对账。全程不保存 Webull 登录密码。

## 用户前置条件

1. Webull Australia 账户已获个人 OpenAPI 批准。申请入口为 Webull AU 的 **Developer Tool → API Management → My Application**；官方预计审核约 1–2 个工作日。生成密钥时还需要短信验证码和交易密码验证。[Individual Application](https://developer.webull.com.au/apis/docs/authentication/individual-application/)
2. 准备 App Key 和 App Secret。App Secret 只在本地用于签名，绝不能作为 HTTP header 发送。[Authentication Overview](https://developer.webull.com.au/apis/docs/authentication/overview/)
3. 首次连接时能操作 Webull App 并接收短信验证码，以在 5 分钟内完成 2FA。[Token](https://developer.webull.com.au/apis/docs/authentication/token/)
4. 若用户在 API Management 启用了 IP whitelist，当前网络的公网出口 IP 必须在白名单中。Webull AU 官方仅宣传支持“2FA + IP whitelist”，开发者文档没有公布白名单数量、匹配规则或固定错误码；动态住宅 IP、VPN 或切换网络可能导致同步失败，这是根据该安全功能作出的实施推断。[Webull OpenAPI](https://www.webull.com.au/open-api)
5. 当前 AU Trading API 面向美股股票；连接器第一版应只处理 `EQUITY` 和 USD 活动。[Trading API Overview](https://developer.webull.com.au/apis/docs/trade-api/overview/)

未发现 Webull AU 提供单独的“只读 API Key”权限。连接器只能通过最小网络权限、只调用 GET 数据端点且不实现下单代码来做到行为只读；用户应理解同一套密钥本身可能仍具备交易能力。

## 认证、签名与 Token

### 每次请求的 headers

所有请求必须使用 HTTPS，并发送：

- `x-app-key`
- `x-timestamp`：UTC ISO 8601，格式 `YYYY-MM-DDThh:mm:ssZ`
- `x-signature-algorithm: HMAC-SHA256`
- `x-signature-version: 1.0`
- `x-signature-nonce`：每次请求唯一
- `x-signature`
- `x-version: v2`
- `x-access-token`：AU 首次 2FA/token 流程完成后复用

官方说明 App Secret 只用于本地计算签名，不发送到服务器。[Authentication Overview](https://developer.webull.com.au/apis/docs/authentication/overview/)；[Signature](https://developer.webull.com.au/apis/docs/authentication/signature/)

### HMAC-SHA256 签名

按官方签名文档实现：

1. 将 query 参数与参与签名的 headers 合并：`x-app-key`、`x-signature-algorithm`、`x-signature-version`、`x-signature-nonce`、`x-timestamp`、`host`；按参数名升序排序，再以 `k=v&...` 连接。
2. POST 若有 body，对**实际发送的紧凑 JSON 字节**计算 SHA-256，并使用大写十六进制摘要。用于哈希的 body 必须与线上发送的字节完全一致。
3. 构造 `path + "&" + sortedParameters`；有 body 时再加 `"&" + bodyHash`。
4. 对整个字符串做 URL encoding。
5. 签名 key 是 `app_secret + "&"`；结果为 `Base64(HMAC-SHA256(key, encodedString))`。

`x-signature` 与 `x-version` 不参与签名。官方当前 SDK 的 composer 和 SHA-256 实现可作为签名测试的对照。[Signature](https://developer.webull.com.au/apis/docs/authentication/signature/)；[default_signature_composer.py](https://github.com/webull-inc/webull-openapi-python-sdk/blob/main/webull/core/auth/composer/default_signature_composer.py)；[sha_hmac256_new.py](https://github.com/webull-inc/webull-openapi-python-sdk/blob/main/webull/core/auth/algorithm/sha_hmac256_new.py)

当前自动生成的部分 API reference schema 仍显示旧式 `x-app-secret`/HMAC-SHA1 定义，与专门的 AU Authentication 文档和当前 SDK 冲突。实施应以 Authentication/Signature 文档及当前 SDK 为准：**不发送 App Secret，只使用 HMAC-SHA256**。

### 首次 2FA 与 Token 生命周期

AU 第一次 API 调用会创建 token，状态为 `PENDING`，并触发短信。用户需在 Webull App 依次进入 **Menu → Messages → OpenAPI Notifications → 最新验证消息 → Check Now**，输入短信码并确认。必须在 5 分钟内完成，否则 token 变为 `EXPIRED`。[Token](https://developer.webull.com.au/apis/docs/authentication/token/)

相关接口：

- `POST /auth/tokens/create`：[Create Token](https://developer.webull.com.au/apis/docs/reference/create-token/)
- `POST /auth/tokens/check`：[Check Token](https://developer.webull.com.au/apis/docs/reference/check-token/)

状态语义：

- `PENDING`：等待用户确认；
- `NORMAL`：可复用；
- `INVALID`：连续 15 天无 API 调用等原因导致失效；
- `EXPIRED`：未在 5 分钟内确认。

测试环境的 token 默认有效，不需要 2FA。生产实现应将 token 与 App Secret 存入 Wealthfolio add-on secret storage，不沿用 SDK 默认的本地 token 文件；绝不记录完整签名 headers、token、App Secret 或账户号。官方 SDK 的 token manager 可作为状态机参考。[token_manager.py](https://github.com/webull-inc/webull-openapi-python-sdk/blob/main/webull/core/http/initializer/token/token_manager.py)

## API 环境

只读同步使用 HTTP API：

| 环境 | HTTP host | 用途 |
|---|---|---|
| Production | `https://api.webull.com.au` | 真实账户同步 |
| Test/UAT | `https://au-api.uat.webullbroker.com` | 签名、token、解析与错误处理测试 |

官方另列出 gRPC 与 MQTT hosts，但账户历史同步不需要它们。Manifest/network permission 第一版只应允许生产 HTTP host；本地测试构建再单独允许 UAT host。[SDK / API Endpoints](https://developer.webull.com.au/apis/docs/sdk/)

## 只读数据端点

### 账户列表

`GET /trading/accounts/list`，无 query 参数。[Account List](https://developer.webull.com.au/apis/docs/reference/account-list/)

响应为数组，主要字段：

- `user_id`
- `account_id`
- `account_number`
- `account_type`: `CASH` 或 `MARGIN`
- `account_class`: `INDIVIDUAL_CASH` 或 `INDIVIDUAL_US_MARGIN`

界面只显示掩码后的 account number；持久映射使用 `account_id → Wealthfolio account_id`。

### 当前余额

`GET /trading/assets/balances/get?account_id=...`。[Account Balance](https://developer.webull.com.au/apis/docs/reference/account-balance/)

字段包括：

- `total_asset_currency`（当前 AU schema 为 USD）
- `total_cash_balance`
- `total_market_value`
- `total_unrealized_profit_loss`
- `account_currency_assets[]`: `currency`、`cash_balance`、`market_value`、`buying_power`、`unrealized_profit_loss`

金额字段是字符串，必须用 decimal 解析，不能用 JavaScript 二进制浮点数做精确金额计算。余额是当前快照，不是可导入的现金活动历史。

### 当前持仓

`GET /trading/assets/positions/list?account_id=...`。[Account Positions](https://developer.webull.com.au/apis/docs/reference/account-position/)

响应数组字段：`position_id`、`currency`、`quantity`、`symbol`、`instrument_type`、`last_price`、`cost_price`、`unrealized_profit_loss`。当前 AU schema 未列分页参数。持仓同样只用于同步后的对账，不应用持仓差额反推交易。

### 历史订单

`GET /trading/orders/historical-orders/list`。[Order History](https://developer.webull.com.au/apis/docs/reference/order-history/)

Query 参数：

| 参数 | 要求 |
|---|---|
| `account_id` | 必填 |
| `start_date` | 可选，`yyyy-MM-dd`；省略时默认最近 7 天；最多回看 6 个月 |
| `page_size` | 可选，默认 10，允许 10–100 |
| `last_client_order_id` | 可选，上一页最后一个 client order id，作为下一页游标 |

当前 AU reference **没有 `end_date`**。组合订单会一起返回，因此实际一页的订单数量可能超过 `page_size`。

响应顶层数组按 `{client_order_id, combo_type, orders[]}` 分组。订单主要字段包括：

- 身份：`client_order_id`、`order_id`、`symbol`、`instrument_type`
- 方向/状态：`side`（`BUY`、`SELL`、`SHORT`）、`status`（包括 `FILLED`、`PARTIAL_FILLED`）
- 订单信息：`order_type`、`support_trading_session`、`time_in_force`、`total_quantity`
- 成交累计值：`filled_quantity`、`filled_price`
- 时间：`place_time`/`filled_time`（epoch ms 字符串）及对应 UTC ISO 字段 `place_time_at`/`filled_time_at`

`filled_price` 是平均成交价，`filled_time` 是最后一次成交时间；该响应不是逐 execution-lot 成交清单。历史列表也不包含佣金/费用。

### 订单详情与费用

`GET /trading/orders/get?account_id=...&client_order_id=...`。[Order Detail](https://developer.webull.com.au/apis/docs/reference/order-detail/)

详情返回相同的订单核心字段，并增加：

- commission：`actual_commission`、`receivable_commission`
- `fees[]`: `type`、`actual_value`、`receivable_value`

导入已结算/已发生数据时使用 `actual_*` 值。连接器应保存费用类型的原始值，并用真实 fixture 验证 commission 是否也出现在 `fees[]`，避免重复计费。Webull AU 没有独立的费用历史端点。

### 限速

官方 Trading API overview 给出的限制为：账户列表、余额、持仓各 30 秒 10 次；历史订单、订单详情等订单读取接口为 2 秒 40 次。[Trading API Overview](https://developer.webull.com.au/apis/docs/trade-api/overview/)

手动同步无需接近上限。应顺序调用、限制并发、对 `429` 做带抖动退避，且不要靠高频轮询保持 token。

## AU API 明确缺少的数据

AU 官方 Trading API 目录只有 Accounts、Assets 和 Orders，没有下列账户级历史端点：

- 现金流水和入出金；
- 股息到账、预扣税；
- 利息；
- FX 兑换历史；
- 独立费用流水。

官方 Python SDK 虽有 `GET /openapi/trade/activities/cash`，其源码明确标注该能力“currently supported only for Webull US”，不能用于 AU。[Official activity.py](https://github.com/webull-inc/webull-openapi-python-sdk/blob/main/webull/trade/trade/activity.py)；[Trading API Overview](https://developer.webull.com.au/apis/docs/trade-api/overview/)

因此：

- 逐单交易佣金/费用可以从 Order Detail 同步；
- 股息、预扣税、利息、入出金和历史现金费用不能通过 AU OpenAPI 自动导入；
- 市场数据中的证券分红日历不是用户账户的实际到账记录，不能替代股息活动；
- 订单 API 最多 6 个月，不能独立完成完整历史回填。

官方替代资料：Webull AU 交易 CSV 最多导出 1,000 笔已完成订单且可回看最近 24 个月；月结单和成交确认可在移动 App 的 Documents 中获取；EOFY 文件提供 PDF/Excel。[Export trade records](https://www.webull.com.au/help/faq/1762)；[Statements and trade confirmations](https://www.webull.com.au/help/faq/1306-Where-can-I-find-my-account-statements-and-trade-confirmations)；[EOFY statement](https://www.webull.com.au/help/faq/1562)

## 官方文档与 SDK 的路径差异

当前 AU API reference 使用 `/trading/...` 路径，但官方 Python SDK `main` 分支仍构造部分旧路径，例如 `/openapi/account/list`、`/openapi/assets/balance`、`/openapi/trade/order/history`；SDK 的 v3 order request 还提供了当前 AU reference 未列出的 `end_date`。[account_info_v2.py](https://github.com/webull-inc/webull-openapi-python-sdk/blob/main/webull/trade/trade/v2/account_info_v2.py)；[order_opration_v3.py](https://github.com/webull-inc/webull-openapi-python-sdk/blob/main/webull/trade/trade/v3/order_opration_v3.py)；[get_order_history_request.py](https://github.com/webull-inc/webull-openapi-python-sdk/blob/main/webull/trade/request/v3/get_order_history_request.py)

第一版应以当前 AU reference 的 `/trading/...` 为 endpoint contract，以当前 SDK 为签名/token 行为参考。连接测试必须记录脱敏后的 HTTP status、Webull `error_code` 和 request id。如果 UAT/生产实际返回 404，再通过明确的兼容配置切换旧 SDK 路径；不要静默重试到写入接口，也不要假定两套路径完全等价。

## 推荐实现顺序

### 首次连接

1. 将 App Key、App Secret 写入 add-on secret storage；界面不回显明文。
2. 创建/check token，显示“请在 Webull App 完成验证”，最多等待 5 分钟；验证完成后保存 token。
3. 调用账户列表，让用户把 Webull `account_id` 映射到已有 Wealthfolio USD Transactions account。
4. 做一次 Dry Run，展示覆盖区间和数据缺口提示。

### 每次“一键更新”

1. 计算 `start_date = max(last_successful_sync - overlap, today - 6 months)`；建议重叠 2–3 天。
2. 读取订单历史，使用 `last_client_order_id` 分页直到没有下一页；设置 `page_size=100`。
3. 第一版只导入 `status=FILLED` 的 `BUY`/`SELL` 美股订单。`PARTIAL_FILLED` 是累计值而非 execution 明细，先不导入，避免后续完成时重复计算；做成 upsert 模型后再支持部分成交。
4. 对每个新增或指纹变化的已成交订单读取 Order Detail，获取实际佣金和费用。
5. 规范化为一笔 Wealthfolio 活动：幂等键优先 `account_id + order_id`；`client_order_id` 用于详情查询和分页。保存累计数量、平均价、最后成交时间及原始响应指纹用于审计。
6. 预览、校验、去重后批量导入。
7. 最后读取余额和持仓，显示与 Wealthfolio 的差异，但不自动制造补差活动。

`SHORT` 在确认 Wealthfolio 的做空语义前不应自动映射成普通 Sell。交易所/MIC 也不能仅凭 symbol 可靠推断，应交给 Wealthfolio 的 instrument resolver 或另行查询官方 instrument 数据。

## 安全与验收清单

- Secret storage：App Secret、access token；可同时将 App Key 作为敏感配置保存。
- 日志不得包含 App Secret、token、完整账户号、完整签名 headers 或含敏感值的请求 URL。
- 网络 allowlist 仅包含所选环境的 Webull HTTP host；不实现下单、改单、撤单端点。
- token 为 `INVALID`/`EXPIRED` 时明确要求重新完成 2FA，不循环创建 token。
- 对官方签名示例建立固定单元测试；对 nonce 唯一性、UTC 时间和 body 字节一致性建立测试。
- 对分页、6 个月边界、重复同步、订单由未成交变为成交、费用去重和 429 退避建立 fixture 测试。
- UI 明示：“自动同步范围：最近 6 个月已完成交易与逐单费用；股息、现金活动及更早历史需报表导入。”

## 实施建议

先在 UAT 完成签名、token、账户/订单 schema 和 Dry Run，再用生产账户执行一次只读、小范围（最近 7 天）预览。第一可交付版本只导入完全成交的 BUY/SELL 与实际逐单费用，同时提供 CSV/statement 对账入口。这样不会误称为完整同步，也避免因 AU API 缺少现金账本而悄悄制造错误资产记录。
