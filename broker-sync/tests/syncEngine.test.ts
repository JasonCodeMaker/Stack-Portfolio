import { describe, expect, it, vi } from "vitest";
import type { ActivityBulkMutationResult, ActivityCreate, ActivityDetails, ActivityImport, ActivityUpdate } from "@wealthfolio/addon-sdk";
import {
  resetImportedKeysForMappings,
  runSync,
  toActivityCreate,
  toActivityImport,
  type BrokerSource,
  type SyncHost,
} from "@/syncEngine";
import { parseWebullOrderHistory } from "@/webullOpenApi";
import type { BrokerActivity } from "@/types";

function fixture() {
  const importedKeys = new Set<string>();
  const source: BrokerSource = {
    fetch: async (broker) => [{
      broker,
      brokerRecordId: `${broker}-record-1`,
      activityType: "BUY",
      date: "2026-08-20T00:00:00.000Z",
      symbol: "AAPL",
      quantity: 1,
      unitPrice: 220,
      currency: "USD",
    }],
  };
  const host: SyncHost = {
    checkImport: vi.fn(async (activities: ActivityImport[]) => activities),
    saveActivities: vi.fn(async (activities: ActivityCreate[]) => ({
      created: activities.map((activity) => ({ id: `saved-${activity.id}` })),
      updated: [],
      deleted: [],
      createdMappings: activities.map((activity) => ({ tempId: activity.id, activityId: `saved-${activity.id}` })),
      errors: [],
    }) as unknown as ActivityBulkMutationResult),
    updatePortfolio: vi.fn(async () => undefined),
    getActivities: vi.fn(async () => []),
    loadImportedKeys: vi.fn(async () => new Set(importedKeys)),
    saveImportedKeys: vi.fn(async (keys: Set<string>) => {
      importedKeys.clear();
      keys.forEach((key) => importedKeys.add(key));
    }),
  };
  return { source, host };
}

describe("runSync", () => {
  it("previews records without writing in dry-run mode", async () => {
    const { source, host } = fixture();
    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, true);
    expect(result).toMatchObject({ fetched: 1, valid: 1, imported: 0, dryRun: true });
    expect(host.saveActivities).not.toHaveBeenCalled();
    expect(host.saveImportedKeys).not.toHaveBeenCalled();
  });

  it("imports once and skips the same broker record on the next click", async () => {
    const { source, host } = fixture();
    const first = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);
    const second = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);
    expect(first.imported).toBe(1);
    expect(second).toMatchObject({ fetched: 1, alreadyImported: 1, valid: 0, imported: 0 });
    expect(host.saveActivities).toHaveBeenCalledTimes(1);
    expect(host.updatePortfolio).toHaveBeenCalledTimes(1);
  });

  it("stores stable broker provenance on newly created activities", async () => {
    const { source, host } = fixture();

    await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(host.saveActivities).toHaveBeenCalledWith([
      expect.objectContaining({
        metadata: { brokerSync: { broker: "ibkr", recordId: "ibkr-record-1" } },
        sourceSystem: "IBKR",
        sourceRecordId: "ibkr-record-1",
        idempotencyKey: "broker-sync:ibkr:account-1:ibkr-record-1",
      }),
    ], []);
  });

  it("uses broker provenance to protect an edited activity after sync history is reset", async () => {
    const { source, host } = fixture();
    host.checkImport = vi.fn(async (activities: ActivityImport[]) => activities.map((activity) => ({
      ...activity,
      assetId: "aapl",
    })));
    host.getActivities = vi.fn(async () => [{
      id: "edited-aapl",
      accountId: "account-1",
      accountName: "IBKR Main",
      accountCurrency: "AUD",
      activityType: "BUY",
      date: new Date("2026-08-20T00:00:00.000Z"),
      quantity: "1",
      unitPrice: "221",
      amount: null,
      fee: null,
      currency: "USD",
      assetId: "aapl",
      assetSymbol: "AAPL",
      needsReview: false,
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-21T00:00:00.000Z"),
      isUserModified: true,
      metadata: { brokerSync: { broker: "ibkr", recordId: "ibkr-record-1" } },
    }] as ActivityDetails[]);

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 0, updated: 0, invalid: 0, duplicates: 1 });
    expect(host.saveActivities).not.toHaveBeenCalled();
    expect(host.saveImportedKeys).toHaveBeenCalledOnce();
  });

  it("creates a distinct broker record despite a Wealthfolio content-key collision", async () => {
    const { source, host } = fixture();
    host.checkImport = vi.fn(async (activities: ActivityImport[]) => activities.map((activity) => ({
      ...activity,
      assetId: "aapl",
      duplicateOfId: "different-broker-record",
    })));
    host.getActivities = vi.fn(async () => [{
      id: "different-broker-record",
      accountId: "account-1",
      accountName: "IBKR Main",
      accountCurrency: "AUD",
      activityType: "BUY",
      date: new Date("2026-08-20T00:00:00.000Z"),
      quantity: "1",
      unitPrice: "220",
      amount: null,
      fee: null,
      currency: "USD",
      assetId: "aapl",
      assetSymbol: "AAPL",
      needsReview: false,
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-20T00:00:00.000Z"),
      isUserModified: false,
      metadata: { brokerSync: { broker: "ibkr", recordId: "another-record" } },
    }] as ActivityDetails[]);

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 1, updated: 0, invalid: 0 });
    expect(host.saveActivities).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceRecordId: "ibkr-record-1",
        idempotencyKey: "broker-sync:ibkr:account-1:ibkr-record-1",
      }),
    ], []);
  });

  it("prefers a durable source link over an unrelated Wealthfolio content duplicate", async () => {
    const { source, host } = fixture();
    const sourceKey = "ibkr:account-1:ibkr-record-1";
    const link = `sync.source-link.v1:${encodeURIComponent(sourceKey)}:${encodeURIComponent("linked-activity")}`;
    host.loadImportedKeys = vi.fn(async () => new Set([link]));
    host.checkImport = vi.fn(async (activities: ActivityImport[]) => activities.map((activity) => ({
      ...activity,
      assetId: "aapl",
      duplicateOfId: "content-collision",
    })));
    host.getActivities = vi.fn(async () => [
      {
        id: "linked-activity",
        accountId: "account-1",
        accountName: "IBKR Main",
        accountCurrency: "AUD",
        activityType: "BUY",
        date: new Date("2026-08-20T00:00:00.000Z"),
        quantity: "1",
        unitPrice: "221",
        amount: null,
        fee: null,
        currency: "USD",
        assetId: "aapl",
        assetSymbol: "AAPL",
        needsReview: false,
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        updatedAt: new Date("2026-08-21T00:00:00.000Z"),
        isUserModified: true,
      },
      {
        id: "content-collision",
        accountId: "account-1",
        accountName: "IBKR Main",
        accountCurrency: "AUD",
        activityType: "BUY",
        date: new Date("2026-08-20T00:00:00.000Z"),
        quantity: "1",
        unitPrice: "220",
        amount: null,
        fee: null,
        currency: "USD",
        assetId: "aapl",
        assetSymbol: "AAPL",
        needsReview: false,
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        updatedAt: new Date("2026-08-20T00:00:00.000Z"),
        isUserModified: false,
      },
    ] as ActivityDetails[]);

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 0, updated: 0, invalid: 0, duplicates: 1 });
    expect(host.saveActivities).not.toHaveBeenCalled();
    const persisted = vi.mocked(host.saveImportedKeys).mock.calls.at(-1)?.[0] ?? new Set<string>();
    expect([...persisted]).toContain(sourceKey);
    expect([...persisted]).toContain(link);
  });

  it("allows the same broker record to be imported after mapping to a different Wealthfolio account", async () => {
    const { source, host } = fixture();
    const testAccount = await runSync(source, host, { ibkr: "test-account", webull: "" }, false);
    const realAccount = await runSync(source, host, { ibkr: "real-account", webull: "" }, false);

    expect(testAccount.imported).toBe(1);
    expect(realAccount.imported).toBe(1);
    expect(host.saveActivities).toHaveBeenCalledTimes(2);
  });

  it("does not import rows rejected by Wealthfolio validation", async () => {
    const { source, host } = fixture();
    host.checkImport = vi.fn(async (activities: ActivityImport[]) => activities.map((activity) => ({
      ...activity,
      isValid: false,
      errors: { symbol: ["Unknown symbol"] },
    })));
    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);
    expect(result).toMatchObject({ valid: 0, invalid: 1, imported: 0 });
    expect(host.saveActivities).not.toHaveBeenCalled();
  });

  it("reports Wealthfolio bulk-save failures without persisting their source keys", async () => {
    const { source, host } = fixture();
    host.saveActivities = vi.fn(async () => ({
      created: [],
      updated: [],
      deleted: [],
      createdMappings: [],
      errors: [{ action: "create", message: "Activity validation failed" }],
    }) as unknown as ActivityBulkMutationResult);

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 0, updated: 0, failed: 1, errors: ["Activity validation failed"] });
    expect(host.saveImportedKeys).not.toHaveBeenCalled();
    expect(host.updatePortfolio).not.toHaveBeenCalled();
  });

  it("repairs a matching Wealthfolio activity after sync history is reset", async () => {
    const { source, host } = fixture();
    source.fetch = async (broker) => [{
      broker,
      brokerRecordId: "brk-b-trade-1",
      activityType: "BUY",
      date: "2026-08-20T00:00:00.000Z",
      symbol: "BRK B",
      exchangeMic: "XNYS",
      providerId: "YAHOO",
      providerSymbol: "BRK-B",
      quantity: 1,
      unitPrice: 500,
      currency: "USD",
    }];
    host.checkImport = vi.fn(async (activities: ActivityImport[]) => activities.map((activity) => ({
      ...activity,
      duplicateOfId: "existing-activity-1",
    })));
    host.getActivities = vi.fn(async () => [{
      id: "existing-activity-1",
      accountId: "account-1",
      accountName: "IBKR Main",
      accountCurrency: "AUD",
      activityType: "BUY",
      date: new Date("2026-08-20T00:00:00.000Z"),
      quantity: "1",
      unitPrice: "500",
      amount: null,
      fee: null,
      currency: "USD",
      assetId: "existing-brk-b",
      assetSymbol: "BRK.B",
      needsReview: false,
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-20T00:00:00.000Z"),
      isUserModified: false,
    }] as ActivityDetails[]);
    host.saveActivities = vi.fn(async (_creates: ActivityCreate[], updates: ActivityUpdate[] = []) => ({
      created: [],
      updated: updates.map((activity) => ({ id: activity.id })),
      deleted: [],
      createdMappings: [],
      errors: [],
    }) as unknown as ActivityBulkMutationResult);

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ duplicates: 1, imported: 0, updated: 1 });
    expect(host.saveActivities).toHaveBeenCalledWith([], [
      expect.objectContaining({ id: "existing-activity-1", asset: expect.objectContaining({ providerSymbol: "BRK-B" }) }),
    ]);
    expect(host.saveImportedKeys).toHaveBeenCalledOnce();
    expect(host.updatePortfolio).toHaveBeenCalledOnce();
  });

  it("preserves a linked user-corrected trade across repeated sync-history resets", async () => {
    const { source, host } = fixture();
    let existingUnitPrice = "509";
    source.fetch = async (broker) => [{
      broker,
      brokerRecordId: "brk-b-trade-1",
      activityType: "BUY",
      date: "2026-08-13T00:50:42.000Z",
      symbol: "BRK.B",
      exchangeMic: "XNYS",
      providerId: "YAHOO",
      providerSymbol: "BRK-B",
      quantity: 1,
      unitPrice: 509,
      fee: 1.000003,
      tax: 0,
      currency: "USD",
      comment: "IBKR Flex trade 179216743",
    }];
    host.checkImport = vi.fn(async (activities: ActivityImport[]) => activities.map((activity) => ({
      ...activity,
      assetId: "canonical-brk-b",
      symbol: "BRK.B",
    })));
    host.getActivities = vi.fn(async () => [{
      id: "existing-user-corrected-trade",
      accountId: "account-1",
      accountName: "IBKR Main",
      accountCurrency: "AUD",
      activityType: "BUY",
      date: new Date("2026-08-13T00:50:42.000Z"),
      quantity: "1",
      unitPrice: existingUnitPrice,
      amount: null,
      fee: "1.000003",
      tax: "0",
      currency: "USD",
      comment: "IBKR Flex trade 179216743",
      assetId: "canonical-brk-b",
      assetSymbol: "BRK.B",
      needsReview: false,
      createdAt: new Date("2026-08-13T00:50:42.000Z"),
      updatedAt: new Date("2026-08-13T00:50:42.000Z"),
      idempotencyKey: "stale-key-from-retired-brk-b-asset",
      isUserModified: true,
    }] as ActivityDetails[]);

    const first = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(first).toMatchObject({ duplicates: 1, imported: 0, updated: 0, invalid: 0 });
    expect(host.saveActivities).not.toHaveBeenCalled();
    expect(host.saveImportedKeys).toHaveBeenCalledOnce();
    expect(host.updatePortfolio).not.toHaveBeenCalled();

    expect(await resetImportedKeysForMappings(host, { ibkr: "account-1", webull: "" })).toBe(1);
    existingUnitPrice = "510";
    const second = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(second).toMatchObject({ duplicates: 1, imported: 0, updated: 0, invalid: 0 });
    expect(host.saveActivities).not.toHaveBeenCalled();
    const persisted = vi.mocked(host.saveImportedKeys).mock.calls.at(-1)?.[0] ?? new Set<string>();
    expect([...persisted]).toContain("ibkr:account-1:brk-b-trade-1");
    expect([...persisted].some((key) => key.startsWith("sync.source-link.v1:"))).toBe(true);
  });

  it("does not overwrite a user-modified activity reported as a Wealthfolio duplicate", async () => {
    const { source, host } = fixture();
    host.checkImport = vi.fn(async (activities: ActivityImport[]) => activities.map((activity) => ({
      ...activity,
      assetId: "aapl",
      duplicateOfId: "user-modified-aapl",
    })));
    host.getActivities = vi.fn(async () => [{
      id: "user-modified-aapl",
      accountId: "account-1",
      accountName: "IBKR Main",
      accountCurrency: "AUD",
      activityType: "BUY",
      date: new Date("2026-08-20T00:00:00.000Z"),
      quantity: "1",
      unitPrice: "221",
      amount: null,
      fee: null,
      currency: "USD",
      assetId: "aapl",
      assetSymbol: "AAPL",
      needsReview: false,
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
      updatedAt: new Date("2026-08-21T00:00:00.000Z"),
      isUserModified: true,
    }] as ActivityDetails[]);

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 0, updated: 0, invalid: 1 });
    expect(host.saveActivities).not.toHaveBeenCalled();
    expect(host.saveImportedKeys).not.toHaveBeenCalled();
    expect(host.updatePortfolio).not.toHaveBeenCalled();
  });

  it("imports same-value batch rows when their broker identities are distinct", async () => {
    const { source, host } = fixture();
    source.fetch = async (broker) => [
      {
        broker,
        brokerRecordId: "execution-1",
        activityType: "BUY",
        date: "2026-08-20T00:00:00.000Z",
        symbol: "AAPL",
        quantity: 1,
        unitPrice: 220,
        currency: "USD",
      },
      {
        broker,
        brokerRecordId: "execution-2",
        activityType: "BUY",
        date: "2026-08-20T00:00:00.000Z",
        symbol: "AAPL",
        quantity: 1,
        unitPrice: 220,
        currency: "USD",
      },
    ];
    host.checkImport = vi.fn(async (activities: ActivityImport[]) => activities.map((activity, index) => ({
      ...activity,
      ...(index === 1 ? { duplicateOfLineNumber: 1 } : {}),
    })));

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 2, updated: 0, invalid: 0 });
    expect(host.saveActivities).toHaveBeenCalledWith([
      expect.objectContaining({ sourceRecordId: "execution-1", idempotencyKey: "broker-sync:ibkr:account-1:execution-1" }),
      expect.objectContaining({ sourceRecordId: "execution-2", idempotencyKey: "broker-sync:ibkr:account-1:execution-2" }),
    ], []);
  });

  it("rejects conflicting broker rows that reuse the same source identity", async () => {
    const { source, host } = fixture();
    source.fetch = async (broker) => [
      {
        broker,
        brokerRecordId: "reused-record-id",
        activityType: "BUY",
        date: "2026-08-20T00:00:00.000Z",
        symbol: "AAPL",
        quantity: 1,
        unitPrice: 220,
        currency: "USD",
      },
      {
        broker,
        brokerRecordId: "reused-record-id",
        activityType: "BUY",
        date: "2026-08-20T00:00:00.000Z",
        symbol: "AAPL",
        quantity: 1,
        unitPrice: 221,
        currency: "USD",
      },
    ];

    await expect(runSync(source, host, { ibkr: "account-1", webull: "" }, false))
      .rejects.toThrow(/duplicate broker record identity/i);
    expect(host.checkImport).not.toHaveBeenCalled();
    expect(host.saveActivities).not.toHaveBeenCalled();
  });

  it("rejects the same source identity even when import revisions differ", async () => {
    const { source, host } = fixture();
    source.fetch = async (broker) => [
      {
        broker,
        brokerRecordId: "reused-record-id",
        activityType: "BUY",
        date: "2026-08-20T00:00:00.000Z",
        symbol: "AAPL",
        quantity: 1,
        unitPrice: 220,
        currency: "USD",
        importRevision: "revision-1",
      },
      {
        broker,
        brokerRecordId: "reused-record-id",
        activityType: "BUY",
        date: "2026-08-20T00:00:00.000Z",
        symbol: "AAPL",
        quantity: 1,
        unitPrice: 220,
        currency: "USD",
        importRevision: "revision-2",
      },
    ];

    await expect(runSync(source, host, { ibkr: "account-1", webull: "" }, false))
      .rejects.toThrow(/duplicate broker record identity/i);
    expect(host.checkImport).not.toHaveBeenCalled();
    expect(host.saveActivities).not.toHaveBeenCalled();
  });

  it("repairs a Webull order that was already imported against the US listing", async () => {
    const { source, host } = fixture();
    source.fetch = async () => parseWebullOrderHistory([{
      client_order_id: "group-1",
      orders: [{
        order_id: "order-1",
        client_order_id: "group-1",
        symbol: "IVV",
        side: "BUY",
        status: "FILLED",
        filled_quantity: "1",
        filled_price: "71.33",
        filled_time_at: "2026-09-01T05:01:35.000Z",
      }],
    }]);
    host.loadImportedKeys = vi.fn(async () => new Set(["webull:account-2:order-1"]));
    host.getActivities = vi.fn(async () => [{
      id: "existing-ivv-buy",
      accountId: "account-2",
      accountName: "Webull Main",
      accountCurrency: "AUD",
      activityType: "BUY",
      date: new Date("2026-09-01T05:01:35.000Z"),
      quantity: "1",
      unitPrice: "71.33",
      amount: null,
      fee: "0",
      currency: "USD",
      comment: "Webull order order-1",
      assetId: "asset-us-ivv",
      assetSymbol: "IVV",
      needsReview: false,
      createdAt: new Date("2026-09-01T05:01:35.000Z"),
      updatedAt: new Date("2026-09-01T05:01:35.000Z"),
      isUserModified: false,
      sourceSystem: "WEBULL",
      sourceRecordId: "order-1",
    }] as ActivityDetails[]);
    host.saveActivities = vi.fn(async (_creates: ActivityCreate[], updates: ActivityUpdate[] = []) => ({
      created: [],
      updated: updates.map((activity) => ({ id: activity.id })),
      deleted: [],
      createdMappings: [],
      errors: [],
    }) as unknown as ActivityBulkMutationResult);

    const result = await runSync(source, host, { ibkr: "", webull: "account-2" }, false);

    expect(result).toMatchObject({ imported: 0, updated: 1, duplicates: 1 });
    expect(host.saveActivities).toHaveBeenCalledWith([], [
      expect.objectContaining({
        id: "existing-ivv-buy",
        currency: "AUD",
        asset: expect.objectContaining({
          symbol: "IVV",
          exchangeMic: "XASX",
          quoteCcy: "AUD",
          providerId: "YAHOO",
          providerSymbol: "IVV.AX",
        }),
      }),
    ]);
  });

  it("migrates a previously imported withholding dividend without creating a second cash row", async () => {
    const { source, host } = fixture();
    const comment = "ORCL CASH DIVIDEND USD 0.50000000 PER SHARE - US TAX";
    source.fetch = async () => [{
      broker: "ibkr",
      brokerRecordId: "withholding-1",
      activityType: "TAX",
      date: "2026-08-29T12:00:00Z",
      symbol: "",
      amount: 0.15,
      currency: "USD",
      comment,
      importRevision: "cash-semantics-v2",
    }];
    const legacyKey = "ibkr:account-1:withholding-1";
    host.loadImportedKeys = vi.fn(async () => new Set([legacyKey]));
    host.getActivities = vi.fn(async () => [{
      id: "existing-dividend-1",
      accountId: "account-1",
      accountName: "IBKR Main",
      accountCurrency: "AUD",
      activityType: "DIVIDEND",
      date: new Date("2026-08-29T12:00:00Z"),
      amount: "0.15",
      quantity: null,
      unitPrice: null,
      fee: null,
      currency: "USD",
      comment,
      assetId: "orcl",
      assetSymbol: "ORCL",
      needsReview: false,
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:00:00Z"),
      isUserModified: false,
    }] as ActivityDetails[]);
    host.saveActivities = vi.fn(async (_creates: ActivityCreate[], updates: ActivityUpdate[] = []) => ({
      created: [],
      updated: updates.map((activity) => ({ id: activity.id })),
      deleted: [],
      createdMappings: [],
      errors: [],
    }) as unknown as ActivityBulkMutationResult);

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 0, updated: 1, duplicates: 1 });
    expect(host.saveActivities).toHaveBeenCalledWith([], [
      expect.objectContaining({ id: "existing-dividend-1", activityType: "TAX", amount: 0.15 }),
    ]);
  });

  it("migrates withholding tax after sync history was reset", async () => {
    const { source, host } = fixture();
    const comment = "ORCL CASH DIVIDEND USD 0.50 PER SHARE - US TAX";
    source.fetch = async () => [{
      broker: "ibkr",
      brokerRecordId: "withholding-after-reset",
      activityType: "TAX",
      date: "2026-07-25T10:20:00Z",
      symbol: "",
      amount: 0.15,
      currency: "USD",
      comment,
      importRevision: "cash-semantics-v2",
    }];
    host.getActivities = vi.fn(async () => [{
      id: "existing-misclassified-dividend",
      accountId: "account-1",
      accountName: "IBKR Main",
      accountCurrency: "AUD",
      activityType: "DIVIDEND",
      date: new Date("2026-07-25T10:20:00Z"),
      amount: "0.15",
      quantity: null,
      unitPrice: null,
      fee: null,
      currency: "USD",
      comment,
      assetId: "",
      assetSymbol: "",
      needsReview: false,
      createdAt: new Date("2026-07-25T10:20:00Z"),
      updatedAt: new Date("2026-07-25T10:20:00Z"),
      isUserModified: false,
    }] as ActivityDetails[]);
    host.saveActivities = vi.fn(async (_creates: ActivityCreate[], updates: ActivityUpdate[] = []) => ({
      created: [],
      updated: updates.map((activity) => ({ id: activity.id })),
      deleted: [],
      createdMappings: [],
      errors: [],
    }) as unknown as ActivityBulkMutationResult);

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 0, updated: 1, duplicates: 1 });
    expect(host.saveActivities).toHaveBeenCalledWith([], [
      expect.objectContaining({ id: "existing-misclassified-dividend", activityType: "TAX" }),
    ]);
  });

  it("imports a newly observed revised cash record when there is nothing to migrate", async () => {
    const { source, host } = fixture();
    source.fetch = async () => [{
      broker: "ibkr",
      brokerRecordId: "new-withholding",
      activityType: "TAX",
      date: "2026-08-29T12:00:00Z",
      symbol: "",
      amount: 0.25,
      currency: "USD",
      comment: "NEW CASH DIVIDEND - US TAX",
      importRevision: "cash-semantics-v2",
    }];

    const result = await runSync(source, host, { ibkr: "account-1", webull: "" }, false);

    expect(result).toMatchObject({ imported: 1, updated: 0, invalid: 0 });
    expect(host.saveActivities).toHaveBeenCalledWith([
      expect.objectContaining({ activityType: "TAX", amount: 0.25 }),
    ], []);
  });
});

describe("resetImportedKeysForMappings", () => {
  it("clears only the selected Wealthfolio account's broker sync history", async () => {
    const importedKeys = new Set([
      "ibkr:account-1:trade-1",
      "ibkr:account-2:trade-2",
      "webull:webull-1:trade-3",
    ]);
    const host = {
      loadImportedKeys: vi.fn(async () => new Set(importedKeys)),
      saveImportedKeys: vi.fn(async (keys: Set<string>) => {
        importedKeys.clear();
        keys.forEach((key) => importedKeys.add(key));
      }),
    };

    const removed = await resetImportedKeysForMappings(host, { ibkr: "account-1", webull: "" });

    expect(removed).toBe(1);
    expect([...importedKeys]).toEqual([
      "ibkr:account-2:trade-2",
      "webull:webull-1:trade-3",
    ]);
  });
});

describe("asset resolution metadata", () => {
  it("preserves broker instrument hints for Wealthfolio import validation", () => {
    const brokerActivity = {
      broker: "ibkr",
      brokerRecordId: "ibkr-aapl-1",
      activityType: "BUY",
      date: "2026-08-20T00:00:00.000Z",
      symbol: "AAPL",
      quantity: 1,
      unitPrice: 220,
      currency: "USD",
      exchangeMic: "XNAS",
      quoteCcy: "USD",
      instrumentType: "EQUITY",
      providerId: "YAHOO",
      providerSymbol: "AAPL",
    } as BrokerActivity & {
      exchangeMic: string;
      quoteCcy: string;
      instrumentType: string;
      providerId: string;
      providerSymbol: string;
    };

    expect(toActivityImport(brokerActivity, "account-1", 1)).toMatchObject({
      symbol: "AAPL",
      exchangeMic: "XNAS",
      quoteCcy: "USD",
      instrumentType: "EQUITY",
      providerId: "YAHOO",
      providerSymbol: "AAPL",
    });
  });

  it("creates an asset-backed activity so Wealthfolio can bind the ticker", () => {
    const checked = toActivityImport({
      broker: "ibkr",
      brokerRecordId: "ibkr-aapl-1",
      activityType: "BUY",
      date: "2026-08-20T00:00:00.000Z",
      symbol: "AAPL",
      symbolName: "Apple Inc.",
      exchangeMic: "XNAS",
      quoteCcy: "USD",
      instrumentType: "EQUITY",
      quoteMode: "MARKET",
      quantity: 1,
      unitPrice: 220,
      currency: "USD",
    }, "account-1", 1);

    expect(toActivityCreate(checked, "broker-sync:ibkr:ibkr-aapl-1")).toMatchObject({
      accountId: "account-1",
      activityType: "BUY",
      asset: {
        symbol: "AAPL",
        exchangeMic: "XNAS",
        name: "Apple Inc.",
        quoteCcy: "USD",
        instrumentType: "EQUITY",
        quoteMode: "MARKET",
      },
    });
  });

  it("does not attach a security asset to a cash deposit", () => {
    const checked: ActivityImport = {
      accountId: "account-1",
      activityType: "DEPOSIT",
      date: "2026-08-20T00:00:00.000Z",
      symbol: "",
      amount: 5000,
      currency: "USD",
      isValid: true,
      isDraft: false,
    };

    expect(toActivityCreate(checked, "broker-sync:ibkr:deposit-1").asset).toBeUndefined();
  });

  it("preserves linked FX conversion metadata for Wealthfolio holdings", () => {
    const checked: ActivityImport = {
      accountId: "account-1",
      activityType: "TRANSFER_IN",
      date: "2026-08-20T00:00:00.000Z",
      symbol: "",
      amount: 1000,
      currency: "USD",
      isValid: true,
      isDraft: false,
    };
    const metadata = { flow: { is_external: false }, fx: { sourceCurrency: "AUD", destinationCurrency: "USD" } };

    expect(toActivityCreate(checked, "fx-in", { sourceGroupId: "ibkr-fx:1", metadata })).toMatchObject({
      sourceGroupId: "ibkr-fx:1:account-1",
      metadata,
    });
  });
});
