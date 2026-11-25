const { computeDisplayState } = require("../../out/adaptiveLayout.cjs");

async function resizeContent(app, page, width, height) {
  const prior = await page.evaluate(() => window.portfolio.displayState());
  const [dipWidth, dipHeight] = await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(w, h);
    return win.getContentSize();
  }, [width, height]);
  const next = computeDisplayState({ dipWidth, dipHeight, currentAspect: prior.aspect, userScaleMultiplier: prior.userScaleMultiplier });
  await page.waitForFunction(({ w, h, aspect, zoom }) =>
    document.documentElement.dataset.aspect === aspect &&
    Math.abs(innerWidth - w / zoom) <= 2 && Math.abs(innerHeight - h / zoom) <= 2,
    { w: dipWidth, h: dipHeight, aspect: next.aspect, zoom: next.zoomFactor });
  return next;
}

module.exports = { resizeContent };
