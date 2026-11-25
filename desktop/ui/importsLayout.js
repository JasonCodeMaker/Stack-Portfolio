// Layout and wording rules of the 导入与对账 page (spec §4.5). Pure, so they can be tested without the app.

// 记录与同步: the import card with either the recent batches (nothing being synced) or one preview card per
// broker. Layouts are for <Grid>; three columns put each broker in its own column.
export function syncLayout(previews, { batches = true } = {}) {
  if (!previews.length)
    return {
      1: [["update", ...(batches ? ["batches"] : [])]],
      2: batches ? [{ weight: 1.05, items: ["update"] }, { weight: 1, items: ["batches"] }] : [["update"]],
    };
  const layout = {
    1: [["update", ...previews]],
    2: [{ weight: 1.05, items: ["update"] }, { weight: 1, items: previews }],
  };
  if (previews.length > 1)
    layout[3] = [{ weight: 1, items: ["update"] }, ...previews.map((p) => ({ weight: 1.3, items: [p] }))];
  return layout;
}

// 和券商结单核对: statement and evidence sit side by side in 21:9.
export function checkLayout(evidence) {
  if (!evidence) return { 1: [["statement"]] };
  return {
    1: [["statement", "evidence"]],
    2: [
      { weight: 1.05, items: ["statement"] },
      { weight: 1, items: ["evidence"] },
    ],
  };
}

const units = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 8 });

// A statement comparison writes out each security quantity that differs: account, security and units.
export function quantityGaps(rows, account) {
  return rows
    .filter((r) => r.symbol && Math.abs(Number(r.delta)) > 1e-8)
    .map(
      (r) =>
        `${account} 的 ${r.symbol} 比结单${Number(r.delta) < 0 ? "少" : "多"} ${units.format(Math.abs(Number(r.delta)))} 股`,
    );
}
