# Wealthfolio Allocation — Design Spec v2

## Product goal

Extend Wealthfolio Insights with a single native-feeling analysis page that answers:

1. What holdings can I trade, and what percentage does each represent?
2. What companies, sectors, countries, and asset classes am I actually exposed to after fund look-through?
3. Has a tradable holding drifted far enough from my target to require review?

## Information architecture

The addon contributes one `Allocation` route. It has no internal sidebar and no duplicate Overview, Holdings, ETF Data, or Settings pages.

Views:

- **Holdings:** stocks, ETFs, and cash with actual weight, target, drift, and status.
- **Companies:** direct stocks merged with the same companies held through ETFs.
- **Sectors:** look-through exposure grouped by sector.
- **Countries:** look-through exposure grouped by country.
- **Asset classes:** look-through exposure grouped by underlying asset type.

Account selection, target editing, source details, and data coverage use contextual sheets rather than permanent pages.

Holdings defaults to tradable instruments. `Expand ETFs` switches to economic holdings, merges each direct stock with the same company held through funds, shows constituents whose weight in an individual fund is greater than 1%, and groups constituents at or below 1% into a fund-specific `Others` row.

## Rebalancing boundary

Targets attach only to tradable Wealthfolio holdings. A drift outside the user-selected tolerance is labelled overweight or underweight and expressed as an AUD difference from target.

The addon does not generate orders or claim that an ETF constituent can be bought or sold independently. Company, sector, country, and asset-class views are monitoring views.

## Host boundary

Wealthfolio remains the source of truth for accounts, holdings, transactions, prices, cash, performance, and native classification. Addon storage contains only addon preferences, target weights, provider configuration, valid fund snapshots, aliases, and FX cache data.
