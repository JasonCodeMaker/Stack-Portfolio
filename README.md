# Stack Portfolio

Stack Portfolio 是在 Windows 上管理投资组合的本地应用。可以从 Wealthfolio 迁入历史账本，查看持仓与 ETF 穿透配置，导入和同步 IBKR、Webull Australia 交易，并按券商结单对账。

[下载 Windows x64 安装包](https://github.com/JasonCodeMaker/Stack-Portfolio/releases/download/v1.0.0/Stack-Portfolio-Setup-1.0.0-x64.exe) · [使用与构建说明](desktop/README.md)

## Allocation for Wealthfolio

Allocation is a Wealthfolio 3.7 addon for monitoring portfolio weights, underlying exposure, and rebalancing in AUD. It uses one Wealthfolio-native page instead of recreating dashboard, holdings, and settings experiences.

The page combines:

- Tradable holdings, including stocks, ETFs, and cash.
- User-defined target weights, drift tolerance, and rebalance status.
- Direct and ETF-derived company exposure.
- An on-demand `Expand ETFs` view that merges direct shares with fund-derived shares of the same company.
- Per-fund constituent filtering: weights above 1% are shown separately; weights at or below 1% are grouped into that fund's `Others` row.
- Sector, country, and asset-class views.
- Look-through coverage, unresolved-data warnings, and source drill-down.

Rebalancing targets apply to tradable holdings. Look-through views explain economic concentration; they do not pretend that an ETF constituent can be traded independently.

## Development

```text
npm install
npm run typecheck
npm test
npm run build
npm run bundle
```

`npm run bundle` creates an installable archive under `release/` containing `manifest.json` and `addon.js`.

## Design boundaries

- Wealthfolio accounts, holdings, prices, cash, and performance are read through the 3.7 SDK.
- The addon stores only addon-owned settings, current ETF snapshots, and the shared FX quote through host storage/secrets.
- External requests use `ctx.api.network.request` and include only public ETF identifiers or `USD/AUD` plus provider authentication.
- Missing prices, unsupported currencies, unresolved ETFs, and provider failures remain visible; they are never replaced with zero.
- Look-through exposure conserves value through direct, cash, non-equity, residual, and opaque buckets.

The acceptance suite covers currency conversion, account selection, holding normalization, snapshot validation, Manual CSV parsing/export, recursive ETFs and cycles, value conservation, and provider privacy. Official Docker installation, reverse-proxy networking, and container restart verification require a running Wealthfolio 3.7 deployment.
