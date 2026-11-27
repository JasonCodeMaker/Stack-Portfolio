// Run after npm run build. Uses isolated books and an offscreen Electron window.
const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resizeContent } = require("./fixtures/display.cjs");

const tailDate = "2026-10-30";

async function seedTailBook(p) {
  await p.evaluate(async (date) => {
    const api = window.portfolio, openingDate = "2026-10-29";
    const account = await api.account({ name: "ETF 尾部验证", currency: "AUD" });
    await api.opening({
      account, date: openingDate, cash: { AUD: "20000" },
      positions: ["IVV", "SPMO"].map((symbol) => ({
        symbol, mic: "ARCX", kind: "ETF", quantity: "100", price: "400", currency: "AUD",
      })),
    });
    const d = await api.dashboard({ ids: [account], date });
    for (const { assetId, ticker, etfKey } of d.rows) {
      if (!etfKey) continue;
      await api.savePrice({ assetId, date, price: ticker === "IVV" ? 404 : 396 });
      const tailCount = 240, tailWeight = 0.8;
      const weightDenominator = tailCount * (tailCount + 1) / 2;
      const holdings = Array.from({ length: tailCount }, (_, index) => ({
        symbol: `${index < 12 ? "SHARED" : ticker}${String(index).padStart(3, "0")}`,
        name: `Constituent ${index}`,
        mic: "XNAS",
        sector: index % 2 === 0 ? "Technology" : "Financials",
        country: "United States",
        underlyingType: "stock",
        weight: (tailCount - index) * tailWeight / weightDenominator,
      }));
      const uncoveredWeight = ticker === "SPMO" ? 0.015 : 0;
      holdings.push({ ...holdings[0], symbol: `${ticker}CORE`, name: `${ticker} Core`, weight: 1 - tailWeight - uncoveredWeight });
      await api.fundSave({ snapshot: {
        schemaVersion: 2, etfKey, provider: "Tail explorer fixture", asOfDate: openingDate,
        fetchedAt: `${openingDate}T05:00:00Z`, holdings,
      } });
    }
  }, tailDate);
}

async function verifyTailExplorer(app, p, chart) {
  const button = (scope, name) => scope.getByRole("button", { name, exact: typeof name === "string" });
  const nav = p.getByRole("navigation", { name: "页面" });
  await button(nav, "配置分析").click();
  await p.getByLabel("估值日").fill(tailDate);
  await p.getByText(`正在查看 ${tailDate}`).waitFor();
  await resizeContent(app, p, 1920, 1080);

  const other = chart.locator(".ch-tm.rest.has-sub");
  const ivv = button(other, /^IVV/);
  const spmo = button(other, /^SPMO/);
  await ivv.waitFor();
  assert.match(await ivv.innerText(), /ETF[\s\S]*尾部 240 项[\s\S]*SHARED000 · SHARED001 · SHARED002/);
  const stock = chart.locator(".ch-tm:not(.rest):not(.cash):not(.compact) .ch-tm-card").first();
  const cardInset = (card) => card.evaluate((element) => getComputedStyle(element).padding);
  assert.equal(await cardInset(ivv.locator(".ch-tm-card")), await cardInset(stock));
  const { ticker, share, pill, tile } = await ivv.evaluate((element) => {
    const bounds = (selector) => element.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      ticker: bounds(".ch-tm-ticker-wrap b"),
      share: bounds(".ch-tm-pct"),
      pill: bounds(".ch-tm-badge-dark"),
      tile: element.getBoundingClientRect().toJSON(),
    };
  });
  assert.ok(Math.abs(ticker.left - share.left) < 1);
  assert.ok(share.left - tile.left < 16 && tile.right - pill.right < 16);
  assert.ok(Math.abs(share.bottom - pill.bottom) < 1);
  assert.match(await ivv.getAttribute("title"), /\+1\.00%/);
  assert.match(await spmo.getAttribute("title"), /−1\.00%/);
  assert.notEqual(await ivv.evaluate((tile) => tile.style.background), await spmo.evaluate((tile) => tile.style.background));
  await button(chart, "持有方式").click();
  assert.deepEqual(await ivv.or(spmo).evaluateAll((tiles) => tiles.map((tile) => tile.style.background)),
    ["var(--tm-how-etf)", "var(--tm-how-etf)"]);

  const explorer = chart.locator(".alloc-tail-explorer");
  const scope = explorer.getByRole("group", { name: "尾部查看范围" });
  const rows = explorer.locator("tbody tr.click");
  const search = explorer.getByRole("searchbox", { name: "搜索代码、公司或行业" });
  const sector = explorer.getByRole("group", { name: "尾部行业分布（点击过滤）" });
  await ivv.click();
  await scope.getByRole("button", { name: /^IVV/, pressed: true }).waitFor();
  assert.doesNotMatch(await explorer.locator(".alloc-tail-summary").innerText(), /总占总资产|主图 >1%/);
  await button(explorer, "管理成分表").waitFor();
  assert.equal(await rows.count(), 100);
  assert.ok(Math.abs(await sector.getByRole("button").evaluateAll((segments) =>
    segments.reduce((sum, segment) => sum + parseFloat(segment.style.width), 0)) - 100) < 0.01);
  const financials = button(sector, /^金融/);
  const technology = button(sector, /^科技/);
  await technology.focus();
  await technology.press("Tab");
  assert.ok(await financials.evaluate((segment) => segment === document.activeElement));
  assert.equal(await financials.evaluate((segment) => getComputedStyle(segment).outlineStyle), "solid");
  await financials.press("Enter");
  assert.equal(await financials.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await sector.getByRole("button").evaluateAll((segments) =>
    segments.map((segment) => getComputedStyle(segment).borderRadius)), ["0px", "0px"]);
  assert.deepEqual([...new Set(await rows.locator(".alloc-tail-sec-cell").allTextContents())], ["金融"]);
  await button(explorer, /行业：金融/).click();
  const sort = explorer.getByRole("combobox", { name: "按占总资产降序" });
  const readSectors = () => rows.locator(".alloc-tail-sec-cell").allTextContents();
  const defaultSectors = await readSectors();
  await sort.selectOption("sector");
  assert.equal(new Set(defaultSectors).size, 2);
  assert.equal(new Set(await readSectors()).size, 1);
  await sort.selectOption("fundWeight");
  assert.equal(await rows.first().getByRole("button").innerText(), "SHARED000");
  await search.fill("IVV239");
  assert.equal(await rows.count(), 1);
  await button(rows, "IVV239").waitFor();
  await search.fill("");
  await button(scope, /^SPMO/).click();
  await scope.getByRole("button", { name: /^SPMO/, pressed: true }).waitFor();
  assert.doesNotMatch(await explorer.locator(".alloc-tail-summary").innerText(), /总占总资产|未穿透项占/);
  await button(explorer, "管理成分表").click();
  const fund = p.getByRole("dialog", { name: "SPMO · 基金成分" });
  await fund.waitFor();
  await p.keyboard.press("Escape");
  await fund.waitFor({ state: "detached" });
  await explorer.waitFor();
  await button(explorer, /返回方框图/).click();
  await button(other, "合并全部尾部 ↗").click();
  await scope.getByRole("button", { name: /^合并全部尾部/, pressed: true }).waitFor();
  assert.equal(await rows.count(), 100);
  await button(explorer, "显示全部 468 项").click();
  assert.equal(await rows.count(), 468);
  await button(explorer, "仅看跨 ETF 重叠（12）").click();
  assert.equal(await rows.count(), 12);
  const shared = rows.filter({ has: button(p, "SHARED000") });
  assert.match(await shared.innerText(), /IVV \+ SPMO/);
  assert.equal(await shared.locator(".alloc-tail-bar i").count(), 2);
  await resizeContent(app, p, 1280, 720);
  await button(shared, "SHARED000").press("Enter");
  const sources = p.getByRole("dialog", { name: /SHARED000/ });
  await button(sources, "通过 IVV 持有").waitFor();
  await button(sources, "通过 SPMO 持有").waitFor();
  await p.keyboard.press("Escape");
  await sources.waitFor({ state: "detached" });
  await explorer.waitFor();
  await p.keyboard.press("Escape");
  await chart.locator(".ch-tmap").waitFor();
  console.log("Route C verified in Electron: two ETF tails, 468 merged companies, 12 overlaps, filters, inspectors and Escape navigation.");
}

async function openTailTestBook(app, p) {
  await app.evaluate(({ protocol }) => {
    globalThis.tailQuoteRequests = [];
    const intercept = (url) => {
      const { hostname, pathname } = new URL(url);
      globalThis.tailQuoteRequests.push(hostname + decodeURIComponent(pathname));
      return new Response(null, { status: 503 });
    };
    protocol.handle("https", (request) => intercept(request.url));
    globalThis.fetch = async (request) => intercept(request instanceof Request ? request.url : request);
  });
  await p.evaluate(async () => {
    await window.portfolio.newBook();
    await window.portfolio.marketSettings({ autoUpdate: false });
  });
  await seedTailBook(p);
  await p.reload();
}

async function verifyTailQuoteScope(app, p) {
  const requests = () => app.evaluate(() => globalThis.tailQuoteRequests);
  assert.deepEqual(await requests(), [], "Opening and navigating the tail should not request market data");
  const result = await p.evaluate(() => window.portfolio.updateMarket());
  assert.deepEqual(result.filter((entry) => entry.id).map((entry) => entry.name).sort(), ["IVV", "SPMO"]);
  assert.deepEqual((await requests()).sort(), [
    "fred.stlouisfed.org/graph/fredgraph.csv",
    ...["AUDUSD=X", "IVV", "SPMO", "^SP500TR", "^XNDX"].map((ticker) => `query1.finance.yahoo.com/v8/finance/chart/${ticker}`),
  ]);
  console.log("Tail navigation made zero requests; market refresh requested only held ETFs and standard benchmark/FX data.");
}

async function verify() {
  const root = path.join(__dirname, "..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stack-portfolio-allocation-"));
  const env = {
    ...process.env,
    STACK_PORTFOLIO_HEADLESS: "1",
    STACK_PORTFOLIO_LOCALE: "zh-CN",
    STACK_PORTFOLIO_TEST_DIR: directory,
    STACK_PORTFOLIO_TEST_SOURCE: path.join(directory, "empty"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv[2];
  let app;
  try {
    app = await electron.launch({
      executablePath: packaged ? path.resolve(packaged) : require("electron"), args: packaged ? [] : [root], env, timeout: 30000,
    });
    assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), directory);
    const p = await app.firstWindow();
    p.setDefaultTimeout(8000);
    const errors = [];
    p.on("pageerror", (error) => errors.push(error.message));
    const home = await p.evaluate(() => window.portfolio.home());
    if (!home.mode && !home.hasReal && !home.onboardingSeen)
      await p.getByRole("button", { name: "暂时跳过", exact: true }).click();
    await p.getByRole("button", { name: "打开示例账本" }).click();
    await p.getByRole("heading", { name: "总览", exact: true }).waitFor();

    const cash = "strategy:cash";
    const day = "2026-10-30";
    const dashboard = (ids) => p.evaluate((options) => window.portfolio.dashboard(options), { ids, date: day });
    const save = (ids, targets, tolerance = 0.05) => p.evaluate((args) => window.portfolio.targets(args), { ids, targets, tolerance });
    const ids = (await dashboard("all")).selected;
    await assert.rejects(save(ids, { [cash]: 0.99 }), /100%/);
    await assert.rejects(save(ids, { [cash]: 1 }, 0.004), /0.5/);
    await assert.rejects(save(ids, { [cash]: 1 }, "0.05"), /0.5/);
    await assert.rejects(save(ids, { "mic:XNAS:AAPL": 1 }), /个股合计/);
    await assert.rejects(save(ids, { "strategy:other": 1 }), /个股合计/);
    await save(ids, { [cash]: 1 });
    assert.equal((await dashboard([...ids].reverse())).targets.targets[cash], 1);
    assert.deepEqual((await dashboard([ids[0]])).targets.targets, {});

    const example = await p.evaluate(() => window.portfolio.account({ name: "额外账户", currency: "AUD" }));
    assert.deepEqual((await dashboard("all")).targets.targets, {});
    assert.equal((await dashboard(ids)).targets.targets[cash], 1);
    const nav = p.getByRole("navigation", { name: "页面" });
    await nav.getByRole("button", { name: "配置分析", exact: true }).click();
    await p.getByRole("heading", { name: "钱最终投在哪些公司" }).waitFor();
    const apple = p.getByRole("button", { name: /Apple.*AAPL/ });
    await apple.waitFor();
    assert.equal(await p.getByText("其余成分（示例汇总）", { exact: true }).count(), 0);
    const firstChart = p.locator(".ch-tmap");
    assert.equal(await firstChart.locator(".ch-tm").last().evaluate((tile) => tile.classList.contains("rest")), true);
    await firstChart.locator(".rest b").getByText("其他", { exact: true }).waitFor();
    await apple.focus();
    await p.keyboard.press("Enter");
    const source = p.getByRole("dialog", { name: /Apple/ });
    await source.getByText("直接持有", { exact: true }).waitFor();
    await source.getByText("通过 IVV 持有", { exact: true }).waitFor();
    assert.match(await source.innerText(), /今日涨跌幅\s*▲\s*\+0\.16%/);
    await source.getByRole("button", { name: "直接持有", exact: true }).focus();
    await p.keyboard.press("ArrowDown");
    const fundLink = source.getByRole("button", { name: "通过 IVV 持有", exact: true });
    assert.ok(await fundLink.evaluate((button) => button === document.activeElement));
    await p.keyboard.press("Escape");
    await source.waitFor({ state: "detached" });

    const resize = (w, h) => resizeContent(app, p, w, h);
    await resize(2560, 1080);
    await apple.click();
    await p.getByRole("complementary", { name: /Apple/ }).getByText("通过 IVV 持有", { exact: true }).waitFor();
    await p.keyboard.press("Escape");
    await p.evaluate(async ({ account, date }) => {
      const api = window.portfolio, open = "2026-10-29";
      await api.opening({
        account, date: open, cash: { AUD: "20000" },
        positions: [
          { symbol: "IVV", mic: "XASX", kind: "ETF", quantity: "100", price: "400" },
          { symbol: "AAPL", mic: "XNAS", quantity: "40", price: "98" },
          { symbol: "NVDA", mic: "XNAS", quantity: "349", price: "100" },
          { symbol: "BOND", mic: "XASX", kind: "BOND", quantity: "10", price: "100" },
          { symbol: "NEW", mic: "XASX", kind: "ETF", quantity: "1", price: "100" },
        ].map((r) => ({ ...r, currency: "AUD" })),
      });
      const d = await api.dashboard({ ids: [account], date });
      await api.savePrice({ assetId: d.rows.find((r) => r.ticker === "AAPL").assetId, date, price: 100 });
      await api.fundSave({
        snapshot: {
          schemaVersion: 2, etfKey: d.rows.find((r) => r.ticker === "IVV").etfKey, provider: "样例成分", asOfDate: open, fetchedAt: open + "T05:00:00Z",
          holdings: [
            { symbol: "AAPL", name: "Apple", weight: 0.075, mic: "XNAS", sector: "Technology", country: "United States", underlyingType: "stock" },
            { symbol: "CBA", name: "Commonwealth Bank", weight: 0.925, mic: "XASX", sector: "Financials", country: "Australia", underlyingType: "stock" },
          ],
        },
      });
    }, { account: example, date: day });

    await p.getByLabel("估值日").fill("2026-10-29");
    await p.getByText("正在查看 2026-10-29").waitFor();
    await p.getByLabel("估值日").fill(day);
    await p.getByRole("button", { name: "账户范围 · 全部账户", exact: true }).click();
    const accounts = p.getByRole("dialog", { name: "账户范围" });
    await accounts.getByLabel("IBKR").uncheck();
    await accounts.getByLabel("Webull Australia").uncheck();
    await accounts.getByLabel("额外账户").check();
    await accounts.getByRole("button", { name: "应用", exact: true }).click();
    await p.getByRole("button", { name: "账户范围 · 额外账户", exact: true }).waitFor();

    const fixture = await dashboard([example]);
    assert.equal(fixture.portfolio.totalAud, 100_000);
    const company = fixture.exposure.rows.find((r) => r.ticker === "AAPL");
    assert.deepEqual([company.directAud, company.viaEtfsAud, company.totalAud], [4_000, 3_000, 7_000]);
    const pricedApple = p.getByRole("button", { name: /Apple.*AAPL.*7[.]0%/ });
    await pricedApple.click();
    const breakdown = p.getByRole("complementary", { name: /Apple/ });
    await breakdown.getByText("A$4,000.00", { exact: true }).waitFor();
    await breakdown.getByText("A$3,000.00", { exact: true }).waitFor();
    await p.keyboard.press("Escape");
    await breakdown.waitFor({ state: "detached" });
    const chart = p.getByRole("region", { name: "钱最终投在哪些公司" });
    assert.match(await chart.innerText(), /前五大公司合计\s*78.9%/);
    assert.match(await chart.innerText(), /成分待更新[\s\S]*NEW[\s\S]*A\$100.00/);
    assert.equal(await chart.locator(".ch-tmap").count(), 1);
    const views = chart.getByRole("group", { name: "公司敞口图" });
    const colors = chart.getByRole("group", { name: "方框着色" });
    await colors.getByRole("button", { name: "持有方式" }).click();
    assert.match(await pricedApple.evaluate((button) => getComputedStyle(button).backgroundImage), /linear-gradient\(90deg,.+57\.1429%/);
    await chart.locator(".alloc-key").getByText("通过 ETF", { exact: true }).waitFor();
    await views.getByRole("button", { name: "条形" }).click();
    assert.equal(await chart.locator(".ch-tmap").count(), 0);
    assert.equal(await colors.count(), 0);
    const bars = chart.locator(".alloc-company-bar");
    assert.equal(await bars.count(), 5);
    assert.match(await bars.first().innerText(), /CBA/);
    assert.match(await bars.last().innerText(), /其他\s*1\.1%/);
    await pricedApple.locator(".ch-stack").waitFor();
    await pricedApple.press("Enter");
    await breakdown.getByText("A$3,000.00", { exact: true }).waitFor();
    await p.keyboard.press("Escape");
    await breakdown.waitFor({ state: "detached" });
    await views.getByRole("button", { name: "方框图" }).click();
    await colors.getByRole("button", { name: "持有方式", pressed: true }).waitFor();
    await colors.getByRole("button", { name: "今日涨跌" }).click();
    assert.equal(await chart.locator(".alloc-company-bars").count(), 0);
    const tiles = chart.locator(".ch-tmap .ch-tm");
    assert.equal(await tiles.count(), 5);
    assert.deepEqual(await chart.locator(".ch-tm:not(.rest) b").allTextContents(), ["CBA", "NVDA", "现金", "AAPL"]);
    assert.equal(await tiles.filter({ hasText: /AAPL.*7\.0%/ }).count(), 1);
    const other = chart.locator(".ch-tm.rest");
    assert.equal(await other.count(), 1);
    const otherShare = other.getByText("1.1%", { exact: true }).or(chart.getByText("其他 1.1%", { exact: true }));
    await otherShare.waitFor();
    await resize(1024, 640);
    await otherShare.waitFor();
    await chart.getByRole("button", { name: /Apple.*AAPL.*7[.]0%/ }).waitFor();
    assert.ok(await tiles.locator("span").evaluateAll((lines) => lines.every((line) => {
      const bounds = line.getBoundingClientRect(), tile = line.closest(".ch-tm").getBoundingClientRect();
      return bounds.left >= tile.left && bounds.right <= tile.right && bounds.top >= tile.top && bounds.bottom <= tile.bottom;
    })));
    await resize(1920, 1080);

    const edit = p.getByRole("button", { name: "设置目标", exact: true });
    await edit.click();
    const targets = p.getByRole("dialog", { name: "设置目标" });
    const saveButton = targets.getByRole("button", { name: "保存目标" });
    assert.equal(await targets.getByLabel("允许偏离（百分点）").inputValue(), "5");
    await targets.getByLabel("IVV 目标（%）").fill("45");
    await targets.getByLabel("个股 目标（%）").fill("35");
    assert.equal(await saveButton.isEnabled(), false);
    await targets.getByLabel("现金 目标（%）").fill("20");
    assert.equal(await saveButton.isEnabled(), true);
    assert.equal(await targets.getByLabel("其他投资 目标（%）").count(), 0);
    await saveButton.click();
    const target = p.getByRole("region", { name: "IVV", exact: true });
    await target.getByText("不用调", { exact: true }).waitFor();
    assert.match(await target.innerText(), /低于目标 5.0 个百分点/);
    await edit.click();
    await targets.getByLabel("IVV 目标（%）").fill("46");
    await targets.getByLabel("个股 目标（%）").fill("34");
    await saveButton.click();
    await target.getByText("买入 A$6,000", { exact: true }).waitFor();
    assert.match(await target.innerText(), /低于目标 6.0 个百分点/);
    assert.match(await p.getByRole("region", { name: "其他投资", exact: true }).innerText(), /A\$1,000/);
    await p.evaluate(async () => {
      const api = window.portfolio;
      const account = await api.account({ name: "集中持仓", currency: "AUD" });
      await api.opening({
        account, date: "2026-10-29", cash: {},
        positions: [
          { symbol: "LARGE", mic: "XNAS", kind: "STOCK", quantity: "989", price: "10", currency: "AUD" },
          { symbol: "SMALL", mic: "XNAS", kind: "STOCK", quantity: "11", price: "10", currency: "AUD" },
        ],
      });
    });
    await p.getByLabel("估值日").fill("2026-10-29");
    await p.getByText("正在查看 2026-10-29").waitFor();
    await p.getByRole("button", { name: "账户范围 · 额外账户", exact: true }).click();
    await accounts.getByLabel("额外账户").uncheck();
    await accounts.getByLabel("集中持仓").check();
    await accounts.getByRole("button", { name: "应用", exact: true }).click();
    await resize(1024, 640);
    const smallLabel = chart.locator(".ch-tm-labels").getByRole("button", { name: /SMALL.*1\.1%/ });
    await smallLabel.waitFor();
    const leader = chart.locator(".ch-tm-leaders g");
    await leader.locator("path").waitFor();
    await smallLabel.focus();
    await chart.locator(".ch-tm-leaders g.on").waitFor();
    await chart.locator('.ch-tm.on[title*="SMALL"]').waitFor();
    const connected = await leader.evaluate((group) => {
      const circle = group.querySelector("circle"), overlay = group.ownerSVGElement.getBoundingClientRect();
      const tile = document.querySelector('.ch-tmap [title*="SMALL"]').getBoundingClientRect();
      const x = overlay.left + circle.cx.baseVal.value, y = overlay.top + circle.cy.baseVal.value;
      return Math.abs(x - (tile.left + tile.width / 2)) < 1 && Math.abs(y - (tile.top + tile.height / 2)) < 1;
    });
    assert.ok(connected);
    await smallLabel.press("Enter");
    const smallSources = p.getByRole("dialog", { name: /SMALL/ });
    await smallSources.waitFor();
    await p.keyboard.press("Escape");
    await smallSources.waitFor({ state: "detached" });
    console.log("Allocation targets, company sources and chart label callouts verified in the app.");
    await openTailTestBook(app, p);
    await verifyTailExplorer(app, p, chart);
    await verifyTailQuoteScope(app, p);
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
