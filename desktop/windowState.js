// Where the main window opens: the default size on first launch, the last position after that.
import { REF_CANVAS } from "./adaptiveLayout.js";

const defaultSize = REF_CANVAS["16:9"];

export function minimumWindowSize(area) {
  return { width: Math.min(920, area.width), height: Math.min(650, area.height) };
}

function centred(area) {
  const width = Math.min(defaultSize.width, area.width),
    height = Math.min(defaultSize.height, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const isBounds = (b) => !!b && ["x", "y", "width", "height"].every((k) => Number.isFinite(b[k]));

export function initialWindow(saved, displays, primary) {
  if (isBounds(saved?.bounds) && saved.bounds.width > 0 && saved.bounds.height > 0) {
    const { bounds } = saved;
    const match = displays.map(({ workArea }) => ({ workArea, area: overlap(bounds, workArea) }))
      .reduce((best, candidate) => candidate.area > best.area ? candidate : best, { area: 0 });
    if (match.area > 0) {
      const area = match.workArea;
      const minimum = minimumWindowSize(area);
      const width = Math.min(Math.max(bounds.width, minimum.width), area.width);
      const height = Math.min(Math.max(bounds.height, minimum.height), area.height);
      return {
        bounds: {
          x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
          y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
          width,
          height,
        },
        maximized: saved.maximized === true,
      };
    }
  }
  return { bounds: centred(primary.workArea), maximized: false };
}
