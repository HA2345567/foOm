import type { AnnotationRegion, TrimRegion } from "@/components/vedio-editor/types";

export const MAX_CAPTION_AUDIO_SEC = 600; // 10 minutes

export interface CaptionSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export async function extractMono16kFromVideoUrl(videoUrl: string): Promise<{
  samples: Float32Array;
  truncated: boolean;
  durationSec: number;
}> {
  throw new Error(
    "Automatic captions are unavailable: this build has no transcription engine. Add captions manually in the Captions panel.",
  );
}

export function trimLeadingSilenceMono16k(samples: Float32Array): {
  samples: Float32Array;
  trimSec: number;
} {
  return {
    samples,
    trimSec: 0,
  };
}

export function shiftTrimRegionsMsForCaptionBuffer(
  trimRegions: TrimRegion[],
  trimMs: number,
): TrimRegion[] {
  return trimRegions.map((region) => ({
    ...region,
    startMs: Math.max(0, region.startMs - trimMs),
    endMs: Math.max(0, region.endMs - trimMs),
  }));
}

export async function transcribeMono16kToSegments(
  samples: Float32Array,
  options?: {
    trimRegions?: TrimRegion[];
    onStatus?: (phase: "model" | "transcribe") => void;
  },
): Promise<{
  segments: CaptionSegment[];
  granularity: "word" | "segment";
}> {
  throw new Error(
    "Automatic captions are unavailable: this build has no transcription engine. Add captions manually in the Captions panel.",
  );
}

export function captionSegmentsToAnnotationRegions(
  segments: CaptionSegment[],
  nextId: number,
  nextZIndex: number,
  options?: {
    minWordsPerCaption?: number;
    maxWordsPerCaption?: number;
    timestampGranularity?: "word" | "segment";
  },
): {
  regions: AnnotationRegion[];
  nextNumericId: number;
  nextZIndex: number;
} {
  return {
    regions: [],
    nextNumericId: nextId,
    nextZIndex: nextZIndex,
  };
}

export function reconcileAutoCaptionTimelineGaps(regions: AnnotationRegion[]): AnnotationRegion[] {
  return regions;
}
