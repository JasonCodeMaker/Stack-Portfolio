export const REF_CANVAS = {
  "16:9": { width: 1600, height: 900 },
  "21:9": { width: 2100, height: 900 },
};
export const USER_SCALE_LIMITS = { min: 0.85, max: 1.30, step: 0.05, default: 1 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeUserScale(value) {
  const { min, max, step, default: fallback } = USER_SCALE_LIMITS;
  if (!Number.isFinite(value)) return fallback;
  return Number((Math.round(clamp(value, min, max) / step) * step).toFixed(2));
}

export function resolveAspect(dipWidth, dipHeight, currentAspect) {
  const ratio = dipWidth / Math.max(1, dipHeight);
  if (currentAspect === "16:9") return ratio >= 2.15 ? "21:9" : "16:9";
  if (currentAspect === "21:9") return ratio <= 2.05 ? "16:9" : "21:9";
  return ratio >= 2.10 ? "21:9" : "16:9";
}

export function computeDisplayState({ dipWidth, dipHeight, currentAspect, userScaleMultiplier }) {
  const aspect = resolveAspect(dipWidth, dipHeight, currentAspect);
  const { width: virtualWidth, height: virtualHeight } = REF_CANVAS[aspect];
  const baseZoom = Math.min(dipWidth / virtualWidth, dipHeight / virtualHeight);
  const multiplier = normalizeUserScale(userScaleMultiplier);
  const step = 0.02;
  const quantized = Number((Math.round(clamp(baseZoom * multiplier, 0.70, 2.50) / step) * step).toFixed(2));
  return {
    aspect,
    zoomFactor: Math.abs(quantized - 1) <= 0.03 ? 1 : quantized,
    baseZoom,
    userScaleMultiplier: multiplier,
    aspectRatio: dipWidth / Math.max(1, dipHeight),
    virtualWidth,
    virtualHeight,
  };
}
