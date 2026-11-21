import type { AddonContext, AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { BrokerSyncApp } from "@/BrokerSyncApp";
import { installStyles } from "@/styles";

export const enable: AddonEnableFunction = (ctx: AddonContext) => {
  const removeStyles = installStyles(ctx.ui.root.ownerDocument);
  ctx.router.add({
    id: "broker-sync",
    path: "",
    component: () => <BrokerSyncApp ctx={ctx} />,
  });
  return { disable: removeStyles };
};

export default enable;
