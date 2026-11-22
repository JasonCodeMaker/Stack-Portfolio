import { describe, expect, it } from "vitest";
import { convertToAud } from "../../allocation/domain/currency";

describe("currency valuation", () => {
  it("converts USD using the selected quote", () => {
    const result = convertToAud(1000, "USD", {
      pair: "USD/AUD",
      rate: 1.5,
      fetchedAt: "2026-08-25T00:00:00.000Z",
      provider: "twelvedata",
    });
    expect(result).toEqual({ audValue: 1500, supported: true });
  });

  it("keeps unsupported currencies visible without inventing an AUD value", () => {
    expect(convertToAud(250, "EUR", null)).toEqual({
      audValue: null,
      supported: false,
      reason: "Unsupported currency: EUR",
    });
  });
});
