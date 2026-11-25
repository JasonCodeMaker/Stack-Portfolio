// Compare the actual plot, after layout, against the native overview in the same window.
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const desktop = path.resolve(__dirname, "../../../../../desktop");
const { chromium } = createRequire(path.join(desktop, "package.json"))("playwright-core");

const windows = [
  [320, 720], [390, 780], [625, 900], [820, 780], [880, 720],
  [1024, 768], [1260, 916], [1440, 900], [1920, 1080], [2560, 1080],
];

async function plotSize(view, chartMode) {
  const trend = view.locator(".overview-trend");
  await trend.getByRole("button", { name: chartMode, exact: true }).click();
  const chart = trend.getByRole("img", { name: chartMode, exact: true });
  await chart.press("End");
  await chart.locator(".ch-cross").waitFor({ state: "attached" });
  // Let the width observer and axis-label measurements settle after switching layouts.
  await chart.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const size = await chart.evaluate(svg => ({
    width: svg.querySelector(".ch-grid").getBoundingClientRect().width,
    height: svg.querySelector(".ch-cross").getBoundingClientRect().height,
  }));
  await chart.press("Escape");
  assert(size.width > 0 && size.height > 0);
  return size;
}

async function verify() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
    const nav = page.getByRole("navigation", { name: "对照布局" });
    const view = page.locator("[data-variant]:visible");
    for (const [width, height] of windows) {
      await page.setViewportSize({ width, height });
      for (const mode of ["总资产与净投入", "投资盈亏"]) {
        await nav.getByRole("button", { name: "现版总览" }).click();
        const current = await plotSize(view, mode);
        for (const candidate of ["日常查账优先", "期间复盘优先"]) {
          await nav.getByRole("button", { name: candidate }).click();
          const size = await plotSize(view, mode);
          assert(size.width >= current.width && size.height >= current.height,
            `${candidate} / ${mode} at ${width}×${height}: ${JSON.stringify({ size, current })}`);
        }
      }
    }
    console.log("Both chart modes meet the current overview's plot width and height in all 10 windows.");
  } finally {
    await browser.close();
  }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
