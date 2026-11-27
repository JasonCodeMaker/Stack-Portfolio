import React, { useState } from "react";
import { api, Modal } from "./common";
import { useI18n } from "./i18n.jsx";

export function FactoryResetButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(false);
    try {
      await api.factoryReset();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  function cancel() {
    if (!busy) setOpen(false);
  }

  return (
    <>
      <button type="button" className="btn factory-reset-action" onClick={() => { setError(false); setOpen(true); }}>
        {t("settings.factoryReset.open")}
      </button>
      {open && (
        <Modal title={t("settings.factoryReset.title")} close={cancel}>
          <p>{t("settings.factoryReset.delete")}</p>
          <p className="muted">{t("settings.factoryReset.keep")}</p>
          {error && <p className="notice" role="alert">{t("err.factoryResetRequest")}</p>}
          {busy && <p role="status">{t("settings.factoryReset.restarting")}</p>}
          <div className="acts">
            <button type="button" className="btn" disabled={busy} onClick={cancel}>{t("app.cancel")}</button>
            <button type="button" className="btn factory-reset-action" disabled={busy} onClick={confirm}>
              {t("settings.factoryReset.confirm")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
