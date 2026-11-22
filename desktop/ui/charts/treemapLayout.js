import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

// Grouped squarified treemap (prototype allocation variant D), laid out with d3-hierarchy.
const GROUP_GAP = 6;
const HEADER = 19;

const sum = (items) => items.reduce((s, i) => s + i.value, 0);

// Squarify `items` (values > 0) into the rectangle; returns [{ item, x, y, w, h }].
function squarify(items, x, y, w, h) {
  const kept = items.filter((i) => i.value > 0);
  if (!kept.length || w <= 0 || h <= 0) return [];
  const root = hierarchy({ children: kept }, (d) => d.children)
    .sum((d) => (d.children ? 0 : d.value))
    .sort((a, b) => b.value - a.value);
  treemap().tile(treemapSquarify).size([w, h]).round(false)(root);
  return root.leaves().map((n) => ({ item: n.data, x: x + n.x0, y: y + n.y0, w: n.x1 - n.x0, h: n.y1 - n.y0 }));
}

// Text that fits a named tile: main label size, and up to two detail lines.
function namedText(item, w, h) {
  const main = Math.min(28, (w - 8) / (item.label.length * 0.68), (h - 6) / 1.3);
  if (!(main >= 9)) return { font: null, detailFont: null, lines: [] };
  const small = Math.max(10, Math.min(14, main * 0.55)),
    fits = (text) => w > text.length * small * 0.62 + 8,
    [first, second] = item.detail ?? [],
    lines = [];
  if (first != null && main >= 10 && h > main * 1.2 + small * 1.3 + 6 && fits(first)) {
    lines.push(first);
    if (second != null && h > main * 1.2 + small * 2.7 + 8 && fits(second)) lines.push(second);
  }
  return { font: main, detailFont: small, lines };
}

// Grey 「其他」 tiles carry one short top-left label: "其他 10.0%", or just the label, or nothing.
function restText(item, w, h) {
  const full = [item.label, item.detail?.[0]].filter(Boolean).join(" ");
  const text = h > 22 && w > full.length * 8 + 10 ? full : h > 22 && w > 34 ? item.label : null;
  return { font: null, detailFont: null, lines: [], text };
}

/**
 * groups: [{ key, label, caption?, items: [{ id, label, value, rest?, detail?: [line2, line3] }] }]
 * `rest` items are the light grey 「其他」 blocks, placed at the end of their group.
 * Returns { groups: [{ key, x, y, w, h, header, content }], tiles: [{ item, group, x, y, w, h, rest, font, detailFont, lines, text? }] }.
 */
export function treemapLayout(groups, width, height) {
  const outGroups = [],
    tiles = [];
  const boxes = squarify(
    groups.map((g) => ({ ...g, value: sum(g.items) })),
    0,
    0,
    width,
    height,
  );
  for (const box of boxes) {
    const g = box.item;
    let x = box.x + GROUP_GAP / 2,
      y = box.y + GROUP_GAP / 2,
      w = box.w - GROUP_GAP,
      h = box.h - GROUP_GAP;
    if (w < 8 || h < 8) continue;
    let header = null;
    const frame = { x, y, w, h };
    if (h > 54 && w > 70) {
      header = { x, y, w, label: g.label, caption: g.caption ?? "" };
      y += HEADER;
      h -= HEADER;
    }

    const named = g.items.filter((i) => !i.rest),
      rest = g.items.filter((i) => i.rest),
      share = sum(rest) / (sum(named) + sum(rest));
    let rx = x,
      ry = y,
      rw = w,
      rh = h,
      nw = w,
      nh = h;
    if (named.length && sum(named) > 0) {
      if (w >= h) {
        rw = w * share;
        rx = x + w - rw;
        nw = w - rw;
      } else {
        rh = h * share;
        ry = y + h - rh;
        nh = h - rh;
      }
    }
    outGroups.push({ key: g.key, ...frame, header, content: { x, y, w, h } });

    const place = (r, isRest) => {
      const tw = r.w - 1,
        th = r.h - 1;
      if (tw < 3 || th < 3) return;
      const text = isRest ? restText(r.item, tw, th) : namedText(r.item, tw, th);
      tiles.push({ item: r.item, group: g.key, x: r.x + 0.5, y: r.y + 0.5, w: tw, h: th, rest: isRest, ...text });
    };
    squarify(rest, rx, ry, rw, rh).forEach((r) => place(r, true));
    if (named.length) squarify(named, x, y, nw, nh).forEach((r) => place(r, false));
  }
  return { groups: outGroups, tiles };
}
