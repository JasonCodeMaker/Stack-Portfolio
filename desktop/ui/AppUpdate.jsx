import React, { useEffect, useState } from "react";
import { CheckCircle2, Download, ShieldCheck, X } from "lucide-react";
import { api, Modal } from "./common";
import { useI18n } from "./i18n.jsx";
import "./appUpdate.css";

// Follows the update state the main process owns. Every update surface renders from this one value.
export function useUpdateState() {
  const [state, setState] = useState({ status: "disabled", reason: "unpackaged" });
  useEffect(() => {
    if (!api?.onUpdateState) return undefined;
    let active = true, received = false;
    const unsubscribe = api.onUpdateState((next) => {
      received = true;
      setState(next);
    });
    api.updateState().then((next) => {
      if (active && !received) setState(next);
    }).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state;
}

// A release body may carry the same notes in several languages, each under a top-level heading
// that names the language. The app shows the section for its own language only.
const LANGUAGES = {
  en: ["english", "en"],
  "zh-CN": ["简体中文", "中文", "zh-cn"],
  "zh-TW": ["繁體中文", "繁体中文", "zh-tw"],
};
const FALLBACK = { "zh-TW": ["zh-TW", "zh-CN", "en"], "zh-CN": ["zh-CN", "zh-TW", "en"], en: ["en"] };
const languageOf = (title) => Object.keys(LANGUAGES).find((locale) => LANGUAGES[locale].includes(title.trim().toLowerCase()));
// Categories get a coloured tag. Anything else keeps a neutral one.
const KINDS = {
  new: ["new", "新功能", "新增"],
  improved: ["improved", "improvements", "改进", "改進", "优化", "優化"],
  fixed: ["fixed", "fixes", "修复", "修復"],
};
const kindOf = (title) => Object.keys(KINDS).find((kind) => KINDS[kind].includes(title.trim().toLowerCase())) ?? "other";

// Release notes are plain text. "# Language" starts a language section, "## Title" starts a group
// and "- item" is a list item; any other line is kept as an item, so notes written without that
// structure still read correctly. Notes with no language sections are shown whole.
export function parseNotes(text, locale = "en") {
  const sections = [{ language: null, groups: [] }];
  for (const line of String(text ?? "").split("\n").map((value) => value.trim()).filter(Boolean)) {
    const top = /^#\s+(.*)$/.exec(line);
    const language = top && languageOf(top[1]);
    if (language) {
      sections.push({ language, groups: [] });
      continue;
    }
    const groups = sections.at(-1).groups;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) groups.push({ title: heading[1], kind: kindOf(heading[1]), items: [] });
    else {
      if (!groups.length) groups.push({ title: "", kind: "other", items: [] });
      groups.at(-1).items.push(line.replace(/^[-*•]\s+/, ""));
    }
  }
  const filled = sections.filter((section) => section.groups.some((group) => group.title || group.items.length));
  const named = filled.filter((section) => section.language);
  const wanted = (FALLBACK[locale] ?? [locale, "en"]).map((code) => named.find((section) => section.language === code)).find(Boolean);
  // Text before the first language heading belongs to every language.
  const shown = named.length ? [...filled.filter((section) => !section.language), wanted ?? named[0]] : filled;
  return shown.flatMap((section) => section.groups).filter((group) => group.title || group.items.length);
}

export function UpdateNotes({ notes }) {
  const { t, locale } = useI18n();
  const groups = parseNotes(notes, locale);
  if (!groups.length) return <p className="cap">{t("update.noNotes")}</p>;
  return (
    <div className="upd-notes">
      {groups.map((group, i) => (
        <section key={i}>
          {group.title && <h3><span className={"upd-tag " + group.kind}>{group.title}</span></h3>}
          {group.items.length > 0 && (
            <ul>
              {group.items.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

// Asks once when a version becomes ready, and reopens from the sidebar card or Settings.
export function UpdateDialog({ update, current, installing, onInstall, onLater, onSkip }) {
  const { t } = useI18n();
  return (
    <Modal title={t("update.dialogTitle")} close={onLater}>
      <div className="upd-versions">
        <div>
          <span className="cap">{t("update.current")}</span>
          <b>{current}</b>
        </div>
        <span className="upd-arrow" aria-hidden="true">→</span>
        <div className="new">
          <span className="cap">{t("update.next")}</span>
          <b>{update.version}</b>
        </div>
        <span className="sp" />
        <span className="cap upd-meta">
          {update.releaseDate && <>{t("update.released", { date: update.releaseDate })}<br /></>}
          {t("update.downloaded")}
        </span>
      </div>
      <div className="upd-scroll">
        <UpdateNotes notes={update.notes} />
        <p className="upd-safe">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{t("update.safe")}</span>
        </p>
      </div>
      <div className="acts upd-acts">
        <button type="button" className="btn pri" disabled={installing} onClick={onInstall}>
          {installing ? t("update.installing") : t("update.install")}
        </button>
        <button type="button" className="btn" disabled={installing} onClick={onLater}>{t("update.later")}</button>
        <span className="sp" />
        {!update.skipped && (
          <button type="button" className="text-btn" disabled={installing} onClick={onSkip}>{t("update.skip")}</button>
        )}
      </div>
    </Modal>
  );
}

// The sidebar keeps the current version in view, and keeps a ready update one click away after
// the dialog was answered with "later". A skipped version shows the version only.
export function UpdateSideCard({ update, current, onOpen }) {
  const { t } = useI18n();
  if (update.status === "ready" && !update.skipped) {
    const label = t("update.cardAria", { next: update.version, version: current });
    return (
      <div className="upd-card ready">
        <button type="button" className="upd-ico" aria-label={label} title={label} onClick={onOpen}>
          <Download size={18} aria-hidden="true" />
          <i />
        </button>
        <b><i className="upd-dot" />{t("update.cardTitle", { version: update.version })}</b>
        <small>{t("update.cardDetail", { version: current })}</small>
        <button type="button" className="btn pri sm" onClick={onOpen}>{t("update.cardAction")}</button>
      </div>
    );
  }
  if (update.status === "downloading")
    return (
      <div className="upd-card quiet" role="status">
        <span>{t("update.downloading", { version: update.version, percent: update.percent })}</span>
        <span className="upd-bar"><i style={{ width: `${update.percent}%` }} /></span>
      </div>
    );
  const detail = update.status === "current" ? t("update.upToDate") : update.status === "failed" ? t("update.unavailable") : "";
  return (
    <div className="upd-card quiet">
      <span>{t("update.version", { version: current })}</span>
      {detail && <span>{detail}</span>}
    </div>
  );
}

// The version line at the top of Settings: what is installed, and what can be done about updates.
export function UpdateSettingsRow({ update, current, installing, onOpen, onCheck, onInstall }) {
  const { t } = useI18n();
  const { status } = update;
  return (
    <div className="upd-row" aria-label={t("update.rowAria")} role="group">
      <b>Stock Portfolio {current}</b>
      {status === "ready" && (
        <>
          <span className="upd-line"><i className="upd-dot" />{t("update.readyLine", { version: update.version })}</span>
          <button type="button" className="btn sm" onClick={onOpen}>{t("update.notes")}</button>
          <button type="button" className="btn pri sm" disabled={installing} onClick={onInstall}>
            {installing ? t("update.installing") : t("update.install")}
          </button>
        </>
      )}
      {status === "downloading" && (
        <span className="upd-line" role="status">
          {t("update.downloading", { version: update.version, percent: update.percent })}
          <span className="upd-bar"><i style={{ width: `${update.percent}%` }} /></span>
        </span>
      )}
      {status === "checking" && <span className="upd-line cap" role="status">{t("update.checking")}</span>}
      {status === "current" && <span className="upd-line cap">{t("update.upToDate")}</span>}
      {status === "failed" && <span className="upd-line warn">{t("update.failedLine")}</span>}
      {status === "disabled" && update.reason === "trial" && <span className="upd-line cap">{t("update.trialOff")}</span>}
      {["idle", "current", "failed"].includes(status) && (
        <button type="button" className="btn sm" onClick={onCheck}>{t(status === "failed" ? "update.retry" : "update.check")}</button>
      )}
    </div>
  );
}

// Shown once on the launch that follows an installed update.
export function UpdatedToast({ updated, onClose }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <Modal title={t("update.updatedTitle", { version: updated.version })} close={onClose}>
        <div className="upd-scroll"><UpdateNotes notes={updated.notes} /></div>
        <div className="acts"><button type="button" className="btn pri" onClick={onClose}>{t("app.ok")}</button></div>
      </Modal>
    );
  return (
    <div className="toast upd-toast" role="status">
      <CheckCircle2 size={17} aria-hidden="true" />
      <span>{t("update.updatedToast", { version: updated.version })}</span>
      <button type="button" className="text-btn" onClick={() => setOpen(true)}>{t("update.notes")}</button>
      <button type="button" className="icon" aria-label={t("app.close")} onClick={onClose}><X size={15} /></button>
    </div>
  );
}
