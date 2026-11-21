# Stack Portfolio for Windows

下载并运行安装程序，然后从 Windows 开始菜单打开 **Stack Portfolio**。[Windows x64 安装程序](https://github.com/JasonCodeMaker/Stack-Portfolio/releases/download/v1.0.1/Stack-Portfolio-Setup-1.0.1-x64.exe)

## 接手现有账本

首页可预览本机 Wealthfolio 账户、流水、行情和设置的数量，或选择未加密的 SQLite 账本备份。确认迁入后，应用在当前 Windows 用户的 `%APPDATA%\Stack Portfolio\portfolio.sqlite` 中独立保存账本。保留原记录编号、手工更正、同步去重记录、配置目标、ETF 数据及原始估值。加密的 Wealthfolio 备份可先在 Wealthfolio 中导出为未加密的本地数据库。

在 **数据与设置 → 券商与行情连接** 重新授权 IBKR Flex、Webull Australia 和所用的数据源。IBKR 按需读取最近 365 天，Webull 读取最近六个月。更早的记录可从文件导入。现金流水未覆盖时，可用同日月结单核对并补录。**数据与设置 → 账本与备份** 提供本地备份和恢复。恢复已有正式账本时，会先保留一份恢复前的副本。

## 试用示例组合

点击左下角的账本名称可切换正式账本与示例账本。示例组合有一份 Webull 成交文件和一份月结单。在 **导入与对账** 载入示例 CSV，预览并确认导入。打开示例月结单，填入期末余额和持仓，比较差异，再按凭证补录 A$1,000 入金并完成对账。总览会显示 A$128,400 总资产和 A$3,200 期间投资盈亏。重复导入时可看到重复记录数。

**配置分析** 可查看持仓与基金对同一公司的贡献、行业和国家分布、配置目标及偏离。**ETF 成分** 可查看、刷新及导入导出成分表。报价和汇率保留日期与来源，缺失和待核对项目会在总览提示。

## 本地构建

从本目录执行 `npm ci`，然后执行 `npm start`。开发环境需要 Node.js 22.15 或更高版本。运行 `npm test` 验证账本、迁移和对账，`node tests/windows-smoke.cjs` 检查 Windows 界面流程，`npm run dist` 生成当前用户可安装的 x64 安装包。安装后的软件自带运行环境。
