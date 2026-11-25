import React from "react";
import { aud, Delta, fmt, Modal, pct, signedAud } from "./common";
import { tMain, useI18n } from "./i18n.jsx";

const formatters = new Map();
function brisbaneFormatter(intlLocale = "zh-CN") {
  if (!formatters.has(intlLocale)) {
    formatters.set(
      intlLocale,
      new Intl.DateTimeFormat(intlLocale, {
        timeZone: "Australia/Brisbane",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    );
  }
  return formatters.get(intlLocale);
}
export const closeTimeLabel = (at, day, intlLocale = "zh-CN") =>
  at == null ? day : brisbaneFormatter(intlLocale).format(at);

export function RecentCloseDates({ closes }) {
  const { t, intlLocale } = useI18n();
  return closes?.map(({ market, day, at }) => (
    <small className="close-badge" key={at} title={t("quote.closeTooltip", { day })}>
      {market === "ASX" ? t("quote.asx") : t("quote.us")} {closeTimeLabel(at, day, intlLocale)}
    </small>
  ));
}

export function quoteStatus(q, t = tMain, intlLocale = "zh-CN") {
  if (!q) return t("quote.none");
  if (q.status === "close") return t("quote.closed", { time: closeTimeLabel(q.closedAt, q.day, intlLocale) });
  if (q.status === "awaiting-close") return t("quote.awaitingClose");
  if (q.status === "uncovered") return t("quote.uncovered");
  if (q.status === "old") return t("quote.old", { time: closeTimeLabel(q.closedAt, q.day, intlLocale) });
  return t("quote.available");
}

export function quoteDetails(q, t = tMain, intlLocale = "zh-CN", sourceLabel = (s) => s) {
  if (!q) return t("quote.none");
  return [
    quoteStatus(q, t, intlLocale),
    q.closedAt != null && t("quote.exchangeDay", { day: q.day }),
    sourceLabel(q.source),
  ]
    .filter(Boolean)
    .join(t("common.middot"));
}

const rateText = (q, t) => (q ? t("fx.rateText", { price: fmt(q.price, 4) }) : t("fx.ratePending"));
export function FxCard({ fx, periodGain, span, open }) {
  const { t } = useI18n();
  return (
    <section className="card overview-fx" aria-label={t("fx.cardTitle")}>
      <div className="row"><h2>{t("fx.cardTitle")}</h2><span className="sp" />
        <button type="button" className="overview-all" onClick={open}>{t("fx.byAccountBtn")}</button>
      </div>
      <div className="fx-head">
        <div><span className="cap">{t("fx.periodGain", { span })}</span><strong><Delta amount={periodGain} /></strong></div>
        <div><span className="cap" title={fx.periodEnd?.day}>{rateText(fx.periodEnd, t)}</span>
          <b><Delta rate={fx.periodRateChange} /> <small className="cap">{t("common.openParen")}{span}{t("common.closeParen")}</small></b></div>
      </div>
      <div className="fx-boxes">
        <div><span className="cap">{t("fx.recentMove")}</span><b><Delta amount={fx.impact} rate={fx.rateChange} /></b></div>
        <div><span className="cap">{t("fx.netUsdExposure", { pct: pct(fx.exposureShare) })}</span>
          <b>{fx.exposureUsd == null ? t("common.pending") : "US$ " + fmt(fx.exposureUsd, 2)}</b>
          <span className="cap">{t("fx.sensitivity", { value: fx.sensitivity == null ? t("common.pending") : "±" + aud(fx.sensitivity, 2) })}</span></div>
      </div>
    </section>
  );
}

export function FxPanel({ fx, periodGain, close }) {
  const { t, sourceLabel } = useI18n();
  return (
    <Modal title={t("fx.cardTitle")} close={close} wide>
      <section className="fx-panel">
        <div className="row">
          <b>{rateText(fx.quote, t)}</b>
          <Delta rate={fx.rateChange} />
          {fx.quote && <span className="cap">{t("fx.dayRate", { day: fx.quote.day, source: sourceLabel(fx.quote.source) })}</span>}
        </div>
        <h3>{t("fx.accountTranslation")}</h3>
        <p className="cap">{fx.baseline ?
          t("fx.priorRate", { day: fx.baseline.day, rate: rateText(fx.baseline, t) }) :
          t("fx.priorRatePending")}</p>
        <div className="fx-table">
          <table>
            <thead>
              <tr>
                <th>{t("fx.col.account")}</th>
                <th>{t("fx.col.usdHoldings")}</th>
                <th>{t("fx.col.usdCash")}</th>
                <th>{t("fx.col.recentImpact")}</th>
                <th>{t("fx.col.periodGain")}</th>
              </tr>
            </thead>
            <tbody>
              {fx.accounts.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  <td>{row.holdings == null ? t("common.pending") : "US$ " + fmt(row.holdings, 2)}</td>
                  <td>{row.cash == null ? t("common.pending") : "US$ " + fmt(row.cash, 2)}</td>
                  <td>{signedAud(row.impact)}</td><td>{signedAud(row.periodGain)}</td>
                </tr>
              ))}
              {Math.abs(fx.periodDifference ?? 0) >= 0.005 && <tr>
                <th scope="row" colSpan={4} title={t("fx.transitDiffTitle")}>{t("fx.transitDiff")}</th>
                <td>{signedAud(fx.periodDifference)}</td>
              </tr>}
            </tbody>
            <tfoot><tr><th scope="row" colSpan={3}>{t("fx.selectedTotal")}</th><td>{signedAud(fx.impact)}</td><td>{signedAud(periodGain)}</td></tr></tfoot>
          </table>
        </div>
      </section>
    </Modal>
  );
}
