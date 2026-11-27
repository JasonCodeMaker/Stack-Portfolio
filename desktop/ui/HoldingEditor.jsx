import React, { useState } from "react";
import { AccountSelect, api, Field, kind, Modal, num } from "./common";
import { useI18n } from "./i18n.jsx";

export const marketNames = {
  XASX: "澳大利亚 ASX",
  XNAS: "美国 Nasdaq",
  XNYS: "美国 NYSE",
  ARCX: "美国 NYSE Arca",
  BATS: "美国 Cboe",
};
export const listingLabel = (a, marketLabel, pending = "上市地待补") =>
  [a.name || a.symbol, (marketLabel ? marketLabel(a.mic) : marketNames[a.mic] || a.mic || pending), a.currency].join(" · ");

export function SecurityFields({ d, form, setForm, stockAndEtfOnly = false, existingOnly = false, error }) {
  const { t, marketLabel } = useI18n();
  const symbol = (form.symbol || "").trim().toUpperCase();
  const candidates = d.listings.filter((a) => a.symbol.toUpperCase() === symbol);
  const selected = candidates.find((a) => a.id === form.assetId);
  const errorFor = (field) => error?.field === field && (
    <small className="error-text" role="alert">{error.message}</small>
  );
  return (
    <>
      <Field label={t("editor.symbol")}>
        <input
          required
          value={form.symbol}
          onChange={(e) => {
            const symbol = e.target.value.toUpperCase();
            const found = d.listings.filter((a) => a.symbol.toUpperCase() === symbol.trim());
            const only = found.length === 1 ? found[0] : null;
            setForm({
              ...form,
              symbol,
              assetId: only?.id || "",
              mic: only?.mic || "",
              currency: only?.currency || form.currency,
              name: only?.name || "",
              ...(stockAndEtfOnly ? { kind: only?.kind || "EQUITY" } : {}),
            });
          }}
        />
        {errorFor("symbol")}
      </Field>
      {candidates.length > 0 && (
        <Field label={t("editor.listing")}>
          <select
            required
            aria-label={t("editor.listing")}
            value={form.assetId || ""}
            onChange={(e) => {
              const a = candidates.find((v) => v.id === e.target.value);
              setForm({
                ...form,
                assetId: e.target.value,
                mic: a?.mic || "",
                name: a?.name || "",
                currency: a?.currency || form.currency,
                ...(stockAndEtfOnly ? { kind: a?.kind || "EQUITY" } : {}),
              });
            }}
          >
            <option value="">{t("editor.selectListing")}</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {listingLabel(a, marketLabel)}
              </option>
            ))}
            {!existingOnly && <option value="new">{t("editor.addListing")}</option>}
          </select>
        </Field>
      )}
      {selected && errorFor("asset_kind")}
      {!selected && (!existingOnly || !stockAndEtfOnly) && (
        <>
          <Field label={t("editor.tradeCurrency")}>
            <input
              required
              maxLength={3}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            />
            {errorFor("currency")}
          </Field>
          <Field label={t("editor.exchangeMarket")}>
            <input
              list="holding-markets"
              placeholder={t("editor.exchangePlaceholder")}
              value={form.mic}
              required={stockAndEtfOnly || form.assetId === "new"}
              onChange={(e) => setForm({ ...form, mic: e.target.value.toUpperCase() })}
            />
            <datalist id="holding-markets">
              {Object.keys(marketNames).map((mic) => (
                <option key={mic} value={mic}>
                  {marketLabel(mic)}
                </option>
              ))}
            </datalist>
            {errorFor("mic")}
          </Field>
          <Field label={t("editor.securityNameOpt")}>
            <input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t("editor.securityType")}>
            <select
              aria-label={t("editor.securityType")}
              value={form.kind || "EQUITY"}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="EQUITY">{t("editor.type.EQUITY")}</option>
              <option value="ETF">{t("editor.type.ETF")}</option>
              {!stockAndEtfOnly && <>
                <option value="BOND">{t("editor.type.BOND")}</option>
                <option value="UNKNOWN">{t("editor.type.UNKNOWN")}</option>
              </>}
            </select>
            {errorFor("asset_kind")}
          </Field>
        </>
      )}
    </>
  );
}

export function HoldingEditor({ d, run, action, row, account, close }) {
  const { t, kindLabel } = useI18n();
  const [form, setForm] = useState({
    account: row?.accountId || account || d.selected[0] || d.accounts.find((a) => a.active)?.id || "",
    date: d.date,
    quantity: row?.rawQuantity || "",
    symbol: row?.ticker || "",
    assetId: row?.assetId || "",
    currency: row?.localCurrency || "AUD",
    mic: row?.mic || "",
    reference: "",
    price: "",
    localCost: "",
    audCost: "",
    type: row?.type || "stock",
  });
  const [saving, setSaving] = useState(false);
  const field = (key, label, type = "text", required = true) => (
    <Field label={label}>
      <input
        type={type}
        step="any"
        min={type === "number" ? 0 : undefined}
        required={required}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );
  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const ok = await run(async () => {
      if (action === "price")
        await api.savePrice({ assetId: row.assetId, date: form.date, price: form.price });
      else if (action === "fx")
        await api.savePrice({ from: row.localCurrency, date: form.date, price: form.price });
      else if (action === "type")
        await api.allocationSettings({
          ...d.settings,
          typeOverrides: { ...d.settings.typeOverrides, [row.assetId]: form.type },
        });
      else await api.recordHolding({
        ...form,
        audCost: form.currency === "AUD" ? "" : form.audCost,
        costOnly: action === "cost",
      });
      return true;
    }, t("app.saved"));
    setSaving(false);
    if (ok) close(true);
  }
  return (
    <Modal title={t(`editor.title.${action}`) + (row ? " · " + row.ticker : "")} close={() => close(false)}>
      {row && (
        <p className="muted">
          {t("editor.summaryMeta", { account: row.accountName, name: row.name, qty: num(row.quantity) })}
        </p>
      )}
      <form onSubmit={save}>
        <div className="form-grid">
          {!row && (
            <Field label={t("editor.recordAccount")}>
              <AccountSelect data={d} value={form.account} set={(account) => setForm({ ...form, account })} />
            </Field>
          )}
          {action !== "type" &&
            (action === "cost" ? (
              <Field label={t("editor.costReceiptDate")}>
                <input type="date" readOnly value={form.date} />
              </Field>
            ) : (
              field("date", t("editor.recordDate"), "date")
            ))}
          {action === "position" && (
            <>
              <SecurityFields d={d} form={form} setForm={setForm} />
              {field("quantity", t("editor.qtyAsOfDate"), "number")}
            </>
          )}
          {action === "price" && field("price", t("editor.unitPrice", { currency: row.localCurrency }), "number")}
          {action === "fx" && field("price", t("editor.fxUnits", { currency: row.localCurrency }), "number")}
          {action === "type" && (
            <Field label={t("editor.securityType")}>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.keys(kind)
                  .filter((k) => k !== "cash")
                  .map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {["position", "cost"].includes(action) && (
            <>
              {field(
                "localCost",
                t("editor.totalCostLocal", {
                  currency: form.currency,
                  optional: action === "position" ? t("editor.optionalComma") : "",
                }),
                "number",
                action === "cost" && (form.currency === "AUD" || !form.audCost),
              )}
              {form.currency !== "AUD" && (
                <details>
                  <summary>{t("editor.recordHistoricalAud")}</summary>
                  {field("audCost", t("editor.historicalAudAmount"), "number", false)}
                  <small>{t("editor.historicalAudHint", { currency: form.currency })}</small>
                </details>
              )}
              {field("reference", t("editor.evidenceRef"))}
            </>
          )}
        </div>
        <div className="actions">
          <button className="primary" disabled={saving}>
            {action === "position" ? t("editor.saveHolding") : t("app.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
