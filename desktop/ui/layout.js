// Layout rules of the adaptive shell (spec §3). Pure functions, so the shell and the pages share one source.

// The tier follows the viewport width and only shapes the shell; a viewport lower than 720 uses the short header.
export function shellTier(width, height) {
  return { tier: width < 1320 ? "compact" : width < 1800 ? "regular" : "wide", short: height < 720 };
}

// Columns follow the content area width (the scrolling pane, side paddings included), so opening the
// inspector or collapsing the sidebar changes them.
export function gridColumns(contentWidth) {
  return contentWidth >= 2240 ? 3 : contentWidth >= 1480 ? 2 : 1;
}

// The main chart fills what is left of the first screen (240–560 unless a page passes its own limits). When the
// content area is at least 800 high, the next panel in the column keeps up to 260 px in view.
export function mainChartHeight({ paneHeight, chartTop, cardPaddingBottom, nextHeight, below = 0, min = 240, max = 560 }) {
  const reserve = nextHeight != null && paneHeight >= 800 ? Math.min(nextHeight, 260) + 14 : 0;
  const fit = paneHeight - chartTop - cardPaddingBottom - 16 - reserve - below;
  return Math.round(Math.max(min, Math.min(max, fit)));
}

// ↑↓ in a table moves the selected row; undefined means the key does not move the selection.
export function stepRow(ids, current, key) {
  const delta = { ArrowDown: 1, ArrowUp: -1 }[key];
  if (!delta || !ids.length) return undefined;
  const at = ids.indexOf(current);
  if (at < 0) return delta > 0 ? ids[0] : ids[ids.length - 1];
  return ids[Math.max(0, Math.min(ids.length - 1, at + delta))];
}

const defaultWeights = { 1: [1], 2: [2, 1], 3: [2, 1, 1] };

// layout = { 1: [col], 2: [col, col], 3: [col, col, col] }; a col is a list of panel keys (a nested list is a
// side-by-side pair) or { weight, items }. A missing count falls back to the widest one declared below it.
export function arrangeGrid(layout, cols) {
  const count = Math.max(...Object.keys(layout).map(Number).filter((n) => n <= cols), 1);
  const declared = layout[count] || layout[Math.min(...Object.keys(layout).map(Number))];
  const weights = defaultWeights[declared.length] || declared.map(() => 1);
  const columns = declared.map((c, i) => (Array.isArray(c) ? { weight: weights[i], items: c } : c));
  return {
    template: columns.map((c) => `minmax(0,${c.weight}fr)`).join(" "),
    columns: columns.map((c) => c.items),
  };
}
