/**
 * @file audio-worker.ts
 * @description Web Worker for non-blocking off-main-thread audio analysis and silence detection.
 *
 * Performance Contract:
 * - Offloads Float32Array PCM analysis for silence detection.
 * - Prevents 200-400ms main-thread freezes during audio buffer parsing.
 */

export interface SilenceSegment {
  start: number; // in seconds
  end: number; // in seconds
  duration: number; // in seconds
}

export type AudioWorkerMessage = {
  action: "detect_silence";
  channelData: Float32Array;
  sampleRate: number;
  thresholdDb?: number; // default -40dB
  minSilenceDurationSec?: number; // default 0.5s
};

export type AudioWorkerResponse = {
  type: "silence_detected";
  segments: SilenceSegment[];
};

self.onmessage = (e: MessageEvent<AudioWorkerMessage>) => {
  const { action, channelData, sampleRate, thresholdDb = -40, minSilenceDurationSec = 0.5 } = e.data;

  if (action === "detect_silence" && channelData) {
    const amplitudeThreshold = Math.pow(10, thresholdDb / 20);
    const windowSize = Math.floor(sampleRate * 0.05); // 50ms window
    const minSilenceSamples = Math.floor(sampleRate * minSilenceDurationSec);

    const segments: SilenceSegment[] = [];
    let silenceStartSample: number | null = null;

    for (let i = 0; i < channelData.length; i += windowSize) {
      let sumRms = 0;
      const count = Math.min(windowSize, channelData.length - i);

      for (let j = 0; j < count; j++) {
        const val = channelData[i + j];
        sumRms += val * val;
      }

      const rms = Math.sqrt(sumRms / count);
      const isSilent = rms < amplitudeThreshold;

      if (isSilent) {
        if (silenceStartSample === null) {
          silenceStartSample = i;
        }
      } else {
        if (silenceStartSample !== null) {
          const silenceDurationSamples = i - silenceStartSample;
          if (silenceDurationSamples >= minSilenceSamples) {
            const start = silenceStartSample / sampleRate;
            const end = i / sampleRate;
            segments.push({ start, end, duration: end - start });
          }
          silenceStartSample = null;
        }
      }
    }

    // Trailing silence check
    if (silenceStartSample !== null) {
      const silenceDurationSamples = channelData.length - silenceStartSample;
      if (silenceDurationSamples >= minSilenceSamples) {
        const start = silenceStartSample / sampleRate;
        const end = channelData.length / sampleRate;
        segments.push({ start, end, duration: end - start });
      }
    }

    self.postMessage({ type: "silence_detected", segments });
  }
};
