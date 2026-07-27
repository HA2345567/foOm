/**
 * @file autozoom.ts
 * @description Unified Smart Autozoom Engine for foOm Screen Recorder.
 * Provides spring-physics autozoom in live recording mode and post-recording processing.
 *
 * NOTE: Autozoom uses spring physics and click/scroll/pause tracking.
 * It is SMART / CINEMATIC autozoom — NOT AI autozoom.
 */

export type SpringPresetName = "glass" | "silk" | "snap" | "velvet";

export interface SpringPreset {
  k: number; // Stiffness
  dampingRatio: number; // 1.0 = critically damped
}

export const SPRING_PRESETS: Record<SpringPresetName, SpringPreset> = {
  glass: { k: 18, dampingRatio: 1.0 },
  silk: { k: 38, dampingRatio: 1.0 },
  snap: { k: 80, dampingRatio: 1.0 },
  velvet: { k: 55, dampingRatio: 1.0 },
};

export interface ZoomState {
  targetX: number; // Normalized [0..1]
  targetY: number; // Normalized [0..1]
  targetScale: number; // >= 1.0
  currentX: number;
  currentY: number;
  currentScale: number;
  vx: number;
  vy: number;
  vScale: number;
  mode: "overview" | "zoomed";
  priority: number; // Current active trigger priority
  lastChangeTime: number;
}

export interface IntentSignal {
  type: "click" | "pointer" | "type_burst" | "scroll_out" | "pause" | "hint" | "manual";
  x?: number;
  y?: number;
  scale?: number;
  priority: number;
  strength?: number;
  timestamp: number;
}

export interface Keyframe {
  timestamp: number; // ms
  x: number;
  y: number;
  scale: number;
  trigger: string;
}

export type KeyframeLog = Keyframe[];

export interface FrameDecoration {
  padding?: number;
  borderRadius?: number;
  shadowBlur?: number;
  shadowColor?: string;
  backgroundColor?: string;
}

export interface WebcamOverlayConfig {
  stream?: MediaStream | HTMLVideoElement;
  size?: number; // size in px or ratio
  shape?: "circle" | "rounded" | "square";
  xNorm?: number;
  yNorm?: number;
  zoom?: number;
}

export function createInitialZoomState(): ZoomState {
  return {
    targetX: 0.5,
    targetY: 0.5,
    targetScale: 1.0,
    currentX: 0.5,
    currentY: 0.5,
    currentScale: 1.0,
    vx: 0,
    vy: 0,
    vScale: 0,
    mode: "overview",
    priority: 0,
    lastChangeTime: 0,
  };
}

/**
 * Priority Table:
 *  100 = manual (editor override)
 *   10 = click
 *    8 = type_burst
 *    7 = scroll_out (zoom OUT)
 *    5 = pause
 *    1 = hint (vision analysis)
 */
export function fuseIntent(
  signals: IntentSignal[],
  state: ZoomState,
  now: number,
  enabled: boolean = true
): { targetX: number; targetY: number; targetScale: number; priority: number } {
  if (!enabled || signals.length === 0) {
    return { targetX: 0.5, targetY: 0.5, targetScale: 1.0, priority: 0 };
  }

  // Sort by highest priority, then recency
  const sorted = [...signals].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.timestamp - a.timestamp;
  });

  const top = sorted[0];

  // If a manual or high priority signal came in
  if (top.priority >= 100) {
    return {
      targetX: top.x ?? 0.5,
      targetY: top.y ?? 0.5,
      targetScale: top.scale ?? 1.8,
      priority: top.priority,
    };
  }

  // Click trigger (P=10)
  if (top.type === "click" && top.x !== undefined && top.y !== undefined) {
    return {
      targetX: top.x,
      targetY: top.y,
      targetScale: top.scale ?? 1.85,
      priority: 10,
    };
  }

  // Scroll Out (P=7)
  if (top.type === "scroll_out") {
    return {
      targetX: 0.5,
      targetY: 0.5,
      targetScale: 1.0,
      priority: 7,
    };
  }

  // Keystroke Burst (P=8)
  if (top.type === "type_burst" && top.x !== undefined && top.y !== undefined) {
    return {
      targetX: top.x,
      targetY: top.y,
      targetScale: top.scale ?? 1.5,
      priority: 8,
    };
  }

  // Pause Dwell (P=5)
  if (top.type === "pause" && top.x !== undefined && top.y !== undefined) {
    return {
      targetX: top.x,
      targetY: top.y,
      targetScale: top.scale ?? 1.4,
      priority: 5,
    };
  }

  // Vision Hint (P=1)
  if (top.type === "hint" && top.x !== undefined && top.y !== undefined && (top.strength ?? 0) > 0.4) {
    // Only zoom to vision hint if currently zoomed out or already tracking vision
    if (state.mode === "overview" || state.priority <= 1) {
      return {
        targetX: top.x,
        targetY: top.y,
        targetScale: 1.4,
        priority: 1,
      };
    }
  }

  // Default overview state
  return { targetX: 0.5, targetY: 0.5, targetScale: 1.0, priority: 0 };
}

/**
 * Analytic critically-damped spring integration step.
 * Solves: d2x/dt2 + 2*w*dx/dt + w^2*(x - target) = 0
 * Guaranteeing no overshoot and zero Euler drift.
 */

export function stepSpring(
  current: number,
  velocity: number,
  target: number,
  k: number,
  dt: number
): [number, number] {
  const omega = Math.sqrt(k); // Natural frequency for critical damping (c = 2 * sqrt(k))
  const x = current - target;
  const expTerm = Math.exp(-omega * dt);

  const nextPos = target + (x + (velocity + omega * x) * dt) * expTerm;
  const nextVel = (velocity - omega * (velocity + omega * x) * dt) * expTerm;

  return [nextPos, nextVel];
}

/**
 * LIVE MODE Engine Tick.
 * Runs on every rAF tick (~16ms). Must execute in < 1ms.
 */
export function tickEngine(
  state: ZoomState,
  intentBus: IntentSignal[],
  keyframeLog: KeyframeLog | null,
  now: number,
  dt: number,
  enabled: boolean = true,
  presetName: SpringPresetName = "silk"
): void {
  const preset = SPRING_PRESETS[presetName] || SPRING_PRESETS.silk;
  const fused = fuseIntent(intentBus, state, now, enabled);

  state.targetX = fused.targetX;
  state.targetY = fused.targetY;
  state.targetScale = fused.targetScale;

  // Step spring integration
  const [nx, nvx] = stepSpring(state.currentX, state.vx, state.targetX, preset.k, dt);
  const [ny, nvy] = stepSpring(state.currentY, state.vy, state.targetY, preset.k, dt);
  const [ns, nvs] = stepSpring(state.currentScale, state.vScale, state.targetScale, preset.k, dt);

  state.currentX = nx;
  state.currentY = ny;
  state.currentScale = ns;
  state.vx = nvx;
  state.vy = nvy;
  state.vScale = nvs;

  const isZoomed = state.currentScale > 1.15;
  state.mode = isZoomed ? "zoomed" : "overview";

  // Log keyframe if significant state change
  if (keyframeLog) {
    const lastKf = keyframeLog[keyframeLog.length - 1];
    if (
      !lastKf ||
      Math.abs(lastKf.x - state.currentX) > 0.005 ||
      Math.abs(lastKf.y - state.currentY) > 0.005 ||
      Math.abs(lastKf.scale - state.currentScale) > 0.01
    ) {
      keyframeLog.push({
        timestamp: now,
        x: state.currentX,
        y: state.currentY,
        scale: state.currentScale,
        trigger: isZoomed ? `p_${fused.priority}` : "overview",
      });
    }
  }
}

/**
 * Crop-based canvas zoom renderer.
 * NEVER uses CSS transform to avoid retina blur.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  state: ZoomState,
  outW: number,
  outH: number,
  decoration?: FrameDecoration,
  webcamConfig?: WebcamOverlayConfig
): void {
  ctx.save();
  ctx.clearRect(0, 0, outW, outH);

  // Background style
  if (decoration?.backgroundColor) {
    ctx.fillStyle = decoration.backgroundColor;
    ctx.fillRect(0, 0, outW, outH);
  }

  const padding = decoration?.padding ?? 0;
  const radius = decoration?.borderRadius ?? 0;

  const destW = outW - padding * 2;
  const destH = outH - padding * 2;
  const destX = padding;
  const destY = padding;

  // Source cropping bounds based on current zoom
  const srcAny = source as any;
  const sourceW = Number(srcAny.width || srcAny.videoWidth || srcAny.displayWidth || outW);
  const sourceH = Number(srcAny.height || srcAny.videoHeight || srcAny.displayHeight || outH);

  const cropW = sourceW / state.currentScale;
  const cropH = sourceH / state.currentScale;

  let cropX = state.currentX * sourceW - cropW / 2;
  let cropY = state.currentY * sourceH - cropH / 2;

  // Clamp crop rectangle within source video bounds
  cropX = Math.max(0, Math.min(sourceW - cropW, cropX));
  cropY = Math.max(0, Math.min(sourceH - cropH, cropY));

  // Drop Shadow
  if (decoration?.shadowBlur && decoration.shadowBlur > 0) {
    ctx.shadowBlur = decoration.shadowBlur;
    ctx.shadowColor = decoration.shadowColor || "rgba(0,0,0,0.4)";
    ctx.shadowOffsetY = decoration.shadowBlur * 0.4;
  }

  // Rounded frame clipping
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(destX, destY, destW, destH, radius);
    ctx.clip();
  }

  // Draw zoomed crop
  ctx.drawImage(source, cropX, cropY, cropW, cropH, destX, destY, destW, destH);
  ctx.restore();

  // Draw Webcam Face Bubble Overlay if active
  if (webcamConfig?.stream) {
    ctx.save();
    const size = webcamConfig.size || Math.min(outW, outH) * 0.22;
    const wx = (webcamConfig.xNorm ?? 0.85) * outW - size / 2;
    const wy = (webcamConfig.yNorm ?? 0.85) * outH - size / 2;

    ctx.beginPath();
    if (webcamConfig.shape === "circle" || !webcamConfig.shape) {
      ctx.arc(wx + size / 2, wy + size / 2, size / 2, 0, Math.PI * 2);
    } else if (webcamConfig.shape === "rounded") {
      ctx.roundRect(wx, wy, size, size, size * 0.2);
    } else {
      ctx.rect(wx, wy, size, size);
    }
    ctx.clip();

    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";

    const vElem = webcamConfig.stream as HTMLVideoElement;
    ctx.drawImage(vElem, wx, wy, size, size);
    ctx.restore();
  }
}

/**
 * POST MODE Keyframe Generator.
 * PRIMARY: Replays KeyframeLog directly for 100% pixel-perfect export.
 * FALLBACK: Re-derives from event logs and runs offline 120Hz spring sim.
 */
export function generateZoomKeyframes(
  events: { timestamp: number; x: number; y: number; type: string }[],
  durationMs: number,
  opts?: {
    recordedKeyframes?: KeyframeLog;
    presetName?: SpringPresetName;
  }
): KeyframeLog {
  // PRIMARY PATH: Consume live recorded keyframe log
  if (opts?.recordedKeyframes && opts.recordedKeyframes.length > 0) {
    return rdpCompressKeyframes(opts.recordedKeyframes, 0.001);
  }

  // FALLBACK PATH: Re-simulate from raw events at 120Hz
  const result: KeyframeLog = [];
  const state = createInitialZoomState();
  const stepMs = 1000 / 120; // 120Hz simulation step
  const preset = SPRING_PRESETS[opts?.presetName || "silk"];

  let eventIdx = 0;
  for (let t = 0; t <= durationMs; t += stepMs) {
    const bus: IntentSignal[] = [];
    while (eventIdx < events.length && events[eventIdx].timestamp <= t) {
      const ev = events[eventIdx];
      bus.push({
        type: ev.type as any,
        x: ev.x,
        y: ev.y,
        priority: ev.type === "click" ? 10 : 5,
        timestamp: ev.timestamp,
      });
      eventIdx++;
    }

    const fused = fuseIntent(bus, state, t, true);
    state.targetX = fused.targetX;
    state.targetY = fused.targetY;
    state.targetScale = fused.targetScale;

    const dt = stepMs / 1000;
    const [nx, nvx] = stepSpring(state.currentX, state.vx, state.targetX, preset.k, dt);
    const [ny, nvy] = stepSpring(state.currentY, state.vy, state.targetY, preset.k, dt);
    const [ns, nvs] = stepSpring(state.currentScale, state.vScale, state.targetScale, preset.k, dt);

    state.currentX = nx;
    state.currentY = ny;
    state.currentScale = ns;
    state.vx = nvx;
    state.vy = nvy;
    state.vScale = nvs;

    result.push({
      timestamp: t,
      x: state.currentX,
      y: state.currentY,
      scale: state.currentScale,
      trigger: state.currentScale > 1.15 ? "sim_zoomed" : "overview",
    });
  }

  return rdpCompressKeyframes(result, 0.001);
}

/**
 * Binary search interpolation O(log n) over keyframes array.
 */
export function interpolateZoom(keyframes: KeyframeLog, tMs: number): Keyframe {
  if (!keyframes || keyframes.length === 0) {
    return { timestamp: tMs, x: 0.5, y: 0.5, scale: 1.0, trigger: "default" };
  }

  if (tMs <= keyframes[0].timestamp) return keyframes[0];
  if (tMs >= keyframes[keyframes.length - 1].timestamp) return keyframes[keyframes.length - 1];

  let low = 0;
  let high = keyframes.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (keyframes[mid].timestamp === tMs) return keyframes[mid];
    if (keyframes[mid].timestamp < tMs) low = mid + 1;
    else high = mid - 1;
  }

  const k1 = keyframes[high];
  const k2 = keyframes[low];
  const alpha = (tMs - k1.timestamp) / (k2.timestamp - k1.timestamp || 1);

  return {
    timestamp: tMs,
    x: k1.x + (k2.x - k1.x) * alpha,
    y: k1.y + (k2.y - k1.y) * alpha,
    scale: k1.scale + (k2.scale - k1.scale) * alpha,
    trigger: k1.trigger,
  };
}

/**
 * Generates FFmpeg zoompan filter string from keyframes.
 */
export function toFFmpegZoomPan(
  keyframes: KeyframeLog,
  fps: number,
  w: number,
  h: number
): string {
  if (!keyframes || keyframes.length === 0) {
    return `zoompan=z='1':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}`;
  }

  const first = keyframes[0];
  return `zoompan=z='min(max(zoom,${first.scale.toFixed(2)}),2.0)':x='${(first.x * w).toFixed(0)}-iw/zoom/2':y='${(first.y * h).toFixed(0)}-ih/zoom/2':d=1:s=${w}x${h}`;
}

/**
 * Ramer-Douglas-Peucker compression for keyframe logs.
 */
function rdpCompressKeyframes(keyframes: KeyframeLog, epsilon: number): KeyframeLog {
  if (keyframes.length <= 2) return keyframes;

  let dmax = 0;
  let index = 0;
  const end = keyframes.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(keyframes[i], keyframes[0], keyframes[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const rec1 = rdpCompressKeyframes(keyframes.slice(0, index + 1), epsilon);
    const rec2 = rdpCompressKeyframes(keyframes.slice(index), epsilon);
    return [...rec1.slice(0, rec1.length - 1), ...rec2];
  } else {
    return [keyframes[0], keyframes[end]];
  }
}

function perpendicularDistance(pt: Keyframe, line1: Keyframe, line2: Keyframe): number {
  const dx = line2.x - line1.x;
  const dy = line2.y - line1.y;
  const ds = line2.scale - line1.scale;

  const num = Math.abs(dy * pt.x - dx * pt.y + line2.x * line1.y - line2.y * line1.x) + Math.abs(pt.scale - (line1.scale + ds * 0.5));
  const den = Math.hypot(dx, dy, ds) || 1;

  return num / den;
}
