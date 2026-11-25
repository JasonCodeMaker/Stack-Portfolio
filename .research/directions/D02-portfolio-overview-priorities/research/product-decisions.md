# 打开总览，投资者首先要判断什么？

2026-11-25 · D02 产品研究 · [研究问题 #46](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/46) · [方案比较 #45](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/45)

**建议把日常查账作为首个待验证的场景。** 用户先确认「这几个账户合计值多少，数字算到了什么时候」，再判断「资产变化来自资金进出，还是投资盈亏」。若估值不全，读到金额时就应知道它只覆盖哪一部分。这个排序延续了项目原有的四个总览问题，同时能用有标准答案的任务检验。现有资料没有测出本产品用户打开总览的实际目的或频率，期间复盘优先仍是值得对照的方案。[原总览目标](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/docs/investment-dashboard-design.md#41-总览) · [最近一次改版决定](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/36)

## 产品证据支持哪些选择

| 参照与阅读范围 | 文档或研究直接显示什么 | 对本项目的启示及限制 |
| --- | --- | --- |
| [Wealthfolio 桌面组合总览](https://wealthfolio.app/docs/guide/dashboards/) · 首页、账户、持仓及缺数章节 | 本位币总值作主数，下面是期间盈亏和回报；账户摘要和按市值排名的持仓可进入明细。持仓页说明部分账户或价格缺失时怎样读合计。 | 与本地多账户账本最接近，可以比较「先认总额，再追查账户或持仓」的路径。本项目的期间表现沿用澳元时间加权收益率，不能直接移植另一产品的默认收益率。 |
| [Sharesight 澳大利亚投资页](https://help.sharesight.com/au/show_portfolio/) · 期间筛选、组合摘要、图表与持仓表 | 所选期间同时影响收益摘要和分析；金额拆为资本收益、收入、汇率等，提供已卖出持仓的显示选择。 | 支持「我本月究竟赚了多少」作为另一种首页。期间归因必须涵盖已卖清的证券；仅看当前前五大持仓会漏掉已实现盈亏。本地五项拆分还包含费用。 |
| [IBKR PortfolioAnalyst](https://www.ibkrguides.com/orgportal/performanceandstatements/pa_viewingaccountperformance.htm) · Dashboard、账户选择和部件说明 | 选择账户与期间后，可分别看净资产变化及出入金、收益与基准、目标配置和基金穿透前后集中度。用户可以调整部件。 | 净值变化需要资金流作解释；目标偏离和跑输基准回答不同问题。IBKR 的可配置性证明这些任务可以分开承载，不能证明本产品需要一套部件编辑器。 |
| [Morningstar 基金重叠分析](https://intercom.help/morningstar---investor/en/articles/16052408-how-to-find-investments-overlapping-with-your-managed-funds) · 完整操作说明 | 向组合加入基金后，可以查看多个基金重复持有的股票和其在各基金的权重。 | 若用户在问「押在同一家公司的钱有多少」，应进入配置分析合并直接和穿透敞口。总览前五直接持仓仍有独立用途，适合回答「我直接买的最大仓位是什么」。 |

投资者行为给出了另一种证据。Sicherman 等分析 2007–2008 年退休账户的登录与交易，发现查看组合比交易更频繁。FCA 在模拟交易应用中对 9,140 人做了随机实验，推送和积分抽奖增加了交易次数，闪烁报价和交易排行榜对总体交易次数没有显著影响。这些结果支持把「看明白后离开」也列为成功路径；它们没有测量本桌面账本的阅读顺序、理解正确率或使用频率。此处依据原研究的样本说明与结果段落。[退休账户注意力研究](https://business.columbia.edu/sites/default/files-efs/pubfiles/25997/sicherman_financial_attention.pdf) · [FCA 实验设计与结果](https://www.fca.org.uk/publication/research-notes/research-note-digital-engagement-practices-trading-apps-experiment.pdf)

## 哪些信息应先出现

| 优先情境 | 用户要作的判断 | 所需信息与下一步 |
| --- | --- | --- |
| 每次进入或切换账户 | 我看的是哪些账户、哪一天、多少澳元？ | 首屏同时给出账户范围、估值日或行情时点、含现金的澳元估值。点金额再分到账户、证券和现金。选择历史估值日时要能辨认它。 |
| 数据改变金额含义时 | 这是完整总额吗？缺在哪，是否影响我现在的问题？ | 缺价格或汇率时，突出「可估值小计」并指出受影响的项，给出通往明细或数据维护的路径。仅缺持仓成本时标记持仓盈亏待补，仍可显示有价格的市值。正常情况下保持安静，避免被所有页面共有的行情提示占据注意力。 |
| 看见组合金额变动 | 最近变动涵盖什么？本期赚了多少？ | 最近市场收盘的股价与汇率变动带实际基准；在可比较的期间内并读「期间盈亏」与「净外部资金流」，二者解释资产变化。时间加权收益率用来比较期间表现。 |
| 想查原因 | 变化主要来自哪项、哪只证券、哪个账户？ | 可先看到带符号的主因及金额；展开五项盈亏构成，查汇率明细或进入收益复盘看期间持仓贡献。分析路径保留账户范围、期间和估值日。 |
| 想评估结构或策略 | 我的公司敞口是否集中？组合是否跑赢基准？ | 直接持仓排名进持仓页；基金重叠、未穿透部分及自设目标偏差进配置分析。基准比较进收益复盘，以同一范围与可比较截止日给出两个既定指数的收益差。用户没有配置目标时，不推断「偏离」或发出调仓提示。 |

这个优先级按误读对判断的影响排序。例如，把不完整估值当总额会影响随后每一次比较，因此需要立刻声明覆盖范围；暂时不知道第五大持仓的累计分红，仍可完成查账。从首页进入详细分析后，用户要能继续回答原问题。[总览及持仓入口](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/ui/Overview.jsx#L253-L276) · [收益复盘](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/ui/Performance.jsx#L905-L948) · [配置与目标](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/ui/Allocation.jsx#L637-L699)

## 当前实现中容易混读的数字

1. **首页主卡的副数字有两条计算路径。** 当前模式以现有持仓数量，按各证券所属市场最近两次收盘的价格差和汇率变化重估，外币现金也有折算影响。各市场的日期可能不同。切到历史模式，展示所选账户两个可用收盘日之间扣除外部资金流的组合盈亏及相应日收益率。只写「今天赚了多少」会混淆两条路径。概念测试应让参与者在同一账户范围下分别解释两种读数。[当前变动算法](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/liveQuotes.js#L68-L91) · [历史组合收盘](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/todayChange.js#L174-L191) · [主卡分支](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/ui/Overview.jsx#L292-L330)
2. **走势图和卡片可能同时给出两个不同的百分比。** 资产走势的百分比线按「当日估值减自跟踪起累计净投入，再除以累计净投入」计算，分母为正才有值；期间卡的时间加权收益率通过各日收益连乘，去掉外部资金流的影响。应让用户能说出哪个指标可以与指数比较。前次改版明确保留原走势图，因此先验证可见的图例、范围和缘由，再讨论是否调整默认曲线。[走势图](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/ui/Overview.jsx#L31-L47) · [净投入比率计算](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/flows.js#L1000-L1018) · [时间加权计算](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/periodSummary.js#L397-L422) · [保留走势的决定](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/36#issuecomment-7130573025)
3. **前五大持仓、期间贡献和公司敞口分别回答三个问题。** 总览列出当前可估值证券中的市值前五，展示总值占比与相关盈亏；收益复盘按所选期间的贡献追溯，也可涵盖已经卖清的证券；配置分析合并直接持有和 ETF 穿透的公司敞口。因此不能用当前五个最大仓位替代收益主因或穿透后的集中度。[总览列表](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/ui/Overview.jsx#L124-L175) · [期间贡献决定](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/docs/adr/0003-portfolio-review-contributions.md) · [穿透计算入口](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/flows.js#L1031-L1048)
4. **历史汇率归因和近期汇率折算可以同时有用。** 期间盈亏拆分中的汇率一项按同一期间计算；近期折算影响固定当前外币敞口，比较两个汇率。期间中途卖出美元资产时，两项即使符号不同也可能同时成立。先看用户的问题，再决定默认显示哪一个；保留既已确认的汇率与分账户明细入口。[汇率折算](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/desktop/liveQuotes.js#L34-L62) · [五项归因](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/81f32167a576ef4d373e2a081a2326691be09e04/docs/adr/0005-gain-breakdown-and-daily-change.md) · [上次产品决定](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/36)

## 能区分候选首页的任务

以下是研究用例，金额为演示输入。先记录参与者打开页面想解决的真实问题，再请其完成任务。候选首页应使用相同账户、相同数据和相同题目。

| 给参与者的情境 | 什么回答能证明读懂 |
| --- | --- |
| 合并账户期初 A$100,000，期间从外部转入 A$10,000，收盘期末 A$109,500。请解释账户怎么变了。 | 总值增加 A$9,500，投资亏损 A$500。若同一笔转账发生在两个都选中的账户之间，合并口径的净外部流量为零。 |
| 澳股与美股最近一次收盘属于不同当地日期。请解释主卡副数字，随后切到历史估值日。 | 能找到当前变动使用的市场日期，并说明历史计算使用组合可用的两个收盘日。 |
| 一只已知数量的证券缺报价，另一只有报价但缺成本。现金仍可估值。请问现在能报告什么？ | 可说出已估值部分与遗漏项；缺成本影响持仓盈亏，单独缺成本不妨碍已知价格持仓的市值。 |
| 本期最大盈利来自一只已经卖清的股票；还持有某公司股票及重仓该公司的 ETF。请分别找收益来源和公司敞口。 | 先到收益复盘找该股票的期间贡献，再到配置分析找合计敞口。把当前持仓榜当作两题的答案属于误读。 |

最有判别力的比较是「日常查账优先」与「期间盈亏优先」，再使用缺数情境检验两者的例外处理。分别记录首次正确回答、严重的口径误读、首击去向和正确作答耗时；正确读懂且无需点击也是成功。若参与者更常带着期间复盘问题而来，或查账优先明显妨碍解释入金和盈亏，应重新评估首页排序。以上候选优先级来自公开资料与源码核查，尚无本项目用户观察或两版界面对照结果。

**证据范围。** 公开资料查阅于 2026-11-25。选取直接覆盖本地账本、多账户、外币收益与基金穿透的产品，并以券商报表和行为研究作对照。比较的是公开可验证的产品行为。项目基线为 `81f3216`，核查了渲染分支、变动及期间计算和既有验收记录；本研究没有重新运行应用或复现外部实验。[本地基线](https://github.com/JasonCodeMaker/Stack-Portfolio/tree/81f32167a576ef4d373e2a081a2326691be09e04)
