import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { arrangeGrid } from "../../ui/layout.js";
import { aliasRows, brokerState, cardColumns } from "../../ui/settingsModel.js";

const ibkrReady = { query: "1184220", present: { "ibkr.flex-token": true } };

describe("broker connection state", () => {
  it("shows a verified broker as connected with its last successful update", () => {
    const state = brokerState({ ...ibkrReady, verified: { ibkr: true }, lastSuccess: { ibkr: "2026-11-20T09:12:00" } }, "ibkr");
    expect(state).toMatchObject({ label: "已连接", tone: "up", canUpdate: true, needsAuth: false });
    expect(state.lastSuccess).toBe("2026-11-20T09:12:00");
  });

  it("asks for authorisation when the saved credentials are incomplete, which opens the steps", () => {
    expect(brokerState({ query: "1184220", present: {} }, "ibkr")).toMatchObject({
      label: "待授权",
      canUpdate: false,
      needsAuth: true,
      lastSuccess: null,
    });
    expect(brokerState({ webullKey: "k", present: { "webull.app-secret": true } }, "webull").needsAuth).toBe(true);
  });

  it("marks saved but unchecked credentials as waiting for verification", () => {
    expect(brokerState(ibkrReady, "ibkr")).toMatchObject({ label: "待验证", tone: "warn", canUpdate: true, needsAuth: false });
  });

  it("treats Webull as ready only with its key, account, secret and access token", () => {
    const webull = {
      webullKey: "k",
      webullId: "AU-88120",
      present: { "webull.app-secret": true, "webull.access-token": true },
      verified: { webull: true },
    };
    expect(brokerState(webull, "webull").label).toBe("已连接");
    expect(brokerState({ ...webull, webullId: "" }, "webull").label).toBe("待授权");
  });

  it("uses the bundled sample connection in the sample book and never asks for authorisation", () => {
    expect(brokerState({ present: {} }, "ibkr", true)).toMatchObject({ label: "示例连接", canUpdate: true, needsAuth: false });
  });

  it("does not claim a state before the connections have been read", () => {
    expect(brokerState(null, "ibkr")).toMatchObject({ label: "正在读取", canUpdate: false, needsAuth: false });
  });
});

describe("fund identity mappings", () => {
  it("lists each mapping by source, source identity and canonical identity", () => {
    expect(
      aliasRows({
        "scope:ishares:ivv:GOOG": "US02079K1079",
        "scope:betashares:ndq:NVDA UW": "US67066G1040",
        "BRK.B": "US0846707026",
      }),
    ).toEqual([
      { key: "scope:ishares:ivv:GOOG", provider: "ishares", fund: "ivv", source: "GOOG", id: "US02079K1079" },
      { key: "scope:betashares:ndq:NVDA UW", provider: "betashares", fund: "ndq", source: "NVDA UW", id: "US67066G1040" },
      { key: "BRK.B", provider: "—", fund: null, source: "BRK.B", id: "US0846707026" },
    ]);
  });

  it("keeps a colon inside the source identity", () => {
    expect(aliasRows({ "scope:manual:vgs:isin:US0378331005": "AAPL" })[0].source).toBe("isin:US0378331005");
  });
});

describe("settings card columns", () => {
  const cards = ["ibkr", "webull", "market", "sources", "reset"];
  it("stacks every card in one column when the content area is narrow", () => {
    expect(arrangeGrid(cardColumns(cards), 1)).toEqual({ template: "minmax(0,1fr)", columns: [cards] });
  });

  it("deals the cards into at most two columns in reading order", () => {
    const two = { template: "minmax(0,1.05fr) minmax(0,1fr)", columns: [["ibkr", "market", "reset"], ["webull", "sources"]] };
    expect(arrangeGrid(cardColumns(cards), 2)).toEqual(two);
    expect(arrangeGrid(cardColumns(cards), 3)).toEqual(two);
  });
});

// common.jsx reads the preload bridge at import time; the page reads connections only after mounting.
globalThis.window ??= {};
const { Settings } = await import("../../ui/Settings.jsx");
const { I18nProvider } = await import("../../ui/i18n.jsx");

const book = {
  date: "2026-10-30",
  selected: ["demo-ibkr"],
  accounts: [
    { id: "demo-ibkr", name: "IBKR", currency: "AUD", active: true },
    { id: "old", name: "CommSec", currency: "AUD", active: false },
  ],
  rows: [{ assetId: "aapl", profileId: "aapl", ticker: "AAPL", name: "Apple Inc.", mic: "XNAS", localCurrency: "USD" }],
  etfData: [],
  migration: null,
  settings: {
    providerModes: {},
    pinnedProviders: {},
    providerIdentities: {},
    typeOverrides: {},
    aliases: { "scope:ishares:ivv:GOOG": "US02079K1079" },
  },
};
const page = (props) => renderToStaticMarkup(<Settings d={book} run={() => {}} onPage={() => {}} {...props} />);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("settings page", () => {
  it("has three tabs named 券商连接, 账本 and 数据, opening on 券商连接", () => {
    const html = page({ mode: "real" });
    const tabs = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => [m[2], m[1]]);
    expect(tabs).toEqual([
      ["券商连接", "true"],
      ["账本", "false"],
      ["数据", "false"],
    ]);
    expect(text(html)).toMatch(/Interactive Brokers.*Webull Australia.*行情自动更新.*重置/);
    expect(text(html)).not.toMatch(/其他行情来源|Twelve Data|Alpha Vantage|本机 API 端口/);
  });

  it("explains the sample connection in the sample book and still offers 立即更新", () => {
    const out = text(page({ mode: "demo" }));
    expect(out).toContain("正式账本可保存券商授权。示例账本使用随附样例。");
    expect(out).toMatch(/Interactive Brokers 示例连接 .*立即更新/);
  });

  it("keeps the ledger, backups and accounts on the 账本 tab", () => {
    const out = text(page({ mode: "real", initial: { tab: "book" } }));
    expect(out).toMatch(/当前账本 .*正式账本.*切换账本 \/ 迁入 Wealthfolio 备份账本 恢复账本备份 加密旧备份/);
    expect(out).toMatch(/账户 名称 基础币种 状态 IBKR AUD 启用 CommSec AUD 归档/);
    expect(out).toContain("添加账户");
  });

  it("names each security by full name, market and currency on the 数据 tab", () => {
    const out = text(page({ mode: "real", initial: { tab: "data" } }));
    expect(out).toMatch(/维护结单报价.*手动调整基金数据来源.*更正证券类别及基金成分匹配/);
    expect(out).toContain("Apple Inc. · AAPL · 美国 Nasdaq · USD");
    expect(out).toMatch(/来源 来源标识 规范标识 ishares GOOG US02079K1079/);
  });

  it("renders English and Traditional Chinese cleanly inside I18nProvider", () => {
    const enOut = text(
      renderToStaticMarkup(
        <I18nProvider locale="en" languagePreference="en" systemLocale="en">
          <Settings d={book} run={() => {}} onPage={() => {}} mode="real" />
        </I18nProvider>,
      ),
    );
    expect(enOut).toContain("Connections");
    expect(enOut).toContain("Ledger");
    expect(enOut).toContain("Data");
    expect(enOut).toContain("Automatic Market Updates");

    const twOut = text(
      renderToStaticMarkup(
        <I18nProvider locale="zh-TW" languagePreference="zh-TW" systemLocale="zh-TW">
          <Settings d={book} run={() => {}} onPage={() => {}} mode="real" />
        </I18nProvider>,
      ),
    );
    expect(twOut).toContain("券商連線");
    expect(twOut).toContain("帳本");
    expect(twOut).toContain("資料");
    expect(twOut).toContain("行情自動更新");
  });
});
