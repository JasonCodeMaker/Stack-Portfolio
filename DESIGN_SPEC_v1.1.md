# Wealthfolio Portfolio X-Ray — Design Spec v1.1

**Status:** Approved for implementation  
**Target:** Wealthfolio self-hosted Web/Docker 3.7.x  
**Addon ID:** `portfolio-xray`

## 1. Goal

Build a Wealthfolio addon that turns the instruments the user owns into the companies and asset classes to which the portfolio is economically exposed.

The addon serves portfolios with:

- Multiple manually managed broker accounts.
- US- and Australian-listed stocks and ETFs.
- AUD as the Wealthfolio base currency.
- Current portfolio valuation and allocation in AUD.
- Near-real-time USD/AUD conversion for current X-Ray analysis.
- ETF look-through, including nested ETFs.
- Consolidation of direct and ETF-derived exposure to the same security.
- Local-first personal portfolio data.

The core transformation is:

```text
Wealthfolio Holdings
        │
        ├── Stock ─────────────────────────┐
        │                                  │
        └── ETF → Constituents × Weight ───┤
                                           ↓
                                  Canonical Assets
                                           │
                                           ↓
                                    AUD Valuation
                                           │
                                           ↓
                                  Merged True Exposure
```

## 2. Frozen Product Boundary

Wealthfolio remains the source of truth for:

- Accounts and broker labels.
- Manually entered transactions and holdings.
- Stock and ETF prices.
- Cash holdings.
- Historical performance and cash-flow accounting.
- TWR, IRR and value return.
- Benchmark selection and comparison.
- The local portfolio database.

Portfolio X-Ray only adds:

- A near-real-time USD/AUD quote for current X-Ray valuation.
- ETF constituent acquisition and normalization.
- Manual CSV constituent import and export.
- Recursive ETF look-through.
- Direct and indirect exposure consolidation.
- Instrument Allocation, True Exposure and Look-through Coverage views.
- Exposure source drill-down and data-quality warnings.

The addon must not:

- Fork or modify Wealthfolio Core.
- Create a second account, holdings, transaction, price or performance database.
- Replace Wealthfolio's market-data or performance engines.
- Change Wealthfolio's native market-sync behaviour.
- Reimplement benchmark selection or performance calculations.
- Add a separate backend, sidecar, PostgreSQL, Redis, Next.js, Electron or Python service.

## 3. Non-goals

- Australian tax or CGT calculations.
- Broker synchronization.
- Automated trading.
- Financial advice.
- Crypto, options, short positions, margin debt or leveraged portfolio accounting.
- Fundamental analysis.
- Historical reconstruction before Wealthfolio tracking began.
- A complete market-data backend.
- Compatibility with Wealthfolio Desktop as a v1 release requirement.
- Compatibility with Wealthfolio versions before 3.7.0.

## 4. Runtime and Technology

Target Wealthfolio and official packages in the 3.7 line:

```text
Wealthfolio                    >= 3.7.0
@wealthfolio/addon-sdk         3.7.x
@wealthfolio/ui                3.7.x
@wealthfolio/addon-dev-tools   3.7.x
React                          compatible with Wealthfolio 3.7
```

Allowed application libraries:

```text
TypeScript
React
@wealthfolio/addon-sdk
@wealthfolio/ui
React Query
Recharts
Zod
```

Implementation must use the types supplied by the installed SDK. It must not rely on outdated flattened examples of the `Holding` type.

## 5. Addon Surface

The addon contributes one sidebar link:

```text
Portfolio X-Ray
```

Its root URL is:

```text
/addons/portfolio-xray
```

For Wealthfolio 3.7, the root route contribution omits an absolute `path`; the host mounts the route using the manifest ID. The runtime route ID must match the manifest contribution.

Pages:

```text
Overview
Holdings
X-Ray
ETF Data
Settings
```

## 6. Account Selection

- On first use, include every active Wealthfolio account.
- Settings provides an account multi-select for X-Ray only.
- An explicitly deselected account remains deselected.
- A newly created active account is included by default and produces a one-time notice.
- Deleted or inactive accounts are automatically excluded.
- The addon never creates or edits Wealthfolio accounts.

Account selection is addon preference data stored through `ctx.api.storage`.

## 7. Wealthfolio Data Contract

Read active accounts and holdings using the 3.7 SDK:

```typescript
const accounts = await ctx.api.accounts.getAll();

const holdings = (
  await Promise.all(
    selectedActiveAccounts.map((account) =>
      ctx.api.portfolio.getHoldings(account.id),
    ),
  )
).flat();
```

Use the actual v3.7 holding fields, including:

- `holdingType`
- `instrument?.id`
- `quantity`
- `localCurrency`
- `baseCurrency`
- `fxRate`
- `marketValue.local`
- `marketValue.base`
- `asOfDate`

When an instrument is present, use `ctx.api.assets.getProfile(instrument.id)` to obtain its type, symbol, MIC and canonical instrument key.

Rules:

- Identify cash using `HoldingType.CASH`.
- Do not treat `Account.balance` as an authoritative cash balance.
- Use cash holdings for portfolio composition.
- Account valuation cash totals may be used only as a reconciliation check.
- If reconciliation differs, show a warning and never count both values.
- Do not infer Stock versus ETF solely from ticker syntax.
- An unresolved instrument type is `Unknown` until the user supplies a local override.

## 8. Supported Portfolio Conditions

### 8.1 Currency

v1 supports AUD and USD holdings and cash only.

- AUD assets use their local market value directly.
- USD assets use their local market value multiplied by the selected USD/AUD quote.
- Any other currency remains visible in Holdings with `Unsupported currency`.
- Unsupported-currency value is not treated as zero.
- If an unsupported currency has material value, total AUD value and derived percentages are marked incomplete.

### 8.2 Long-only

v1 does not support:

- Negative security quantity.
- Negative cash.
- Shorts.
- Margin debt.
- Leveraged portfolio accounting.

If detected, show the affected rows but stop percentage-based X-Ray calculations and explain why the portfolio is unsupported.

### 8.3 Missing prices

- Use the last Wealthfolio price/value when available and display its timestamp.
- A holding with no usable market value remains visible.
- Never replace a missing value with zero.
- If any material holding cannot be valued, mark Portfolio Total as incomplete and do not present misleading allocation percentages.

### 8.4 Empty state

Distinguish:

- No holdings in the selected accounts.
- Holdings exist but cannot be valued.

Do not calculate percentages or Coverage in either state.

## 9. Current USD/AUD FX

### 9.1 Primary provider

Use Twelve Data's USD/AUD exchange-rate endpoint through `ctx.api.network.request`.

External request data is limited to the pair and provider authentication. It must never include portfolio information.

```typescript
interface FxQuote {
  pair: "USD/AUD";
  rate: number;
  fetchedAt: string; // ISO UTC
  provider: "twelvedata" | "wealthfolio";
}
```

### 9.2 Refresh policy

```text
Page load              → fetch only if shared quote is stale
Visible page           → check every 5 minutes
Manual refresh         → fetch subject to rate limits/backoff
Hidden page            → stop polling
Visible again          → refresh if stale
```

Before fetching, read the shared `fetchedAt` from addon storage. If another page has written a quote within five minutes, reuse it. Storage has no compare-and-swap guarantee, so rare simultaneous requests are acceptable; repeated rapid retries are not.

### 9.3 Freshness

```text
< 10 minutes       Fresh
10–30 minutes      Stale
> 30 minutes       Warning
```

Always show provider and timestamp. Never silently label a cached quote as live.

### 9.4 Fallback

Fallback to Wealthfolio exchange rates through `ctx.api.exchangeRates.getAll()`.

If neither source yields a valid USD/AUD quote:

- Continue showing native-currency values.
- Stop total AUD, allocation and X-Ray calculations.
- Prompt the user to refresh Wealthfolio rates or configure Twelve Data.
- Never use a hard-coded rate.

### 9.5 Valuation formula

```text
AUD holding: AUD value = marketValue.local
USD holding: AUD value = marketValue.local × USD/AUD

Portfolio AUD value = sum of all supported, valued holdings and cash
```

`marketValue.base` and the holding's Wealthfolio FX rate are fallback/reconciliation data only. Do not mix Wealthfolio-converted values and the live quote within one successful X-Ray calculation.

## 10. Overview

Top metrics:

```text
Total Portfolio
A$ 53,241.72

USD/AUD
1.5238
Twelve Data · 2 min ago

ETFs
4

Look-through Coverage
98.7%
```

The page also displays:

- Instrument Allocation chart.
- True Exposure chart.
- Data-quality warnings.
- A button that navigates to Wealthfolio's native `/performance` page.

The addon does not store a benchmark symbol and cannot preselect a native benchmark through the public 3.7 API.

Charts show the top ten entries and combine the remainder into a view-only `Other` slice. The underlying model and tables retain every entry.

## 11. Instrument Allocation

Instrument Allocation answers: **What instruments did I buy?**

- Do not decompose ETFs.
- Aggregate the same canonical instrument across selected accounts.
- Include supported cash as currency-specific buckets.
- Calculate weights from current AUD values.
- Preserve unknown and unsupported instruments visibly.

```text
Instrument Weight = Instrument AUD Value / Portfolio AUD Value
```

Using unrounded values:

```text
sum(Instrument Allocation) ≈ 100%
```

## 12. Holdings Page

The Holdings table preserves account-level auditability. The same ticker held in two accounts appears as two rows.

Columns:

```text
Ticker
Name
Account
Type
Quantity
Currency
Native Value
AUD Value
Portfolio Weight
Price Updated
Status
```

Aggregation across accounts occurs in Instrument Allocation and X-Ray, not in the raw Holdings rows.

## 13. ETF Domain Model

```typescript
interface EtfHoldingsSnapshot {
  schemaVersion: number;
  etfKey: string;
  provider: string;
  asOfDate: string;
  fetchedAt: string;
  holdings: UnderlyingHolding[];
  weightSum: number;
  normalized: boolean;
}

interface UnderlyingHolding {
  symbol?: string;
  name: string;
  isin?: string;
  mic?: string;
  weight: number; // normalized domain value, 0–1
  country?: string;
  currency?: string;
  sector?: string;
  assetClass?: string;
  underlyingType?: "stock" | "etf" | "cash" | "fixed-income" | "derivative" | "other";
}
```

`etfKey` priority:

1. Wealthfolio `instrumentKey`.
2. `MIC:symbol`.
3. A stable provider-qualified fallback key.

Never use ticker alone as a unique ETF identifier.

## 14. Canonical Identity and Merging

v1 merges the same economic security across direct and indirect sources. It does not automatically merge different share classes, ADRs and local listings into one company.

Identity priority:

1. ISIN.
2. MIC + ticker.
3. Ticker + country + currency.
4. Conservatively normalized security name.

Rules:

- High-confidence identities merge automatically.
- Low-confidence identities remain separate or appear as Unmapped.
- Never aggressively merge solely because names look similar.
- Identity is separate from display metadata.
- Conflicting sector/country metadata is reported as `Mixed/Conflicting` rather than silently selected.
- Display name prefers the Wealthfolio asset profile, then the highest-confidence provider source.

Users may create reversible alias mappings. A mapping is scoped to provider, ETF and original identifier so it cannot accidentally affect unrelated holdings.

## 15. ETF Provider Architecture

Use adapters. Provider-specific parsing must not enter the exposure engine.

```typescript
interface EtfHoldingsProvider {
  id: string;
  canHandle(etf: EtfAsset): Promise<boolean>;
  fetchHoldings(etf: EtfAsset): Promise<EtfHoldingsSnapshot>;
}
```

Resolver order:

```text
Valid cached snapshot
        ↓ missing or expired
Pinned user/manual choice
        ↓
Issuer adapter
        ↓
Alpha Vantage
        ↓
Manual CSV
        ↓
Unsupported/Opaque ETF
```

Provider modes:

- `Auto`: follow resolver order.
- `Pinned`: use only the selected provider and its cache; never silently change source.

Initial adapters:

- iShares official holdings data.
- Betashares official holdings data.
- Alpha Vantage `ETF_PROFILE` where supported.
- Manual CSV universal fallback.

Future adapters may include Vanguard AU/US, Global X Australia, VanEck Australia, State Street/SPDR and Invesco.

## 16. Provider Request Rules

All requests use Wealthfolio's network API and declared HTTPS hosts. The implementation must operate within host constraints, including request timeout, response-size limit and redirect restrictions.

- Maximum ETF refresh concurrency: 2.
- Refresh only missing or TTL-expired automatic snapshots.
- `401/403`: stop automatic requests for that provider and ask the user to fix the key.
- `429`: stop the provider queue and honor retry guidance or exponential backoff.
- `5xx/timeout`: retry at most once in the current user action, then use cache.
- A provider response that exceeds host limits is a provider failure.
- Do not bypass `ctx.api.network.request`.

Docker DNS, proxy, firewall and outbound TLS configuration remain deployment concerns. The addon provides a concise host-specific error but does not reconfigure Docker networking.

## 17. Snapshot Validation

Processing order:

```text
Fetch
→ Parse provider format
→ Normalize fields and weight units
→ Validate identities and weights
→ Build complete candidate snapshot
→ Atomically publish index/version
→ Remove superseded chunks
```

Weight policy:

- Sum from 98% through 100%: accept and preserve the missing portion as residual.
- Sum above 100% through 100.5%: proportionally normalize to 100% and mark `normalized`.
- Sum below 98% or above 100.5%: reject the new automatic snapshot.
- A rejected candidate never overwrites the last valid snapshot.

Do not unconditionally normalize underweight data, because doing so would hide missing constituents.

## 18. ETF Cache and Persistence

- Constituent TTL: 24 hours based on `fetchedAt`.
- Store `asOfDate` and `fetchedAt` separately.
- Internal timestamps use ISO UTC; UI uses the browser's local timezone.
- Weekend and issuer reporting delays affect `asOfDate`, not fetch-cache validity.

Freshness guidance:

```text
≤ 24 hours fetched age     Fresh
> 24 hours                 Stale
> 7 days                   Warning
> 30 days                  Critical
```

Old data remains usable with visible status until the user disables or replaces it.

Because addon storage limits each value to roughly 250KB:

- Store each ETF independently.
- Chunk large normalized snapshots.
- Maintain a small versioned index per ETF.
- Avoid shared read-modify-write blobs.
- Keep only the current valid snapshot plus recent failure metadata.
- Store no long-term raw provider response.

Automated snapshot publication must not overwrite a newer Manual snapshot. Before modifying Manual data, compare the loaded version with the current version and reject conflicting last-write-wins edits.

## 19. Manual CSV

Manual CSV is the universal fallback and is required in v1.

Supported input paths for self-hosted Web:

1. Browser file input plus `FileReader`, subject to a real Docker spike.
2. Paste CSV text, which is mandatory and must work even if browser file selection does not.

`ctx.api.files.openCsvDialog()` is not relied upon because the Wealthfolio 3.7 Web adapter returns `null`.

Schema:

```csv
symbol,name,weight,isin,mic,country,currency,sector,assetClass
NVDA,NVIDIA Corp,0.084,US67066G1040,XNAS,US,USD,Technology,Equity
```

Required:

- `symbol` or `name`.
- `weight`.

Optional:

- `isin`, `mic`, `country`, `currency`, `sector`, `assetClass`.

Weight input:

- `0.084` is accepted as a fractional weight.
- `8.4%` is accepted as a percentage.
- Bare `8.4` defaults to 8.4% but must be called out in the preview.

Before saving, show:

- Parsed rows.
- Detected unit.
- Weight sum.
- Missing fields.
- Duplicate or conflicting identities.
- Residual or normalization outcome.

ETF Data must also export the normalized Manual dataset as CSV. Users are responsible for exporting Manual data before uninstalling the addon; v1 does not add an external backup service.

## 20. Recursive Look-through

Support an ETF holding another ETF.

```text
ETF A → ETF B → Stock

effective weight = weight(A→B) × weight(B→Stock)
```

Rules:

- Maximum recursion depth: 3.
- Track visited `etfKey` values for cycle detection.
- On cycle, depth limit or missing nested snapshot, stop expansion.
- Preserve the unresolved amount as an opaque ETF exposure.
- Fetch a missing nested snapshot through the same resolver, TTL and rate-limit rules.

## 21. Exposure Engine

For direct security `j` and ETF `i`:

```text
E(j) = DirectAUD(j) + Σ [ETFValueAUD(i) × effectiveWeight(i→j)]

ExposureWeight(j) = E(j) / TotalPortfolioAUD
```

Underlying constituent currency is identity/metadata only. Do not convert it again: the calculation allocates the ETF's already-converted AUD value by weight.

The engine must preserve all value through these buckets:

- Canonical stock/security exposure.
- Cash by currency.
- Fixed Income.
- Derivatives.
- Other Fund.
- Unclassified.
- ETF-specific residual.
- Opaque/unsupported ETF.

Non-equity constituents must never be discarded or mislabeled as companies.

For each final exposure, retain source contributions:

- Direct holdings, with account-level detail.
- ETF-derived amounts, grouped by ETF with optional account detail.
- Residual or opaque origin.

## 22. Value Conservation

Using unrounded internal values:

```text
sum(True Exposure, including cash and residual buckets)
≈ Total supported Portfolio AUD value
```

The engine must never allow missing constituent data to make portfolio value disappear.

Internal calculations use full JavaScript numeric precision. Display:

- Currency amounts to two decimal places.
- Percentages to one decimal place.

UI rounding differences must not be repaired by inventing a balancing asset.

## 23. Look-through Coverage

Coverage measures how much eligible investable value has resolved look-through data.

```text
covered value = direct supported securities
              + resolved ETF constituent value

eligible value = direct supported securities
               + total supported ETF value

coverage = covered value / eligible value
```

Rules:

- Cash is excluded from both numerator and denominator.
- A 96% resolved ETF contributes 96% of its value to the numerator and 100% to the denominator.
- Unsupported and opaque ETF value remains in the denominator.
- Unsupported currencies and unvalued holdings make the portfolio incomplete and are disclosed separately.
- True Exposure still includes cash and therefore reconciles to total supported portfolio value.

## 24. X-Ray Page

Columns:

```text
Ticker
Security / Bucket
Direct
Via ETFs
Total Exposure
Portfolio %
Sources
Sector
Country
Status
```

Example:

```text
NVDA   NVIDIA    A$3,000   A$1,100   A$4,100   8.2%   3   Technology   US
```

Selecting Sources displays:

```text
NVDA Exposure                    A$4,100

Direct
  IBKR                           A$2,000
  Stake                          A$1,000

Via ETFs
  IVV                              A$800
  SPMO                             A$300
```

The same canonical security appears once in the X-Ray table.

## 25. ETF Data Page

Columns:

```text
ETF
Provider
Holdings
As Of
Fetched
Resolved Weight
Status
```

Actions:

```text
Refresh
Change Provider / Auto
Import or Paste CSV
Export CSV
View Holdings
Disable Snapshot
```

Status must distinguish Fresh, Stale, Warning, Critical, Missing, Invalid and Unsupported.

## 26. Settings

Settings contains only addon-owned configuration:

- Included Wealthfolio accounts.
- Twelve Data API key.
- Alpha Vantage API key.
- Per-ETF provider mode and type/identity overrides where necessary.
- Whether live FX polling is enabled while the page is visible.

Secrets are saved through `ctx.api.secrets`. Addon preferences are saved through `ctx.api.storage`.

Do not store secrets in source code, `.env` inside the addon, localStorage, sessionStorage or plain JSON. In self-hosted mode, Wealthfolio controls encryption and persistence through its configured secret store.

Missing provider keys do not block the addon:

- FX falls back to Wealthfolio.
- Providers needing a key are skipped in Auto mode.
- Issuer adapters, cached data and Manual CSV remain available.

## 27. Privacy and Security

The following must never be sent to ETF or FX providers:

- Account ID or name.
- Quantity owned.
- Market value.
- Cost basis.
- Transactions.
- Portfolio total.

External requests may contain only what is required to retrieve public data, such as:

- `USD/AUD`.
- ETF symbol or public identifier.
- Provider API authentication.

Use only `ctx.api.network.request`. Every remote HTTPS host must be declared and approved. Do not attempt direct fetches or access internal/private network addresses.

## 28. Manifest Capabilities

Use the exact Wealthfolio 3.7 manifest schema. Permission entries are objects with category, functions and purpose; they are not YAML-like method lists.

Required host capabilities are expected to include:

```text
accounts.getAll
portfolio.getHoldings
assets.getProfile
settings.get                # verify Wealthfolio base currency is AUD
currency.getAll             # Wealthfolio FX fallback
network.request
secrets.get/set/delete
events.portfolio.onUpdateComplete
events.market.onSyncComplete
navigation.navigate         # open /performance
storage.get/set/delete       # baseline API, not a manifest permission
```

Do not request performance calculation permissions because the addon only navigates to Wealthfolio's native Performance page.

Initial network allowlist:

```text
api.twelvedata.com
www.alphavantage.co
www.ishares.com
www.betashares.com.au
```

Confirm exact issuer download hosts during adapter implementation and add only hosts actually used.

Event listeners return unlisten callbacks and must be cleaned up when the addon is disabled or unmounted. Events invalidate addon-derived queries and calculations; they do not change Core behaviour.

## 29. Self-hosted Web/Docker Requirements

v1 release support is limited to the official Wealthfolio self-hosted Docker deployment.

Required verification:

- Addon installation and persistence through container restart.
- Storage persistence and schema migration.
- Wealthfolio secret-store configuration.
- Server-side outbound provider requests.
- Manual CSV paste flow.
- Browser file input spike.
- Events and navigation.
- Installable ZIP loading.

Reverse-proxy authentication, TLS and custom container networking are deployment responsibilities, not addon features.

## 30. Failure Behaviour

Every provider failure follows this order:

```text
1. Keep the last valid snapshot/quote.
2. Mark it with the correct freshness state.
3. Show provider, data date and fetch timestamp.
4. Show a concise failure reason.
5. Preserve portfolio value through residual or opaque buckets.
6. Never silently return zero.
```

No new candidate may replace valid cached data until fetch, parsing and validation all succeed.

## 31. Project Structure

```text
portfolio-xray/
├── manifest.json
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── addon.tsx
│   ├── pages/
│   │   ├── OverviewPage.tsx
│   │   ├── HoldingsPage.tsx
│   │   ├── XRayPage.tsx
│   │   ├── EtfDataPage.tsx
│   │   └── SettingsPage.tsx
│   ├── components/
│   ├── domain/
│   │   ├── portfolio.ts
│   │   ├── exposure.ts
│   │   ├── identifiers.ts
│   │   └── currency.ts
│   ├── services/
│   │   ├── wealthfolio/
│   │   ├── fx/
│   │   └── etf/
│   ├── storage/
│   │   ├── settings.ts
│   │   ├── migrations.ts
│   │   └── etfCache.ts
│   └── types/
└── tests/
    ├── unit/
    ├── integration/
    ├── privacy/
    ├── fixtures/
    └── docker-smoke/
```

## 32. Testing Strategy

### Unit tests

- AUD/USD conversion.
- Account selection and holding normalization.
- Cash classification.
- Long-only validation.
- Identity resolution and aliases.
- Direct plus indirect exposure merging.
- Recursive ETFs, depth limit and cycle detection.
- Residual, opaque and non-equity buckets.
- Snapshot weight validation and normalization.
- Coverage numerator and denominator.
- Full value conservation.
- Storage chunking and snapshot publication.

### Provider contract tests

- Use committed, sanitized response fixtures.
- Test header detection and schema changes.
- Test timeout, oversized response, redirect, 401, 429 and 5xx handling.
- Live provider tests are optional diagnostics, not deterministic CI gates.

### Privacy tests

Inspect every external request and verify it never includes:

```text
accountId
accountName
quantity
marketValue
costBasis
transactions
portfolioTotal
```

### Docker smoke tests

- Install the bundle in official Wealthfolio Docker.
- Configure secrets.
- Read multiple accounts and cash holdings.
- Fetch FX and one automatic ETF snapshot.
- Import Manual CSV by pasted text.
- Restart and verify settings/snapshots survive.
- Navigate to `/performance`.

## 33. Acceptance Tests

### A — Currency

```text
US$1,000 × 1.50 = A$1,500
```

### B — Mixed portfolio

```text
NVDA direct                         A$1,500
IVV A$3,000 × 8%                      A$240
NDQ.AX A$1,000 × 8.4%                  A$84
Expected NVDA exposure             A$1,824
```

### C — Instrument allocation

Using unrounded values:

```text
sum(Instrument Allocation) = 100% ± 0.1%
```

### D — X-Ray conservation

Including cash, non-equity, residual and opaque buckets:

```text
sum(True Exposure) = supported Portfolio AUD value ± 0.5%
```

### E — Duplicate exposure

Direct NVDA plus NVDA through three ETFs appears once, with every direct account and ETF contribution available in Sources.

### F — Unsupported ETF

An unsupported ETF:

- Remains in Portfolio Total.
- Appears as Opaque ETF exposure.
- Reduces Coverage.
- Never disappears.

### G — Partial ETF

An ETF with 96% known weight produces a 4% ETF-specific residual and preserves 100% of its value.

### H — Recursive ETF

Nested weights multiply correctly; cycles and depth overflow stop safely and become opaque exposure.

### I — Provider failure

The previous valid snapshot remains active, is marked stale, and shows its timestamps and failure reason.

### J — Missing FX or price

Native values remain visible, zero is never substituted, and incomplete totals do not produce authoritative percentages.

### K — Unsupported portfolio

Negative quantity or cash blocks X-Ray percentages and identifies the unsupported rows.

### L — Privacy

External requests contain no personal portfolio or account data.

### M — Persistence

Settings, aliases, Manual datasets and valid caches survive a Wealthfolio container restart.

## 34. Implementation Order

```text
Phase 1 — Contract and shell
Addon scaffold for Wealthfolio 3.7
→ Manifest/routes/sidebar
→ Accounts, holdings, profiles and cash normalization
→ Selected-account Holdings page

Phase 2 — Current AUD view
Twelve Data + Wealthfolio FX fallback
→ AUD valuation
→ Instrument Allocation
→ incomplete/stale states

Phase 3 — Generic look-through
ETF domain model
→ snapshot validation/cache
→ Manual CSV paste/import/export
→ recursive exposure engine
→ value-conservation tests

Phase 4 — Automatic providers
Alpha Vantage
→ iShares
→ Betashares
→ resolver, limits and backoff

Phase 5 — X-Ray experience
Overview
→ X-Ray table
→ source drill-down
→ Coverage and warning states
→ native Performance navigation

Phase 6 — Release
Privacy tests
→ official Docker smoke tests
→ restart/persistence verification
→ production build
→ installable addon ZIP
```

Do not begin with every ETF issuer. Portfolio normalization, live FX, Manual CSV, the generic exposure engine and value conservation must be correct before expanding automatic adapters.

## 35. Definition of Done

Implementation is complete only when:

- [ ] It installs on official Wealthfolio self-hosted Web/Docker 3.7.x.
- [ ] It reads and filters multiple Wealthfolio accounts without modifying them.
- [ ] AUD and USD holdings and cash are valued consistently in AUD.
- [ ] Live USD/AUD displays its source and freshness and falls back safely.
- [ ] Holdings remain auditable by account.
- [ ] Instrument Allocation is correct and distinct from True Exposure.
- [ ] Automatic and Manual ETF constituent sources produce the same normalized model.
- [ ] Manual CSV paste and export work in Web/Docker.
- [ ] Direct and indirect exposure to the same security is merged once.
- [ ] Recursive ETFs, cycles and residual values are handled safely.
- [ ] Cash, non-equity constituents and opaque ETFs preserve total value.
- [ ] Coverage follows the approved eligible-value formula.
- [ ] Every source, provider, as-of date, fetch time and stale state is visible.
- [ ] Missing data never silently becomes zero.
- [ ] Unsupported currencies and long/short violations produce explicit incomplete/unsupported states.
- [ ] Benchmark comparison remains entirely inside Wealthfolio's native Performance page.
- [ ] No personal portfolio data is sent to external providers.
- [ ] Storage is versioned, chunked and safe against failed snapshot replacement.
- [ ] Settings and snapshots survive a container restart.
- [ ] Unit, provider, privacy and Docker smoke tests pass.
- [ ] Production build generates a valid installable addon ZIP.

