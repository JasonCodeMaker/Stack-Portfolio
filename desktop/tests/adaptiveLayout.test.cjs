const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeDisplayState, normalizeUserScale, resolveAspect } = require("../out/adaptiveLayout.cjs");

test("aspect uses inclusive hysteresis thresholds and a separate first-launch threshold", () => {
  assert.equal(resolveAspect(2100, 1000), "21:9");
  assert.equal(resolveAspect(2099, 1000), "16:9");
  assert.equal(resolveAspect(2149, 1000, "16:9"), "16:9");
  assert.equal(resolveAspect(2150, 1000, "16:9"), "21:9");
  assert.equal(resolveAspect(2051, 1000, "21:9"), "21:9");
  assert.equal(resolveAspect(2050, 1000, "21:9"), "16:9");
});

test("window client DIPs choose the reference canvas across Windows DPI and resolutions", () => {
  const cases = [
    [1920, 1080, 1, "16:9", 1.12],
    [1920, 1080, 1.5, "16:9", 0.72],
    [2560, 1440, 1.25, "16:9", 1.20],
    [3840, 2160, 1, "16:9", 2.32],
    [3840, 2160, 1.5, "16:9", 1.52],
    [3840, 2160, 2, "16:9", 1.12],
    [2560, 1080, 1, "21:9", 1.12],
    [3440, 1440, 1, "21:9", 1.52],
    [3440, 1440, 1.25, "21:9", 1.20],
    [5120, 2160, 1, "21:9", 2.32],
  ];
  for (const [width, height, dpi, aspect, zoomFactor] of cases) {
    const actual = computeDisplayState({ dipWidth: width / dpi, dipHeight: height / dpi - 71 });
    assert.equal(actual.aspect, aspect, width + " at " + dpi);
    assert.equal(actual.zoomFactor, zoomFactor, width + " at " + dpi);
    assert.equal(actual.virtualHeight, 900);
    assert.equal(actual.virtualWidth, aspect === "21:9" ? 2100 : 1600);
  }
});

test("comfort zoom is normalized, multiplied and rounded with a snap near one", () => {
  assert.equal(normalizeUserScale(0.81), 0.85);
  assert.equal(normalizeUserScale(1.079), 1.10);
  assert.equal(normalizeUserScale(1.31), 1.30);
  for (const invalid of [undefined, null, "1.25", NaN, Infinity]) assert.equal(normalizeUserScale(invalid), 1);
  const zoom = (dipWidth, dipHeight, userScaleMultiplier) =>
    computeDisplayState({ dipWidth, dipHeight, userScaleMultiplier }).zoomFactor;
  assert.equal(zoom(920, 650, 0.85), 0.70);
  assert.equal(zoom(5120, 2160, 1.30), 2.50);
  assert.equal(zoom(1568, 882), 1);
  assert.equal(zoom(3440, 1369, 1.10), 1.68);
  assert.equal(zoom(2048, 1081, 1.10), 1.32);
});
