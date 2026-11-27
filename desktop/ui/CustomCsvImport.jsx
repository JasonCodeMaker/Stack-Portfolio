import React, { useState } from "react";
import { Download, FileUp } from "lucide-react";
import { api, num } from "./common";
import { useI18n } from "./i18n.jsx";

const previewPage = 30;

function recordValue(value) {
  if (!value) return "—";
  const { symbol, mic, currency, quantity, unit_price, amount, to_currency, to_amount } = value;
  const cash = currency + " " + num(amount ?? unit_price);
  if (to_currency) return cash + " → " + to_currency + " " + num(to_amount);
  if (quantity) return [symbol, mic, num(quantity) + " × " + cash].filter(Boolean).join(" · ");
  return [symbol, cash].filter(Boolean).join(" · ");
}

export function CustomCsvImport({ account, run, onManual, onOpening, onHistory }) {
  const { t, typeLabel } = useI18n();
  const [preview, setPreview] = useState(null);
  const [limit, setLimit] = useState(previewPage);
  const [busy, setBusy] = useState(false);

  async function act(fn, refresh = false) {
    setBusy(true);
    try {
      await run(fn, refresh);
    } finally {
      setBusy(false);
    }
  }

  const rows = preview?.rows ?? [];
  const errorsFirst = [...rows.filter((row) => row.status === "invalid"), ...rows.filter((row) => row.status !== "invalid")];
  return (
    <section className="card cap880 custom-import" aria-label={t("custom.import")}>
      <h2>{account.name}</h2>
      <p className="muted">{t("custom.importHelp")}</p>
      <div className="acts">
        <button className="btn pri" type="button" disabled={busy} onClick={() => act(async () => {
          const result = await api.previewCustomCsv({ account: account.id });
          if (result) {
            setLimit(previewPage);
            setPreview(result);
          }
        })}><FileUp size={16} aria-hidden="true" /> {t("custom.import")}</button>
        <button className="btn" type="button" disabled={busy} onClick={() => act(async () => {
          await api.downloadCustomCsv({ account: account.id });
        })}><Download size={16} aria-hidden="true" /> {t("custom.download")}</button>
        <button className="btn" type="button" onClick={onManual}>{t("imports.addEntryBtn")}</button>
        <button className="btn" type="button" onClick={onOpening}>{t("custom.opening")}</button>
      </div>
      <details>
        <summary>{t("custom.csvFormat")}</summary>
        <p className="muted">{t("custom.csvHelp")}</p>
        <p className="muted">{t("custom.csvFields")}</p>
        <p className="muted">{t("custom.csvFx")}</p>
      </details>
      {preview && (
        <div className="stack" aria-label={t("custom.preview")}>
          <h3>{t("custom.preview")}</h3>
          <p role="status">
            {preview.name} · {preview.done
              ? t("custom.imported", { count: preview.imported, duplicate: preview.duplicate })
              : t("custom.counts", { added: preview.new, duplicate: preview.duplicate, invalid: preview.invalid })}
          </p>
          {preview.invalid > 0 && <p className="error-text" role="alert">{t("custom.blocked")}</p>}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{t("custom.line")}</th>
                  <th className="l">{t("imports.field.reference")}</th>
                  <th>{t("imports.col.date")}</th>
                  <th className="l">{t("imports.col.type")}</th>
                  <th className="l">{t("imports.col.amount")}</th>
                  <th className="l">{t("settings.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {errorsFirst.slice(0, limit).map((row) => (
                  <tr key={row.line}>
                    <td>{row.line}</td>
                    <td className="l">{row.reference || "—"}</td>
                    <td>{row.date || "—"}</td>
                    <td className="l">{row.type ? typeLabel(row.type) : "—"}</td>
                    <td className="l">
                      {recordValue(row.values)}
                      {Number(row.values?.fee) > 0 && <small>{t("preview.feeDetail", {
                        value: row.values.currency + " " + num(row.values.fee),
                      })}</small>}
                    </td>
                    <td className="l">
                      {row.status === "invalid"
                        ? <span className="error-text">{row.field} · {row.message}</span>
                        : t("custom.status." + row.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="acts">
            {rows.length > limit && (
              <button className="btn" type="button" onClick={() => setLimit(limit + previewPage)}>{t("custom.moreRows")}</button>
            )}
            {preview.done
              ? <button className="btn pri" type="button" onClick={onHistory}>{t("imports.tab.history")}</button>
              : <>
                  <button className="btn pri" type="button" disabled={busy || preview.invalid > 0 || !preview.new || !preview.token}
                    onClick={() => act(async () => {
                      const result = await api.commitCustomCsv({ account: account.id, token: preview.token });
                      setPreview({ ...result, name: preview.name });
                    }, true)}>{t("custom.confirmImport")}</button>
                  <button className="btn" type="button" disabled={busy} onClick={() => setPreview(null)}>{t("app.cancel")}</button>
                </>}
          </div>
        </div>
      )}
    </section>
  );
}
