export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Placed<T> = T & Box;

/** Squarified treemap (Bruls, Huizing & van Wijk): largest items first, rows laid along the short side. */
export function squarify<T extends { valueAud: number }>(items: T[], box: Box): Array<Placed<T>> {
  const total = sumValues(items);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const nodes = items.filter((item) => item.valueAud > 0).map((item) => ({ item, area: item.valueAud * scale })).sort((a, b) => b.area - a.area);
  const placed: Array<Placed<T>> = [];
  let free = { ...box };
  let row: typeof nodes = [];

  const worstRatio = (candidate: typeof nodes, side: number) => {
    const sum = candidate.reduce((acc, node) => acc + node.area, 0);
    const largest = Math.max(...candidate.map((node) => node.area));
    const smallest = Math.min(...candidate.map((node) => node.area));
    return Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest));
  };

  const flush = () => {
    const sum = row.reduce((acc, node) => acc + node.area, 0);
    if (free.w >= free.h) {
      const width = sum / free.h;
      let y = free.y;
      for (const node of row) {
        const h = node.area / width;
        placed.push({ ...node.item, x: free.x, y, w: width, h });
        y += h;
      }
      free = { x: free.x + width, y: free.y, w: free.w - width, h: free.h };
    } else {
      const height = sum / free.w;
      let x = free.x;
      for (const node of row) {
        const w = node.area / height;
        placed.push({ ...node.item, x, y: free.y, w, h: height });
        x += w;
      }
      free = { x: free.x, y: free.y + height, w: free.w, h: free.h - height };
    }
    row = [];
  };

  for (const node of nodes) {
    const side = Math.min(free.w, free.h);
    if (row.length && worstRatio([...row, node], side) > worstRatio(row, side)) flush();
    row.push(node);
  }
  if (row.length) flush();
  return placed;
}

function sumValues(items: Array<{ valueAud: number }>): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.valueAud), 0);
}
