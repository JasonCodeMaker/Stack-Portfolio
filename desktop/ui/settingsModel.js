// Pure rules behind the settings page (spec §4.6).
import { tMain } from "../i18n/index.js";

// Grid layout for one tab's cards: one column in 16:9 and two proportioned columns in 21:9,
// dealt round-robin so reading order runs across the row.
export function cardColumns(keys) {
  const column = (k) => ({ weight: k === 0 ? 1.05 : 1, items: keys.filter((_, i) => i % 2 === k) });
  return { 1: [keys], 2: [column(0), column(1)] };
}

// Saved fund identity mappings as table rows. Scoped keys are "scope:<provider>:<fund>:<source identity>".
export function aliasRows(aliases) {
  return Object.entries(aliases).map(([key, id]) => {
    const m = key.match(/^scope:([^:]*):([^:]*):(.*)$/s);
    return m
      ? { key, provider: m[1], fund: m[2], source: m[3], id }
      : { key, provider: "—", fund: null, source: key, id };
  });
}

// Connection state of one broker from the saved connection summary (api.connections()).
// needsAuth opens the authorisation steps; canUpdate offers immediate sync.
export function brokerState(conn, broker, demo = false, t = tMain) {
  if (demo) return { label: t("settings.state.sample"), tone: "muted", canUpdate: true, needsAuth: false, lastSuccess: null };
  if (!conn) return { label: t("settings.state.loading"), tone: "muted", canUpdate: false, needsAuth: false, lastSuccess: null };
  const present = conn.present || {},
    lastSuccess = conn.lastSuccess?.[broker] || null;
  const ready =
    broker === "ibkr"
      ? !!(conn.query && present["ibkr.flex-token"])
      : !!(conn.webullKey && conn.webullId && present["webull.app-secret"] && present["webull.access-token"]);
  if (!ready) return { label: t("settings.state.needsAuth"), tone: "muted", canUpdate: false, needsAuth: true, lastSuccess };
  return conn.verified?.[broker]
    ? { label: t("settings.state.connected"), tone: "up", canUpdate: true, needsAuth: false, lastSuccess }
    : { label: t("settings.state.needsVerify"), tone: "warn", canUpdate: true, needsAuth: false, lastSuccess };
}
