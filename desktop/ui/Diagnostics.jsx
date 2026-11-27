import React, { useCallback, useEffect, useState } from "react";
import { api, Modal } from "./common";
import { useI18n } from "./i18n.jsx";

function DiagnosticsDialog({ screen, close }) {
  const { t } = useI18n();
  const [range, setRange] = useState("recent");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const perform = useCallback(async (work) => {
    setBusy(true);
    setStatus("");
    try {
      await work();
    } catch {
      setStatus("diagnostics.failed");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void perform(async () => {
      const result = await api.diagnosticsPreview({ range });
      if (active) setPreview(result);
    });
    return () => { active = false; };
  }, [perform, range]);

  const load = async () => setPreview(await api.diagnosticsPreview({ range }));
  return (
    <Modal title={t("diagnostics.title")} close={() => { if (!busy) close(); }} wide>
      <p>{t("diagnostics.description")}</p>
      <div className="row">
        <label className="row">
          <span>{t("diagnostics.range")}</span>
          <select className="btn" value={range} disabled={busy} onChange={(event) => {
            setPreview(null);
            setRange(event.target.value);
          }}>
            <option value="recent">{t("diagnostics.recent")}</option>
            <option value="day">{t("diagnostics.day")}</option>
            <option value="all">{t("diagnostics.all")}</option>
          </select>
        </label>
        <button className="btn" disabled={busy || !preview || preview.paused} onClick={() => perform(async () => {
          await api.diagnosticsReport({ screen });
          await load();
          setStatus("diagnostics.marked");
        })}>{t("diagnostics.mark")}</button>
      </div>
      {preview && (
        <>
          <p className="muted">{t("diagnostics.count", { count: preview.count })}</p>
          {preview.paused && <p role="status">{t("diagnostics.paused")}</p>}
          {preview.incomplete && <p role="status">{t("diagnostics.incomplete")}</p>}
          {preview.count > 0 && (
            <label className="field">
              <span>{t("diagnostics.preview")}</span>
              <textarea className="diagnostics-preview" readOnly wrap="off" value={preview.text} />
            </label>
          )}
        </>
      )}
      {status && <p role={status === "diagnostics.failed" ? "alert" : "status"}>{t(status)}</p>}
      <div className="acts">
        <button className="btn" disabled={busy || !preview} onClick={() => perform(async () => {
          await api.diagnosticsPause({ paused: !preview.paused });
          await load();
        })}>{t(preview?.paused ? "diagnostics.resume" : "diagnostics.pause")}</button>
        <button className="btn" disabled={busy || !preview} onClick={() => setConfirmClear(true)}>
          {t("diagnostics.clear")}
        </button>
        <button className="btn pri" disabled={busy || !preview?.count} onClick={() => perform(async () => {
          if (await api.diagnosticsSave({ id: preview.id })) setStatus("diagnostics.saved");
        })}>{t("diagnostics.save")}</button>
      </div>
      {confirmClear && (
        <Modal title={t("diagnostics.confirmClear")} close={() => setConfirmClear(false)}>
          <div className="acts">
            <button className="btn" onClick={() => setConfirmClear(false)}>{t("app.cancel")}</button>
            <button className="btn" onClick={() => {
              setConfirmClear(false);
              void perform(async () => {
                await api.diagnosticsClear();
                await load();
              });
            }}>{t("diagnostics.clear")}</button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

export function DiagnosticsButton({ screen }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpened(true)}>{t("diagnostics.title")}</button>
      {opened && <DiagnosticsDialog screen={screen} close={() => setOpened(false)} />}
    </>
  );
}
