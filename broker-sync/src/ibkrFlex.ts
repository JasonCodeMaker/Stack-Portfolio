import type { NetworkRequest, NetworkResponse } from "@wealthfolio/addon-sdk";
import type { BrokerActivity } from "@/types";

const SEND_URL = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";
const STATEMENT_URL = "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement";
const LOOKBACK_DAYS = 365;
const IBKR_HEADERS = {
  Accept: "application/xml,text/xml",
  "User-Agent": "Wealthfolio-Broker-Sync/0.3.3",
};

export interface IbkrFlexCredentials {
  queryId: string;
  token: string;
}

export interface IbkrFlexNetwork {
  request(request: NetworkRequest): Promise<NetworkResponse>;
}

export interface IbkrFlexAudit {
  period?: { from: string; to: string };
  baseCurrency?: string;
  accountCapabilities?: string;
  endingCashByCurrency: Record<string, number>;
  openPositionValueByCurrency: Record<string, number>;
  reportedNavBase?: number;
  fxExecutions: number;
  openPositions: number;
  statementPositions?: Array<{symbol: string; quantity: string; currency: string; mic?: string; price?: string; fxToBase?: string}>;
  warnings: string[];
}

export interface IbkrFlexReport {
  activities: BrokerActivity[];
  audit: IbkrFlexAudit;
}

function decodeXml(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) result[match[1]] = decodeXml(match[3]);
  return result;
}

function elements(xml: string, tag: string): Array<Record<string, string>> {
  const matcher = new RegExp(`<${tag}\\b([^>]*)/?>`, "gi");
  return [...xml.matchAll(matcher)].map((match) => attributes(match[1]));
}

function elementText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : undefined;
}

function numberValue(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? Math.abs(parsed) : undefined;
}

function signedNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNonZeroSigned(...values: Array<string | undefined>): number | undefined {
  for (const value of values) {
    const parsed = signedNumber(value);
    if (parsed !== undefined && parsed !== 0) return parsed;
  }
  return undefined;
}

function isExecution(row: Record<string, string>): boolean {
  return !row.levelOfDetail || row.levelOfDetail.toUpperCase() === "EXECUTION";
}

function fxConversion(row: Record<string, string>): BrokerActivity[] | undefined {
  if (row.assetCategory?.toUpperCase() !== "CASH") return undefined;
  if (!isExecution(row)) return [];
  const currencies = row.symbol?.trim().toUpperCase().split(/[./]/).filter(Boolean);
  const quantity = numberValue(row.quantity);
  // IBKR CASH executions, including AutoFX, normally report netCash="0" and
  // put the exchanged quote amount in proceeds. A nullish fallback from
  // netCash therefore drops valid conversions.
  const quoteCash = firstNonZeroSigned(row.proceeds, row.tradeMoney, row.netCash);
  if (!currencies || currencies.length !== 2 || !quantity || !quoteCash || !row.buySell) {
    throw new Error("IBKR CASH execution is missing its currency pair, side, quantity, or proceeds. Add Trades → Executions with all fields to the Flex Query.");
  }

  const [baseCurrency, quoteCurrency] = currencies;
  const isBuy = row.buySell.toUpperCase().startsWith("B");
  const sourceCurrency = isBuy ? quoteCurrency : baseCurrency;
  const destinationCurrency = isBuy ? baseCurrency : quoteCurrency;
  const sourceAmount = isBuy ? Math.abs(quoteCash) : quantity;
  const destinationAmount = isBuy ? quantity : Math.abs(quoteCash);
  const recordId = row.ibExecID || row.tradeID || row.transactionID || stableFallback([
    row.accountId, row.dateTime, row.symbol, row.quantity, row.proceeds, row.tradePrice,
  ]);
  const sourceGroupId = `ibkr-fx:${recordId}`;
  const fee = numberValue(row.ibCommission);
  const feeCurrency = (row.ibCommissionCurrency || row.currency)?.toUpperCase();
  const tax = numberValue(row.taxes);
  const taxCurrency = (row.taxCurrency || row.currency)?.toUpperCase();
  const metadata = {
    flow: { is_external: false },
    fx: {
      sourceCurrency,
      destinationCurrency,
      sourceAmount: String(sourceAmount),
      destinationAmount: String(destinationAmount),
      impliedRate: String(destinationAmount / sourceAmount),
      rateSource: "implied_from_ibkr_flex",
    },
  };
  const common = {
    broker: "ibkr" as const,
    date: flexDate(row.dateTime || row.tradeDate),
    symbol: "",
    sourceGroupId,
    metadata,
    comment: "FX Conversion",
  };
  const activities: BrokerActivity[] = [
    {
      ...common,
      brokerRecordId: `${recordId}:in`,
      activityType: "TRANSFER_IN",
      amount: destinationAmount,
      currency: destinationCurrency,
      fee: feeCurrency === destinationCurrency ? fee : undefined,
      tax: taxCurrency === destinationCurrency ? tax : undefined,
    },
    {
      ...common,
      brokerRecordId: `${recordId}:out`,
      activityType: "TRANSFER_OUT",
      amount: sourceAmount,
      currency: sourceCurrency,
      fee: feeCurrency === sourceCurrency ? fee : undefined,
      tax: taxCurrency === sourceCurrency ? tax : undefined,
    },
  ];
  if (fee && feeCurrency && feeCurrency !== sourceCurrency && feeCurrency !== destinationCurrency) {
    activities.push({
      broker: "ibkr",
      brokerRecordId: `${recordId}:fee`,
      activityType: "FEE",
      date: common.date,
      symbol: "",
      amount: fee,
      currency: feeCurrency,
      comment: "IBKR FX commission",
    });
  }
  if (tax && taxCurrency && taxCurrency !== sourceCurrency && taxCurrency !== destinationCurrency) {
    activities.push({
      broker: "ibkr",
      brokerRecordId: `${recordId}:tax`,
      activityType: "TAX",
      date: common.date,
      symbol: "",
      amount: tax,
      currency: taxCurrency,
      comment: "IBKR FX tax",
    });
  }
  return activities;
}

function flexDate(value?: string): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 8) throw new Error("IBKR record is missing a valid date.");
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return digits.length >= 14 ? `${date}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}Z` : `${date}T12:00:00Z`;
}

function stableFallback(parts: Array<string | undefined>): string {
  let hash = 2166136261;
  for (const char of parts.join("|").toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

function mic(exchange?: string): string | undefined {
  const normalized = exchange?.trim().toUpperCase();
  const known: Record<string, string> = {
    NASDAQ: "XNAS", ISLAND: "XNAS", NYSE: "XNYS", ARCA: "ARCX", AMEX: "XASE",
    LSE: "XLON", ASX: "XASX", TSE: "XTSE", TSX: "XTSE",
  };
  return normalized ? known[normalized] ?? (/^X[A-Z0-9]{3}$/.test(normalized) ? normalized : undefined) : undefined;
}

function instrumentType(category?: string): string | undefined {
  const known: Record<string, string> = { STK: "EQUITY", OPT: "OPTION", BOND: "BOND", FUT: "FUTURE", CASH: "FX", CFD: "EQUITY", FUND: "EQUITY" };
  return category ? known[category.toUpperCase()] : undefined;
}

function yahooProviderSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/^([A-Z0-9]+)[ .]([A-Z])$/, "$1-$2");
}

function canonicalSecuritySymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/^([A-Z0-9]+) ([A-Z])$/, "$1.$2");
}

function cashType(row: Record<string, string>): BrokerActivity["activityType"] {
  const value = `${row.type ?? ""} ${row.description ?? ""}`.toLowerCase();
  const amount = Number(row.amount ?? "0");
  if (value.includes("withholding") || value.includes("tax")) return "TAX";
  if (value.includes("dividend")) return "DIVIDEND";
  if (value.includes("interest")) return amount < 0 ? "FEE" : "INTEREST";
  if (value.includes("fee") || value.includes("commission")) return "FEE";
  if (value.includes("disbursement")) return "WITHDRAWAL";
  if (value.includes("deposit") && value.includes("withdraw")) return amount >= 0 ? "DEPOSIT" : "WITHDRAWAL";
  if (value.includes("withdraw")) return "WITHDRAWAL";
  if (value.includes("deposit")) return "DEPOSIT";
  return amount >= 0 ? "DEPOSIT" : "WITHDRAWAL";
}

function cashImportRevision(row: Record<string, string>, type: BrokerActivity["activityType"]): string | undefined {
  const value = `${row.type ?? ""} ${row.description ?? ""}`.toLowerCase();
  const amount = signedNumber(row.amount) ?? 0;
  if (type === "TAX" && value.includes("dividend")) return "cash-semantics-v2";
  if (type === "FEE" && value.includes("interest") && amount < 0) return "cash-semantics-v2";
  if (type === "WITHDRAWAL" && value.includes("deposit") && value.includes("withdraw") && amount < 0) return "cash-semantics-v2";
  return undefined;
}

function assertSingleBrokerAccount(xml: string): void {
  const accountIds = new Set([
    ...elements(xml, "FlexStatement"),
    ...elements(xml, "AccountInformation"),
    ...elements(xml, "Trade"),
    ...elements(xml, "CashTransaction"),
  ].map((row) => row.accountId).filter((id): id is string => Boolean(id)));
  if (accountIds.size > 1) {
    throw new Error("IBKR Flex response must contain exactly one broker account. Create a separate Query and mapping for each account.");
  }
}

function parseIbkrActivities(xml: string): BrokerActivity[] {
  if (!/<FlexStatement\b/i.test(xml)) throw new Error("IBKR response is not an Activity Flex XML statement.");
  assertSingleBrokerAccount(xml);
  const activities: BrokerActivity[] = [];
  const tradeRows = elements(xml, "Trade");
  const taxedTradeIds = new Set(tradeRows
    .filter((row) => Boolean(numberValue(row.taxes)))
    .map((row) => row.tradeID)
    .filter((id): id is string => Boolean(id)));

  for (const row of tradeRows) {
    if (!isExecution(row)) continue;
    const conversion = fxConversion(row);
    if (conversion) {
      activities.push(...conversion);
      continue;
    }
    const rawSymbol = row.symbol?.trim();
    if (!rawSymbol || !row.buySell) continue;
    const symbol = canonicalSecuritySymbol(rawSymbol);
    activities.push({
      broker: "ibkr",
      brokerRecordId: row.ibExecID || row.tradeID || row.transactionID || stableFallback([row.accountId, row.dateTime, symbol, row.buySell, row.quantity, row.tradePrice]),
      activityType: row.buySell.toUpperCase().startsWith("B") ? "BUY" : "SELL",
      date: flexDate(row.dateTime || row.tradeDate),
      symbol,
      symbolName: row.description,
      exchangeMic: mic(row.listingExchange || row.exchange),
      quoteCcy: row.currency,
      instrumentType: instrumentType(row.assetCategory),
      quoteMode: "MARKET",
      providerId: "YAHOO",
      providerSymbol: yahooProviderSymbol(symbol),
      quantity: numberValue(row.quantity),
      unitPrice: numberValue(row.tradePrice),
      fee: numberValue(row.ibCommission),
      tax: numberValue(row.taxes),
      currency: row.currency || row.ibCommissionCurrency || "USD",
      comment: `IBKR Flex trade ${row.tradeID || row.ibExecID || ""}`.trim(),
    });
  }

  for (const row of elements(xml, "CashTransaction")) {
    const type = cashType(row);
    const symbol = row.symbol ? canonicalSecuritySymbol(row.symbol) : "";
    activities.push({
      broker: "ibkr",
      brokerRecordId: row.transactionID || stableFallback([row.accountId, row.dateTime, row.type, row.description, row.amount, row.currency, row.symbol]),
      activityType: type,
      date: flexDate(row.dateTime || row.date || row.settleDate),
      symbol: type === "DIVIDEND" ? symbol : "",
      symbolName: row.description,
      quoteCcy: row.currency,
      quoteMode: symbol ? "MARKET" : undefined,
      providerId: symbol ? "YAHOO" : undefined,
      providerSymbol: symbol ? yahooProviderSymbol(symbol) : undefined,
      amount: numberValue(row.amount),
      currency: row.currency || "USD",
      comment: row.description || `IBKR Flex ${type.toLowerCase()}`,
      importRevision: cashImportRevision(row, type),
    });
  }

  const transactionTaxRows = [
    ...elements(xml, "TransactionTax"),
    ...elements(xml, "TransactionTaxDetail"),
    // Compatibility with early Broker Sync fixtures; IBKR calls the XML
    // container TransactionTaxes and its records TransactionTax.
    ...elements(xml, "TransactionFee"),
  ];
  const summaryTaxes = transactionTaxRows.filter((row) => row.levelOfDetail?.toUpperCase() === "SUMMARY");
  const taxesToImport = summaryTaxes.length > 0 ? summaryTaxes : transactionTaxRows;
  for (const row of taxesToImport) {
    const relatedTradeId = row.tradeId || row.tradeID;
    if (relatedTradeId && taxedTradeIds.has(relatedTradeId)) continue;
    const recordId = row.transactionID
      ? `${row.transactionID}:tax`
      : stableFallback([
        row.accountId, relatedTradeId, row.reportDate, row.date, row.taxDescription, row.taxAmount, row.currency,
      ]);
    activities.push({
      broker: "ibkr",
      brokerRecordId: recordId,
      activityType: "TAX",
      date: flexDate(row.reportDate || row.date || row.dateTime),
      symbol: "",
      amount: numberValue(row.taxAmount || row.amount),
      currency: row.currency || "USD",
      comment: row.taxDescription || row.description || row.type || "IBKR transaction fee",
    });
  }

  return activities;
}

function flexDay(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : undefined;
}

export function parseIbkrFlexReport(xml: string): IbkrFlexReport {
  const activities = parseIbkrActivities(xml);
  const statement = elements(xml, "FlexStatement")[0] ?? {};
  const account = elements(xml, "AccountInformation")[0] ?? {};
  const baseCurrency = (statement.baseCurrency || account.currency)?.toUpperCase() || undefined;
  const from = flexDay(statement.fromDate);
  const to = flexDay(statement.toDate);
  const endingCashByCurrency: Record<string, number> = {};
  for (const row of elements(xml, "CashReportCurrency")) {
    const currency = row.currency?.toUpperCase();
    const endingCash = signedNumber(row.endingCash);
    if (!currency || currency === "BASE_SUMMARY" || row.levelOfDetail?.toUpperCase() === "BASECURRENCY" || endingCash === undefined) continue;
    endingCashByCurrency[currency] = endingCash;
  }
  const openPositionValueByCurrency: Record<string, number> = {};
  const allOpenPositionRows = elements(xml, "OpenPosition");
  const summaryOpenPositionRows = allOpenPositionRows.filter((row) => row.levelOfDetail?.toUpperCase() === "SUMMARY");
  const openPositionRows = summaryOpenPositionRows.length > 0 ? summaryOpenPositionRows : allOpenPositionRows;
  for (const row of openPositionRows) {
    const currency = row.currency?.toUpperCase();
    const positionValue = signedNumber(row.positionValue);
    if (!currency || positionValue === undefined) continue;
    openPositionValueByCurrency[currency] = (openPositionValueByCurrency[currency] ?? 0) + positionValue;
  }

  const navRows = elements(xml, "ChangeInNAV");
  const nav = navRows.find((row) => !baseCurrency || row.currency?.toUpperCase() === baseCurrency) ?? navRows[0];
  const equityRows = elements(xml, "EquitySummaryByReportDateInBase");
  const reportedNavBase = signedNumber(nav?.endingValue)
    ?? signedNumber(equityRows.at(-1)?.total);
  const warnings: string[] = [];
  if (!baseCurrency) warnings.push("IBKR Flex Query is missing Account Information currency.");
  if (Object.keys(endingCashByCurrency).length === 0) warnings.push("IBKR Flex Query is missing Cash Report currency balances; cash cannot be reconciled.");
  if (!/<OpenPositions\b/i.test(xml)) warnings.push("IBKR Flex Query is missing Open Positions; broker marks cannot be compared with Wealthfolio quotes.");
  if (reportedNavBase === undefined) warnings.push("IBKR Flex Query is missing Change in NAV (or NAV in Base); total value cannot be reconciled.");

  return {
    activities,
    audit: {
      period: from && to ? { from, to } : undefined,
      baseCurrency,
      accountCapabilities: account.accountCapabilities || undefined,
      endingCashByCurrency,
      openPositionValueByCurrency,
      reportedNavBase,
      fxExecutions: elements(xml, "Trade").filter((row) => row.assetCategory?.toUpperCase() === "CASH" && isExecution(row)).length,
      openPositions: openPositionRows.length,
      statementPositions: /<OpenPositions\b/i.test(xml) ? openPositionRows
        .filter(row => row.symbol && row.position !== undefined && row.currency)
        .map(row => ({symbol: canonicalSecuritySymbol(row.symbol), quantity: row.position, currency: row.currency,
          mic: mic(row.listingExchange || row.exchange), price: row.markPrice, fxToBase: row.fxRateToBase})) : undefined,
      warnings,
    },
  };
}

export function parseIbkrFlexStatement(xml: string): BrokerActivity[] {
  return parseIbkrFlexReport(xml).activities;
}

function assertSuccess(response: NetworkResponse, step: string): void {
  if (response.status < 200 || response.status >= 300) throw new Error(`IBKR ${step} failed with HTTP ${response.status}.`);
}

async function safeNetworkRequest(
  network: IbkrFlexNetwork,
  request: NetworkRequest,
  step: string,
): Promise<NetworkResponse> {
  try {
    return await network.request(request);
  } catch {
    // Host/network exceptions may echo the full URL, which contains the Flex
    // token and Query ID. Never propagate their message to the UI.
    throw new Error(`IBKR ${step} failed due to a network error.`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchIbkrFlexReport(network: IbkrFlexNetwork, credentials: IbkrFlexCredentials): Promise<IbkrFlexReport> {
  const query = encodeURIComponent(credentials.queryId.trim());
  const token = encodeURIComponent(credentials.token.trim());
  const requested = await safeNetworkRequest(network, {
    url: `${SEND_URL}?t=${token}&q=${query}&v=3&p=${LOOKBACK_DAYS}`,
    method: "GET",
    headers: IBKR_HEADERS,
  }, "report request");
  assertSuccess(requested, "report request");
  if (elementText(requested.body, "Status")?.toLowerCase() !== "success") {
    const code = elementText(requested.body, "ErrorCode") ?? "unknown";
    throw new Error(`IBKR rejected the Flex request (code ${code}). Check the Query ID and token.`);
  }
  const reference = elementText(requested.body, "ReferenceCode");
  if (!reference) throw new Error("IBKR did not return a Flex reference code.");

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) await delay(1000 * attempt);
    const statement = await safeNetworkRequest(network, {
      url: `${STATEMENT_URL}?t=${token}&q=${encodeURIComponent(reference)}&v=3`,
      method: "GET",
      headers: IBKR_HEADERS,
    }, "statement download");
    assertSuccess(statement, "statement download");
    if (/<FlexStatement\b/i.test(statement.body)) return parseIbkrFlexReport(statement.body);
    const code = elementText(statement.body, "ErrorCode");
    if (code !== "1019" && code !== "1003") throw new Error(`IBKR could not generate the statement (code ${code ?? "unknown"}).`);
  }
  throw new Error("IBKR statement is still being generated. Wait a minute and try again.");
}

export async function fetchIbkrFlexActivities(network: IbkrFlexNetwork, credentials: IbkrFlexCredentials): Promise<BrokerActivity[]> {
  return (await fetchIbkrFlexReport(network, credentials)).activities;
}
