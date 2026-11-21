import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { dayOf, json, saveEvent } from "./ledger.js";

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
        blocked.set(id, "迁入成交的原始编号相同，内容或对应关系需核对");
        continue;
      }
      const native = (byIdentity.get(id) || []).filter((s) => !s.migrated);
      if (
        native.some((s) => s.event.isUserModified || !sameFill(s.event, r) || s.event.comment !== r.comment)
      ) {
        blocked.set(id, "同一成交已有手工更正，请核对原始记录");
        continue;
      }
      aliases.set(canonical.id, r.brokerRecordId);
      for (const { event } of native)
        superseded.set(event.id, {
          event,
          canonical,
          reason: "IBKR Flex 成交编号和成交明细均与迁入记录相同",
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
          reason: "IBKR 已列为预扣税，迁入账本另记为股息的同一款项已冲销",
        });
      }
    }
  }
  return { aliases, superseded, blocked };
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
    ).run("券商重复流水已冲销，请复核该期结单", event.accountId, dayOf(event.date));
  }
}
