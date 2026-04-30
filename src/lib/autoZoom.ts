import type { ClickEvent } from "../hooks/useScreenRecording";

export interface ZoomKeyframe {
  /** seconds */
  t: number;
  /** scale factor (1 = no zoom) */
  scale: number;
  /** focus point normalized 0..1 */
  x: number;
  y: number;
}

/**
 * Generate cinematic zoom keyframes from click events.
 * For each click: zoom in (~0.3s before click), hold, zoom out (~1.2s after).
 */
export function generateZoomKeyframes(
  clicks: ClickEvent[],
  duration: number,
  opts: { zoomScale?: number; preRoll?: number; hold?: number } = {},
): ZoomKeyframe[] {
  const zoomScale = opts.zoomScale ?? 1.6;
  const preRoll = opts.preRoll ?? 0.3;
  const hold = opts.hold ?? 1.5;

  const kf: ZoomKeyframe[] = [{ t: 0, scale: 1, x: 0.5, y: 0.5 }];

  // Group nearby clicks (within 1.5s and close in space) into one zoom moment
  const groups: { t: number; x: number; y: number }[] = [];
  for (const c of clicks) {
    const last = groups[groups.length - 1];
    if (
      last &&
      c.t - last.t < hold &&
      Math.hypot(c.x - last.x, c.y - last.y) < 0.15
    ) {
      // extend group
      last.t = c.t;
    } else {
      groups.push({ ...c });
    }
  }

  for (const g of groups) {
    const zoomInStart = Math.max(0, g.t - preRoll - 0.4);
    const zoomInEnd = Math.max(0, g.t - preRoll);
    const zoomOutStart = Math.min(duration, g.t + hold);
    const zoomOutEnd = Math.min(duration, g.t + hold + 0.5);

    kf.push({ t: zoomInStart, scale: 1, x: 0.5, y: 0.5 });
    kf.push({ t: zoomInEnd, scale: zoomScale, x: g.x, y: g.y });
    kf.push({ t: zoomOutStart, scale: zoomScale, x: g.x, y: g.y });
    kf.push({ t: zoomOutEnd, scale: 1, x: 0.5, y: 0.5 });
  }

  kf.push({ t: duration, scale: 1, x: 0.5, y: 0.5 });
  // sort & dedupe by time
  kf.sort((a, b) => a.t - b.t);
  return kf;
}

export function interpolateZoom(
  keyframes: ZoomKeyframe[],
  t: number,
): ZoomKeyframe {
  if (t <= keyframes[0].t) return keyframes[0];
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (t <= b.t) {
      const span = b.t - a.t || 1;
      const raw = (t - a.t) / span;
      // ease in-out cubic
      const e =
        raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      return {
        t,
        scale: a.scale + (b.scale - a.scale) * e,
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e,
      };
    }
  }
  return keyframes[keyframes.length - 1];
}
