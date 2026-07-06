import type { CursorRecordingData } from "@/native/contracts";

export interface SmoothedPoint {
  cx: number;
  cy: number;
}

export interface SmoothedCursorPath {
  sampleAt(timeMs: number): SmoothedPoint | null;
}

export function getSmoothedCursorPath(
  data: CursorRecordingData | null | undefined,
  smoothing: number,
): SmoothedCursorPath | null {
  if (!data || !data.samples || data.samples.length === 0) {
    return null;
  }

  const samples = [...data.samples].sort((a, b) => a.timeMs - b.timeMs);
  if (samples.length === 0) {
    return null;
  }

  const smoothedSamples: Array<{ timeMs: number; cx: number; cy: number }> = [];

  // Initialize first sample
  let lastCx = samples[0].cx;
  let lastCy = samples[0].cy;
  smoothedSamples.push({ timeMs: samples[0].timeMs, cx: lastCx, cy: lastCy });

  const clampedSmoothing = Math.max(0, Math.min(smoothing, 0.99));

  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    const dt = sample.timeMs - samples[i - 1].timeMs;

    if (clampedSmoothing <= 0 || dt <= 0) {
      lastCx = sample.cx;
      lastCy = sample.cy;
    } else {
      // Exponential moving average adjusted for variable time step dt (60fps baseline)
      const alpha = 1 - Math.pow(clampedSmoothing, dt / 16.6667);
      lastCx = lastCx + alpha * (sample.cx - lastCx);
      lastCy = lastCy + alpha * (sample.cy - lastCy);
    }

    smoothedSamples.push({
      timeMs: sample.timeMs,
      cx: lastCx,
      cy: lastCy,
    });
  }

  return {
    sampleAt(timeMs: number): SmoothedPoint | null {
      if (smoothedSamples.length === 0) return null;
      if (timeMs <= smoothedSamples[0].timeMs) {
        return { cx: smoothedSamples[0].cx, cy: smoothedSamples[0].cy };
      }
      const lastSample = smoothedSamples[smoothedSamples.length - 1];
      if (timeMs >= lastSample.timeMs) {
        return { cx: lastSample.cx, cy: lastSample.cy };
      }

      // Binary search to find surrounding samples
      let low = 0;
      let high = smoothedSamples.length - 1;
      while (low < high - 1) {
        const mid = (low + high) >> 1;
        if (smoothedSamples[mid].timeMs <= timeMs) {
          low = mid;
        } else {
          high = mid;
        }
      }

      const s0 = smoothedSamples[low];
      const s1 = smoothedSamples[high];
      const span = s1.timeMs - s0.timeMs;
      if (span <= 0) {
        return { cx: s0.cx, cy: s0.cy };
      }

      const r = (timeMs - s0.timeMs) / span;
      return {
        cx: s0.cx + (s1.cx - s0.cx) * r,
        cy: s0.cy + (s1.cy - s0.cy) * r,
      };
    },
  };
}
