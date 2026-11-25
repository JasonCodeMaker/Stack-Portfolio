const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SUPPORTED_LOCALES,
  LANGUAGE_PREFERENCES,
  dictionaries,
  normalizeLanguagePreference,
  resolveSystemLocale,
  resolveLocale,
  localeTag,
  getIntlLocale,
  translate,
  createTranslator,
  getActiveLocale,
  setActiveLocale,
  tMain,
} = require("../i18n/index.js");

test("resolveLocale honors explicit overrides and resolves system languages with English fallback", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["en", "zh-CN", "zh-TW"]);
  assert.deepEqual(LANGUAGE_PREFERENCES, ["system", "en", "zh-CN", "zh-TW"]);
  assert.equal(normalizeLanguagePreference("en"), "en");
  assert.equal(normalizeLanguagePreference("invalid"), "system");

  // Explicit preferences always win over system languages.
  assert.equal(resolveLocale("en", ["zh-CN"]), "en");
  assert.equal(resolveLocale("zh-CN", ["en-AU"]), "zh-CN");
  assert.equal(resolveLocale("zh-TW", ["zh-CN"]), "zh-TW");

  // Simplified Chinese tags.
  for (const tag of ["zh-CN", "zh-Hans", "zh-Hans-CN", "zh-SG", "zh", "zh_CN"]) {
    assert.equal(resolveLocale("system", [tag]), "zh-CN", `Expected zh-CN for ${tag}`);
    assert.equal(resolveSystemLocale([tag]), "zh-CN", `Expected system zh-CN for ${tag}`);
  }

  // Traditional Chinese tags.
  for (const tag of ["zh-TW", "zh-Hant", "zh-Hant-TW", "zh-HK", "zh-MO", "zh_HK", "zh_TW"]) {
    assert.equal(resolveLocale("system", [tag]), "zh-TW", `Expected zh-TW for ${tag}`);
    assert.equal(resolveSystemLocale([tag]), "zh-TW", `Expected system zh-TW for ${tag}`);
  }

  // English tags.
  for (const tag of ["en", "en-US", "en-AU", "en-GB"]) {
    assert.equal(resolveLocale("system", [tag]), "en", `Expected en for ${tag}`);
  }

  // Unsupported or missing tags fall back to English.
  assert.equal(resolveLocale("system", ["fr-FR", "ja-JP"]), "en");
  assert.equal(resolveLocale("system", []), "en");
  assert.equal(resolveLocale(undefined, ["de-DE"]), "en");
  assert.equal(resolveLocale("invalid-pref", ["fr-FR"]), "en");

  // Priority order in system language list.
  assert.equal(resolveLocale("system", ["ja-JP", "zh-HK", "en-US"]), "zh-TW");
  assert.equal(resolveLocale("system", ["fr-FR", "zh-CN", "zh-TW"]), "zh-CN");
  assert.equal(resolveLocale("system", ["fr-FR", "en-AU", "zh-CN"]), "en");
});

test("all locale dictionaries have identical keys, non-empty strings, and matching placeholders", () => {
  const enKeys = Object.keys(dictionaries.en).sort();
  assert.ok(enKeys.length > 400, "Expected comprehensive dictionary keys");

  const placeholders = (text) =>
    [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

  for (const locale of SUPPORTED_LOCALES) {
    const dict = dictionaries[locale];
    const keys = Object.keys(dict).sort();
    assert.deepEqual(keys, enKeys, `Key mismatch in locale ${locale}`);

    for (const key of enKeys) {
      const value = dict[key];
      assert.equal(typeof value, "string", `${locale}.${key} must be a string`);
      assert.ok(value.trim().length > 0, `${locale}.${key} must not be empty`);
      assert.deepEqual(
        placeholders(value),
        placeholders(dictionaries.en[key]),
        `Placeholder mismatch for ${locale}.${key}`,
      );
    }
  }
});

test("translate, createTranslator, getIntlLocale, localeTag, and main active locale state", () => {
  assert.equal(getIntlLocale("en"), "en-AU");
  assert.equal(getIntlLocale("zh-CN"), "zh-CN");
  assert.equal(getIntlLocale("zh-TW"), "zh-TW");
  assert.equal(localeTag("en"), "en");
  assert.equal(localeTag("zh-TW"), "zh-TW");
  assert.equal(localeTag("invalid"), "en");

  assert.equal(translate("en", "lang.followSystem", { locale: "English" }), "Follow system (English)");
  assert.equal(translate("zh-CN", "lang.followSystem", { locale: "简体中文" }), "跟随系统（简体中文）");
  assert.equal(translate("zh-TW", "lang.followSystem", { locale: "繁體中文" }), "跟隨系統（繁體中文）");
  assert.equal(translate("unknown-locale", "nav.settings"), "Settings");
  assert.equal(translate("en", "nonexistent.key"), "nonexistent.key");

  const tTw = createTranslator("zh-TW");
  assert.equal(tTw("nav.settings"), "設定");

  const previous = getActiveLocale();
  try {
    setActiveLocale("en");
    assert.equal(getActiveLocale(), "en");
    assert.equal(tMain("err.selectBookFirst"), "Select a ledger first.");

    setActiveLocale("zh-TW");
    assert.equal(tMain("err.selectBookFirst"), "請先選擇帳本。");
  } finally {
    setActiveLocale(previous);
  }
});
