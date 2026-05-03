/**
 * autozoom.ts — Butter-Smooth Spring-Physics Zoom Engine
 * ═══════════════════════════════════════════════════════
 *
 * WHY THIS IS DIFFERENT FROM EVERY OTHER APPROACH
 * ────────────────────────────────────────────────
 * Most zoom engines work like this:
 *   segment A ends → hard-cut or lerp to segment B → visible pop/jank
 *
 * This engine works like a camera operator holding a physical lens:
 *   A critically-damped spring continuously chases a "target" zoom state.
 *   The spring has velocity, mass, and damping — it overshoots slightly,
 *   settles organically, and NEVER produces a discontinuous jump no matter
 *   how many triggers fire at once or how fast they change.
 *
 * ARCHITECTURE
 * ────────────
 *   1. Events (clicks, scrolls, pauses, type-bursts) → ZoomIntent queue
 *   2. Intent resolver picks the dominant intent at each moment in time
 *      and produces a smooth TARGET curve  (scale, x, y)  vs time
 *   3. A critically-damped spring simulation runs over that target curve
 *      at 120 Hz — the spring's OUTPUT is what goes into keyframes
 *   4. The keyframe array is compressed (Ramer-Douglas-Peucker) so the
 *      renderer only stores meaningful inflection points, not 120 samples/s
 *
 * RESULT
 * ──────
 *   • Zero hard cuts. Zero linear-lerp kinks. Zero priority-switch pops.
 *   • Zoom-in feels like a camera operator slowly pushing in.
 *   • Zoom-out feels like the lens breathing back naturally.
 *   • Overlapping triggers blend seamlessly — spring velocity carries through.
 *   • Works at 30fps, 60fps, or 120fps render targets identically.
 */

import type {
  ClickEvent,
  ScrollEvent,
  PauseEvent,
} from "../hooks/useScreenRecording";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoomKeyframe {
  /** Playback time in seconds */
  t: number;
  /** Zoom scale — 1.0 = full-width, 2.0 = 2× zoom */
  scale: number;
  /** Horizontal focal point, normalized 0..1 */
  x: number;
  /** Vertical focal point, normalized 0..1 */
  y: number;
  /** Which trigger caused this moment (for editor UI coloring) */
  trigger?: ZoomTriggerKind;
}

export type ZoomTriggerKind =
  | "click"
  | "type_burst"
  | "pause"
  | "scroll_out"
  | "manual";

export interface ZoomConfig {
  /**
   * Motion feel preset — controls spring stiffness + damping globally.
   * "glass"    → ultra-slow, cinematic, almost floating
   * "silk"     → deliberately slow, luxurious — ideal for product demos  (DEFAULT)
   * "snap"     → faster response, still smooth — good for dev tools
   * "custom"   → set springStiffness / springDamping / springMass yourself
   */
  feel?: "glass" | "silk" | "snap" | "custom";

  // ── Spring physics (only used when feel = "custom") ───────────────────────
  /** Spring stiffness k — higher = faster response (default 4 for silk) */
  springStiffness?: number;
  /** Spring damping c — set to 2*sqrt(k*m) for critical damping */
  springDamping?: number;
  /** Spring mass m — higher = more inertia / momentum (default 1) */
  springMass?: number;

  // ── Zoom-in scales ────────────────────────────────────────────────────────
  /** Target scale on click (default 1.55) */
  clickScale?: number;
  /** Target scale during type burst (default 1.35) */
  typeScale?: number;
  /** Target scale during pause (default 1.2) */
  pauseScale?: number;

  // ── Zoom-out ──────────────────────────────────────────────────────────────
  /**
   * Target scale during scroll — 1.0 = return to full wide.
   * Values below 1.0 produce a slight letterbox pull-back. (default 1.0)
   */
  scrollOutScale?: number;

  // ── Timing ────────────────────────────────────────────────────────────────
  /** Seconds to hold at full zoom AFTER a click group ends (default 2.8) */
  hold?: number;
  /** Extra hold added per additional click in a merged group (default 0.25) */
  holdPerClick?: number;
  /** Min pause duration (s) before soft zoom triggers (default 2.0) */
  pauseThreshold?: number;
  /** Min scroll burst length (s) to trigger zoom-out (default 0.25) */
  scrollBurstThreshold?: number;

  // ── Merge windows ─────────────────────────────────────────────────────────
  /** Merge clicks within this many seconds of each other (default 2.0) */
  clickMergeWindow?: number;
  /** Merge clicks within this normalized distance (default 0.18) */
  clickMergeDistance?: number;

  // ── Quality ───────────────────────────────────────────────────────────────
  /**
   * Spring simulation step in seconds.
   * 1/120 = 120 Hz (default) — run at least at 2× your render fps.
   */
  simStep?: number;
  /**
   * RDP simplification epsilon. Lower = more keyframes kept.
   * 0 = keep every sim step (huge array, no need).  (default 0.0008)
   */
  rdpEpsilon?: number;

  // ── Manual overrides ──────────────────────────────────────────────────────
  /** Editor-pinned zoom windows — always override AI */
  forcedZooms?: ForcedZoom[];
  /** Ranges where zoom is completely suppressed */
  blackoutRanges?: TimeRange[];
}

export interface ForcedZoom {
  start: number;
  end: number;
  scale: number;
  x?: number;
  y?: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface TypeBurstEvent {
  t: number;
  duration: number;
  keyCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spring physics feel presets
// ─────────────────────────────────────────────────────────────────────────────

interface SpringParams { k: number; c: number; m: number }

const FEEL_PRESETS: Record<NonNullable<ZoomConfig["feel"]>, SpringParams> = {
  //             stiffness   damping        mass
  glass: { k: 2.25, c: 3.0, m: 1.0 },  // 2√(2.25·1) = 3.0 → ultra-slow cinematic
  silk:  { k: 4.0,  c: 4.0, m: 1.0 },  // 2√(4·1)    = 4.0 → slow professional default
  snap:  { k: 9.0,  c: 6.0, m: 1.0 },  // 2√(9·1)    = 6.0 → responsive but still smooth
  custom:{ k: 4.0,  c: 4.0, m: 1.0 },  // replaced by user values below
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal: ZoomIntent — what the engine "wants" the camera to do at time t
// ─────────────────────────────────────────────────────────────────────────────

interface ZoomIntent {
  /** Start of this intent window */
  start: number;
  /** End of this intent window */
  end: number;
  /** Target scale */
  scale: number;
  /** Target focal X */
  x: number;
  /** Target focal Y */
  y: number;
  /** Priority — higher wins when intents overlap */
  priority: number;
  /** Trigger label */
  trigger: ZoomTriggerKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** At scale S, the viewport covers 1/S of the canvas. Clamp focal so no black. */
function clampFocal(coord: number, scale: number): number {
  if (scale <= 1) return 0.5; // at scale=1 (full-wide) center is always fine
  const half = 0.5 / scale;
  return clamp(coord, half, 1 - half);
}

function isBlackedOut(t: number, ranges: TimeRange[]): boolean {
  for (const r of ranges) if (t >= r.start && t <= r.end) return true;
  return false;
}

/** Merge a sorted {t} array into contiguous bursts separated by gapThreshold */
function mergeBursts(
  events: { t: number }[],
  gapThreshold: number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.t - last.end < gapThreshold) last.end = e.t;
    else out.push({ start: e.t, end: e.t });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ramer-Douglas-Peucker simplification (3D: scale, x, y)
// ─────────────────────────────────────────────────────────────────────────────

function rdpPerpendicularDist(
  p: ZoomKeyframe,
  a: ZoomKeyframe,
  b: ZoomKeyframe,
): number {
  const dt = b.t - a.t;
  if (dt < 1e-12) {
    return Math.sqrt(
      (p.scale - a.scale) ** 2 +
      (p.x - a.x) ** 2 +
      (p.y - a.y) ** 2,
    );
  }
  const u = (p.t - a.t) / dt;
  const proj = {
    scale: a.scale + u * (b.scale - a.scale),
    x: a.x + u * (b.x - a.x),
    y: a.y + u * (b.y - a.y),
  };
  return Math.sqrt(
    (p.scale - proj.scale) ** 2 +
    (p.x - proj.x) ** 2 +
    (p.y - proj.y) ** 2,
  );
}

function rdpSimplify(
  points: ZoomKeyframe[],
  epsilon: number,
  lo: number,
  hi: number,
  keep: Uint8Array,
): void {
  if (hi <= lo + 1) return;
  let maxDist = 0;
  let maxIdx = lo;
  for (let i = lo + 1; i < hi; i++) {
    const d = rdpPerpendicularDist(points[i], points[lo], points[hi]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    keep[maxIdx] = 1;
    rdpSimplify(points, epsilon, lo, maxIdx, keep);
    rdpSimplify(points, epsilon, maxIdx, hi, keep);
  }
}

function simplify(points: ZoomKeyframe[], epsilon: number): ZoomKeyframe[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  rdpSimplify(points, epsilon, 0, points.length - 1, keep);
  return points.filter((_, i) => keep[i] === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Critically-damped spring — the core of butter smoothness
// ─────────────────────────────────────────────────────────────────────────────

interface SpringState {
  p: number;
  v: number;
}

function springStep(
  state: SpringState,
  goal: number,
  k: number,
  c: number,
  m: number,
  dt: number,
): SpringState {
  const w  = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));

  if (Math.abs(zeta - 1) < 1e-4) {
    const x0 = state.p - goal;
    const v0 = state.v;
    const e  = Math.exp(-w * dt);
    const newP = (x0 + (v0 + w * x0) * dt) * e + goal;
    const newV = ((v0 + w * x0) * e - (v0 + w * x0) * w * dt * e) - w * (x0 + (v0 + w * x0) * dt) * e;
    return { p: newP, v: newV };
  }

  if (zeta < 1) {
    const wd  = w * Math.sqrt(1 - zeta * zeta);
    const x0  = state.p - goal;
    const v0  = state.v;
    const e   = Math.exp(-zeta * w * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    const newP = e * (x0 * cos + ((v0 + zeta * w * x0) / wd) * sin) + goal;
    const newV = e * (
      (v0 - zeta * w * x0) * cos - (wd * x0 + (v0 + zeta * w * x0) * zeta / wd * wd) * sin
    );
    return { p: newP, v: newV };
  }

  const r1  = -zeta * w + w * Math.sqrt(zeta * zeta - 1);
  const r2  = -zeta * w - w * Math.sqrt(zeta * zeta - 1);
  const x0  = state.p - goal;
  const v0  = state.v;
  const denom = r1 - r2 || 1e-12;
  const c1  = (v0 - r2 * x0) / denom;
  const c2  = (r1 * x0 - v0) / denom;
  const e1  = Math.exp(r1 * dt);
  const e2  = Math.exp(r2 * dt);
  return {
    p: c1 * e1 + c2 * e2 + goal,
    v: c1 * r1 * e1 + c2 * r2 * e2,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Config resolver
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedConfig {
  spring: SpringParams;
  clickScale: number;
  typeScale: number;
  pauseScale: number;
  scrollOutScale: number;
  hold: number;
  holdPerClick: number;
  pauseThreshold: number;
  scrollBurstThreshold: number;
  clickMergeWindow: number;
  clickMergeDistance: number;
  simStep: number;
  rdpEpsilon: number;
  forcedZooms: ForcedZoom[];
  blackoutRanges: TimeRange[];
}

function resolveConfig(opts: ZoomConfig): ResolvedConfig {
  const feel = opts.feel ?? "silk";
  const baseSpring = FEEL_PRESETS[feel];
  const spring: SpringParams = {
    k: clamp(opts.springStiffness ?? baseSpring.k, 1, 500),
    c: clamp(opts.springDamping   ?? baseSpring.c, 0.1, 200),
    m: clamp(opts.springMass      ?? baseSpring.m, 0.1, 10),
  };
  return {
    spring,
    clickScale:           clamp(opts.clickScale       ?? 1.55, 1, 4),
    typeScale:            clamp(opts.typeScale         ?? 1.35, 1, 3),
    pauseScale:           clamp(opts.pauseScale        ?? 1.2,  1, 2),
    scrollOutScale:       clamp(opts.scrollOutScale    ?? 1.0,  0.5, 1.5),
    hold:                 clamp(opts.hold              ?? 1.8,  0, 15),
    holdPerClick:         clamp(opts.holdPerClick      ?? 0.25, 0, 3),
    pauseThreshold:       clamp(opts.pauseThreshold    ?? 2.0,  0.5, 30),
    scrollBurstThreshold: clamp(opts.scrollBurstThreshold ?? 0.25, 0, 5),
    clickMergeWindow:     clamp(opts.clickMergeWindow  ?? 2.0,  0, 10),
    clickMergeDistance:   clamp(opts.clickMergeDistance ?? 0.18, 0, 1),
    simStep:              clamp(opts.simStep           ?? 1 / 120, 1 / 240, 1 / 30),
    rdpEpsilon:           clamp(opts.rdpEpsilon        ?? 0.0008, 0, 0.1),
    forcedZooms:    opts.forcedZooms    ?? [],
    blackoutRanges: opts.blackoutRanges ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent → Target resolver
// ─────────────────────────────────────────────────────────────────────────────

interface ZoomTarget {
  scale: number;
  x: number;
  y: number;
  trigger: ZoomTriggerKind | undefined;
}

const NEUTRAL: ZoomTarget = { scale: 1, x: 0.5, y: 0.5, trigger: undefined };

function resolveTarget(
  t: number,
  intents: ZoomIntent[],
  blackoutRanges: TimeRange[],
): ZoomTarget {
  if (isBlackedOut(t, blackoutRanges)) return NEUTRAL;

  let best: ZoomIntent | null = null;
  for (const intent of intents) {
    if (t < intent.start || t > intent.end) continue;
    if (!best || intent.priority > best.priority) best = intent;
  }
  if (!best) return NEUTRAL;

  const safeX = clampFocal(best.x, best.scale);
  const safeY = clampFocal(best.y, best.scale);
  return { scale: best.scale, x: safeX, y: safeY, trigger: best.trigger };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export function generateZoomKeyframes(
  clicks: ClickEvent[],
  duration: number,
  opts: ZoomConfig & {
    scrolls?: ScrollEvent[];
    pauses?: PauseEvent[];
    typeBursts?: TypeBurstEvent[];
  } = {},
): ZoomKeyframe[] {
  if (!isFinite(duration) || duration <= 0) {
    return [{ t: 0, scale: 1, x: 0.5, y: 0.5 }];
  }

  const cfg = resolveConfig(opts);
  const { spring } = cfg;

  const scrolls    = opts.scrolls    ?? [];
  const pauses     = opts.pauses     ?? [];
  const typeBursts = opts.typeBursts ?? [];

  const inRange = (t: number) => isFinite(t) && t >= 0 && t <= duration;

  const sortedClicks = [...clicks]
    .filter((c) => inRange(c.t) && isFinite(c.x) && isFinite(c.y))
    .sort((a, b) => a.t - b.t);

  const sortedScrolls = [...scrolls]
    .filter((s) => inRange(s.t))
    .sort((a, b) => a.t - b.t);

  const sortedPauses = [...pauses]
    .filter((p) => inRange(p.t) && isFinite(p.duration) && p.duration > 0)
    .sort((a, b) => a.t - b.t);

  const sortedBursts = [...typeBursts]
    .filter((tb) => inRange(tb.t) && isFinite(tb.duration) && tb.duration > 0)
    .sort((a, b) => a.t - b.t);

  const intents: ZoomIntent[] = [];

  // 1a. Click groups
  type CGroup = { start: number; end: number; x: number; y: number; n: number };
  const groups: CGroup[] = [];

  for (const c of sortedClicks) {
    const cx = clamp01(c.x);
    const cy = clamp01(c.y);
    const last = groups[groups.length - 1];
    if (
      last &&
      c.t - last.end < cfg.clickMergeWindow &&
      Math.hypot(cx - last.x, cy - last.y) < cfg.clickMergeDistance
    ) {
      last.end = c.t;
      last.x   = (last.x * last.n + cx) / (last.n + 1);
      last.y   = (last.y * last.n + cy) / (last.n + 1);
      last.n++;
    } else {
      groups.push({ start: c.t, end: c.t, x: cx, y: cy, n: 1 });
    }
  }

  for (const g of groups) {
    const hold = cfg.hold + (g.n - 1) * cfg.holdPerClick;
    intents.push({
      start:    Math.max(0, g.start - 0.05),
      end:      Math.min(duration, g.end + hold),
      scale:    cfg.clickScale,
      x:        clamp01(g.x),
      y:        clamp01(g.y),
      priority: 10,
      trigger:  "click",
    });
  }

  // 1b. Type bursts
  for (const tb of sortedBursts) {
    if (tb.duration < 0.4) continue;

    let fx = 0.5, fy = 0.5;
    for (let i = sortedClicks.length - 1; i >= 0; i--) {
      if (sortedClicks[i].t <= tb.t) {
        fx = clamp01(sortedClicks[i].x);
        fy = clamp01(sortedClicks[i].y);
        break;
      }
    }
    intents.push({
      start:    Math.max(0, tb.t - 0.05),
      end:      Math.min(duration, tb.t + tb.duration + 0.6),
      scale:    cfg.typeScale,
      x:        fx,
      y:        fy,
      priority: 8,
      trigger:  "type_burst",
    });
  }

  // 1c. Long pauses
  for (const p of sortedPauses) {
    if (p.duration < cfg.pauseThreshold) continue;
    if (!inRange(p.t)) continue;

    let fx = 0.5, fy = 0.5;
    for (let i = sortedClicks.length - 1; i >= 0; i--) {
      if (sortedClicks[i].t <= p.t) {
        fx = clamp01(sortedClicks[i].x);
        fy = clamp01(sortedClicks[i].y);
        break;
      }
    }
    intents.push({
      start:    Math.min(duration, p.t + 0.6),
      end:      Math.min(duration, p.t + p.duration - 0.3),
      scale:    cfg.pauseScale,
      x:        fx,
      y:        fy,
      priority: 5,
      trigger:  "pause",
    });
  }

  // 1d. Scroll bursts
  const scrollBursts = mergeBursts(sortedScrolls, 0.45);
  for (const b of scrollBursts) {
    if (b.end - b.start < cfg.scrollBurstThreshold) continue;
    intents.push({
      start:    Math.max(0, b.start - 0.08),
      end:      Math.min(duration, b.end + 0.5),
      scale:    cfg.scrollOutScale,
      x:        0.5,
      y:        0.5,
      priority: 7,
      trigger:  "scroll_out",
    });
  }

  // 1e. Forced zoom overrides
  for (const fz of cfg.forcedZooms) {
    if (!isFinite(fz.start) || !isFinite(fz.end) || fz.start >= fz.end) continue;
    intents.push({
      start:    clamp(fz.start, 0, duration),
      end:      clamp(fz.end,   0, duration),
      scale:    clamp(fz.scale, 0.5, 4),
      x:        clamp01(fz.x ?? 0.5),
      y:        clamp01(fz.y ?? 0.5),
      priority: 100,
      trigger:  "manual",
    });
  }

  // STEP 2 — Spring simulation
  const { k, c, m } = spring;
  const { simStep, rdpEpsilon, blackoutRanges } = cfg;

  const scaleSpring: SpringState = { p: 1.0, v: 0 };
  const xSpring:     SpringState = { p: 0.5, v: 0 };
  const ySpring:     SpringState = { p: 0.5, v: 0 };

  const nSteps   = Math.ceil(duration / simStep) + 2;
  const rawSamples: ZoomKeyframe[] = [];
  rawSamples.length = nSteps;

  let sampleCount = 0;
  let lastTrigger: ZoomTriggerKind | undefined;

  for (let step = 0; ; step++) {
    const t = Math.min(step * simStep, duration);

    const target = resolveTarget(t, intents, blackoutRanges);
    if (target.trigger !== undefined) lastTrigger = target.trigger;

    const liveSafeX = clampFocal(target.x, scaleSpring.p);
    const liveSafeY = clampFocal(target.y, scaleSpring.p);

    const nextScale = springStep(scaleSpring, target.scale, k, c, m, simStep);
    const nextX     = springStep(xSpring,     liveSafeX,   k, c, m, simStep);
    const nextY     = springStep(ySpring,      liveSafeY,   k, c, m, simStep);

    scaleSpring.p = nextScale.p; scaleSpring.v = nextScale.v;
    xSpring.p     = nextX.p;     xSpring.v     = nextX.v;
    ySpring.p     = nextY.p;     ySpring.v     = nextY.v;

    rawSamples[sampleCount++] = {
      t,
      scale: clamp(scaleSpring.p, 0.1, 10),
      x:     clamp01(xSpring.p),
      y:     clamp01(ySpring.p),
      trigger: lastTrigger,
    };

    if (t >= duration) break;
  }

  const dense = rawSamples.slice(0, sampleCount);

  // STEP 3 — RDP simplification
  const keyframes = rdpEpsilon > 0
    ? simplify(dense, rdpEpsilon)
    : dense;

  // STEP 4 — Sentinels
  if (keyframes.length === 0 || keyframes[0].t > 1e-6) {
    keyframes.unshift({ t: 0, scale: 1, x: 0.5, y: 0.5 });
  }
  const last = keyframes[keyframes.length - 1];
  if (last.t < duration - 1e-6) {
    keyframes.push({ t: duration, scale: 1, x: 0.5, y: 0.5 });
  }

  return keyframes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interpolation
// ─────────────────────────────────────────────────────────────────────────────

export function interpolateZoom(
  keyframes: ZoomKeyframe[],
  t: number,
): ZoomKeyframe {
  if (keyframes.length === 0)  return { t, scale: 1, x: 0.5, y: 0.5 };
  if (keyframes.length === 1)  return keyframes[0];
  if (t <= keyframes[0].t)     return keyframes[0];

  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last;

  let lo = 0, hi = keyframes.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].t <= t) lo = mid; else hi = mid;
  }

  const a = keyframes[lo];
  const b = keyframes[hi];
  const span = b.t - a.t;
  if (span < 1e-9) return a;

  const r = (t - a.t) / span;
  return {
    t,
    scale: a.scale + (b.scale - a.scale) * r,
    x:     a.x     + (b.x     - a.x)     * r,
    y:     a.y     + (b.y     - a.y)     * r,
    trigger: a.trigger,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas renderer utility
// ─────────────────────────────────────────────────────────────────────────────

export function applyZoomToCanvas(
  ctx: CanvasRenderingContext2D,
  kf: ZoomKeyframe,
  width: number,
  height: number,
): void {
  const ox = kf.x * width;
  const oy = kf.y * height;
  ctx.setTransform(
    kf.scale, 0,
    0,        kf.scale,
    ox * (1 - kf.scale),
    oy * (1 - kf.scale),
  );
}

export function resetZoom(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// FFmpeg zoompan export
// ─────────────────────────────────────────────────────────────────────────────

export function toFFmpegZoomPan(
  keyframes: ZoomKeyframe[],
  fps: number,
  width: number,
  height: number,
): string {
  if (keyframes.length === 0) {
    return `zoompan=z='1':x='0':y='0':d=1:s=${width}x${height}:fps=${fps}`;
  }
  if (keyframes.length === 1) {
    const kf = keyframes[0];
    const px = (kf.x * width  * (1 - kf.scale)).toFixed(4);
    const py = (kf.y * height * (1 - kf.scale)).toFixed(4);
    return `zoompan=z='${kf.scale.toFixed(6)}':x='${px}':y='${py}':d=1:s=${width}x${height}:fps=${fps}`;
  }

  const zParts: string[] = [];
  const xParts: string[] = [];
  const yParts: string[] = [];

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    const f0 = Math.round(a.t * fps);
    const f1 = Math.round(b.t * fps);
    if (f1 <= f0) continue;

    const span = f1 - f0;
    const zA = a.scale.toFixed(6);
    const zB = b.scale.toFixed(6);
    const xA = (a.x * width  * (1 - a.scale)).toFixed(4);
    const xB = (b.x * width  * (1 - b.scale)).toFixed(4);
    const yA = (a.y * height * (1 - a.scale)).toFixed(4);
    const yB = (b.y * height * (1 - b.scale)).toFixed(4);
    const u  = `(on-${f0})/${span}`;

    zParts.push(`if(between(on,${f0},${f1}),(${zA})+(${zB}-${zA})*${u},0)`);
    xParts.push(`if(between(on,${f0},${f1}),(${xA})+(${xB}-${xA})*${u},0)`);
    yParts.push(`if(between(on,${f0},${f1}),(${yA})+(${yB}-${yA})*${u},0)`);
  }

  const fallback = keyframes[keyframes.length - 1];
  const fz = fallback.scale.toFixed(6);
  const fx = (fallback.x * width  * (1 - fallback.scale)).toFixed(4);
  const fy = (fallback.y * height * (1 - fallback.scale)).toFixed(4);

  const z = zParts.length ? zParts.join("+") : fz;
  const x = xParts.length ? xParts.join("+") : fx;
  const y = yParts.length ? yParts.join("+") : fy;

  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=${fps}`;
}
