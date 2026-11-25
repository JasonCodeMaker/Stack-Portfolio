import React, { useId, useState } from "react";
import { Modal, aud, pct, signedAud } from "@desktop/ui/common";

const digits = value => Math.round(value * 100) % 100 === 0 ? 0 : 2;
const amount = value => aud(value, digits(value));

export function CashLine({ valuation }) {
  const { cash, total } = valuation;
  if (!Number.isFinite(cash)) return <span className="d02-cash">现金余额待核实</span>;
  return <span className="d02-cash">
    其中现金 <b>{amount(cash)}</b>{total > 0 && <span>（{pct(cash / total)}）</span>}
  </span>;
}

// The demo uses historical closes. Only name drivers when the dated breakdown
// reconciles to that close. Keep opposite-signed contributions visible together.
export function closeDrivers(today) {
  if (!Number.isFinite(today?.change) || !today.securities?.length) return [];
  const rows = today.securities;
  if (rows.some(row => !Number.isFinite(row.change) || row.key === "unreconciled")) return [];
  const sum = rows.reduce((total, row) => total + row.change, 0);
  if (Math.abs(sum - today.change) >= 0.005) return [];
  const ranked = [...rows].sort((a, b) => b.change - a.change);
  const positive = ranked[0], negative = ranked[ranked.length - 1];
  return [positive.change >= 0.005 && positive, negative.change <= -0.005 && negative]
    .filter(Boolean).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

export function DriverLine({ drivers }) {
  return <span className="d02-driver">
    其中 {drivers.map(row => row.label + " " + signedAud(row.change, digits(row.change))).join("，")}
  </span>;
}

export function CompanyExposure({ d, scope, close }) {
  const selectId = useId();
  const companies = d.exposure.rows.filter(row => row.type === "stock");
  const [key, choose] = useState(companies[0]?.key);
  const company = companies.find(row => row.key === key);
  const other = d.exposure.rows.filter(row => row.type !== "stock" && row.type !== "cash")
    .reduce((total, row) => total + row.viaEtfsAud, 0);
  const unpriced = d.rows.filter(row => row.type !== "cash" && row.audValue == null).map(row => row.ticker);
  return <Modal title="公司敞口" close={close} wide>
    <div className="d02-company">
      <p className="cap">{scope} · {d.date} · AUD</p>
      {company ? <>
        <div className="d02-company-picker"><label htmlFor={selectId}>公司</label>
          <select id={selectId} value={key} onChange={e => choose(e.target.value)}>
            {companies.map(row => <option key={row.key} value={row.key}>{row.label}（{row.ticker}）</option>)}
          </select>
        </div>
        <div className="d02-company-total"><span>已识别敞口</span>
          <strong>{amount(company.totalAud)}</strong>
          {d.valuation.total > 0 && <span>占总资产 {pct(company.totalAud / d.valuation.total)}</span>}
        </div>
        <table aria-label="公司敞口来源">
          <thead><tr><th>持有方式</th><th>账户</th><th>金额（AUD）</th></tr></thead>
          <tbody>{company.sources.map((source, index) => <tr key={index}>
            <td>{source.kind === "direct" ? "直接持有" : "通过 " + source.etfSymbol}</td>
            <td>{source.accountName}</td><td>{amount(source.amountAud)}</td>
          </tr>)}</tbody>
        </table>
      </> : <p>当前账户没有可识别的公司持仓。</p>}
      {other > 0 && <p className="cap">ETF 中另有 {amount(other)} 的成分未逐家公司列示。</p>}
      {unpriced.length > 0 && <p className="cap">{unpriced.join("、")} 缺报价，此处仅列可计价的持有部分。</p>}
    </div>
  </Modal>;
}
