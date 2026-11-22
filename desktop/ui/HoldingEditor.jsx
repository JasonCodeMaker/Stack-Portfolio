import React, { useState } from "react";
import { AccountSelect, api, Field, kind, Modal, num } from "./common";

export const marketNames = {
  XASX: "澳大利亚 ASX",
  XNAS: "美国 Nasdaq",
  XNYS: "美国 NYSE",
  ARCX: "美国 NYSE Arca",
  BATS: "美国 Cboe",
};
export const listingLabel = (a) =>
  [a.name || a.symbol, marketNames[a.mic] || a.mic || "上市地待补", a.currency].join(" · ");

export function SecurityFields({ d, form, setForm }) {
  const symbol = (form.symbol || "").trim().toUpperCase();
  const candidates = d.listings.filter((a) => a.symbol.toUpperCase() === symbol);
  const selected = candidates.find((a) => a.id === form.assetId);
  return (
    <>
      <Field label="证券代码">
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
            });
          }}
        />
      </Field>
      {candidates.length > 0 && (
        <Field label="上市证券">
          <select
            required
            value={form.assetId || ""}
            onChange={(e) => {
              const a = candidates.find((v) => v.id === e.target.value);
              setForm({
                ...form,
                assetId: e.target.value,
                mic: a?.mic || "",
                name: a?.name || "",
                currency: a?.currency || form.currency,
              });
            }}
          >
            <option value="">选择上市证券</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {listingLabel(a)}
              </option>
            ))}
            <option value="new">添加另一个上市证券</option>
          </select>
        </Field>
      )}
      {!selected && (
        <>
          <Field label="交易币种">
            <input
              required
              maxLength={3}
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="上市市场">
            <input
              list="holding-markets"
              placeholder="选择市场或输入交易所代码"
              value={form.mic}
              required={form.assetId === "new"}
              onChange={(e) => setForm({ ...form, mic: e.target.value.toUpperCase() })}
            />
            <datalist id="holding-markets">
              {Object.entries(marketNames).map(([mic, label]) => (
                <option key={mic} value={mic}>
                  {label}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="证券名称（可选）">
            <input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="证券类别">
            <select
              value={form.kind || "EQUITY"}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="EQUITY">股票</option>
              <option value="ETF">ETF</option>
              <option value="BOND">债券</option>
              <option value="UNKNOWN">待分类</option>
            </select>
          </Field>
        </>
      )}
    </>
  );
}

const titles = { position: "补持仓", cost: "补成本", price: "补报价", fx: "补汇率", type: "更正证券类别" };
export function HoldingEditor({ d, run, action, row, account, close }) {
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
    }, "已保存");
    setSaving(false);
    if (ok) close(true);
  }
  return (
    <Modal title={titles[action] + (row ? " · " + row.ticker : "")} close={() => close(false)}>
      {row && (
        <p className="muted">
          {row.accountName} · {row.name} · {num(row.quantity)} 股／份
        </p>
      )}
      <form onSubmit={save}>
        <div className="form-grid">
          {!row && (
            <Field label="记录所属账户">
              <AccountSelect data={d} value={form.account} set={(account) => setForm({ ...form, account })} />
            </Field>
          )}
          {action !== "type" &&
            (action === "cost" ? (
              <Field label="成本凭据日期">
                <input type="date" readOnly value={form.date} />
              </Field>
            ) : (
              field("date", "记录日期", "date")
            ))}
          {action === "position" && (
            <>
              <SecurityFields d={d} form={form} setForm={setForm} />
              {field("quantity", "截至该日的股数或份额", "number")}
            </>
          )}
          {action === "price" && field("price", "每股／份报价（" + row.localCurrency + "）", "number")}
          {action === "fx" && field("price", "1 " + row.localCurrency + " 等于多少 AUD", "number")}
          {action === "type" && (
            <Field label="证券类别">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(kind)
                  .filter(([k]) => k !== "cash")
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {["position", "cost"].includes(action) && (
            <>
              {field("localCost", "这些股数的总买入成本（" + form.currency + "，含买入费用" +
                (action === "position" ? "，可留空" : "") + "）", "number",
                action === "cost" && (form.currency === "AUD" || !form.audCost))}
              {form.currency !== "AUD" && (
                <details>
                  <summary>记录历史澳元成本（可选）</summary>
                  {field("audCost", "凭据中的历史金额（AUD）", "number", false)}
                  <small>估值日的持仓成本按上方的 {form.currency} 总买入成本折算。</small>
                </details>
              )}
              {field("reference", "凭据（如券商结单日期或编号）")}
            </>
          )}
        </div>
        <div className="actions">
          <button className="primary" disabled={saving}>
            保存{action === "position" ? "持仓" : ""}
          </button>
        </div>
      </form>
    </Modal>
  );
}
