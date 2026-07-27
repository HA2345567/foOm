/**
 * @file vision-engine.ts
 * @description Frame Analysis Engine for foOm Screen Recorder.
 * Analyzes video pixels for motion to determine focal points for smart autozoom.
 *
 * NOTE: VisionEngine is pure JS and MUST run inside a Web Worker (vision-worker.ts).
 * NEVER run this on the main thread to prevent CPU heat and fan spikes.
 */

export interface VisionResult {
  x: number; // Normalized [0..1]
  y: number; // Normalized [0..1]
  confidence: number; // [0..1]
  rawDensity: number; // Ratio of moving pixels [0..1]
}

export const ANALYSIS_W = 128;
export const ANALYSIS_H = 72;
export const NOISE_FLOOR_DENSITY = 0.003;
export const NOISE_THRESHOLD = 18;
export const PREDICTIVE_LEAD = 2.5;
export const CENTER_BIAS = 0.6;

export class VisionEngine {
  private prevLuma: Uint8Array;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;

  // Smoothing states
  private smoothedX = 0.5;
  private smoothedY = 0.5;
  private prevRawX = 0.5;
  private prevRawY = 0.5;
  private velX = 0;
  private velY = 0;

  constructor() {
    this.prevLuma = new Uint8Array(ANALYSIS_W * ANALYSIS_H);
    if (typeof OffscreenCanvas !== "undefined") {
      this.canvas = new OffscreenCanvas(ANALYSIS_W, ANALYSIS_H);
    } else {
      const c = document.createElement("canvas");
      c.width = ANALYSIS_W;
      c.height = ANALYSIS_H;
      this.canvas = c;
    }
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
  }

  /**
   * Reset internal motion tracking state.
   */
  public reset(): void {
    this.prevLuma.fill(0);
    this.smoothedX = 0.5;
    this.smoothedY = 0.5;
    this.prevRawX = 0.5;
    this.prevRawY = 0.5;
    this.velX = 0;
    this.velY = 0;
  }

  /**
   * Analyze an image source (ImageBitmap or CanvasImageSource).
   * Calculates center-of-mass focal point using Rec.601 luma difference.
   */
  public analyze(source: CanvasImageSource): VisionResult {
    if (!this.ctx) {
      return { x: 0.5, y: 0.5, confidence: 0, rawDensity: 0 };
    }

    // 1. Downsample to 128x72
    this.ctx.drawImage(source, 0, 0, ANALYSIS_W, ANALYSIS_H);
    const imgData = this.ctx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H);
    const pixels = imgData.data;

    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let activePixels = 0;

    const totalPixelCount = ANALYSIS_W * ANALYSIS_H;

    // 2 & 3. Rec.601 Luma + Diff vs Prev Frame
    for (let y = 0; y < ANALYSIS_H; y++) {
      for (let x = 0; x < ANALYSIS_W; x++) {
        const idx = (y * ANALYSIS_W + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        // Rec.601 Luma
        const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        const prevIdx = y * ANALYSIS_W + x;
        const diff = Math.abs(luma - this.prevLuma[prevIdx]);
        this.prevLuma[prevIdx] = luma;

        if (diff > NOISE_THRESHOLD) {
          activePixels++;

          // 4. Center-biased weighting
          const normX = x / (ANALYSIS_W - 1);
          const normY = y / (ANALYSIS_H - 1);

          // Distance from screen center [0.5, 0.5]
          const distFromCenter = Math.hypot(normX - 0.5, normY - 0.5);
          const centerWeight = 1 - CENTER_BIAS * distFromCenter;
          const weight = diff * Math.max(0.1, centerWeight);

          weightedX += normX * weight;
          weightedY += normY * weight;
          totalWeight += weight;
        }
      }
    }

    const rawDensity = activePixels / totalPixelCount;

    // Filter out background noise floor
    if (totalWeight <= 0 || rawDensity < NOISE_FLOOR_DENSITY) {
      // Decay velocity when stationary
      this.velX *= 0.8;
      this.velY *= 0.8;
      return {
        x: this.smoothedX,
        y: this.smoothedY,
        confidence: 0,
        rawDensity,
      };
    }

    const rawX = weightedX / totalWeight;
    const rawY = weightedY / totalWeight;

    // 5. Adaptive smoothing (0.08 to 0.22 based on motion magnitude)
    const rawInstVel = Math.hypot(rawX - this.prevRawX, rawY - this.prevRawY);
    const alpha = Math.min(0.22, Math.max(0.08, rawInstVel * 2.0));

    // Instantaneous velocity calculation
    const instVelX = rawX - this.prevRawX;
    const instVelY = rawY - this.prevRawY;

    this.velX = this.velX * 0.7 + instVelX * 0.3;
    this.velY = this.velY * 0.7 + instVelY * 0.3;

    this.prevRawX = rawX;
    this.prevRawY = rawY;

    // 6. Velocity smoothing + Predictive Lead (2.5 frames ahead)
    const targetX = rawX + this.velX * PREDICTIVE_LEAD;
    const targetY = rawY + this.velY * PREDICTIVE_LEAD;

    // Clamp predicted targets
    const clampedTargetX = Math.min(0.95, Math.max(0.05, targetX));
    const clampedTargetY = Math.min(0.95, Math.max(0.05, targetY));

    this.smoothedX += (clampedTargetX - this.smoothedX) * alpha;
    this.smoothedY += (clampedTargetY - this.smoothedY) * alpha;

    // 7. Density-normalized confidence [0..1]
    const confidence = Math.min(1, Math.max(0, (rawDensity - NOISE_FLOOR_DENSITY) * 20));

    return {
      x: this.smoothedX,
      y: this.smoothedY,
      confidence,
      rawDensity,
    };
  }
}
