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
