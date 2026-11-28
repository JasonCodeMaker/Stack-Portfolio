import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

globalThis.window ??= {}; // common.jsx reads the preload bridge on import
const { parseNotes, UpdateDialog, UpdateNotes, UpdateSettingsRow, UpdateSideCard } = await import("../../ui/AppUpdate.jsx");

const ready = { status: "ready", version: "1.5.0", notes: "## 新功能\n- 应用内更新\n## 修复\n- 升级前备份账本", releaseDate: "2026-12-05", prompt: true, skipped: false };
const noop = () => {};
const text = (node) => renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("release notes", () => {
  it("groups items under their headings", () => {
    expect(parseNotes(ready.notes)).toEqual([
      { title: "新功能", items: ["应用内更新"] },
      { title: "修复", items: ["升级前备份账本"] },
    ]);
  });
  it("keeps notes that have no headings or bullets", () => {
    expect(parseNotes("Faster sync\n* Fewer prompts")).toEqual([{ title: "", items: ["Faster sync", "Fewer prompts"] }]);
    expect(parseNotes("")).toEqual([]);
    expect(parseNotes(null)).toEqual([]);
  });
  it("renders text only, never markup from the notes", () => {
    const html = renderToStaticMarkup(<UpdateNotes notes={'- <img src=x onerror="alert(1)">'} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(text(<UpdateNotes notes="" />)).toBe("这个版本没有提供更新说明。");
  });
});

describe("update dialog", () => {
  const dialog = (update, installing = false) =>
    <UpdateDialog update={update} current="1.4.29" installing={installing} onInstall={noop} onLater={noop} onSkip={noop} />;
  it("shows both versions, the notes and the three choices", () => {
    const shown = text(dialog(ready));
    expect(shown).toContain("有新版本可以安装");
    expect(shown).toMatch(/当前版本 1\.4\.29 → 新版本 1\.5\.0/);
    expect(shown).toContain("2026-12-05 发布");
    expect(shown).toContain("应用内更新");
    expect(shown).toContain("不会改动你的账本和设置");
    for (const choice of ["重启并更新", "稍后提醒", "跳过这个版本"]) expect(shown).toContain(choice);
  });
  it("does not offer to skip a version that is already skipped", () => {
    expect(text(dialog({ ...ready, prompt: false, skipped: true }))).not.toContain("跳过这个版本");
  });
  it("locks the choices while the app restarts", () => {
    const html = renderToStaticMarkup(dialog(ready, true));
    expect(html).toContain("正在重启…");
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});

describe("sidebar card", () => {
  const card = (update) => text(<UpdateSideCard update={update} current="1.4.29" onOpen={noop} />);
  it("offers a ready update with both versions", () => {
    expect(card(ready)).toBe("新版本 1.5.0 当前 1.4.29 · 已下载 查看并更新");
    expect(renderToStaticMarkup(<UpdateSideCard update={ready} current="1.4.29" onOpen={noop} />))
      .toContain('aria-label="新版本 1.5.0 可以安装（当前 1.4.29）"');
  });
  it("shows only the version after the update was skipped", () => {
    expect(card({ ...ready, prompt: false, skipped: true })).toBe("版本 1.4.29");
  });
  it("keeps the current version in view in every other state", () => {
    expect(card({ status: "current", checkedAt: 1 })).toBe("版本 1.4.29 已是最新");
    expect(card({ status: "failed", checkedAt: 1 })).toBe("版本 1.4.29 暂时无法检查更新");
    expect(card({ status: "downloading", version: "1.5.0", percent: 42 })).toBe("正在下载 1.5.0 · 42%");
    for (const update of [{ status: "idle" }, { status: "checking" }, { status: "disabled", reason: "trial" }])
      expect(card(update)).toBe("版本 1.4.29");
  });
});

describe("settings version row", () => {
  const row = (update) => text(<UpdateSettingsRow update={update} current="1.4.29" onOpen={noop} onCheck={noop} onInstall={noop} />);
  it("always names the installed version", () => {
    for (const update of [ready, { status: "idle" }, { status: "disabled", reason: "unavailable" }])
      expect(row(update)).toMatch(/^Stock Portfolio 1\.4\.29/);
  });
  it("offers the right action for each state", () => {
    expect(row(ready)).toBe("Stock Portfolio 1.4.29 1.5.0 已下载，可以安装 更新内容 重启并更新");
    expect(row({ ...ready, prompt: false, skipped: true })).toContain("重启并更新");
    expect(row({ status: "current", checkedAt: 1 })).toBe("Stock Portfolio 1.4.29 已是最新 检查更新");
    expect(row({ status: "failed", checkedAt: 1 })).toBe("Stock Portfolio 1.4.29 无法检查更新。应用稍后会自动重试。 重试");
    expect(row({ status: "checking" })).toBe("Stock Portfolio 1.4.29 正在检查更新…");
    expect(row({ status: "downloading", version: "1.5.0", percent: 42 })).toBe("Stock Portfolio 1.4.29 正在下载 1.5.0 · 42%");
    expect(row({ status: "disabled", reason: "trial" })).toBe("Stock Portfolio 1.4.29 试用模式下不检查更新。");
    expect(row({ status: "disabled", reason: "unavailable" })).toBe("Stock Portfolio 1.4.29");
  });
});
