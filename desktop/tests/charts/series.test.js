import { describe, expect, it } from "vitest";
import { seriesColor, SERIES_COLORS } from "../../ui/charts/series.js";

describe("series colours", () => {
  it("gives the first position to my portfolio and follows the fixed kit order", () => {
    expect(SERIES_COLORS).toEqual(["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"]);
    expect(seriesColor(0)).toBe("var(--s1)");
    expect(seriesColor(5)).toBe("var(--s6)");
  });

  it("does not cycle past the sixth colour and never hands out red", () => {
    expect(() => seriesColor(6)).toThrow();
    expect(SERIES_COLORS.join(" ")).not.toMatch(/--down|--td/);
  });
});
