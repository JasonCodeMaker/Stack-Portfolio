import type {
  ActivityBulkMutationResult,
  ActivityCreate,
  ActivityDetails,
  ActivityImport,
  BrokerAccountMapping,
  BrokerActivity,
  BrokerId,
  QuoteMode,
  SyncCandidate,
  SyncPreview,
  SyncRunResult,
} from "./types";
import { IBKR_TRADE_DATE_REVISION } from "./ibkrFlex";

const IMPORTED_KEYS_STORAGE = "sync.imported-record-keys.v3";
const SOURCE_LINK_PREFIX = "sync.source-link.v1:";

export interface SyncHost {
  checkImport(activities: ActivityImport[]): Promise<ActivityImport[]>;
  getActivities(accountId: string): Promise<ActivityDetails[]>;
  saveActivities(creates: ActivityCreate[], updates?: ActivityCreate[]): Promise<ActivityBulkMutationResult>;
  updatePortfolio(): Promise<void>;
  loadImportedKeys(): Promise<Set<string>>;
  saveImportedKeys(keys: Set<string>): Promise<void>;
}

export interface BrokerSource {
  fetch(broker: BrokerId): Promise<BrokerActivity[]>;
}

type ImportedKeyHost = Pick<SyncHost, "loadImportedKeys" | "saveImportedKeys">;

export function sourceKey(activity: BrokerActivity, accountId: string): string {
  const base = legacySourceKey(activity, accountId);
  return activity.importRevision ? `${base}:${activity.importRevision}` : base;
}

function legacySourceKey(activity: BrokerActivity, accountId: string): string {
  return `${activity.broker}:${accountId}:${activity.brokerRecordId}`;
}

function numericEqual(left: number | string | null | undefined, right: string | null): boolean {
  if (left === undefined || left === null) return right === null;
  if (right === null) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && Math.abs(leftNumber - rightNumber) < 1e-9;
}

function sameExactRecord(activity: ActivityImport, existing: ActivityDetails): boolean {
  if (!activity.date) return false;
  const activityDate = activity.date instanceof Date ? activity.date : new Date(activity.date);
  const existingDate = existing.date instanceof Date ? existing.date : new Date(existing.date);
  const activityAssetId = activity.assetId?.trim() || undefined;
  const existingAssetId = existing.assetId?.trim() || undefined;
  const activitySymbol = activity.symbol?.trim().toUpperCase() || undefined;
  const existingSymbol = existing.assetSymbol?.trim().toUpperCase() || undefined;

  return activity.accountId === existing.accountId
    && activity.activityType === existing.activityType
    && (activity.subtype?.trim() || undefined) === (existing.subtype?.trim() || undefined)
    && activity.currency?.toUpperCase() === existing.currency.toUpperCase()
    && activityDate.getTime() === existingDate.getTime()
    && (activityAssetId ? activityAssetId === existingAssetId : activitySymbol === existingSymbol)
    && numericEqual(activity.quantity, existing.quantity)
    && numericEqual(activity.unitPrice, existing.unitPrice)
    && numericEqual(activity.amount, existing.amount)
    && numericEqual(activity.fee, existing.fee)
    && numericEqual(activity.tax, existing.tax ?? null)
    && numericEqual(activity.fxRate, existing.fxRate ?? null)
    && (activity.comment ?? "").trim() === (existing.comment ?? "").trim();
}

function brokerRecordProvenance(metadata: Record<string, unknown> | undefined): { broker: string; recordId: string } | undefined {
  const value = metadata?.brokerSync;
  if (!value || typeof value !== "object") return undefined;
  const broker = "broker" in value && typeof value.broker === "string" ? value.broker : undefined;
  const recordId = "recordId" in value && typeof value.recordId === "string" ? value.recordId : undefined;
  return broker && recordId ? { broker, recordId } : undefined;
}

function brokerRecordIdentity(metadata: Record<string, unknown> | undefined): string | undefined {
  const provenance = brokerRecordProvenance(metadata);
  return provenance ? `${provenance.broker.toLowerCase()}:${provenance.recordId}` : undefined;
}

function existingBrokerRecordIdentity(existing: ActivityDetails): string | undefined {
  const metadataIdentity = brokerRecordIdentity(existing.metadata);
  if (metadataIdentity) return metadataIdentity;
  return existing.sourceSystem && existing.sourceRecordId
    ? `${existing.sourceSystem.toLowerCase()}:${existing.sourceRecordId}`
    : undefined;
}

function sameBrokerRecord(candidate: SyncCandidate, existing: ActivityDetails): boolean {
  const candidateIdentity = brokerRecordIdentity(candidate.metadata);
  return Boolean(candidateIdentity && candidateIdentity === existingBrokerRecordIdentity(existing));
}

function hasBrokerRecordConflict(candidate: SyncCandidate, existing: ActivityDetails): boolean {
  const candidateIdentity = brokerRecordIdentity(candidate.metadata);
  const existingIdentity = existingBrokerRecordIdentity(existing);
  return Boolean(candidateIdentity && existingIdentity && candidateIdentity !== existingIdentity);
}

function sourceLinkPrefix(sourceKey: string): string {
  return `${SOURCE_LINK_PREFIX}${encodeURIComponent(sourceKey)}:`;
}

export function linkedActivityId(keys: Set<string>, sourceKey: string): string | undefined {
  const prefix = sourceLinkPrefix(sourceKey);
  const link = [...keys].find((key) => key.startsWith(prefix));
  if (!link) return undefined;
  try {
    return decodeURIComponent(link.slice(prefix.length));
  } catch {
    return undefined;
  }
}

function saveSourceLink(keys: Set<string>, sourceKey: string, activityId: string): void {
  const prefix = sourceLinkPrefix(sourceKey);
  for (const key of keys) if (key.startsWith(prefix)) keys.delete(key);
  keys.add(`${prefix}${encodeURIComponent(activityId)}`);
}

function sameMigrationRecord(activity: ActivityImport, existing: ActivityDetails): boolean {
  const activityDate = activity.date instanceof Date ? activity.date : new Date(activity.date ?? "");
  const existingDate = existing.date instanceof Date ? existing.date : new Date(existing.date);
  return activity.accountId === existing.accountId
    && activity.currency?.toUpperCase() === existing.currency.toUpperCase()
    && activityDate.getTime() === existingDate.getTime()
    && numericEqual(activity.amount, existing.amount)
    && (activity.comment ?? "").trim() === (existing.comment ?? "").trim();
}

function migrationError(activity: ActivityImport, message: string): ActivityImport {
  return {
    ...activity,
    duplicateOfId: undefined,
    isValid: false,
    errors: { ...activity.errors, migration: [message] },
  };
}

export async function resetImportedKeysForMappings(
  host: ImportedKeyHost,
  mappings: BrokerAccountMapping,
): Promise<number> {
  const prefixes = (Object.entries(mappings) as Array<[BrokerId, string]>)
    .filter(([, accountId]) => Boolean(accountId))
    .map(([broker, accountId]) => `${broker}:${accountId}:`);
  if (prefixes.length === 0) return 0;

  const importedKeys = await host.loadImportedKeys();
  const remaining = new Set([...importedKeys].filter((key) => !prefixes.some((prefix) => key.startsWith(prefix))));
  const removed = importedKeys.size - remaining.size;
  if (removed > 0) await host.saveImportedKeys(remaining);
  return removed;
}

export function toActivityImport(activity: BrokerActivity, accountId: string, lineNumber: number): ActivityImport {
  return {
    accountId,
    activityType: activity.activityType,
    date: activity.date,
    symbol: activity.symbol,
    symbolName: activity.symbolName,
    exchangeMic: activity.exchangeMic,
    quoteCcy: activity.quoteCcy,
    instrumentType: activity.instrumentType,
    quoteMode: activity.quoteMode,
    providerId: activity.providerId,
    providerSymbol: activity.providerSymbol,
    quantity: activity.quantity,
    unitPrice: activity.unitPrice,
    amount: activity.amount,
    fee: activity.fee,
    tax: activity.tax,
    currency: activity.currency,
    comment: activity.comment,
    isValid: true,
    isDraft: false,
    lineNumber,
  };
}

export function toActivityCreate(
  activity: ActivityImport,
  tempId: string,
  extras?: Pick<SyncCandidate, "sourceGroupId" | "metadata"> & Partial<Pick<SyncCandidate, "sourceKey">>,
): ActivityCreate {
  if (!activity.accountId) throw new Error("Validated activity is missing an account ID.");
  if (!activity.date) throw new Error("Validated activity is missing a date.");

  const symbol = activity.symbol?.trim();
  const rawQuoteMode = activity.quoteMode?.trim().toUpperCase();
  const quoteMode: QuoteMode | undefined = rawQuoteMode === "MARKET" || rawQuoteMode === "MANUAL"
    ? rawQuoteMode
    : undefined;
  const provenance = brokerRecordProvenance(extras?.metadata);
  const create: ActivityCreate = {
    id: tempId,
    accountId: activity.accountId,
    activityType: activity.activityType,
    subtype: activity.subtype,
    activityDate: activity.date,
    sourceGroupId: extras?.sourceGroupId ? `${extras.sourceGroupId}:${activity.accountId}` : undefined,
    asset: symbol ? {
      symbol,
      exchangeMic: activity.exchangeMic,
      name: activity.symbolName,
      quoteMode,
      quoteCcy: activity.quoteCcy ?? activity.currency,
      instrumentType: activity.instrumentType,
      providerId: activity.providerId,
      providerSymbol: activity.providerSymbol,
    } : undefined,
    quantity: activity.quantity,
    unitPrice: activity.unitPrice,
    amount: activity.amount,
    currency: activity.currency,
    fee: activity.fee,
    tax: activity.tax,
    comment: activity.comment,
    fxRate: activity.fxRate,
    metadata: extras?.metadata,
    sourceSystem: provenance?.broker.toUpperCase(),
    sourceRecordId: provenance?.recordId,
    idempotencyKey: extras?.sourceKey ? `broker-sync:${extras.sourceKey}` : undefined,
  };
  return create;
}

export async function previewSync(
  source: BrokerSource,
  host: SyncHost,
  mappings: BrokerAccountMapping,
): Promise<SyncPreview> {
  const enabled = (Object.entries(mappings) as Array<[BrokerId, string]>).filter(([, accountId]) => Boolean(accountId));
  const batches = await Promise.all(enabled.map(async ([broker, accountId]) => ({
    broker,
    accountId,
    activities: await source.fetch(broker),
  })));
  const importedKeys = await host.loadImportedKeys();
  const fetched = batches.reduce((total, batch) => total + batch.activities.length, 0);
  const candidates: SyncCandidate[] = [];
  const seenSourceIdentities = new Set<string>();

  for (const batch of batches) {
    for (const activity of batch.activities) {
      const key = sourceKey(activity, batch.accountId);
      const identity = legacySourceKey(activity, batch.accountId);
      if (seenSourceIdentities.has(identity)) {
        throw new Error("The broker response contains a duplicate broker record identity; the sync was stopped before writing activities.");
      }
      seenSourceIdentities.add(identity);
      if (importedKeys.has(key)) continue;
      const legacyImported = Boolean(activity.importRevision && importedKeys.has(legacySourceKey(activity, batch.accountId)));
      candidates.push({
        sourceKey: key,
        activity: toActivityImport(activity, batch.accountId, candidates.length + 1),
        sourceGroupId: activity.sourceGroupId,
        metadata: {
          ...activity.metadata,
          brokerSync: { broker: activity.broker, recordId: activity.brokerRecordId },
        },
        importRevision: activity.importRevision,
        legacyImported,
        linkedActivityId: linkedActivityId(importedKeys, key),
      });
    }
  }

  const candidateByLine = new Map(candidates.map((candidate) => [candidate.activity.lineNumber, candidate]));
  let checked = candidates.length ? await host.checkImport(candidates.map((candidate) => candidate.activity)) : [];
  checked = checked.map((activity) => {
    if (!activity.duplicateOfLineNumber) return activity;
    const candidate = candidateByLine.get(activity.lineNumber);
    const duplicate = candidateByLine.get(activity.duplicateOfLineNumber);
    return candidate && duplicate && candidate.sourceKey !== duplicate.sourceKey
      ? { ...activity, duplicateOfLineNumber: undefined }
      : migrationError(activity, `The ledger matched this row to line ${activity.duplicateOfLineNumber} in the same import batch; no duplicate was created.`);
  });
  const fallbackCandidates = checked.filter((activity) => activity.isValid && (
    !activity.duplicateOfId || Boolean(candidateByLine.get(activity.lineNumber)?.linkedActivityId)
  ));
  if (fallbackCandidates.length > 0) {
    const accountIds = [...new Set(fallbackCandidates.map((activity) => activity.accountId))];
    const existingByAccount = new Map(await Promise.all(accountIds.map(async (accountId) => [
      accountId,
      await host.getActivities(accountId),
    ] as const)));
    checked = checked.map((activity) => {
      if (!activity.isValid) return activity;
      const candidate = candidateByLine.get(activity.lineNumber);
      if (!candidate) return activity;
      const existing = existingByAccount.get(activity.accountId) ?? [];
      const linked = candidate.linkedActivityId
        ? existing.find((item) => item.id === candidate.linkedActivityId)
        : undefined;
      if (linked) {
        if (hasBrokerRecordConflict(candidate, linked)) {
          return migrationError(activity, "The stored source link points to a different broker record; no duplicate was created.");
        }
        candidate.preserveExisting = Boolean(linked.isUserModified);
        return { ...activity, duplicateOfId: linked.id };
      }
      if (activity.duplicateOfId) return activity;
      const identityMatches = existing.filter((item) => sameBrokerRecord(candidate, item));
      if (identityMatches.length > 1) {
        return migrationError(activity, "Multiple ledger activities have the same broker identity; no duplicate was created.");
      }
      if (identityMatches.length === 1) {
        const match = identityMatches[0];
        candidate.preserveExisting = Boolean(match.isUserModified);
        return { ...activity, duplicateOfId: match.id };
      }
      const matches = existing
        .filter((item) => sameExactRecord(activity, item))
        .filter((item) => !hasBrokerRecordConflict(candidate, item));
      if (matches.length > 1) {
        return migrationError(activity, "Multiple exact ledger activities match this broker record; no duplicate was created.");
      }
      if (matches.length === 0) return activity;
      candidate.preserveExisting = Boolean(matches[0].isUserModified);
      return { ...activity, duplicateOfId: matches[0].id };
    });
  }
  const reportedDuplicates = checked.filter((activity) => activity.isValid && Boolean(activity.duplicateOfId));
  if (reportedDuplicates.length > 0) {
    const accountIds = [...new Set(reportedDuplicates.map((activity) => activity.accountId))];
    const existingByAccount = new Map(await Promise.all(accountIds.map(async (accountId) => [
      accountId,
      await host.getActivities(accountId),
    ] as const)));
    checked = checked.map((activity) => {
      if (!activity.isValid || !activity.duplicateOfId) return activity;
      const candidate = candidateByLine.get(activity.lineNumber);
      const existing = (existingByAccount.get(activity.accountId) ?? [])
        .find((item) => item.id === activity.duplicateOfId);
      if (!existing) {
        return migrationError(activity, "The matching ledger activity no longer exists; no duplicate was created.");
      }
      if (candidate && hasBrokerRecordConflict(candidate, existing)) {
        return { ...activity, duplicateOfId: undefined };
      }
      if (!existing.isUserModified) return activity;
      const trustedIdentity = candidate && (
        candidate.linkedActivityId === existing.id
        || sameBrokerRecord(candidate, existing)
        || sameExactRecord(activity, existing)
      );
      if (!trustedIdentity) {
        return migrationError(activity, "The matching ledger activity was edited by the user and was not overwritten.");
      }
      candidate.preserveExisting = true;
      return activity;
    });
  }
  const migrationCandidates = candidates.filter((candidate) => Boolean(candidate.importRevision));
  if (migrationCandidates.length > 0) {
    const accountIds = [...new Set(migrationCandidates.map((candidate) => candidate.activity.accountId))];
    const existingByAccount = new Map(await Promise.all(accountIds.map(async (accountId) => [
      accountId,
      await host.getActivities(accountId),
    ] as const)));
    checked = checked.map((activity) => {
      const candidate = candidateByLine.get(activity.lineNumber);
      if (!activity.isValid || !candidate?.importRevision) return activity;
      if (candidate.preserveExisting) return activity;
      const existing = existingByAccount.get(activity.accountId) ?? [];

      if (candidate.importRevision === IBKR_TRADE_DATE_REVISION) {
        const match = existing.find((item) => item.id === activity.duplicateOfId);
        if (!match && !candidate.legacyImported && !activity.duplicateOfId) return activity;
        const reported = candidate.metadata?.ibkrReportedDateTime;
        if (match && sameBrokerRecord(candidate, match) && typeof reported === "string" &&
            (sameExactRecord(activity, match) || sameExactRecord({ ...activity, date: reported + "Z" }, match))) {
          return activity;
        }
        return migrationError(activity, "The original IBKR execution could not be verified for a trade date correction.");
      }

      if (activity.duplicateOfId) {
        const duplicate = existing.find((item) => item.id === activity.duplicateOfId);
        if (duplicate && hasBrokerRecordConflict(candidate, duplicate)) {
          return candidate.legacyImported
            ? migrationError(activity, "The previously imported cash activity belongs to a different broker record and was not overwritten.")
            : { ...activity, duplicateOfId: undefined };
        }
        return duplicate?.isUserModified && !sameExactRecord(activity, duplicate)
          ? migrationError(activity, "The matching ledger activity was edited by the user and was not overwritten.")
          : activity;
      }

      const matches = existing
        .filter((item) => sameMigrationRecord(activity, item))
        .filter((item) => !hasBrokerRecordConflict(candidate, item));
      if (matches.length === 0 && !candidate.legacyImported) return activity;
      if (matches.length !== 1) {
        return migrationError(activity, "The previously imported cash activity could not be matched uniquely; no duplicate was created.");
      }
      if (matches[0].isUserModified) {
        return migrationError(activity, "The matching ledger activity was edited by the user and was not overwritten.");
      }
      return { ...activity, duplicateOfId: matches[0].id };
    });
  }
  const duplicates = checked.filter((activity) => activity.isValid && Boolean(activity.duplicateOfId)).length;
  const valid = checked.filter((activity) => activity.isValid && !activity.duplicateOfId).length;
  return {
    fetched,
    alreadyImported: fetched - candidates.length,
    candidates,
    checked,
    valid,
    invalid: checked.length - valid - duplicates,
    duplicates,
  };
}

export async function runSync(
  source: BrokerSource,
  host: SyncHost,
  mappings: BrokerAccountMapping,
  dryRun: boolean,
): Promise<SyncRunResult> {
  const preview = await previewSync(source, host, mappings);
  if (dryRun || (preview.valid === 0 && preview.duplicates === 0)) {
    return { ...preview, dryRun, imported: 0, updated: 0, failed: 0, errors: [] };
  }

  const candidateByLine = new Map(preview.candidates.map((candidate) => [candidate.activity.lineNumber, candidate]));
  const importable = preview.checked.filter((activity) => activity.isValid && !activity.duplicateOfId);
  const repairable = preview.checked.filter((activity) => activity.isValid
    && Boolean(activity.duplicateOfId)
    && !candidateByLine.get(activity.lineNumber)?.preserveExisting);
  const preserved = preview.checked.filter((activity) => activity.isValid
    && Boolean(activity.duplicateOfId)
    && candidateByLine.get(activity.lineNumber)?.preserveExisting);
  const sourceKeyByTempId = new Map<string, string>();
  const sourceKeyByActivityId = new Map<string, string>();
  const creates = importable.map((activity) => {
    const candidate = candidateByLine.get(activity.lineNumber);
    if (!candidate) throw new Error(`Cannot match validated activity line ${activity.lineNumber ?? "unknown"} to its broker record.`);
    const tempId = `broker-sync:${candidate.sourceKey}`;
    sourceKeyByTempId.set(tempId, candidate.sourceKey);
    return toActivityCreate(activity, tempId, candidate);
  });
  const updates: ActivityCreate[] = repairable.map((activity) => {
    const candidate = candidateByLine.get(activity.lineNumber);
    if (!candidate) throw new Error(`Cannot match validated activity line ${activity.lineNumber ?? "unknown"} to its broker record.`);
    const id = activity.duplicateOfId;
    if (!id) throw new Error("Duplicate activity is missing its ledger activity ID.");
    sourceKeyByActivityId.set(id, candidate.sourceKey);
    return { ...toActivityCreate(activity, id, candidate), id };
  });
  const result: ActivityBulkMutationResult = creates.length > 0 || updates.length > 0
    ? await host.saveActivities(creates, updates)
    : { created: [], updated: [], deleted: [], createdMappings: [], errors: [] };
  const imported = result.created.length;
  const updated = result.updated.length;
  const errors = result.errors.map((error) => error.message);
  if (imported > 0 || updated > 0 || preserved.length > 0) {
    const persisted = await host.loadImportedKeys();
    for (const mapping of result.createdMappings) {
      const key = mapping.tempId ? sourceKeyByTempId.get(mapping.tempId) : undefined;
      if (key) {
        persisted.add(key);
        saveSourceLink(persisted, key, mapping.activityId);
      }
    }
    for (const activity of result.updated) {
      const key = sourceKeyByActivityId.get(activity.id);
      if (key) {
        persisted.add(key);
        saveSourceLink(persisted, key, activity.id);
      }
    }
    for (const activity of preserved) {
      const candidate = candidateByLine.get(activity.lineNumber);
      if (candidate && activity.duplicateOfId) {
        persisted.add(candidate.sourceKey);
        saveSourceLink(persisted, candidate.sourceKey, activity.duplicateOfId);
      }
    }
    if (result.createdMappings.length > 0 || updated > 0 || preserved.length > 0) {
      await host.saveImportedKeys(persisted);
    }
    if (imported > 0 || updated > 0) await host.updatePortfolio();
  }
  return { ...preview, dryRun, imported, updated, failed: errors.length, errors };
}

export function importedKeysStorageKey(): string {
  return IMPORTED_KEYS_STORAGE;
}
