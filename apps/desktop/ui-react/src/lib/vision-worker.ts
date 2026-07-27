/**
 * @file vision-worker.ts
 * @description Web Worker for off-main-thread frame motion analysis.
 *
 * Performance Contract:
 * - Runs 128x72 pixel luma analysis in background thread (~0.8ms per frame).
 * - Receives ImageBitmap via postMessage.
 * - Prevents GPU->CPU pipeline stalls and main thread thermal throttling.
 */

import { VisionEngine, VisionResult } from "./vision-engine";

const engine = new VisionEngine();

export type VisionWorkerMessage =
  | { action: "analyze"; imageBitmap: ImageBitmap }
  | { action: "reset" };

export type VisionWorkerResponse =
  | { type: "result"; result: VisionResult }
  | { type: "reset_done" };

self.onmessage = (e: MessageEvent<VisionWorkerMessage>) => {
  const data = e.data;
  if (data.action === "reset") {
    engine.reset();
    self.postMessage({ type: "reset_done" });
    return;
  }

  if (data.action === "analyze" && data.imageBitmap) {
    const bitmap = data.imageBitmap;
    try {
      const result = engine.analyze(bitmap);
      self.postMessage({ type: "result", result });
    } finally {
      // Always close ImageBitmap to prevent memory leaks in Web Worker
      bitmap.close();
    }
  }
};
