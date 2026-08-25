import type { ReactNode } from "react";
import type { PortfolioAccount } from "@/types/domain";

export type PageId = "overview" | "holdings" | "xray" | "etf-data" | "settings";

const pages: Array<{ id: PageId; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◈" },
  { id: "holdings", label: "Holdings", icon: "▤" },
  { id: "xray", label: "X-Ray", icon: "⌁" },
  { id: "etf-data", label: "ETF Data", icon: "◫" },
];

export function AppLayout({ page, onPageChange, accounts, children }: { page: PageId; onPageChange: (page: PageId) => void; accounts: PortfolioAccount[]; children: ReactNode }): JSX.Element {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">X</div><div><strong>Portfolio X-Ray</strong><span>Wealthfolio addon</span></div></div>
      <nav className="main-nav" aria-label="Portfolio X-Ray pages">
        {pages.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? "nav-active" : ""}`} onClick={() => onPageChange(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <button className={`nav-item ${page === "settings" ? "nav-active" : ""}`} onClick={() => onPageChange("settings")}><span className="nav-icon">⚙</span>Settings</button>
        <div className="account-summary"><span className="eyebrow">Included accounts</span><strong>{accounts.length}</strong><span>{accounts.length === 1 ? "account selected" : "accounts selected"}</span></div>
        <div className="local-first"><span className="pulse-dot" />Local-first data</div>
      </div>
    </aside>
    <main className="main-content">{children}</main>
  </div>;
}
