// Adaptive app shell (spec §2.2, §3): sidebar, fixed page head, scrolling content area, content grid,
// docked inspector or dialog, and the main chart height. Layout rules live in layout.js.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { Modal } from "./common";
import { arrangeGrid, gridColumns, mainChartHeight, shellTier, stepRow } from "./layout.js";

// Six pages in two groups (分析 | 维护), in the order the questions narrow down.
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

const ShellContext = createContext({ tier: "regular", short: false, cols: 1, shell: null });
// { tier: "compact" | "regular" | "wide", short, cols: 1 | 2 | 3 }
export const useShell = () => useContext(ShellContext);

function useViewportTier() {
  const [view, setView] = useState(() => shellTier(innerWidth, innerHeight));
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
    document.documentElement.dataset.tier = view.tier;
    document.documentElement.dataset.short = view.short ? "1" : "0";
  }, [view]);
  return view;
}

export function Shell({ page, onPage, ledger, onLedger, titleExtra, filters, children }) {
  const view = useViewportTier();
  const [shell, setShell] = useState(null),
    [cols, setCols] = useState(1),
    pane = useRef(null);
  useLayoutEffect(() => {
    const el = pane.current,
      measure = () => setCols(gridColumns(el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Each page opens at the top.
  useLayoutEffect(() => {
    pane.current.scrollTo(0, 0);
  }, [page]);
  const nav = ([id, label]) => (
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
  const book = ledger.demo ? "示例账本" : "本地账本";
  return (
    <ShellContext.Provider value={{ ...view, cols, shell }}>
      <div className="shell" ref={setShell}>
        <nav className="side" aria-label="页面">
          <div className="brand">
            <Mark />
            <div>
              Stock<small>Portfolio</small>
            </div>
          </div>
          {pageGroups[0].map(nav)}
          <hr />
          {pageGroups[1].map(nav)}
          <button type="button" className="ledger" aria-label={"切换账本 · " + book} onClick={onLedger}>
            <span className="av">
              <Icon name="ledger" size={16} />
            </span>
            <span className="tx">
              {book}
              <small>{ledger.accounts} 个账户</small>
            </span>
            {ledger.demo && <span className="demo">示例</span>}
          </button>
        </nav>
        <div className="work">
          <header className="head">
            <h1>{pageTitles[page]}</h1>
            {titleExtra}
            <span className="sp" />
            {filters && <div className="header-tools">{filters}</div>}
          </header>
          <main className="pane" ref={pane} data-cols={cols}>
            <div className="page">{children}</div>
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
export function Detail({ title, onClose, wide, children }) {
  const { tier, shell } = useShell();
  if (tier === "wide" && shell)
    return createPortal(
      <Inspector title={title} onClose={onClose}>
        {children}
      </Inspector>,
      shell,
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
        <button type="button" className="btn" aria-label="关闭" onClick={onClose}>
          ✕
        </button>
      </header>
      {children}
    </aside>
  );
}

// ↑↓ in a table moves the selected row. Spread the handler on the element holding the rows and mark each
// row with data-row={id}; focus follows the selection so the docked inspector keeps updating.
export function useRowKeys(ids, selected, onSelect) {
  return useCallback(
    (e) => {
      if (e.target.closest("input, select, textarea")) return;
      const focused = e.target.closest("[data-row]")?.dataset.row;
      const current = ids.includes(selected) ? selected : focused;
      if (current == null) return;
      const next = stepRow(ids, current, e.key);
      if (next === undefined) return;
      e.preventDefault();
      if (next === selected) return;
      onSelect(next);
      const row = e.currentTarget.querySelector(`[data-row="${CSS.escape(next)}"]`);
      (row?.querySelector("button, a[href], [tabindex]") || row)?.focus();
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
