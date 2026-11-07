import { readPaddingEdges, type PaddingEdges } from "@/lib/canvasPadding";
import { normalizeBlurColor, normalizeBlurType } from "@/lib/blurEffects";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import type { ProjectMedia } from "@/lib/recordingSession";
import { normalizeProjectMedia } from "@/lib/recordingSession";
import { normalizeCursorThemeId } from "@/lib/cursor/cursorThemes";
import { DEFAULT_WALLPAPER, WALLPAPER_PATHS } from "@/lib/wallpaper";
import { ASPECT_RATIOS, type AspectRatio, isPortraitAspectRatio } from "@/utils/aspectRatioUtils";
import {
  DEFAULT_EDITOR_APPEARANCE_SETTINGS,
  DEFAULT_EDITOR_LAYOUT_SETTINGS,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_GIF_SETTINGS,
  DEFAULT_WEBCAM_SETTINGS,
  DEFAULT_CURSOR_SETTINGS,
  MAX_EDITOR_PADDING,
} from "./editorDefaults";
import {
  type AnnotationRegion,
  type CropRegion,
  clampPlaybackSpeed,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_BLUR_BLOCK_SIZE,
  DEFAULT_BLUR_DATA,
  DEFAULT_BLUR_FREEHAND_POINTS,
  DEFAULT_BLUR_INTENSITY,
  DEFAULT_FIGURE_DATA,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_ZOOM_DEPTH,
  DEFAULT_ZOOM_MOTION_BLUR,
  MAX_BLUR_BLOCK_SIZE,
  MAX_BLUR_INTENSITY,
  MAX_PLAYBACK_SPEED,
  MIN_BLUR_BLOCK_SIZE,
  MIN_BLUR_INTENSITY,
  MIN_PLAYBACK_SPEED,
  type SpeedRegion,
  type TrimRegion,
  type WebcamLayoutPreset,
  type WebcamMaskShape,
  type WebcamPosition,
  type WebcamSizePreset,
  type ZoomRegion,
} from "./types";

const VALID_BLUR_SHAPES = new Set(["rectangle", "oval", "freehand"] as const);

// Pre-fix projects could persist resolved file:// URLs (machine-specific) for
// bundled wallpapers. Rewrite only paths that match a known install layout
// (resources/[assets/]wallpapers|wallp for packaged, public/wallpapers|wallp
// for dev) so a legitimate user file that happens to live in a folder named
// "wallpapers" or "wallp"
// elsewhere is never silently replaced.
const LEGACY_FILE_WALLPAPER_RE =
  /^file:\/\/.*?\/(?:resources\/(?:assets\/)?|public\/)(?:wallpapers|wallp)\/((?:wallpaper)?\d+\.(?:jpg|jpeg|png))$/i;
const CANONICAL_WALLPAPERS = new Set(WALLPAPER_PATHS);
const LEGACY_WALLPAPER_BASENAME_TO_CANONICAL = new Map(
  WALLPAPER_PATHS.map((path) => [path.split("/").pop()?.toLowerCase(), path] as const),
);

function normalizeWallpaperValue(value: string): string {
  const match = LEGACY_FILE_WALLPAPER_RE.exec(value);
  if (!match) return value;
  let filename = match[1].toLowerCase();
  
  // Map legacy "wallpaperX.jpg" (for X = 1..5) to "0X.jpg"
  const legacyMatch = /^wallpaper([1-5])\.(jpg|jpeg|png)$/i.exec(filename);
  if (legacyMatch) {
    filename = `0${legacyMatch[1]}.${legacyMatch[2]}`;
  }

  const canonical = LEGACY_WALLPAPER_BASENAME_TO_CANONICAL.get(filename);
  return canonical && CANONICAL_WALLPAPERS.has(canonical) ? canonical : DEFAULT_WALLPAPER;
}

export const PROJECT_VERSION = 2;

import { normalizeSoundtrack, type Soundtrack } from "@/lib/soundtrack";

export interface ProjectEditorState {
  soundtrack?: Soundtrack | null;
  wallpaper: string;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurAmount: number;
  borderRadius: number;
  padding: number;
  paddingEdges?: PaddingEdges;
  cropRegion: CropRegion;
  zoomRegions: ZoomRegion[];
  trimRegions: TrimRegion[];
  speedRegions: SpeedRegion[];
  annotationRegions: AnnotationRegion[];
  aspectRatio: AspectRatio;
  webcamLayoutPreset: WebcamLayoutPreset;
  webcamMaskShape: WebcamMaskShape;
  webcamSizePreset: WebcamSizePreset;
  webcamPosition: WebcamPosition | null;
  exportQuality: ExportQuality;
  exportFormat: ExportFormat;
  noiseReductionEnabled: boolean;
  noiseReductionAmount: number;
  gifFrameRate: GifFrameRate;
  gifLoop: boolean;
  gifSizePreset: GifSizePreset;
  autoZoomEnabled: boolean;
  autoFocusAll: boolean;
  showTrimWaveform: boolean;
  webcamMirrored: boolean;
  webcamReactiveZoom: boolean;
  cursorTheme: string;
  showCursor: boolean;
  cursorSize: number;
  cursorSmoothing: number;
  cursorMotionBlur: number;
  cursorClickBounce: number;
  cursorClipToBounds: boolean;
}

export interface EditorProjectData {
  version: number;
  media?: ProjectMedia;
  editor: ProjectEditorState;
  videoPath?: string;
  documentVersion?: number;
  cameraVideoPath?: string;
}

type NativeRecordingDocument = {
  documentVersion?: number;
  media?: unknown;
  editor?: Partial<ProjectEditorState>;
  videoPath?: unknown;
  rawVideoPath?: unknown;
  raw_video_path?: unknown;
  cameraVideoPath?: unknown;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function computeNormalizedWebcamLayoutPreset(
  webcamLayoutPreset: Partial<ProjectEditorState>["webcamLayoutPreset"],
  normalizedAspectRatio: AspectRatio,
): WebcamLayoutPreset {
  switch (webcamLayoutPreset) {
    case "picture-in-picture":
    case "no-webcam":
    case "screen-left-webcam-right":
    case "webcam-left-screen-right":
    case "webcam-top-screen-bottom":
    case "screen-top-webcam-bottom":
      return webcamLayoutPreset;
    case "vertical-stack":
      return isPortraitAspectRatio(normalizedAspectRatio)
        ? webcamLayoutPreset
        : DEFAULT_WEBCAM_SETTINGS.layoutPreset;
    case "dual-frame":
      return isPortraitAspectRatio(normalizedAspectRatio)
        ? DEFAULT_WEBCAM_SETTINGS.layoutPreset
        : webcamLayoutPreset;
    default:
      return DEFAULT_WEBCAM_SETTINGS.layoutPreset;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeEditorPadding(value: unknown): number {
  if (!isFiniteNumber(value)) {
    return DEFAULT_EDITOR_LAYOUT_SETTINGS.padding;
  }
  return clamp(value, 0, MAX_EDITOR_PADDING);
}

function encodePathSegments(pathname: string, keepWindowsDrive = false): string {
  return pathname
    .split("/")
    .map((segment, index) => {
      if (!segment) {
        return segment;
      }
      if (keepWindowsDrive && index === 0 && /^[a-zA-Z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join("/");
}

export function toFileUrl(filePath: string): string {
  if (/^(blob:|data:|https?:|file:|indexeddb:)/i.test(filePath)) {
    return filePath;
  }
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.match(/^[a-zA-Z]:/)) {
    return `file:///${encodePathSegments(normalized, true)}`;
  }
  if (normalized.startsWith("//")) {
    const withoutPrefix = normalized.slice(2);
    const [host = "", ...segments] = withoutPrefix.split("/");
    return `file://${host}/${encodePathSegments(segments.join("/"))}`;
  }
  const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodePathSegments(absolutePath)}`;
}

export function fromFileUrl(fileUrl: string): string {
  if (!fileUrl.startsWith("file://")) {
    return fileUrl;
  }

  try {
    const url = new URL(fileUrl);
    const pathname = decodeURIComponent(url.pathname);

    if (url.host && url.host !== "localhost") {
      return `//${url.host}${pathname}`;
    }

    if (/^\/[a-zA-Z]:/.test(pathname)) {
      return pathname.slice(1);
    }

    return pathname;
  } catch {
    const fallbackPath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ""));
    return fallbackPath.replace(/^\/([a-zA-Z]:)/, "$1");
  }
}

export function deriveNextId(prefix: string, ids: string[]): number {
  const max = ids.reduce((acc, id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) return acc;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(acc, value) : acc;
  }, 0);
  return max + 1;
}

export function validateProjectData(candidate: unknown): candidate is EditorProjectData {
  if (!candidate || typeof candidate !== "object") return false;
  const project = candidate as Partial<EditorProjectData> & NativeRecordingDocument;
  if (typeof project.version !== "number" && typeof project.documentVersion !== "number") {
    return false;
  }
  if (!resolveProjectMedia(project)) return false;
  if (!project.editor || typeof project.editor !== "object") return false;
  return true;
}

export function resolveProjectMedia(
  candidate:
    | Partial<EditorProjectData>
    | NativeRecordingDocument
    | { media?: unknown; videoPath?: unknown },
): ProjectMedia | null {
  const media = normalizeProjectMedia(candidate.media);
  if (media) {
    return media;
  }

  const rawMedia =
    candidate.media && typeof candidate.media === "object"
      ? (candidate.media as Record<string, unknown>)
      : null;
  const screenVideoPath =
    typeof rawMedia?.rawVideoPath === "string" && rawMedia.rawVideoPath.trim()
      ? rawMedia.rawVideoPath
      : typeof rawMedia?.screenVideoPath === "string" && rawMedia.screenVideoPath.trim()
        ? rawMedia.screenVideoPath
        : typeof (candidate as NativeRecordingDocument).rawVideoPath === "string" &&
          ((candidate as NativeRecordingDocument).rawVideoPath as string).trim()
          ? ((candidate as NativeRecordingDocument).rawVideoPath as string)
          : typeof (candidate as NativeRecordingDocument).raw_video_path === "string" &&
            ((candidate as NativeRecordingDocument).raw_video_path as string).trim()
            ? ((candidate as NativeRecordingDocument).raw_video_path as string)
            : null;
  if (screenVideoPath) {
    const webcamVideoPath =
      typeof rawMedia?.cameraVideoPath === "string" && rawMedia.cameraVideoPath.trim()
        ? rawMedia.cameraVideoPath
        : typeof rawMedia?.webcamVideoPath === "string" && rawMedia.webcamVideoPath.trim()
          ? rawMedia.webcamVideoPath
          : typeof (candidate as NativeRecordingDocument).cameraVideoPath === "string" &&
            ((candidate as NativeRecordingDocument).cameraVideoPath as string).trim()
            ? ((candidate as NativeRecordingDocument).cameraVideoPath as string)
            : undefined;
    return {
      screenVideoPath,
      ...(webcamVideoPath ? { webcamVideoPath } : {}),
    };
  }

  if (typeof candidate.videoPath === "string" && candidate.videoPath.trim()) {
    return { screenVideoPath: candidate.videoPath };
  }

  return null;
}

export function normalizeProjectEditor(editor: Partial<ProjectEditorState>): ProjectEditorState {
  const validAspectRatios = new Set<AspectRatio>(ASPECT_RATIOS);
  const normalizedAspectRatio: AspectRatio = validAspectRatios.has(
    editor.aspectRatio as AspectRatio,
  )
    ? (editor.aspectRatio as AspectRatio)
    : DEFAULT_EDITOR_LAYOUT_SETTINGS.aspectRatio;
  const normalizedWebcamLayoutPreset = computeNormalizedWebcamLayoutPreset(
    editor.webcamLayoutPreset,
    normalizedAspectRatio,
  );
  const normalizedWebcamPosition: WebcamPosition | null =
    normalizedWebcamLayoutPreset === "picture-in-picture" &&
      editor.webcamPosition &&
      typeof editor.webcamPosition === "object" &&
      isFiniteNumber((editor.webcamPosition as WebcamPosition).cx) &&
      isFiniteNumber((editor.webcamPosition as WebcamPosition).cy)
      ? {
        cx: clamp((editor.webcamPosition as WebcamPosition).cx, 0, 1),
        cy: clamp((editor.webcamPosition as WebcamPosition).cy, 0, 1),
      }
      : DEFAULT_WEBCAM_SETTINGS.position;

  const normalizedZoomRegions: ZoomRegion[] = Array.isArray(editor.zoomRegions)
    ? editor.zoomRegions
      .filter((region): region is ZoomRegion => Boolean(region && typeof region.id === "string"))
      .map((region) => {
        const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
        const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
        const startMs = Math.max(0, Math.min(rawStart, rawEnd));
        const endMs = Math.max(startMs + 1, rawEnd);

        const validPreset =
          region.rotationPreset === "iso" ||
            region.rotationPreset === "left" ||
            region.rotationPreset === "right"
            ? region.rotationPreset
            : undefined;
        return {
          id: region.id,
          startMs,
          endMs,
          depth: [1, 2, 3, 4, 5, 6].includes(region.depth) ? region.depth : DEFAULT_ZOOM_DEPTH,
          focus: {
            cx: clamp(isFiniteNumber(region.focus?.cx) ? region.focus.cx : 0.5, 0, 1),
            cy: clamp(isFiniteNumber(region.focus?.cy) ? region.focus.cy : 0.5, 0, 1),
          },
          focusMode: region.focusMode === "auto" ? "auto" : "manual",
          ...(validPreset ? { rotationPreset: validPreset } : {}),
        };
      })
    : [];

  const normalizedTrimRegions: TrimRegion[] = Array.isArray(editor.trimRegions)
    ? editor.trimRegions
      .filter((region): region is TrimRegion => Boolean(region && typeof region.id === "string"))
      .map((region) => {
        const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
        const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
        const startMs = Math.max(0, Math.min(rawStart, rawEnd));
        const endMs = Math.max(startMs + 1, rawEnd);
        return {
          id: region.id,
          startMs,
          endMs,
        };
      })
    : [];

  const normalizedSpeedRegions: SpeedRegion[] = Array.isArray(editor.speedRegions)
    ? editor.speedRegions
      .filter((region): region is SpeedRegion => Boolean(region && typeof region.id === "string"))
      .map((region) => {
        const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
        const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
        const startMs = Math.max(0, Math.min(rawStart, rawEnd));
        const endMs = Math.max(startMs + 1, rawEnd);

        const speed =
          isFiniteNumber(region.speed) &&
            region.speed >= MIN_PLAYBACK_SPEED &&
            region.speed <= MAX_PLAYBACK_SPEED
            ? clampPlaybackSpeed(region.speed)
            : DEFAULT_PLAYBACK_SPEED;

        return {
          id: region.id,
          startMs,
          endMs,
          speed,
        };
      })
    : [];

  const normalizedAnnotationRegions: AnnotationRegion[] = Array.isArray(editor.annotationRegions)
    ? editor.annotationRegions
      .filter((region): region is AnnotationRegion =>
        Boolean(region && typeof region.id === "string"),
      )
      .map((region, index) => {
        const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
        const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
        const startMs = Math.max(0, Math.min(rawStart, rawEnd));
        const endMs = Math.max(startMs + 1, rawEnd);
        const blurShape =
          typeof region.blurData?.shape === "string" &&
            VALID_BLUR_SHAPES.has(region.blurData.shape)
            ? region.blurData.shape
            : DEFAULT_BLUR_DATA.shape;
        const blurType = normalizeBlurType(region.blurData?.type);
        const blurColor = normalizeBlurColor(region.blurData?.color);

        return {
          id: region.id,
          startMs,
          endMs,
          type:
            region.type === "image" || region.type === "figure" || region.type === "blur"
              ? region.type
              : "text",
          content: typeof region.content === "string" ? region.content : "",
          textContent: typeof region.textContent === "string" ? region.textContent : undefined,
          imageContent: typeof region.imageContent === "string" ? region.imageContent : undefined,
          position: {
            x: clamp(
              isFiniteNumber(region.position?.x)
                ? region.position.x
                : DEFAULT_ANNOTATION_POSITION.x,
              0,
              100,
            ),
            y: clamp(
              isFiniteNumber(region.position?.y)
                ? region.position.y
                : DEFAULT_ANNOTATION_POSITION.y,
              0,
              100,
            ),
          },
          size: {
            width: clamp(
              isFiniteNumber(region.size?.width)
                ? region.size.width
                : DEFAULT_ANNOTATION_SIZE.width,
              1,
              200,
            ),
            height: clamp(
              isFiniteNumber(region.size?.height)
                ? region.size.height
                : DEFAULT_ANNOTATION_SIZE.height,
              1,
              200,
            ),
          },
          style: {
            ...DEFAULT_ANNOTATION_STYLE,
            ...(region.style && typeof region.style === "object" ? region.style : {}),
          },
          zIndex: isFiniteNumber(region.zIndex) ? region.zIndex : index + 1,
          figureData: region.figureData
            ? {
              ...DEFAULT_FIGURE_DATA,
              ...region.figureData,
            }
            : undefined,
          blurData:
            region.blurData && typeof region.blurData === "object"
              ? {
                ...DEFAULT_BLUR_DATA,
                ...region.blurData,
                type: blurType,
                shape: blurShape,
                color: blurColor,
                intensity: isFiniteNumber(region.blurData.intensity)
                  ? clamp(region.blurData.intensity, MIN_BLUR_INTENSITY, MAX_BLUR_INTENSITY)
                  : DEFAULT_BLUR_INTENSITY,
                blockSize: isFiniteNumber(region.blurData.blockSize)
                  ? clamp(region.blurData.blockSize, MIN_BLUR_BLOCK_SIZE, MAX_BLUR_BLOCK_SIZE)
                  : DEFAULT_BLUR_BLOCK_SIZE,
                freehandPoints: Array.isArray(region.blurData.freehandPoints)
                  ? region.blurData.freehandPoints
                    .filter(
                      (
                        point,
                      ): point is {
                        x: number;
                        y: number;
                      } =>
                        Boolean(
                          point &&
                          isFiniteNumber((point as { x?: unknown }).x) &&
                          isFiniteNumber((point as { y?: unknown }).y),
                        ),
                    )
                    .map((point) => ({
                      x: clamp(point.x, 0, 100),
                      y: clamp(point.y, 0, 100),
                    }))
                  : DEFAULT_BLUR_FREEHAND_POINTS,
              }
              : undefined,
        };
      })
    : [];

  const rawCropX = isFiniteNumber(editor.cropRegion?.x)
    ? editor.cropRegion.x
    : DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.x;
  const rawCropY = isFiniteNumber(editor.cropRegion?.y)
    ? editor.cropRegion.y
    : DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.y;
  const rawCropWidth = isFiniteNumber(editor.cropRegion?.width)
    ? editor.cropRegion.width
    : DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.width;
  const rawCropHeight = isFiniteNumber(editor.cropRegion?.height)
    ? editor.cropRegion.height
    : DEFAULT_EDITOR_LAYOUT_SETTINGS.cropRegion.height;

  const cropX = clamp(rawCropX, 0, 1);
  const cropY = clamp(rawCropY, 0, 1);
  const cropWidth = clamp(rawCropWidth, 0.01, 1 - cropX);
  const cropHeight = clamp(rawCropHeight, 0.01, 1 - cropY);

  return {
    wallpaper:
      typeof editor.wallpaper === "string"
        ? normalizeWallpaperValue(editor.wallpaper)
        : DEFAULT_EDITOR_LAYOUT_SETTINGS.wallpaper,
    shadowIntensity:
      typeof editor.shadowIntensity === "number"
        ? editor.shadowIntensity
        : DEFAULT_EDITOR_APPEARANCE_SETTINGS.shadowIntensity,
    showBlur:
      typeof editor.showBlur === "boolean"
        ? editor.showBlur
        : DEFAULT_EDITOR_APPEARANCE_SETTINGS.showBlur,
    motionBlurAmount: isFiniteNumber(editor.motionBlurAmount)
      ? clamp(editor.motionBlurAmount, 0, 1)
      : typeof (editor as { motionBlurEnabled?: unknown }).motionBlurEnabled === "boolean"
        ? (editor as { motionBlurEnabled?: boolean }).motionBlurEnabled
          ? DEFAULT_ZOOM_MOTION_BLUR
          : DEFAULT_EDITOR_APPEARANCE_SETTINGS.motionBlurAmount
        : DEFAULT_EDITOR_APPEARANCE_SETTINGS.motionBlurAmount,
    borderRadius:
      typeof editor.borderRadius === "number"
        ? editor.borderRadius
        : DEFAULT_EDITOR_APPEARANCE_SETTINGS.borderRadius,
    padding: normalizeEditorPadding(editor.padding),
    paddingEdges: readPaddingEdges(editor.paddingEdges),
    cropRegion: {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
    },
    zoomRegions: normalizedZoomRegions,
    trimRegions: normalizedTrimRegions,
    speedRegions: normalizedSpeedRegions,
    annotationRegions: normalizedAnnotationRegions,
    aspectRatio: normalizedAspectRatio,
    webcamLayoutPreset: normalizedWebcamLayoutPreset,
    webcamMaskShape:
      editor.webcamMaskShape === "rectangle" ||
        editor.webcamMaskShape === "circle" ||
        editor.webcamMaskShape === "square" ||
        editor.webcamMaskShape === "rounded"
        ? editor.webcamMaskShape
        : DEFAULT_WEBCAM_SETTINGS.maskShape,
    webcamSizePreset:
      typeof editor.webcamSizePreset === "number" && isFiniteNumber(editor.webcamSizePreset)
        ? Math.max(10, Math.min(50, editor.webcamSizePreset))
        : DEFAULT_WEBCAM_SETTINGS.sizePreset,
    webcamPosition: normalizedWebcamPosition,
    exportQuality:
      (editor.exportQuality as unknown) === "low" || editor.exportQuality === "medium"
        ? "medium"
        : editor.exportQuality === "good"
          ? "good"
          : (editor.exportQuality as unknown) === "ultra" || editor.exportQuality === "source"
            ? "source"
            : DEFAULT_EXPORT_SETTINGS.quality,
    exportFormat: editor.exportFormat === "gif" ? "gif" : DEFAULT_EXPORT_SETTINGS.format,
    soundtrack: normalizeSoundtrack(editor.soundtrack),
    noiseReductionEnabled:
      typeof editor.noiseReductionEnabled === "boolean"
        ? editor.noiseReductionEnabled
        : false,
    noiseReductionAmount: isFiniteNumber(editor.noiseReductionAmount)
      ? clamp(editor.noiseReductionAmount, 0, 1)
      : 0.45,
    gifFrameRate:
      editor.gifFrameRate === 15 ||
        editor.gifFrameRate === 20 ||
        editor.gifFrameRate === 25 ||
        editor.gifFrameRate === 30
        ? editor.gifFrameRate
        : DEFAULT_GIF_SETTINGS.frameRate,
    gifLoop: typeof editor.gifLoop === "boolean" ? editor.gifLoop : DEFAULT_GIF_SETTINGS.loop,
    gifSizePreset:
      editor.gifSizePreset === "medium" ||
        editor.gifSizePreset === "large" ||
        editor.gifSizePreset === "original"
        ? editor.gifSizePreset
        : DEFAULT_GIF_SETTINGS.sizePreset,
    autoZoomEnabled: typeof editor.autoZoomEnabled === "boolean" ? editor.autoZoomEnabled : true,
    autoFocusAll: typeof editor.autoFocusAll === "boolean" ? editor.autoFocusAll : false,
    showTrimWaveform: typeof editor.showTrimWaveform === "boolean" ? editor.showTrimWaveform : true,
    webcamMirrored: typeof editor.webcamMirrored === "boolean" ? editor.webcamMirrored : false,
    webcamReactiveZoom:
      typeof editor.webcamReactiveZoom === "boolean"
        ? editor.webcamReactiveZoom
        : DEFAULT_WEBCAM_SETTINGS.reactiveZoom,
    cursorTheme: normalizeCursorThemeId(editor.cursorTheme ?? DEFAULT_CURSOR_SETTINGS.theme),
    showCursor: typeof editor.showCursor === "boolean" ? editor.showCursor : DEFAULT_CURSOR_SETTINGS.show,
    cursorSize: isFiniteNumber(editor.cursorSize) ? clamp(editor.cursorSize, 0.5, 10) : DEFAULT_CURSOR_SETTINGS.size,
    cursorSmoothing: isFiniteNumber(editor.cursorSmoothing) ? clamp(editor.cursorSmoothing, 0, 1) : DEFAULT_CURSOR_SETTINGS.smoothing,
    cursorMotionBlur: isFiniteNumber(editor.cursorMotionBlur) ? clamp(editor.cursorMotionBlur, 0, 1) : DEFAULT_CURSOR_SETTINGS.motionBlur,
    cursorClickBounce: isFiniteNumber(editor.cursorClickBounce) ? clamp(editor.cursorClickBounce, 0, 5) : DEFAULT_CURSOR_SETTINGS.clickBounce,
    cursorClipToBounds: typeof editor.cursorClipToBounds === "boolean" ? editor.cursorClipToBounds : DEFAULT_CURSOR_SETTINGS.clipToBounds,
  };
}

export function createProjectData(
  media: ProjectMedia,
  editor: Partial<ProjectEditorState>,
): EditorProjectData {
  return {
    version: PROJECT_VERSION,
    media,
    editor: normalizeProjectEditor(editor),
  };
}

export function createProjectSnapshot(
  media: ProjectMedia,
  editor: Partial<ProjectEditorState>,
): string {
  return JSON.stringify(createProjectData(media, normalizeProjectEditor(editor)));
}

export function hasProjectUnsavedChanges(
  currentSnapshot: string | null,
  baselineSnapshot: string | null,
): boolean {
  return Boolean(
    currentSnapshot !== null && baselineSnapshot !== null && currentSnapshot !== baselineSnapshot,
  );
}
