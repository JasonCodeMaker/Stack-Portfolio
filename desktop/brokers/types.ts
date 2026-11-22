type ActivityType =
  | "BUY" | "SELL" | "SPLIT" | "DIVIDEND" | "INTEREST" | "DEPOSIT" | "WITHDRAWAL"
  | "TRANSFER_IN" | "TRANSFER_OUT" | "FEE" | "TAX" | "CREDIT" | "ADJUSTMENT" | "UNKNOWN";

export type QuoteMode = "MARKET" | "MANUAL";

interface ActivityAmounts {
  amount?: number | string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  fee?: number | string | null;
  tax?: number | string | null;
  fxRate?: number | string | null;
}

export interface ActivityImport extends ActivityAmounts {
  accountId: string;
  activityType: ActivityType;
  currency?: string;
  subtype?: string;
  date?: Date | string;
  symbol?: string;
  assetId?: string;
  symbolName?: string;
  exchangeMic?: string;
  quoteCcy?: string;
  instrumentType?: string;
  quoteMode?: string;
  providerId?: string;
  providerSymbol?: string;
  errors?: Record<string, string[]>;
  duplicateOfId?: string;
  duplicateOfLineNumber?: number;
  isValid: boolean;
  lineNumber?: number;
  isDraft: boolean;
  comment?: string;
}

export interface ActivityDetails {
  id: string;
  accountId: string;
  activityType: ActivityType;
  currency: string;
  subtype?: string | null;
  date: string | Date;
  assetId: string;
  assetSymbol: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  fee: string | null;
  tax?: string | null;
  fxRate?: string | null;
  comment?: string;
  sourceSystem?: string;
  sourceRecordId?: string;
  isUserModified?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ActivityCreate extends ActivityAmounts {
  id: string;
  accountId: string;
  activityType: ActivityType;
  subtype?: string | null;
  activityDate: string | Date;
  sourceGroupId?: string;
  asset?: {
    symbol: string;
    exchangeMic?: string;
    name?: string;
    quoteMode?: QuoteMode;
    quoteCcy?: string;
    instrumentType?: string;
    providerId?: string;
    providerSymbol?: string;
  };
  currency?: string;
  comment?: string | null;
  metadata?: Record<string, unknown>;
  sourceSystem?: string;
  sourceRecordId?: string;
  idempotencyKey?: string;
}

export interface ActivityBulkMutationResult {
  created: Array<{ id: string }>;
  updated: Array<{ id: string }>;
  deleted: Array<{ id: string }>;
  createdMappings: Array<{ tempId?: string | null; activityId: string }>;
  errors: Array<{ message: string }>;
}

export type BrokerId = "ibkr" | "webull";

export interface BrokerActivity {
  broker: BrokerId;
  brokerRecordId: string;
  activityType: ActivityImport["activityType"];
  date: string;
  symbol: string;
  symbolName?: string;
  exchangeMic?: string;
  quoteCcy?: string;
  instrumentType?: string;
  quoteMode?: QuoteMode;
  providerId?: string;
  providerSymbol?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  fee?: number;
  tax?: number;
  currency: string;
  comment?: string;
  sourceGroupId?: string;
  metadata?: Record<string, unknown>;
  importRevision?: string;
}

export interface BrokerAccountMapping {
  ibkr: string;
  webull: string;
}

export interface SyncCandidate {
  sourceKey: string;
  activity: ActivityImport;
  sourceGroupId?: string;
  metadata?: Record<string, unknown>;
  importRevision?: string;
  legacyImported?: boolean;
  linkedActivityId?: string;
  preserveExisting?: boolean;
}

export interface SyncPreview {
  fetched: number;
  alreadyImported: number;
  candidates: SyncCandidate[];
  checked: ActivityImport[];
  valid: number;
  invalid: number;
  duplicates: number;
}

export interface SyncRunResult extends SyncPreview {
  dryRun: boolean;
  imported: number;
  updated: number;
  failed: number;
  errors: string[];
}
