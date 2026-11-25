export type AssetType =
  | "stock"
  | "etf"
  | "cash"
  | "fixed-income"
  | "derivative"
  | "other"
  | "unknown";

export type HoldingStatus =
  | "valued"
  | "unsupported-currency"
  | "unvalued"
  | "unsupported-position"
  | "unknown-instrument";

export interface PortfolioAccount {
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
  isArchived: boolean;
}

export interface AssetProfile {
  id: string;
  name: string;
  symbol: string;
  mic?: string;
  isin?: string;
  instrumentKey?: string;
  instrumentType?: string;
  currency?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}

export interface HoldingInput {
  id: string;
  holdingType: "cash" | "security";
  instrument?: { id: string; symbol: string; name: string };
  quantity: number;
  localCurrency: string;
  marketValue?: { local: number | null; base: number | null };
  asOfDate?: string | null;
}

export interface NormalizedHolding {
  id: string;
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  type: AssetType;
  quantity: number;
  localCurrency: string;
  nativeValue: number | null;
  audValue: number | null;
  priceUpdatedAt: string | null;
  identityKey: string | null;
  etfKey: string | null;
  mic?: string;
  profileId: string | null;
  sector?: string;
  country?: string;
  status: HoldingStatus;
  issue?: string;
  sourceHoldingId: string;
}

export interface FxQuote {
  pair: "USD/AUD";
  rate: number;
  fetchedAt: string;
  provider: "twelvedata" | "wealthfolio";
}

export interface CurrencyValuation {
  audValue: number | null;
  supported: boolean;
  reason?: string;
}

export interface AllocationRow {
  key: string;
  label: string;
  type: AssetType;
  valueAud: number;
  weight: number | null;
  status?: string;
}

export interface PortfolioWarning {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  holdingIds?: string[];
}

export interface PortfolioModel {
  holdings: NormalizedHolding[];
  selectedAccountIds: string[];
  totalAud: number | null;
  supportedValueAud: number;
  valuedHoldingCount: number;
  incomplete: boolean;
  warnings: PortfolioWarning[];
  instrumentAllocation: AllocationRow[];
  etfs: EtfAsset[];
}

export interface EtfAsset {
  etfKey: string;
  profileId: string | null;
  symbol: string;
  name: string;
  mic?: string;
  currency?: string;
  providerSymbol?: string;
}

export interface UnderlyingHolding {
  symbol?: string;
  name: string;
  isin?: string;
  mic?: string;
  weight: number;
  country?: string;
  currency?: string;
  sector?: string;
  assetClass?: string;
  underlyingType?:
    | "stock"
    | "etf"
    | "cash"
    | "fixed-income"
    | "derivative"
    | "other";
}

export interface EtfHoldingsSnapshot {
  schemaVersion: number;
  etfKey: string;
  provider: string;
  asOfDate: string;
  fetchedAt: string;
  holdings: UnderlyingHolding[];
  weightSum: number;
  normalized: boolean;
  sourceMode?: "automatic" | "manual";
  failureReason?: string;
}

export type EtfSnapshotStatus =
  | "Fresh"
  | "Stale"
  | "Warning"
  | "Critical"
  | "Missing"
  | "Invalid"
  | "Unsupported";

export interface SnapshotValidation {
  accepted: boolean;
  snapshot?: EtfHoldingsSnapshot;
  status: "accepted" | "residual" | "normalized" | "rejected";
  message: string;
}

export interface EtfCacheRecord {
  etfKey: string;
  version: number;
  snapshot: EtfHoldingsSnapshot | null;
  updatedAt: string;
  failureReason?: string;
  invalid?: boolean;
}

export interface CsvPreview {
  rows: UnderlyingHolding[];
  detectedUnit: "fraction" | "percentage" | "bare-percentage" | "mixed";
  weightSum: number;
  missingFields: string[];
  duplicateIdentities: string[];
  issues: string[];
  validation: SnapshotValidation;
}

export interface DirectSource {
  kind: "direct";
  holdingId: string;
  accountId: string;
  accountName: string;
  amountAud: number;
}

export interface EtfSource {
  kind: "etf";
  holdingId: string;
  accountId: string;
  accountName: string;
  etfKey: string;
  etfSymbol: string;
  amountAud: number;
  path: string[];
}

export interface ResidualSource {
  kind: "residual" | "opaque";
  holdingId: string;
  accountId: string;
  accountName: string;
  etfKey: string;
  etfSymbol: string;
  amountAud: number;
  reason: string;
}

export type ExposureSource = DirectSource | EtfSource | ResidualSource;

export interface ExposureRow {
  key: string;
  ticker?: string;
  label: string;
  type: AssetType;
  directAud: number;
  viaEtfsAud: number;
  totalAud: number;
  portfolioWeight: number | null;
  sector?: string;
  country?: string;
  status?: string;
  sources: ExposureSource[];
}

export interface ExposureModel {
  rows: ExposureRow[];
  totalAud: number;
  coveredValueAud: number;
  eligibleValueAud: number;
  coverage: number | null;
  valueConservationDelta: number;
  incomplete: boolean;
}

export interface AllocationSettings {
  schemaVersion: 1;
  selectionInitialized: boolean;
  selectedAccountIds: string[];
  acknowledgedAccountIds: string[];
  providerModes: Record<string, "auto" | "pinned">;
  pinnedProviders: Record<string, string>;
  providerIdentities: Record<string, string>;
  typeOverrides: Record<string, AssetType>;
  aliases: Record<string, string>;
}

export interface RebalanceSettings {
  schemaVersion: 1;
  tolerance: number;
  targets: Record<string, number>;
}

export type RebalanceStatus = "overweight" | "underweight" | "on-target" | "unconfigured";

export interface RebalanceRow extends AllocationRow {
  targetWeight: number | null;
  drift: number | null;
  adjustmentAud: number | null;
  status: RebalanceStatus;
}

export interface RebalanceModel {
  rows: RebalanceRow[];
  configured: boolean;
  targetTotal: number;
  tolerance: number;
  needsRebalance: boolean;
  largestDrift: number | null;
}
