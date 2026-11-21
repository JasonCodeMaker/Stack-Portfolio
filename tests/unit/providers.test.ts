import { describe, expect, it, vi } from "vitest";
import { createProviders, mapWithConcurrency, resolveEtfHoldings } from "@/services/etf/providers";
import type { EtfAsset, EtfHoldingsSnapshot } from "@/types/domain";

const etf: EtfAsset = { etfKey: "XNAS:IVV", profileId: "ivv", symbol: "IVV", name: "iShares Core S&P 500", mic: "XNAS" };
const cached: EtfHoldingsSnapshot = { schemaVersion: 1, etfKey: etf.etfKey, provider: "alpha-vantage", asOfDate: "2026-08-25", fetchedAt: new Date().toISOString(), holdings: [{ symbol: "NVDA", name: "NVIDIA", weight: 1, underlyingType: "stock" }], weightSum: 1, normalized: false, sourceMode: "automatic" };

describe("ETF provider resolver", () => {
  it("does not fall back to another provider's cache in pinned mode", async () => {
    const result = await resolveEtfHoldings(etf, [], { mode: "pinned", pinnedProvider: "ishares", cached });
    expect(result.snapshot).toBeNull();
    expect(result.failureReason).toContain("No provider");
  });

  it("honors a forced refresh even when the shared cache is fresh", async () => {
    const provider = {
      id: "alpha-vantage",
      canHandle: async () => true,
      fetchHoldings: async () => ({ ...cached, fetchedAt: new Date(Date.now() + 1000).toISOString() }),
    };
    const result = await resolveEtfHoldings(etf, [provider], { mode: "auto", cached, force: true });
    expect(result.snapshot?.fetchedAt).not.toBe(cached.fetchedAt);
  });

  it("automatically downloads IVV holdings from the official iShares CSV", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: [
        "iShares Core S&P 500 ETF",
        'Fund Holdings as of,"Aug 27, 2026"',
        'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Location,Exchange,Currency',
        '"NVDA","NVIDIA","Information Technology","Equity","1","60.00","United States","NASDAQ","USD"',
        '"AAPL","APPLE","Information Technology","Equity","1","39.02","United States","NASDAQ","USD"',
        '"XOM","EXXON MOBIL","Energy","Equity","1","0.97","United States","NYSE","USD"',
        '"BRKB","BERKSHIRE HATHAWAY INC CLASS B","Financials","Equity","1","0.01","United States","NYSE","USD"',
      ].join("\n"),
    });
    const providers = createProviders({ api: { network: { request } } } as never, {});
    const result = await resolveEtfHoldings(etf, providers, { mode: "auto", force: true });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://www.ishares.com/us/products/239726/IVV/latest-holdings.csv",
    }));
    expect(result.snapshot?.provider).toBe("ishares");
    expect(result.snapshot?.asOfDate).toBe("2026-08-27");
    expect(result.snapshot?.holdings).toHaveLength(4);
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "XOM")?.weight).toBe(0.0097);
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "XOM")?.mic).toBe("XNYS");
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "NVDA")?.mic).toBe("XNAS");
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "BRK.B")?.weight).toBe(0.0001);
  });

  it("reads the Market Weight column from the current iShares CSV layout", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: [
        "iShares Core S&P 500 ETF",
        'Fund Holdings as of,"Oct 29, 2026"',
        "Ticker,Name,Type,Sector,Asset Class,Market Value,Notional Value,Quantity,Price,Location,Exchange,Currency,FX Rate,Market Currency,Accrual Date,Market Weight,Notional Weight",
        '"NVDA","NVIDIA","EQUITY","Information Technology","Equity","1","1","1","213.66","United States","NASDAQ","USD","1.00","USD","-","7.77","7.76"',
        '"XOM","EXXON MOBIL","EQUITY","Energy","Equity","1","1","1","110.00","United States","NYSE","USD","1.00","USD","-","0.97","0.98"',
        '"AAPL","APPLE","EQUITY","Information Technology","Equity","1","1","1","270.00","United States","NASDAQ","USD","1.00","USD","-","91.26","91.26"',
      ].join("\n"),
    });
    const providers = createProviders({ api: { network: { request } } } as never, {});
    const result = await resolveEtfHoldings(etf, providers, { mode: "auto", force: true });

    expect(result.snapshot?.provider).toBe("ishares");
    expect(result.snapshot?.asOfDate).toBe("2026-10-29");
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "NVDA")?.weight).toBeCloseTo(0.0777);
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "XOM")?.mic).toBe("XNYS");
  });

  it("automatically downloads SPMO holdings from Invesco's holdings API by CUSIP", async () => {
    const spmo: EtfAsset = { etfKey: "ARCX:SPMO", profileId: "spmo", symbol: "SPMO", name: "Invesco S&P 500 Momentum ETF", mic: "ARCX" };
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({
        cusip: "46138E339",
        effectiveDate: "2026-09-16",
        totalNumberOfHoldings: 3,
        holdings: [
          { ticker: "MU", issuerName: "Micron Technology Inc", percentageOfTotalNetAssets: 60.5, securityTypeName: "Common Stock", currency: "USD" },
          { ticker: "JNJ", issuerName: "Johnson &amp; Johnson", percentageOfTotalNetAssets: 39.25, securityTypeName: "Common Stock", currency: "USD" },
          { ticker: "CASH", issuerName: "US Dollar", percentageOfTotalNetAssets: 0.25, securityTypeName: "Currency", currency: "USD" },
          { ticker: "USDPDV", issuerName: "USD Pending Dividends", percentageOfTotalNetAssets: null, securityTypeName: "Currency", currency: "USD" },
        ],
      }),
    });
    const providers = createProviders({ api: { network: { request } } } as never, {});
    const result = await resolveEtfHoldings(spmo, providers, { mode: "auto", force: true });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46138E339/holdings/fund?idType=cusip&productType=ETF",
      headers: expect.objectContaining({ "User-Agent": expect.stringMatching(/^PortfolioXRay\//), Accept: "application/json" }),
    }));
    expect(result.failureReason).toBeUndefined();
    expect(result.snapshot?.provider).toBe("invesco");
    expect(result.snapshot?.asOfDate).toBe("2026-09-16");
    expect(result.snapshot?.holdings).toHaveLength(3);
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "MU")?.weight).toBeCloseTo(0.605, 10);
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "JNJ")?.name).toBe("Johnson & Johnson");
    expect(result.snapshot?.holdings.find((holding) => holding.symbol === "CASH")?.underlyingType).toBe("cash");
  });

  it("bypasses Invesco's CDN cache with a unique query parameter when the shared entry is a stale error", async () => {
    const spmo: EtfAsset = { etfKey: "ARCX:SPMO", profileId: "spmo", symbol: "SPMO", name: "Invesco S&P 500 Momentum ETF" };
    const good = JSON.stringify({ effectiveDate: "2026-09-16", holdings: [{ ticker: "MU", issuerName: "Micron Technology Inc", percentageOfTotalNetAssets: 100, securityTypeName: "Common Stock" }] });
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 406, headers: {}, body: "" })
      .mockResolvedValueOnce({ status: 200, headers: {}, body: good });
    const providers = createProviders({ api: { network: { request } } } as never, {});
    const result = await resolveEtfHoldings(spmo, providers, { mode: "auto", force: true });

    expect(request).toHaveBeenCalledTimes(2);
    const retryUrl = String(request.mock.calls[1][0].url);
    expect(retryUrl).toMatch(/^https:\/\/dng-api\.invesco\.com\/cache\/v1\/accounts\/en_US\/shareclasses\/46138E339\/holdings\/fund\?idType=cusip&productType=ETF&_=\d+$/);
    expect(result.snapshot?.provider).toBe("invesco");
    expect(result.failureReason).toBeUndefined();
  });

  it("uses a user-supplied CUSIP for Invesco funds that are not in the built-in table", async () => {
    const etfWithCusip: EtfAsset = { etfKey: "XNAS:QQQM", profileId: "qqqm", symbol: "QQQM", name: "Invesco NASDAQ 100 ETF", providerSymbol: "46138G649" };
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify({ effectiveDate: "2026-09-16", holdings: [{ ticker: "NVDA", issuerName: "NVIDIA Corp", percentageOfTotalNetAssets: 100, securityTypeName: "Common Stock" }] }),
    });
    const providers = createProviders({ api: { network: { request } } } as never, {});
    const result = await resolveEtfHoldings(etfWithCusip, providers, { mode: "auto", force: true });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/shareclasses/46138G649/holdings/fund") }));
    expect(result.snapshot?.provider).toBe("invesco");
  });

  it("keeps automatic provider refresh concurrency at the configured limit", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });
    expect(result).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
