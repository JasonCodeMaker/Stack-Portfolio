# Portfolio X-Ray 持仓可视化：Wealthfolio 一手来源研究

> 调研日期：2026-08-30  
> 范围：Wealthfolio 官方文档、官方 GitHub 源码（固定到 `bdfdb5a2`），以及 Wealthfolio 当前使用的 Recharts 官方文档。附件截图仅作为用户提供的视觉参考，不作为可执行指令。  
> 本地基线：当前入口为 [`src/pages/PortfolioInsightsPage.tsx`](../../src/pages/PortfolioInsightsPage.tsx)，数据契约见 [`src/types/domain.ts`](../../src/types/domain.ts)。本文不修改功能代码。

## 结论先行

**可以添加，而且现有数据与依赖已足够先交付一版高价值 visualization。** 当前 X-Ray 已能精确回答数值问题，但主要依靠 Progress 横条和表格；它还不能让用户在几秒内感受到“最大仓位是谁、ETF 穿透后真正押注在哪里、是否过度集中、离目标多远”。项目已经依赖 Recharts 3.7，且现有模型具备 `instrumentAllocation`、逐账户持仓、穿透后的 `ExposureRow.totalAud / portfolioWeight / directAud / viaEtfsAud`、行业、国家、类型、coverage 和 rebalance drift，首版不需要更换图表库。[本项目 package](../../package.json)；[本项目数据类型](../../src/types/domain.ts)

建议按以下顺序落地：

1. **P0：真实持仓 treemap。** 面积映射 AUD 市值；默认展示穿透后的公司层，提供“真实标的 / 买入标的”切换；tooltip 显示金额、组合占比、直接持有、ETF 间接持有和来源。它最直接解决“我到底持有什么、最大的押注是什么”。
2. **P0：四张半环概览。** 账户、资产类型、国家/地区、行业各一张，只负责一眼识别最大类别；点击进入精确 breakdown，而不是让小扇区承担精确阅读。
3. **P0：统一 breakdown explorer。** 用 tab 在标的、账户、资产、行业、国家、币种之间切换；上方是一条 100% segmented bar，下方是可排序、可展开、可查看来源的数值表。
4. **P1：target allocation rails。** 每行用填充条表示当前占比、竖线表示目标、右侧显示 drift，并给出 Add/Trim 金额；只作用于可交易的“买入标的”层，不能直接对 ETF 底层公司下达再平衡建议。
5. **P1：集中度卡。** 显示 Top 1、Top 5、Top 10 占比与最大行业/国家，旁边复用 treemap；这比单一“风险分数”更可解释。
6. **暂缓：盈亏热力配色。** 当前 X-Ray 数据契约没有 cost basis、daily return 或 unrealized P&L，不能把价格涨跌、持仓收益和市值变化混成同一个颜色指标。先用稳定的分类色或“直接持有 ↔ ETF 间接持有比例”编码；待引入明确的 P&L 字段后，再增加 Daily / P&L / Return 切换。[本项目 `NormalizedHolding` 与 `AllocationRow`](../../src/types/domain.ts)

## 当前代码审计

当前真实入口 [`PortfolioInsightsPage.tsx`](../../src/pages/PortfolioInsightsPage.tsx) 已经具备三张 summary card、Holdings / Exposure / Rebalance 三个 tab、Progress 横条和精确表格；Exposure 还能在 Companies / Sectors / Countries / Assets 四种聚合之间切换。换言之，项目不是缺少数据分析，而是缺少把同一批数据转成“先看形状、再读数字、最后追来源”的视觉层。

现有可直接复用的数据包括：

- `PortfolioModel.instrumentAllocation`：买入标的的 AUD 市值与组合权重；
- `NormalizedHolding.accountId / accountName / audValue / localCurrency`：账户与交易/报价币种维度；
- `ExposureRow.directAud / viaEtfsAud / totalAud / portfolioWeight / sector / country / type / sources`：真实持仓、行业、国家、直接与 ETF 间接来源；
- `ExposureModel.coverage / coveredValueAud / eligibleValueAud / valueConservationDelta`：图表覆盖率和守恒校验；
- `RebalanceRow.weight / targetWeight / drift / adjustmentAud / status` 与 `tolerance`：target rails 的完整输入。

这些字段集中定义于 [`src/types/domain.ts`](../../src/types/domain.ts)，聚合与再平衡语义分别来自 [`src/domain/exposure.ts`](../../src/domain/exposure.ts)、[`src/domain/portfolio.ts`](../../src/domain/portfolio.ts) 和 [`src/domain/rebalance.ts`](../../src/domain/rebalance.ts)。`package.json` 已包含 `recharts ^3.7.0`，所以 P0 工作主要是 derivation、组件与交互测试，不需要引入新图表依赖。[本项目 package](../../package.json)

## Wealthfolio 截图的信息架构

截图对应 Wealthfolio 当前 Insights Overview 的四层布局，官方源码把各层明确排成以下顺序：[Overview Page 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/insights/overview/overview-page.tsx#L411-L482)

| 层级 | 截图模块 | 回答的问题 | Wealthfolio 实现 | 对 X-Ray 的价值 |
|---|---|---|---|---|
| 1 | Portfolio value / Cash / Invested / Book cost | 我有多少钱，多少是现金，多少已投入？ | 响应式 value strip；桌面为四格，移动端总值独占一行、其余三格并排；多币种时显示 currency pills。[ValueStrip 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/insights/overview/value-strip.tsx#L78-L270) | 保留 Total、Invested/Cash，并把第三张现有 summary card优先给 **Look-through coverage**；Book cost 在数据齐全后再加。 |
| 2 | Accounts / Classes / Regions / Sectors 半环 | 最大来源/类别是谁？ | 账户卡先按 account group 聚合，再下钻到账户；分类卡读取 taxonomy 顶层，若有 children 则下钻；统一使用 `startAngle=180, endAngle=0`。[账户半环](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/drillable-account-chart.tsx#L29-L203)；[分类半环](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/drillable-donut-chart.tsx#L26-L156) | 用于账户、资产、国家、行业的 at-a-glance 预览；中心默认突出最大类别及占比。 |
| 3a | Composition treemap | 最大持仓是谁，仓位和涨跌是否集中？ | tile 面积由 base-currency market value 决定；颜色由 Daily/P&L/Return 决定；可切 symbol/name；tooltip 给市值、收益和日期；点击进入标的详情。[Composition 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/composition-chart.tsx#L316-L447) | X-Ray 应把默认数据源换成 look-through companies，同时保留 instrument view。 |
| 3b | Target allocation | 当前是否偏离目标，该加还是减？ | 每行当前值为填充条、target 为竖线、右侧为 drift；按超出 tolerance 的 value delta 排序生成最多 6 条 Add/Trim；底部总结 out-of-band 数和最大 gap。[Target Rails 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/insights/overview/target-rails-card.tsx#L71-L265) | 直接映射本项目 `RebalanceRow.weight / targetWeight / drift / adjustmentAud / status`。 |
| 4 | Breakdown | 精确值是多少？还能从什么角度看？ | tabs 覆盖 allocation、accounts、sectors、regions、risk、security types、currency 和 custom groups；上方 100% segmented bar，下方数值行；超过 6 类时收为 Top 5 + Other，可 Show all；分类行可打开详情。[Portfolio Explorer 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/insights/overview/portfolio-explorer.tsx#L52-L357) | 应成为 X-Ray 的“准确读取层”，复用现有 Exposure 表和 Sources sheet，而不是另造一套数字。 |

这种结构有一个重要原则：**overview 负责模式识别，breakdown 负责精确读取，sheet 负责解释来源。** 半环和 treemap 不替代表格；它们把用户的注意力引向值得进一步核查的类别。

Wealthfolio 官方文档也把资产配置定义为可 hover 查看金额和百分比的 donut，并把 sector / region / currency 的深入分析放到 Holdings → Insights；账户或自定义 portfolio scope 会同时过滤 value、return、allocation 和 holdings。[Portfolio Dashboards](https://wealthfolio.app/docs/guide/dashboards/)；[Accounts & Portfolios](https://wealthfolio.app/docs/guide/accounts/)

## 推荐 visualization 与数据映射

### 1. 真实持仓 treemap（P0）

建议界面：

- 标题：**True holdings composition**；
- 切换一：`Look-through`（默认）/ `Purchased instruments`；
- 切换二：`Symbol` / `Name`；
- 面积：`valueAud` 或 `totalAud`；
- tooltip：名称、AUD 市值、组合占比、Direct、Via ETFs、行业、国家、coverage/source 状态；
- 点击：打开现有 Sources sheet，列出直接持仓与 ETF 来源；
- 小 tile 不渲染文字，但仍保留 hover/click；列表与 treemap 使用同一选中状态。

| 视图 | 数据源 | tile key | 面积 | tooltip 补充 |
|---|---|---|---|---|
| Look-through | `exposure.rows` 的 companies 视角 | `ExposureRow.key` | `totalAud` | `portfolioWeight`, `directAud`, `viaEtfsAud`, `sources`, `sector`, `country` |
| Purchased instruments | `portfolio.instrumentAllocation` | `AllocationRow.key` | `valueAud` | `weight`, `type`, `status` |

Wealthfolio 的实现证明 Recharts Treemap 可用自定义 SVG content、tooltip 和 dataKey 完成这一交互；Recharts 官方 API 还支持 flat/nest treemap，`dataKey` 可为字段或函数，自定义 content 必须返回 SVG 元素。[Wealthfolio Composition](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/composition-chart.tsx#L430-L445)；[Recharts Treemap API](https://recharts.github.io/en-US/api/Treemap/)；[Custom Content Treemap](https://recharts.github.io/en-US/examples/CustomContentTreemap/)

不要在同一张图同时画 ETF 本体和其全部底层成分，否则总面积会超过组合净值。两个 mode 必须互斥；Look-through mode 中未披露的 ETF residual 也要作为 “Other / Uncovered in ETF X” tile 保留，不能把 coverage 缺口重分配给已知成分。当前项目已经把缺失数据视为 unknown 而不是 zero，现有 Data coverage sheet 也明确传达这一语义。[当前 Data Coverage UI](../../src/pages/PortfolioInsightsPage.tsx)

### 2. 四张可下钻半环（P0）

半环适合回答“最大类别是谁”，不适合让用户比较很多接近的小类别。因此每张卡只突出：最大类别、金额、占比；其余类别通过 hover 和点击进入 breakdown。

| 卡片 | 首版数据映射 | 点击行为 | 语义注意 |
|---|---|---|---|
| Accounts | 按 `NormalizedHolding.accountId/accountName` 汇总 `audValue` | 过滤到该账户，或打开账户 breakdown | 汇总值必须与当前 selected account scope 一致。 |
| Asset types | `portfolio.instrumentAllocation` 按 `type` 汇总 | 切到 Assets breakdown | 这是“买入工具类型”，不是底层经济资产；ETF 不自动算股票。 |
| Countries | companies exposure 按 `country` 汇总 `totalAud` | 切到 Countries breakdown | 当前 `country` 更接近证券归属/注册地，不能宣称是营收地理暴露。 |
| Sectors | companies exposure 按 `sector` 汇总 `totalAud` | 切到 Sectors breakdown | 缺分类单列 Unknown；不能从分母删除。 |

Recharts 官方半圆示例就是通过 Pie 的 `startAngle={180}` 与 `endAngle={0}` 实现；Wealthfolio 在账户与 taxonomy 卡中采用相同参数，并在分类有 children 时使用 breadcrumb drill-down。[Recharts Pie Chart with Needle](https://recharts.github.io/en-US/examples/PieChartWithNeedle/)；[Wealthfolio Drillable Donut](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/drillable-donut-chart.tsx#L86-L156)

### 3. Breakdown explorer（P0）

建议把当前 Holdings / Exposure 中重复出现的“分组 + 横条 + 表格”收敛为一个 explorer：

- tabs：`Holdings`、`Accounts`、`Asset types`、`Sectors`、`Countries`、`Currencies`；
- 顶部：100% segmented bar，只画 Top 5 + Other；
- 下方：精确行，显示金额与权重；Exposure 类行额外显示 Direct / Via ETFs；
- 支持排序、Show all、展开/收起；
- 点击行打开 Sources sheet；“Other”点击后显示被聚合的真实项目，而不是死节点；
- 当前 tab、排序和 Look-through mode 应在同一次 session 内保持。

映射现有数据：

| Lens | 现有数据 | 是否需要模型改动 |
|---|---|---|
| Holdings | `instrumentAllocation` 或 companies `ExposureRow[]` | 否 |
| Accounts | `portfolio.holdings` 按 account 聚合 | 否 |
| Asset types | `instrumentAllocation.type`；或 exposure `type` | 否，但 UI 必须标注 purchased / look-through |
| Sectors | `ExposureRow.sector` | 否 |
| Countries | `ExposureRow.country` | 否 |
| Currencies | 直接持仓可用 `NormalizedHolding.localCurrency` | **若要真实经济币种，需要改动。** `UnderlyingHolding.currency` 已存在，但 `ExposureRow` 没有 currency 字段；先命名为“交易/报价币种”，不要称“真实币种暴露”。 |

Wealthfolio 的 explorer 把每个 lens 映射成同一种 `BreakdownNode`，对类别数多于 6 的情况显示 Top 5 + Other，同时允许 Show all；这是本项目最值得复制的“一个交互模型，多种观察维度”。[Portfolio Explorer 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/insights/overview/portfolio-explorer.tsx#L43-L228)

### 4. Target allocation rails（P1）

当前 Rebalance 表已有全部关键字段，建议在表格上方增加 rails：

- 填充宽度：`row.weight`；
- target marker：`row.targetWeight`；
- 右侧 drift：`row.drift`；
- 状态颜色：overweight / underweight / on-target；
- Suggested moves：按 `abs(adjustmentAud)` 降序，显示 Trim/Add 金额；
- 底部：tolerance、超标项数量、largest drift；
- 点击 Details 回到完整 Rebalance 表，targets 编辑继续使用现有 sheet。

必须继续遵守当前产品语义：targets 作用于用户能直接交易的 `instrumentAllocation`，不能因为 AAPL 通过 IVV 暴露过高就建议“卖 AAPL”而忽略实际持有的是 IVV。Wealthfolio 的 target 功能同样把 current-target drift、tolerance band、out-of-band 状态和 rebalance plan 分开呈现；官方文档定义 drift 为 current allocation 减 target，并列出 Overweight、Underweight、In band、Not targeted。[Allocation Targets 官方文档](https://wealthfolio.app/docs/guide/allocation-targets/)；[Target Rails 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/insights/overview/target-rails-card.tsx#L71-L105)

### 5. 集中度与盈亏（P1 / 暂缓）

**集中度可以马上做，盈亏不能。**

集中度卡建议同时基于两套互斥口径：

- Purchased concentration：`instrumentAllocation.weight` 的 Top 1 / Top 5 / Top 10；
- Look-through concentration：companies `portfolioWeight` 的 Top 1 / Top 5 / Top 10；
- Largest sector / country：对应分组后的最大占比；
- Coverage 低于阈值时标注“基于已覆盖的 X%”，但仍以完整组合总值作为 portfolio weight 分母。

这能揭示“单个 ETF 看起来分散，但穿透后仍集中于同一批 mega-cap”的 X-Ray 核心价值。Wealthfolio 目前的 target model 设计已经把 `concentration` 列为 guardrail 类型，但截图中的当前 overview 尚未展示独立集中度卡；因此这是适合 X-Ray 的扩展，不是对截图的机械复制。[Wealthfolio target model spec](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/docs/features/allocations/sota-target-model-spec.md#L254-L274)

盈亏配色应等到每个可视节点都有清晰字段，例如 `dailyReturnPct`、`unrealizedPnlAud`、`totalReturnPct`。Wealthfolio 的 treemap明确把面积固定为 market value，再用 Daily / P&L / Return 切换决定颜色；tooltip 同时给出 as-of date。X-Ray 当前只有当前市值与价格更新时间，没有 cost basis 或 performance 字段，不能复制该颜色交互而伪造语义。[Wealthfolio Composition 数据映射](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/composition-chart.tsx#L316-L359)；[本项目数据类型](../../src/types/domain.ts)

## 可借鉴的交互细节

1. **点击概览进入同一份精确数据。** Wealthfolio 的半环 section click 要么下钻 children，要么打开 allocation detail sheet；card click 也可直接打开完整分类。[Drillable Donut 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/drillable-donut-chart.tsx#L84-L134)
2. **breadcrumb 保持层级上下文。** 账户先 group 后 individual account，taxonomy 先 parent 后 children；用户始终知道当前看的是哪一层。[Drillable Account 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/drillable-account-chart.tsx#L88-L159)
3. **Symbol/Name 与性能 mode 持久化。** Wealthfolio 用 persistent state 保存 treemap 的显示方式和 Daily/P&L/Return 选择，避免每次进入页面重置。[Composition 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/composition-chart.tsx#L316-L330)
4. **tooltip 不只重复标签。** 它补充金额、百分比/收益和数据日期；Recharts Tooltip 官方支持 hover 或 click 触发，也支持完全自定义 content。[Recharts Tooltip API](https://recharts.github.io/en-US/api/Tooltip/)
5. **响应式容器与移动降级。** Recharts ResponsiveContainer 通过 ResizeObserver 跟随父容器；X-Ray 应在窄屏把四张半环改成 2×2，并将 treemap 降为较矮区域或 Top holdings 列表。[Recharts ResponsiveContainer](https://recharts.github.io/api/ResponsiveContainer/)
6. **Top N + Other + Show all。** overview 控制噪音，精确数据仍可达；Other 必须可展开回真实项目。[Portfolio Explorer 源码](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/insights/overview/portfolio-explorer.tsx#L52-L85)
7. **账户 scope 是全页过滤器。** 选定账户后，summary、半环、treemap、breakdown 和 rebalance 必须同步变化，不能每个图各自保留旧分母。Wealthfolio 官方把 portfolio 定义为跨 Dashboard、Performance、Insights、Income、Holdings 的一致 reporting scope。[Accounts & Portfolios](https://wealthfolio.app/docs/guide/accounts/)

## 分阶段实施

| 阶段 | 范围 | 主要数据工作 | 完成定义 |
|---|---|---|---|
| Phase 1：感知持仓 | Look-through / Purchased treemap；账户、资产、国家、行业半环 | 只新增纯 derivation；复用现有 types | 图形合计守恒；scope 联动；tile/segment 可打开现有来源或精确表；Unknown/Residual 可见。 |
| Phase 2：精确探索 | Breakdown explorer、Top 5 + Other、Show all、来源展开 | 把现有四种 exposure grouping 与账户/币种 grouping 收敛为共享 node contract | tab、segmented bar、表格显示同一金额与权重；Other 可还原；排序和选择状态一致。 |
| Phase 3：行动层 | Target rails、Add/Trim 摘要、集中度 Top 1/5/10 | 复用 `RebalanceModel`；新增集中度 derivation | rails 与 Rebalance 表逐行一致；仅对 purchased instruments 给建议；coverage 不足时集中度有警示。 |
| Phase 4：数据扩展 | Daily / P&L / Return 热力；真实经济币种 | 引入明确 cost basis/performance 字段；把 underlying currency 保留到 exposure node | 不同 return mode 有明确公式和 as-of date；币种标签不再混淆报价币种与经济暴露。 |

每一阶段都应先写 derivation/value-conservation 单测，再接 Recharts 组件；图表层只消费标准化节点，不自行重新计算 portfolio totals。

## 风险与验收条件

| 风险 | 失败表现 | 防护与验收 |
|---|---|---|
| ETF 双重计数 | ETF 本体和底层成分同时占面积，总和大于 100% | Purchased / Look-through 互斥；每个视图的 tile value 合计与对应模型 total 在容差内一致。 |
| Coverage 被美化 | 未获取成分的 ETF 被当作 0 或被重分配 | residual/unknown 保留；全页可见 coverage；权重分母不缩到“已知部分”。 |
| 币种语义错误 | 报价币种被宣称为经济币种风险 | 首版明确写“交易/报价币种”；只有穿透模型保留 underlying currency 后才改名。 |
| 地区语义过度承诺 | 注册地被理解为营收来源 | 标签/tooltip 标注分类口径；Unknown 单列。 |
| 盈亏颜色伪造 | 用市值变化、当前价格或 stale 状态假装 return | 没有明确 performance 字段前不提供 Daily/P&L/Return；使用分类色或 direct-via 比例。 |
| 小 tile 不可读 | 标签重叠、误点 | 仅在宽高阈值以上渲染文本；所有数据仍在 breakdown 可达。Wealthfolio 也根据 tile 宽高缩放与截断文字。[Composition 自定义 tile](https://github.com/wealthfolio/wealthfolio/blob/bdfdb5a2ad3c1de09c6bc2fbc59495e427a2f24a/apps/frontend/src/pages/holdings/components/composition-chart.tsx#L109-L230) |
| 半环类别过多 | 细扇区无法比较 | 卡片只突出 Top category；完整比较交给 segmented bar + table。 |
| target 层级错误 | 对 ETF 底层公司生成不可执行建议 | rebalance 只读取 `instrumentAllocation`；look-through 只做风险洞察。 |
| 颜色不可访问 | 红绿难辨、深色模式文字失去对比 | 同时用文字、正负号、状态 badge；tile 文字色按实际亮度选择；键盘用户可通过 breakdown 完成同样操作。 |
| 不同图分母不一致 | 同一类别在两处显示不同占比 | 所有金额先统一为 AUD；scope、cash 是否包含、unknown 是否包含写成共享 derivation，并做 value-conservation 单测。 |

最低验收标准：

- Purchased treemap 面积合计 = `sum(instrumentAllocation.valueAud)`；
- Look-through treemap 面积合计 = `sum(exposure.rows.totalAud)`，并与 `exposure.totalAud`/`valueConservationDelta` 一致；
- 点击 treemap tile、半环 segment、breakdown row 打开的金额与同一节点一致；
- 切账户后所有可视化权重都使用新 scope 的 total；
- coverage 不满时 Unknown/Residual 可见且不会被归一化消失；
- targets 不满 100% 时继续阻止保存；tolerance 沿用当前 0.5%–25% 校验；
- dark mode、窄屏、键盘焦点和隐藏金额状态均有明确表现；
- 没有 P&L 数据时 UI 不出现收益颜色图例。

## 建议的页面排版

```text
┌ Total / Invested / Cash ───────────────┬ Look-through coverage ┐
├ Accounts ───┬ Asset types ─┬ Countries ─┬ Sectors ────────────┤
├ True holdings treemap (3/4 width) ──────┬ Target rails ────────┤
│  Look-through | Purchased               │ Current ┃ Target Drift │
│  Symbol | Name                          │ Suggested Add / Trim   │
├ Breakdown: Holdings Accounts Assets Sectors Countries Currencies ┤
│  100% segmented bar + exact rows + Direct/Via ETFs + Sources     │
└───────────────────────────────────────────────────────────────────┘
```

首版应先实现 treemap、四张半环和 breakdown 的联动，再做 target rails。这样即使没有新增数据 API，用户也能从“表格里找答案”升级为“一眼看出真实持仓结构，再下钻验证数字”。
