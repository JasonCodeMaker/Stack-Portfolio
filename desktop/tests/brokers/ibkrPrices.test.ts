import { afterEach, describe, expect, it } from "vitest";
import { ibkrReportPrices } from "../../ibkrPrices.js";
import { getActiveLocale, setActiveLocale } from "../../i18n/index.js";

const db = { prepare: () => ({ get: () => undefined, run: () => {} }) };
const report = {
  statement: {
    date: "2026-10-30",
    base: "AUD",
    positions: [{ assetId: "A1", symbol: "AAPL", currency: "USD", price: "208", fxToBase: "1.5" }],
  },
  audit: { conversionRates: [{ from: "USD", to: "AUD", day: "2026-10-30", rate: "1.52" }] },
};
const labels = () => ibkrReportPrices(db, "acc", report, [], [], false).edits.map((e) => e.label);

describe("IBKR price edit labels", () => {
  const previous = getActiveLocale();
  afterEach(() => setActiveLocale(previous));

  it("names the statement source in the active language", () => {
    setActiveLocale("en");
    expect(labels()).toEqual([
      "2026-10-30 AAPL Holding Quote · IBKR statement quote",
      "2026-10-30 USD to AUD · IBKR statement FX",
      "2026-10-30 USD to AUD · IBKR daily report FX",
    ]);
    setActiveLocale("zh-CN");
    expect(labels()[0]).toBe("2026-10-30 AAPL 持仓报价 · IBKR 结单报价");
  });
});
