const en = require("./locales/en.js");
const zhCN = require("./locales/zh-CN.js");
const zhTW = require("./locales/zh-TW.js");

const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW"];
const LANGUAGE_PREFERENCES = ["system", "en", "zh-CN", "zh-TW"];
const DEFAULT_FALLBACK_LOCALE = "en";

const dictionaries = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

const INTL_LOCALES = {
  en: "en-AU",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
};

const TRADITIONAL_ZH = /^zh(?:[-_](?:hant|tw|hk|mo))(?:$|[-_])/i;
const SIMPLIFIED_ZH = /^zh(?:$|[-_](?:hans|cn|sg)(?:$|[-_]))/i;
const ENGLISH = /^en(?:$|[-_])/i;

function normalizeLanguagePreference(value) {
  return LANGUAGE_PREFERENCES.includes(value) ? value : "system";
}

function resolveSystemLocale(systemLanguages = []) {
  const list = Array.isArray(systemLanguages)
    ? systemLanguages
    : systemLanguages
      ? [systemLanguages]
      : [];
  for (const raw of list) {
    const tag = String(raw || "").trim();
    if (!tag) continue;
    if (TRADITIONAL_ZH.test(tag)) return "zh-TW";
    if (SIMPLIFIED_ZH.test(tag) || /^zh$/i.test(tag)) return "zh-CN";
    if (ENGLISH.test(tag)) return "en";
  }
  return DEFAULT_FALLBACK_LOCALE;
}

/**
 * Resolves the effective locale from a saved preference and OS/browser language tags.
 * Supported: "en", "zh-CN", "zh-TW". Falls back to "en" when no system tag matches.
 */
function resolveLocale(preference, systemLanguages = []) {
  if (SUPPORTED_LOCALES.includes(preference)) return preference;
  return resolveSystemLocale(systemLanguages);
}

function localeTag(locale) {
  return SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_FALLBACK_LOCALE;
}

function getIntlLocale(locale) {
  return INTL_LOCALES[locale] || INTL_LOCALES.en;
}

function getMessages(locale) {
  return dictionaries[locale] || dictionaries.en;
}

function translate(locale, key, params = {}) {
  const dict = getMessages(locale);
  let template = dict[key];
  if (template == null) template = dictionaries.en[key];
  if (template == null) return key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined || params[name] === null ? match : String(params[name]),
  );
}

function createTranslator(locale) {
  const resolved = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_FALLBACK_LOCALE;
  return (key, params) => translate(resolved, key, params);
}

// Default to zh-CN before Electron main initializes via resolveLocale() so existing Node unit
// and Vitest SSR tests run deterministically without launching Electron.
let activeLocale = "zh-CN";

function getActiveLocale() {
  return activeLocale;
}

function setActiveLocale(locale) {
  activeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_FALLBACK_LOCALE;
  return activeLocale;
}

function tMain(key, params) {
  return translate(activeLocale, key, params);
}

module.exports = {
  SUPPORTED_LOCALES,
  LANGUAGE_PREFERENCES,
  DEFAULT_FALLBACK_LOCALE,
  dictionaries,
  normalizeLanguagePreference,
  resolveSystemLocale,
  resolveLocale,
  localeTag,
  getIntlLocale,
  getMessages,
  translate,
  createTranslator,
  getActiveLocale,
  setActiveLocale,
  tMain,
};
