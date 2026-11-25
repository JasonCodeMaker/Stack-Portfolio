import { describe, expect, it } from "vitest";
import { buildRebalanceModel } from "../../allocation/domain/rebalance";

const allocation = [
  { key: "stock:a", label: "A", type: "stock" as const, valueAud: 700, weight: 0.7 },
  { key: "etf:b", label: "B", type: "etf" as const, valueAud: 300, weight: 0.3 },
];

describe("rebalance model", () => {
  it("compares partial targets and keeps unspecified securities unconfigured", () => {
    const model = buildRebalanceModel(allocation, 1000, { schemaVersion: 1, tolerance: 0.05, targets: { "stock:a": 0.5 } });
    expect(model.configured).toBe(true);
    expect(model.needsRebalance).toBe(true);
    expect(model.rows[0].drift).toBeCloseTo(0.2);
    expect(model.rows[1].targetWeight).toBeNull();
    expect(model.rows[1].status).toBe("unconfigured");
  });

  it("includes the tolerance boundary and adjusts to the full target outside it", () => {
    const rows = [{ key: "ivv", label: "IVV", type: "etf" as const, valueAud: 40_000, weight: 0.4 }];
    const settings = { schemaVersion: 1 as const, tolerance: 0.05, targets: { ivv: 0.45 } };
    const atLimit = buildRebalanceModel(rows, 100_000, settings).rows[0];
    expect(atLimit.drift).toBeCloseTo(-0.05);
    expect(atLimit.status).toBe("on-target");
    const aboveAtLimit = buildRebalanceModel(rows, 100_000, { ...settings, targets: { ivv: 0.35 } }).rows[0];
    expect(aboveAtLimit.status).toBe("on-target");
    const outside = buildRebalanceModel(rows, 100_000, { ...settings, targets: { ivv: 0.46 } }).rows[0];
    expect(outside.status).toBe("underweight");
    expect(outside.adjustmentAud).toBeCloseTo(6_000);
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
