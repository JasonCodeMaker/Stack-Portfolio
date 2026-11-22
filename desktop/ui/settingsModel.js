// Pure rules behind the settings page (spec §4.6).

// Grid layout for one tab's cards: one column when narrow, at most two equal columns when wide,
// dealt round-robin so reading order runs across the row.
export function cardColumns(keys) {
  const column = (k) => ({ weight: 1, items: keys.filter((_, i) => i % 2 === k) });
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
// needsAuth opens the authorisation steps; canUpdate offers 立即更新.
export function brokerState(conn, broker, demo = false) {
  if (demo) return { label: "示例连接", tone: "muted", canUpdate: true, needsAuth: false, lastSuccess: null };
  if (!conn) return { label: "正在读取", tone: "muted", canUpdate: false, needsAuth: false, lastSuccess: null };
  const present = conn.present || {},
    lastSuccess = conn.lastSuccess?.[broker] || null;
  const ready =
    broker === "ibkr"
      ? !!(conn.query && present["ibkr.flex-token"])
      : !!(conn.webullKey && conn.webullId && present["webull.app-secret"] && present["webull.access-token"]);
  if (!ready) return { label: "待授权", tone: "muted", canUpdate: false, needsAuth: true, lastSuccess };
  return conn.verified?.[broker]
    ? { label: "已连接", tone: "up", canUpdate: true, needsAuth: false, lastSuccess }
    : { label: "待验证", tone: "warn", canUpdate: true, needsAuth: false, lastSuccess };
}
