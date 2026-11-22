import { describe, expect, it } from "vitest";
import { buildRebalanceModel } from "../../allocation/domain/rebalance";

const allocation = [
  { key: "stock:a", label: "A", type: "stock" as const, valueAud: 700, weight: 0.7 },
  { key: "etf:b", label: "B", type: "etf" as const, valueAud: 300, weight: 0.3 },
];

describe("rebalance model", () => {
  it("does not claim a recommendation until targets total 100%", () => {
    const model = buildRebalanceModel(allocation, 1000, { schemaVersion: 1, tolerance: 0.05, targets: { "stock:a": 0.5 } });
    expect(model.configured).toBe(false);
    expect(model.needsRebalance).toBe(false);
    expect(model.rows[0].status).toBe("unconfigured");
  });

  it("flags drift outside the configured tolerance", () => {
    const model = buildRebalanceModel(allocation, 1000, { schemaVersion: 1, tolerance: 0.05, targets: { "stock:a": 0.6, "etf:b": 0.4 } });
    expect(model.configured).toBe(true);
    expect(model.needsRebalance).toBe(true);
    expect(model.rows[0].status).toBe("overweight");
    expect(model.rows[0].adjustmentAud).toBeCloseTo(-100);
    expect(model.rows[1].status).toBe("underweight");
    expect(model.rows[1].adjustmentAud).toBeCloseTo(100);
  });
});
