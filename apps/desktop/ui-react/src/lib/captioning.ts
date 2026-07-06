import type { AnnotationRegion, TrimRegion } from "@/components/video-editor/types";

export const MAX_CAPTION_AUDIO_SEC = 600; // 10 minutes

export async function extractMono16kFromVideoUrl(videoUrl: string): Promise<{
  samples: Float32Array;
  truncated: boolean;
  durationSec: number;
}> {
  console.log("Mock extractMono16kFromVideoUrl called for:", videoUrl);
  return {
    samples: new Float32Array(0),
    truncated: false,
    durationSec: 0,
  };
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
  trimMs: number
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
  }
): Promise<{
  segments: any[];
  granularity: "word" | "segment";
}> {
  console.log("Mock transcribeMono16kToSegments called");
  if (options?.onStatus) {
    options.onStatus("model");
    await new Promise((resolve) => setTimeout(resolve, 500));
    options.onStatus("transcribe");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    segments: [],
    granularity: "word",
  };
}

export function captionSegmentsToAnnotationRegions(
  segments: any[],
  nextId: number,
  nextZIndex: number,
  options?: {
    minWordsPerCaption?: number;
    maxWordsPerCaption?: number;
    timestampGranularity?: "word" | "segment";
  }
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
