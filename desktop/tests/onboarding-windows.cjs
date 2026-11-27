const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sp-account-guide-"));
const button = (page, name) => page.getByRole("button", { name, exact: typeof name === "string" });
const appRoot = path.join(__dirname, "..");
const executablePath = process.argv[2] || require("electron");

async function open(verify, ibkrToken = "test-1001") {
  const env = {
    ...process.env,
    STACK_PORTFOLIO_TEST_DIR: profile,
    STACK_PORTFOLIO_TEST_SOURCE: path.join(profile, "empty"),
    STACK_PORTFOLIO_HEADLESS: "1",
    STACK_PORTFOLIO_LOCALE: process.env.STACK_PORTFOLIO_LOCALE || "zh-CN",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args: process.argv[2] ? [] : [appRoot], env });
  try {
    assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
    // The signed requests traverse the production adapters. Only the HTTP responses are fixtures.
    await app.evaluate((_, ibkrToken) => {
      let checks = 0;
      const flexTokens = { "1001": ibkrToken, "1002": "test-1002" };
      globalThis.fetch = async (input) => {
        const url = new URL(input);
        const token = url.searchParams.get("t");
        if (url.pathname.endsWith("/SendRequest")) {
          const id = url.searchParams.get("q");
          if (token === "test-locked")
            return new Response("<Status>Fail</Status><ErrorCode>1025</ErrorCode>");
          if (id === "1001" && token === "test-1001" && token !== ibkrToken)
            return new Response("<Status>Fail</Status><ErrorCode>1012</ErrorCode>");
          if (token !== flexTokens[id])
            return new Response("<Status>Fail</Status><ErrorCode>1015</ErrorCode>");
          return new Response("<Status>Success</Status><ReferenceCode>" + id + "</ReferenceCode>");
        }
        if (url.pathname.endsWith("/GetStatement")) {
          const id = url.searchParams.get("q");
          if (token !== flexTokens[id])
            return new Response("<Status>Fail</Status><ErrorCode>1015</ErrorCode>");
          return new Response(
            '<FlexQueryResponse><FlexStatements><FlexStatement accountId="TEST' +
              id +
              '" baseCurrency="AUD" fromDate="20260101" toDate="20260131"><Trades/><CashTransactions>' +
              '<CashTransaction currency="AUD" type="Deposits/Withdrawals" description="Deposit" dateTime="20260120" amount="' +
              id +
              '" transactionID="fixture-' +
              id +
              '"/>' +
              "</CashTransactions></FlexStatement></FlexStatements></FlexQueryResponse>",
          );
        }
        if (url.pathname.endsWith("/tokens/create"))
          return Response.json({ token: "test-webull", status: "PENDING" });
        if (url.pathname.endsWith("/tokens/check"))
          return Response.json({ token: "test-webull", status: ++checks > 1 ? "NORMAL" : "PENDING" });
        if (url.pathname.endsWith("/accounts/list"))
          return Response.json([
            { account_id: "TEST-WA", account_number: "TEST-0001" },
            { account_id: "TEST-WB", account_number: "TEST-0002" },
          ]);
        if (url.pathname.endsWith("/historical-orders/list")) return Response.json([]);
        if (url.pathname.endsWith("/cash-activities/list")) {
          const id = url.searchParams.get("account_id");
          return Response.json([
            {
              activity_id: "fixture-" + id,
              activity_type: "DEPOSIT",
              amount: id === "TEST-WA" ? "101" : "102",
              currency: "AUD",
              activity_time_at: "2026-08-18T00:00:00Z",
            },
          ]);
        }
        throw Error("Offline test transport");
      };
    }, ibkrToken);
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await verify(page, app);
      assert.deepEqual(errors, []);
    } catch (e) {
      console.error((await page.locator("body").innerText()).slice(0, 1800));
      throw e;
    }
  } finally {
    await app.close();
  }
}
async function shots(page, key) {
  const directory = process.env.STACK_PORTFOLIO_GUIDE_CAPTURES;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  for (const theme of ["dark", "light"]) {
    await page.getByLabel("向导主题", { exact: true }).selectOption(theme);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.waitForFunction((t) => matchMedia("(prefers-color-scheme: " + t + ")").matches, theme);
    await page
      .locator(".ob-studio-card")
      .screenshot({ path: path.join(directory, key + "-" + theme + ".png") });
  }
}
async function expectStep(page, current, total) {
  const panel = page.locator(".ob-studio-progress");
  const bar = page.getByRole("progressbar", { name: "添加此账户的进度" });
  if (!current) {
    assert.equal(await panel.count(), 0);
    return;
  }
  const label = total ? `第 ${current} 步，共 ${total} 步` : `第 ${current} 步`;
  await panel.getByText(label, { exact: true }).waitFor();
  assert.equal(await bar.count(), total ? 1 : 0);
  if (total) {
    assert.equal(await bar.getAttribute("value"), String(current));
    assert.equal(await bar.getAttribute("max"), String(total));
  }
  assert.equal(await page.getByText("中文说明", { exact: true }).count(), 0);
  assert.equal(await button(page, "Next").count(), 0);
}
async function choose(page, broker, inspect = false) {
  await expectStep(page, 1);
  await button(page, broker === "ibkr" ? /Interactive Brokers/ : /Webull Australia/).click();
  if (broker === "webull") {
    await expectStep(page, 2);
    await button(page, "下一步").click();
    await expectStep(page, 3);
    await button(page, "上一步").click();
    await expectStep(page, 2);
    await button(page, "下一步").click();
    await button(page, "下一步").click();
    await expectStep(page, 4);
    await page.getByRole("region", { name: "在手机上确认授权", exact: true }).waitFor();
    return;
  }
  const chapters = [
    "创建活动报表",
    "给报表命名并打开成交设置",
    "选择逐笔成交字段",
    "选择要导入的现金和持仓数据",
    "设置账户、格式和报表期间",
    "检查并创建报表",
    "复制查询编号",
    "取得访问令牌",
  ];
  for (const [index, title] of chapters.entries()) {
    await expectStep(page, index + 2, 11);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    if (inspect) {
      const figure = page.locator(".ob-studio-context figure");
      await figure.locator(".ob-mark-ink").first().waitFor();
      for (const tab of await figure.locator(".ob-shot-tabs button").all()) {
        await tab.click();
        const box = await figure.locator(".ob-mark-ink rect").boundingBox();
        const crop = await figure.locator(".ob-focus-image").boundingBox();
        assert.ok(box.width >= 18 && box.height >= 12 && box.x >= crop.x && box.y >= crop.y);
      }
      if (title === "创建活动报表" || title === "选择逐笔成交字段") {
        if (title === "选择逐笔成交字段")
          assert.equal(await figure.locator(".ob-mark-ink").count(), 2);
        await shots(page, title === "选择逐笔成交字段" ? "trade-fields" : "create-query");
        await button(figure, "查看完整截图").click();
        const view = page.getByRole("dialog", { name: "完整截图" });
        await view.locator(".ob-mark-ink").first().waitFor();
        assert.equal(await view.getByText("原始尺寸").count(), 0);
        await page.keyboard.press("Escape");
      }
    }
    await button(page, "下一步").click();
  }
  await expectStep(page, 10, 11);
}
async function ibkr(page, id, home = false) {
  await choose(page, "ibkr", home);
  if (home) await shots(page, "ibkr");
  await page.getByLabel("Flex Query ID", { exact: true }).fill(id);
  if (home) {
    assert.equal(await page.locator(".ob-studio-context").count(), 0);
    await page.getByText("在 IBKR 哪里找 Query ID？", { exact: true }).click();
    await page.locator(".ob-field-source .ob-focus-image:visible").waitFor();
    await page.getByText("在 IBKR 哪里找 Query ID？", { exact: true }).click();
    assert.equal(await page.getByLabel("Flex Query ID", { exact: true }).inputValue(), id);
    await page.getByLabel("Flex Token", { exact: true }).fill("wrong");
    await button(page, "验证 IBKR 账户").click();
    await page.getByRole("alert").getByText(/1015/).waitFor();
    await expectStep(page, 10, 11);
    assert.equal((await page.evaluate(() => window.portfolio.home())).hasReal, false);
  }
  await page.getByLabel("Flex Token", { exact: true }).fill("test-" + id);
  await button(page, "验证 IBKR 账户").click();
  await page.getByRole("heading", { name: "确认要绑定的账户" }).waitFor();
  await expectStep(page, 11, 11);
  assert.equal(await page.getByLabel("券商返回的账户", { exact: true }).inputValue(), "TEST" + id);
  if (home) await shots(page, "confirm");
  assert.equal(await page.locator(".ob-real-figure:visible").count(), 0);
  assert.match(await page.locator(".ob-verified").innerText(), new RegExp(id));
  await page.getByLabel("本地账户名称", { exact: true }).fill("Sample IBKR " + id);
  await button(page, "绑定此账户").click();
  await page.getByRole("heading", { name: "还要继续添加账户吗？" }).waitFor();
  await expectStep(page, 0);
}
async function main() {
  await open(async (page) => {
    await page.getByRole("heading", { name: "现在添加第一个账户吗？" }).waitFor();
    await expectStep(page, 0);
    await button(page, "查看完整教程").click();
    const manual = page.getByRole("dialog", { name: "完整账户教程" });
    assert.equal(await manual.getByText("中文说明", { exact: true }).count(), 0);
    await button(manual, /选择逐笔成交字段/).click();
    assert.equal(await manual.locator(".ob-mark-ink:visible").count(), 2);
    await button(manual, "查看完整截图").click();
    await page.keyboard.press("Escape");
    assert.ok(await manual.isVisible());
    await button(manual, "Webull AU").click();
    await button(manual, /在手机上确认授权/).click();
    await button(manual, /OpenAPI Notice/).click();
    await button(manual, "Check Now").click();
    await button(manual, "重看手机示例").waitFor();
    await button(manual, "返回当前页面").click();
    await button(page, "添加账户").click();
    await expectStep(page, 1);
    await button(page, "返回欢迎页").click();
    await expectStep(page, 0);
    await button(page, "添加账户").click();
    assert.equal(await page.locator(".ob-real-figure").count(), 0);
    await ibkr(page, "1001", true);
    await button(page, "继续添加账户").click();
    await ibkr(page, "1002");
    await button(page, "继续添加账户").click();
    await choose(page, "webull");
    await shots(page, "webull");
    const preview = page.getByRole("region", { name: "在手机上确认授权", exact: true });
    assert.ok(await button(page, "发起 Webull 授权").isDisabled());
    await button(preview, /OpenAPI Notice/).click();
    await button(preview, "Check Now").click();
    await preview.getByText(/图解已看完/).waitFor();
    await expectStep(page, 4);
    await page.getByLabel("App Key", { exact: true }).fill("test-key");
    await page.getByLabel("App Secret", { exact: true }).fill("test-secret");
    await button(page, "发起 Webull 授权").click();
    await expectStep(page, 5, 6);
    await page.getByRole("heading", { name: "在手机上确认授权", level: 1 }).waitFor();
    await button(page, /OpenAPI Notice/).waitFor();
    await button(page, "检查授权结果").click();
    await page
      .getByRole("alert")
      .getByText(/还在等待/)
      .waitFor();
    await expectStep(page, 5, 6);
    await button(page, "检查授权结果").click();
    await expectStep(page, 6, 6);
    await button(page, "上一步").click();
    await expectStep(page, 5, 6);
    await button(page, "检查授权结果").click();
    await expectStep(page, 6, 6);
    await page.getByLabel("券商返回的账户", { exact: true }).selectOption("TEST-WB");
    await page.getByLabel("本地账户名称", { exact: true }).fill("Sample Webull");
    await button(page, "绑定此账户").click();
    await button(page, "继续添加账户").click();
    await choose(page, "webull");
    await page.getByLabel("App Key", { exact: true }).fill("test-key");
    await page.getByLabel("App Secret", { exact: true }).fill("test-secret");
    await button(page, "发起 Webull 授权").click();
    await expectStep(page, 5, 5);
    await page.getByRole("heading", { name: "确认要绑定的账户", level: 1 }).waitFor();
    assert.equal(await button(page, "检查授权结果").count(), 0);
    await page.getByLabel("券商返回的账户", { exact: true }).selectOption("TEST-WA");
    await page.getByLabel("本地账户名称", { exact: true }).fill("Second Webull");
    await button(page, "绑定此账户").click();
    await button(page, "完成添加").click();
    await page.getByRole("heading", { name: "总览", exact: true }).waitFor();
  });
  await open(async (page) => {
    await page.getByRole("heading", { name: "总览", exact: true }).waitFor();
    await button(page.getByRole("navigation", { name: "页面" }), "设置").click();
    const state = await page.evaluate(() => window.portfolio.connections());
    assert.equal(state.bindings.length, 4);
    assert.ok(state.bindings.every((b) => b.authorized));
    assert.equal(state.bindings.find((b) => b.name === "Sample Webull").remoteId, "TEST-WB");
    assert.ok(!JSON.stringify(state).includes("test-secret"));
    const expected = { TEST1001: 1001, TEST1002: 1002, "TEST-WA": 101, "TEST-WB": 102 };
    for (const b of state.bindings) {
      const result = await page.evaluate(
        (b) => window.portfolio.preview({ broker: b.broker, account: b.id, source: "live" }),
        b,
      );
      assert.ok(result.token);
      const history = () => page.evaluate((id) => window.portfolio.history({ account: id }), b.id);
      assert.deepEqual(await history(), []);
      await page.evaluate((token) => window.portfolio.commit({ token }), result.token);
      assert.deepEqual(
        (await history()).map((row) => Number(row.amount)),
        [expected[b.remoteId]],
      );
    }
    const panel = page.getByRole("region", { name: "按账户连接券商" });
    await button(panel.locator(".binding-row").filter({ hasText: "Sample IBKR 1001" }), "断开授权").click();
    await button(page.getByRole("dialog"), "确认断开").click();
    await panel.getByText(/需重新授权/).waitFor();
    const ids = await page.evaluate(() => window.portfolio.connections().then((c) => c.bindings));
    assert.equal(ids.find((b) => b.remoteId === "TEST1001").authorized, false);
    assert.equal(ids.find((b) => b.remoteId === "TEST1002").authorized, true);
    await button(page, "添加或重新授权账户").click();
    await expectStep(page, 1);
    await button(page, "取消添加").waitFor();
    await button(page, /Webull Australia/).click();
    await expectStep(page, 2);
    await button(page, "上一步").click();
    await choose(page, "ibkr");
    await page.getByLabel("Flex Query ID", { exact: true }).fill("1001");
    await page.getByLabel("Flex Token", { exact: true }).fill("test-1001");
    await button(page, "验证 IBKR 账户").click();
    await page.getByRole("heading", { name: "确认要绑定的账户" }).waitFor();
    assert.equal(
      await page.getByLabel("入账账户", { exact: true }).inputValue(),
      ids.find((b) => b.remoteId === "TEST1001").id,
    );
    await button(page, "绑定此账户").click();
    await button(page, "预览首次导入").click();
    await page.getByRole("heading", { name: "导入与对账", exact: true }).waitFor();
    await page.getByText(/入账账户 · Sample IBKR 1001/).waitFor();
    assert.equal((await page.evaluate(() => window.portfolio.connections())).bindings.length, 4);
  });
  const renewedToken = "test-renewed-1001";
  await open(async (page) => {
    await page.getByRole("heading", { name: "总览", exact: true }).waitFor();
    await button(page.getByRole("navigation", { name: "页面" }), "设置").click();
    const before = await page.evaluate(() => window.portfolio.connections());
    const bound = before.bindings.find((b) => b.remoteId === "TEST1001");
    const other = before.bindings.find((b) => b.remoteId === "TEST1002");
    const preview = (id = bound.id) => page.evaluate(
      (account) => window.portfolio.preview({ broker: "ibkr", account, source: "live" }),
      id,
    );
    await preview(other.id);
    await assert.rejects(preview(), /1012/);

    const row = page.locator(".binding-row").filter({ hasText: bound.name });
    await button(row, "重新授权").click();
    const dialog = page.getByRole("dialog", { name: /Sample IBKR 1001/ });
    const query = dialog.getByLabel("Flex Query ID", { exact: true });
    const token = dialog.getByLabel("Flex Token", { exact: true });
    const submit = button(dialog, "验证并保存");
    await token.fill("test-locked");
    await submit.click();
    await dialog.getByRole("alert").getByText(/失败尝试过多.*1025/).waitFor();

    await query.fill("1002");
    await token.fill("test-1002");
    await submit.click();
    await dialog.getByRole("alert").getByText(/券商账户与当前绑定不符/).waitFor();
    await assert.rejects(preview(), /1012/);

    await query.clear();
    await token.fill(renewedToken);
    await submit.click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("IBKR 授权已更新", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.portfolio.dashboard().then((d) => d.brokerAccounts.ibkr)), other.id);
    assert.ok((await preview()).token);

    const after = await page.evaluate(() => window.portfolio.connections());
    assert.deepEqual(after.bindings, before.bindings);
    assert.equal(after.present["ibkr.flex-token"], before.present["ibkr.flex-token"]);
  }, renewedToken);
  await open(async (page) => {
    await page.getByRole("heading", { name: "总览", exact: true }).waitFor();
    const { bindings } = await page.evaluate(() => window.portfolio.connections());
    for (const account of bindings.filter((b) => b.broker === "ibkr")) {
      const report = await page.evaluate(
        (id) => window.portfolio.preview({ broker: "ibkr", account: id, source: "live" }),
        account.id,
      );
      assert.ok(report.token);
    }
  }, renewedToken);
  console.log(
    "Passed Windows account onboarding, offline broker verification, multiple accounts, retry, restart, reauthorization and import routing.",
  );
}
main()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => {
    const dir = fs.realpathSync(profile);
    assert.equal(path.dirname(dir), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("sp-account-guide-"));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
  });
