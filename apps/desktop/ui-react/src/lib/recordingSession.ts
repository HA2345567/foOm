import type { NativeCursorType } from "@/native/contracts";

const NATIVE_CURSOR_TYPES: NativeCursorType[] = [
  "arrow", "text", "pointer", "crosshair", "open-hand", "closed-hand", "resize-ew",
  "resize-ns", "resize-nesw", "resize-nwse", "move", "not-allowed", "wait",
  "app-starting", "help", "up-arrow",
];

export interface ProjectMedia {
  screenVideoPath: string;
  webcamVideoPath?: string;
  cursorCaptureMode?: CursorCaptureMode;
}

export type CursorCaptureMode = "editable-overlay" | "system";

export interface RecordingSession extends ProjectMedia {
  createdAt: number;
  durationMs?: number;
  cursorTelemetry?: CursorTelemetrySample[];
}

export interface RecordedVideoAssetInput {
  fileName: string;
  videoData: ArrayBuffer;
}

export interface CursorTelemetrySample {
  timeMs: number;
  cx: number;
  cy: number;
  visible?: boolean;
  cursorType?: NativeCursorType;
  interactionType?: "move" | "click" | "double-click" | "right-click" | "middle-click" | "mouseup";
}

export interface StoreRecordedSessionInput {
  screen: RecordedVideoAssetInput;
  webcam?: RecordedVideoAssetInput;
  createdAt?: number;
  durationMs?: number;
  cursorCaptureMode?: CursorCaptureMode;
  cursorTelemetry?: CursorTelemetrySample[];
}

export function normalizeCursorCaptureMode(value: unknown): CursorCaptureMode | undefined {
  return value === "editable-overlay" || value === "system" ? value : undefined;
}

function normalizePath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeProjectMedia(candidate: unknown): ProjectMedia | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const raw = candidate as Partial<ProjectMedia>;
  const screenVideoPath = normalizePath(raw.screenVideoPath);

  if (!screenVideoPath) {
    return null;
  }

  const webcamVideoPath = normalizePath(raw.webcamVideoPath);
  const cursorCaptureMode = normalizeCursorCaptureMode(raw.cursorCaptureMode);

  return {
    screenVideoPath,
    ...(webcamVideoPath ? { webcamVideoPath } : {}),
    ...(cursorCaptureMode ? { cursorCaptureMode } : {}),
  };
}

export function normalizeRecordingSession(candidate: unknown): RecordingSession | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const raw = candidate as Partial<RecordingSession>;
  const media = normalizeProjectMedia(raw);
  if (!media) {
    return null;
  }

  return {
    ...media,
    createdAt:
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : Date.now(),
    ...(typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs > 0
      ? { durationMs: raw.durationMs }
      : {}),
    ...(Array.isArray(raw.cursorTelemetry)
      ? { cursorTelemetry: normalizeCursorTelemetrySamples(raw.cursorTelemetry) }
      : {}),
  };
}

export function normalizeCursorTelemetrySamples(candidate: unknown): CursorTelemetrySample[] {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .map((sample): CursorTelemetrySample | null => {
      if (
        !sample ||
        typeof sample !== "object" ||
        !Number.isFinite(Number((sample as CursorTelemetrySample).timeMs)) ||
        !Number.isFinite(Number((sample as CursorTelemetrySample).cx)) ||
        !Number.isFinite(Number((sample as CursorTelemetrySample).cy))
      ) {
        return null;
      }

      const raw = sample as CursorTelemetrySample;
      const interactionType = ["click", "double-click", "right-click", "middle-click", "mouseup", "move"].includes(
        String(raw.interactionType),
      )
        ? raw.interactionType
        : undefined;
      return {
        timeMs: Math.max(0, Number(raw.timeMs)),
        cx: Math.max(0, Math.min(Number(raw.cx), 1)),
        cy: Math.max(0, Math.min(Number(raw.cy), 1)),
        visible: raw.visible !== false,
        cursorType: NATIVE_CURSOR_TYPES.includes(raw.cursorType as NativeCursorType)
          ? (raw.cursorType as NativeCursorType)
          : "arrow",
        ...(interactionType ? { interactionType } : {}),
      };
    })
    .filter((sample): sample is CursorTelemetrySample => Boolean(sample));
}
