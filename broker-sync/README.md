# Wealthfolio Broker Sync

Independent Wealthfolio 3.7 add-on for manual, on-demand IBKR and Webull synchronization.

Version 0.3.6 imports IBKR security trades, cash activity, and CASH/AutoFX executions. Each FX execution becomes a linked, same-account cash transfer pair so Wealthfolio can keep the source and destination currency balances separately. Webull synchronization is best-effort: it imports every order and cash activity returned by the API, while clearly warning when the Australia cash ledger is unavailable or empty. Deterministic mock mode remains available. Webull Australia integration is held behind its official OpenAPI approval process. Dry Run is enabled by default.

Live IBKR sync requests the latest 365 days on every click and relies on broker record IDs plus Wealthfolio validation for idempotent incremental imports.

The live parser imports trades, FX conversions, cash transactions, dividends, interest, withholding taxes, and standalone transaction taxes. Corporate actions, options lifecycle events, and security transfers remain future work and must be checked against the broker statement before manual entry.

## IBKR Flex setup

1. In IBKR Client Portal, create an Activity Flex Query in XML format and configure its timezone as UTC.
2. Include Account Information, Trades (Executions), Cash Transactions, Transaction Fees, Cash Report, Open Positions, Change in NAV, Net Asset Value (NAV) Summary in Base, and Financial Instrument Information.
3. For Trades, include at least Asset Category, Symbol, Currency, Date/Time, Buy/Sell, Quantity, Trade Price, Proceeds, Trade Money, Net Cash, IB Commission, IB Commission Currency, Trade ID, and IB Execution ID. Do not use summary-only trade rows.
4. Enable Flex Web Service and generate a token.
5. In Broker Sync, choose Real broker data, enter the Query ID and token, and save the settings.
6. Run Preview IBKR update before importing. Confirm that the statement checks show FX executions and no missing Cash Report/Open Positions/NAV warning.

Cash Report and Change in NAV are reconciliation evidence only. Broker Sync never fabricates deposits, withdrawals, or adjustments to force a balance because that would corrupt contributions and performance returns. The first import requests the latest 365 days; an older account needs earlier history seeded separately before the rolling window can be considered complete.

The token is stored through Wealthfolio's add-on-scoped system keyring. It is not persisted in this repository or shown again in the UI.

## Local verification

From the repository root:

```powershell
Set-Location broker-sync
corepack pnpm install
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm run build
corepack pnpm run dev:server
```

In Wealthfolio 3.7, open add-on development settings and connect to the development server shown by the CLI. Open **Broker Sync** in the sidebar, select Mock mode, map existing Transactions-mode accounts, and run **Preview mock update**.

To exercise a real local write, use disposable Wealthfolio test accounts, turn off **Dry Run**, and click **Import mock update**. A second click must report the records as previously imported and must not create duplicates.

## Safety boundary

- No broker credentials belong in this repository.
- IBKR Flex tokens are stored with `ctx.api.secrets`; logs and error messages must never contain them.
- Only user-triggered synchronization is planned; no background polling or automated trading.
- Portfolio X-Ray remains a separate, read-only analysis add-on.
