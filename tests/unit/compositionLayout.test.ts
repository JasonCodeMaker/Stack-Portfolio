import { describe, expect, it } from "vitest";
import { layoutComposition, squarify } from "@/domain/compositionLayout";

const box = { x: 0, y: 0, w: 400, h: 200 };

function area(rect: { w: number; h: number }): number {
  return rect.w * rect.h;
}

describe("composition layout", () => {
  it("gives every item an area proportional to its value inside the box", () => {
    const items = [{ key: "a", valueAud: 50 }, { key: "b", valueAud: 30 }, { key: "c", valueAud: 15 }, { key: "d", valueAud: 5 }];

    const placed = squarify(items, box);

    expect(placed.map((rect) => rect.key).sort()).toEqual(["a", "b", "c", "d"]);
    for (const rect of placed) {
      const item = items.find((candidate) => candidate.key === rect.key)!;
      expect(area(rect)).toBeCloseTo(area(box) * (item.valueAud / 100));
      expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.x + rect.w).toBeLessThanOrEqual(box.w + 1e-9);
      expect(rect.y + rect.h).toBeLessThanOrEqual(box.h + 1e-9);
    }
  });

  it("returns nothing for an empty box or items without value", () => {
    expect(squarify([{ key: "a", valueAud: 10 }], { x: 0, y: 0, w: 0, h: 100 })).toEqual([]);
    expect(squarify([{ key: "a", valueAud: 0 }], box)).toEqual([]);
  });

  it("keeps named companies on the left and stacks the rest in a right-hand column", () => {
    const named = [{ key: "nvda", valueAud: 30 }, { key: "aapl", valueAud: 20 }];
    const rest = [{ key: "other", valueAud: 40 }, { key: "cash", valueAud: 10 }];

    const layout = layoutComposition(named, rest, box);

    const split = box.w * 0.5;
    for (const rect of layout.named) expect(rect.x + rect.w).toBeLessThanOrEqual(split + 1e-9);
    expect(layout.rest.map((rect) => [rect.key, rect.x, rect.w])).toEqual([["other", split, split], ["cash", split, split]]);
    expect(layout.rest.map((rect) => rect.h)).toEqual([160, 40]);
    expect(layout.rest[1].y).toBe(160);
  });

  it("uses the whole box when there is nothing but named items", () => {
    const layout = layoutComposition([{ key: "ivv", valueAud: 60 }, { key: "ndq", valueAud: 40 }], [], box);

    expect(layout.rest).toEqual([]);
    expect(layout.named.reduce((sum, rect) => sum + area(rect), 0)).toBeCloseTo(area(box));
  });
});
