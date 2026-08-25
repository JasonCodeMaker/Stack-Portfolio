# Portfolio X-Ray

Portfolio X-Ray is a Wealthfolio 3.7 addon that explains portfolio exposure in AUD. It keeps Wealthfolio as the source of truth and adds current USD/AUD valuation, ETF look-through, canonical identity merging, coverage, residual buckets, and source drill-down.

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
- `True Exposure` conserves value through direct, cash, non-equity, residual, and opaque buckets.

The acceptance suite covers currency conversion, account selection, holding normalization, snapshot validation, Manual CSV parsing/export, recursive ETFs and cycles, value conservation, and provider privacy. Official Docker installation, reverse-proxy networking, and container restart verification require a running Wealthfolio 3.7 deployment.
