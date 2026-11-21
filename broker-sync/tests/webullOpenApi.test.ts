import { afterEach, describe, expect, it, vi } from "vitest";
import type { NetworkResponse } from "@wealthfolio/addon-sdk";
import {
  checkWebullToken,
  fetchWebullReport,
  generateWebullSignature,
  listWebullAccounts,
  parseWebullCashActivities,
  parseWebullOrderHistory,
  webullOrderFee,
  type WebullNetwork,
} from "@/webullOpenApi";

describe("Webull OpenAPI", () => {
  it("matches the current SDK HMAC-SHA256 algorithm", async () => {
    await expect(generateWebullSignature({
      path: "/trade/place_order",
      query: { a1: "webull", a2: "123", a3: "xxx", q1: "yyy" },
      body: JSON.stringify({ k1: 123, k2: "this is the api request body", k3: true, k4: { foo: [1, 2] } }),
      appKey: "776da210ab4a452795d74e726ebd74b6",
      appSecret: "0f50a2e853334a9aae1a783bee120c1f",
      host: "api.webull.com.sg",
      timestamp: "2022-01-04T03:55:31Z",
      nonce: "48ef5afed43d4d91ae514aaeafbc29ba",
    })).resolves.toBe("mafoLh6ZyyaOs0UAHUagoSH2yXTDzlkRUuCR/Xjo7UE=");
  });

  it("converts only completed orders into transaction activities", () => {
    const activities = parseWebullOrderHistory([
      { client_order_id: "group-1", orders: [
        { order_id: "order-1", symbol: "AAPL", side: "BUY", status: "FILLED", filled_quantity: "2", filled_price: "190.25", filled_time_at: "2026-08-20T01:02:03.000Z" },
        { order_id: "order-2", symbol: "MSFT", side: "SELL", status: "CANCELLED", filled_quantity: "0", filled_price: "0", place_time_at: "2026-08-20T01:02:03.000Z" },
      ] },
    ]);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ brokerRecordId: "order-1", activityType: "BUY", symbol: "AAPL", quantity: 2, unitPrice: 190.25, currency: "AUD" });
  });

  it("imports an unqualified order as its ASX listing so Yahoo does not price the US ticker", () => {
    const [activity] = parseWebullOrderHistory([
      { client_order_id: "group-1", orders: [
        { order_id: "order-1", symbol: "IVV", side: "BUY", status: "FILLED", filled_quantity: "1", filled_price: "71.33", filled_time_at: "2026-09-01T05:01:35.000Z" },
      ] },
    ]);
    expect(activity).toMatchObject({
      symbol: "IVV",
      exchangeMic: "XASX",
      quoteCcy: "AUD",
      currency: "AUD",
      providerId: "YAHOO",
      providerSymbol: "IVV.AX",
    });
  });

  it("re-imports orders under a listing revision so an existing US-priced record is repaired", () => {
    const [activity] = parseWebullOrderHistory([
      { client_order_id: "group-1", orders: [
        { order_id: "order-1", symbol: "IVV", side: "BUY", status: "FILLED", filled_quantity: "1", filled_price: "71.33", filled_time_at: "2026-09-01T05:01:35.000Z" },
      ] },
    ]);
    expect(activity.importRevision).toBe("webull-listing-v2");
  });

  it("keeps an order that reports a non-AUD currency on its own listing", () => {
    const [activity] = parseWebullOrderHistory([
      { client_order_id: "group-2", orders: [
        { order_id: "order-2", symbol: "AAPL", side: "BUY", status: "FILLED", filled_quantity: "2", filled_price: "190.25", filled_time_at: "2026-08-20T01:02:03.000Z", currency: "USD" },
      ] },
    ]);
    expect(activity).toMatchObject({ symbol: "AAPL", quoteCcy: "USD", currency: "USD", providerSymbol: "AAPL" });
    expect(activity.exchangeMic).toBeUndefined();
    expect(activity.importRevision).toBeUndefined();
  });

  it("does not append a second listing suffix to a symbol Webull already qualified", () => {
    const [activity] = parseWebullOrderHistory([
      { client_order_id: "group-3", orders: [
        { order_id: "order-3", symbol: "ivv.ax", side: "BUY", status: "FILLED", filled_quantity: "1", filled_price: "71.33", filled_time_at: "2026-09-01T05:01:35.000Z" },
      ] },
    ]);
    expect(activity).toMatchObject({ symbol: "IVV", providerSymbol: "IVV.AX" });
  });

  it("uses actual commission and non-duplicate actual fee values", () => {
    expect(webullOrderFee({
      commission: { actual_commission: "1.00", receivable_commission: "1.50" },
      fees: [
        { type: "GST", actual_value: "0.10", receivable_value: "0.15" },
        { type: "COMMISSION", actual_value: "1.00" },
      ],
    })).toEqual({ total: 1.1, breakdown: { COMMISSION: 1, GST: 0.1 } });
  });

  it("signs token checks and account requests without exposing the app secret", async () => {
    const requests: Parameters<WebullNetwork["request"]>[0][] = [];
    const network: WebullNetwork = {
      request: async (request) => {
        requests.push(request);
        return requests.length === 1
          ? { status: 200, headers: {}, body: JSON.stringify({ token: "token-1", status: "NORMAL", expires_at: 1 }) }
          : { status: 200, headers: {}, body: JSON.stringify([{ account_id: "account-1", account_number: "WBA123", account_type: "CASH" }]) };
      },
    };
    const credentials = { appKey: "key-1", appSecret: "secret-1" };
    await expect(checkWebullToken(network, credentials, "token-1")).resolves.toMatchObject({ status: "NORMAL" });
    await expect(listWebullAccounts(network, { ...credentials, accessToken: "token-1" })).resolves.toEqual([
      { accountId: "account-1", accountNumber: "WBA123", accountType: "CASH" },
    ]);
    expect(requests[0].body).toBe(JSON.stringify({ token: "token-1" }));
    expect(requests[1].headers?.["x-access-token"]).toBe("token-1");
    expect(JSON.stringify(requests)).not.toContain("secret-1");
  });
});

const FILLED_ORDER_GROUPS = [{
  client_order_id: "group-1",
  orders: [{
    order_id: "order-1",
    client_order_id: "group-1",
    symbol: "IVV",
    side: "BUY",
    status: "FILLED",
    filled_quantity: "1",
    filled_price: "71.33",
    filled_time_at: "2026-08-21T00:00:00.000Z",
  }],
}];

function response(body: unknown, status = 200): NetworkResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

function routedNetwork(routes: Array<[string, () => NetworkResponse]>): { network: WebullNetwork; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    network: {
      request: async (request) => {
        urls.push(request.url);
        const route = routes.find(([fragment]) => request.url.includes(fragment));
        if (!route) throw new Error(`Unexpected Webull request: ${request.url}`);
        return route[1]();
      },
    },
  };
}

const CREDENTIALS = { appKey: "key-1", appSecret: "secret-1", accessToken: "token-1", accountId: "account-1" };

describe("Webull cash activities", () => {
  it("imports external cash transfers as deposits and withdrawals", () => {
    expect(parseWebullCashActivities({
      data: [
        { activity_id: "act-1", activity_type: "DEPOSIT", amount: "1000.00", currency: "AUD", activity_time_at: "2026-08-18T00:00:00.000Z", description: "Bank transfer in", status: "COMPLETED" },
        { activity_id: "act-2", activity_type: "WITHDRAWAL", amount: "-250.00", currency: "AUD", activity_time_at: "2026-08-19T00:00:00.000Z", description: "Bank transfer out", status: "COMPLETED" },
      ],
    })).toEqual([
      expect.objectContaining({ broker: "webull", brokerRecordId: "cash:act-1", activityType: "DEPOSIT", amount: 1000, currency: "AUD", symbol: "" }),
      expect.objectContaining({ broker: "webull", brokerRecordId: "cash:act-2", activityType: "WITHDRAWAL", amount: 250, currency: "AUD", symbol: "" }),
    ]);
  });

  it("classifies a debit-signed transfer row as a withdrawal even when the type is generic", () => {
    expect(parseWebullCashActivities([
      { activity_id: "act-3", activity_type: "TRANSFER", amount: "-400.00", currency: "USD", activity_time_at: "2026-08-19T00:00:00.000Z" },
    ])).toEqual([
      expect.objectContaining({ brokerRecordId: "cash:act-3", activityType: "WITHDRAWAL", amount: 400, currency: "USD" }),
    ]);
  });

  it("splits a currency exchange into a linked same-account transfer pair", () => {
    const [outgoing, incoming] = parseWebullCashActivities([{
      activity_id: "act-4",
      activity_type: "CURRENCY_EXCHANGE",
      from_currency: "AUD",
      from_amount: "1000.00",
      to_currency: "USD",
      to_amount: "652.30",
      activity_time_at: "2026-08-20T00:00:00.000Z",
      status: "COMPLETED",
    }]);
    expect(outgoing).toMatchObject({
      brokerRecordId: "cash:act-4:out",
      activityType: "TRANSFER_OUT",
      amount: 1000,
      currency: "AUD",
      sourceGroupId: "webull-fx:cash:act-4",
    });
    expect(incoming).toMatchObject({
      brokerRecordId: "cash:act-4:in",
      activityType: "TRANSFER_IN",
      amount: 652.3,
      currency: "USD",
      sourceGroupId: "webull-fx:cash:act-4",
    });
    expect(incoming.metadata?.fx).toMatchObject({
      sourceCurrency: "AUD",
      destinationCurrency: "USD",
      sourceAmount: "1000",
      destinationAmount: "652.3",
      rateSource: "implied_from_webull_activity",
    });
  });

  it("maps dividends, interest, fees, and withholding tax to their cash semantics", () => {
    expect(parseWebullCashActivities([
      { activity_id: "d-1", activity_type: "DIVIDEND", symbol: "IVV", amount: "12.40", currency: "USD", activity_time_at: "2026-08-22T00:00:00.000Z" },
      { activity_id: "d-2", activity_type: "DIVIDEND_WITHHOLDING_TAX", amount: "-1.86", currency: "USD", activity_time_at: "2026-08-22T00:00:00.000Z" },
      { activity_id: "i-1", activity_type: "INTEREST", amount: "0.55", currency: "USD", activity_time_at: "2026-08-23T00:00:00.000Z" },
      { activity_id: "f-1", activity_type: "PLATFORM_FEE", amount: "-2.00", currency: "USD", activity_time_at: "2026-08-24T00:00:00.000Z" },
    ]).map((activity) => [activity.activityType, activity.symbol, activity.amount])).toEqual([
      ["DIVIDEND", "IVV", 12.4],
      ["TAX", "", 1.86],
      ["INTEREST", "", 0.55],
      ["FEE", "", 2],
    ]);
  });

  it("skips activities that have not settled", () => {
    expect(parseWebullCashActivities([
      { activity_id: "p-1", activity_type: "DEPOSIT", amount: "500", currency: "AUD", activity_time_at: "2026-08-25T00:00:00.000Z", status: "PENDING" },
      { activity_id: "p-2", activity_type: "DEPOSIT", amount: "500", currency: "AUD", activity_time_at: "2026-08-25T00:00:00.000Z", status: "FAILED" },
    ])).toEqual([]);
  });

  it("fetches the cash ledger alongside order history", async () => {
    const { network } = routedNetwork([
      ["/historical-orders/list", () => response({ data: FILLED_ORDER_GROUPS })],
      ["/orders/get", () => response({ data: [{ order_id: "order-1", commission: { actual_commission: "0" } }] })],
      ["cash-activities/list", () => response({
        data: [{ activity_id: "act-1", activity_type: "DEPOSIT", amount: "1000.00", currency: "AUD", activity_time_at: "2026-08-18T00:00:00.000Z" }],
      })],
    ]);
    const report = await fetchWebullReport(network, CREDENTIALS);
    expect(report.audit).toMatchObject({ orders: 1, cashActivities: 1, cashLedgerAvailable: true });
    expect(report.activities.map((activity) => activity.activityType)).toEqual(["BUY", "DEPOSIT"]);
  });

  it("keeps available orders when the account has no cash ledger endpoint", async () => {
    const { network } = routedNetwork([
      ["/historical-orders/list", () => response({ data: FILLED_ORDER_GROUPS })],
      ["/orders/get", () => response({ data: [{ order_id: "order-1", commission: { actual_commission: "0" } }] })],
      ["activities", () => response({ message: "not found" }, 404)],
    ]);
    const report = await fetchWebullReport(network, CREDENTIALS);
    expect(report.activities.map((activity) => activity.activityType)).toEqual(["BUY"]);
    expect(report.audit.cashLedgerAvailable).toBe(false);
    expect(report.audit.warnings.join(" ")).toMatch(/cash/i);
  });

  it("keeps available orders when production returns an empty cash ledger", async () => {
    const { network } = routedNetwork([
      ["/historical-orders/list", () => response({ data: FILLED_ORDER_GROUPS })],
      ["/orders/get", () => response({ data: [{ order_id: "order-1", commission: { actual_commission: "0" } }] })],
      ["cash-activities/list", () => response({ data: [] })],
    ]);

    const report = await fetchWebullReport(network, CREDENTIALS);
    expect(report.activities.map((activity) => activity.activityType)).toEqual(["BUY"]);
    expect(report.audit).toMatchObject({ cashLedgerAvailable: true, cashActivities: 0 });
    expect(report.audit.warnings.join(" ")).toMatch(/empty cash activity ledger/i);
  });

  it("falls back to the legacy SDK cash activity path before giving up", async () => {
    const { network, urls } = routedNetwork([
      ["/historical-orders/list", () => response({ data: [] })],
      ["/trading/activities/cash-activities/list", () => response({ message: "not found" }, 404)],
      ["/openapi/trade/activities/cash", () => response({
        data: [{ activity_id: "act-9", activity_type: "DEPOSIT", amount: "10", currency: "AUD", activity_time_at: "2026-08-18T00:00:00.000Z" }],
      })],
    ]);
    const report = await fetchWebullReport(network, CREDENTIALS);
    expect(report.audit).toMatchObject({ cashActivities: 1, cashLedgerAvailable: true });
    expect(urls.some((url) => url.includes("/openapi/trade/activities/cash"))).toBe(true);
  });

  it("surfaces a real cash ledger failure instead of silently importing nothing", async () => {
    const { network } = routedNetwork([
      ["/historical-orders/list", () => response({ data: [] })],
      ["activities", () => response({ message: "token expired" }, 401)],
    ]);
    await expect(fetchWebullReport(network, CREDENTIALS)).rejects.toThrow(/cash activity/i);
  });
});

describe("Webull cash window", () => {
  it("retries with an epoch timestamp when Webull rejects the ISO start_time", async () => {
    const startTimes: string[] = [];
    const network: WebullNetwork = {
      request: async (request) => {
        if (request.url.includes("/historical-orders/list")) return response({ data: [] });
        const startTime = new URL(request.url).searchParams.get("start_time") ?? "";
        startTimes.push(startTime);
        if (startTime.includes("T")) return response({ message: "invalid start_time" }, 400);
        return response({ data: [{ activity_id: "act-1", activity_type: "DEPOSIT", amount: "10", currency: "AUD", activity_time_at: "2026-08-18T00:00:00.000Z" }] });
      },
    };
    const report = await fetchWebullReport(network, CREDENTIALS);
    expect(report.audit).toMatchObject({ cashActivities: 1, cashLedgerAvailable: true });
    expect(startTimes).toHaveLength(2);
    expect(Number(startTimes[1])).toBeGreaterThan(0);
  });
});

// Request signing awaits WebCrypto, which settles outside the microtask queue,
// so the clock is advanced in small steps with a real event-loop turn between
// them instead of in one jump that would run before the next timer exists.
async function settleWithFakeClock<T>(pending: Promise<T>): Promise<T> {
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  while (!settled) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(50);
  }
  return pending;
}

function filledOrderGroup(index: number) {
  return {
    client_order_id: `group-${index}`,
    orders: [{
      order_id: `order-${index}`,
      client_order_id: `group-${index}`,
      symbol: "IVV",
      side: "BUY",
      status: "FILLED",
      filled_quantity: "1",
      filled_price: "71.33",
      filled_time_at: "2026-08-21T00:00:00.000Z",
    }],
  };
}

function orderDetailFor(url: string): NetworkResponse {
  const clientOrderId = new URL(url).searchParams.get("client_order_id") ?? "";
  return response({ data: [{ order_id: clientOrderId.replace("group", "order"), commission: { actual_commission: "1.50" } }] });
}

describe("Webull rate limits", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spaces order detail requests to Webull's production limit of 2 per 2 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const detailTimes: number[] = [];
    const network: WebullNetwork = {
      request: async (request) => {
        if (request.url.includes("/historical-orders/list")) {
          return response({ data: [filledOrderGroup(1), filledOrderGroup(2), filledOrderGroup(3)] });
        }
        if (request.url.includes("/orders/get")) {
          detailTimes.push(Date.now());
          return orderDetailFor(request.url);
        }
        return response({ data: [] });
      },
    };

    const report = await settleWithFakeClock(fetchWebullReport(network, CREDENTIALS));
    expect(report.audit.orders).toBe(3);
    expect(detailTimes).toHaveLength(3);
    for (let index = 1; index < detailTimes.length; index += 1) {
      expect(detailTimes[index] - detailTimes[index - 1]).toBeGreaterThanOrEqual(1000);
    }
  });

  it("waits and retries an order detail request that Webull rate-limits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const detailTimes: number[] = [];
    const network: WebullNetwork = {
      request: async (request) => {
        if (request.url.includes("/historical-orders/list")) return response({ data: [filledOrderGroup(1)] });
        if (request.url.includes("/orders/get")) {
          detailTimes.push(Date.now());
          return detailTimes.length === 1 ? response({ message: "to many requests" }, 429) : orderDetailFor(request.url);
        }
        return response({ data: [] });
      },
    };

    const report = await settleWithFakeClock(fetchWebullReport(network, CREDENTIALS));
    expect(report.activities[0]).toMatchObject({ activityType: "BUY", fee: 1.5 });
    expect(detailTimes).toHaveLength(2);
    expect(detailTimes[1] - detailTimes[0]).toBeGreaterThanOrEqual(2000);
  });

  it("treats a 'to many requests' body as rate limiting even without a 429 status", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let detailCalls = 0;
    const network: WebullNetwork = {
      request: async (request) => {
        if (request.url.includes("/historical-orders/list")) return response({ data: [filledOrderGroup(1)] });
        if (request.url.includes("/orders/get")) {
          detailCalls += 1;
          return detailCalls === 1 ? response({ message: "to many requests" }, 417) : orderDetailFor(request.url);
        }
        return response({ data: [] });
      },
    };

    const report = await settleWithFakeClock(fetchWebullReport(network, CREDENTIALS));
    expect(report.audit.orders).toBe(1);
    expect(detailCalls).toBe(2);
  });

  it("reports a persistent rate limit as a wait-and-retry problem instead of a failed order", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let detailCalls = 0;
    const network: WebullNetwork = {
      request: async (request) => {
        if (request.url.includes("/historical-orders/list")) return response({ data: [filledOrderGroup(1)] });
        detailCalls += 1;
        return response({ message: "to many requests" }, 429);
      },
    };

    await expect(settleWithFakeClock(fetchWebullReport(network, CREDENTIALS))).rejects.toThrow(/rate-limit.*wait a minute/i);
    expect(detailCalls).toBeGreaterThan(1);
  });
});
