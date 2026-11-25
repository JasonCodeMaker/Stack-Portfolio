import React from "react";
import { aud, Delta, fmt, Modal, pct, signedAud } from "./common";
const brisbaneClose = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Australia/Brisbane", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export const closeTimeLabel = (at, day) => at == null ? day : brisbaneClose.format(at);

export function RecentCloseDates({ closes }) {
  return closes?.map(({ market, day, at }) => (
    <small className="close-badge" key={at} title={"布里斯班时间 · 按当前持仓和现金计算 · 交易所交易日 " + day}>
      {market === "ASX" ? "澳股" : "美股"} {closeTimeLabel(at, day)}
    </small>
  ));
}

export function quoteStatus(q) {
  if (!q) return "暂无报价";
  if (q.status === "close") return closeTimeLabel(q.closedAt, q.day) + " 已收盘";
  if (q.status === "awaiting-close") return "收盘价待发布";
  if (q.status === "uncovered") return "未接入行情";
  if (q.status === "old") return "上次收盘 " + closeTimeLabel(q.closedAt, q.day);
  return "行情可用";
}

export function quoteDetails(q) {
  if (!q) return "暂无报价";
  return [quoteStatus(q), q.closedAt != null && "交易所交易日 " + q.day, q.source].filter(Boolean).join(" · ");
}

const rateText = (q) => q ? "1 USD = " + fmt(q.price, 4) + " AUD" : "USD/AUD 待补";
export function FxCard({ fx, periodGain, span, open }) {
  return (
    <section className="card overview-fx" aria-label="汇率影响">
      <div className="row"><h2>汇率影响</h2><span className="sp" />
        <button type="button" className="overview-all" onClick={open}>分账户明细 ›</button>
      </div>
      <div className="fx-head">
        <div><span className="cap">{span}汇率盈亏</span><strong><Delta amount={periodGain} /></strong></div>
        <div><span className="cap" title={fx.periodEnd?.day}>{rateText(fx.periodEnd)}</span>
          <b><Delta rate={fx.periodRateChange} /> <small className="cap">（{span}）</small></b></div>
      </div>
      <div className="fx-boxes">
        <div><span className="cap">最近收盘汇率变动</span><b><Delta amount={fx.impact} rate={fx.rateChange} /></b></div>
        <div><span className="cap">美元净敞口（{pct(fx.exposureShare)}）</span>
          <b>{fx.exposureUsd == null ? "待补" : "US$ " + fmt(fx.exposureUsd, 2)}</b>
          <span className="cap">±1% 敏感度 {fx.sensitivity == null ? "待补" : "±" + aud(fx.sensitivity, 2)}</span></div>
      </div>
    </section>
  );
}

export function FxPanel({ fx, periodGain, close }) {
  return (
    <Modal title="汇率影响" close={close} wide>
      <section className="fx-panel">
        <div className="row">
          <b>{rateText(fx.quote)}</b>
          <Delta rate={fx.rateChange} />
          {fx.quote && <span className="cap">{fx.quote.day} 日汇率 · {fx.quote.source}</span>}
        </div>
        <h3>各账户折算影响</h3>
        <p className="cap">{fx.baseline ?
          "上一笔日汇率 " + fx.baseline.day + " · " + rateText(fx.baseline) + " · 按当前美元持仓和现金计算" :
          "上一笔日汇率待补"}</p>
        <div className="fx-table">
          <table>
            <thead><tr><th>账户</th><th>美元持仓</th><th>美元现金</th><th>最近收盘折算影响</th><th>期间汇率盈亏</th></tr></thead>
            <tbody>
              {fx.accounts.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  <td>{row.holdings == null ? "待补" : "US$ " + fmt(row.holdings, 2)}</td>
                  <td>{row.cash == null ? "待补" : "US$ " + fmt(row.cash, 2)}</td>
                  <td>{signedAud(row.impact)}</td><td>{signedAud(row.periodGain)}</td>
                </tr>
              ))}
              {Math.abs(fx.periodDifference ?? 0) >= 0.005 && <tr>
                <th scope="row" colSpan={4} title="包括账户间跨日划转在途期间的汇率变动">组合与分账户归因差额</th>
                <td>{signedAud(fx.periodDifference)}</td>
              </tr>}
            </tbody>
            <tfoot><tr><th scope="row" colSpan={3}>所选账户合计</th><td>{signedAud(fx.impact)}</td><td>{signedAud(periodGain)}</td></tr></tfoot>
          </table>
        </div>
      </section>
    </Modal>
  );
}
