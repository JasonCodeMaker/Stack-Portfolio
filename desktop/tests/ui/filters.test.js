import { describe, expect, it } from "vitest";
import {
  accountScope,
  choosePreset,
  chooseRange,
  clearRange,
  dashboardQuery,
  defaultFilters,
  isCustom,
  periodQuery,
  rememberedFilters,
  restoreFilters,
  setValuationDate,
} from "../../ui/filters.js";

describe("global filters across a restart", () => {
  it("open on all accounts, today and 今年以来 the first time", () => {
    expect(restoreFilters(null)).toEqual(defaultFilters);
    expect(defaultFilters).toMatchObject({ ids: null, date: "", period: "ytd", from: null, to: null });
  });

  it("remember the account scope and the period, but the valuation date returns to today", () => {
    const before = { ids: ["ibkr"], date: "2025-12-31", period: "1y", from: null, to: null };
    const saved = JSON.parse(JSON.stringify(rememberedFilters(before)));
    expect(restoreFilters(saved)).toEqual({ ...before, date: "" });
  });

  it("remember a custom range from the review", () => {
    const before = { ...defaultFilters, from: "2026-02-01", to: "2026-03-31" };
    expect(restoreFilters(rememberedFilters(before))).toEqual(before);
  });

  it("fall back to the defaults when the saved filters are unreadable", () => {
    expect(restoreFilters({ ids: "x", period: "weekly", from: "nope" })).toEqual(defaultFilters);
    expect(restoreFilters("garbage")).toEqual(defaultFilters);
  });
});

describe("period", () => {
  const range = { ...defaultFilters, period: "1y", from: "2026-02-01", to: "2026-03-31" };
  it("is a preset ending on the valuation date", () => {
    const f = choosePreset(range, "mtd");
    expect(f).toMatchObject({ period: "mtd", from: null, to: null });
    expect(periodQuery(f, "2026-10-30")).toEqual({ period: "mtd", to: "2026-10-30" });
  });

  it("is a custom range chosen on the review, ending no later than the valuation date", () => {
    const f = chooseRange(defaultFilters, "2026-02-01", "2026-12-31", "2026-10-30");
    expect(f).toMatchObject({ period: "ytd", from: "2026-02-01", to: "2026-10-30" });
    expect(periodQuery(f, "2026-10-30")).toEqual({ period: "ytd", from: "2026-02-01", to: "2026-10-30" });
    expect(isCustom(f)).toBe(true);
  });

  it("ignores a custom range that starts after it ends", () => {
    expect(chooseRange(defaultFilters, "2026-05-01", "2026-04-01", "2026-10-30")).toBe(defaultFilters);
  });

  it("returns from a custom range to the preset chosen before it", () => {
    expect(clearRange(range)).toMatchObject({ period: "1y", from: null, to: null });
    expect(isCustom(clearRange(range))).toBe(false);
  });
});

describe("account scope", () => {
  const active = ["ibkr", "webull"];
  it("is 全部账户 when every active account is chosen, so accounts added later are included", () => {
    expect(accountScope(["webull", "ibkr"], active)).toBeNull();
    expect(accountScope(["webull"], active)).toEqual(["webull"]);
  });

  it("asks the dashboard for all accounts or the chosen ones, with the valuation date and period", () => {
    expect(dashboardQuery(defaultFilters)).toEqual({ ids: "all", date: "", period: "ytd" });
    expect(dashboardQuery({ ids: ["ibkr"], date: "2025-12-31", period: "ytd", from: "2025-02-01", to: "2025-06-30" })).toEqual({
      ids: ["ibkr"],
      date: "2025-12-31",
      period: "ytd",
      from: "2025-02-01",
      to: "2025-06-30",
    });
  });
});

describe("valuation date", () => {
  const today = "2026-11-22";
  it("is a past day the user chose, and choosing today goes back to today", () => {
    const past = setValuationDate(defaultFilters, "2025-12-31", today);
    expect(past.date).toBe("2025-12-31");
    expect(setValuationDate(past, today, today).date).toBe("");
    expect(setValuationDate(past, "", today).date).toBe("");
  });

  it("cuts a custom range's end back to an earlier valuation date", () => {
    const range = { ...defaultFilters, period: "3m", from: "2025-10-01", to: "2026-03-31" };
    expect(setValuationDate(range, "2025-12-31", today)).toMatchObject({
      date: "2025-12-31",
      period: "3m",
      from: "2025-10-01",
      to: "2025-12-31",
    });
  });

  it("returns to 今年以来 when the custom range starts after the valuation date", () => {
    const range = { ...defaultFilters, period: "3m", from: "2026-02-01", to: "2026-03-31" };
    expect(setValuationDate(range, "2025-12-31", today)).toMatchObject({ period: "ytd", from: null, to: null });
  });

  it("leaves a preset alone, since every preset ends on the valuation date", () => {
    expect(setValuationDate({ ...defaultFilters, period: "1y" }, "2025-12-31", today)).toMatchObject({
      period: "1y",
      from: null,
      to: null,
    });
  });
});
