# 投资看板验收

## 运行检查

在 desktop 目录运行以下命令。烟测使用临时示例账本和离屏 Electron 窗口。

```powershell
npm run typecheck
npm test
node tests/windows-smoke.cjs
node tests/overview.cjs
node tests/performance-review.cjs
node tests/allocation-view.cjs
node tests/holdings.cjs
```

## 规格 §6

| 场景 | 检查 |
| --- | --- |
| IBKR 8 股、Webull 2 股，明细合计 10 股，总览合并为一行 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyHoldings、verifyPeriods |
| 本月与今年以来切换，资产和前 5 大持仓不变，期间指标、图表及构成改变，两页同口径 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyPeriods。固定在 12 月末时，§6 的「近 1 月」与 §2.3 的「本月」覆盖同一期间 |
| 估值日 2025-12-31，页头提示，两个年度预设均为 365 天，显示年化 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyPeriods |
| 不满三个月隐藏回撤视图，最大回撤仍有日期和数值 | [performance-review.cjs](../desktop/tests/performance-review.cjs) 的本月检查 |
| A$40 买入、A$100 期初、A$110 卖清，已实现 +70、未实现变动 −60、贡献 +10 | [breakdown.test.cjs](../desktop/tests/breakdown.test.cjs) 的卖清场景及 [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 ABC 贡献检查 |
| IVV +A$106，现金利息 +A$3 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyPeriods |
| A$1,000 账户间划转，全选净投入及盈亏均为零，单看收款账户净投入 A$1,000、盈亏为零 | [period.test.cjs](../desktop/tests/period.test.cjs) 的 matched transfer 场景 |
| 10 股有报价缺成本，补成本后保留筛选、排序、焦点和滚动位置 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyHoldingCost |
| A$100,000 总资产，IVV 40% 低于目标 45% 时不用调，目标 46% 时买入 A$6,000 | [allocation-view.cjs](../desktop/tests/allocation-view.cjs) 的目标编辑检查 |
| 苹果直接 4%、经 IVV 3%，方框图 7%，宽屏检查器显示两条来源 | [allocation-view.cjs](../desktop/tests/allocation-view.cjs) 的 pricedApple 与 breakdown 检查 |
| 1920 宽停靠检查器，内容区两列缩为一列，关闭恢复。1280 宽弹窗 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyHoldings |
| 配置分析「个股」代码跳到证券明细，保留账户范围和估值日 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyHoldingLink |
| Webull 同步失败时可确认 IBKR 6 笔，再单独重试 Webull | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyBrokerRetry |
| 重复导入同一文件，持仓与现金不变 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyBrokerRetry |
| Windows 最小窗口 1024×640，侧栏 64、页头 52、总览单列、主图 240 | [windows-smoke.cjs](../desktop/tests/windows-smoke.cjs) 中的 verifyNativeMinimum |
| 最大化窗口所在副屏移除，重启回到主屏 1440×900 | [window-state.test.cjs](../desktop/tests/window-state.test.cjs) 的 removed secondary display 场景，使用显示器工作区域夹具 |

烟测也验证欢迎页、六页导航、示例月结对账、复盘笔记保存与重开、密码备份及在当前与空白配置中恢复。

## 截图

```powershell
node tests/windows-smoke.cjs --screenshots .testing/spec21/app
```

每个页面在 1024×640、1280×720、1920×1080 和 3440×1440 的 CSS 视口下各保存浅色、深色截图，共 56 张。文件按视口和主题存放。可在命令中传入已打包应用的 exe 路径，例如 `node tests/windows-smoke.cjs 'C:/path/Stock Portfolio.exe' --screenshots .testing/spec21/app`。

对照原型版本 480f8be。总览 A、收益复盘 A、配置分析 D、持仓 A、维护 A（导入与对账、设置、欢迎）。原型用 frame=1、demo=demo、book=none，并选择对应页面与主题。应用使用随附示例账本，配置分析保存示例目标，导入页打开两家券商的预览，欢迎页使用首次启动状态。

逐页对照浅色和深色的 56 对截图。本轮图片位于 desktop/.testing/spec21，app、prototype、compare 分别保存应用、原型和对照图。总览保留期间选择与数字卡之间的间距，图表从首条记录起绘制。持仓将长名称截短以给 1024×640 下的数值列留出空间。

| 页面 | 截图中的差异及原因 |
| --- | --- |
| 总览 | 示例账本从 2026-09-30 起跟踪两个账户，实际行情、排名和区间取自该账本。今日变动附上最新可估值的收盘日期。 |
| 收益复盘 | 示例期间 31 天，所以隐藏回撤视图。第二基准按复盘口径使用纳斯达克 100。持仓贡献取自示例流水，口径说明折叠，笔记按 §4.2 放在页尾。基准采用虚线便于区分。 |
| 配置分析 | 示例只有两只基金，权重、行业块、未逐家披露部分及偏离金额随账本和已保存目标而变。目标采用统一 ±5 个百分点。 |
| 持仓 | 应用展示实际两家券商的持仓、金额单位及缺成本状态，长名称保留悬停查看。 |
| 导入与对账 | 随附样例决定成交数量和账户数据变更。按钮文案随可确认内容变化。 |
| 设置 | 页签按 §4.6 命名。首次打开示例账本时显示示例连接，券商授权说明折叠。 |
| 欢迎 | 隔离环境没有可发现的 Wealthfolio 来源及已打开账本，所以只提供文件来源，也省略「返回当前账本」。 |
