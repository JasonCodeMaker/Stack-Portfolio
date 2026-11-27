import React, { useRef, useState } from "react";
import Decimal from "decimal.js";
import { api, Field, Modal, types } from "./common";
import { SecurityFields } from "./HoldingEditor";
import { useI18n } from "./i18n.jsx";

function entryEffect(form, t) {
  const { type, currency, toCurrency, symbol } = form;
  if (!/^[a-z]{3}$/i.test(currency)) return null;
  const code = currency.toUpperCase();
  try {
    const fee = new Decimal(form.fee || 0);
    if (["BUY", "SELL"].includes(type)) {
      const units = new Decimal(form.quantity || 0), price = new Decimal(form.price || 0);
      if (!units.gt(0) || !price.gt(0) || !symbol) return null;
      const buying = type === "BUY";
      const cash = units.mul(price).mul(buying ? -1 : 1).minus(fee);
      return t("custom.effectTrade", {
        units: (buying ? "+" : "−") + units.toFixed(), symbol: symbol.toUpperCase(),
        cash: code + " " + cash.toFixed(),
      });
    }
    const amount = new Decimal(form.amount || 0);
    if (!amount.gt(0)) return null;
    if (type === "FX_CONVERSION") {
      const received = new Decimal(form.toAmount || 0);
      if (!received.gt(0) || !/^[a-z]{3}$/i.test(toCurrency) || toCurrency.toUpperCase() === code) return null;
      return t("custom.effectFx", {
        sold: code + " " + amount.plus(fee).toFixed(),
        received: toCurrency.toUpperCase() + " " + received.toFixed(),
      });
    }
    const sign = ["WITHDRAWAL", "TRANSFER_OUT", "FEE", "TAX"].includes(type) ? "−" : "+";
    return t("custom.effectCash", { cash: sign + code + " " + amount.toFixed() });
  } catch {
    return null;
  }
}

export function CustomManualEntry({ d, account, type, close, run, onSaved }) {
  const { t, typeLabel } = useI18n();
  const [form, setForm] = useState({ type, date: d.date, currency: account.currency, symbol: "", kind: "EQUITY" });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const generated = useRef(null);
  const trade = ["BUY", "SELL"].includes(form.type);
  const dividend = form.type === "DIVIDEND";
  const fx = form.type === "FX_CONVERSION";
  const listing = trade || (dividend && form.linkDividend);
  const effect = entryEffect(form, t);

  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      await run(async () => {
        const { type, date, currency, note, reference } = form;
        generated.current ??= crypto.randomUUID();
        const result = await api.manual({
          account: account.id, type, date, currency, note, reference: reference?.trim() || generated.current,
          ...(listing ? { assetId: form.assetId, symbol: form.symbol, mic: form.mic } : {}),
          ...(trade && (!form.assetId || form.assetId === "new") ? { kind: form.kind, name: form.name } : {}),
          ...(trade ? { quantity: form.quantity, price: form.price, fee: form.fee } : { amount: form.amount }),
          ...(type.startsWith("TRANSFER_") ? { group: form.group } : {}),
          ...(fx ? { toCurrency: form.toCurrency, toAmount: form.toAmount, fee: form.fee } : {}),
        });
        if (result.field) {
          setError(result);
          return;
        }
        onSaved();
        return t("imports.entryBooked");
      });
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  const fields = [
    ["date", "imports.field.date", "date"],
    ...(!listing ? [["currency", fx ? "custom.fromCurrency" : "imports.field.currency", "text"]] : []),
    ...(trade ? [["quantity", "imports.field.qty", "number"], ["price", "imports.field.price", "number"]]
      : [["amount", fx ? "custom.soldAmount" : "imports.field.amount", "number"]]),
    ...(fx ? [["toCurrency", "custom.toCurrency", "text"], ["toAmount", "custom.toAmount", "number"]] : []),
    ...(trade || fx ? [["fee", "imports.field.fee", "number", true]] : []),
    ...(form.type.startsWith("TRANSFER_") ? [["group", "imports.field.transferGroup", "text", true]] : []),
    ["reference", "custom.optionalReference", "text", true],
    ["note", "imports.field.note", "text", true],
  ];
  const columnName = { price: "unit_price", reference: "record_id", group: "transfer_group", toCurrency: "to_currency", toAmount: "to_amount" };
  return (
    <Modal title={t("imports.manualModalTitle")} close={() => { if (!lock.current) close(); }}>
      <form className="imp" onSubmit={save}>
        <p>{t("custom.destination", { name: account.name })}</p>
        <div className="fg">
          <Field label={t("imports.field.type")}>
            <select aria-label={t("imports.field.type")} value={form.type} onChange={(event) => {
              setError(null);
              setForm({ ...form, type: event.target.value, assetId: "", symbol: "", mic: "",
                linkDividend: false, kind: "EQUITY", currency: account.currency });
            }}>
              {[...Object.keys(types), "FX_CONVERSION"].map((key) => <option key={key} value={key}>{typeLabel(key)}</option>)}
            </select>
          </Field>
          {dividend && (
            <button type="button" className="lnk" onClick={() => {
              setError(null);
              setForm({ ...form, linkDividend: !listing, symbol: "", mic: "", assetId: "", currency: account.currency });
            }}>{t(listing ? "custom.unlinkDividend" : "imports.linkDividend")}</button>
          )}
          {listing && <SecurityFields d={d} form={form} setForm={(next) => {
            setError(null);
            setForm(next);
          }} stockAndEtfOnly existingOnly={dividend} error={error} />}
          {fields.map(([key, label, inputType, optional]) => {
            const message = error?.field === (columnName[key] || key) ? error.message : "";
            return (
              <Field key={key} label={t(label)}>
                <input type={inputType} aria-label={t(label)} step={inputType === "number" ? "any" : undefined}
                  required={!optional} maxLength={["currency", "toCurrency"].includes(key) ? 3 : undefined}
                  aria-invalid={message ? true : undefined} aria-describedby={message ? "custom-entry-error-" + key : undefined}
                  value={form[key] ?? ""} onChange={(event) => {
                    setError(null);
                    setForm({ ...form, [key]: event.target.value });
                  }} />
                {message && <small className="error-text" role="alert" id={"custom-entry-error-" + key}>{message}</small>}
              </Field>
            );
          })}
        </div>
        {effect && <p className="cap" role="status">{effect}</p>}
        <div className="acts">
          <button type="submit" className="btn pri" disabled={saving}>{t("imports.confirmBookTo", { account: account.name })}</button>
          <button type="button" className="btn" disabled={saving} onClick={close}>{t("app.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}
