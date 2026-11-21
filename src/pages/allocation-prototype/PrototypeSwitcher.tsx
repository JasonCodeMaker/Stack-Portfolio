// PROTOTYPE — floating variant switcher. Never rendered in production builds.
import { useEffect } from "react";

export interface PrototypeVariant {
  key: string;
  name: string;
}

export function readVariant(keys: string[], fallback: string): string {
  const value = new URLSearchParams(window.location.search).get("variant");
  return value && keys.includes(value) ? value : fallback;
}

export function PrototypeSwitcher({ variants, current, onChange }: { variants: PrototypeVariant[]; current: string; onChange: (key: string) => void }): JSX.Element | null {
  const index = Math.max(0, variants.findIndex((variant) => variant.key === current));
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length].key;
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
    onChange(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;
  const variant = variants[index];
  return <div className="proto-switcher" role="toolbar" aria-label="Prototype variant switcher">
    <button type="button" onClick={() => go(-1)} aria-label="Previous variant">←</button>
    <span><b>{variant.key}</b> — {variant.name}<small>{index + 1} / {variants.length}</small></span>
    <button type="button" onClick={() => go(1)} aria-label="Next variant">→</button>
  </div>;
}
