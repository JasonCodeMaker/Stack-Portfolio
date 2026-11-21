import type { ActivityImport, QuoteMode } from "@wealthfolio/addon-sdk";

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
