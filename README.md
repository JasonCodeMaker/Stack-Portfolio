# Stock Portfolio

Stock Portfolio 是一款本地 Windows 投资组合应用。它支持持仓估值、ETF 穿透与配置目标、策略复盘，以及 IBKR 和 Webull Australia 的交易导入、同步与对账。已有投资历史和设置可以从 Wealthfolio 账本迁入。

[Windows 安装包](https://github.com/JasonCodeMaker/Stack-Portfolio/releases) · [使用与构建说明](desktop/README.md)

## 本地开发

在仓库根目录执行以下命令。开发环境需要 Node.js 22.15 或更高版本。

```powershell
npm --prefix desktop ci --ignore-scripts
npm --prefix desktop start
npm --prefix desktop run typecheck
npm --prefix desktop test
```

安装时使用 SQLite 依赖随包提供的预编译二进制。应用源码、测试和打包配置位于 `desktop/`。运行 `npm --prefix desktop run dist` 会在 `release/desktop/` 生成 Windows x64 安装包。
