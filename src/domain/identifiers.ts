export interface IdentityInput {
  isin?: string | null;
  mic?: string | null;
  symbol?: string | null;
  country?: string | null;
  currency?: string | null;
  name?: string | null;
}

export interface IdentityResult {
  key: string | null;
  confidence: "high" | "medium" | "low" | "unmapped";
}

export interface CompanyIdentity {
  key: string;
  label: string;
  ticker: string;
}

const SHARE_CLASS_COMPANIES: ReadonlyArray<CompanyIdentity & { symbols: string[] }> = [
  { key: "company:ALPHABET", label: "Alphabet", ticker: "GOOGL / GOOG", symbols: ["GOOGL", "GOOG"] },
  { key: "company:FOX", label: "Fox", ticker: "FOXA / FOX", symbols: ["FOXA", "FOX"] },
  { key: "company:NEWS_CORP", label: "News Corp", ticker: "NWSA / NWS", symbols: ["NWSA", "NWS"] },
  { key: "company:BERKSHIRE_HATHAWAY", label: "Berkshire Hathaway", ticker: "BRK.A / BRK.B", symbols: ["BRK.A", "BRK.B", "BRKA", "BRKB"] },
  { key: "company:BROWN_FORMAN", label: "Brown-Forman", ticker: "BF.A / BF.B", symbols: ["BF.A", "BF.B", "BFA", "BFB"] },
  { key: "company:LENNAR", label: "Lennar", ticker: "LEN / LEN.B", symbols: ["LEN", "LEN.B", "LENB"] },
  { key: "company:HEICO", label: "HEICO", ticker: "HEI / HEI.A", symbols: ["HEI", "HEI.A", "HEIA"] },
];

const COMPANY_BY_SYMBOL = new Map(
  SHARE_CLASS_COMPANIES.flatMap((company) => company.symbols.map((symbol) => [normalizeIdentityPart(symbol), company] as const)),
);

export function normalizeIdentityPart(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

export function canonicalEtfKey(input: IdentityInput & { instrumentKey?: string | null }): string | null {
  if (input.instrumentKey?.trim()) return `instrument:${input.instrumentKey.trim()}`;
  const mic = normalizeIdentityPart(input.mic);
  const symbol = normalizeIdentityPart(input.symbol);
  if (mic && symbol) return `${mic}:${symbol}`;
  if (symbol && input.currency) {
    return `provider:${normalizeIdentityPart(input.currency)}:${symbol}`;
  }
  if (symbol) return `provider:unknown:${symbol}`;
  return null;
}

export function canonicalIdentity(input: IdentityInput): IdentityResult {
  const isin = normalizeIdentityPart(input.isin);
  if (isin) return { key: `isin:${isin}`, confidence: "high" };

  const mic = normalizeIdentityPart(input.mic);
  const symbol = normalizeIdentityPart(input.symbol);
  if (mic && symbol) return { key: `mic:${mic}:${symbol}`, confidence: "high" };

  const country = normalizeIdentityPart(input.country);
  const currency = normalizeIdentityPart(input.currency);
  if (symbol && country && currency) {
    return { key: `ticker:${symbol}:${country}:${currency}`, confidence: "medium" };
  }

  if (normalizeIdentityPart(input.name)) return { key: null, confidence: "low" };
  return { key: null, confidence: "unmapped" };
}

export function canonicalCompanyIdentity(input: Pick<IdentityInput, "symbol">): CompanyIdentity | null {
  const company = COMPANY_BY_SYMBOL.get(normalizeIdentityPart(input.symbol));
  return company ? { key: company.key, label: company.label, ticker: company.ticker } : null;
}

const US_EQUITY_MICS = new Set(["XNYS", "XNAS", "XNGS", "XNMS", "XNCM", "ARCX", "BATS", "XASE", "IEXG"]);

// Issuers describe the same US stock differently: iShares gives the exchange,
// Invesco only the ticker and USD. A US ticker identifies one listing, so key
// on it alone to merge those rows into one company.
export function usListingKey(input: Pick<IdentityInput, "symbol" | "mic" | "currency" | "country">): string | null {
  const symbol = normalizeIdentityPart(input.symbol);
  if (!symbol) return null;
  const mic = normalizeIdentityPart(input.mic);
  if (mic) return US_EQUITY_MICS.has(mic) ? `listing:US:${symbol}` : null;
  const country = normalizeIdentityPart(input.country);
  if (country && country !== "US" && country !== "UNITED_STATES") return null;
  return normalizeIdentityPart(input.currency) === "USD" ? `listing:US:${symbol}` : null;
}

/** Rewrites an exchange-qualified US identity (e.g. an alias target) to its listing key. */
export function preferUsListingKey(identityKey: string): string {
  const match = /^mic:([A-Z0-9_]+):(.+)$/.exec(identityKey);
  return match && US_EQUITY_MICS.has(match[1]) ? `listing:US:${match[2]}` : identityKey;
}

export interface AliasScope {
  provider: string;
  etfKey: string;
}

export function scopedAliasKey(scope: AliasScope, identityKey: string): string {
  return `scope:${normalizeIdentityPart(scope.provider)}:${normalizeIdentityPart(scope.etfKey)}:${identityKey}`;
}

export function applyAlias(identityKey: string | null, aliases: Record<string, string>, scope?: AliasScope): string | null {
  if (!identityKey) return null;
  if (scope) return aliases[scopedAliasKey(scope, identityKey)] ?? aliases[identityKey] ?? identityKey;
  return aliases[identityKey] ?? identityKey;
}
