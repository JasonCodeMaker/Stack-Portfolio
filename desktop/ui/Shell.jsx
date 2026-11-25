// Adaptive app shell (spec §2.2, §3): sidebar, fixed page head, scrolling content area, content grid,
// docked inspector or dialog, and the main chart height. Layout rules live in layout.js.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { Modal } from "./common";
import { arrangeGrid, mainChartHeight, shellTier, stepRow } from "./layout.js";
import { tMain, useI18n } from "./i18n.jsx";

// Six pages in two groups (analysis | maintenance), in the order the questions narrow down.
export const pageGroups = [
  [
    ["overview", "总览"],
    ["performance", "收益复盘"],
    ["allocation", "配置分析"],
    ["holdings", "持仓"],
  ],
  [
    ["imports", "导入与对账"],
    ["settings", "设置"],
  ],
];
export const pageTitles = Object.fromEntries(pageGroups.flat());

const pageIds = [
  ["overview", "performance", "allocation", "holdings"],
  ["imports", "settings"],
];

const ShellContext = createContext({ aspect: "16:9", tier: "regular", short: false, cols: 1, shell: null });
export const useShell = () => useContext(ShellContext);

function useViewportTier(aspect) {
  const [view, setView] = useState(() => shellTier(innerWidth, innerHeight));
  const tier = aspect === "21:9" ? "wide" : view.tier === "compact" ? "compact" : "regular";
  useLayoutEffect(() => {
    const update = () =>
      setView((old) => {
        const next = shellTier(innerWidth, innerHeight);
        return next.tier === old.tier && next.short === old.short ? old : next;
      });
    addEventListener("resize", update);
    return () => removeEventListener("resize", update);
  }, []);
  useLayoutEffect(() => {
    // On the root so tokens such as the card padding also reach dialogs.
    document.documentElement.dataset.tier = tier;
    document.documentElement.dataset.short = view.short ? "1" : "0";
  }, [tier, view.short]);
  return { tier, short: view.short };
}

export function Shell({ aspect, page, onPage, ledger, onLedger, titleExtra, filters, children }) {
  const { t } = useI18n();
  const view = useViewportTier(aspect);
  const cols = aspect === "21:9" ? 2 : 1;
  const [shell, setShell] = useState(null),
    pane = useRef(null);
  // Each page opens at the top.
  useLayoutEffect(() => {
    pane.current.scrollTo(0, 0);
  }, [page]);
  const nav = (id) => {
    const label = t(`nav.${id}`);
    return (
      <button
        key={id}
        type="button"
        className={"nav-item" + (page === id ? " on" : "")}
        aria-label={label}
        aria-current={page === id ? "page" : undefined}
        onClick={() => onPage(id)}
      >
        <Icon name={id} />
        <span>{label}</span>
      </button>
    );
  };
  const book = ledger.demo ? t("app.demoBook") : t("app.realBook");
  return (
    <ShellContext.Provider value={{ ...view, aspect, cols, shell }}>
      <div className="shell" ref={setShell}>
        <nav className="side" aria-label={t("nav.groupLabel")}>
          <div className="brand">
            <Mark />
            <div>
              Stock<small>Portfolio</small>
            </div>
          </div>
          {pageIds[0].map(nav)}
          <hr />
          {pageIds[1].map(nav)}
          <button
            type="button"
            className="ledger"
            aria-label={t("app.switchBookAria", { book })}
            onClick={onLedger}
          >
            <span className="av">
              <Icon name="ledger" size={16} />
            </span>
            <span className="tx">
              {book}
              <small>{t("app.accountsCount", { count: ledger.accounts })}</small>
            </span>
            {ledger.demo && <span className="demo">{t("app.demoBadge")}</span>}
          </button>
        </nav>
        <div className="work">
          <header className="head">
            <h1>{t(`nav.${page}`)}</h1>
            {titleExtra}
            <span className="sp" />
            {filters && <div className="header-tools">{filters}</div>}
          </header>
          <main className="pane" ref={pane} data-cols={cols}>
            <div className="page" data-page={page}>{children}</div>
          </main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

// layout = { 1: [col], 2: [col, col], 3: [col, col, col] }, panels = { key: <Panel /> }.
// A col lists panel keys; a nested list is a side-by-side pair. See arrangeGrid in layout.js.
export function Grid({ layout, panels }) {
  const { cols } = useShell(),
    { template, columns } = arrangeGrid(layout, cols);
  const panel = (key) => <React.Fragment key={key}>{panels[key]}</React.Fragment>;
  return (
    <div className="cols" style={{ gridTemplateColumns: template }}>
      {columns.map((items, i) => (
        <div className="col" key={i}>
          {items.map((item) =>
            Array.isArray(item) ? (
              <div className="pair" key={item.join("+")}>
                {item.map(panel)}
              </div>
            ) : (
              panel(item)
            ),
          )}
        </div>
      ))}
    </div>
  );
}

// A detail you look at beside the page: docked inspector in the wide tier, a dialog otherwise.
// Forms and confirmations use Modal directly at every tier.
export function Detail({ title, onClose, wide, dock, children }) {
  const { aspect, shell } = useShell();
  const target = dock === undefined ? shell : dock;
  if (aspect === "21:9" && dock === null) return null;
  if (aspect === "21:9" && target)
    return createPortal(
      <Inspector title={title} onClose={onClose}>
        {children}
      </Inspector>,
      target,
    );
  return (
    <Modal title={title} close={onClose} wide={wide}>
      {children}
    </Modal>
  );
}

function Inspector({ title, onClose, children }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e) => {
      // A dialog above the inspector takes Esc first.
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) close.current();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <aside className="insp" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="btn" aria-label={tMain("app.close")} onClick={onClose}>
          ✕
        </button>
      </header>
      {children}
    </aside>
  );
}

// Arrow keys move focus through rows marked with data-row. Supply onSelect when
// the rows select details within the page.
export function useRowKeys(ids, selected, onSelect) {
  return useCallback(
    (e) => {
      if (e.target.closest("input, select, textarea")) return;
      const focused = e.target.closest("[data-row]")?.dataset.row;
      const current = ids.includes(focused) ? focused : ids.includes(selected) ? selected : null;
      if (current == null) return;
      const next = stepRow(ids, current, e.key);
      if (next === undefined) return;
      e.preventDefault();
      if (next !== selected) onSelect?.(next);
      const row = e.currentTarget.querySelector(`[data-row="${CSS.escape(next)}"]`);
      const controls = "button, a[href], [tabindex]";
      const target = row?.matches(controls) ? row : row?.querySelector(controls);
      target?.focus();
    },
    [ids, selected, onSelect],
  );
}

// Main chart height: fills the rest of the first screen, 240–560 unless min/max are given (the treemap uses
// 320/700); `below` keeps room for content under the chart inside the same card.
// const [ref, height] = useMainChartHeight(); <div ref={ref} className="chart" style={{ height }}>…</div>
export function useMainChartHeight({ min, max, below } = {}) {
  const ref = useRef(null),
    [height, setHeight] = useState(min ?? 240);
  useLayoutEffect(() => {
    const el = ref.current,
      host = el?.closest(".pane, .insp, dialog");
    if (!host) return;
    const measure = () => {
      const card = el.closest(".card") || el,
        next = card.nextElementSibling;
      setHeight(
        mainChartHeight({
          paneHeight: host.clientHeight,
          chartTop: el.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop,
          cardPaddingBottom: parseFloat(getComputedStyle(card).paddingBottom) || 0,
          nextHeight: next ? next.getBoundingClientRect().height : undefined,
          below,
          min,
          max,
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(el.closest(".col, .page") || host.firstElementChild || host);
    return () => observer.disconnect();
  }, [min, max, below]);
  return [ref, height];
}
