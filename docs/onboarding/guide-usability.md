# 券商设置向导的图文修订

Stock Portfolio 1.4.8 的向导固定预留右侧图片区。选择券商和核对账户复用了同一张测试账本截图，凭据页又展示了一遍正在填写的表单。外部操作使用整页缩略图，弹窗只能切换像素尺寸。步骤数据把多个券商界面合并在一段文字里，也把尚待用户核对的现象统一画成了绿色对勾。

## 对照真实任务

| 用户在做什么 | 1.4.10 的处理 | 核对方式 |
| --- | --- | --- |
| 确定当前步骤 | 选券商为第 1 步。选定券商后按实际页面计数。Webull 授权结果返回后才能确定是否需要手机确认。 | 同一账户只有一个步骤编号。返回时回到上一项操作，继续添加从第 1 步开始。 |
| 选券商、核对账户 | 无截图的页面使用单列。获得验证结果后才显示实际券商尾号与目标账本名称。 | 选择 IBKR 前没有样例账户。更改本地名称时映射随之更新。 |
| 在 IBKR 找按钮 | 局部与全图使用同一组源图坐标。新建查询的一行同时显示标题和加号。 | 打开全图后，箭头仍落在 Activity Flex Query 的加号上。 |
| 配置成交字段 | 用中文说明到哪里点，保留 Trades、Execution 和 Select All 的网页原名，同时展示两处勾选的实拍。 | 两个真实蓝色勾选都能在默认视图看到，完整教程可从同一步打开。 |
| 判断能否继续 | 外部预期画面使用文字和眼睛图标，具体问题放在单独的可展开入口。 | 未验证的页面没有“验证成功”标识。 |
| 查看截图 | 默认看目标细节，可打开标有相同目标的完整截图。 | 关闭图片返回原步骤，保留已填写的值。 |
| 粘贴凭据 | 每个字段标出来源，可单独展开对应的 IBKR 原图。 | Query ID 对应查询信息图标，Flex Token 对应 Current Token 行。 |

IBKR 的创建流程将选择报表区块、进入字段弹窗、配置输出、检查并创建查询分开。向导据此按实际界面分步，报表字段的选择由 Stock Portfolio 使用这些数据的目的决定。[IBKR 创建查询](https://www.ibkrguides.com/clientportal/performanceandstatements/activityflex.htm) · [IBKR Flex Web Service](https://www.ibkrguides.com/clientportal/performanceandstatements/flex-web-service.htm)

Trades 选项页采用 Trandence 展示的 IBKR 英文实拍。图源在软件中单独署名。箭头和边框是向导的定位标注，蓝色勾选来自原图。[Trades 选项实拍](https://trandence.com/help/broker-guides/interactive-brokers/)

微软的分步写作指南建议先明确操作位置，并把发生在同一界面的简短动作放在一起。这支持在桌面表单上直接给出字段提示，以及在需要切换到券商门户时提供有明确目标的图。[Microsoft 分步操作指南](https://learn.microsoft.com/en-us/style-guide/procedures-instructions/writing-step-by-step-instructions)

Windows 交互回归覆盖了首次启动、完整教程、截图打开与关闭、选择同券商多个账户、关联账本、重启和导入。券商响应使用独立测试账本的固定样例。首次使用者在本人 IBKR 账户上的完成率仍需实测。
