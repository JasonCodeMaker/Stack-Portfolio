// Chart series colours (spec §1.2). Fixed order, no cycling; position 1 is always
// 我的组合／总资产. Red is reserved for losses and never used for a series.
// The hex values per theme live in the design tokens (--s1 … --s6).
export const SERIES_COLORS = Object.freeze([1, 2, 3, 4, 5, 6].map((n) => `var(--s${n})`));

export function seriesColor(index) {
  const color = SERIES_COLORS[index];
  if (!color) throw new RangeError(`Only ${SERIES_COLORS.length} series colours exist; got position ${index + 1}`);
  return color;
}
