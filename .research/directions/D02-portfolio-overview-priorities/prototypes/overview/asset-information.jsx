import React from "react";
import { aud, pct, signedAud } from "@desktop/ui/common";

const digits = value => Math.round(value * 100) % 100 === 0 ? 0 : 2;
const amount = value => Number.isFinite(value) ? aud(value, digits(value)) : "待估值";

export function AssetComposition({ d, onDetails }) {
  const { cash, total } = d.valuation;
  const missingPrice = d.securities == null;
  const priced = d.rows.filter(row => row.type !== "cash" && Number.isFinite(row.audValue));
  const securities = missingPrice && priced.length ? priced.reduce((sum, row) => sum + row.audValue, 0) : d.securities;
  const reconciled = total > 0 && Number.isFinite(cash) && Number.isFinite(d.securities)
    && Math.abs(cash + d.securities - total) < 0.005;
  const cashShare = reconciled ? cash / total : null;
  const amounts = [
    { name: "现金", value: cash, share: cashShare },
    { name: missingPrice ? "已计价证券（含 ETF）" : "证券持仓（含 ETF）", value: securities,
      share: reconciled ? securities / total : null },
  ];
  return <section className="d02-composition" aria-label="资产构成">
    <header className="d02-composition-head"><h2>资产构成</h2>
      <button type="button" className="overview-all" onClick={onDetails}>金额明细 ›</button>
    </header>
    <dl>{amounts.map(row => <div key={row.name}>
      <dt>{row.name}</dt>
      <dd><strong>{amount(row.value)}</strong>{row.share != null && <small>{pct(row.share)}</small>}</dd>
    </div>)}</dl>
  </section>;
}

// Match the entire close before naming its contributors, including non-security items.
function rankedContributions(today) {
  const rows = today?.securities;
  if (!Number.isFinite(today?.change) || !rows?.length ||
      rows.some(row => !Number.isFinite(row.change) || row.key === "unreconciled")) return null;
  const sum = rows.reduce((value, row) => value + row.change, 0);
  if (Math.abs(sum - today.change) >= 0.005) return null;
  return rows.filter(row => Math.abs(row.change) >= 0.005)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

export function CloseDrivers({ today }) {
  const rows = rankedContributions(today);
  const peak = Math.abs(rows?.[0]?.change ?? 0);
  const losses = rows?.some(row => row.change < 0);
  const net = Number.isFinite(today?.change) ? signedAud(today.change, digits(today.change)) : "待核对";
  return <details className="d02-close-drivers">
    <summary><span>收盘涨跌来源</span><strong>{net}</strong></summary>
    {today?.previous && today?.date && <small>{today.previous} 至 {today.date}</small>}
    {rows?.length ? <table aria-label="各项对最近收盘变动的贡献"><tbody>
      {rows.map(row => <tr key={row.key}>
        <th scope="row">{row.label}</th>
        <td className="d02-impact-cell" aria-hidden="true"><span className={"d02-impact-track" + (losses ? " split-axis" : "")}>
          <i className={row.change < 0 ? "fall" : "rise"} style={{width:(losses ? 50 : 100) * Math.abs(row.change) / peak + "%"}}/>
        </span></td>
        <td className={"d02-impact-amount " + (row.change < 0 ? "loss" : "gain")}>{signedAud(row.change, digits(row.change))}</td>
      </tr>)}
    </tbody></table> : <p className="cap">{rows ? "各项收盘变动均为零。" : "缺少可核对的收盘数据。"}</p>}
  </details>;
}
