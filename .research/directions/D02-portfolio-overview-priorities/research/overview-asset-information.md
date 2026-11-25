# 除了账户总额，日常查账还应该看到什么？

**首屏优先测试一个新增读数：总资产中有多少是现金。** 放在总额下方，用一行金额和占比就够。第二个候选是给已有的收盘变动补一句「主要由谁带动」。公司集中度、目标偏离、基准表现和未来分红各有用途，但访问它们的时机不同。以下判断以研究者选定的「日常查账」为主场景，沿用现版五项指标、五个内容区和全部入口。

## 两个值得上总览的候选

| 用户看到账户时会问什么 | 现版能看到什么 | 建议放在哪里，怎样读 |
| --- | --- | --- |
| **这笔钱里有多少是现金？** | 现金计入总资产，点开总额可查证券与现金。前五大持仓图把剩余持仓与现金合为一项，不能据此单独读出现金。 | **优先常驻总额下方**。同一示例中写「其中现金 A$13,040（10.2%）」。点原有总额看证券 A$114,360，以及分账户现金。占比用所选账户、同一估值日的完整总额作分母。若分母未知或非正，只给可确认的金额；现金数本身未知时显示待核实。 |
| **这次收盘变动主要来自哪里？** | 主卡给组合收盘变动，账户区和前五大持仓表有各自的数字。前五名按当前市值排序，可能漏掉影响更大的小仓位或已经卖清的证券。 | **在收盘变动旁测试一句解释**。示例可写「收盘变动 +A$280，其中 IVV +A$150」。按同一范围、同一收盘口径的澳元贡献比较，不按证券涨幅排名。相反方向大额抵消时并列主要正负项；明细无法解释总数时保留原数字，避免给出单一主因。 |

示例取自 2026-10-30 的全部账户。现金由 IBKR 的 A$6,000 和 Webull Australia 的 A$7,040 相加得到，10.2% 的分母是 A$127,400。切到 IBKR 单账户，同一行应读作 A$6,000（7.2%）。历史收盘变动由 IVV +A$150、A200 +A$80、AAPL +A$50、BHP A$0 构成。期间投资盈亏是另一读数。对当前行情模式，需按既有的最近收盘、价格及汇率口径分别核对；现金汇兑、费用或无法归属的项目也可能解释变动。[示例快照](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/.research/directions/D02-portfolio-overview-priorities/prototypes/overview/index.html) · [原有现金明细与持仓榜](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/desktop/ui/Overview.jsx#L89) · [历史收盘贡献](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/desktop/todayChange.js#L152) · [当前收盘计算](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/desktop/liveQuotes.js#L68)

**产品依据。** IBKR 首页分别列出已结算现金和购买力，持仓页也能查看现金余额，这说明「有多少现金」可以是首页任务，但本账本能报告的是折合澳元的账面现金。买入额度、可提现额需要券商的结算及保证金信息。Sharesight 让用户在所选期间查看各持仓的贡献；IBKR 的报告也将贡献者单列。这些先例支持区分「持有多少」和「带来多少变动」。把一句贡献解释放进本项目的主卡，是需要验证的产品判断。[IBKR 组合首页与余额](https://www.interactivebrokers.com/support/faq/content/see-portfolio-client-portal-35810035) · [Sharesight 贡献分析](https://help.sharesight.com/au/contribution-analysis-report/) · [IBKR 按证券查看贡献](https://www.ibkrguides.com/reportingreference/reportguide/performancebysymbol.htm)

## 其他资产信息放在哪里

| 资产问题 | 现有信息及建议位置 | 何时值得提到总览 |
| --- | --- | --- |
| 我的资产分布在哪些账户、证券和币种？ | **保留现有卡**。账户金额、占比和变动已有账户区；前五大直接持仓已有权重与集中度；汇率卡已有美元净敞口、期间汇率盈亏和敏感度。若想知道股票、ETF、现金的整体比例，可进入配置分析。 | 美元敞口与汇率损益要分开读。示例有 US$53,800 净敞口，期间汇率盈亏为 A$0，两者可以同时成立。该例无须再造一张敞口或汇率卡。[总览账户与持仓](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/desktop/ui/Overview.jsx#L123) · [汇率卡字段](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/desktop/ui/MarketQuotes.jsx#L55) · [Wealthfolio 总览与配置分析](https://wealthfolio.app/docs/guide/dashboards/) |
| 我对同一家公司的实际敞口有多大？ | **配置分析承载穿透明细**。示例直接持有 A$31,200 的 Apple，同时持有 A$46,500 的 IVV。按示例成分表的 7%，至少还可识别 A$3,255 的间接持有，合计 A$34,455，约占组合 27.0%。这些权重仅用于示例。 | 若用户经常打开前五大持仓回答这个问题，可在该卡加「查看公司敞口」入口。部分 ETF 成分未知时保留未穿透部分。IBKR 同时提供基金穿透前后的集中度，正好对应这两种任务。[示例成分权重](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/desktop/demo.js#L72) · [IBKR 集中度说明](https://www.ibkrguides.com/clientportal/performanceandstatements/pa_viewingaccountperformance.htm) |
| 我的配置偏离既定目标了吗？ | **有个人目标才有偏离量**。项目的配置页已支持目标比例和容差。 | 只有该范围已设目标、估值可比且超过自设容差时，才值得测试从总览提示，例如「股票高于自设目标 4 个百分点」。没有目标时，保留实际分布即可。[本地目标编辑](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/desktop/ui/Allocation.jsx#L772) · [IBKR 配置目标](https://ibkrguides.com/clientportal/performanceandstatements/allocation-goals.htm) |
| 资产增长来自投入还是投资收益？同期表现如何？ | **先读总览已有的期间净投入和期间投资盈亏**，再从收益复盘追溯金额最大的证券贡献、已卖出证券和同期基准差。 | 入金和亏损同时出现时，并排的两个已有数字尤其重要。基准差需要同期间、同币种的比较对象。最大回撤要从剔除外部资金流影响的收益序列寻找峰值到谷值的跌幅。两者更适合复盘，总览保留现有收益率和走势。[本地收益贡献口径](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/docs/adr/0003-portfolio-review-contributions.md) · [IBKR 风险与表现分析](https://www.ibkrguides.com/clientportal/performanceandstatements/pa_viewingaccountperformance.htm) |
| 分红到账了吗？近期还有什么现金流？ | 已到账的分红与利息已计入盈亏构成。**未来分红日历留给收入跟踪场景**。已公告、预测、实际到账需要分别标示。 | 若用户确实按现金流安排支出，且有带日期和状态的可靠来源，可再测试「下一笔已公告入账」。本项目现有口径按到账日记收益，仅靠历史流水无法确认下一次到账。[项目收入确认口径](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/138d101ed34fe2106658b14b58662bae3156282e/docs/adr/0005-gain-breakdown-and-daily-change.md#L12) · [Sharesight 未来收入报告](https://help.sharesight.com/au/future_income/) |

## 怎样决定是否保留

固定首选的日常查账布局，先只比较有无现金行，再单独比较有无变动解释。每次都保留原有内容、账户选择和期间。给出结构相同、金额不同的样本，并轮换先后顺序。

- 让用户先报总资产，再问「其中还有多少现金，分在哪些账户？」记录首次答案、点击次数，以及是否把账面现金当成可提现额。额外的一行只有在帮助找到现金、同时不妨碍读主数时才值得保留。
- 让用户解释一个收盘变动，再换成最大持仓与最大贡献者不同的样本。观察是否能说出证券、方向和澳元金额，以及是否把它与所选期间盈亏混读。若新增摘要常引起误读，解释留在明细。
- 另问「直接持有的 Apple 和通过基金持有的 Apple 合计多少？」观察第一去向。只有直接持仓卡确实经常成为查公司敞口的起点，才值得在卡内增加穿透入口。

2026-11-25 查阅上述产品的官方功能说明，并从 D02 留存快照核对数字。产品文档证明这些信息和阅读路径确实存在；它们没有测量本产品用户看现金、贡献或集中度的频率。研究者已表达对日常查账布局的偏好，上述新增字段的价值仍待体验。
