import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

globalThis.window ??= {}; // common.jsx reads the preload bridge on import
const { BrokerResult } = await import("../../ui/ImportPreview.jsx");

const accounts = [
  { id: "demo-ibkr", name: "IBKR" },
  { id: "demo-webull", name: "Webull Australia" },
];
const buy = (n) => ({
  status: "new",
  date: `2026-10-${10 + n}`,
  type: "BUY",
  symbol: "AAPL",
  quantity: 2,
  unitPrice: 230 + n,
  currency: "USD",
});
const ibkr = {
  broker: "ibkr",
  account: "demo-ibkr",
  token: "t1",
  rows: [...[1, 2, 3, 4, 5, 6].map(buy), { status: "duplicate", date: "2026-10-01", type: "BUY", symbol: "IVV" }],
  amountEdits: [],
  priceEdits: [],
};
const render = (report) =>
  renderToStaticMarkup(
    <BrokerResult report={report} accounts={accounts} onConfirm={() => {}} onClose={() => {}} onRetry={() => {}} />,
  );
const bodyRows = (html) => (html.split("<tbody>")[1] || "").split("</tbody>")[0].match(/<tr/g)?.length || 0;

describe("broker result card", () => {
  it("previews one broker in its own card and offers to confirm only its new activities", () => {
    const html = render(ibkr);
    expect(html).toContain('aria-label="IBKR 同步结果"');
    expect(html).toMatch(/<h2>IBKR<\/h2><span class="tag">导入预览<\/span>/);
    expect(html).toContain("将新增 6 笔流水");
    expect(html).toContain(">确认导入 6 笔<");
    expect(bodyRows(html)).toBe(6);
    expect(html).not.toContain("IVV");
  });

  it("shows a failed sync with a retry for that broker alone and nothing to confirm", () => {
    const html = render({ broker: "webull", account: "demo-webull", sourceKind: "live", error: "Webull 授权已过期" });
    expect(html).toContain('aria-label="WEBULL 同步结果"');
    expect(html).toContain("Webull 授权已过期");
    expect(html).toContain(">单独重试<");
    expect(html).not.toContain("确认");
  });

  it("does not report no changes before the required Webull account verification", () => {
    const html = render({ broker: "webull", account: "demo-webull", rows: [], amountEdits: [],
      priceEdits: [], webullFundsStatus: "verification" });
    expect(html).toContain("入金尚未核对");
    expect(html).not.toContain("没有新变化");
  });

  it("says the broker records are being read while the preview loads", () => {
    expect(render({ broker: "ibkr", loading: true })).toContain("正在读取券商记录…");
  });
});
