import { canonicalIdentity } from "@/domain/identifiers";
import type {
  CsvPreview,
  EtfHoldingsSnapshot,
  EtfSnapshotStatus,
  SnapshotValidation,
  UnderlyingHolding,
} from "@/types/domain";

// The approved acceptance case treats a 96% known snapshot as usable with a
// visible ETF-specific residual. More incomplete candidates are rejected.
const REQUIRED_WEIGHT = 0.96;
const MAX_WEIGHT = 1.005;

export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const next = csv[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function parseWeight(value: string): { weight: number | null; unit: CsvPreview["detectedUnit"] } {
  const trimmed = value.trim();
  if (!trimmed) return { weight: null, unit: "mixed" };
  const numeric = Number(trimmed.replace(/%$/, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return { weight: null, unit: "mixed" };
  if (trimmed.endsWith("%")) return { weight: numeric / 100, unit: "percentage" };
  if (numeric <= 1) return { weight: numeric, unit: "fraction" };
  return { weight: numeric / 100, unit: "bare-percentage" };
}

export function validateSnapshot(
  snapshot: EtfHoldingsSnapshot,
): SnapshotValidation {
  const weightSum = snapshot.holdings.reduce((sum, holding) => sum + holding.weight, 0);
  const hasInvalidWeight = snapshot.holdings.some(
    (holding) => !Number.isFinite(holding.weight) || holding.weight < 0,
  );
  if (!snapshot.holdings.length || hasInvalidWeight) {
    return {
      accepted: false,
      status: "rejected",
      message: "Snapshot must contain at least one constituent with non-negative weights.",
    };
  }
  if (weightSum < REQUIRED_WEIGHT || weightSum > MAX_WEIGHT) {
    return {
      accepted: false,
      status: "rejected",
      message: `Weight sum ${(weightSum * 100).toFixed(2)}% is outside the accepted 98%–100.5% range.`,
    };
  }

  if (weightSum > 1) {
    const normalizedHoldings = snapshot.holdings.map((holding) => ({
      ...holding,
      weight: holding.weight / weightSum,
    }));
    return {
      accepted: true,
      status: "normalized",
      message: `Weight sum ${(weightSum * 100).toFixed(2)}% was proportionally normalized to 100%.`,
      snapshot: { ...snapshot, holdings: normalizedHoldings, weightSum: 1, normalized: true },
    };
  }

  return {
    accepted: true,
    status: weightSum < 1 ? "residual" : "accepted",
    message: weightSum < 1
      ? `Accepted with ${(1 - weightSum) * 100 < 1 ? ((1 - weightSum) * 100).toFixed(2) : ((1 - weightSum) * 100).toFixed(1)}% residual.`
      : "Snapshot weights sum to 100%.",
    snapshot: { ...snapshot, weightSum, normalized: snapshot.normalized ?? false },
  };
}

export function parseManualCsv(
  csv: string,
  metadata: Pick<EtfHoldingsSnapshot, "etfKey" | "provider" | "asOfDate" | "fetchedAt">,
): CsvPreview {
  const rawRows = parseCsvRows(csv);
  const header = rawRows.shift() ?? [];
  const columns = header.map((value) => value.toLowerCase().replace(/\s+/g, ""));
  const indexOf = (name: string) => columns.indexOf(name);
  const symbolIndex = indexOf("symbol");
  const nameIndex = indexOf("name");
  const weightIndex = indexOf("weight");
  const missingFields: string[] = [];
  if (symbolIndex < 0 && nameIndex < 0) missingFields.push("symbol or name");
  if (weightIndex < 0) missingFields.push("weight");

  const rows: UnderlyingHolding[] = [];
  const issues: string[] = [];
  const units = new Set<CsvPreview["detectedUnit"]>();
  for (const [rowIndex, rawRow] of rawRows.entries()) {
    const get = (name: string) => {
      const columnIndex = indexOf(name);
      return columnIndex >= 0 ? rawRow[columnIndex]?.trim() : "";
    };
    const symbol = get("symbol") || undefined;
    const name = get("name") || symbol || "";
    const parsed = parseWeight(get("weight"));
    if (parsed.unit !== "mixed") units.add(parsed.unit);
    if (!name) issues.push(`Row ${rowIndex + 2}: symbol or name is required.`);
    if (parsed.weight === null) issues.push(`Row ${rowIndex + 2}: weight is invalid.`);
    if (!name || parsed.weight === null) continue;
    rows.push({
      symbol,
      name,
      weight: parsed.weight,
      isin: get("isin") || undefined,
      mic: get("mic") || undefined,
      country: get("country") || undefined,
      currency: get("currency") || undefined,
      sector: get("sector") || undefined,
      assetClass: get("assetclass") || undefined,
    });
  }

  const identityCounts = new Map<string, number>();
  for (const row of rows) {
    const identity = canonicalIdentity(row).key;
    if (identity) identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }
  const duplicateIdentities = [...identityCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([identity]) => identity);
  if (duplicateIdentities.length) issues.push("Duplicate identities will be kept visible for review.");

  const weightSum = rows.reduce((sum, row) => sum + row.weight, 0);
  const snapshot: EtfHoldingsSnapshot = {
    schemaVersion: 1,
    ...metadata,
    holdings: rows,
    weightSum,
    normalized: false,
    sourceMode: "manual",
  };
  const validation = validateSnapshot(snapshot);
  return {
    rows,
    detectedUnit: units.size === 1 ? [...units][0] : units.size === 0 ? "mixed" : "mixed",
    weightSum,
    missingFields,
    duplicateIdentities,
    issues,
    validation,
  };
}

export function snapshotToCsv(snapshot: EtfHoldingsSnapshot): string {
  const headers = ["symbol", "name", "weight", "isin", "mic", "country", "currency", "sector", "assetClass"];
  const escape = (value: string | number | undefined) => {
    const text = value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(","),
    ...snapshot.holdings.map((holding) => [
      holding.symbol,
      holding.name,
      holding.weight,
      holding.isin,
      holding.mic,
      holding.country,
      holding.currency,
      holding.sector,
      holding.assetClass,
    ].map(escape).join(",")),
  ].join("\n");
}

export function getSnapshotStatus(snapshot: EtfHoldingsSnapshot | null, now = Date.now()): EtfSnapshotStatus {
  if (!snapshot) return "Missing";
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return "Invalid";
  const age = Math.max(0, now - fetchedAt);
  if (age <= 24 * 60 * 60 * 1000) return "Fresh";
  if (age <= 7 * 24 * 60 * 60 * 1000) return "Stale";
  if (age <= 30 * 24 * 60 * 60 * 1000) return "Warning";
  return "Critical";
}
