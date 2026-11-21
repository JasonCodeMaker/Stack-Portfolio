// PROTOTYPE — "What should the Allocation page look like?"
// Three structurally different layouts of the Allocation page (plus today's page as a
// baseline), switchable via `?variant=` and the floating bottom bar. Run: `npm run prototype`.
// Throwaway: once a layout wins, rewrite it properly in PortfolioInsightsPage and delete
// this folder from main.
import { useEffect, useState } from "react";
import { PortfolioInsightsPage } from "@/pages/PortfolioInsightsPage";
import { PrototypeSwitcher, readVariant } from "./PrototypeSwitcher";
import type { AllocationPageProps } from "./shared";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";
import css from "./prototype.css?inline";

const VARIANTS = [
  { key: "A", name: "Guided scroll", Component: VariantA },
  { key: "B", name: "Workspace tabs", Component: VariantB },
  { key: "C", name: "Answers first", Component: VariantC },
  { key: "current", name: "Current page (baseline)", Component: PortfolioInsightsPage },
];

export function AllocationPrototype(props: AllocationPageProps): JSX.Element {
  const [variant, setVariant] = useState(() => readVariant(VARIANTS.map((item) => item.key), "A"));
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.allocationPrototype = "true";
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const Active = (VARIANTS.find((item) => item.key === variant) ?? VARIANTS[0]).Component;
  return <>
    <Active key={variant} {...props} />
    <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={setVariant} />
  </>;
}
