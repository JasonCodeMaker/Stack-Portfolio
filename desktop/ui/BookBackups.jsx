import React, { useState } from "react";
import { api, Modal } from "./common";
import { useI18n } from "./i18n.jsx";

// Backup, restore and legacy-backup encryption, each confirmed in a dialog. On the welcome page only restore shows, as a link.
export function BookBackups({ run, restored, welcome = false }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(null);

  async function restore(selection, password) {
    const mode = await api.restore({ token: selection.token, password });
    if (mode) await restored(mode);
  }
  function chooseBackup() {
    run(async () => {
      const selection = await api.selectBackup();
      if (!selection) return;
      if (selection.needsPassword) setPrompt({ action: "restore", selection });
      else await restore(selection);
    }, false);
  }
  function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const password = form.elements.password.value;
    if (form.elements.confirm && form.elements.confirm.value !== password) {
      form.elements.confirm.setCustomValidity(t("backup.passwordMismatch"));
      form.reportValidity();
      return;
    }
    form.reset();
    setPrompt(null);
    run(async () => {
      if (prompt.action === "restore") return restore(prompt.selection, password);
      const name = await api.backup({ password, convertLegacy: prompt.action === "convert" });
      if (name) return t("backup.savedFile", { name });
    }, false);
  }
  const reading = prompt?.action === "restore";
  return (
    <>
      {!welcome && (
        <button className="btn" onClick={() => setPrompt({ action: "save" })}>
          {t("backup.btnSave")}
        </button>
      )}
      <button className={welcome ? "lnk" : "btn"} onClick={chooseBackup}>
        {welcome ? t("backup.btnRestoreWelcome") : t("backup.btnRestore")}
      </button>
      {!welcome && (
        <button className="btn" onClick={() => setPrompt({ action: "convert" })}>
          {t("backup.btnEncryptLegacy")}
        </button>
      )}
      {prompt && (
        <Modal title={reading ? t("backup.modalUnlock") : t("backup.modalPassword")} close={() => setPrompt(null)}>
          <form
            onSubmit={submit}
            onInput={(e) => e.currentTarget.elements.confirm?.setCustomValidity("")}
          >
            <p className="muted">
              {reading ? prompt.selection.name : t("backup.passwordAdvice")}
            </p>
            {prompt.action === "convert" && (
              <p className="muted">{t("backup.convertAdvice")}</p>
            )}
            <div className="fg">
              <label className="f">
                <span>{reading ? t("backup.passwordLabel") : t("backup.passwordNewLabel")}</span>
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={1024}
                  required
                  autoFocus
                  autoComplete={reading ? "current-password" : "new-password"}
                />
              </label>
              {!reading && (
                <label className="f">
                  <span>{t("backup.passwordConfirmLabel")}</span>
                  <input name="confirm" type="password" required maxLength={1024} autoComplete="new-password" />
                </label>
              )}
            </div>
            <div className="acts">
              <button type="button" className="btn" onClick={() => setPrompt(null)}>
                {t("app.cancel")}
              </button>
              <button className="btn pri">{reading ? t("backup.unlockRestore") : t("backup.chooseDestination")}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
