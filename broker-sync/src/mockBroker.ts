import type { BrokerActivity, BrokerId } from "@/types";

const MOCK_ACTIVITIES: Record<BrokerId, BrokerActivity[]> = {
  ibkr: [
    {
      broker: "ibkr",
      brokerRecordId: "mock-ibkr-deposit-001",
      activityType: "DEPOSIT",
      date: "2026-08-20T00:00:00.000Z",
      symbol: "$CASH-USD",
      amount: 5000,
      currency: "USD",
      comment: "Broker Sync local mock: IBKR deposit",
    },
    {
      broker: "ibkr",
      brokerRecordId: "mock-ibkr-buy-001",
      activityType: "BUY",
      date: "2026-08-21T14:30:00.000Z",
      symbol: "AAPL",
      symbolName: "Apple Inc.",
      exchangeMic: "XNAS",
      quoteCcy: "USD",
      instrumentType: "EQUITY",
      quoteMode: "MARKET",
      providerId: "YAHOO",
      providerSymbol: "AAPL",
      quantity: 2,
      unitPrice: 226.5,
      fee: 1,
      currency: "USD",
      comment: "Broker Sync local mock: IBKR buy",
    },
  ],
  webull: [
    {
      broker: "webull",
      brokerRecordId: "mock-webull-deposit-001",
      activityType: "DEPOSIT",
      date: "2026-08-22T00:00:00.000Z",
      symbol: "$CASH-USD",
      amount: 2500,
      currency: "USD",
      comment: "Broker Sync local mock: Webull deposit",
    },
    {
      broker: "webull",
      brokerRecordId: "mock-webull-buy-001",
      activityType: "BUY",
      date: "2026-08-23T15:00:00.000Z",
      symbol: "VT",
      symbolName: "Vanguard Total World Stock Index Fund ETF Shares",
      exchangeMic: "ARCX",
      quoteCcy: "USD",
      instrumentType: "ETF",
      quoteMode: "MARKET",
      providerId: "YAHOO",
      providerSymbol: "VT",
      quantity: 3,
      unitPrice: 138.25,
      currency: "USD",
      comment: "Broker Sync local mock: Webull buy",
    },
  ],
};

export async function fetchMockActivities(broker: BrokerId): Promise<BrokerActivity[]> {
  return MOCK_ACTIVITIES[broker].map((activity) => ({ ...activity }));
}
