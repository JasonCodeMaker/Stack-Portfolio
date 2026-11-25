// The Codex carousel supplies its own navigation. Add navigation only in the standalone document.
(() => {
  const root = document.getElementById("portfolio-overview-comparison");
  root.setAttribute("data-standalone", "");
  const screens = [...root.querySelectorAll("[data-variant]")];
  const nav = document.createElement("nav");
  nav.id = "d02-views";
  nav.setAttribute("aria-label", "对照布局");
  for (const section of screens) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.dataset.variant;
    button.setAttribute("aria-pressed", String(!section.hidden));
    button.onclick = () => {
      for (const [i, other] of screens.entries()) {
        other.hidden = other !== section;
        nav.children[i].setAttribute("aria-pressed", String(other === section));
      }
    };
    nav.append(button);
  }
  root.prepend(nav);
})();
