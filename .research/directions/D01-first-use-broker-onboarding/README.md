# [DRAFT] [D01] First-Use Broker Onboarding

Date: 2026-11-25

Proposal status: DRAFT

## Objective

让第一次安装 Stock Portfolio 的 Windows 用户从欢迎页开始，接入自己使用的券商，将第一批记录导入正确的本地账户，并能在总览或持仓页找到这次导入的结果。教程分别覆盖只用 IBKR、只用 Webull Australia 和两家都用的人。

## Research Question

怎样在用户需要时，说明下一步在哪里操作、需要准备什么、如何判断这一步已完成？尤其要区分三个时刻：券商设置已保存、应用已成功取得数据、用户已确认入账。用户在券商网站或手机上操作时，也应知道怎样回到软件继续。

## Motivation

首次启动时，欢迎页突出显示迁入 Wealthfolio 和打开示例组合。没有旧账本的新用户可以从页脚建立空白账本。接下来的步骤分布在不同页面：本地账户在「账本与备份」创建，授权信息在「券商与行情连接」填写，首次拉取和确认在「导入与对账」完成。已有的欢迎页设计工作保留了这套流程。用户反馈是首次设置费劲，现有代码可以定位这些切换点，还没有新用户独立完成教程的观测结果。[欢迎页](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/ui/App.jsx) · [设置页](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/ui/Settings.jsx) · [导入页](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/ui/Imports.jsx) · [欢迎页设计记录](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/34)。

## 建议的首次使用流程

1. **选起点。** 在欢迎页提供「连接我的券商」入口。新用户选择自己的券商，在正式账本中创建或选择接收数据的本地账户。想先试用、迁入 Wealthfolio 或恢复备份的人可以直接走已有入口。
2. **按券商获取凭据。** 教程逐步说明到哪里申请或取得凭据、回到应用后填在哪个字段。IBKR 分支解释如何准备 Activity Flex Query，取得 Flex Query ID 和 Flex Token。Webull Australia 分支解释如何准备 OpenAPI 的 App Key 和 App Secret，在需要时完成手机授权，再核对要读取的券商账户。发布教程前应按当时券商提供的界面核对步骤和截图。
3. **完成首次导入。** 在「从券商拉取」前显示目标本地账户。预览把即将写入的内容和待核对事项列出来，由用户确认后入账。授权待处理、凭据无效、拉取成功但没有新记录，分别给出下一步；中断后可以回来继续。[现有导入预览](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/ui/ImportPreview.jsx)。
4. **用自己的数据做一件事。** 导入完成后进入对应账户的总览或持仓，找到刚刚导入的一项持仓或流水，并知道下次从哪里更新。如果数据覆盖期内没有记录，说明本次查询的范围和可选的历史文件导入入口。

> [!WARNING]
> **[DRAFT — NEEDS CLARIFICATION BEFORE DIRECTION CONFIRMATION]**
>
> 有两家券商时，建议第一家导入后就进入总览，清楚标出当前包含的账户，并保留「添加另一家券商」入口。另一种做法是让已选两家的用户导入两家后再看合并总览。两种选择会改变首次教程的完成条件，待项目负责人确认。[准备决策 Q1](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/41)。

## 如何验收教程

| 从哪里开始 | 需要观察到什么 |
| --- | --- |
| 全新安装，只有 IBKR | 用户只走 IBKR 分支，能找到所需凭据、选择正确的入账账户、预览并确认，随后在自己的账户里指出一项与测试记录一致的持仓或流水。 |
| 全新安装，只有 Webull Australia | 用户能完成所需的手机授权，回到桌面应用并核对券商账户与本地入账账户，最终在自己的组合里找到导入结果。 |
| 使用两家券商 | 两家数据分别记入指定账户。用户能说出总览当前包含哪家，以及从哪里继续接入另一家。首次完成的时点按 Q1 决定。 |
| 授权等待、凭据错误或拉取没有新记录 | 用户能判断当前状态，知道该去哪里授权、修正后重试或查看已查询的范围。成功拉取零条记录时有明确反馈；等待或失败时不会显示已导入。 |
| 中途退出或再次打开软件 | 用户能回到未完成的步骤；已完成导入的人可以正常打开账本，并从常规入口更新。示例数据始终能与用户自己的数据区分。 |

验收时从全新用户状态开始，观察首次使用者能否独立走完整条路径，记录在哪一步需要人提醒。已知测试记录可用来核对账户与导入结果。凭据保存或接口调用成功，只能证明对应步骤完成。

## 相关记录

本次工作覆盖教程提案、用户路径和验收标准。券商同步与本地入账沿用现有机制。教程实现、券商实时验证和新用户试用属于后续交付。[Direction 主记录](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/40) · [准备决策](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/41) · [本地账本设计](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/main/docs/adr/0001-independent-portfolio-ledger.md)。
