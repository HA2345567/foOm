import type { ClickEvent } from "../hooks/useScreenRecording";

/**
 * Detect "interest points" by sampling frames from a video and finding
 * regions where pixels change the most between consecutive samples.
 *
 * This is the fallback that powers auto-zoom when no real click events
 * were captured (e.g. user recorded their full screen, where browsers
 * cannot observe OS-level mouse events).
 *
 * Returns synthetic ClickEvent[] spread across the timeline.
 */
export async function detectInterestPoints(
  videoUrl: string,
  duration: number,
  opts: {
    /** how many time samples to take across the recording (default ~1 every 2s) */
    sampleCount?: number;
    /** downscale resolution for diff (small = fast) */
    sampleW?: number;
    sampleH?: number;
    /** min seconds between detected events */
    minGap?: number;
  } = {},
): Promise<ClickEvent[]> {
  const sampleCount = opts.sampleCount ?? Math.max(8, Math.floor(duration / 2));
  const W = opts.sampleW ?? 160;
  const H = opts.sampleH ?? 90;
  const minGap = opts.minGap ?? 1.5;

  const video = document.createElement("video");
  video.style.position = "fixed";
  video.style.pointerEvents = "none";
  video.style.top = "-9999px";
  video.style.left = "-9999px";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  document.body.appendChild(video);

  try {
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("could not decode video"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const seekTo = (t: number) =>
      new Promise<void>((resolve) => {
        const onSeek = () => {
          video.removeEventListener("seeked", onSeek);
          resolve();
        };
        video.addEventListener("seeked", onSeek);
        video.currentTime = Math.min(t, duration - 0.01);
      });

    let prev: ImageData | null = null;
    // Grid: divide frame into 6x4 cells; track diff per cell
    const COLS = 6;
    const ROWS = 4;
    const cellW = W / COLS;
    const cellH = H / ROWS;

    const events: { t: number; x: number; y: number; score: number }[] = [];

    for (let i = 0; i < sampleCount; i++) {
      const t = (i / (sampleCount - 1)) * duration;
      await seekTo(t);
      ctx.drawImage(video, 0, 0, W, H);
      const cur = ctx.getImageData(0, 0, W, H);

      if (prev) {
        // sum diff per cell
        const cellSums = new Float32Array(COLS * ROWS);
        const a = prev.data;
        const b = cur.data;
        for (let y = 0; y < H; y++) {
          const cy = Math.floor(y / cellH);
          for (let x = 0; x < W; x++) {
            const cx = Math.floor(x / cellW);
            const idx = (y * W + x) * 4;
            const d =
              Math.abs(a[idx] - b[idx]) +
              Math.abs(a[idx + 1] - b[idx + 1]) +
              Math.abs(a[idx + 2] - b[idx + 2]);
            cellSums[cy * COLS + cx] += d;
          }
        }
        // pick the most-changed cell
        let bestIdx = 0;
        let bestVal = 0;
        for (let k = 0; k < cellSums.length; k++) {
          if (cellSums[k] > bestVal) {
            bestVal = cellSums[k];
            bestIdx = k;
          }
        }
        // threshold: ignore tiny changes (noise/compression)
        const cellPixels = cellW * cellH;
        const avgDiff = bestVal / (cellPixels * 3); // 0..255
        if (avgDiff > 8) {
          const cx = bestIdx % COLS;
          const cy = Math.floor(bestIdx / COLS);
          events.push({
            t,
            x: (cx + 0.5) / COLS,
            y: (cy + 0.5) / ROWS,
            score: avgDiff,
          });
        }
      }
      prev = cur;
      // Yield to event loop to keep UI responsive
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    // Suppress events that are too close in time — keep highest score
    events.sort((a, b) => a.t - b.t);
    const kept: typeof events = [];
    for (const e of events) {
      const last = kept[kept.length - 1];
      if (!last || e.t - last.t >= minGap) {
        kept.push(e);
      } else if (e.score > last.score) {
        kept[kept.length - 1] = e;
      }
    }

    return kept.map(({ t, x, y }) => ({ t, x, y }));
  } finally {
    try {
      video.pause();
      video.src = "";
      video.load();
      video.remove();
    } catch (e) {
      console.warn("Failed to clean up detectInterestPoints video element", e);
    }
  }
}
