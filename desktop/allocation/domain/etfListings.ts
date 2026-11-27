interface EtfListing {
  provider: "ishares" | "betashares";
  identifier: string;
}

const ASX_ETF_LISTINGS: Readonly<Record<string, EtfListing>> = {
  IVV: { provider: "ishares", identifier: "275304" },
  NDQ: { provider: "betashares", identifier: "NDQ" },
};

export function knownEtfListing(listing: { symbol: string; mic?: string }): EtfListing | undefined {
  const mic = listing.mic?.trim().toUpperCase();
  if (mic !== "XASX" && mic !== "ASX") return undefined;
  return ASX_ETF_LISTINGS[listing.symbol.trim().toUpperCase()];
}
