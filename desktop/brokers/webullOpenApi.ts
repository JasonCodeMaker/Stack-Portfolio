import type { NetworkClient, NetworkResponse } from "../networkTypes";
import type { BrokerActivity } from "./types";

const WEBULL_HOST = "api.webull.com.au";
const WEBULL_BASE_URL = `https://${WEBULL_HOST}`;

export interface WebullCredentials {
  appKey: string;
  appSecret: string;
  accessToken?: string;
}

export interface WebullTokenResult {
  token: string;
  status: "PENDING" | "NORMAL" | "INVALID" | "EXPIRED";
  expiresAt?: number;
}

export interface WebullAccount {
  accountId: string;
  accountNumber: string;
  accountType?: string;
}

interface SignatureInput {
  path: string;
  query?: Record<string, string>;
  body?: string;
  appKey: string;
  appSecret: string;
  host?: string;
  timestamp: string;
  nonce: string;
}

interface SignedRequestOptions {
  path: string;
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  accessToken?: string;
}

type JsonObject = Record<string, unknown>;

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function generateWebullSignature(input: SignatureInput): Promise<string> {
  const host = input.host ?? WEBULL_HOST;
  const parameters: Record<string, string> = {
    ...(input.query ?? {}),
    host,
    "x-app-key": input.appKey,
    "x-signature-algorithm": "HMAC-SHA256",
    "x-signature-nonce": input.nonce,
    "x-signature-version": "1.0",
    "x-timestamp": input.timestamp,
  };
  const joined = Object.keys(parameters).sort().map((key) => `${key}=${parameters[key]}`).join("&");
  const bodyHash = input.body ? `&${await sha256Hex(input.body)}` : "";
  const message = rfc3986Encode(`${input.path}&${joined}${bodyHash}`);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${input.appSecret}&`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function requestTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function requestNonce(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function queryString(query?: Record<string, string>): string {
  if (!query) return "";
  const entries = Object.entries(query).filter(([, value]) => value !== "").sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? `?${entries.map(([key, value]) => `${rfc3986Encode(key)}=${rfc3986Encode(value)}`).join("&")}` : "";
}

// Webull's rate limit reference puts production order history, open orders, and
// order detail at 2 requests per 2 seconds per app key, though the AU Trading API
// overview still advertises 40/2s. Space order queries a little over a second
// apart so a window that counts both edges never sees a third request.
const ORDER_QUERY_INTERVAL_MS = 1100;
// A throttled request is rejected outright, so wait out at least one full
// window before retrying, then back off.
const RATE_LIMIT_BACKOFF_MS = 2000;
const RATE_LIMIT_RETRIES = 3;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Webull has answered a throttled call with only a "to many requests" body, so
// the status alone cannot be trusted to flag rate limiting.
function isRateLimited(response: NetworkResponse): boolean {
  if (response.status >= 200 && response.status < 300) return false;
  return response.status === 429 || /\btoo?[ _]many[ _]requests\b/i.test(response.body);
}

async function signedRequest(
  network: NetworkClient,
  credentials: WebullCredentials,
  options: SignedRequestOptions,
): Promise<NetworkResponse> {
  for (let attempt = 0; ; attempt += 1) {
    // Each attempt is re-signed: Webull rejects a reused signature nonce.
    const response = await sendSignedRequest(network, credentials, options);
    if (!isRateLimited(response) || attempt >= RATE_LIMIT_RETRIES) return response;
    await delay(RATE_LIMIT_BACKOFF_MS * 2 ** attempt);
  }
}

async function sendSignedRequest(
  network: NetworkClient,
  credentials: WebullCredentials,
  options: SignedRequestOptions,
): Promise<NetworkResponse> {
  const timestamp = requestTimestamp();
  const nonce = requestNonce();
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const signature = await generateWebullSignature({
    path: options.path,
    query: options.query,
    body,
    appKey: credentials.appKey.trim(),
    appSecret: credentials.appSecret.trim(),
    timestamp,
    nonce,
  });
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-app-key": credentials.appKey.trim(),
    "x-timestamp": timestamp,
    "x-signature": signature,
    "x-signature-algorithm": "HMAC-SHA256",
    "x-signature-version": "1.0",
    "x-signature-nonce": nonce,
    "x-version": "v2",
  };
  if (body) headers["Content-Type"] = "application/json";
  if (options.accessToken) headers["x-access-token"] = options.accessToken;
  return network.request({
    url: `${WEBULL_BASE_URL}${options.path}${queryString(options.query)}`,
    method: options.method,
    headers,
    body,
  });
}

async function requestWithLegacyFallback(
  network: NetworkClient,
  credentials: WebullCredentials,
  primary: SignedRequestOptions,
  legacyPath: string,
): Promise<NetworkResponse> {
  const response = await signedRequest(network, credentials, primary);
  if (response.status !== 404) return response;
  return signedRequest(network, credentials, { ...primary, path: legacyPath });
}

function requireSuccess(response: NetworkResponse, operation: string): void {
  if (response.status >= 200 && response.status < 300) return;
  if (isRateLimited(response)) {
    throw new Error(`Webull kept rate-limiting the ${operation}. Wait a minute, then sync again.`);
  }
  throw new Error(`Webull ${operation} failed with HTTP ${response.status}.`);
}

function parseJson(response: NetworkResponse): unknown {
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new Error("Webull returned an invalid JSON response.");
  }
}

function unwrapData(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) return (value as JsonObject).data;
  return value;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function parseToken(response: NetworkResponse): WebullTokenResult {
  const object = asObject(unwrapData(parseJson(response)));
  const token = stringValue(object?.token);
  const status = stringValue(object?.status).toUpperCase();
  if (!token || !["PENDING", "NORMAL", "INVALID", "EXPIRED"].includes(status)) {
    throw new Error("Webull returned an unrecognized token response.");
  }
  const expiresAt = Number(object?.expires_at ?? object?.expiresAt);
  return { token, status: status as WebullTokenResult["status"], expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined };
}

export async function createWebullToken(network: NetworkClient, credentials: WebullCredentials): Promise<WebullTokenResult> {
  const response = await requestWithLegacyFallback(network, credentials, {
    path: "/auth/tokens/create",
    method: "POST",
  }, "/openapi/auth/token/create");
  requireSuccess(response, "token creation");
  return parseToken(response);
}

export async function checkWebullToken(
  network: NetworkClient,
  credentials: WebullCredentials,
  token: string,
): Promise<WebullTokenResult> {
  const response = await requestWithLegacyFallback(network, credentials, {
    path: "/auth/tokens/check",
    method: "POST",
    body: { token },
  }, "/openapi/auth/token/check");
  requireSuccess(response, "token check");
  return parseToken(response);
}

export async function listWebullAccounts(
  network: NetworkClient,
  credentials: WebullCredentials & { accessToken: string },
): Promise<WebullAccount[]> {
  const response = await requestWithLegacyFallback(network, credentials, {
    path: "/trading/accounts/list",
    method: "GET",
    accessToken: credentials.accessToken,
  }, "/openapi/account/list");
  requireSuccess(response, "account lookup");
  const data = unwrapData(parseJson(response));
  if (!Array.isArray(data)) throw new Error("Webull returned an unrecognized account list.");
  return data.flatMap((item): WebullAccount[] => {
    const object = asObject(item);
    const accountId = stringValue(object?.account_id ?? object?.accountId);
    if (!accountId) return [];
    return [{
      accountId,
      accountNumber: stringValue(object?.account_number ?? object?.accountNumber) || accountId,
      accountType: stringValue(object?.account_type ?? object?.accountType) || undefined,
    }];
  });
}

function sixMonthsAgo(): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 6);
  return date.toISOString().slice(0, 10);
}

function ordersFromResponse(value: unknown): JsonObject[] {
  const data = unwrapData(value);
  const groups = Array.isArray(data)
    ? data
    : Array.isArray(asObject(data)?.orders) ? asObject(data)?.orders as unknown[] : [];
  return groups.flatMap((group): JsonObject[] => {
    const object = asObject(group);
    const nested = object?.orders;
    if (Array.isArray(nested)) return nested.flatMap((order) => asObject(order) ? [asObject(order) as JsonObject] : []);
    return object ? [object] : [];
  });
}

interface WebullListing {
  exchangeMic?: string;
  currency: string;
  yahooSuffix: string;
  // Set when the listing differs from the US default every order was forced
  // onto before 0.3.4, so a repeat sync repairs those stored activities instead
  // of leaving them priced against the wrong Yahoo ticker.
  importRevision?: string;
}

// Webull Australia's order endpoints report no exchange, so a bare ticker is
// ambiguous: Yahoo prices `IVV` as the NYSE Arca fund, not the ASX one an AU
// brokerage account actually holds. Fall back to the ASX listing this host
// serves, and only leave a security on the US listing when the order says so.
const ASX_LISTING: WebullListing = {
  exchangeMic: "XASX",
  currency: "AUD",
  yahooSuffix: ".AX",
  importRevision: "webull-listing-v2",
};
const US_LISTING: WebullListing = { currency: "USD", yahooSuffix: "" };

const LISTING_BY_CURRENCY: Record<string, WebullListing> = {
  AUD: ASX_LISTING,
  USD: US_LISTING,
};

function webullListing(currency: string): WebullListing {
  const normalized = currency.trim().toUpperCase();
  if (!normalized) return ASX_LISTING;
  return LISTING_BY_CURRENCY[normalized] ?? { currency: normalized, yahooSuffix: "" };
}

function orderListing(order: JsonObject): WebullListing {
  return webullListing(firstString(
    order.currency, order.currency_code, order.currencyCode, order.trade_currency, order.tradeCurrency,
  ));
}

// The ledger stores the unsuffixed ticker next to its MIC, so a symbol
// Webull already qualified must not be stored - or re-suffixed - as `IVV.AX.AX`.
function canonicalWebullSymbol(symbol: string, listing: WebullListing): string {
  return listing.yahooSuffix && symbol.endsWith(listing.yahooSuffix)
    ? symbol.slice(0, -listing.yahooSuffix.length)
    : symbol;
}

function webullProviderSymbol(symbol: string, listing: WebullListing): string {
  return `${symbol.replace(/^([A-Z0-9]+)[ .]([A-Z])$/, "$1-$2")}${listing.yahooSuffix}`;
}

export function parseWebullOrderHistory(value: unknown): BrokerActivity[] {
  return ordersFromResponse(value).flatMap((order): BrokerActivity[] => {
    const status = stringValue(order.status).toUpperCase();
    const side = stringValue(order.side).toUpperCase();
    const listing = orderListing(order);
    const symbol = canonicalWebullSymbol(stringValue(order.symbol).trim().toUpperCase(), listing);
    const quantity = Number(order.filled_quantity ?? order.filledQuantity);
    const unitPrice = Number(order.filled_price ?? order.filledPrice);
    const date = stringValue(order.filled_time_at ?? order.filledTimeAt ?? order.place_time_at ?? order.placeTimeAt);
    const recordId = stringValue(order.order_id ?? order.orderId ?? order.client_order_id ?? order.clientOrderId);
    if (status !== "FILLED" || !["BUY", "SELL"].includes(side) || !symbol || !recordId || !date) return [];
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return [];
    return [{
      broker: "webull",
      brokerRecordId: recordId,
      activityType: side === "BUY" ? "BUY" : "SELL",
      date,
      symbol,
      exchangeMic: listing.exchangeMic,
      quoteCcy: listing.currency,
      instrumentType: "EQUITY",
      quoteMode: "MARKET",
      providerId: "YAHOO",
      providerSymbol: webullProviderSymbol(symbol, listing),
      quantity,
      unitPrice,
      fee: 0,
      tax: 0,
      currency: listing.currency,
      comment: `Webull order ${recordId}`,
      importRevision: listing.importRevision,
      metadata: {
        webullStatus: status,
        webullSide: side,
        webullClientOrderId: stringValue(order.client_order_id ?? order.clientOrderId),
      },
    }];
  });
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.abs(number) : 0;
}

export function webullOrderFee(order: JsonObject): { total: number; breakdown: Record<string, number> } {
  const commission = asObject(order.commission);
  const actualCommission = numberOrZero(commission?.actual_commission ?? commission?.actualCommission);
  const breakdown: Record<string, number> = {};
  if (actualCommission > 0) breakdown.COMMISSION = actualCommission;
  const fees = Array.isArray(order.fees) ? order.fees : [];
  for (const rawFee of fees) {
    const fee = asObject(rawFee);
    const type = stringValue(fee?.type).trim().toUpperCase() || "OTHER";
    const value = numberOrZero(fee?.actual_value ?? fee?.actualValue);
    if (value <= 0 || type.includes("COMMISSION")) continue;
    breakdown[type] = (breakdown[type] ?? 0) + value;
  }
  return { total: Object.values(breakdown).reduce((total, value) => total + value, 0), breakdown };
}

async function enrichWithOrderDetail(
  network: NetworkClient,
  credentials: WebullCredentials & { accessToken: string; accountId: string },
  activity: BrokerActivity,
): Promise<BrokerActivity> {
  const clientOrderId = stringValue(activity.metadata?.webullClientOrderId);
  if (!clientOrderId) throw new Error(`Webull order ${activity.brokerRecordId} is missing its client order ID.`);
  const query = { account_id: credentials.accountId, client_order_id: clientOrderId };
  const response = await requestWithLegacyFallback(network, credentials, {
    path: "/trading/orders/get",
    method: "GET",
    query,
    accessToken: credentials.accessToken,
  }, "/openapi/trade/order/detail");
  requireSuccess(response, `order detail request for ${activity.symbol}`);
  const detail = ordersFromResponse(parseJson(response)).find((order) =>
    stringValue(order.order_id ?? order.orderId) === activity.brokerRecordId,
  );
  if (!detail) throw new Error(`Webull did not return details for order ${activity.brokerRecordId}.`);
  const fee = webullOrderFee(detail);
  return {
    ...activity,
    fee: fee.total,
    metadata: { ...activity.metadata, webullFeeBreakdown: fee.breakdown },
  };
}

async function fetchWebullOrderActivities(
  network: NetworkClient,
  credentials: WebullCredentials & { accessToken: string; accountId: string },
): Promise<BrokerActivity[]> {
  const all: BrokerActivity[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    if (page > 0) await delay(ORDER_QUERY_INTERVAL_MS);
    const query: Record<string, string> = {
      account_id: credentials.accountId,
      start_date: sixMonthsAgo(),
      page_size: "100",
    };
    if (cursor) query.last_client_order_id = cursor;
    const response = await requestWithLegacyFallback(network, credentials, {
      path: "/trading/orders/historical-orders/list",
      method: "GET",
      query,
      accessToken: credentials.accessToken,
    }, "/openapi/trade/order/history");
    requireSuccess(response, "order history request");
    const json = parseJson(response);
    const data = unwrapData(json);
    const groups = Array.isArray(data) ? data : [];
    all.push(...parseWebullOrderHistory(json));
    if (groups.length < 100) break;
    const lastGroup = asObject(groups.at(-1));
    const nextCursor = stringValue(lastGroup?.client_order_id ?? lastGroup?.clientOrderId);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  const enriched: BrokerActivity[] = [];
  for (const activity of all) {
    if (enriched.length > 0) await delay(ORDER_QUERY_INTERVAL_MS);
    enriched.push(await enrichWithOrderDetail(network, credentials, activity));
  }
  return enriched;
}

const CASH_ACTIVITY_PATH = "/trading/activities/cash-activities/list";
// The official SDK still builds the pre-`/trading` path. Webull answers only one
// of the two, and which one depends on the market the account belongs to.
const LEGACY_CASH_ACTIVITY_PATH = "/openapi/trade/activities/cash";
const UNSETTLED_STATUSES = new Set([
  "PENDING", "PROCESSING", "IN_PROGRESS", "SUBMITTED", "FAILED", "FAILURE",
  "CANCELLED", "CANCELED", "REJECTED", "EXPIRED", "VOID", "VOIDED",
]);

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text) return text;
  }
  return "";
}

function signedNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = signedNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function stableFallback(parts: Array<string | undefined>): string {
  let hash = 2166136261;
  for (const character of parts.join("|").toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

function cashActivityDate(row: JsonObject): string {
  const raw = firstString(
    row.activity_time_at, row.activityTimeAt, row.settle_time_at, row.settleTimeAt,
    row.trade_time_at, row.tradeTimeAt, row.create_time_at, row.createTimeAt,
    row.activity_time, row.activityTime, row.settle_date, row.settleDate,
    row.trade_date, row.tradeDate, row.date,
  );
  if (!raw) return "";
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString();
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString();
  // A settlement day carries no clock time; anchor it at midday UTC so a local
  // timezone cannot push the activity onto the neighbouring day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00Z`;
  return raw;
}

function isCurrencyConversion(haystack: string): boolean {
  return /\bfx\b/.test(haystack) || haystack.includes("exchange")
    || haystack.includes("conversion") || haystack.includes("convert");
}

function cashActivityType(haystack: string, amount: number): BrokerActivity["activityType"] {
  if (haystack.includes("withholding") || haystack.includes("tax")) return "TAX";
  if (haystack.includes("dividend")) return "DIVIDEND";
  if (haystack.includes("interest")) return amount < 0 ? "FEE" : "INTEREST";
  if (haystack.includes("fee") || haystack.includes("commission") || haystack.includes("charge")) return "FEE";
  // A currency conversion moves money inside the same account, so it must not
  // land on DEPOSIT/WITHDRAWAL and inflate net contribution.
  if (isCurrencyConversion(haystack)) return amount < 0 ? "TRANSFER_OUT" : "TRANSFER_IN";
  if (haystack.includes("deposit") && haystack.includes("withdraw")) return amount < 0 ? "WITHDRAWAL" : "DEPOSIT";
  if (haystack.includes("withdraw") || haystack.includes("disbursement")) return "WITHDRAWAL";
  if (haystack.includes("deposit")) return "DEPOSIT";
  return amount < 0 ? "WITHDRAWAL" : "DEPOSIT";
}

function currencyConversionPair(
  row: JsonObject,
  recordId: string,
  date: string,
  description: string,
): BrokerActivity[] | undefined {
  const sourceCurrency = firstString(
    row.from_currency, row.fromCurrency, row.source_currency, row.sourceCurrency,
  ).toUpperCase();
  const destinationCurrency = firstString(
    row.to_currency, row.toCurrency, row.target_currency, row.targetCurrency,
    row.destination_currency, row.destinationCurrency,
  ).toUpperCase();
  const sourceAmount = Math.abs(firstNumber(
    row.from_amount, row.fromAmount, row.source_amount, row.sourceAmount,
  ) ?? 0);
  const destinationAmount = Math.abs(firstNumber(
    row.to_amount, row.toAmount, row.target_amount, row.targetAmount,
    row.destination_amount, row.destinationAmount,
  ) ?? 0);
  if (!sourceCurrency || !destinationCurrency || !sourceAmount || !destinationAmount) return undefined;
  if (sourceCurrency === destinationCurrency) return undefined;

  const common = {
    broker: "webull" as const,
    date,
    symbol: "",
    sourceGroupId: `webull-fx:${recordId}`,
    comment: description || "Currency Exchange",
    metadata: {
      flow: { is_external: false },
      fx: {
        sourceCurrency,
        destinationCurrency,
        sourceAmount: String(sourceAmount),
        destinationAmount: String(destinationAmount),
        impliedRate: String(destinationAmount / sourceAmount),
        rateSource: "implied_from_webull_activity",
      },
    },
  };
  return [
    {
      ...common,
      brokerRecordId: `${recordId}:out`,
      activityType: "TRANSFER_OUT",
      amount: sourceAmount,
      currency: sourceCurrency,
    },
    {
      ...common,
      brokerRecordId: `${recordId}:in`,
      activityType: "TRANSFER_IN",
      amount: destinationAmount,
      currency: destinationCurrency,
    },
  ];
}

function cashActivityFromRow(row: JsonObject): BrokerActivity[] {
  const status = firstString(row.status, row.activity_status, row.activityStatus).toUpperCase();
  if (UNSETTLED_STATUSES.has(status)) return [];
  const date = cashActivityDate(row);
  if (!date) return [];

  const description = firstString(row.description, row.remark, row.memo, row.detail);
  const rawType = firstString(row.activity_type, row.activityType, row.type);
  const subType = firstString(row.sub_type, row.subType);
  const recordId = `cash:${
    firstString(row.activity_id, row.activityId, row.id, row.transaction_id, row.transactionId)
    || stableFallback([date, rawType, subType, description, firstString(row.amount), firstString(row.currency)])
  }`;

  const conversion = currencyConversionPair(row, recordId, date, description);
  if (conversion) return conversion;

  const amount = firstNumber(row.amount, row.net_amount, row.netAmount, row.value);
  if (amount === undefined || amount === 0) return [];
  const haystack = `${rawType} ${subType} ${description}`.replaceAll("_", " ").toLowerCase();
  const activityType = cashActivityType(haystack, amount);
  const listing = webullListing(firstString(row.currency, row.currency_code, row.currencyCode));
  const currency = listing.currency;
  const symbol = activityType === "DIVIDEND"
    ? canonicalWebullSymbol(firstString(row.symbol, row.ticker).toUpperCase(), listing)
    : "";
  const internal = activityType === "TRANSFER_IN" || activityType === "TRANSFER_OUT";

  return [{
    broker: "webull",
    brokerRecordId: recordId,
    activityType,
    date,
    symbol,
    symbolName: description || undefined,
    exchangeMic: symbol ? listing.exchangeMic : undefined,
    quoteCcy: currency,
    quoteMode: symbol ? "MARKET" : undefined,
    providerId: symbol ? "YAHOO" : undefined,
    providerSymbol: symbol ? webullProviderSymbol(symbol, listing) : undefined,
    amount: Math.abs(amount),
    currency,
    comment: description || `Webull ${activityType.toLowerCase().replaceAll("_", " ")}`,
    metadata: {
      webullActivityType: rawType || undefined,
      webullActivityStatus: status || undefined,
      ...(internal ? { flow: { is_external: false } } : {}),
    },
  }];
}

function cashRowsFromResponse(value: unknown): JsonObject[] {
  const data = unwrapData(value);
  const object = asObject(data);
  const rows = Array.isArray(data) ? data
    : Array.isArray(object?.activities) ? object.activities as unknown[]
    : Array.isArray(object?.items) ? object.items as unknown[]
    : Array.isArray(object?.list) ? object.list as unknown[]
    : [];
  return rows.flatMap((row): JsonObject[] => {
    const parsed = asObject(row);
    return parsed ? [parsed] : [];
  });
}

export function parseWebullCashActivities(value: unknown): BrokerActivity[] {
  return cashRowsFromResponse(value).flatMap(cashActivityFromRow);
}

// The cash activity reference documents `start_time` without pinning its
// format, and Webull uses ISO-8601 for order timestamps but epoch milliseconds
// for order times. Try ISO first and fall back once rather than losing the
// whole window to a format rejection.
type CashWindowFormat = "iso" | "epoch";

function cashWindowStart(format: CashWindowFormat): string {
  const isoStart = `${sixMonthsAgo()}T00:00:00Z`;
  return format === "iso" ? isoStart : String(Date.parse(isoStart));
}

async function fetchWebullCashActivities(
  network: NetworkClient,
  credentials: WebullCredentials & { accessToken: string; accountId: string },
): Promise<{ activities: BrokerActivity[]; available: boolean }> {
  const activities: BrokerActivity[] = [];
  let cursor = "";
  let format: CashWindowFormat = "iso";
  const requestPage = (): Promise<NetworkResponse> => {
    const query: Record<string, string> = {
      account_id: credentials.accountId,
      start_time: cashWindowStart(format),
      page_size: "100",
    };
    if (cursor) query.last_activity_id = cursor;
    return requestWithLegacyFallback(network, credentials, {
      path: CASH_ACTIVITY_PATH,
      method: "GET",
      query,
      accessToken: credentials.accessToken,
    }, LEGACY_CASH_ACTIVITY_PATH);
  };

  for (let page = 0; page < 20; page += 1) {
    let response = await requestPage();
    if (page === 0 && format === "iso" && (response.status === 400 || response.status === 422)) {
      format = "epoch";
      response = await requestPage();
    }
    // Neither path exists for this market, so the account has no cash ledger to
    // read. That is a reportable gap, not a sync failure.
    if (response.status === 404) return { activities: [], available: false };
    requireSuccess(response, "cash activity request");
    const rows = cashRowsFromResponse(parseJson(response));
    activities.push(...rows.flatMap(cashActivityFromRow));
    if (rows.length < 100) break;
    const last = rows.at(-1);
    const nextCursor = firstString(last?.activity_id, last?.activityId, last?.id);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return { activities, available: true };
}

export interface WebullAudit {
  orders: number;
  cashActivities: number;
  cashLedgerAvailable: boolean;
  warnings: string[];
}

export interface WebullReport {
  activities: BrokerActivity[];
  audit: WebullAudit;
}

/** The AU position feed supplies a last price without a market timestamp. Date
 * this observation when the broker answers, never backdate it to a market close. */
export async function fetchWebullAccountValue(
  network: NetworkClient,
  credentials: WebullCredentials & { accessToken: string; accountId: string },
) {
  const get = (path: string, query: Record<string, string>) =>
    signedRequest(network, credentials, {
      path,
      method: "GET",
      query: { account_id: credentials.accountId, ...query },
      accessToken: credentials.accessToken,
    });
  const balance = await get("/trading/assets/balances/get", { total_asset_currency: "AUD" });
  requireSuccess(balance, "account balance");
  const positionResponse = await get("/trading/assets/positions/list", {});
  requireSuccess(positionResponse, "account positions");
  const b = asObject(unwrapData(parseJson(balance)));
  const list = unwrapData(parseJson(positionResponse));
  if (b?.total_asset_currency !== "AUD" || !Array.isArray(b.account_currency_assets) || !Array.isArray(list))
    throw Error("Webull returned an incomplete account valuation.");
  const numeric = (v: unknown) => {
    if ((typeof v !== "number" && typeof v !== "string") || !/^-?\d+(\.\d+)?$/.test(String(v)))
      throw Error("Webull valuation amount is missing.");
    return String(v);
  };
  const currencyCode = (v: unknown) => {
    if (typeof v !== "string" || !/^[A-Z]{3}$/.test(v)) throw Error("Webull valuation currency is missing.");
    return v;
  };
  const cash: Record<string, string> = {};
  for (const item of b.account_currency_assets) {
    const row = asObject(item),
      c = currencyCode(row?.currency);
    if (Object.hasOwn(cash, c)) throw Error("Webull returned more than one cash balance for a currency.");
    cash[c] = numeric(row?.cash_balance);
  }
  if (!Object.keys(cash).length) throw Error("Webull returned no currency balances.");
  const positions = list.map((item) => {
    const row = asObject(item);
    if (!row || typeof row.symbol !== "string" || !row.symbol.trim())
      throw Error("Webull position symbol is missing.");
    return {
      symbol: row.symbol,
      currency: currencyCode(row.currency),
      quantity: numeric(row.quantity),
      price: row.last_price == null ? null : numeric(row.last_price),
    };
  });
  const serverTime = Date.parse(balance.headers?.date || "");
  const captured = Number.isFinite(serverTime) ? new Date(serverTime) : new Date();
  return {
    source: "Webull AU",
    base: "AUD",
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(captured),
    observedAt: captured.toISOString(),
    cash,
    cashTotal: numeric(b.total_cash_balance),
    securities: numeric(b.total_market_value),
    unrealized: b.total_unrealized_profit_loss == null ? null : numeric(b.total_unrealized_profit_loss),
    positions,
  };
}

export async function fetchWebullReport(
  network: NetworkClient,
  credentials: WebullCredentials & { accessToken: string; accountId: string },
): Promise<WebullReport> {
  const orders = await fetchWebullOrderActivities(network, credentials);
  const cash = await fetchWebullCashActivities(network, credentials);
  const warnings: string[] = [];
  if (!cash.available) {
    warnings.push(
      "Webull did not return a cash activity ledger for this account, so deposits, withdrawals, currency conversions, dividends, interest, and standalone fees were not imported. Webull Australia's OpenAPI does not document this endpoint yet; reconcile cash against your Webull statements.",
    );
  } else if (cash.activities.length === 0) {
    warnings.push(
      "Webull returned an empty cash activity ledger for the requested six-month window. Confirm the period against your Webull statements before trusting the cash balance.",
    );
  }
  return {
    activities: [...orders, ...cash.activities],
    audit: {
      orders: orders.length,
      cashActivities: cash.activities.length,
      cashLedgerAvailable: cash.available,
      warnings,
    },
  };
}

export async function fetchWebullActivities(
  network: NetworkClient,
  credentials: WebullCredentials & { accessToken: string; accountId: string },
): Promise<BrokerActivity[]> {
  return (await fetchWebullReport(network, credentials)).activities;
}
