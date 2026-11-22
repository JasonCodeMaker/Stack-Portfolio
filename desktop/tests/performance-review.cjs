// Run against the built app with node tests/performance-review.cjs.
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const root = path.join(__dirname, "..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-review-"));
  const env = {
    ...process.env,
    STACK_PORTFOLIO_HEADLESS: "1",
    STACK_PORTFOLIO_TEST_DIR: directory,
    STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: require("electron"), args: [root], env, timeout: 30000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    await page.getByRole("button", { name: "打开示例账本" }).click();
    const nav = page.getByRole("navigation", { name: "页面" });
    await page.getByLabel("估值日").fill("2026-10-30");
    await nav.getByRole("button", { name: "收益复盘", exact: true }).click();

    await page.getByRole("group", { name: "期间" }).getByRole("button", { name: "本月" }).click();
    const drawdown = page.getByRole("region", { name: "最大回撤" });
    await drawdown.waitFor();
    assert.match(await drawdown.innerText(), /−[\d.]+%[\s\S]*\d\d-\d\d 至 \d\d-\d\d[\s\S]*收复/);
    assert.equal(await page.getByRole("button", { name: "回撤", exact: true }).count(), 0);
    await page.getByText("不满一年，不显示年化").waitFor();
    const benchmarks = page.getByRole("group", { name: "对比基准" });
    await benchmarks.getByRole("button", { name: /^纳斯达克 100/ }).click();
    await page.getByRole("region", { name: "对纳斯达克 100", exact: true }).waitFor();
    const cumulative = page.getByRole("img", { name: "累计收益曲线" });
    await cumulative.waitFor();
    const labels = cumulative.locator(".ch-end");
    assert.deepEqual(await labels.allTextContents(), ["我的组合", "标普 500", "纳斯达克 100"]);
    await page.getByRole("group", { name: "主图视图" }).getByRole("button", { name: "收益差" }).click();
    const gap = page.getByRole("img", { name: "收益差曲线 · 对纳斯达克 100" });
    await gap.getByText("对纳斯达克 100", { exact: true }).waitFor();
    await gap.getByText(/最长跑输/).waitFor();
    await page.getByRole("group", { name: "主图视图" }).getByRole("button", { name: "累计收益" }).click();
    await cumulative.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: /当日明细/ }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "逐日数据", exact: true }).click();
    const daily = page.getByRole("dialog", { name: "逐日数据", exact: true });
    await daily.getByRole("columnheader", { name: "当日收益" }).waitFor();
    await daily.getByRole("columnheader", { name: "纳斯达克 100" }).waitFor();
    await daily.getByRole("button", { name: "2026-10-30", exact: true }).click();
    await page.getByRole("dialog", { name: "2026-10-30 · 当日明细", exact: true }).waitFor();
    await page.keyboard.press("Escape");

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080));
    await page.waitForFunction(() => document.querySelector(".pane").dataset.cols === "2");
    await page.getByRole("button", { name: "数据来源与计算方法", exact: true }).click();
    const sources = page.getByRole("complementary", { name: "数据来源与计算方法", exact: true });
    await sources.getByText(/NASDAQXNDX|模拟总回报/).first().waitFor();
    await page.waitForFunction(() => document.querySelector(".pane").dataset.cols === "1");
    await sources.getByRole("button", { name: "关闭" }).click();
    await page.waitForFunction(() => document.querySelector(".pane").dataset.cols === "2");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));

    const breakdown = page.getByRole("region", { name: "盈亏构成" });
    await breakdown.getByRole("button", { name: /^未实现变动/ }).click();
    await breakdown.getByRole("table").getByRole("button", { name: "IVV", exact: true }).waitFor();
    assert.equal(await breakdown.getByRole("button", { name: /^未实现变动/ }).getAttribute("aria-expanded"), "true");
    const contribution = page.getByRole("region", { name: "持仓贡献" });
    await contribution.getByRole("button", { name: /^IVV/ }).click();
    await page.getByRole("heading", { name: "持仓", exact: true }).waitFor();
    console.log("Short review periods still show the drawdown and recovery dates.");
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
