import { hierarchy, treemap, treemapBinary, treemapSquarify } from "d3-hierarchy";

const estimateWidth = (text) => text.replace(/[^\x20-\x7e]/g, "WW").length * 0.7;
const minFont = 11;
export const inlineLabelGap = 7;

function fitLabel(labels, detail, w, h, measureWidth) {
  const [share, change] = detail;
  const labelWidth = Math.max(...labels.map((line) => measureWidth(line, 650)));
  const labelHeight = labels.length * 1.2;
  const shareWidth = share ? measureWidth(share, 400) : 0;
  const font = Math.min(28, w / labelWidth, (h - (share ? minFont * 1.2 : 0)) / labelHeight);
  if (font < minFont || shareWidth * minFont > w) return null;
  const detailFont = Math.max(minFont, Math.min(14, font * 0.55, w / shareWidth, (h - font * labelHeight) / 1.2));
  const lines = share ? [share] : [];
  if (change && h >= font * labelHeight + detailFont * 2.4 && w >= measureWidth(change, 400) * detailFont) lines.push(change);
  return { labels, font, detailFont, lines };
}

function tileText(item, w, h, measureWidth) {
  const detail = item.detail ?? [];
  const innerWidth = w - 6, innerHeight = h - 6;
  const fit = (labels) => fitLabel(labels, detail, innerWidth, innerHeight, measureWidth);
  const single = fit([item.label]);
  const tickers = item.label.split(" / ");
  const split = tickers.length > 1 && !(single?.font >= 16) ? fit(tickers) : null;
  if (split && split.font > (single?.font ?? 0)) return split;
  if (single) return single;

  const [share] = detail;
  if (!share) return null;
  const lineWidth = measureWidth(item.label, 650) + measureWidth(share, 400);
  const font = Math.min(14, (innerWidth - inlineLabelGap) / lineWidth, innerHeight / 1.2);
  return font >= minFont ? { labels: [item.label], font, detailFont: font, lines: [share], inline: true } : null;
}

function otherAtBottom(root, x0, y0, x1, y1) {
  const other = root.children.at(-1);
  const cut = y1 - (y1 - y0) * (other.value / root.value);
  treemapSquarify({ children: root.children.slice(0, -1), value: root.value - other.value }, x0, y0, x1, cut);
  Object.assign(other, { x0, y0: cut, x1, y1 });
}

function otherAtRight(root, x0, y0, x1, y1) {
  const other = root.children.at(-1);
  const cut = x1 - (x1 - x0) * (other.value / root.value);
  treemapSquarify({ children: root.children.slice(0, -1), value: root.value - other.value }, x0, y0, cut, y1);
  Object.assign(other, { x0: cut, y0, x1, y1 });
}

const tilers = [treemapSquarify, treemapSquarify.ratio(1), treemapBinary];

function paintTile({ data: item, x0, x1, y0, y1 }, measureWidth, gap = 1) {
  const gapX = Math.min(gap, (x1 - x0) / 2), gapY = Math.min(gap, (y1 - y0) / 2);
  const w = x1 - x0 - gapX, h = y1 - y0 - gapY;
  return { item, x: x0 + gapX / 2, y: y0 + gapY / 2, w, h, text: tileText(item, w, h, measureWidth) };
}

function layoutScore(tiles) {
  let outside = 0, otherOutside = 0, inline = 0, worstAspect = 1;
  for (const { item, text, w, h } of tiles) {
    if (item.rest) {
      otherOutside += Number(!text);
      continue;
    }
    outside += Number(!text);
    inline += Number(text?.inline === true);
    worstAspect = Math.max(worstAspect, w / h, h / w);
  }
  return [outside, otherOutside, inline, Math.round(worstAspect * 10)];
}

function isBetter(score, best) {
  const firstDifference = score.findIndex((value, i) => value !== best[i]);
  return firstDifference >= 0 && score[firstDifference] < best[firstDifference];
}

export function treemapLayout(items, width, height, measureWidth = estimateWidth, options = {}) {
  const kept = items.filter((item) => item.value > 0);
  if (!kept.length || width <= 0 || height <= 0) return [];
  const gap = options.gap ?? 1;
  const root = hierarchy({ children: kept }).sum((node) => node.value ?? 0).sort((a, b) => {
    if (Boolean(a.data.rest) !== Boolean(b.data.rest)) return a.data.rest ? 1 : -1;
    return b.value - a.value;
  });
  const pack = treemap().size([width, height]);
  const lastNode = root.children.at(-1);
  const canPinRight = options.pinOtherRight && kept.length > 1 && lastNode.data.rest && lastNode.value / root.value >= 0.04;
  if (canPinRight) {
    return pack.tile(otherAtRight)(root).leaves().map((leaf) => paintTile(leaf, measureWidth, gap));
  }
  const tilerOptions = kept.length > 1 && lastNode.data.rest ? [...tilers, otherAtBottom] : tilers;
  let best, bestScore;
  for (const tile of tilerOptions) {
    const candidate = pack.tile(tile)(root).leaves().map((leaf) => paintTile(leaf, measureWidth, gap));
    const score = layoutScore(candidate);
    if (!best || isBetter(score, bestScore)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function subTreemapLayout(items, width, height) {
  const kept = items.filter((item) => item.value > 0);
  if (!kept.length || width <= 8 || height <= 8) return [];
  const root = hierarchy({ children: kept }).sum((node) => node.value ?? 0).sort((a, b) => b.value - a.value);
  return treemap().size([width, height]).tile(treemapSquarify)(root).leaves().map((leaf) => ({
    item: leaf.data,
    x: leaf.x0,
    y: leaf.y0,
    w: leaf.x1 - leaf.x0,
    h: leaf.y1 - leaf.y0,
  }));
}
