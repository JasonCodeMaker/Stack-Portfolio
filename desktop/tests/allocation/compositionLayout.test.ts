import { describe, expect, it } from "vitest";
import { squarify } from "../../allocation/domain/compositionLayout";

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
});
