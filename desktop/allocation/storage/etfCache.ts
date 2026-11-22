import type { StorageContext } from "../context";
import { validateSnapshot } from "../domain/etf";
import type { EtfCacheRecord, EtfHoldingsSnapshot } from "../domain/types";

const INDEX_KEY = "etf.index.v1";
const CHUNK_SIZE = 180_000;

interface CacheIndexEntry {
  etfKey: string;
  version: number;
  chunkCount: number;
  updatedAt: string;
  sourceMode?: "automatic" | "manual";
}

type CacheIndex = Record<string, CacheIndexEntry>;

interface ReadEntryResult {
  snapshot: EtfHoldingsSnapshot | null;
  invalid: boolean;
  failureReason?: string;
}

function safeKey(value: string): string {
  return [...value].map((character) => /[A-Za-z0-9]/.test(character) ? character : `_x${character.codePointAt(0)?.toString(16)}_`).join("");
}

function chunk(value: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < value.length; index += CHUNK_SIZE) result.push(value.slice(index, index + CHUNK_SIZE));
  return result;
}

async function readIndex(ctx: StorageContext): Promise<CacheIndex> {
  const raw = await ctx.api.storage.get(INDEX_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as CacheIndex;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeIndex(ctx: StorageContext, index: CacheIndex): Promise<void> {
  await ctx.api.storage.set(INDEX_KEY, JSON.stringify(index));
}

export class EtfCache {
  public constructor(private readonly ctx: StorageContext) {}

  public async list(): Promise<EtfCacheRecord[]> {
    const index = await readIndex(this.ctx);
    const records: EtfCacheRecord[] = [];
    for (const entry of Object.values(index)) {
      const result = await this.readEntry(entry);
      records.push({ etfKey: entry.etfKey, version: entry.version, snapshot: result.snapshot, invalid: result.invalid, failureReason: result.failureReason, updatedAt: entry.updatedAt });
    }
    return records;
  }

  public async get(etfKey: string): Promise<EtfCacheRecord | null> {
    const index = await readIndex(this.ctx);
    const entry = index[etfKey];
    if (!entry) return null;
    const result = await this.readEntry(entry);
    return { etfKey, version: entry.version, snapshot: result.snapshot, invalid: result.invalid, failureReason: result.failureReason, updatedAt: entry.updatedAt };
  }

  private async readEntry(entry: CacheIndexEntry): Promise<ReadEntryResult> {
    const prefix = `etf.snapshot.v1.${safeKey(entry.etfKey)}.${entry.version}`;
    const chunks: string[] = [];
    for (let index = 0; index < entry.chunkCount; index += 1) {
      const value = await this.ctx.api.storage.get(`${prefix}.${index}`);
      if (value === null) return { snapshot: null, invalid: true, failureReason: "Cached snapshot chunk is missing" };
      chunks.push(value);
    }
    try {
      const snapshot = JSON.parse(chunks.join("")) as EtfHoldingsSnapshot;
      const validation = validateSnapshot(snapshot);
      return validation.accepted && validation.snapshot
        ? { snapshot: validation.snapshot, invalid: false, failureReason: snapshot.failureReason }
        : { snapshot: null, invalid: true, failureReason: validation.message };
    } catch {
      return { snapshot: null, invalid: true, failureReason: "Cached snapshot could not be parsed" };
    }
  }

  public async save(
    snapshot: EtfHoldingsSnapshot,
    options: { expectedVersion?: number } = {},
  ): Promise<EtfCacheRecord> {
    const validation = validateSnapshot(snapshot);
    if (!validation.accepted || !validation.snapshot) throw new Error(validation.message);
    const index = await readIndex(this.ctx);
    const current = index[snapshot.etfKey];
    if (options.expectedVersion !== undefined && current && options.expectedVersion !== current.version) {
      throw new Error("ETF snapshot changed elsewhere; reload before saving Manual data.");
    }
    if (current?.sourceMode === "manual" && snapshot.sourceMode !== "manual") {
      throw new Error("Automatic refresh cannot overwrite a newer Manual snapshot.");
    }
    const version = (current?.version ?? 0) + 1;
    const serialized = JSON.stringify(validation.snapshot);
    const chunks = chunk(serialized);
    const prefix = `etf.snapshot.v1.${safeKey(snapshot.etfKey)}.${version}`;
    for (const [indexNumber, value] of chunks.entries()) {
      await this.ctx.api.storage.set(`${prefix}.${indexNumber}`, value);
    }
    const updatedAt = new Date().toISOString();
    index[snapshot.etfKey] = {
      etfKey: snapshot.etfKey,
      version,
      chunkCount: chunks.length,
      updatedAt,
      sourceMode: snapshot.sourceMode,
    };
    await writeIndex(this.ctx, index);
    if (current) {
      const previousPrefix = `etf.snapshot.v1.${safeKey(current.etfKey)}.${current.version}`;
      for (let indexNumber = 0; indexNumber < current.chunkCount; indexNumber += 1) {
        await this.ctx.api.storage.delete(`${previousPrefix}.${indexNumber}`);
      }
    }
    return { etfKey: snapshot.etfKey, version, snapshot: validation.snapshot, updatedAt };
  }

  public async disable(etfKey: string): Promise<void> {
    const index = await readIndex(this.ctx);
    const current = index[etfKey];
    if (!current) return;
    const prefix = `etf.snapshot.v1.${safeKey(current.etfKey)}.${current.version}`;
    for (let indexNumber = 0; indexNumber < current.chunkCount; indexNumber += 1) {
      await this.ctx.api.storage.delete(`${prefix}.${indexNumber}`);
    }
    delete index[etfKey];
    await writeIndex(this.ctx, index);
  }
}
