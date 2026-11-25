import React, { createContext, useContext, useLayoutEffect, useMemo } from "react";
import {
  createTranslator,
  getActiveLocale,
  getIntlLocale,
  localeTag,
  setActiveLocale,
  tMain,
} from "../i18n/index.js";

const SOURCE_KEY_MAP = {
  "成交价": "source.tradePrice",
  "Yahoo Finance 日收盘": "source.yahooClose",
  "手工报价": "source.manualQuote",
  "IBKR 结单报价": "source.ibkrQuote",
  "IBKR 结单汇率": "source.ibkrFx",
  "IBKR 成交报告汇率": "source.ibkrExecFx",
  "IBKR 成交报表折算率": "source.ibkrExecFx",
  "IBKR 逐笔成交报表汇率": "source.ibkrExecFx",
  "IBKR 成交报告收盘价": "source.ibkrExecClose",
  "IBKR 成交报表收盘价": "source.ibkrExecClose",
  "IBKR 日结单汇率": "source.ibkrDailyFx",
  "IBKR 每日报表汇率": "source.ibkrDailyFx",
  "IBKR 日结单反向汇率": "source.ibkrDailyInvFx",
  "IBKR 每日报表反向汇率": "source.ibkrDailyInvFx",
  "买入日汇率": "source.buyFx",
  "按买入批成本及交易日汇率折算": "source.mixedBuyFx",
  "结单汇率": "source.statementFx",
  "结单价格": "source.statementPrice",
  "Twelve Data 日收盘": "source.twelveDataClose",
  "期初结单": "source.openingStatement",
  "示例结单": "source.sampleStatement",
  "模拟收盘价": "source.sampleClose",
  "示例账本 · 模拟总回报": "source.sampleTotalReturn",
  "账户现金": "source.accountCash",
  "券商账户页面（手工核对）": "source.brokerPage",
  "示例成分表": "source.sampleFund",
  "其余成分（示例汇总）": "source.restDemoFund",
  "旧账本": "source.legacyBook",
  manual: "source.manual",
};

const ALLOCATION_LABEL_MAP = {
  "个股": "alloc.label.individualStocks",
  "Individual Stocks": "alloc.label.individualStocks",
  "Individual stocks": "alloc.label.individualStocks",
  "现金": "alloc.label.cash",
  Cash: "alloc.label.cash",
  "小额现金": "alloc.label.smallCash",
  "Small cash": "alloc.label.smallCash",
  "其他投资": "alloc.label.otherInvestments",
  "Other investments": "alloc.label.otherInvestments",
  "其他公司": "alloc.label.otherCompanies",
  "Other companies": "alloc.label.otherCompanies",
  "其他资产": "alloc.label.otherAssets",
  "Other assets": "alloc.label.otherAssets",
  "债券 / 固收": "alloc.label.bondsFixedIncome",
  "Bonds & fixed income": "alloc.label.bondsFixedIncome",
  "Bonds / Fixed Income": "alloc.label.bondsFixedIncome",
  "基金成分待补充": "alloc.label.fundUnavailable",
  "Fund holdings unavailable": "alloc.label.fundUnavailable",
  "Fund holdings not available": "alloc.label.fundUnavailable",
  "未分类": "alloc.label.unclassified",
  Unclassified: "alloc.label.unclassified",
  "Mixed/Conflicting": "alloc.label.unclassified",
  Equity: "kind.stock",
  "Fixed income": "kind.fixed-income",
  Derivatives: "kind.derivative",
  Other: "kind.other",
  "未穿透": "alloc.label.notLookedThrough",
  "Not looked through": "alloc.label.notLookedThrough",
  "直接小仓位": "alloc.label.smallDirect",
  "Small direct": "alloc.label.smallDirect",
  "小仓位直接持仓": "alloc.label.smallDirectFull",
  "Small direct holdings": "alloc.label.smallDirectFull",
  "未穿透余项": "alloc.label.residual",
  "Unresolved residual": "alloc.label.residual",
  "基金未穿透余项": "alloc.label.residualFull",
  "Unresolved fund residual": "alloc.label.residualFull",
  "美国": "alloc.country.US",
  "United States": "alloc.country.US",
  US: "alloc.country.US",
  "澳大利亚": "alloc.country.AU",
  Australia: "alloc.country.AU",
  AU: "alloc.country.AU",
  "日本": "alloc.country.JP",
  Japan: "alloc.country.JP",
  JP: "alloc.country.JP",
  "英国": "alloc.country.UK",
  "United Kingdom": "alloc.country.UK",
  UK: "alloc.country.UK",
  "加拿大": "alloc.country.CA",
  Canada: "alloc.country.CA",
  CA: "alloc.country.CA",
  "科技": "alloc.sector.Technology",
  Technology: "alloc.sector.Technology",
  "Information Technology": "alloc.sector.Technology",
  "金融": "alloc.sector.Financials",
  Financials: "alloc.sector.Financials",
  "医疗": "alloc.sector.Healthcare",
  "医疗保健": "alloc.sector.Healthcare",
  Healthcare: "alloc.sector.Healthcare",
  "Health Care": "alloc.sector.Healthcare",
  "材料": "alloc.sector.Materials",
  Materials: "alloc.sector.Materials",
  "可选消费": "alloc.sector.ConsumerDiscretionary",
  "非必需消费": "alloc.sector.ConsumerDiscretionary",
  "Consumer Discretionary": "alloc.sector.ConsumerDiscretionary",
  "必需消费": "alloc.sector.ConsumerStaples",
  "Consumer Staples": "alloc.sector.ConsumerStaples",
  "工业": "alloc.sector.Industrials",
  Industrials: "alloc.sector.Industrials",
  "能源": "alloc.sector.Energy",
  Energy: "alloc.sector.Energy",
  "房地产": "alloc.sector.RealEstate",
  "Real Estate": "alloc.sector.RealEstate",
  "公用事业": "alloc.sector.Utilities",
  Utilities: "alloc.sector.Utilities",
  "通信服务": "alloc.sector.Communication",
  "通讯服务": "alloc.sector.Communication",
  "Communication Services": "alloc.sector.Communication",
};

const KNOWN_MARKETS = new Set(["XASX", "XNAS", "XNYS", "ARCX", "BATS"]);
const KNOWN_KINDS = new Set(["stock", "etf", "cash", "fixed-income", "derivative", "unknown", "other", "bond"]);
const KNOWN_TYPES = new Set([
  "BUY",
  "SELL",
  "DEPOSIT",
  "WITHDRAWAL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "TAX",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "FX",
  "FX_IN",
  "FX_OUT",
]);

function buildLocaleOptions(t, systemLocale) {
  const systemName = t(`lang.${localeTag(systemLocale)}`);
  return [
    ["system", t("lang.followSystem", { locale: systemName })],
    ["en", t("lang.en")],
    ["zh-CN", t("lang.zh-CN")],
    ["zh-TW", t("lang.zh-TW")],
  ];
}

export function buildI18nContext({
  locale = getActiveLocale(),
  languagePreference = "system",
  systemLocale = locale,
  changeLanguage = () => {},
} = {}) {
  const activeLocale = localeTag(locale);
  const resolvedSystem = localeTag(systemLocale);
  const intlLocale = getIntlLocale(activeLocale);
  const t = createTranslator(activeLocale);
  const dateFmt = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" });
  const dateTimeFmt = new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  });
  const formatDate = (value) => {
    if (!value) return "—";
    const parsed = value instanceof Date
      ? value
      : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00Z` : value);
    return Number.isNaN(parsed.getTime()) ? String(value) : dateFmt.format(parsed);
  };
  const formatDateTime = (value) => {
    if (!value) return "—";
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : dateTimeFmt.format(parsed);
  };
  const sourceLabel = (source) => {
    if (!source) return source;
    const key = SOURCE_KEY_MAP[source];
    if (key) return t(key);
    const bookMatch = /^(.+?)(\s*账本)$/.exec(source);
    if (bookMatch && SOURCE_KEY_MAP[bookMatch[1]]) return t(SOURCE_KEY_MAP[bookMatch[1]]);
    return source;
  };
  const cashLabel = (value) => {
    if (!value) return value;
    if (value === "现金" || value === "Cash" || value === "現金") return t("cash.plain");
    if (value === "其他资产" || value === "Other assets" || value === "其他資產") return t("label.otherAssets");
    const match = /^([A-Z]{3})\s*(?:现金|cash|現金)$/i.exec(String(value).trim());
    if (match) return t("cash.currency", { currency: match[1].toUpperCase() });
    return value;
  };
  const allocationLabel = (name) => {
    if (!name) return name;
    const key = ALLOCATION_LABEL_MAP[name];
    if (key) return t(key);
    const opaque = /^(.+?)\s*[（(](?:未穿透|Not looked through)[）)]$/.exec(String(name));
    if (opaque) return t("alloc.label.opaqueSuffix", { symbol: opaque[1] });
    return cashLabel(name);
  };
  const kindLabel = (value) => (KNOWN_KINDS.has(value) ? t(`kind.${value}`) : t("kind.other"));
  const typeLabel = (value) => (KNOWN_TYPES.has(value) ? t(`type.${value}`) : t("type.unknown"));
  const marketLabel = (mic) => {
    if (!mic) return t("market.pending");
    return KNOWN_MARKETS.has(mic) ? t(`market.${mic}`) : mic;
  };
  return {
    locale: activeLocale,
    languagePreference,
    systemLocale: resolvedSystem,
    intlLocale,
    changeLanguage,
    t,
    localeOptions: buildLocaleOptions(t, resolvedSystem),
    formatDate,
    formatDateTime,
    sourceLabel,
    cashLabel,
    allocationLabel,
    kindLabel,
    typeLabel,
    marketLabel,
  };
}

const I18nContext = createContext(
  buildI18nContext({
    locale: getActiveLocale(),
    languagePreference: "system",
    systemLocale: getActiveLocale(),
  }),
);

export function I18nProvider({ locale, languagePreference = "system", systemLocale = locale, changeLanguage, children }) {
  const value = useMemo(
    () => buildI18nContext({ locale, languagePreference, systemLocale, changeLanguage }),
    [locale, languagePreference, systemLocale, changeLanguage],
  );
  useLayoutEffect(() => {
    setActiveLocale(value.locale);
    if (typeof document !== "undefined") {
      document.documentElement.lang = value.locale;
      document.title = value.t("app.windowTitle");
    }
  }, [value]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export { tMain };
