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
  const tools = document.createElement("button");
  tools.type = "button";
  tools.className = "d02-tools-button";
  tools.textContent = "示例与核对";
  tools.setAttribute("aria-expanded", "false");
  tools.onclick = () => {
    const opened = root.toggleAttribute("data-tools");
    tools.setAttribute("aria-expanded", String(opened));
  };
  nav.append(tools);
  root.prepend(nav);
})();
