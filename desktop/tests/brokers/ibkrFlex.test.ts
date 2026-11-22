import { describe, expect, it, vi } from "vitest";
import { fetchIbkrFlexReport, parseIbkrFlexReport } from "../../brokers/ibkrFlex";

const XML = `<?xml version="1.0"?><FlexQueryResponse><FlexStatements><FlexStatement accountId="U123" baseCurrency="AUD">
<Trades><Trade accountId="U123" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" listingExchange="NASDAQ" tradeDate="20260828" dateTime="20260828;143015" buySell="BUY" quantity="2" tradePrice="225.50" ibCommission="-1.00" taxes="0" tradeID="T1" ibExecID="E1" /></Trades>
<CashTransactions><CashTransaction accountId="U123" currency="USD" type="Dividends" description="AAPL CASH DIVIDEND" symbol="AAPL" dateTime="20260829" amount="12.25" transactionID="C1" /></CashTransactions>
<TransactionTaxes><TransactionTax accountId="U123" currency="AUD" date="20260829" reportDate="20260829" taxDescription="Other Fee" taxAmount="-3.50" transactionID="F1" levelOfDetail="SUMMARY" /></TransactionTaxes>
</FlexStatement></FlexStatements></FlexQueryResponse>`;

describe("Flex report activities", () => {
  it("normalizes trades, dividends and standalone transaction taxes", () => {
    expect(parseIbkrFlexReport(XML).activities).toEqual([
      expect.objectContaining({ brokerRecordId: "E1", activityType: "BUY", symbol: "AAPL", exchangeMic: "XNAS", quantity: 2, unitPrice: 225.5, fee: 1 }),
      expect.objectContaining({ brokerRecordId: "C1", activityType: "DIVIDEND", symbol: "AAPL", amount: 12.25 }),
      expect.objectContaining({ brokerRecordId: "F1:tax", activityType: "TAX", symbol: "", amount: 3.5, currency: "AUD" }),
    ]);
  });

  it("rejects a non-Flex response", () => {
    expect(() => parseIbkrFlexReport("not xml")).toThrow(/not an Activity Flex XML/);
  });

  it("books securities and every FX leg on the Flex trade date when report time crosses midnight", () => {
    const trades = `<FlexStatement><Trades>
      <Trade symbol="ORCL" tradeID="T1" currency="USD" assetCategory="STK" buySell="BUY" quantity="2" tradePrice="107" tradeDate="20261120" dateTime="20261121;021639" />
      <Trade symbol="AUD.USD" tradeID="FX1" currency="USD" assetCategory="CASH" buySell="SELL" quantity="-100" proceeds="75" tradeDate="20261120" dateTime="20261121;021639" ibCommission="-1" ibCommissionCurrency="EUR" />
      <Trade symbol="ABC" tradeID="T2" currency="USD" assetCategory="STK" buySell="BUY" quantity="1" tradePrice="10" dateTime="20261123;101500" />
    </Trades></FlexStatement>`;
    const rows = parseIbkrFlexReport(trades).activities;
    expect(rows.slice(0, 4).map((r) => r.date.slice(0, 10))).toEqual(Array(4).fill("2026-11-20"));
    expect(rows.slice(0, 4).every((r) => r.metadata?.ibkrReportedDateTime === "2026-11-21T02:16:39")).toBe(true);
    expect(rows[4].date).toBe("2026-11-23T10:15:00Z");
  });

  it("rejects a multi-account Flex response instead of mixing broker accounts", () => {
    const multiAccountXml = `<FlexQueryResponse><FlexStatements>
      <FlexStatement accountId="U1"><AccountInformation accountId="U1" currency="AUD" /></FlexStatement>
      <FlexStatement accountId="U2"><AccountInformation accountId="U2" currency="AUD" /></FlexStatement>
    </FlexStatements></FlexQueryResponse>`;

    expect(() => parseIbkrFlexReport(multiAccountXml)).toThrow(/exactly one broker account/);
  });

  it("imports real IBKR AutoFX executions whose netCash is zero", () => {
    const fxXml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1"><Trades>
      <Trade accountId="U1" currency="USD" assetCategory="CASH" symbol="AUD.USD" description="AUD.USD" tradeDate="20260828" dateTime="20260828;143015" buySell="SELL" quantity="-1039" tradePrice="0.72475" proceeds="753.01525" netCash="0" ibCommission="-2.7624" ibCommissionCurrency="AUD" notes="AFx" levelOfDetail="EXECUTION" tradeID="FX1" />
    </Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;

    expect(parseIbkrFlexReport(fxXml).activities).toEqual([
      expect.objectContaining({ brokerRecordId: "FX1:in", activityType: "TRANSFER_IN", symbol: "", amount: 753.01525, currency: "USD", sourceGroupId: "ibkr-fx:FX1" }),
      expect.objectContaining({ brokerRecordId: "FX1:out", activityType: "TRANSFER_OUT", symbol: "", amount: 1039, fee: 2.7624, currency: "AUD", sourceGroupId: "ibkr-fx:FX1" }),
    ]);
  });

  it("classifies dividend withholding as tax before matching the dividend text", () => {
    const taxXml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1"><CashTransactions>
      <CashTransaction accountId="U1" currency="USD" type="Dividends" description="ORCL CASH DIVIDEND USD 0.50000000 PER SHARE - US TAX" symbol="ORCL" dateTime="20260829" amount="-0.15" transactionID="WT1" />
    </CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>`;

    expect(parseIbkrFlexReport(taxXml).activities[0]).toMatchObject({
      brokerRecordId: "WT1",
      activityType: "TAX",
      symbol: "",
      amount: 0.15,
      currency: "USD",
      importRevision: "cash-semantics-v2",
    });
  });

  it("does not double count a transaction tax already included on its trade", () => {
    const transactionTaxXml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1"><Trades>
      <Trade accountId="U1" currency="USD" assetCategory="STK" symbol="AAPL" tradeDate="20260828" dateTime="20260828;143015" buySell="SELL" quantity="1" tradePrice="225.50" taxes="-0.35" tradeID="TAXED-TRADE" ibExecID="EXEC-1" levelOfDetail="EXECUTION" />
    </Trades><TransactionTaxes>
      <TransactionTax accountId="U1" currency="USD" date="20260828" taxDescription="Transaction Tax" taxAmount="-0.35" tradeId="TAXED-TRADE" levelOfDetail="SUMMARY" />
    </TransactionTaxes></FlexStatement></FlexStatements></FlexQueryResponse>`;

    expect(parseIbkrFlexReport(transactionTaxXml).activities).toEqual([
      expect.objectContaining({ brokerRecordId: "EXEC-1", activityType: "SELL", tax: 0.35 }),
    ]);
  });

  it("maps an IBKR class-share symbol to its Yahoo quote symbol", () => {
    const classShareXml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1"><Trades>
      <Trade accountId="U1" currency="USD" assetCategory="STK" symbol="BRK B" description="BERKSHIRE HATHAWAY INC-CL B" listingExchange="NYSE" tradeDate="20260828" dateTime="20260828;143015" buySell="BUY" quantity="1" tradePrice="500" tradeID="BRK1" />
    </Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;

    expect(parseIbkrFlexReport(classShareXml).activities[0]).toMatchObject({
      symbol: "BRK.B",
      providerId: "YAHOO",
      providerSymbol: "BRK-B",
    });
  });

  it("classifies an IBKR disbursement as a withdrawal even when Flex reports a positive amount", () => {
    const disbursementXml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1"><CashTransactions>
      <CashTransaction accountId="U1" currency="AUD" type="Deposits/Withdrawals" description="DISBURSEMENT INITIATED BY account holder" dateTime="20260623;054800" amount="500" transactionID="D1" />
    </CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>`;

    expect(parseIbkrFlexReport(disbursementXml).activities[0]).toMatchObject({
      brokerRecordId: "D1",
      activityType: "WITHDRAWAL",
      amount: 500,
      currency: "AUD",
    });
  });

  it("reports whether the Flex Query contains reconciliation sections", () => {
    const reportXml = `<FlexQueryResponse><FlexStatements><FlexStatement fromDate="20260801" toDate="20260828">
      <AccountInformation currency="AUD" accountCapabilities="Margin" />
      <CashReport><CashReportCurrency currency="AUD" levelOfDetail="Currency" startingCash="0" endingCash="3230.43" /></CashReport>
      <CashReport><CashReportCurrency currency="BASE_SUMMARY" levelOfDetail="BaseCurrency" endingCash="3230.43" /></CashReport>
      <OpenPositions>
        <OpenPosition currency="USD" symbol="ORCL" position="6" markPrice="150.85" positionValue="905.10" levelOfDetail="SUMMARY" />
        <OpenPosition currency="USD" symbol="ORCL" position="6" markPrice="150.85" positionValue="905.10" levelOfDetail="LOT" />
      </OpenPositions>
      <ChangeInNAV currency="AUD" startingValue="0" endingValue="5803.36" />
    </FlexStatement></FlexStatements></FlexQueryResponse>`;

    expect(parseIbkrFlexReport(reportXml).audit).toMatchObject({
      period: { from: "2026-08-01", to: "2026-08-28" },
      baseCurrency: "AUD",
      accountCapabilities: "Margin",
      endingCashByCurrency: { AUD: 3230.43 },
      openPositionValueByCurrency: { USD: 905.1 },
      reportedNavBase: 5803.36,
      openPositions: 1,
      warnings: [],
    });
  });
});

describe("fetchIbkrFlexReport", () => {
  it.each([
    ["global", "ndcdyn.interactivebrokers.com"],
    ["australia", "www.interactivebrokers.com.au"],
  ] as const)("uses the same official %s Flex service for both requests", async (region, host) => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: "<Status>Success</Status><ReferenceCode>R1</ReferenceCode><url>https://example.invalid/unused</url>" })
      .mockResolvedValueOnce({ status: 200, body: XML });
    await fetchIbkrFlexReport({ request }, { queryId: "demo-query", token: "demo-token" }, region);
    const base = `https://${host}/AccountManagement/FlexWebService`;
    expect(request.mock.calls.map(([r]) => r.url.split("?")[0])).toEqual([
      base + "/SendRequest", base + "/GetStatement",
    ]);
  });

  it("requests and downloads a generated report without exposing credentials in errors", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 200, headers: {}, body: "<FlexStatementResponse><Status>Success</Status><ReferenceCode>R1</ReferenceCode></FlexStatementResponse>" })
      .mockResolvedValueOnce({ status: 200, headers: {}, body: XML });
    const { activities: result } = await fetchIbkrFlexReport({ request }, { queryId: "Q1", token: "SECRET" });
    expect(result).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].url).toContain("t=SECRET&q=Q1&v=3&p=365");
    expect(request.mock.calls[0][0].headers).toMatchObject({
      Accept: "application/xml,text/xml",
      "User-Agent": "StockPortfolio",
    });
  });

  it("redacts credentials when the host network layer includes the request URL in an exception", async () => {
    const request = vi.fn().mockRejectedValue(new Error("GET failed: https://example.invalid?t=SECRET&q=Q1"));

    const failure = fetchIbkrFlexReport({ request }, { queryId: "Q1", token: "SECRET" });

    await expect(failure).rejects.toThrow("IBKR report request failed due to a network error.");
    await expect(failure).rejects.not.toThrow(/SECRET|Q1/);
  });
});
