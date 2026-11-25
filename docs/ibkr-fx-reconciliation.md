# IBKR 换汇成交、股票成本与澳元净值对账

要查「买一美元花了多少澳元」或「卖一美元收了多少澳元」，先找账户的外汇成交，再核对两种货币的现金收付。要查「这笔美股买入在报表上折合多少澳元」，读股票成交行的折算汇率。要查某日净值，则用该日报表的收盘价、汇率、现金和应计项目。以下以账户报表基币为 AUD 为例。官方资料核对日期为 2026-11-22。[IBKR 成交字段](https://www.ibkrguides.com/reportingreference/reportguide/tradesfq.htm) · [IBKR 净值字段](https://www.ibkrguides.com/reportingreference/reportguide/net%20asset%20value%20%28nav%29%20summary%20in%20base.htm)

## 一笔 AUD.USD 成交怎样影响现金

在 Activity Flex 的 `Trades` 里选 `Executions`，核对外汇成交的货币对、买卖方向、时间、数量、`Trade Price`、`Proceeds`、佣金及佣金币种。对于 `AUD.USD`，成交价是**每 1 AUD 值多少 USD**。IBKR 的示例中，卖出第一种货币对应买方报价（bid），买入对应卖方报价（ask）。下表数量取绝对值，USD 一栏可对照该笔带正负号的 `Proceeds`，均未扣佣金。[IBKR 货币对买卖示例](https://www.ibkrguides.com/traderworkstation/trade-fx-from-trading-window.htm) · [Flex 成交字段及明细层级](https://www.ibkrguides.com/reportingreference/reportguide/tradesfq.htm)

| 外汇成交 | AUD 现金变化 | USD 现金变化 | 用户实际做的事 |
| --- | ---: | ---: | --- |
| 卖出 AUD.USD | 减少成交数量 | 增加数量 × 成交价 | 花澳元买美元 |
| 买入 AUD.USD | 增加成交数量 | 减少数量 × 成交价 | 卖美元收澳元 |

成交价的倒数表示**每美元折合多少澳元**，尚未计入单列佣金。计算含费结果时，买美元用「AUD 净支出 ÷ USD 净收入」，卖美元用「AUD 净收入 ÷ USD 净支出」。多笔部分成交按同方向的实收实付分别加总后相除。佣金只在实际扣款的币种计一次，若扣第三种货币，先单列，再注明折算依据。可按时间及成交标识核对 `Statement of Funds` 中各币种的借贷记录。[IBKR 分币种资金流水](https://www.ibkrguides.com/reportingreference/reportguide/statement%20of%20fundsfq.htm) · [IBKR 澳洲现汇佣金](https://www.interactivebrokers.com.au/en/pricing/commissions-spot-currencies.php)

## 手动换汇、自动换汇与费用

- **手动现汇。** IBKR 澳洲按月累计的现汇与货币差价合约成交额定档，单笔佣金按成交金额计算，再折成账户基币收取。以首档为例，未含 GST 为 0.20 个基点、每单最低等值 USD 2.00，含 GST 为 0.22 个基点、最低等值 USD 2.20。该页说明 GST 适用于澳洲居民客户。核对个别成交要看当时的 `IB Commission`、`IB Commission Currency` 和现金实扣。[IBKR 澳洲现汇定价与脚注](https://www.interactivebrokers.com.au/en/pricing/commissions-spot-currencies.php)
- **自动换汇。** 符合条件的现金账户买入外币股票时，结算币种不足可触发单独的即期外汇成交。IBKR 说明其汇率基于执行时的市场价，通常按其酌情决定向适用汇率加减 0.03%，不另收该笔自动换汇佣金。实际成本已反映在成交价中。用成交备注中的 `AFx` 或券商确认辨认自动换汇，零佣金、同日买股或与日终中间价的差距都不足以单独证明触发原因或精确加价。[IBKR AutoFX 如何运作](https://www.interactivebrokers.com/support/faq/content/autofx-642225504) · [AutoFX 费用](https://www.interactivebrokers.com/support/faq/content/autofx-transactions-subject-commissions-commission-642225654) · [AFx 标记](https://www.interactivebrokers.com/support/faq/content/did-receive-afx-liquidation-notification-711833192)
- **卖股收款。** 美股卖出后应先查 USD 现金，再查是否另有美元卖汇成交。IBKR 澳洲将 USD 列为可持有币种，另有针对不支持持有的币种及小额余额的自动处理规则。是否回兑以及回兑多少，要以该账户的实际记录为准。[IBKR 澳洲可持有币种](https://www.interactivebrokers.com/support/faq/content/am-unable-convert-aud-cash-34498690) · [IBKR 澳洲外汇产品披露第 2 节](https://gdcdyn.interactivebrokers.com/Universal/servlet/Registration_v2.formSampleView?formdb=3303)

## 股票交易与期末持仓的汇率

| 报表位置 | 可以据此核对的金额 |
| --- | --- |
| `Trades` 的股票成交行 | `FX Rate to Base` 表示资产币种折到账户基币的汇率。USD 股票、AUD 基币时，单位是每 1 USD 的 AUD 数，美元成交金额乘此数得到该行折合澳元的金额。股票行记录的是股票买卖，另有换汇时，其价格见外汇成交行的 `Trade Price`。[Flex 成交字段](https://www.ibkrguides.com/reportingreference/reportguide/tradesfq.htm) |
| `Open Positions` 的持仓行 | 同名汇率也表示资产币种折到账户基币。`Mark Price` 为报告日收盘价。普通股票原币市值为股数乘收盘价。默认 Activity Statement 的持仓栏把外币成本、市值、未实现盈亏均用**报告期最后一日汇率**折成基币，因此这栏的 AUD 成本会随期末汇率变化。[Flex 持仓字段](https://www.ibkrguides.com/reportingreference/reportguide/open%20positionsfq.htm) · [默认报表的期末换算说明](https://www.ibkrguides.com/reportingreference/reportguide/openpositions_default.htm) |
| 每日 Activity Statement 的 `Base Currency Exchange Rate` | 多币种日报的收盘折算价取 Reuters 在**美东时间 16:00 前不久**报告的买卖中间价。在普通多日报表看不到该每日栏目时，选择对应交易日或估值日的 Daily Statement。[IBKR 收盘汇率来源](https://www.ibkrguides.com/reportingreference/reportguide/basecurrencyexchangerate.htm) · [IBKR 关于多日报表的说明](https://www.interactivebrokers.com/support/faq/content/86690221) |
| Activity Flex 的 `Currency Conversion Rate` | 这节可提供报告期间的时间、源币种、目标币种及汇率。查 USD 折 AUD 时，取目标日的 USD → AUD 行。若只有反向行，则取其倒数。逐日核对实际返回的币对和日期，缺一天就查该日日报。[Flex 汇率字段](https://www.ibkrguides.com/reportingreference/reportguide/currency%20conversion%20ratefq.htm) |

项目的**历史 AUD 成本**按买入记录还原，包含证券买入费用。若采用券商的交易日折算口径，可把每次买入的原币成本按该次股票成交行汇率折成 AUD，再按账本的平均成本方法计算剩余持仓。若美元早已在账、分次买入或供多笔股票交易使用，要把特定购汇成本分给某只股票，还需要资金对应记录或明确的分摊假设。缺少券商凭据时保留缺口，使用外部行情估值时标明来源。[项目成本与未实现盈亏定义](../GLOSSARY.md) · [项目成本凭据约定](adr/0004-reconcile-dated-security-quantities.md) · [IBKR 成交与成本字段](https://www.ibkrguides.com/reportingreference/reportguide/tradesfq.htm)

## 对齐同一日的现金与净值

1. **先确认覆盖。** 检查报表账户、基币、起止日、筛选条件与实际返回的章节。查历史换汇需要覆盖换汇发生日，并保留外汇逐笔成交。短期 Flex 缺少更早成交时，补对应期间的 Activity Statement 或交易确认。`Forex P/L Details` 也会列出引起外币余额变化的股票、股息等活动，其中仅一部分是实际换汇。查截止日净值需要当日持仓、分币种现金、汇率和 NAV。成交确认可包括当天交易，Activity 数据通常截至上一营业日。[创建 Activity Flex](https://www.ibkrguides.com/clientportal/performanceandstatements/activityflex.htm) · [外汇盈亏明细字段](https://www.ibkrguides.com/reportingreference/reportguide/forexpldetails_fq.htm) · [IBKR 报表可用时间](https://www.ibkrguides.com/clientportal/configure-flex-with-ai.htm)
2. **分别核对 AUD、USD 余额。** `Cash Report` 的 `Ending Cash` 属于交易日口径，`Ending Settled Cash` 是已交收现金。按币种从期初余额加上证券买卖、外汇收付、佣金等带正负号的现金金额，核对期末余额。基币汇总里的 `Cash FX Translation Gain/Loss` 表示持有外币现金的折算变动。`Statement of Funds` 的 `Net Amount In Base from Forex Trade` 则反映外汇成交价与当日报表汇率之差。两项均不应另记为一笔换汇或手续费。[IBKR 现金报告](https://www.ibkrguides.com/reportingreference/reportguide/cash%20reportfq.htm) · [外汇成交的基币净额](https://www.interactivebrokers.com/support/faq/content/net-amount-base-forex-trade-96847972)
3. **再核对当日 `NAV Summary in Base → Total`。** 按报告日的持仓收盘价值、分币种现金折算核对 `Stock` 和 `Cash`，随后核对利息应计、股息应计及账户实际出现的其他资产负债。TWS 持仓市值按屏幕当时的价格计算，盘中与收盘截点可能不同。要定位差额，保留报表日期和屏幕观察时间，逐项比较两套价格、汇率和应计金额。[IBKR 净值构成](https://www.ibkrguides.com/reportingreference/reportguide/net%20asset%20value%20%28nav%29%20summary%20in%20base.htm) · [TWS 持仓价格与市值](https://www.ibkrguides.com/traderworkstation/portfolio-values.htm)

## Stock Portfolio 1.4.0 的实际行为

本次用正式账本只读重算，并让同一版解析器处理券商实际返回的原始 Flex XML。把所有现汇成交拆成两笔相反方向的币种收付，按交易日、方向、原币金额、费用及税款与账本逐笔匹配，全部吻合。解析器由成交数量和 `Proceeds` 还原实际收付，佣金按扣款币种入账。现有模型保留换入、换出金额与隐含成交汇率，但没有保留原报文里用来辨认自动换汇的 `AFx` 标记。[外汇成交解析](../desktop/brokers/ibkrFlex.ts)

| 核查环节 | 1.4.0 中可复现的行为 |
| --- | --- |
| 股票成交导入 | 原报文的股票成交含 `fxRateToBase` 和 `closePrice`。解析后股票活动只带成交价等字段，这两个报表字段没有传下去。独立的 `Currency Conversion Rate` 节也没有对应解析。现有结单报价导入从 `Open Positions` 的持仓行读收盘价和折算率。即使当日只有一只证券成交，该成交行也只为这一只证券提供当日收盘价。[Flex 解析](../desktop/brokers/ibkrFlex.ts) · [结单报价导入](../desktop/services.js) |
| 股票的历史 AUD 成本 | `costBasis` 对每次买入调用全账本的 `rate`。用一笔示例买入复现，原币金额 USD 10、事件自带折算率 1.50、当日行情为 1.60，输出 AUD 16。仅在导入时补存字段，仍会走行情路径。[成本重算与汇率选择](../desktop/flows.js) |
| 逐只持仓估值 | 有可匹配的券商持仓行且有报价或汇率时，应用可用其估值。一般行情路径选截止日及以前日期最新的报价。用前一日券商汇率与后一日反方向的外部行情重放，后一日行情取倒数后胜出。按某个券商报告日核对时，需要明确选择报告日和报表来源。[估值逻辑](../desktop/flows.js) · [公开行情写入](../desktop/reviewMarket.js) |
| 总览资产 | 当同日券商快照与持仓数量、各币种现金吻合时，总览采用快照净值。如果快照只提供净值和现金，应用以净值减现金得到非现金余额。这个数可能包含券商列出的应计项目，即使它与逐只股票估值有差额也不会指出某只股票的价格有误。[总览与持仓计算](../desktop/flows.js) · [IBKR 净值分项](https://www.ibkrguides.com/reportingreference/reportguide/netassetvalue_default.htm) |

### 怎样量化差额

对于持仓均以美元报价、现金仅有澳元余额的账户，先固定同一组数量、原币收盘价和澳元现金，再只替换汇率。`澳元市值变动 = 美元证券市值 ×（新汇率 − 原汇率）`，这里两个汇率的单位都是**每美元折合多少澳元**。随后拿快照净值减去重算的证券与现金。剩余差额需要同一时点的逐只价格及其他净值项目才能继续拆分。若能拿到的汇率仅出现在某日成交行，而余额来自另一次账户页面观察，须注明两个来源和时间。[复算输入和估值逻辑](../desktop/flows.js) · [IBKR 收盘汇率定义](https://www.ibkrguides.com/reportingreference/reportguide/basecurrencyexchangerate_default.htm)

历史成本单独复算。保留同一批原币成交、费用和相同的平均成本卖出规则，只把每笔买入使用的行情汇率换成该笔股票成交的券商报表折算率。两次计算的差额衡量汇率来源对历史澳元成本的影响。软件总览和持仓按估值日汇率折算剩余原币成本及账面盈亏。账户净值取决于当时的资产和负债。[项目成本定义](../GLOSSARY.md) · [IBKR 期末持仓的折算方法](https://www.ibkrguides.com/reportingreference/reportguide/openpositions_default.htm)

### 修复应保留的证据

换汇成交应保留原始货币对、买卖方向、两边原币金额、佣金币种和自动换汇标记。股票成交应独立保留券商报表折算率、原币与基币、交易日及报告日，并在历史成本计算中实际读取。补齐旧交易的券商字段时，应以稳定的券商成交标识匹配原记录，保留已有现金收付和手工更正。持仓收盘价、报表日汇率、行情估算和账户页面快照都应带上各自的来源与时点。总览应分别展示已核实证券市值和待核对的净值差额。[现有成交匹配逻辑](../desktop/brokers/syncEngine.ts) · [项目的凭据与数量核对约定](adr/0004-reconcile-dated-security-quantities.md)

### 1.4.1 与 1.4.2 的行为

重新同步 Flex 时，应用按券商成交标识给旧流水补充凭据。换汇保留原币收付、实际成交价、收费币种和自动换汇标记。外币股票的历史澳元成本可按逐笔成交的报表汇率追溯。自 1.4.2 起，持仓明细用同一估值汇率折算市值、剩余原币成本和账面盈亏，并列出汇率的来源、日期和方向。[旧记录匹配](../desktop/ibkrHistory.js) · [成本计算](../desktop/flows.js) · [持仓明细](../desktop/ui/Cockpit.jsx)

券商汇率和收盘价按账户及日期保存。同一交易日，明确的每日报表汇率优先于成交行提供的折算率。周末日期的公开报价不会盖过同一交易日的券商数据，后续交易日仍可采用更新的报价。总览以逐只证券市值加现金计算逐项估值，在采用账户净值时列出两者的差额。缺少必要报价或汇率时，页面提示需要补充资料。[券商报价](../desktop/ibkrPrices.js) · [总览与持仓](../desktop/ui/Cockpit.jsx) · [集成测试](../desktop/tests/ledger.test.cjs)
