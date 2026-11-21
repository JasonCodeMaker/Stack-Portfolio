// PROTOTYPE harness entry: mounts the variants inside a Wealthfolio-like shell with fixture data.
import { createRoot } from "react-dom/client";
import { PageScrollContainer } from "@wealthfolio/ui";
import { installStyles } from "@/styles";
import { AllocationPrototype } from "../AllocationPrototype";
import { fixture } from "./fixture";

installStyles(document);

const stub = (label: string) => async (...args: unknown[]) => { console.info(`[prototype] ${label}`, ...args); };

const nav = ["Dashboard", "Holdings", "Performance", "Income", "Activities", "Allocation", "Settings"];

function Shell(): JSX.Element {
  return <div className="flex h-screen w-full overflow-hidden bg-background">
    <aside className="hidden w-[200px] shrink-0 flex-col gap-1 border-r border-border bg-sidebar px-3 py-5 md:flex">
      <div className="mb-5 flex items-center gap-2 px-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">W</span>Wealthfolio</div>
      {nav.map((item) => <div key={item} className={`rounded-md px-3 py-2 text-sm ${item === "Allocation" ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground"}`}>{item}</div>)}
    </aside>
    <PageScrollContainer>
      <AllocationPrototype
        {...fixture}
        onSaveRebalance={stub("save targets")}
        onSaveAccountSelection={stub("save accounts")}
        onRefresh={stub("refresh")}
        onRefreshEtf={stub("refresh ETF")}
      />
    </PageScrollContainer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Shell />);
