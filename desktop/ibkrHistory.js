import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { importedKeysStorageKey, linkedActivityId, sourceKey } from "./brokers/syncEngine";
import { BROKER, dayOf, json, preference, saveEvent } from "./ledger.js";
import { tMain } from "./i18n/index.js";

export function recordIdentity(e) {
  const provenance = e.metadata?.brokerSync;
  if (provenance?.broker && provenance.recordId)
    return provenance.broker.toLowerCase() + ":" + provenance.recordId;
  return e.sourceSystem && e.sourceRecordId ? e.sourceSystem.toLowerCase() + ":" + e.sourceRecordId : null;
}

const equal = (a, b) => new Decimal(a ?? 0).eq(b ?? 0);
const posted = (e) => !["VOID", "CANCELLED", "CANCELED", "DRAFT"].includes(String(e.status).toUpperCase());
function sameFill(e, r) {
  return (
    e.activityType === r.activityType &&
    e.currency === r.currency &&
    e.assetSymbol?.toUpperCase() === r.symbol?.toUpperCase() &&
    Math.abs(Date.parse(dayOf(e.date)) - Date.parse(dayOf(r.date))) <= 86400000 &&
    ["quantity", "unitPrice", "fee", "tax"].every((k) => equal(e[k], r[k]))
  );
}

// Older Wealthfolio imports can retain the Flex trade number in the note only.
// A separate, identity-bearing execution proves which fill the note belongs to.
export function ibkrHistoryPlan(db, account, rows) {
  const stored = db
    .prepare("SELECT data,original FROM sp_events WHERE account=?")
    .all(account)
    .map((r) => ({ event: json(r.data, {}), migrated: r.original !== null, pristine: r.data === r.original }))
    .filter((r) => posted(r.event));
  const aliases = new Map(),
    superseded = new Map(),
    blocked = new Map();
  const byNote = new Map(),
    byIdentity = new Map(),
    reportedNotes = new Map(),
    reportedIds = new Set(),
    repeatedIds = new Set();
  function index(map, key, value) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  for (const s of stored) {
    index(byNote, s.event.comment, s);
    const id = recordIdentity(s.event);
    if (id) index(byIdentity, id, s);
  }
  for (const r of rows) {
    index(reportedNotes, r.comment, r);
    if (reportedIds.has(r.brokerRecordId)) repeatedIds.add(r.brokerRecordId);
    reportedIds.add(r.brokerRecordId);
  }
  for (const r of rows) {
    if (
      r.broker !== "ibkr" ||
      !r.brokerRecordId ||
      /^fallback-/i.test(r.brokerRecordId) ||
      repeatedIds.has(r.brokerRecordId) ||
      !r.comment
    )
      continue;
    const id = "ibkr:" + r.brokerRecordId;
    const noted = byNote.get(r.comment) || [];
    if (["BUY", "SELL"].includes(r.activityType) && /^IBKR Flex trade [\w.-]+$/.test(r.comment)) {
      const originals = noted.filter(
        (s) => s.migrated && (!recordIdentity(s.event) || recordIdentity(s.event) === id),
      );
      if (!originals.length) continue;
      const canonical = originals[0].event;
      if (reportedNotes.get(r.comment).length !== 1 || originals.length !== 1 || !sameFill(canonical, r)) {
        blocked.set(id, tMain("ibkr.hist.dupId"));
        continue;
      }
      const native = (byIdentity.get(id) || []).filter((s) => !s.migrated);
      if (
        native.some((s) => s.event.isUserModified || !sameFill(s.event, r) || s.event.comment !== r.comment)
      ) {
        blocked.set(id, tMain("ibkr.hist.edited"));
        continue;
      }
      aliases.set(canonical.id, r.brokerRecordId);
      for (const { event } of native)
        superseded.set(event.id, {
          event,
          canonical,
          reason: tMain("ibkr.hist.sameFill"),
        });
    }
    if (
      r.activityType === "TAX" &&
      r.importRevision &&
      /\b(?:WITHHOLDING TAX|[A-Z]{2} TAX)\b/i.test(r.comment)
    ) {
      const sameCash = noted.filter(
        (s) =>
          s.event.currency === r.currency &&
          dayOf(s.event.date) === dayOf(r.date) &&
          equal(s.event.amount, r.amount),
      );
      const taxes = sameCash.filter((s) => s.event.activityType === "TAX" && recordIdentity(s.event) === id);
      const income = sameCash.filter(
        (s) => s.pristine && s.event.activityType === "DIVIDEND" && !recordIdentity(s.event),
      );
      // The broker must report the tax, and no separate dividend with this description and amount.
      const otherCash = reportedNotes
        .get(r.comment)
        .some(
          (x) =>
            x !== r &&
            dayOf(x.date) === dayOf(r.date) &&
            x.currency === r.currency &&
            equal(x.amount, r.amount),
        );
      if (taxes.length === 1 && income.length === 1 && !otherCash) {
        const event = income[0].event;
        superseded.set(event.id, {
          event,
          canonical: taxes[0].event,
          reason: tMain("ibkr.hist.taxVoided"),
        });
      }
    }
  }
  return { aliases, superseded, blocked };
}

export function mergeIbkrExecution(previous, incoming) {
  if (!previous || !incoming) return incoming || previous;
  if (previous.currency !== incoming.currency || previous.tradeDate !== incoming.tradeDate) return incoming;
  // A later export may have a different reporting base or omit fields which were present before.
  if (previous.baseCurrency === "AUD" && incoming.baseCurrency && incoming.baseCurrency !== "AUD") return previous;
  if (previous.reportDate && incoming.reportDate && previous.reportDate !== incoming.reportDate) return incoming;
  return { ...previous, ...incoming };
}

// Old imports may already have a deduplication key, so runSync never sees their new evidence.
export function enrichIbkrExecutions(db, account, activities, stored, history, write) {
  const ids = new Map();
  for (const e of stored.values()) {
    if (!posted(e) || e.metadata?.supersededBy || history.superseded.has(e.id)) continue;
    const identity = recordIdentity(e);
    const id = history.aliases.get(e.id) || (identity?.startsWith("ibkr:") && identity.slice(5));
    if (id) ids.set(id, ids.has(id) ? null : e.id);
  }
  const keys = new Set(json(preference(db, BROKER, importedKeysStorageKey()), []));
  const select = db.prepare("SELECT data FROM sp_events WHERE id=? AND account=?");
  const changes = [];
  for (const r of activities) {
    const evidence = r.metadata?.ibkrExecution;
    if (!evidence) continue;
    const id = ids.has(r.brokerRecordId) ? ids.get(r.brokerRecordId) : linkedActivityId(keys, sourceKey(r, account));
    const prior = stored.get(id);
    if (!prior || !posted(prior) || prior.metadata?.supersededBy || history.superseded.has(id) ||
        prior.activityType !== r.activityType || prior.currency !== r.currency ||
        (r.symbol && prior.assetSymbol?.toUpperCase() !== r.symbol) ||
        (recordIdentity(prior) && recordIdentity(prior) !== "ibkr:" + r.brokerRecordId)) continue;
    const previous = prior.metadata?.ibkrExecution;
    const next = mergeIbkrExecution(previous, evidence);
    if (isDeepStrictEqual(previous, next)) continue;
    changes.push({ record: r, previous, next });
    if (write) {
      const e = JSON.parse(select.get(id, account).data);
      saveEvent(db, { ...e, metadata: { ...e.metadata, ibkrExecution: next } });
    }
  }
  return changes;
}

export function applyIbkrHistoryPlan(db, plan) {
  for (const { event, canonical, reason } of plan.superseded.values()) {
    const amended = { ...event, status: "VOID", metadata: { ...event.metadata, supersededBy: canonical.id } };
    saveEvent(db, amended);
    db.prepare("INSERT INTO sp_corrections VALUES(?,?,?,?,?,?)").run(
      randomUUID(),
      event.id,
      new Date().toISOString(),
      reason,
      JSON.stringify(event),
      JSON.stringify(amended),
    );
    db.prepare(
      "INSERT OR REPLACE INTO sp_checks(account,day,reason) SELECT account,day,? FROM sp_statements WHERE account=? AND day>=?",
    ).run(tMain("ibkr.hist.checkStatement"), event.accountId, dayOf(event.date));
  }
}
