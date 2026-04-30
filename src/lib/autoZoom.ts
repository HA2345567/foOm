import type {
  ClickEvent,
  ScrollEvent,
  PauseEvent,
} from "../hooks/useScreenRecording";

export interface ZoomKeyframe {
  /** seconds */
  t: number;
  /** scale factor (1 = no zoom, <1 would be wide but we clamp at 1) */
  scale: number;
  /** focus point normalized 0..1 */
  x: number;
  y: number;
}

export interface ZoomConfig {
  /** zoom-in scale on click (default 1.7) */
  clickScale?: number;
  /** soft zoom scale during long pauses (default 1.25) */
  pauseScale?: number;
  /** scale during active scrolling — kept at 1 (wide) */
  scrollScale?: number;
  /** seconds before click to start zoom */
  preRoll?: number;
  /** seconds to hold zoom after click */
  hold?: number;
  /** minimum pause duration (s) to trigger soft zoom */
  pauseThreshold?: number;
}

/**
 * Generate cinematic zoom keyframes from captured events.
 *
 * Behavior:
 *  - **Click** → snap-zoom in (preRoll s before click) to focus point, hold, ease out
 *  - **Scroll** → force wide (scale=1) for the duration of the scroll burst
 *  - **Pause** (idle ≥ threshold) → soft zoom (1.25x) toward last click area
 *
 * Conflicts: scroll always wins (wide) > click zoom > pause soft-zoom > default wide.
 */
export function generateZoomKeyframes(
  clicks: ClickEvent[],
  duration: number,
  opts: ZoomConfig & {
    scrolls?: ScrollEvent[];
    pauses?: PauseEvent[];
  } = {},
): ZoomKeyframe[] {
  const clickScale = opts.clickScale ?? 1.7;
  const pauseScale = opts.pauseScale ?? 1.25;
  const scrollScale = opts.scrollScale ?? 1.0;
  const preRoll = opts.preRoll ?? 0.3;
  const hold = opts.hold ?? 1.5;
  const pauseThreshold = opts.pauseThreshold ?? 2.5;
  const scrolls = opts.scrolls ?? [];
  const pauses = opts.pauses ?? [];

  type Segment = {
    start: number;
    end: number;
    scale: number;
    x: number;
    y: number;
    /** higher priority overrides lower when overlapping */
    priority: number;
    /** 'snap' uses fast ease-in/out; 'soft' uses gentle ease */
    style: "snap" | "soft" | "wide";
  };

  const segments: Segment[] = [];

  // 1) Click groups → snap zoom moments
  const groups: { start: number; end: number; x: number; y: number }[] = [];
  for (const c of clicks) {
    const last = groups[groups.length - 1];
    if (
      last &&
      c.t - last.end < hold &&
      Math.hypot(c.x - last.x, c.y - last.y) < 0.18
    ) {
      last.end = c.t;
      // average focal point
      last.x = (last.x + c.x) / 2;
      last.y = (last.y + c.y) / 2;
    } else {
      groups.push({ start: c.t, end: c.t, x: c.x, y: c.y });
    }
  }
  for (const g of groups) {
    segments.push({
      start: Math.max(0, g.start - preRoll),
      end: Math.min(duration, g.end + hold),
      scale: clickScale,
      x: g.x,
      y: g.y,
      priority: 2,
      style: "snap",
    });
  }

  // 2) Pauses (≥ threshold) with no overlapping scroll/click → soft zoom
  // Soft zoom focuses on most recent click point, or screen center if none.
  for (const p of pauses) {
    if (p.duration < pauseThreshold) continue;
    // find most recent click before this pause
    let focus = { x: 0.5, y: 0.5 };
    for (let i = clicks.length - 1; i >= 0; i--) {
      if (clicks[i].t <= p.t) {
        focus = { x: clicks[i].x, y: clicks[i].y };
        break;
      }
    }
    segments.push({
      start: p.t + 0.4, // small delay so we don't fight a click's hold
      end: p.t + p.duration - 0.2,
      scale: pauseScale,
      x: focus.x,
      y: focus.y,
      priority: 1,
      style: "soft",
    });
  }

  // 3) Scrolls → wide. Group consecutive scroll events within 0.6s.
  const scrollBursts: { start: number; end: number }[] = [];
  for (const s of scrolls) {
    const last = scrollBursts[scrollBursts.length - 1];
    if (last && s.t - last.end < 0.6) {
      last.end = s.t;
    } else {
      scrollBursts.push({ start: s.t, end: s.t });
    }
  }
  for (const b of scrollBursts) {
    segments.push({
      start: Math.max(0, b.start - 0.2),
      end: Math.min(duration, b.end + 0.8),
      scale: scrollScale,
      x: 0.5,
      y: 0.5,
      priority: 3, // highest — scroll always wins
      style: "wide",
    });
  }

  // Resolve into a flat keyframe timeline.
  // Sample at 0.1s steps, picking highest-priority segment active at each tick,
  // then collapse runs of equal targets into keyframes.
  const STEP = 0.1;
  const samples: ZoomKeyframe[] = [];
  for (let t = 0; t <= duration; t += STEP) {
    let chosen: Segment | null = null;
    for (const seg of segments) {
      if (t >= seg.start && t <= seg.end) {
        if (!chosen || seg.priority > chosen.priority) chosen = seg;
      }
    }
    if (chosen) {
      samples.push({ t, scale: chosen.scale, x: chosen.x, y: chosen.y });
    } else {
      samples.push({ t, scale: 1, x: 0.5, y: 0.5 });
    }
  }

  // Compress: keep only points where target meaningfully changes
  const keyframes: ZoomKeyframe[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const prev = keyframes[keyframes.length - 1];
    if (
      !prev ||
      Math.abs(prev.scale - s.scale) > 0.01 ||
      Math.abs(prev.x - s.x) > 0.01 ||
      Math.abs(prev.y - s.y) > 0.01
    ) {
      keyframes.push(s);
    }
  }
  // Always anchor start and end at wide
  if (keyframes[0].t > 0) {
    keyframes.unshift({ t: 0, scale: 1, x: 0.5, y: 0.5 });
  }
  const lastKf = keyframes[keyframes.length - 1];
  if (lastKf.t < duration) {
    keyframes.push({ t: duration, scale: 1, x: 0.5, y: 0.5 });
  }
  return keyframes;
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
