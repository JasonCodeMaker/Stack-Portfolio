# [D01] First-Use Broker Onboarding

Date: 2026-11-25

Proposal status: CONFIRMED

Research status: ACTIVE

2026-11-25，项目负责人确认了[按账户逐个绑定的提案](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/34779b019fe30436d7930d75fe7374e3e376035a/.research/directions/D01-first-use-broker-onboarding/README.md)，并要求每家券商分别提供清晰的逐步教程，优先使用图文。[确认记录](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/40#issuecomment-7150057011)。

## Objective

让第一次打开 Stock Portfolio 的 Windows 用户自己决定要接入哪些账户。用户可以暂时跳过，也可以逐个绑定 IBKR 或 Webull Australia 的账户，同一家券商可以添加多次。结束添加后，教程帮助用户把记录导入对应的本地账户，并在总览、持仓或交易流水里找到自己的数据。

## Research Question

新用户怎样确认自己正在绑定哪个券商账户、它对应哪个本地账户，以及第一次导入会写到哪里？例如，一个人有两个 IBKR 账户和一个 Webull Australia 账户，应该能按自己选择的顺序添加任意几个，并在每次绑定后决定是否继续。[用户确认的流程](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/41#issuecomment-7150091822)。

## Motivation

首次启动的欢迎页提供迁入 Wealthfolio、打开示例组合和建立空白账本等入口。新用户还需要到「账本与备份」创建本地账户，在「券商与行情连接」授权，再去「导入与对账」拉取和确认。用户反馈这些设置费劲。以账户为单位串起流程，可以在每一步展示正在处理的账户，并允许随时结束添加。[欢迎页](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/ui/App.jsx) · [设置页](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/ui/Settings.jsx) · [导入页](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/ui/Imports.jsx)。

## 首次使用流程

1. **先问「现在要添加账户吗？」** 显示「添加账户」和「暂时跳过」。选择跳过即可结束添加，之后可以从账本中重新进入。示例组合、迁入和备份恢复继续使用各自的入口。
2. **点击「添加账户」后，问「这个账户在哪家券商？」** 用户本次只选 IBKR 或 Webull Australia 中的一家。列出已有绑定，便于识别这次要添加的账户。
3. **绑定这一个账户。** IBKR 路径说明如何为目标账户准备 Activity Flex Query、Query ID 和 Flex Token。Webull Australia 路径说明如何取得 App Key 和 App Secret，按需完成手机授权，并选中具体券商账户。引导用户核对可辨认的账户名称或尾号，以及要接收入账记录的本地账户。绑定成功时展示这对账户。若授权待处理或失败，说明如何继续或重试。
4. **绑定成功后立即问「还要继续添加账户吗？」** 「继续添加」回到券商选择，刚选过的券商仍可选。「完成添加」结束循环。只绑一个账户就可以完成；有多个账户时由用户决定何时结束。[流程决策](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/41#issuecomment-7150091822)。
5. **引导首次使用数据。** 有已绑定账户时，引导用户为所选账户拉取数据，预览入账目标并确认，然后去总览、持仓或交易流水查看结果。将「账户已绑定」「已拉取数据」「已确认入账」分别展示。若没有新记录，解释查询范围及下一步。[现有导入预览](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/ui/ImportPreview.jsx)。

## 每家券商的图文教程

用户选定券商后，应该只看到这一家的教程。每步写清在哪里操作、点哪个控件、何时返回 Stock Portfolio，以及怎样判断已成功。需要切换设备或查找凭据的步骤优先配图；图旁保留按钮原名。凭据输入框配图使用空白或示例数据。

- [IBKR 账户添加指南](../../../docs/onboarding/ibkr.md)展示如何为指定账户创建 Activity Flex Query、取得 Token、填写桌面端连接信息，以及核对首次导入。
- [Webull Australia 账户添加指南](../../../docs/onboarding/webull-au.md)展示如何申请 API、等待批准、生成密钥、完成手机授权，并核对券商账户与本地账户。

这两份教程按当前桌面版 1.3.2 编写。应用内逐账户向导上线时，需用该版本的实际操作入口替换截图，并验证两条教程均可从「添加账户」进入。

## 需要验证的产品能力

当前桌面端读取一组 IBKR Flex 连接设置和一个当前选中的 Webull 账户 ID。IBKR 解析器会拒绝包含多个账户的 Flex 报表，并提示每个账户使用单独的查询和映射。因此，同一家券商的第二个账户能否与第一个同时保留、分别拉取和入账，需要用两份可区分的账户数据验证。后续设计应查清哪些凭据可以复用，以及每个绑定需要独立保存哪些账户信息。[连接设置](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/main.cjs#L505) · [拉取账户的代码](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/services.js#L854) · [IBKR 多账户报表检查](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/4b5c31f6e6eccabeb679e0d811ce3e2c4fbbc20b/desktop/brokers/ibkrFlex.ts#L251)。

## 如何验收教程

| 场景 | 用户能独立完成的操作与可核对的结果 |
| --- | --- |
| 首次选择「暂时跳过」 | 不用填写凭据即可结束添加，之后能找到「添加账户」入口。 |
| 只用一家券商、只有一个账户 | 分别走通 IBKR 和 Webull Australia 两条路径。每次绑定后都能直接选择「完成添加」，并在首次导入预览中核对目标账户。 |
| 同一家券商有两个账户 | 绑定账户 A 后选择「继续添加」，再次选择同一家券商并绑定 B。重新打开账本后两个绑定都保留；分别拉取和确认导入后，A、B 各自只有预期记录。两家券商各验证一次。 |
| 使用不同券商的账户 | 先添加 IBKR，再添加 Webull Australia，或反向添加。每次成功后都出现同一个继续添加提示，用户能看清总览当前包含哪些账户。 |
| 授权等待、中断或没有新记录 | 用户知道是去手机完成授权、回到应用重试，还是查看查询范围。中途退出再继续时，之前成功绑定的账户仍然可用。 |

验收时让首次使用者分别只看对应券商的教程，记录在哪一步需要提示。核对图中的菜单、按钮和授权状态是否与当时的界面一致，并用已知持仓或流水核对入账账户。账户绑定和首次导入分别验收。

## 相关记录

项目负责人已确认本 Direction。账户绑定向导的实现、真实账户的端到端验证和新用户试用属于后续交付。[Direction 主记录](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/40) · [准备决策](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/41) · [本地账本设计](https://github.com/JasonCodeMaker/Stack-Portfolio/blob/main/docs/adr/0001-independent-portfolio-ledger.md)。
