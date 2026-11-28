// How each ledger account reaches its broker, shared by Settings (accounts & connections) and Imports (account list).
// Pure, so the rules can be tested without the app.
import { tMain } from "../i18n/index.js";
import { brokerState } from "./settingsModel.js";

export const brokerNames = { ibkr: "IBKR", webull: "Webull AU" };

// The broker an account syncs from: its own binding first, then the shared connection mapped to it.
export function accountBroker(account, conn, mapping = {}) {
  if (!account || account.custom) return null;
  const binding = conn?.bindings?.find((b) => b.id === account.id);
  if (binding) return binding.broker;
  return ["ibkr", "webull"].find((b) => mapping[b] === account.id) || null;
}

// kind: custom | sample | loading | binding | shared | none. tone colours the status dot or tag.
// syncable accounts take part in "update all accounts".
export function accountConnection(account, conn, mapping = {}, demo = false, t = tMain) {
  if (account.custom) return { kind: "custom", broker: null, tone: "muted", label: t("settings.conn.manual"), syncable: false };
  const broker = accountBroker(account, conn, mapping);
  if (demo)
    return { kind: "sample", broker, tone: broker ? "up" : "muted", label: t("settings.state.sample"), syncable: !!broker };
  if (!conn) return { kind: "loading", broker, tone: "muted", label: t("settings.state.loading"), syncable: false };
  const binding = conn.bindings?.find((b) => b.id === account.id);
  if (binding)
    return {
      kind: "binding",
      broker,
      binding,
      suffix: binding.suffix,
      tone: binding.authorized ? "up" : "warn",
      label: binding.authorized ? t("settings.state.connected") : t("settings.bindingNeedsReauth"),
      syncable: true,
    };
  if (broker) {
    const shared = brokerState(conn, broker, false, t);
    return {
      kind: "shared",
      broker,
      tone: shared.needsAuth ? "warn" : shared.tone,
      label: shared.label,
      needsAuth: shared.needsAuth,
      lastSuccess: shared.lastSuccess,
      syncable: true,
    };
  }
  return { kind: "none", broker: null, tone: "muted", label: t("settings.conn.notConnected"), syncable: false };
}

// Accounts "update all accounts" reads, in list order: active broker accounts with a known broker.
export function syncTargets(accounts, conn, mapping = {}, demo = false) {
  return accounts
    .filter((a) => a.active && !a.custom && (!a.mode || a.mode === "TRANSACTIONS"))
    .map((a) => ({ account: a.id, broker: accountConnection(a, conn, mapping, demo).syncable ? accountBroker(a, conn, mapping) : null }))
    .filter((target) => target.broker);
}

// Broker connections that are working, out of the active broker accounts.
export function connectionHealth(accounts, conn, mapping = {}, demo = false) {
  const brokers = accounts.filter((a) => a.active && !a.custom);
  return {
    total: brokers.length,
    ok: brokers.filter((a) => accountConnection(a, conn, mapping, demo).tone === "up").length,
  };
}

// The newest import batch of each account, for "last sync" lines.
export function lastBatches(batches = []) {
  const latest = {};
  for (const b of batches) if (!latest[b.account] || b.created > latest[b.account]) latest[b.account] = b.created;
  return latest;
}

// "Name · Broker", leaving out the broker when the account name already says it (an account named "IBKR").
export function accountTitle(name, broker) {
  if (!broker) return name;
  const label = brokerNames[broker] || broker;
  return String(name).toLowerCase().includes(String(broker).toLowerCase()) ? name : name + " · " + label;
}
