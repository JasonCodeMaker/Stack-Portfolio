import type { AddonContext, AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { PortfolioXRayApp } from "@/app/PortfolioXRayApp";
import { installStyles } from "@/styles";

export const enable: AddonEnableFunction = (ctx: AddonContext) => {
  const removeStyles = installStyles(ctx.ui.root.ownerDocument);
  ctx.router.add({
    id: "portfolio-xray",
    path: "",
    component: () => <PortfolioXRayApp ctx={ctx} />,
  });
  return { disable: removeStyles };
};

export default enable;
