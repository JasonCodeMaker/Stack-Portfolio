const { test } = require("node:test");
const assert = require("node:assert/strict");
const { initialWindow } = require("../out/windowState.cjs");

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } });

test("first launch opens a 1440×900 window centred in the primary work area", () => {
  const primary = display(0, 40, 2560, 1360);
  assert.deepEqual(initialWindow(null, [primary], primary), {
    bounds: { x: 560, y: 270, width: 1440, height: 900 },
    maximized: false,
  });
});

test("first launch on a work area smaller than 1440×900 fills that work area", () => {
  const primary = display(0, 0, 1366, 728);
  assert.deepEqual(initialWindow(null, [primary], primary).bounds, { x: 0, y: 0, width: 1366, height: 728 });
});

test("a later launch restores the last position, size and maximized state", () => {
  const primary = display(0, 0, 1920, 1040),
    secondary = display(1920, 0, 2560, 1400);
  const saved = { bounds: { x: 2100, y: 120, width: 1600, height: 1000 }, maximized: true };
  assert.deepEqual(initialWindow(saved, [primary, secondary], primary), saved);
});

test("a malformed saved window state opens the default window", () => {
  const primary = display(0, 0, 1920, 1040);
  const fallback = { bounds: { x: 240, y: 70, width: 1440, height: 900 }, maximized: false };
  for (const saved of [{}, { bounds: { x: 10, y: 10 } }, { bounds: { x: 0, y: 0, width: "wide", height: 900 } }, "1440x900"])
    assert.deepEqual(initialWindow(saved, [primary], primary), fallback);
});

test("a window closed maximized on a removed secondary display opens 1440×900 on the primary display", () => {
  const primary = display(0, 0, 1920, 1040);
  const saved = { bounds: { x: 2100, y: 120, width: 1600, height: 1000 }, maximized: true };
  assert.deepEqual(initialWindow(saved, [primary], primary), {
    bounds: { x: 240, y: 70, width: 1440, height: 900 },
    maximized: false,
  });
});
