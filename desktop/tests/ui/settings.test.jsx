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
  batches: [],
  brokerAccounts: { ibkr: "demo-ibkr", webull: "" },
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
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("settings page", () => {
  it("has four categories in a side rail, opening on 通用与外观", () => {
    const html = page({ mode: "real" });
    const cats = [...html.matchAll(/<button[^>]*class="cat-btn[^"]*"[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1]).trim());
    expect(cats).toEqual(["通用与外观", "账户与券商连接 1", "账本与备份", "行情与分类规则"]);
    expect(html).toMatch(/aria-current="page" class="cat-btn on"[^>]*>.*?通用与外观/);
    expect(text(html)).not.toMatch(/危险操作/);
  });

  it("puts theme, language, updates, diagnostics and factory reset under 通用与外观", () => {
    const out = text(page({ mode: "real", appVersion: "1.6.0" }));
    expect(out).toMatch(/券商连接 .*最近行情更新 .*最近本地备份/);
    expect(out).toMatch(/外观与显示 主题模式.*界面语言.*应用更新与诊断 应用版本.*1\.6\.0.*本地诊断日志/);
    expect(out).toMatch(/恢复出厂设置 不可撤销 .*恢复出厂设置/);
  });

  it("lists every account with its connection and keeps 重置游标 folded under 账户与券商连接", () => {
    const out = text(page({ mode: "real", initial: { cat: "accounts" } }));
    expect(out).toMatch(/账户与券商连接 添加账户 IBKR AUD · 最近同步 尚未同步 正在读取 管理连接 CommSec AUD 归档/);
    expect(out).toMatch(/同步排错与重置游标 展开 仅在某账户漏拉历史成交时使用/);
    expect(out).not.toContain("预览同步");
  });

  it("explains the sample connection in the sample book", () => {
    const out = text(page({ mode: "demo", initial: { tab: "connections" } }));
    expect(out).toContain("正式账本可保存券商授权。示例账本使用随附样例。");
    expect(out).toMatch(/IBKR AUD .*示例连接/);
  });

  it("keeps the ledger and backups under 账本与备份", () => {
    const out = text(page({ mode: "real", initial: { tab: "book" } }));
    expect(out).toMatch(/当前账本与本地备份 正式账本.*切换账本 \/ 迁入 Wealthfolio 本地加密备份 .*备份账本 恢复账本备份 加密旧备份/);
  });

  it("folds quotes, fund sources and classification rules under 行情与分类规则", () => {
    const out = text(page({ mode: "real", initial: { tab: "data" } }));
    expect(out).toMatch(/行情与汇率更新 行情自动更新.*立即更新行情 维护结单报价.*编辑/);
    expect(out).toMatch(/ETF 成分来源与资产分类规则 手动调整基金数据来源 账本中有 0 只基金 编辑 更正证券类别及基金成分匹配 已配置 1 条别名规则 编辑/);
  });

  it("renders English and Traditional Chinese cleanly inside I18nProvider", () => {
    const enOut = text(
      renderToStaticMarkup(
        <I18nProvider locale="en" languagePreference="en" systemLocale="en">
          <Settings d={book} run={() => {}} onPage={() => {}} mode="real" />
        </I18nProvider>,
      ),
    );
    expect(enOut).toContain("General & Appearance");
    expect(enOut).toContain("Accounts & Brokers");
    expect(enOut).toContain("Ledger & Backups");
    expect(enOut).toContain("Market Data & Rules");

    const twOut = text(
      renderToStaticMarkup(
        <I18nProvider locale="zh-TW" languagePreference="zh-TW" systemLocale="zh-TW">
          <Settings d={book} run={() => {}} onPage={() => {}} mode="real" initial={{ cat: "market" }} />
        </I18nProvider>,
      ),
    );
    expect(twOut).toContain("帳戶與券商連線");
    expect(twOut).toContain("帳本與備份");
    expect(twOut).toContain("行情自動更新");
  });
});
