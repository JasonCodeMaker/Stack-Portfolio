import React, { useLayoutEffect, useRef } from "react";
import { AssetComposition, CloseDrivers } from "./asset-information";

// Keep the native chart, metrics and drill-downs mounted while trying a different
// reading order. The marker returns each element to its owner on unmount.
function NativePart({ node }) {
  const slot = useRef(null);
  useLayoutEffect(() => {
    const marker = document.createComment("original overview position");
    node.before(marker);
    slot.current.append(node);
    return () => marker.replaceWith(node);
  }, [node]);
  return <div className="d02-native-part" ref={slot}/>;
}

export function dailyParts(layout) {
  const [total, holdingGain, periodGain, rate, flow] = layout.querySelectorAll(".kpis > .kpi");
  return {
    total, holdingGain, periodGain, rate, flow,
    accounts: layout.querySelector(".overview-accounts"),
    holdings: layout.querySelector(".top-holdings"),
    trend: layout.querySelector(".overview-trend"),
    breakdown: layout.querySelector(".overview-breakdown"),
    fx: layout.querySelector(".overview-fx"),
  };
}

export function DailyGroups({ d, parts }) {
  return <div className="d02-groups">
    <section className="card d02-group d02-assets" aria-label="账户资产">
      <div className="d02-balance-summary">
        <NativePart node={parts.total}/>
        <AssetComposition d={d} onDetails={() => parts.total.click()}/>
      </div>
      <NativePart node={parts.trend}/>
      <NativePart node={parts.accounts}/>
    </section>
    <section className="card d02-group d02-positions" aria-label="持仓表现">
      <header className="d02-group-head"><h2>持仓表现</h2><NativePart node={parts.holdingGain}/></header>
      <CloseDrivers today={d.today}/>
      <NativePart node={parts.holdings}/>
    </section>
    <section className="card d02-group d02-period" aria-label="期间表现">
      <header className="d02-group-head"><h2>期间表现</h2></header>
      <div className="d02-period-metrics">
        <NativePart node={parts.periodGain}/><NativePart node={parts.rate}/><NativePart node={parts.flow}/>
      </div>
      <div className="d02-period-details"><NativePart node={parts.breakdown}/><NativePart node={parts.fx}/></div>
    </section>
  </div>;
}
