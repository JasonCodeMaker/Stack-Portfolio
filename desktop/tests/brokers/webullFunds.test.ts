import { describe, expect, it, vi } from "vitest";
import { parseWebullFundsDeposits, webullFundsPageStatus } from "../../brokers/webullFunds";

const deposit = {
  submitted: "23/11/2026 19:16:59 AEST",
  method: "PAYTO",
  amount: "AU$ 1,300.00",
  completed: "24/11/2026 00:10:04 AEST",
};

describe("Webull AU Funds Records", () => {
  it("uses the completed Australian calendar day and preserves the original timestamps", () => {
    expect(parseWebullFundsDeposits([deposit])).toEqual([{
      broker: "webull",
      brokerRecordId: expect.stringMatching(/^funds:[0-9a-f]{64}$/),
      activityType: "DEPOSIT",
      date: "2026-11-24T12:00:00Z",
      amount: 1300,
      currency: "AUD",
      symbol: "",
      metadata: { webullFunds: {
        submitted: "2026-11-23T19:16:59+10:00",
        completed: "2026-11-24T00:10:04+10:00",
        method: "PAYTO",
      } },
    }]);
  });

  it("keeps the source ID stable across later updates and distinguishes deposits of the same amount", () => {
    const [first] = parseWebullFundsDeposits([deposit]);
    const [updated, separate] = parseWebullFundsDeposits([
      { ...deposit, completed: "24/11/2026 00:15:04 AEST" },
      { ...deposit, submitted: "23/11/2026 19:16:58 AEST" },
    ]);
    expect(updated.brokerRecordId).toBe(first.brokerRecordId);
    expect(separate.brokerRecordId).not.toBe(first.brokerRecordId);
  });

  it("rejects invalid dates, unknown amounts and indistinguishable deposits", () => {
    expect(() => parseWebullFundsDeposits([{ ...deposit, completed: "31/11/2026 00:10:04 AEST" }])).toThrow();
    expect(() => parseWebullFundsDeposits([{ ...deposit, amount: "¥ 1300.00" }])).toThrow();
    expect(() => parseWebullFundsDeposits([deposit, deposit])).toThrow();
  });
});

describe("Webull funds verification", () => {
  it("keeps waiting for a trading password even if the funds heading is already visible", () => {
    const body = { innerText: "Please enter the trading password" };
    vi.stubGlobal("document", { body, querySelectorAll: () => [{ textContent: "Funds Records" }] });
    try {
      expect(webullFundsPageStatus()).toBe("verification");
      body.innerText = "Funds Records";
      expect(webullFundsPageStatus()).toBe("ready");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
