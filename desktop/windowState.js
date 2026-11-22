// Where the main window opens: the default size on first launch, the last position after that.
export const minimumSize = { width: 1024, height: 640 };
const defaultSize = { width: 1440, height: 900 };

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

const intersects = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const isBounds = (b) => !!b && ["x", "y", "width", "height"].every((k) => Number.isFinite(b[k]));

export function initialWindow(saved, displays, primary) {
  if (isBounds(saved?.bounds) && displays.some((d) => intersects(saved.bounds, d.workArea)))
    return { bounds: saved.bounds, maximized: saved.maximized === true };
  return { bounds: centred(primary.workArea), maximized: false };
}
