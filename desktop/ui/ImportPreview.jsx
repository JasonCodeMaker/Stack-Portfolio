import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n.jsx";

const brokerNames = { ibkr: "IBKR", webull: "Webull AU" };
// Status tone; colours new (gain), corrected (warn) and linked (secondary).
const statusTones = {
  update: "fix",
  new: "new",
  void: "fix",
  link: "dup",
  evidence: "dup",
  review: "fix",
};
const number = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 20 });
const money = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 20 });

function formatted(value, format, currency, t, typeLabel) {
  if (value == null || value === "") return t("preview.missingValue");
  if (format === "type") return typeLabel(value);
  if (format === "money")
    return currency === "AUD" ? "A$" + money.format(value) : money.format(value) + " " + (currency || "");
  if (format === "price") return [currency, number.format(value)].filter(Boolean).join(" ");
  if (format === "quantity" || format === "rate") return number.format(value);
  return String(value);
}

function rowType(r, t, typeLabel) {
  if (r.exchange && r.type === "TRANSFER_IN") return t("type.FX_IN");
  if (r.exchange && r.type === "TRANSFER_OUT") return t("type.FX_OUT");
  return typeLabel(r.type);
}

function activityValue(r, t, typeLabel) {
  if (r.quantity != null && r.unitPrice != null)
    return number.format(r.quantity) + " × " + formatted(r.unitPrice, "price", r.currency, t, typeLabel);
  if (r.quantity != null && r.symbol) return t("preview.unitsCount", { count: number.format(r.quantity) });
  return r.amount == null ? "—" : formatted(r.amount, "money", r.currency, t, typeLabel);
}

function Difference({ edit }) {
  const { t, typeLabel } = useI18n();
  return (
    <span className="diff">
      <span>{edit.label}</span>{" "}
      {edit.before == null ? (
        <small className="cap">{t("preview.newRecord")}</small>
      ) : (
        <>
          <s>{formatted(edit.before, edit.format, edit.oldCurrency || edit.currency, t, typeLabel)}</s>{" "}
          <span aria-label={t("preview.changedToAria")}>→</span>
        </>
      )}{" "}
      <b>{formatted(edit.after, edit.format, edit.currency, t, typeLabel)}</b>
    </span>
  );
}

function ActivityChanges({ rows, done }) {
  const { t, typeLabel } = useI18n();
  const [limit, setLimit] = useState(15);
  const sorted = React.useMemo(() => {
    const order = Object.keys(statusTones);
    return [...rows].sort(
      (a, b) =>
        order.indexOf(a.status) - order.indexOf(b.status) ||
        String(b.date || "").localeCompare(String(a.date || "")),
    );
  }, [rows]);
  return (
    <>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{t("preview.col.change")}</th>
              <th className="l">{t("preview.col.date")}</th>
              <th className="l">{t("preview.col.activity")}</th>
              <th className="l">{t("preview.col.detail")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r, i) => (
              <tr key={i}>
                <td className={"st " + statusTones[r.status]}>
                  {t(`preview.status.${r.status}${done ? "Done" : ""}`)}
                </td>
                <td className="l">
                  {String(r.date || "—").slice(0, 10)}
                  {r.line && <small>{t("preview.fileLine", { line: r.line })}</small>}
                </td>
                <td className="l">
                  {rowType(r, t, typeLabel)} {r.symbol}
                </td>
                <td className="l wrap">
                  {r.edits?.length
                    ? r.edits.map((e) => <Difference key={e.label} edit={e} />)
                    : r.status === "link"
                      ? t("preview.linkVoucher")
                      : activityValue(r, t, typeLabel)}
                  {r.status === "new" && Number(r.fee) > 0 && (
                    <small>{t("preview.feeDetail", { value: formatted(r.fee, "money", r.currency, t, typeLabel) })}</small>
                  )}
                  {r.status === "new" && Number(r.tax) > 0 && (
                    <small>{t("preview.taxDetail", { value: formatted(r.tax, "money", r.currency, t, typeLabel) })}</small>
                  )}
                  {r.reason && <small>{r.reason}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <button type="button" className="lnk cap more" onClick={() => setLimit(limit + 15)}>
          {t("preview.showMoreRows", { count: Math.min(15, sorted.length - limit) })}
        </button>
      )}
    </>
  );
}

function AccountChanges({ report, rows, edits, name, reconcile, done }) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(12);
  const broker = brokerNames[report.broker];
  return (
    <article className="changes" aria-label={t("preview.accountChangesAria", { broker })}>
      {name && name.toLowerCase() !== broker.toLowerCase() && (
        <div className="cap">{t("preview.targetAccountInline", { name })}</div>
      )}
      {rows.length > 0 && <ActivityChanges rows={rows} done={done} />}
      {edits.length > 0 && (
        <>
          <div className="sub">
            {t("preview.accountEditsTitle")}{report.statement?.date && <span className="cap">{report.statement.date}</span>}
          </div>
          <div className="diffs">
            {edits.slice(0, limit).map((edit, i) => (
              <Difference key={i} edit={edit} />
            ))}
          </div>
          {edits.length > limit && (
            <button type="button" className="lnk cap more" onClick={() => setLimit(limit + 12)}>
              {t("preview.showMoreEdits", { count: Math.min(12, edits.length - limit) })}
            </button>
          )}
        </>
      )}
      {done && (
        <button type="button" className="lnk next" onClick={() => reconcile(report)}>
          {t("preview.goReconcile")}
        </button>
      )}
    </article>
  );
}

function changedReports(result) {
  const out = [];
  for (const report of result.reports || [result]) {
    const rows = report.rows.filter((r) => r.status in statusTones);
    const edits = [...report.amountEdits];
    for (const quote of report.priceEdits) {
      if (
        !edits.some(
          (e) => e.label === quote.label && e.currency === quote.currency && Number(e.after) === Number(quote.after),
        )
      )
        edits.push(quote);
    }
    if (rows.length || edits.length) out.push({ report, rows, edits });
  }
  return out;
}

function impact(changed, done, t) {
  if (!changed.length) return { title: t("preview.noChanges") };
  const rows = changed.flatMap((r) => r.rows);
  const count = (status) => rows.filter((r) => r.status === status).length;
  const actions = [];
  for (const status of ["update", "new", "void", "link", "evidence"]) {
    const n = count(status);
    if (n) actions.push(t(`preview.action.${status}`, { count: n }));
  }
  const fields = changed.reduce((n, r) => n + r.edits.length, 0);
  if (fields) actions.push(t("preview.action.fields", { count: fields }));
  const pending = count("review");
  const button =
    actions.length === 0
      ? t("preview.btn.saveReview")
      : actions.length === 1 && count("new") && !pending
        ? t("preview.btn.confirmNew", { count: count("new") })
        : t("preview.btn.confirmAll");
  const title = actions.length
    ? t(done ? "preview.title.done" : "preview.title.will", { actions: actions.join(t("common.comma")) })
    : t("preview.title.pendingOnly", { count: pending });
  const note = pending
    ? (actions.length ? t("preview.note.pendingPrefix", { count: pending }) : "") + t("preview.note.pendingSuffix")
    : "";
  return { title, button, note };
}

export function ImportPreview({ result, done, accounts, confirm, close, reconcile }) {
  const { t } = useI18n();
  const panel = useRef(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    // With two brokers previewed at once, only the first takes focus.
    if (document.querySelector(".imp-preview") === panel.current) panel.current.focus({ preventScroll: true });
  }, []);
  const changed = changedReports(result);
  const priceWarnings = [...new Set((result.reports || [result]).flatMap((r) => r.priceWarnings || []))];
  const { title, button, note } = impact(changed, done, t);
  const webullFundsIncomplete = !done && !changed.length &&
    (result.reports || [result]).some((report) => report.webullFundsStatus && report.webullFundsStatus !== "loaded");
  return (
    <section ref={panel} tabIndex={-1} className="imp-preview" aria-label={done ? t("preview.titleDone") : t("preview.titlePreview")}>
      <div className="impact">
        <div className="what">
          <h3>{result.choices?.length ? t("preview.choicesFirst", { count: result.choices.length })
            : webullFundsIncomplete ? t("preview.webullFundsIncomplete") : title}</h3>
          {note && <p>{note}</p>}
          {priceWarnings.map((warning) => (
            <p key={warning}>{t("preview.warningSuffix", { warning })}</p>
          ))}
        </div>
        {!done && button && (
          <button
            type="button"
            className="btn pri"
            disabled={saving || !!result.choices?.length}
            onClick={async () => {
              setSaving(true);
              try {
                await confirm();
              } finally {
                setSaving(false);
              }
            }}
          >
            {button}
          </button>
        )}
        <button type="button" className="btn" onClick={close}>
          {done ? t("preview.btn.closeResult") : button ? t("preview.btn.cancelPreview") : t("preview.btn.closePreview")}
        </button>
      </div>
      {changed.map(({ report, rows, edits }) => (
        <AccountChanges
          key={report.account}
          report={report}
          rows={rows}
          edits={edits}
          name={accounts.find((a) => a.id === report.account)?.name}
          done={done}
          reconcile={reconcile}
        />
      ))}
    </section>
  );
}

// One broker's sync in its own card: reading, failed (retry this broker alone) or its preview / result.
// `children` goes above the preview (listing choices to settle first).
export function BrokerResult({ report: r, accounts, onConfirm, onClose, onRetry, onConnect, onReconcile, children }) {
  const { t } = useI18n();
  const ready = !r.loading && !r.error;
  return (
    <section className="card broker" aria-label={t("preview.cardAria", { broker: r.broker.toUpperCase() })}>
      <div className="row">
        <h2>{brokerNames[r.broker]}</h2>
        {ready && <span className="tag">{r.done ? t("preview.titleDone") : t("preview.titlePreview")}</span>}
      </div>
      {r.loading ? (
        <p role="status" className="cap">
          {t("preview.loadingBroker")}
        </p>
      ) : r.error ? (
        <div className="notice">
          <span>{r.error}</span>
          <span className="sp" />
          <button type="button" className="btn sm" onClick={onRetry}>
            {t("preview.retryBroker")}
          </button>
          {onConnect && (
            <button type="button" className="btn sm" onClick={onConnect}>
              {t("preview.connectBroker")}
            </button>
          )}
        </div>
      ) : (
        <>
          {children}
          <ImportPreview
            key={r.token || "saved"}
            result={r}
            done={!!r.done}
            accounts={accounts}
            confirm={onConfirm}
            close={onClose}
            reconcile={onReconcile}
          />
        </>
      )}
    </section>
  );
}
