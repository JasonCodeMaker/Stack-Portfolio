// PROTOTYPE — synthetic portfolio for the allocation layout harness. Not real user data.
// Built with the real domain functions so the "current" variant reproduces today's bugs.
import { buildExposureModel } from "@/domain/exposure";
import { buildPortfolioModel } from "@/domain/portfolio";
import type {
  EtfDataRow,
  EtfHoldingsSnapshot,
  NormalizedHolding,
  PortfolioAccount,
  RebalanceSettings,
  UnderlyingHolding,
} from "@/types/domain";

const IT = "Information Technology";
const FIN = "Financials";
const COM = "Communication Services";
const CD = "Consumer Discretionary";
const HC = "Health Care";
const MAT = "Materials";
const IND = "Industrials";
const CS = "Consumer Staples";
const EN = "Energy";
const UT = "Utilities";
const RE = "Real Estate";

type Row = [symbol: string, name: string, sector: string, weight: number, country?: string];

const US = "United States";

const IVV_TOP: Row[] = [
  ["NVDA", "NVIDIA", IT, 0.074], ["MSFT", "Microsoft", IT, 0.066], ["AAPL", "Apple", IT, 0.061],
  ["AMZN", "Amazon", CD, 0.041], ["META", "Meta Platforms", COM, 0.029], ["AVGO", "Broadcom", IT, 0.026],
  ["GOOGL", "ALPHABET INC CLASS A", COM, 0.022], ["GOOG", "ALPHABET INC CLASS C", COM, 0.018],
  ["TSLA", "Tesla", CD, 0.019], ["BRK.B", "BERKSHIRE HATHAWAY INC CLASS B", FIN, 0.016], ["JPM", "JPMorgan Chase", FIN, 0.015],
  ["LLY", "Eli Lilly", HC, 0.012], ["V", "Visa", FIN, 0.011], ["ORCL", "Oracle", IT, 0.009], ["NFLX", "Netflix", COM, 0.009],
  ["MA", "Mastercard", FIN, 0.009], ["XOM", "Exxon Mobil", EN, 0.008], ["COST", "Costco", CS, 0.008], ["WMT", "Walmart", CS, 0.008],
  ["PLTR", "Palantir", IT, 0.007], ["JNJ", "Johnson & Johnson", HC, 0.007], ["HD", "Home Depot", CD, 0.007], ["ABBV", "AbbVie", HC, 0.006],
  ["BAC", "Bank of America", FIN, 0.006], ["AMD", "Advanced Micro Devices", IT, 0.006], ["PG", "Procter & Gamble", CS, 0.006],
  ["UNH", "UnitedHealth", HC, 0.005], ["CVX", "Chevron", EN, 0.005], ["GE", "GE Aerospace", IND, 0.005], ["CSCO", "Cisco", IT, 0.005],
  ["KO", "Coca-Cola", CS, 0.004], ["WFC", "Wells Fargo", FIN, 0.004], ["IBM", "IBM", IT, 0.004], ["CRM", "Salesforce", IT, 0.004],
  ["PM", "Philip Morris", CS, 0.004], ["CAT", "Caterpillar", IND, 0.004], ["MS", "Morgan Stanley", FIN, 0.004], ["GS", "Goldman Sachs", FIN, 0.004],
  ["LIN", "Linde", MAT, 0.004], ["MCD", "McDonald's", CD, 0.004],
];

const US_TAIL: Array<[string, string, string]> = [
  ["ACN", "Accenture", IT], ["ADBE", "Adobe", IT], ["TXN", "Texas Instruments", IT], ["QCOM", "Qualcomm", IT], ["INTU", "Intuit", IT],
  ["NOW", "ServiceNow", IT], ["AMAT", "Applied Materials", IT], ["MU", "Micron Technology", IT], ["LRCX", "Lam Research", IT],
  ["ADI", "Analog Devices", IT], ["KLAC", "KLA", IT], ["PANW", "Palo Alto Networks", IT], ["ANET", "Arista Networks", IT], ["INTC", "Intel", IT],
  ["TMO", "Thermo Fisher", HC], ["ABT", "Abbott", HC], ["ISRG", "Intuitive Surgical", HC], ["MRK", "Merck", HC], ["AMGN", "Amgen", HC],
  ["PFE", "Pfizer", HC], ["DHR", "Danaher", HC], ["BSX", "Boston Scientific", HC], ["SYK", "Stryker", HC], ["GILD", "Gilead", HC],
  ["VRTX", "Vertex", HC], ["AXP", "American Express", FIN], ["C", "Citigroup", FIN], ["SCHW", "Charles Schwab", FIN], ["BLK", "BlackRock", FIN],
  ["SPGI", "S&P Global", FIN], ["PGR", "Progressive", FIN], ["CB", "Chubb", FIN], ["RTX", "RTX", IND], ["HON", "Honeywell", IND],
  ["UNP", "Union Pacific", IND], ["BA", "Boeing", IND], ["DE", "Deere", IND], ["LMT", "Lockheed Martin", IND], ["UBER", "Uber", IND],
  ["ETN", "Eaton", IND], ["LOW", "Lowe's", CD], ["BKNG", "Booking Holdings", CD], ["TJX", "TJX", CD], ["NKE", "Nike", CD],
  ["SBUX", "Starbucks", CD], ["PEP", "PepsiCo", CS], ["MDLZ", "Mondelez", CS], ["MO", "Altria", CS], ["CL", "Colgate-Palmolive", CS],
  ["COP", "ConocoPhillips", EN], ["EOG", "EOG Resources", EN], ["NEE", "NextEra Energy", UT], ["SO", "Southern Co", UT],
  ["DUK", "Duke Energy", UT], ["PLD", "Prologis", RE], ["AMT", "American Tower", RE], ["EQIX", "Equinix", RE],
  ["SHW", "Sherwin-Williams", MAT], ["APD", "Air Products", MAT], ["T", "AT&T", COM], ["VZ", "Verizon", COM], ["DIS", "Walt Disney", COM],
  ["TMUS", "T-Mobile US", COM], ["CMCSA", "Comcast", COM],
];

const NDQ_TOP: Row[] = [
  ["NVDA", "NVIDIA", IT, 0.092], ["MSFT", "Microsoft", IT, 0.083], ["AAPL", "Apple", IT, 0.078], ["AMZN", "Amazon", CD, 0.054],
  ["AVGO", "Broadcom", IT, 0.05], ["META", "Meta Platforms", COM, 0.037], ["TSLA", "Tesla", CD, 0.028], ["NFLX", "Netflix", COM, 0.027],
  ["COST", "Costco", CS, 0.026], ["GOOGL", "ALPHABET INC CLASS A", COM, 0.026], ["GOOG", "ALPHABET INC CLASS C", COM, 0.024],
  ["PLTR", "Palantir", IT, 0.022], ["AMD", "Advanced Micro Devices", IT, 0.017], ["CSCO", "Cisco", IT, 0.015], ["TMUS", "T-Mobile US", COM, 0.015],
  ["LIN", "Linde", MAT, 0.012], ["PEP", "PepsiCo", CS, 0.012], ["ISRG", "Intuitive Surgical", HC, 0.011], ["INTU", "Intuit", IT, 0.011],
  ["SHOP", "Shopify", IT, 0.01, "Canada"], ["ASML", "ASML Holding", IT, 0.009, "Netherlands"], ["AZN", "AstraZeneca", HC, 0.007, "United Kingdom"],
  ["PDD", "PDD Holdings", CD, 0.007, "China"], ["ARM", "Arm Holdings", IT, 0.005, "United Kingdom"],
];

const NDQ_TAIL: Array<[string, string, string]> = [
  ["ADBE", "Adobe", IT], ["TXN", "Texas Instruments", IT], ["QCOM", "Qualcomm", IT], ["AMAT", "Applied Materials", IT], ["MU", "Micron Technology", IT],
  ["LRCX", "Lam Research", IT], ["ADI", "Analog Devices", IT], ["KLAC", "KLA", IT], ["PANW", "Palo Alto Networks", IT], ["INTC", "Intel", IT],
  ["AMGN", "Amgen", HC], ["GILD", "Gilead", HC], ["VRTX", "Vertex", HC], ["BKNG", "Booking Holdings", CD], ["SBUX", "Starbucks", CD],
  ["MDLZ", "Mondelez", CS], ["CMCSA", "Comcast", COM], ["HON", "Honeywell", IND], ["ADP", "ADP", IND], ["CRWD", "CrowdStrike", IT],
  ["MELI", "MercadoLibre", CD], ["ABNB", "Airbnb", CD], ["MAR", "Marriott", CD], ["ORLY", "O'Reilly Automotive", CD], ["CTAS", "Cintas", IND],
  ["REGN", "Regeneron", HC], ["FTNT", "Fortinet", IT], ["DASH", "DoorDash", CD], ["WDAY", "Workday", IT], ["CDNS", "Cadence Design", IT],
  ["SNPS", "Synopsys", IT], ["MRVL", "Marvell", IT], ["KDP", "Keurig Dr Pepper", CS], ["MNST", "Monster Beverage", CS], ["CSX", "CSX", IND],
  ["PYPL", "PayPal", FIN], ["ROP", "Roper Technologies", IT], ["ADSK", "Autodesk", IT], ["CEG", "Constellation Energy", UT], ["AEP", "American Electric Power", UT],
  ["EXC", "Exelon", UT], ["TTD", "The Trade Desk", COM], ["DDOG", "Datadog", IT], ["ZS", "Zscaler", IT], ["IDXX", "IDEXX", HC],
  ["BIIB", "Biogen", HC], ["ON", "ON Semiconductor", IT], ["CDW", "CDW", IT], ["KHC", "Kraft Heinz", CS], ["LULU", "Lululemon", CD],
  ["ROST", "Ross Stores", CD], ["PCAR", "PACCAR", IND], ["FAST", "Fastenal", IND], ["ODFL", "Old Dominion", IND], ["EA", "Electronic Arts", COM],
  ["TTWO", "Take-Two", COM], ["CHTR", "Charter", COM], ["XEL", "Xcel Energy", UT], ["GEHC", "GE HealthCare", HC], ["DXCM", "DexCom", HC],
];

const AU = "Australia";

const A200_TOP: Row[] = [
  ["CBA", "Commonwealth Bank", FIN, 0.105], ["BHP", "BHP Group", MAT, 0.086], ["NAB", "National Australia Bank", FIN, 0.049],
  ["WBC", "Westpac", FIN, 0.047], ["CSL", "CSL", HC, 0.043], ["ANZ", "ANZ Group", FIN, 0.04], ["WES", "Wesfarmers", CD, 0.034],
  ["MQG", "Macquarie Group", FIN, 0.033], ["GMG", "Goodman Group", RE, 0.028], ["RIO", "Rio Tinto", MAT, 0.023], ["TLS", "Telstra", COM, 0.019],
  ["WDS", "Woodside Energy", EN, 0.018], ["FMG", "Fortescue", MAT, 0.015], ["WOW", "Woolworths", CS, 0.015], ["TCL", "Transurban", IND, 0.015],
  ["ALL", "Aristocrat Leisure", CD, 0.013], ["QBE", "QBE Insurance", FIN, 0.012], ["XRO", "Xero", IT, 0.012], ["NST", "Northern Star", MAT, 0.012],
  ["RMD", "ResMed", HC, 0.011], ["SUN", "Suncorp", FIN, 0.011], ["COL", "Coles", CS, 0.009], ["WTC", "WiseTech Global", IT, 0.008], ["REA", "REA Group", COM, 0.008],
];

const A200_TAIL: Array<[string, string, string]> = [
  ["S32", "South32", MAT], ["STO", "Santos", EN], ["ORG", "Origin Energy", UT], ["AMC", "Amcor", MAT], ["BXB", "Brambles", IND],
  ["SCG", "Scentre Group", RE], ["SGP", "Stockland", RE], ["MGR", "Mirvac", RE], ["GPT", "GPT Group", RE], ["JHX", "James Hardie", MAT],
  ["CPU", "Computershare", IND], ["ASX", "ASX Ltd", FIN], ["IAG", "Insurance Australia Group", FIN], ["SHL", "Sonic Healthcare", HC],
  ["COH", "Cochlear", HC], ["RHC", "Ramsay Health Care", HC], ["PME", "Pro Medicus", HC], ["TWE", "Treasury Wine Estates", CS],
  ["EDV", "Endeavour Group", CS], ["MIN", "Mineral Resources", MAT], ["PLS", "Pilbara Minerals", MAT], ["LYC", "Lynas Rare Earths", MAT],
  ["EVN", "Evolution Mining", MAT], ["QAN", "Qantas", IND], ["AZJ", "Aurizon", IND], ["JBH", "JB Hi-Fi", CD], ["CAR", "CAR Group", COM],
  ["SEK", "Seek", IND], ["NXT", "NextDC", IT], ["TNE", "TechnologyOne", IT], ["APA", "APA Group", UT], ["AGL", "AGL Energy", UT],
  ["BEN", "Bendigo & Adelaide Bank", FIN], ["BOQ", "Bank of Queensland", FIN], ["MPL", "Medibank", FIN], ["SOL", "Soul Patts", FIN],
  ["LLC", "Lendlease", RE], ["ALX", "Atlas Arteria", IND], ["ORI", "Orica", MAT], ["IGO", "IGO", MAT], ["BSL", "BlueScope", MAT],
  ["WHC", "Whitehaven Coal", EN], ["HVN", "Harvey Norman", CD], ["LOV", "Lovisa", CD], ["DMP", "Domino's Pizza", CD], ["A2M", "a2 Milk", CS],
  ["MTS", "Metcash", CS], ["CGF", "Challenger", FIN],
];

function buildConstituents(top: Row[], tail: Array<[string, string, string]>, mic: string, country: string, cashWeight: number): UnderlyingHolding[] {
  const topSum = top.reduce((sum, row) => sum + row[3], 0);
  const smallest = Math.min(...top.map((row) => row[3]));
  // Tail decays geometrically from just under the smallest named weight.
  const raw = tail.map((_, index) => smallest * 0.92 * Math.pow(0.975, index));
  const rawSum = raw.reduce((sum, value) => sum + value, 0);
  const tailTarget = Math.max(0, 1 - cashWeight - topSum);
  const scale = tailTarget / rawSum;
  const holdings: UnderlyingHolding[] = top.map(([symbol, name, sector, weight, rowCountry]) => ({
    symbol, name, mic, sector, country: rowCountry ?? country, weight, underlyingType: "stock",
  }));
  tail.forEach(([symbol, name, sector], index) => {
    holdings.push({ symbol, name, mic, sector, country, weight: raw[index] * scale, underlyingType: "stock" });
  });
  if (cashWeight > 0) holdings.push({ name: "Cash and derivatives", weight: cashWeight, underlyingType: "cash" });
  return holdings;
}

function snapshot(etfKey: string, provider: string, holdings: UnderlyingHolding[]): EtfHoldingsSnapshot {
  return {
    schemaVersion: 1,
    etfKey,
    provider,
    asOfDate: "2026-09-24",
    fetchedAt: "2026-09-25T22:10:00.000Z",
    holdings,
    weightSum: holdings.reduce((sum, row) => sum + row.weight, 0),
    normalized: false,
    sourceMode: "automatic",
  };
}

const accounts: PortfolioAccount[] = [
  { id: "commsec", name: "CommSec", currency: "AUD", isActive: true, isArchived: false },
  { id: "ibkr", name: "Interactive Brokers", currency: "USD", isActive: true, isArchived: false },
];

function holding(
  id: string,
  accountId: "commsec" | "ibkr",
  ticker: string,
  name: string,
  type: NormalizedHolding["type"],
  audValue: number,
  extra: Partial<NormalizedHolding> = {},
): NormalizedHolding {
  const account = accounts.find((row) => row.id === accountId)!;
  return {
    id,
    accountId,
    accountName: account.name,
    ticker,
    name,
    type,
    quantity: 1,
    localCurrency: extra.localCurrency ?? "AUD",
    nativeValue: audValue,
    audValue,
    priceUpdatedAt: "2026-09-25",
    identityKey: null,
    etfKey: null,
    profileId: id,
    status: "valued",
    sourceHoldingId: id,
    ...extra,
  };
}

const etfHolding = (id: string, accountId: "commsec" | "ibkr", ticker: string, name: string, value: number) =>
  holding(id, accountId, ticker, name, "etf", value, { identityKey: `mic:XASX:${ticker}`, etfKey: `XASX:${ticker}` });

const stockHolding = (id: string, accountId: "commsec" | "ibkr", ticker: string, name: string, sector: string, value: number, mic: string, country: string, currency: string) =>
  holding(id, accountId, ticker, name, "stock", value, { identityKey: `mic:${mic}:${ticker}`, sector, country, localCurrency: currency, nativeValue: currency === "USD" ? value * 0.66 : value });

const holdings: NormalizedHolding[] = [
  etfHolding("ivv-commsec", "commsec", "IVV", "iShares S&P 500 ETF", 30000),
  etfHolding("ivv-ibkr", "ibkr", "IVV", "iShares S&P 500 ETF", 12000),
  etfHolding("ndq", "commsec", "NDQ", "Betashares Nasdaq 100 ETF", 28000),
  etfHolding("a200", "commsec", "A200", "Betashares Australia 200 ETF", 18000),
  etfHolding("vgs", "commsec", "VGS", "Vanguard MSCI Index International Shares ETF", 12000),
  stockHolding("nvda", "ibkr", "NVDA", "NVIDIA", IT, 9500, "XNAS", US, "USD"),
  stockHolding("aapl", "ibkr", "AAPL", "Apple", IT, 6200, "XNAS", US, "USD"),
  stockHolding("cba", "commsec", "CBA", "Commonwealth Bank", FIN, 5400, "XASX", AU, "AUD"),
  stockHolding("msft", "ibkr", "MSFT", "Microsoft", IT, 4800, "XNAS", US, "USD"),
  stockHolding("tsla", "ibkr", "TSLA", "Tesla", CD, 3100, "XNAS", US, "USD"),
  holding("cash-aud", "commsec", "AUD", "AUD cash", "cash", 7500, { identityKey: "cash:AUD" }),
  holding("cash-usd", "ibkr", "USD", "USD cash", "cash", 1800, { identityKey: "cash:USD", localCurrency: "USD", nativeValue: 1188 }),
];

const snapshots = new Map<string, EtfHoldingsSnapshot>([
  ["XASX:IVV", snapshot("XASX:IVV", "ishares", buildConstituents(IVV_TOP, US_TAIL, "XNAS", US, 0.002))],
  ["XASX:NDQ", snapshot("XASX:NDQ", "betashares", buildConstituents(NDQ_TOP, NDQ_TAIL, "XNAS", US, 0.003))],
  ["XASX:A200", snapshot("XASX:A200", "betashares", buildConstituents(A200_TOP, A200_TAIL, "XASX", AU, 0.004))],
]);

const portfolio = buildPortfolioModel(holdings, accounts.map((account) => account.id));
const exposure = buildExposureModel({ holdings, snapshots, totalAud: portfolio.totalAud });
const expandedExposure = buildExposureModel({ holdings, snapshots, totalAud: portfolio.totalAud, maxConstituentsPerEtf: 10 });

const etfData: EtfDataRow[] = portfolio.etfs.map((asset) => {
  const snap = snapshots.get(asset.etfKey) ?? null;
  return {
    asset,
    snapshot: snap,
    version: 1,
    status: snap ? "Fresh" : "Unsupported",
    resolvedWeight: snap?.weightSum ?? 0,
    failureReason: snap ? undefined : "No provider supports Vanguard funds yet. Import a holdings CSV to include it.",
  };
});

const rebalanceSettings: RebalanceSettings = {
  schemaVersion: 1,
  tolerance: 0.02,
  targets: {
    "mic:XASX:IVV": 0.3,
    "mic:XASX:NDQ": 0.15,
    "mic:XASX:A200": 0.17,
    "mic:XASX:VGS": 0.13,
    "strategy:individual-stocks": 0.2,
    "strategy:cash": 0.05,
  },
};

export const fixture = {
  portfolio,
  exposure,
  expandedExposure,
  activeAccounts: accounts,
  selectedAccounts: accounts,
  etfData,
  rebalanceSettings,
};
