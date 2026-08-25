import css from "./styles.css?inline";

export function installStyles(document: Document): () => void {
  const existing = document.querySelector("style[data-portfolio-xray]");
  if (existing) return () => undefined;
  const style = document.createElement("style");
  style.dataset.portfolioXray = "true";
  style.textContent = css;
  document.head.appendChild(style);
  return () => style.remove();
}
