import type { ClickEvent, ScrollEvent, PauseEvent } from "../hooks/useScreenRecording";

export interface ZoomKeyframe {
  /** seconds */
  t: number;
  /** scale factor (1 = no zoom) */
  scale: number;
  /** focus point normalized 0..1 */
  x: number;
  y: number;
}

export interface ZoomConfig {
  /** zoom-in scale on click — pros prefer subtle (default 1.5) */
  clickScale?: number;
  /** soft zoom scale during long pauses (default 1.2) */
  pauseScale?: number;
  /** scale during active scrolling — kept at 1 (wide) */
  scrollScale?: number;
  /** seconds of ease-in BEFORE click lands — long for cinematic feel */
  preRoll?: number;
  /** seconds to hold zoom after click before easing back */
  hold?: number;
  /** seconds for ease-out back to wide */
  postRoll?: number;
  /** minimum pause duration (s) to trigger soft zoom */
  pauseThreshold?: number;
  /** merge clicks within this many seconds of each other */
  clickMergeWindow?: number;
  /** merge clicks within this normalized distance */
  clickMergeDistance?: number;
}

/**
 * Generate cinematic zoom keyframes from captured events.
 *
 * Designed for professional output (Screen Studio / Tella style):
 *  - Long, gentle ease-in/ease-out (no snap pops)
 *  - Quintic smoothstep for buttery motion
 *  - Aggressive merging of nearby clicks → one continuous zoom moment
 *  - Smoothing pass kills micro-jitter between targets
 */
export function generateZoomKeyframes(
  clicks: ClickEvent[],
  duration: number,
  opts: ZoomConfig & {
    scrolls?: ScrollEvent[];
    pauses?: PauseEvent[];
  } = {},
): ZoomKeyframe[] {
  const clickScale = opts.clickScale ?? 1.42;
  const pauseScale = opts.pauseScale ?? 1.14;
  const scrollScale = opts.scrollScale ?? 1.0;
  const preRoll = opts.preRoll ?? 1.25;
  const hold = opts.hold ?? 2.25;
  const postRoll = opts.postRoll ?? 1.45;
  const pauseThreshold = opts.pauseThreshold ?? 2.5;
  const mergeWindow = opts.clickMergeWindow ?? 3.2;
  const mergeDist = opts.clickMergeDistance ?? 0.3;
  const scrolls = opts.scrolls ?? [];
  const pauses = opts.pauses ?? [];

  type Segment = {
    /** start of ease-in */
    inStart: number;
    /** time scale reaches full */
    inEnd: number;
    /** time scale starts easing out */
    outStart: number;
    /** time fully back to wide */
    outEnd: number;
    scale: number;
    x: number;
    y: number;
    priority: number;
  };

  const segments: Segment[] = [];

  // 1) Click groups → smooth zoom moments
  const groups: { start: number; end: number; x: number; y: number; n: number }[] = [];
  for (const c of clicks) {
    const last = groups[groups.length - 1];
    if (
      last &&
      c.t - last.end < mergeWindow &&
      Math.hypot(c.x - last.x, c.y - last.y) < mergeDist
    ) {
      last.end = c.t;
      // running average focal point
      last.x = (last.x * last.n + c.x) / (last.n + 1);
      last.y = (last.y * last.n + c.y) / (last.n + 1);
      last.n += 1;
    } else {
      groups.push({ start: c.t, end: c.t, x: c.x, y: c.y, n: 1 });
    }
  }
  for (const g of groups) {
    const inStart = Math.max(0, g.start - preRoll);
    const inEnd = g.start;
    const outStart = Math.min(duration, g.end + hold);
    const outEnd = Math.min(duration, outStart + postRoll);
    segments.push({
      inStart,
      inEnd,
      outStart,
      outEnd,
      scale: clickScale,
      x: g.x,
      y: g.y,
      priority: 2,
    });
  }

  // 2) Pauses → soft zoom toward last click
  for (const p of pauses) {
    if (p.duration < pauseThreshold) continue;
    let focus = { x: 0.5, y: 0.5 };
    for (let i = clicks.length - 1; i >= 0; i--) {
      if (clicks[i].t <= p.t) {
        focus = { x: clicks[i].x, y: clicks[i].y };
        break;
      }
    }
    const inStart = p.t + 0.6;
    const inEnd = inStart + 1.15;
    const outStart = p.t + p.duration - 1.1;
    const outEnd = p.t + p.duration;
    if (inEnd >= outStart) continue;
    segments.push({
      inStart,
      inEnd,
      outStart,
      outEnd,
      scale: pauseScale,
      x: focus.x,
      y: focus.y,
      priority: 1,
    });
  }

  // 3) Scrolls → gentle wide
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
    const inStart = Math.max(0, b.start - 0.8);
    const inEnd = inStart + 0.9;
    const outStart = Math.min(duration, b.end + 1.0);
    const outEnd = Math.min(duration, outStart + 0.9);
    segments.push({
      inStart,
      inEnd,
      outStart,
      outEnd,
      scale: scrollScale,
      x: 0.5,
      y: 0.5,
      priority: 3,
    });
  }

  // Sample at fine resolution. For each tick, pick highest-priority active
  // segment and compute its eased value at that moment (pre-roll/hold/post-roll
  // shape baked in here, so the global interpolator just lerps between samples).
  const STEP = 1 / 60;
  const samples: ZoomKeyframe[] = [];
  for (let t = 0; t <= duration + 1e-6; t += STEP) {
    let chosen: { seg: Segment; weight: number } | null = null;
    for (const seg of segments) {
      if (t < seg.inStart || t > seg.outEnd) continue;
      let w = 0;
      if (t < seg.inEnd) {
        const r = (t - seg.inStart) / Math.max(1e-3, seg.inEnd - seg.inStart);
        w = smoothstep5(r);
      } else if (t < seg.outStart) {
        w = 1;
      } else {
        const r = (t - seg.outStart) / Math.max(1e-3, seg.outEnd - seg.outStart);
        w = 1 - smoothstep5(r);
      }
      if (!chosen || seg.priority > chosen.seg.priority) {
        chosen = { seg, weight: w };
      }
    }
    if (chosen) {
      const { seg, weight } = chosen;
      samples.push({
        t,
        scale: 1 + (seg.scale - 1) * weight,
        x: 0.5 + (seg.x - 0.5) * weight,
        y: 0.5 + (seg.y - 0.5) * weight,
      });
    } else {
      samples.push({ t, scale: 1, x: 0.5, y: 0.5 });
    }
  }

  // Smoothing pass (9-tap gaussian-like moving average) to remove fast
  // acceleration spikes while preserving intentional focus changes.
  const smoothed: ZoomKeyframe[] = samples.map((s, i) => {
    const weights = [1, 2, 3, 4, 5, 4, 3, 2, 1];
    let total = 0;
    let scale = 0;
    let x = 0;
    let y = 0;
    for (let o = -4; o <= 4; o++) {
      const weight = weights[o + 4];
      const sample = samples[Math.max(0, Math.min(samples.length - 1, i + o))];
      total += weight;
      scale += sample.scale * weight;
      x += sample.x * weight;
      y += sample.y * weight;
    }
    return {
      t: s.t,
      scale: scale / total,
      x: x / total,
      y: y / total,
    };
  });

  // Compress: drop near-duplicate samples to keep the keyframe array small.
  const keyframes: ZoomKeyframe[] = [];
  for (const s of smoothed) {
    const prev = keyframes[keyframes.length - 1];
    if (
      !prev ||
      Math.abs(prev.scale - s.scale) > 0.0015 ||
      Math.abs(prev.x - s.x) > 0.0015 ||
      Math.abs(prev.y - s.y) > 0.0015
    ) {
      keyframes.push(s);
    }
  }
  if (keyframes.length === 0 || keyframes[0].t > 0) {
    keyframes.unshift({ t: 0, scale: 1, x: 0.5, y: 0.5 });
  }
  const lastKf = keyframes[keyframes.length - 1];
  if (lastKf.t < duration) {
    keyframes.push({ t: duration, scale: 1, x: 0.5, y: 0.5 });
  }
  return keyframes;
}

/** Quintic smoothstep — silkier than cubic, used by pro motion tools. */
function smoothstep5(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function interpolateZoom(keyframes: ZoomKeyframe[], t: number): ZoomKeyframe {
  if (t <= keyframes[0].t) return keyframes[0];
  // binary search for speed on long timelines
  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keyframes[lo];
  const b = keyframes[hi];
  if (t >= b.t) return b;
  const span = b.t - a.t || 1;
  const r = (t - a.t) / span;
  // linear lerp here — easing is already baked into the dense sample grid
  return {
    t,
    scale: a.scale + (b.scale - a.scale) * r,
    x: a.x + (b.x - a.x) * r,
    y: a.y + (b.y - a.y) * r,
  };
}
