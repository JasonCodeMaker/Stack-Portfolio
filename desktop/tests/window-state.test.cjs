const { test } = require("node:test");
const assert = require("node:assert/strict");
const { initialWindow, minimumWindowSize } = require("../out/windowState.cjs");

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } });

test("first launch opens a 1600×900 window centred in the primary work area", () => {
  const primary = display(0, 40, 2560, 1360);
  assert.deepEqual(initialWindow(null, [primary], primary), {
    bounds: { x: 480, y: 270, width: 1600, height: 900 },
    maximized: false,
  });
});

test("first launch on a work area smaller than 1600×900 fills that work area", () => {
  const primary = display(0, 0, 1366, 728);
  assert.deepEqual(initialWindow(null, [primary], primary).bounds, { x: 0, y: 0, width: 1366, height: 728 });
});

test("a later launch restores the last position, size and maximized state", () => {
  const primary = display(0, 0, 1920, 1040),
    secondary = display(1920, 0, 2560, 1400);
  const saved = { bounds: { x: 2100, y: 120, width: 1600, height: 1000 }, maximized: true };
  assert.deepEqual(initialWindow(saved, [primary, secondary], primary), saved);
});

test("the minimum and restored bounds fit a high-DPI display with a short work area", () => {
  const highDpi = display(0, 28, 960, 498);
  assert.deepEqual(minimumWindowSize(highDpi.workArea), { width: 920, height: 498 });
  assert.deepEqual(minimumWindowSize(display(0, 0, 640, 348).workArea), { width: 640, height: 348 });
  const saved = { bounds: { x: 120, y: 140, width: 1600, height: 900 }, maximized: false };
  assert.deepEqual(initialWindow(saved, [highDpi], highDpi), {
    bounds: { x: 0, y: 28, width: 960, height: 498 },
    maximized: false,
  });
});

test("restored bounds fit even when a change of display leaves only a strip of the window visible", () => {
  const highDpi = display(0, 28, 960, 498);
  const saved = { bounds: { x: 40, y: 515, width: 920, height: 490 }, maximized: false };
  assert.deepEqual(initialWindow(saved, [highDpi], highDpi).bounds, { x: 40, y: 28, width: 920, height: 498 });
  const primary = display(0, 0, 1600, 900);
  const small = { bounds: { x: 700, y: 500, width: 700, height: 350 }, maximized: false };
  assert.deepEqual(initialWindow(small, [primary], primary).bounds, { x: 680, y: 250, width: 920, height: 650 });
});

test("a malformed saved window state opens the default window", () => {
  const primary = display(0, 0, 1920, 1040);
  const fallback = { bounds: { x: 160, y: 70, width: 1600, height: 900 }, maximized: false };
  for (const saved of [{}, { bounds: { x: 10, y: 10 } }, { bounds: { x: 0, y: 0, width: "wide", height: 900 } }, "1440x900"])
    assert.deepEqual(initialWindow(saved, [primary], primary), fallback);
});

test("a window closed maximized on a removed secondary display opens 1600×900 on the primary display", () => {
  const primary = display(0, 0, 1920, 1040);
  const saved = { bounds: { x: 2100, y: 120, width: 1600, height: 1000 }, maximized: true };
  assert.deepEqual(initialWindow(saved, [primary], primary), {
    bounds: { x: 160, y: 70, width: 1600, height: 900 },
    maximized: false,
  });
});
