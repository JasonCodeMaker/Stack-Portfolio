const { _electron: electron } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sp-account-guide-"));
const button = (page, name) => page.getByRole("button", { name, exact: typeof name === "string" });
const appRoot = path.join(__dirname, "..");
const executablePath = process.argv[2] || require("electron");

async function open(verify) {
  const env = {
    ...process.env,
    STACK_PORTFOLIO_TEST_DIR: profile,
    STACK_PORTFOLIO_TEST_SOURCE: path.join(profile, "empty"),
    STACK_PORTFOLIO_HEADLESS: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args: process.argv[2] ? [] : [appRoot], env });
  try {
    assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
    // The signed requests traverse the production adapters. Only the HTTP responses are fixtures.
    await app.evaluate(() => {
      let checks = 0;
      globalThis.fetch = async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/SendRequest")) {
          const id = url.searchParams.get("q");
          if (!["1001", "1002"].includes(id) || url.searchParams.get("t") !== "test-" + id)
            return new Response("<Status>Fail</Status><ErrorCode>1015</ErrorCode>");
          return new Response("<Status>Success</Status><ReferenceCode>" + id + "</ReferenceCode>");
        }
        if (url.pathname.endsWith("/GetStatement")) {
          const id = url.searchParams.get("q");
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
    });
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
async function choose(page, broker, inspect = false) {
  await button(page, broker === "ibkr" ? /Interactive Brokers/ : /Webull Australia/).click();
  if (broker === "webull") {
    await button(page, "下一步").click();
    await button(page, "下一步").click();
    return;
  }
  const chapters = [
    "Create an Activity Flex Query",
    "Name the query and open Trades",
    "Select execution details",
    "Include balances and cash activity",
    "Set the account, format and period",
    "Review and create the query",
    "Copy the Query ID",
    "Get your Flex Token",
  ];
  for (const title of chapters) {
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
      if (title === "Create an Activity Flex Query" || title === "Select execution details") {
        if (title === "Select execution details")
          assert.equal(await figure.locator(".ob-mark-ink").count(), 2);
        await shots(page, title === "Select execution details" ? "trade-fields" : "create-query");
        await button(figure, "View full screenshot").click();
        const view = page.getByRole("dialog", { name: "Full screenshot" });
        await view.locator(".ob-mark-ink").first().waitFor();
        assert.equal(await view.getByText("原始尺寸").count(), 0);
        await page.keyboard.press("Escape");
      }
    }
    await button(page, "Next").click();
  }
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
    assert.equal((await page.evaluate(() => window.portfolio.home())).hasReal, false);
  }
  await page.getByLabel("Flex Token", { exact: true }).fill("test-" + id);
  await button(page, "验证 IBKR 账户").click();
  await page.getByRole("heading", { name: "确认要绑定的账户" }).waitFor();
  assert.equal(await page.getByLabel("券商返回的账户", { exact: true }).inputValue(), "TEST" + id);
  if (home) await shots(page, "confirm");
  assert.equal(await page.locator(".ob-real-figure:visible").count(), 0);
  assert.match(await page.locator(".ob-verified").innerText(), new RegExp(id));
  await page.getByLabel("本地账户名称", { exact: true }).fill("Sample IBKR " + id);
  await button(page, "绑定此账户").click();
  await page.getByRole("heading", { name: "还要继续添加账户吗？" }).waitFor();
}
async function main() {
  await open(async (page) => {
    await page.getByRole("heading", { name: "现在添加第一个账户吗？" }).waitFor();
    await button(page, "查看完整教程").click();
    const manual = page.getByRole("dialog", { name: "完整账户教程" });
    await button(manual, /Select execution details/).click();
    assert.equal(await manual.locator(".ob-mark-ink:visible").count(), 2);
    await button(manual, "View full screenshot").click();
    await page.keyboard.press("Escape");
    assert.ok(await manual.isVisible());
    await button(manual, "Webull AU").click();
    await button(manual, /在手机上确认授权/).click();
    await button(manual, /OpenAPI Notice/).click();
    await button(manual, "Check Now").click();
    await button(manual, "重看手机示例").waitFor();
    await button(manual, "返回当前页面").click();
    await button(page, "添加账户").click();
    assert.equal(await page.locator(".ob-real-figure").count(), 0);
    await ibkr(page, "1001", true);
    await button(page, "继续添加账户").click();
    await ibkr(page, "1002");
    await button(page, "继续添加账户").click();
    await choose(page, "webull");
    await shots(page, "webull");
    await page.getByLabel("App Key", { exact: true }).fill("test-key");
    await page.getByLabel("App Secret", { exact: true }).fill("test-secret");
    await button(page, "发起 Webull 授权").click();
    await button(page, "检查授权结果").click();
    await page
      .getByRole("alert")
      .getByText(/还在等待/)
      .waitFor();
    await button(page, "检查授权结果").click();
    await page.getByLabel("券商返回的账户", { exact: true }).selectOption("TEST-WB");
    await page.getByLabel("本地账户名称", { exact: true }).fill("Sample Webull");
    await button(page, "绑定此账户").click();
    await button(page, "继续添加账户").click();
    await choose(page, "webull");
    await page.getByLabel("App Key", { exact: true }).fill("test-key");
    await page.getByLabel("App Secret", { exact: true }).fill("test-secret");
    await button(page, "发起 Webull 授权").click();
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
