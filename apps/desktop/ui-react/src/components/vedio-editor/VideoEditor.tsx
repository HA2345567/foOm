import type { Span } from "dnd-timeline";
import { Clapperboard, CloudUpload, FolderOpen, KeyRound, Save, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { INITIAL_EDITOR_STATE, useEditorHistory } from "@/hooks/useEditorHistory";
import { hasNativeCursorRecordingData } from "@/lib/cursor/nativeCursor";
import {
  calculateEffectiveSourceDimensions,
  calculateMp4ExportSettings,
  calculateOutputDimensions,
  type ExportFormat,
  type ExportProgress,
  type ExportQuality,
  type ExportSettings,
  GIF_SIZE_PRESETS,
  GifExporter,
  type GifFrameRate,
  type GifSizePreset,
  VideoExporter,
} from "@/lib/exporter";
import { computeFrameStepTime } from "@/lib/frameStep";
import type { CursorCaptureMode, ProjectMedia } from "@/lib/recordingSession";
import { matchesShortcut } from "@/lib/shortcuts";
import {
  getExportFolder,
  loadUserPreferences,
  parentDirectoryOf,
  saveUserPreferences,
} from "@/lib/userPreferences";
import { BackgroundLoadError } from "@/lib/wallpaper";
import { nativeBridgeClient, useCursorRecordingData, useCursorTelemetry } from "@/native";
import type { NativePlatform } from "@/native/contracts";
import {
  getAspectRatioValue,
  getNativeAspectRatioValue,
  isPortraitAspectRatio,
} from "@/utils/aspectRatioUtils";
import { ExportDialog } from "./ExportDialog";
import {
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_EDITOR_LAYOUT_SETTINGS,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_GIF_SETTINGS,
  DEFAULT_SOURCE_DIMENSIONS,
} from "./editorDefaults";
import PlaybackControls from "./PlaybackControls";
import {
  createProjectData,
  createProjectSnapshot,
  deriveNextId,
  fromFileUrl,
  hasProjectUnsavedChanges,
  normalizeProjectEditor,
  resolveProjectMedia,
  toFileUrl,
  validateProjectData,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import TimelineEditor from "./timeline/TimelineEditor";
import {
  detectZoomDwellCandidates,
  normalizeCursorTelemetry,
} from "./timeline/zoomSuggestionUtils";
import {
  type AnnotationRegion,
  type BlurData,
  clampFocusToDepth,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_BLUR_DATA,
  DEFAULT_FIGURE_DATA,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_ZOOM_DEPTH,
  type CursorTelemetryPoint,
  type FigureData,
  type PlaybackSpeed,
  type Rotation3DPreset,
  type SpeedRegion,
  type TrimRegion,
  ZOOM_DEPTH_SCALES,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomFocusMode,
  type ZoomRegion,
} from "./types";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";

const AUTO_ZOOM_SUGGESTION_SPACING_MS = 1800;
const SUPPORTED_TELEMETRY_CURSOR_TYPES = new Set<CursorTelemetryPoint["cursorType"]>([
  "arrow",
  "text",
  "pointer",
  "crosshair",
  "open-hand",
  "closed-hand",
  "resize-ew",
  "resize-ns",
  "not-allowed",
]);

function toTelemetryCursorType(
  cursorType: string | null | undefined,
): CursorTelemetryPoint["cursorType"] {
  return SUPPORTED_TELEMETRY_CURSOR_TYPES.has(cursorType as CursorTelemetryPoint["cursorType"])
    ? (cursorType as CursorTelemetryPoint["cursorType"])
    : undefined;
}

function isClickInteractionType(interactionType: string | null | undefined) {
  return (
    interactionType === "click" ||
    interactionType === "double-click" ||
    interactionType === "right-click" ||
    interactionType === "middle-click"
  );
}

function VideoLoadingIndicator({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="foom-video-loader" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className={`bar${index + 1}`} />
        ))}
      </div>
      <div className="text-sm font-medium text-white/65">{label}</div>
    </div>
  );
}

interface ExportDiagnostics {
  formatLabel: "GIF" | "Video";
  reason?: string;
  sourcePath?: string | null;
  width?: number;
  height?: number;
  frameRate?: number;
  codec?: string;
  bitrate?: number;
}

function getFileNameForDiagnostics(filePath?: string | null) {
  if (!filePath) return "unknown";

  try {
    const url = new URL(filePath);
    if (url.protocol === "file:") {
      return decodeURIComponent(url.pathname).split(/[\\/]/).pop() || filePath;
    }
  } catch {
    // Treat non-URL values as filesystem paths.
  }

  return filePath.split(/[\\/]/).pop() || filePath;
}

function toPlayableVideoUrl(pathOrUrl: string) {
  if (/^(blob:|data:|https?:)/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (
    pathOrUrl.startsWith("/bg/") ||
    pathOrUrl.startsWith("/wallp/") ||
    pathOrUrl === "/foom-demovedio.mp4" ||
    pathOrUrl.startsWith("./")
  ) {
    return pathOrUrl;
  }
  if (window.foomNative?.convertFileSrc) {
    return window.foomNative.convertFileSrc(pathOrUrl);
  }
  return /^(blob:|data:|https?:|file:)/i.test(pathOrUrl) ? pathOrUrl : toFileUrl(pathOrUrl);
}

function isSupportedVideoFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi|wmv)$/i.test(name);
}

function getDroppedFilePath(file: File) {
  const candidate = file as File & { path?: unknown };
  return typeof candidate.path === "string" && candidate.path.trim() ? candidate.path.trim() : null;
}

function getFreshVideoEditorState() {
  const prefs = loadUserPreferences();
  return {
    ...INITIAL_EDITOR_STATE,
    wallpaper: prefs.wallpaper,
    padding: DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
    zoomRegions: [],
    trimRegions: [],
    speedRegions: [],
    annotationRegions: [],
  };
}

function buildExportDiagnosticMessage(diagnostics: ExportDiagnostics) {
  const details = [
    diagnostics.reason ? `Reason: ${diagnostics.reason}` : null,
    `Source: ${getFileNameForDiagnostics(diagnostics.sourcePath)}`,
    diagnostics.width && diagnostics.height
      ? `Output: ${diagnostics.width}x${diagnostics.height}${
          diagnostics.frameRate ? ` @ ${diagnostics.frameRate} fps` : ""
        }`
      : null,
    diagnostics.codec ? `Codec: ${diagnostics.codec}` : null,
    diagnostics.bitrate ? `Bitrate: ${Math.round(diagnostics.bitrate / 1_000_000)} Mbps` : null,
    `VideoEncoder: ${"VideoEncoder" in window ? "available" : "unavailable"}`,
  ].filter(Boolean);

  return `${diagnostics.formatLabel} export failed\n${details.join("\n")}`;
}

function buildSaveDiagnosticMessage(formatLabel: "GIF" | "Video", reason?: string) {
  return `${formatLabel} export save failed${reason ? `\nReason: ${reason}` : ""}`;
}

export default function VideoEditor() {
  const {
    state: editorState,
    pushState,
    updateState,
    commitState,
    undo,
    redo,
  } = useEditorHistory(INITIAL_EDITOR_STATE);

  const {
    zoomRegions,
    trimRegions,
    speedRegions,
    annotationRegions,
    cropRegion,
    wallpaper,
    shadowIntensity,
    showBlur,
    motionBlurAmount,
    borderRadius,
    padding,
    aspectRatio,
    webcamLayoutPreset,
    webcamMaskShape,
    webcamSizePreset,
    webcamPosition,
  } = editorState;

  // ── Non-undoable state
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
  const [webcamVideoPath, setWebcamVideoPath] = useState<string | null>(null);
  const [webcamVideoSourcePath, setWebcamVideoSourcePath] = useState<string | null>(null);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [isPreviewingZoom, setIsPreviewingZoom] = useState(false);
  const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
  const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showNewRecordingDialog, setShowNewRecordingDialog] = useState(false);
  const [isDraggingVideoFile, setIsDraggingVideoFile] = useState(false);
  const [exportQuality, setExportQuality] = useState<ExportQuality>(
    DEFAULT_EXPORT_SETTINGS.quality,
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>(DEFAULT_EXPORT_SETTINGS.format);
  const [noiseReductionEnabled, setNoiseReductionEnabled] = useState(
    DEFAULT_EXPORT_SETTINGS.noiseReduction.enabled,
  );
  const [noiseReductionAmount, setNoiseReductionAmount] = useState(
    DEFAULT_EXPORT_SETTINGS.noiseReduction.amount,
  );
  const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(DEFAULT_GIF_SETTINGS.frameRate);
  const [gifLoop, setGifLoop] = useState(DEFAULT_GIF_SETTINGS.loop);
  const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(
    DEFAULT_GIF_SETTINGS.sizePreset,
  );
  const [exportedFilePath, setExportedFilePath] = useState<string | null>(null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
  const [unsavedExport, setUnsavedExport] = useState<{
    arrayBuffer: ArrayBuffer;
    fileName: string;
    format: string;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const droppedObjectUrlRef = useRef<string | null>(null);
  const cursorTelemetrySourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
  const { samples: cursorTelemetry, error: cursorTelemetryError } =
    useCursorTelemetry(cursorTelemetrySourcePath);
  const { data: cursorRecordingData, error: cursorRecordingDataError } =
    useCursorRecordingData(cursorTelemetrySourcePath);
  const combinedCursorTelemetry = useMemo(() => {
    if (cursorTelemetry.length > 0) {
      return cursorTelemetry;
    }

    return (
      cursorRecordingData?.samples
        .filter((sample) => sample.visible !== false)
        .map((sample): CursorTelemetryPoint => {
          const cursorType = toTelemetryCursorType(sample.cursorType);
          return {
            timeMs: sample.timeMs,
            cx: sample.cx,
            cy: sample.cy,
            ...(sample.interactionType ? { interactionType: sample.interactionType } : {}),
            ...(cursorType ? { cursorType } : {}),
          };
        }) ?? []
    );
  }, [cursorRecordingData, cursorTelemetry]);
  const cursorClickTimestamps = useMemo<number[]>(() => {
    const recordingClicks =
      cursorRecordingData?.samples
        .filter((sample) => isClickInteractionType(sample.interactionType))
        .map((sample) => sample.timeMs) ?? [];
    if (recordingClicks.length > 0) {
      return recordingClicks;
    }

    return cursorTelemetry
      .filter((sample) => isClickInteractionType(sample.interactionType))
      .map((sample) => sample.timeMs);
  }, [cursorRecordingData, cursorTelemetry]);

  // Cursor & motion blur visual settings (non-undoable preferences)
  const [showCursor, setShowCursor] = useState(DEFAULT_CURSOR_SETTINGS.show);
  const [cursorSize, setCursorSize] = useState(DEFAULT_CURSOR_SETTINGS.size);
  const [cursorStyle, setCursorStyle] = useState(DEFAULT_CURSOR_SETTINGS.style);
  const [cursorSmoothing, setCursorSmoothing] = useState(DEFAULT_CURSOR_SETTINGS.smoothing);
  const [cursorMotionBlur, setCursorMotionBlur] = useState(DEFAULT_CURSOR_SETTINGS.motionBlur);
  const [cursorClickBounce, setCursorClickBounce] = useState(DEFAULT_CURSOR_SETTINGS.clickBounce);
  const [cursorClipToBounds, setCursorClipToBounds] = useState(
    DEFAULT_CURSOR_SETTINGS.clipToBounds,
  );
  const [nativePlatform, setNativePlatform] = useState<NativePlatform | null>(null);
  const [recordingCursorCaptureMode, setRecordingCursorCaptureMode] =
    useState<CursorCaptureMode | null>(null);

  const videoPlaybackRef = useRef<VideoPlaybackRef>(null);

  const nextZoomIdRef = useRef(1);
  const nextTrimIdRef = useRef(1);
  const nextSpeedIdRef = useRef(1);
  const autoZoomedSourceRef = useRef<string | null>(null);

  const { shortcuts, isMac } = useShortcuts();
  // Native Windows recordings include captured cursor assets. Native macOS
  // recordings hide the system cursor in ScreenCaptureKit and use telemetry
  // samples with foOm's default arrow asset for the editable overlay.
  const hasEditableCursorRecording =
    recordingCursorCaptureMode === "editable-overlay" &&
    (nativePlatform === "win32" || nativePlatform === "darwin") &&
    hasNativeCursorRecordingData(cursorRecordingData);
  const effectiveShowCursor =
    showCursor && (hasEditableCursorRecording || combinedCursorTelemetry.length > 0);
  const showCursorSettings = hasEditableCursorRecording || combinedCursorTelemetry.length > 0;
  const { t: rawT } = useI18n();
  const t = useScopedT("editor");
  const ts = useScopedT("settings");

  const nextAnnotationIdRef = useRef(1);
  const nextAnnotationZIndexRef = useRef(1);
  const exporterRef = useRef<VideoExporter | null>(null);

  const releaseDroppedObjectUrl = useCallback(() => {
    if (droppedObjectUrlRef.current) {
      URL.revokeObjectURL(droppedObjectUrlRef.current);
      droppedObjectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      releaseDroppedObjectUrl();
    };
  }, [releaseDroppedObjectUrl]);

  const annotationOnlyRegions = useMemo(
    () => annotationRegions.filter((region) => region.type !== "blur"),
    [annotationRegions],
  );
  const blurRegions = useMemo(
    () => annotationRegions.filter((region) => region.type === "blur"),
    [annotationRegions],
  );

  const currentProjectMedia = useMemo<ProjectMedia | null>(() => {
    const screenVideoPath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
    if (!screenVideoPath) {
      return null;
    }

    const webcamSourcePath =
      webcamVideoSourcePath ?? (webcamVideoPath ? fromFileUrl(webcamVideoPath) : null);
    return {
      screenVideoPath,
      ...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
      ...(recordingCursorCaptureMode ? { cursorCaptureMode: recordingCursorCaptureMode } : {}),
    };
  }, [
    videoPath,
    videoSourcePath,
    webcamVideoPath,
    webcamVideoSourcePath,
    recordingCursorCaptureMode,
  ]);

  const applyLoadedProject = useCallback(
    async (candidate: unknown, path?: string | null) => {
      if (!validateProjectData(candidate)) {
        return false;
      }

      const project = candidate;
      const projectMedia = resolveProjectMedia(project);
      if (!projectMedia) {
        return false;
      }
      const sourcePath = projectMedia.screenVideoPath;
      const webcamSourcePath = projectMedia.webcamVideoPath ?? null;
      const projectCursorCaptureMode = projectMedia.cursorCaptureMode ?? null;
      const normalizedEditor = normalizeProjectEditor(project.editor);
      const inferredDurationMs = Math.max(
        0,
        ...normalizedEditor.zoomRegions.map((region) => region.endMs),
        ...normalizedEditor.trimRegions.map((region) => region.endMs),
        ...normalizedEditor.speedRegions.map((region) => region.endMs),
        ...normalizedEditor.annotationRegions.map((region) => region.endMs),
      );

      try {
        videoPlaybackRef.current?.pause();
      } catch {
        // no-op
      }
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(inferredDurationMs > 0 ? inferredDurationMs / 1000 : 0);

      releaseDroppedObjectUrl();
      setError(null);
      setVideoSourcePath(sourcePath);
      setVideoPath(toPlayableVideoUrl(sourcePath));
      setWebcamVideoSourcePath(webcamSourcePath);
      setWebcamVideoPath(webcamSourcePath ? toPlayableVideoUrl(webcamSourcePath) : null);
      setRecordingCursorCaptureMode(projectCursorCaptureMode);
      setCurrentProjectPath(path ?? null);

      pushState({
        wallpaper: normalizedEditor.wallpaper,
        shadowIntensity: normalizedEditor.shadowIntensity,
        showBlur: normalizedEditor.showBlur,
        motionBlurAmount: normalizedEditor.motionBlurAmount,
        borderRadius: normalizedEditor.borderRadius,
        padding: normalizedEditor.padding,
        cropRegion: normalizedEditor.cropRegion,
        zoomRegions: normalizedEditor.zoomRegions,
        trimRegions: normalizedEditor.trimRegions,
        speedRegions: normalizedEditor.speedRegions,
        annotationRegions: normalizedEditor.annotationRegions,
        aspectRatio: normalizedEditor.aspectRatio,
        webcamLayoutPreset: normalizedEditor.webcamLayoutPreset,
        webcamMaskShape: normalizedEditor.webcamMaskShape,
        webcamSizePreset: normalizedEditor.webcamSizePreset,
        webcamPosition: normalizedEditor.webcamPosition,
      });
      setExportQuality(normalizedEditor.exportQuality);
      setExportFormat(normalizedEditor.exportFormat);
      setNoiseReductionEnabled(normalizedEditor.noiseReductionEnabled);
      setNoiseReductionAmount(normalizedEditor.noiseReductionAmount);
      setGifFrameRate(normalizedEditor.gifFrameRate);
      setGifLoop(normalizedEditor.gifLoop);
      setGifSizePreset(normalizedEditor.gifSizePreset);

      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedSpeedId(null);
      setSelectedAnnotationId(null);
      setSelectedBlurId(null);

      nextZoomIdRef.current = deriveNextId(
        "zoom",
        normalizedEditor.zoomRegions.map((region) => region.id),
      );
      nextTrimIdRef.current = deriveNextId(
        "trim",
        normalizedEditor.trimRegions.map((region) => region.id),
      );
      nextSpeedIdRef.current = deriveNextId(
        "speed",
        normalizedEditor.speedRegions.map((region) => region.id),
      );
      nextAnnotationIdRef.current = deriveNextId(
        "annotation",
        normalizedEditor.annotationRegions.map((region) => region.id),
      );
      nextAnnotationZIndexRef.current =
        normalizedEditor.annotationRegions.reduce(
          (max, region) => Math.max(max, region.zIndex),
          0,
        ) + 1;

      setLastSavedSnapshot(
        createProjectSnapshot(
          {
            screenVideoPath: sourcePath,
            ...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
            ...(projectCursorCaptureMode ? { cursorCaptureMode: projectCursorCaptureMode } : {}),
          },
          normalizedEditor,
        ),
      );
      return true;
    },
    [pushState, releaseDroppedObjectUrl],
  );

  const currentProjectSnapshot = useMemo(() => {
    if (!currentProjectMedia) {
      return null;
    }
    return createProjectSnapshot(currentProjectMedia, {
      wallpaper,
      shadowIntensity,
      showBlur,
      motionBlurAmount,
      borderRadius,
      padding,
      cropRegion,
      zoomRegions,
      trimRegions,
      speedRegions,
      annotationRegions,
      aspectRatio,
      webcamLayoutPreset,
      webcamMaskShape,
      webcamPosition,
      exportQuality,
      exportFormat,
      noiseReductionEnabled,
      noiseReductionAmount,
      gifFrameRate,
      gifLoop,
      gifSizePreset,
    });
  }, [
    currentProjectMedia,
    wallpaper,
    shadowIntensity,
    showBlur,
    motionBlurAmount,
    borderRadius,
    padding,
    cropRegion,
    zoomRegions,
    trimRegions,
    speedRegions,
    annotationRegions,
    aspectRatio,
    webcamLayoutPreset,
    webcamMaskShape,
    webcamPosition,
    exportQuality,
    exportFormat,
    noiseReductionEnabled,
    noiseReductionAmount,
    gifFrameRate,
    gifLoop,
    gifSizePreset,
  ]);

  const hasUnsavedChanges = hasProjectUnsavedChanges(currentProjectSnapshot, lastSavedSnapshot);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const currentProjectResult = await nativeBridgeClient.project.loadCurrentProjectFile();
        if (currentProjectResult.success && currentProjectResult.project) {
          const restored = await applyLoadedProject(
            currentProjectResult.project,
            currentProjectResult.path ?? null,
          );
          if (restored) {
            return;
          }
        }

        const currentSessionResult = await window.foomNative.getCurrentRecordingSession();
        if (currentSessionResult.success && currentSessionResult.session) {
          const session = currentSessionResult.session;
          const sourcePath = fromFileUrl(session.screenVideoPath);
          const webcamSourcePath = session.webcamVideoPath
            ? fromFileUrl(session.webcamVideoPath)
            : null;
          const freshVideoState = getFreshVideoEditorState();
          pushState(freshVideoState);
          setVideoSourcePath(sourcePath);
          setVideoPath(toPlayableVideoUrl(sourcePath));
          setWebcamVideoSourcePath(webcamSourcePath);
          setWebcamVideoPath(webcamSourcePath ? toPlayableVideoUrl(webcamSourcePath) : null);
          setRecordingCursorCaptureMode(session.cursorCaptureMode ?? null);
          setDuration(
            typeof session.durationMs === "number" && Number.isFinite(session.durationMs)
              ? Math.max(0, session.durationMs / 1000)
              : 0,
          );
          setCurrentProjectPath(null);
          setLastSavedSnapshot(
            createProjectSnapshot(
              {
                screenVideoPath: sourcePath,
                ...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
                ...(session.cursorCaptureMode
                  ? { cursorCaptureMode: session.cursorCaptureMode }
                  : {}),
              },
              freshVideoState,
            ),
          );
          return;
        }

        const result = await nativeBridgeClient.project.getCurrentVideoPath();
        if (result.success && result.path) {
          const freshVideoState = getFreshVideoEditorState();
          pushState(freshVideoState);
          setVideoSourcePath(result.path);
          setVideoPath(toPlayableVideoUrl(result.path));
          setRecordingCursorCaptureMode(null);
          setCurrentProjectPath(null);
          setLastSavedSnapshot(
            createProjectSnapshot({ screenVideoPath: result.path }, freshVideoState),
          );
        } else {
          setVideoSourcePath(null);
          setVideoPath(null);
          setRecordingCursorCaptureMode(null);
          setCurrentProjectPath(null);
        }
      } catch (err) {
        setError("Error loading video: " + String(err));
      } finally {
        setLoading(false);
      }
    }

    loadInitialData();
  }, [applyLoadedProject, pushState]);

  // Track whether user preferences have been loaded to avoid
  // overwriting saved prefs with defaults on the first render
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  // Load persisted user preferences on mount (intentionally runs once)
  useEffect(() => {
    const prefs = loadUserPreferences();
    updateState({
      padding: prefs.padding,
      aspectRatio: prefs.aspectRatio,
      wallpaper: prefs.wallpaper,
    });
    setExportQuality(prefs.exportQuality);
    setExportFormat(prefs.exportFormat);
    setPrefsHydrated(true);
  }, [updateState]);

  // Auto-save user preferences when settings change
  useEffect(() => {
    if (!prefsHydrated) return;
    saveUserPreferences({
      padding,
      aspectRatio,
      exportQuality,
      exportFormat,
      wallpaper,
    });
  }, [prefsHydrated, padding, aspectRatio, exportQuality, exportFormat, wallpaper]);

  const saveProject = useCallback(
    async (forceSaveAs: boolean) => {
      if (!videoPath) {
        toast.error(t("errors.noVideoLoaded"));
        return false;
      }

      if (!currentProjectMedia) {
        toast.error(t("errors.unableToDetermineSourcePath"));
        return false;
      }

      const editorState = {
        wallpaper,
        shadowIntensity,
        showBlur,
        motionBlurAmount,
        borderRadius,
        padding,
        cropRegion,
        zoomRegions,
        trimRegions,
        speedRegions,
        annotationRegions,
        aspectRatio,
        webcamLayoutPreset,
        webcamMaskShape,
        webcamSizePreset,
        webcamPosition,
        exportQuality,
        exportFormat,
        noiseReductionEnabled,
        noiseReductionAmount,
        gifFrameRate,
        gifLoop,
        gifSizePreset,
      };
      const projectData = createProjectData(currentProjectMedia, editorState);

      const fileNameBase =
        currentProjectMedia.screenVideoPath
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
      // Match the normalization path used by `currentProjectSnapshot` so the
      // post-save baseline compares equal and `hasUnsavedChanges` clears.
      const projectSnapshot = createProjectSnapshot(currentProjectMedia, editorState);
      const result = await nativeBridgeClient.project.saveProjectFile(
        projectData,
        fileNameBase,
        forceSaveAs ? undefined : (currentProjectPath ?? undefined),
      );

      if (result.canceled) {
        toast.info(t("project.saveCanceled"));
        return false;
      }

      if (!result.success) {
        toast.error(result.message || t("project.failedToSave"));
        return false;
      }

      if (result.path) {
        setCurrentProjectPath(result.path);
      }
      setLastSavedSnapshot(projectSnapshot);

      toast.success(t("project.savedTo", { path: result.path ?? "" }));
      return true;
    },
    [
      currentProjectMedia,
      currentProjectPath,
      wallpaper,
      shadowIntensity,
      showBlur,
      motionBlurAmount,
      borderRadius,
      padding,
      cropRegion,
      zoomRegions,
      trimRegions,
      speedRegions,
      annotationRegions,
      aspectRatio,
      webcamLayoutPreset,
      webcamMaskShape,
      webcamPosition,
      exportQuality,
      exportFormat,
      noiseReductionEnabled,
      noiseReductionAmount,
      gifFrameRate,
      gifLoop,
      gifSizePreset,
      videoPath,
      t,
      webcamSizePreset,
    ],
  );

  useEffect(() => {
    window.foomNative.setHasUnsavedChanges(hasUnsavedChanges);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const cleanup = window.foomNative.onRequestSaveBeforeClose(async () => {
      return saveProject(false);
    });
    return () => cleanup();
  }, [saveProject]);

  useEffect(() => {
    const cleanup = window.foomNative.onRequestCloseConfirm(() => {
      setShowCloseConfirmDialog(true);
    });
    return () => cleanup();
  }, []);

  const handleCloseConfirmSave = useCallback(() => {
    setShowCloseConfirmDialog(false);
    window.foomNative.sendCloseConfirmResponse("save");
  }, []);

  const handleCloseConfirmDiscard = useCallback(() => {
    setShowCloseConfirmDialog(false);
    window.foomNative.sendCloseConfirmResponse("discard");
  }, []);

  const handleCloseConfirmCancel = useCallback(() => {
    setShowCloseConfirmDialog(false);
    window.foomNative.sendCloseConfirmResponse("cancel");
  }, []);

  const handleSaveProject = useCallback(async () => {
    await saveProject(false);
  }, [saveProject]);

  const handleSaveProjectAs = useCallback(async () => {
    await saveProject(true);
  }, [saveProject]);

  const handleNewRecordingConfirm = useCallback(async () => {
    const result = await window.foomNative.startNewRecording();
    if (result.success) {
      setShowNewRecordingDialog(false);
    } else {
      console.error("Failed to start new recording:", result.error);
      setError("Failed to start new recording: " + (result.error || "Unknown error"));
    }
  }, []);

  const handleLoadProject = useCallback(async () => {
    const result = await nativeBridgeClient.project.loadProjectFile();

    if (!result || result.canceled) {
      return;
    }

    if (!result.success) {
      toast.error(result.message || t("project.failedToLoad"));
      return;
    }

    const restored = await applyLoadedProject(result.project, result.path ?? null);
    if (!restored) {
      toast.error(t("project.invalidFormat"));
      return;
    }

    toast.success(t("project.loadedFrom", { path: result.path ?? "" }));
  }, [applyLoadedProject, t]);

  const handleEditorDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDraggingVideoFile(true);
    }
  }, []);

  const handleEditorDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsDraggingVideoFile(false);
  }, []);

  const handleEditorDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDraggingVideoFile(false);

      const file = Array.from(event.dataTransfer.files).find(isSupportedVideoFile);
      if (!file) {
        toast.error("Drop a video file: MP4, MOV, WebM, MKV, AVI, or WMV.");
        return;
      }

      const filePath = getDroppedFilePath(file);
      const playbackUrl = filePath ? toPlayableVideoUrl(filePath) : URL.createObjectURL(file);
      const sourcePath = filePath ?? playbackUrl;

      releaseDroppedObjectUrl();
      if (!filePath) {
        droppedObjectUrlRef.current = playbackUrl;
      }

      try {
        videoPlaybackRef.current?.pause();
      } catch {
        // no-op
      }

      void window.foomNative.clearCurrentRecordingSession?.();
      setError(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setVideoSourcePath(sourcePath);
      setVideoPath(playbackUrl);
      setWebcamVideoSourcePath(null);
      setWebcamVideoPath(null);
      setRecordingCursorCaptureMode(null);
      setCurrentProjectPath(null);
      setLastSavedSnapshot(null);
      setUnsavedExport(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedSpeedId(null);
      setSelectedAnnotationId(null);
      setSelectedBlurId(null);
      pushState(getFreshVideoEditorState());

      toast.success(`Loaded ${file.name}`);
    },
    [pushState, releaseDroppedObjectUrl],
  );

  useEffect(() => {
    const removeLoadListener = window.foomNative.onMenuLoadProject(handleLoadProject);
    const removeSaveListener = window.foomNative.onMenuSaveProject(handleSaveProject);
    const removeSaveAsListener = window.foomNative.onMenuSaveProjectAs(handleSaveProjectAs);

    return () => {
      removeLoadListener?.();
      removeSaveListener?.();
      removeSaveAsListener?.();
    };
  }, [handleLoadProject, handleSaveProject, handleSaveProjectAs]);

  useEffect(() => {
    let canceled = false;
    nativeBridgeClient.system
      .getPlatform()
      .then((platform) => {
        if (!canceled) {
          setNativePlatform(platform);
        }
      })
      .catch((error) => {
        console.warn("Unable to resolve native platform for cursor settings:", error);
        if (!canceled) {
          setNativePlatform(null);
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (cursorTelemetryError) {
      console.warn("Unable to load cursor telemetry:", cursorTelemetryError);
    }
  }, [cursorTelemetryError]);

  useEffect(() => {
    if (cursorRecordingDataError) {
      console.warn("Unable to load cursor recording data:", cursorRecordingDataError);
    }
  }, [cursorRecordingDataError]);

  function togglePlayPause() {
    const playback = videoPlaybackRef.current;
    const video = playback?.video;
    if (!playback || !video) return;

    if (isPlaying) {
      playback.pause();
    } else {
      playback.play().catch((err) => console.error("Video play failed:", err));
    }
  }

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  function handleSeek(time: number) {
    const video = videoPlaybackRef.current?.video;
    if (!video) return;
    video.currentTime = time;
  }

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id);
    if (id) {
      setSelectedTrimId(null);
      setSelectedSpeedId(null);
      setSelectedAnnotationId(null);
      setSelectedBlurId(null);
    }
  }, []);

  const handleSelectTrim = useCallback((id: string | null) => {
    setSelectedTrimId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedSpeedId(null);
      setSelectedAnnotationId(null);
      setSelectedBlurId(null);
    }
  }, []);

  const handleSelectAnnotation = useCallback((id: string | null) => {
    setSelectedAnnotationId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedSpeedId(null);
      setSelectedBlurId(null);
    }
  }, []);

  const handleSelectBlur = useCallback((id: string | null) => {
    setSelectedBlurId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedSpeedId(null);
    }
  }, []);

  const handleZoomAdded = useCallback(
    (span: Span) => {
      const id = `zoom-${nextZoomIdRef.current++}`;
      const newRegion: ZoomRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
        depth: DEFAULT_ZOOM_DEPTH,
        customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
        focus: { cx: 0.5, cy: 0.5 },
      };
      pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
      setSelectedZoomId(id);
      setSelectedTrimId(null);
      setSelectedSpeedId(null);
      setSelectedAnnotationId(null);
      setSelectedBlurId(null);
    },
    [pushState],
  );

  const handleAddZoomFromSettings = useCallback(() => {
    const start = currentTime * 1000;
    const end = Math.min(duration * 1000, start + 2000); // 2 second default duration
    handleZoomAdded({ start, end });
  }, [currentTime, duration, handleZoomAdded]);

  const handleZoomSuggested = useCallback(
    (span: Span, focus: ZoomFocus) => {
      const id = `zoom-${nextZoomIdRef.current++}`;
      const newRegion: ZoomRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
        depth: DEFAULT_ZOOM_DEPTH,
        customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
        focus: clampFocusToDepth(focus, DEFAULT_ZOOM_DEPTH),
        focusMode: "auto",
      };
      // Bulk suggest must not steal selection — keeping a zoom selected hides
      // the export panel (SettingsPanel gates it on !hasTimelineSelection),
      // trapping users who just want to export after auto-zoom.
      pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
    },
    [pushState],
  );

  useEffect(() => {
    const sourceKey = videoSourcePath ?? videoPath;
    if (
      !sourceKey ||
      zoomRegions.length > 0 ||
      duration <= 0 ||
      combinedCursorTelemetry.length < 2 ||
      autoZoomedSourceRef.current === sourceKey
    ) {
      return;
    }

    autoZoomedSourceRef.current = sourceKey;

    const totalMs = Math.round(duration * 1000);
    const defaultDuration = Math.min(Math.max(1000, Math.round(totalMs * 0.05)), totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    const normalizedSamples = normalizeCursorTelemetry(combinedCursorTelemetry, totalMs);
    const sortedCandidates = detectZoomDwellCandidates(normalizedSamples).sort(
      (a, b) => b.strength - a.strength,
    );
    if (sortedCandidates.length === 0) {
      return;
    }

    const acceptedCenters: number[] = [];
    const generatedRegions: ZoomRegion[] = [];

    for (const candidate of sortedCandidates) {
      const tooCloseToAccepted = acceptedCenters.some(
        (center) => Math.abs(center - candidate.centerTimeMs) < AUTO_ZOOM_SUGGESTION_SPACING_MS,
      );
      if (tooCloseToAccepted) {
        continue;
      }

      const centeredStart = Math.round(candidate.centerTimeMs - defaultDuration / 2);
      const candidateStart = Math.max(0, Math.min(centeredStart, totalMs - defaultDuration));
      const candidateEnd = candidateStart + defaultDuration;
      const overlapsGenerated = generatedRegions.some(
        (region) => candidateEnd > region.startMs && candidateStart < region.endMs,
      );
      if (overlapsGenerated) {
        continue;
      }

      acceptedCenters.push(candidate.centerTimeMs);
      generatedRegions.push({
        id: `zoom-${nextZoomIdRef.current++}`,
        startMs: candidateStart,
        endMs: candidateEnd,
        depth: DEFAULT_ZOOM_DEPTH,
        customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
        focus: clampFocusToDepth(candidate.focus, DEFAULT_ZOOM_DEPTH),
        focusMode: "auto",
      });
    }

    if (generatedRegions.length === 0) {
      return;
    }

    pushState((prev) => ({
      zoomRegions: prev.zoomRegions.length === 0 ? generatedRegions : prev.zoomRegions,
    }));
    toast.success(
      generatedRegions.length === 1
        ? "Auto-zoom added 1 focus point"
        : `Auto-zoom added ${generatedRegions.length} focus points`,
    );
  }, [
    combinedCursorTelemetry,
    duration,
    pushState,
    videoPath,
    videoSourcePath,
    zoomRegions.length,
  ]);

  const handleTrimAdded = useCallback(
    (span: Span) => {
      const id = `trim-${nextTrimIdRef.current++}`;
      const newRegion: TrimRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
      };
      pushState((prev) => ({ trimRegions: [...prev.trimRegions, newRegion] }));
      setSelectedTrimId(id);
      setSelectedZoomId(null);
      setSelectedSpeedId(null);
      setSelectedAnnotationId(null);
      setSelectedBlurId(null);
    },
    [pushState],
  );

  const handleZoomSpanChange = useCallback(
    (id: string, span: Span) => {
      pushState((prev) => ({
        zoomRegions: prev.zoomRegions.map((region) =>
          region.id === id
            ? {
                ...region,
                startMs: Math.round(span.start),
                endMs: Math.round(span.end),
              }
            : region,
        ),
      }));
    },
    [pushState],
  );

  const handleTrimSpanChange = useCallback(
    (id: string, span: Span) => {
      pushState((prev) => ({
        trimRegions: prev.trimRegions.map((region) =>
          region.id === id
            ? {
                ...region,
                startMs: Math.round(span.start),
                endMs: Math.round(span.end),
              }
            : region,
        ),
      }));
    },
    [pushState],
  );

  // Focus drag: updateState for live preview, commitState on pointer-up
  const handleZoomFocusChange = useCallback(
    (id: string, focus: ZoomFocus) => {
      updateState((prev) => ({
        zoomRegions: prev.zoomRegions.map((region) =>
          region.id === id ? { ...region, focus: clampFocusToDepth(focus, region.depth) } : region,
        ),
      }));
    },
    [updateState],
  );

  const handleZoomDepthChange = useCallback(
    (depth: ZoomDepth) => {
      if (!selectedZoomId) return;
      pushState((prev) => ({
        zoomRegions: prev.zoomRegions.map((region) =>
          region.id === selectedZoomId
            ? {
                ...region,
                depth,
                customScale: ZOOM_DEPTH_SCALES[depth],
                focus: clampFocusToDepth(region.focus, depth),
              }
            : region,
        ),
      }));
    },
    [selectedZoomId, pushState],
  );

  const handleZoomCustomScaleChange = useCallback(
    (scale: number) => {
      if (!selectedZoomId) return;
      const rounded = Math.round(scale * 100) / 100;
      if (!Number.isFinite(rounded)) return;
      updateState((prev) => ({
        zoomRegions: prev.zoomRegions.map((region) =>
          region.id === selectedZoomId ? { ...region, customScale: rounded } : region,
        ),
      }));
    },
    [selectedZoomId, updateState],
  );

  const handleZoomCustomScaleCommit = useCallback(() => {
    commitState();
  }, [commitState]);

  const handleZoomFocusModeChange = useCallback(
    (focusMode: ZoomFocusMode) => {
      if (!selectedZoomId) return;
      pushState((prev) => ({
        zoomRegions: prev.zoomRegions.map((region) =>
          region.id === selectedZoomId ? { ...region, focusMode } : region,
        ),
      }));
    },
    [selectedZoomId, pushState],
  );

  const handleZoomDelete = useCallback(
    (id: string) => {
      pushState((prev) => ({
        zoomRegions: prev.zoomRegions.filter((r) => r.id !== id),
      }));
      if (selectedZoomId === id) {
        setSelectedZoomId(null);
      }
    },
    [selectedZoomId, pushState],
  );

  const handleZoomRotationPresetChange = useCallback(
    (preset: Rotation3DPreset | null) => {
      if (!selectedZoomId) return;
      pushState((prev) => ({
        zoomRegions: prev.zoomRegions.map((region) => {
          if (region.id !== selectedZoomId) return region;
          if (preset === null) {
            const { rotationPreset: _p, ...rest } = region;
            return rest;
          }
          return { ...region, rotationPreset: preset };
        }),
      }));
    },
    [selectedZoomId, pushState],
  );

  const handleTrimDelete = useCallback(
    (id: string) => {
      pushState((prev) => ({
        trimRegions: prev.trimRegions.filter((r) => r.id !== id),
      }));
      if (selectedTrimId === id) {
        setSelectedTrimId(null);
      }
    },
    [selectedTrimId, pushState],
  );

  const handleSelectSpeed = useCallback((id: string | null) => {
    setSelectedSpeedId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedBlurId(null);
    }
  }, []);

  const handleSpeedAdded = useCallback(
    (span: Span) => {
      const id = `speed-${nextSpeedIdRef.current++}`;
      const newRegion: SpeedRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
        speed: DEFAULT_PLAYBACK_SPEED,
      };
      pushState((prev) => ({
        speedRegions: [...prev.speedRegions, newRegion],
      }));
      setSelectedSpeedId(id);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedBlurId(null);
    },
    [pushState],
  );

  const handleSpeedSpanChange = useCallback(
    (id: string, span: Span) => {
      pushState((prev) => ({
        speedRegions: prev.speedRegions.map((region) =>
          region.id === id
            ? {
                ...region,
                startMs: Math.round(span.start),
                endMs: Math.round(span.end),
              }
            : region,
        ),
      }));
    },
    [pushState],
  );

  const handleSpeedDelete = useCallback(
    (id: string) => {
      pushState((prev) => ({
        speedRegions: prev.speedRegions.filter((region) => region.id !== id),
      }));
      if (selectedSpeedId === id) {
        setSelectedSpeedId(null);
      }
    },
    [selectedSpeedId, pushState],
  );

  const handleSpeedChange = useCallback(
    (speed: PlaybackSpeed) => {
      if (!selectedSpeedId) return;
      pushState((prev) => ({
        speedRegions: prev.speedRegions.map((region) =>
          region.id === selectedSpeedId ? { ...region, speed } : region,
        ),
      }));
    },
    [selectedSpeedId, pushState],
  );

  const handleAnnotationAdded = useCallback(
    (span: Span) => {
      const id = `annotation-${nextAnnotationIdRef.current++}`;
      const zIndex = nextAnnotationZIndexRef.current++;
      const newRegion: AnnotationRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
        type: "text",
        content: "Enter text...",
        position: { ...DEFAULT_ANNOTATION_POSITION },
        size: { ...DEFAULT_ANNOTATION_SIZE },
        style: { ...DEFAULT_ANNOTATION_STYLE },
        zIndex,
      };
      pushState((prev) => ({
        annotationRegions: [...prev.annotationRegions, newRegion],
      }));
      setSelectedAnnotationId(id);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedSpeedId(null);
      setSelectedBlurId(null);
    },
    [pushState],
  );

  const handleAddCaptionFromSettings = useCallback(() => {
    const start = currentTime * 1000;
    const end = Math.min(duration * 1000, start + 3000);
    handleAnnotationAdded({ start, end });
  }, [currentTime, duration, handleAnnotationAdded]);

  const handleBlurAdded = useCallback(
    (span: Span) => {
      const id = `annotation-${nextAnnotationIdRef.current++}`;
      const zIndex = nextAnnotationZIndexRef.current++;
      const newRegion: AnnotationRegion = {
        id,
        startMs: Math.round(span.start),
        endMs: Math.round(span.end),
        type: "blur",
        content: "",
        position: { ...DEFAULT_ANNOTATION_POSITION },
        size: { ...DEFAULT_ANNOTATION_SIZE },
        style: { ...DEFAULT_ANNOTATION_STYLE },
        zIndex,
        blurData: { ...DEFAULT_BLUR_DATA },
      };
      pushState((prev) => ({
        annotationRegions: [...prev.annotationRegions, newRegion],
      }));
      setSelectedBlurId(id);
      setSelectedAnnotationId(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedSpeedId(null);
    },
    [pushState],
  );

  const handleAddBlurFromSettings = useCallback(() => {
    const start = currentTime * 1000;
    const end = Math.min(duration * 1000, start + 2000);
    handleBlurAdded({ start, end });
  }, [currentTime, duration, handleBlurAdded]);

  const handleAnnotationSpanChange = useCallback(
    (id: string, span: Span) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) =>
          region.id === id
            ? {
                ...region,
                startMs: Math.round(span.start),
                endMs: Math.round(span.end),
              }
            : region,
        ),
      }));
    },
    [pushState],
  );

  const handleAnnotationDuplicate = useCallback(
    (id: string) => {
      const duplicateId = `annotation-${nextAnnotationIdRef.current++}`;
      const duplicateZIndex = nextAnnotationZIndexRef.current++;
      pushState((prev) => {
        const source = prev.annotationRegions.find((region) => region.id === id);
        if (!source) return {};

        const duplicate: AnnotationRegion = {
          ...source,
          id: duplicateId,
          zIndex: duplicateZIndex,
          position: { x: source.position.x + 4, y: source.position.y + 4 },
          size: { ...source.size },
          style: { ...source.style },
          figureData: source.figureData ? { ...source.figureData } : undefined,
        };

        return { annotationRegions: [...prev.annotationRegions, duplicate] };
      });
      setSelectedAnnotationId(duplicateId);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedSpeedId(null);
      setSelectedBlurId(null);
    },
    [pushState],
  );

  const handleAnnotationDelete = useCallback(
    (id: string) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.filter((r) => r.id !== id),
      }));
      if (selectedAnnotationId === id) {
        setSelectedAnnotationId(null);
      }
      if (selectedBlurId === id) {
        setSelectedBlurId(null);
      }
    },
    [selectedAnnotationId, selectedBlurId, pushState],
  );

  const handleAnnotationContentChange = useCallback(
    (id: string, content: string) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) => {
          if (region.id !== id) return region;
          if (region.type === "text") {
            return { ...region, content, textContent: content };
          } else if (region.type === "image") {
            return { ...region, content, imageContent: content };
          }
          return { ...region, content };
        }),
      }));
    },
    [pushState],
  );

  const handleAnnotationTypeChange = useCallback(
    (id: string, type: AnnotationRegion["type"]) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) => {
          if (region.id !== id) return region;
          const updatedRegion = { ...region, type };
          if (type === "text") {
            updatedRegion.content = region.textContent || "Enter text...";
          } else if (type === "image") {
            updatedRegion.content = region.imageContent || "";
          } else if (type === "figure") {
            updatedRegion.content = "";
            if (!region.figureData) {
              updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
            }
          } else if (type === "blur") {
            updatedRegion.content = "";
            if (!region.blurData) {
              updatedRegion.blurData = { ...DEFAULT_BLUR_DATA };
            }
          }
          return updatedRegion;
        }),
      }));

      if (type === "blur" && selectedAnnotationId === id) {
        setSelectedAnnotationId(null);
        setSelectedBlurId(id);
        setSelectedSpeedId(null);
      } else if (type !== "blur" && selectedBlurId === id) {
        setSelectedBlurId(null);
        setSelectedAnnotationId(id);
      }
    },
    [pushState, selectedAnnotationId, selectedBlurId],
  );

  const handleAnnotationStyleChange = useCallback(
    (id: string, style: Partial<AnnotationRegion["style"]>) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) =>
          region.id === id ? { ...region, style: { ...region.style, ...style } } : region,
        ),
      }));
    },
    [pushState],
  );

  const handleAnnotationFigureDataChange = useCallback(
    (id: string, figureData: FigureData) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) =>
          region.id === id ? { ...region, figureData } : region,
        ),
      }));
    },
    [pushState],
  );

  const handleBlurDataPreviewChange = useCallback(
    (id: string, blurData: BlurData) => {
      updateState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) =>
          region.id === id
            ? {
                ...region,
                blurData,
                // Freehand drawing area is the full video surface.
                ...(blurData.shape === "freehand"
                  ? {
                      position: { x: 0, y: 0 },
                      size: { width: 100, height: 100 },
                    }
                  : {}),
              }
            : region,
        ),
      }));
    },
    [updateState],
  );

  const handleBlurDataPanelChange = useCallback(
    (id: string, blurData: BlurData) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) =>
          region.id === id
            ? {
                ...region,
                blurData,
                ...(blurData.shape === "freehand"
                  ? {
                      position: { x: 0, y: 0 },
                      size: { width: 100, height: 100 },
                    }
                  : {}),
              }
            : region,
        ),
      }));
    },
    [pushState],
  );

  const handleAnnotationPositionChange = useCallback(
    (id: string, position: { x: number; y: number }) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) =>
          region.id === id ? { ...region, position } : region,
        ),
      }));
    },
    [pushState],
  );

  const handleAnnotationSizeChange = useCallback(
    (id: string, size: { width: number; height: number }) => {
      pushState((prev) => ({
        annotationRegions: prev.annotationRegions.map((region) =>
          region.id === id ? { ...region, size } : region,
        ),
      }));
    },
    [pushState],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undo();
        return;
      }
      if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }

      // Frame-step navigation (arrow keys, no modifiers)
      if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        const target = e.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement &&
            (target.isContentEditable ||
              target.closest('[role="separator"], [role="slider"], [role="spinbutton"]')))
        ) {
          return;
        }
        e.preventDefault();
        const video = videoPlaybackRef.current?.video;
        if (!video) {
          return;
        }
        const direction = e.key === "ArrowLeft" ? "backward" : "forward";
        const newTime = computeFrameStepTime(
          video.currentTime,
          Number.isFinite(video.duration) ? video.duration : durationRef.current,
          direction,
        );
        video.currentTime = newTime;
        return;
      }

      const isInput =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      if (e.key === "Tab" && !isInput) {
        e.preventDefault();
      }

      if (matchesShortcut(e, shortcuts.playPause, isMac)) {
        // Allow space only in inputs/textareas
        if (isInput) {
          return;
        }
        e.preventDefault();
        const playback = videoPlaybackRef.current;
        if (playback?.video) {
          if (playback.video.paused) {
            playback.play().catch(console.error);
          } else {
            playback.pause();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [undo, redo, shortcuts, isMac]);

  useEffect(() => {
    if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId, zoomRegions]);

  useEffect(() => {
    if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId, trimRegions]);

  useEffect(() => {
    if (
      selectedAnnotationId &&
      !annotationOnlyRegions.some((region) => region.id === selectedAnnotationId)
    ) {
      setSelectedAnnotationId(null);
    }
    if (selectedBlurId && !blurRegions.some((region) => region.id === selectedBlurId)) {
      setSelectedBlurId(null);
    }
  }, [selectedAnnotationId, selectedBlurId, annotationOnlyRegions, blurRegions]);

  useEffect(() => {
    if (selectedSpeedId && !speedRegions.some((region) => region.id === selectedSpeedId)) {
      setSelectedSpeedId(null);
    }
  }, [selectedSpeedId, speedRegions]);

  const handleShowExportedFile = useCallback(async (filePath: string) => {
    try {
      const result = await window.foomNative.revealInFolder(filePath);
      if (!result.success) {
        const errorMessage = result.error || result.message || "Failed to reveal item in folder.";
        console.error("Failed to reveal in folder:", errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      const errorMessage = String(error);
      console.error("Error calling revealInFolder IPC:", errorMessage);
      toast.error(`Error revealing in folder: ${errorMessage}`);
    }
  }, []);

  const handleExportSaved = useCallback(
    (formatLabel: "GIF" | "Video", filePath: string) => {
      setExportedFilePath(filePath);
      const folder = parentDirectoryOf(filePath);
      if (folder) {
        saveUserPreferences({ exportFolder: folder });
      }
      toast.success(
        t("export.exportedSuccessfully", {
          format: formatLabel,
        }),
        {
          description: filePath,
          action: {
            label: rawT("common.actions.showInFolder"),
            onClick: () => {
              void handleShowExportedFile(filePath);
            },
          },
        },
      );
    },
    [handleShowExportedFile, t, rawT],
  );

  const handleSaveUnsavedExport = useCallback(async () => {
    if (!unsavedExport) return;
    try {
      const pickResult = await window.foomNative.pickExportSavePath(
        unsavedExport.fileName,
        await getExportFolder(),
      );
      if (pickResult.canceled || !pickResult.success || !pickResult.path) {
        toast.info("Export canceled");
        return;
      }
      const saveResult = await window.foomNative.writeExportToPath(
        unsavedExport.arrayBuffer,
        pickResult.path,
      );
      if (saveResult.success && saveResult.path) {
        setUnsavedExport(null);
        handleExportSaved(unsavedExport.format === "gif" ? "GIF" : "Video", saveResult.path);
      } else {
        toast.error(
          buildSaveDiagnosticMessage(
            unsavedExport.format === "gif" ? "GIF" : "Video",
            saveResult.message || "Failed to save export",
          ),
        );
      }
    } catch (error) {
      console.error("Error saving unsaved export:", error);
      toast.error(
        buildSaveDiagnosticMessage(
          unsavedExport.format === "gif" ? "GIF" : "Video",
          error instanceof Error ? error.message : "Failed to save exported video",
        ),
      );
    }
  }, [unsavedExport, handleExportSaved]);

  const handleExport = useCallback(
    async (settings: ExportSettings) => {
      if (!videoPath) {
        toast.error("No video loaded");
        return;
      }

      const video = videoPlaybackRef.current?.video;
      if (!video) {
        toast.error("Video not ready");
        return;
      }

      // Ask the user where to save BEFORE starting the export. This avoids the
      // post-export save dialog getting hidden behind other windows after a
      // long-running export.
      const isGifFormat = settings.format === "gif";
      const targetFileName = `export-${Date.now()}.${isGifFormat ? "gif" : "mp4"}`;
      const pickResult = await window.foomNative.pickExportSavePath(
        targetFileName,
        await getExportFolder(),
      );
      if (pickResult.canceled || !pickResult.success || !pickResult.path) {
        setShowExportDialog(false);
        return;
      }
      const targetPath = pickResult.path;

      setIsExporting(true);
      setExportProgress(null);
      setExportError(null);
      setExportedFilePath(null);

      try {
        const wasPlaying = isPlaying;
        if (wasPlaying) {
          videoPlaybackRef.current?.pause();
        }

        const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
        const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
        const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
          sourceWidth,
          sourceHeight,
          cropRegion,
        );
        const aspectRatioValue =
          aspectRatio === "native"
            ? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
            : getAspectRatioValue(aspectRatio);

        // Get preview CONTAINER dimensions for scaling
        const playbackRef = videoPlaybackRef.current;
        const containerElement = playbackRef?.containerRef?.current;
        const previewWidth = containerElement?.clientWidth || DEFAULT_SOURCE_DIMENSIONS.width;
        const previewHeight = containerElement?.clientHeight || DEFAULT_SOURCE_DIMENSIONS.height;

        if (settings.format === "gif" && settings.gifConfig) {
          // GIF Export
          const gifExporter = new GifExporter({
            videoUrl: videoPath,
            webcamVideoUrl: webcamVideoPath || undefined,
            width: settings.gifConfig.width,
            height: settings.gifConfig.height,
            frameRate: settings.gifConfig.frameRate,
            loop: settings.gifConfig.loop,
            sizePreset: settings.gifConfig.sizePreset,
            wallpaper,
            zoomRegions,
            trimRegions,
            speedRegions,
            showShadow: shadowIntensity > 0,
            shadowIntensity,
            showBlur,
            motionBlurAmount,
            borderRadius,
            padding,
            videoPadding: padding,
            cropRegion,
            cursorRecordingData,
            cursorScale: effectiveShowCursor ? cursorSize : 0,
            cursorStyle,
            cursorSmoothing,
            cursorMotionBlur,
            cursorClickBounce,
            cursorClipToBounds,
            annotationRegions,
            webcamLayoutPreset,
            webcamMaskShape,
            webcamSizePreset,
            webcamPosition,
            previewWidth,
            previewHeight,
            cursorTelemetry: combinedCursorTelemetry,
            cursorClickTimestamps,
            onProgress: (progress: ExportProgress) => {
              setExportProgress(progress);
            },
          });

          exporterRef.current = gifExporter as unknown as VideoExporter;
          const result = await gifExporter.export();

          if (result.success && result.blob) {
            const arrayBuffer = await result.blob.arrayBuffer();

            if (result.warnings) {
              for (const warning of result.warnings) {
                toast.warning(warning);
              }
            }

            const saveResult = await window.foomNative.writeExportToPath(arrayBuffer, targetPath);

            if (saveResult.success && saveResult.path) {
              setUnsavedExport(null);
              handleExportSaved("GIF", saveResult.path);
            } else {
              setUnsavedExport({
                arrayBuffer,
                fileName: targetFileName,
                format: "gif",
              });
              const message = buildSaveDiagnosticMessage(
                "GIF",
                saveResult.message || "Failed to save GIF",
              );
              setExportError(message);
              toast.error(message);
            }
          } else {
            const message = buildExportDiagnosticMessage({
              formatLabel: "GIF",
              reason: result.error || "GIF export failed",
              sourcePath: videoSourcePath ?? videoPath,
              width: settings.gifConfig.width,
              height: settings.gifConfig.height,
              frameRate: settings.gifConfig.frameRate,
            });
            setExportError(message);
            toast.error(message);
          }
        } else {
          // MP4 Export
          const quality = settings.quality || exportQuality;
          const {
            width: exportWidth,
            height: exportHeight,
            bitrate,
          } = calculateMp4ExportSettings({
            quality,
            sourceWidth: effectiveSourceDimensions.width,
            sourceHeight: effectiveSourceDimensions.height,
            aspectRatioValue,
          });

          const exporter = new VideoExporter({
            videoUrl: videoPath,
            webcamVideoUrl: webcamVideoPath || undefined,
            width: exportWidth,
            height: exportHeight,
            frameRate: 60,
            bitrate,
            codec: "avc1.640033",
            wallpaper,
            zoomRegions,
            trimRegions,
            speedRegions,
            showShadow: shadowIntensity > 0,
            shadowIntensity,
            showBlur,
            motionBlurAmount,
            borderRadius,
            padding,
            cropRegion,
            cursorRecordingData,
            cursorScale: effectiveShowCursor ? cursorSize : 0,
            cursorStyle,
            cursorSmoothing,
            cursorMotionBlur,
            cursorClickBounce,
            cursorClipToBounds,
            annotationRegions,
            webcamLayoutPreset,
            webcamMaskShape,
            webcamSizePreset,
            webcamPosition,
            previewWidth,
            previewHeight,
            cursorTelemetry: combinedCursorTelemetry,
            cursorClickTimestamps,
            noiseReduction: {
              enabled: noiseReductionEnabled,
              amount: noiseReductionAmount,
            },
            onProgress: (progress: ExportProgress) => {
              setExportProgress(progress);
            },
          });

          exporterRef.current = exporter;
          const result = await exporter.export();

          if (result.success && result.blob) {
            const arrayBuffer = await result.blob.arrayBuffer();

            if (result.warnings) {
              for (const warning of result.warnings) {
                toast.warning(warning);
              }
            }

            const saveResult = await window.foomNative.writeExportToPath(arrayBuffer, targetPath);

            if (saveResult.success && saveResult.path) {
              setUnsavedExport(null);
              handleExportSaved("Video", saveResult.path);
            } else {
              setUnsavedExport({
                arrayBuffer,
                fileName: targetFileName,
                format: "mp4",
              });
              const message = buildSaveDiagnosticMessage(
                "Video",
                saveResult.message || "Failed to save video",
              );
              setExportError(message);
              toast.error(message);
            }
          } else {
            const message = buildExportDiagnosticMessage({
              formatLabel: "Video",
              reason: result.error || "Export failed",
              sourcePath: videoSourcePath ?? videoPath,
              width: exportWidth,
              height: exportHeight,
              frameRate: 60,
              codec: "avc1.640033",
              bitrate,
            });
            setExportError(message);
            toast.error(message);
          }
        }

        if (wasPlaying) {
          videoPlaybackRef.current?.play();
        }
      } catch (error) {
        console.error("Export error:", error);
        if (error instanceof BackgroundLoadError) {
          const message = t("errors.exportBackgroundLoadFailed", {
            url: error.displayUrl,
          });
          setExportError(message);
          toast.error(message);
        } else {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          const message = buildExportDiagnosticMessage({
            formatLabel: settings.format === "gif" ? "GIF" : "Video",
            reason: errorMessage,
            sourcePath: videoSourcePath ?? videoPath,
          });
          setExportError(message);
          toast.error(t("errors.exportFailedWithError", { error: message }));
        }
      } finally {
        setIsExporting(false);
        exporterRef.current = null;
        // Reset dialog state to ensure it can be opened again on next export
        // This fixes the bug where second export doesn't show save dialog
        setShowExportDialog(false);
        setExportProgress(null);
      }
    },
    [
      videoPath,
      videoSourcePath,
      webcamVideoPath,
      wallpaper,
      zoomRegions,
      trimRegions,
      speedRegions,
      shadowIntensity,
      showBlur,
      motionBlurAmount,
      borderRadius,
      padding,
      cropRegion,
      cursorRecordingData,
      annotationRegions,
      isPlaying,
      aspectRatio,
      webcamLayoutPreset,
      webcamMaskShape,
      webcamSizePreset,
      webcamPosition,
      exportQuality,
      noiseReductionEnabled,
      noiseReductionAmount,
      handleExportSaved,
      combinedCursorTelemetry,
      cursorClickTimestamps,
      effectiveShowCursor,
      cursorSize,
      cursorStyle,
      cursorSmoothing,
      cursorMotionBlur,
      cursorClickBounce,
      cursorClipToBounds,
      t,
    ],
  );

  const handleOpenExportDialog = useCallback(() => {
    if (!videoPath) {
      toast.error("No video loaded");
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error("Video not ready");
      return;
    }

    setShowExportDialog(true);
    setExportError(null);
    setExportedFilePath(null);
    setExportProgress(null);
  }, [videoPath]);

  const handleStartExportFromDialog = useCallback(() => {
    if (!videoPath) {
      toast.error("No video loaded");
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error("Video not ready");
      return;
    }

    const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
    const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
    const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
      sourceWidth,
      sourceHeight,
      cropRegion,
    );
    const aspectRatioValue =
      aspectRatio === "native"
        ? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
        : getAspectRatioValue(aspectRatio);
    const gifDimensions = calculateOutputDimensions(
      effectiveSourceDimensions.width,
      effectiveSourceDimensions.height,
      gifSizePreset,
      GIF_SIZE_PRESETS,
      aspectRatioValue,
    );

    const settings: ExportSettings = {
      format: exportFormat,
      quality: exportFormat === "mp4" ? exportQuality : undefined,
      gifConfig:
        exportFormat === "gif"
          ? {
              frameRate: gifFrameRate,
              loop: gifLoop,
              sizePreset: gifSizePreset,
              width: gifDimensions.width,
              height: gifDimensions.height,
            }
          : undefined,
    };

    setExportError(null);
    setExportedFilePath(null);
    handleExport(settings);
  }, [
    videoPath,
    exportFormat,
    exportQuality,
    gifFrameRate,
    gifLoop,
    gifSizePreset,
    aspectRatio,
    cropRegion,
    handleExport,
  ]);

  const handleCancelExport = useCallback(() => {
    if (exporterRef.current) {
      exporterRef.current.cancel();
      toast.info("Export canceled");
      setShowExportDialog(false);
      setIsExporting(false);
      setExportProgress(null);
      setExportError(null);
      setExportedFilePath(null);
    }
  }, []);

  const handleSaveDiagnostic = useCallback(async () => {
    const result = await window.foomNative.saveDiagnostic({
      error: exportError ?? "Manual diagnostic export",
      projectState: editorState,
      logs: [],
    });
    if (result.success) {
      toast.success("Diagnostic file saved");
    } else if (!result.canceled) {
      toast.error("Failed to save diagnostic file");
    }
  }, [exportError, editorState]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <VideoLoadingIndicator label={t("loadingVideo")} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="text-destructive">{error}</div>
          <button
            type="button"
            onClick={handleLoadProject}
            className="px-3 py-1.5 rounded-md bg-[#34B27B] text-white text-sm hover:bg-[#34B27B]/90"
          >
            {ts("project.load")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="editor-app-shell relative flex flex-col h-screen text-slate-200 overflow-hidden selection:bg-white/20"
      onDragOver={handleEditorDragOver}
      onDragLeave={handleEditorDragLeave}
      onDrop={handleEditorDrop}
    >
      <Dialog open={showNewRecordingDialog} onOpenChange={setShowNewRecordingDialog}>
        <DialogContent
          className="w-[min(420px,calc(100vw-32px))] border border-white/12 bg-[#09090b] p-5 text-white shadow-[0_28px_80px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.06)] sm:max-w-[420px] [&>button]:text-white/55 [&>button]:hover:text-white"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-base font-semibold leading-6 text-white">
              Start a new recording?
            </DialogTitle>
            <DialogDescription className="text-sm leading-5 text-white/58">
              This will leave the current editor and open the recording toolbar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:gap-2 sm:space-x-0">
            <button
              type="button"
              onClick={() => setShowNewRecordingDialog(false)}
              className="h-9 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white/78 transition-colors hover:bg-white/[0.10] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleNewRecordingConfirm}
              className="h-9 rounded-lg bg-[#D4D4D8] px-4 text-sm font-bold text-[#09090b] shadow-[0_10px_24px_rgba(255,255,255,0.12)] transition-colors hover:bg-[#E4E4E7]"
            >
              Record New
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isDraggingVideoFile && (
        <div className="pointer-events-none absolute inset-2 z-[80] flex items-center justify-center rounded-2xl border border-white/22 bg-black/58 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-white/12 bg-white/[0.07] px-8 py-6 text-center shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/14 bg-white text-[#09090b]">
              <Video size={21} strokeWidth={1.8} />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Drop video to load</div>
              <div className="mt-1 text-[11px] text-white/50">MP4, MOV, WebM, MKV, AVI, WMV</div>
            </div>
          </div>
        </div>
      )}

      <div
        className="editor-topbar h-10 flex-shrink-0 flex items-center justify-between px-3 z-50"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className={isMac ? "ml-14" : "ml-6"} />

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => setShowNewRecordingDialog(true)}
            title="Record New"
            aria-label="Record New"
            className="editor-topbar-action h-7 shrink-0 gap-1.5 text-[11px] font-semibold transition-colors"
          >
            <Clapperboard size={14} strokeWidth={2} className="shrink-0" />
            <span className="whitespace-nowrap leading-none">Record New</span>
          </button>
          <button
            type="button"
            onClick={handleLoadProject}
            title="Load Project"
            aria-label="Load Project"
            className="editor-topbar-action h-7 shrink-0 gap-1.5 text-[11px] font-semibold transition-colors"
          >
            <FolderOpen size={14} strokeWidth={2} className="shrink-0" />
            <span className="whitespace-nowrap leading-none">Load Project</span>
          </button>
          <button
            type="button"
            onClick={handleSaveProject}
            title="Save Project"
            aria-label="Save Project"
            className="editor-topbar-action h-7 shrink-0 gap-1.5 text-[11px] font-semibold transition-colors"
          >
            <Save size={14} strokeWidth={2} className="shrink-0" />
            <span className="whitespace-nowrap leading-none">Save Project</span>
          </button>
          <button
            type="button"
            onClick={handleOpenExportDialog}
            title="Export"
            aria-label="Export"
            className="editor-export-action h-7 shrink-0 gap-1.5 rounded-[7px] px-3 text-[11px] font-bold text-white transition-colors"
          >
            <CloudUpload size={14} strokeWidth={2.2} className="shrink-0" />
            <span className="whitespace-nowrap leading-none">Export</span>
          </button>
        </div>
      </div>
      <div className="flex-1 relative min-h-0 p-2">
        <PanelGroup orientation="horizontal" className="gap-3 min-h-0">
          <Panel defaultSize={73} minSize={40} className="min-w-0 h-full flex flex-col">
            <PanelGroup orientation="vertical" className="gap-3 min-h-0">
              <Panel defaultSize={72} minSize={30} className="min-h-[200px]">
                <div className="editor-main-deck h-full min-h-0 rounded-xl overflow-hidden">
                  <div className="editor-preview-zone min-w-0 h-full">
                    <div
                      ref={playerContainerRef}
                      className={
                        isFullscreen
                          ? "fixed inset-0 z-[99999] w-full h-full flex flex-col items-center justify-center bg-[#09090b]"
                          : "editor-preview-panel w-full h-full flex flex-col items-center justify-center overflow-hidden relative"
                      }
                    >
                      {/* Video preview */}
                      <div className="w-full min-h-0 flex justify-center items-center flex-auto px-8 pt-2 pb-1">
                        <div
                          className="relative flex justify-center items-center w-[74%] max-w-[980px] min-w-0 sm:min-w-[360px] h-auto max-h-full box-border"
                          style={{
                            aspectRatio:
                              aspectRatio === "native"
                                ? getNativeAspectRatioValue(
                                    videoPlaybackRef.current?.video?.videoWidth ||
                                      DEFAULT_SOURCE_DIMENSIONS.width,
                                    videoPlaybackRef.current?.video?.videoHeight ||
                                      DEFAULT_SOURCE_DIMENSIONS.height,
                                    cropRegion,
                                  )
                                : getAspectRatioValue(aspectRatio),
                          }}
                        >
                          {videoPath ? (
                            <VideoPlayback
                              key={`${videoPath || "no-video"}:${webcamVideoPath || "no-webcam"}`}
                              aspectRatio={aspectRatio}
                              ref={videoPlaybackRef}
                              videoPath={videoPath || ""}
                              webcamVideoPath={webcamVideoPath || undefined}
                              webcamLayoutPreset={webcamLayoutPreset}
                              webcamMaskShape={webcamMaskShape}
                              webcamSizePreset={webcamSizePreset}
                              webcamPosition={webcamPosition}
                              onWebcamPositionChange={(pos) => updateState({ webcamPosition: pos })}
                              onWebcamPositionDragEnd={commitState}
                              onDurationChange={setDuration}
                              onTimeUpdate={setCurrentTime}
                              currentTime={currentTime}
                              onPlayStateChange={setIsPlaying}
                              onError={setError}
                              wallpaper={wallpaper}
                              zoomRegions={zoomRegions}
                              selectedZoomId={selectedZoomId}
                              onSelectZoom={handleSelectZoom}
                              onZoomFocusChange={handleZoomFocusChange}
                              onZoomFocusDragEnd={commitState}
                              isPlaying={isPlaying}
                              showShadow={shadowIntensity > 0}
                              shadowIntensity={shadowIntensity}
                              showBlur={showBlur}
                              motionBlurAmount={motionBlurAmount}
                              borderRadius={borderRadius}
                              padding={padding}
                              cropRegion={cropRegion}
                              cursorRecordingData={cursorRecordingData}
                              trimRegions={trimRegions}
                              speedRegions={speedRegions}
                              annotationRegions={annotationOnlyRegions}
                              selectedAnnotationId={selectedAnnotationId}
                              onSelectAnnotation={handleSelectAnnotation}
                              onAnnotationPositionChange={handleAnnotationPositionChange}
                              onAnnotationSizeChange={handleAnnotationSizeChange}
                              blurRegions={blurRegions}
                              selectedBlurId={selectedBlurId}
                              onSelectBlur={handleSelectBlur}
                              onBlurPositionChange={handleAnnotationPositionChange}
                              onBlurSizeChange={handleAnnotationSizeChange}
                              onBlurDataChange={handleBlurDataPreviewChange}
                              onBlurDataCommit={commitState}
                              cursorTelemetry={combinedCursorTelemetry}
                              cursorClickTimestamps={cursorClickTimestamps}
                              showCursor={effectiveShowCursor}
                              hasNativeCursorRecording={hasEditableCursorRecording}
                              cursorSize={cursorSize}
                              cursorStyle={cursorStyle}
                              cursorSmoothing={cursorSmoothing}
                              cursorMotionBlur={cursorMotionBlur}
                              cursorClickBounce={cursorClickBounce}
                              cursorClipToBounds={cursorClipToBounds}
                              isPreviewingZoom={isPreviewingZoom}
                            />
                          ) : (
                            <div className="editor-empty-preview-frame flex h-full w-full flex-col items-center justify-center rounded-xl text-sm text-white/70">
                              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70">
                                <Video size={20} strokeWidth={1.7} />
                              </div>
                              <div className="text-[13px] font-semibold text-white/82">
                                No video loaded
                              </div>
                              <div className="mt-1 text-[11px] text-white/38">
                                Record or load a project to start editing
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Playback controls */}
                      <div className="w-full flex justify-center items-center h-14 flex-shrink-0 px-4 py-2">
                        <div className="w-full max-w-[760px]">
                          <PlaybackControls
                            isPlaying={isPlaying}
                            currentTime={currentTime}
                            duration={duration}
                            isFullscreen={isFullscreen}
                            onToggleFullscreen={toggleFullscreen}
                            onTogglePlayPause={togglePlayPause}
                            onSeek={handleSeek}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="editor-resize-handle group">
                <div className="w-10 h-1 bg-white/20 rounded-full transition-colors group-hover:bg-[#34B27B]/70"></div>
              </PanelResizeHandle>

              <Panel defaultSize={28} minSize={20} className="min-h-[150px]">
                <div className="h-full rounded-xl overflow-hidden">
                  <div className="editor-timeline-panel h-full overflow-hidden flex flex-col">
                    <TimelineEditor
                      videoDuration={duration}
                      currentTime={currentTime}
                      onSeek={handleSeek}
                      cursorTelemetry={combinedCursorTelemetry}
                      zoomRegions={zoomRegions}
                      onZoomAdded={handleZoomAdded}
                      onZoomSuggested={handleZoomSuggested}
                      onZoomSpanChange={handleZoomSpanChange}
                      onZoomDelete={handleZoomDelete}
                      selectedZoomId={selectedZoomId}
                      onSelectZoom={handleSelectZoom}
                      trimRegions={trimRegions}
                      onTrimAdded={handleTrimAdded}
                      onTrimSpanChange={handleTrimSpanChange}
                      onTrimDelete={handleTrimDelete}
                      selectedTrimId={selectedTrimId}
                      onSelectTrim={handleSelectTrim}
                      speedRegions={speedRegions}
                      onSpeedAdded={handleSpeedAdded}
                      onSpeedSpanChange={handleSpeedSpanChange}
                      onSpeedDelete={handleSpeedDelete}
                      selectedSpeedId={selectedSpeedId}
                      onSelectSpeed={handleSelectSpeed}
                      annotationRegions={annotationOnlyRegions}
                      onAnnotationAdded={handleAnnotationAdded}
                      onAnnotationSpanChange={handleAnnotationSpanChange}
                      onAnnotationDelete={handleAnnotationDelete}
                      selectedAnnotationId={selectedAnnotationId}
                      onSelectAnnotation={handleSelectAnnotation}
                      blurRegions={blurRegions}
                      onBlurAdded={handleBlurAdded}
                      onBlurSpanChange={handleAnnotationSpanChange}
                      onBlurDelete={handleAnnotationDelete}
                      selectedBlurId={selectedBlurId}
                      onSelectBlur={handleSelectBlur}
                      aspectRatio={aspectRatio}
                      onAspectRatioChange={(ar) =>
                        pushState({
                          aspectRatio: ar,
                          webcamLayoutPreset:
                            (isPortraitAspectRatio(ar) && webcamLayoutPreset === "dual-frame") ||
                            (!isPortraitAspectRatio(ar) && webcamLayoutPreset === "vertical-stack")
                              ? "picture-in-picture"
                              : webcamLayoutPreset,
                        })
                      }
                    />
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="editor-resize-handle group w-2 h-full flex items-center justify-center cursor-col-resize">
            <div className="h-10 w-1 bg-white/20 rounded-full transition-colors group-hover:bg-[#34B27B]/70"></div>
          </PanelResizeHandle>

          <Panel defaultSize={27} minSize={20} className="min-w-0 h-full">
            <div className="h-full rounded-xl overflow-hidden">
              <div className="editor-settings-rail min-w-0 h-full">
                <SettingsPanel
                  selected={wallpaper}
                  onWallpaperChange={(w) => pushState({ wallpaper: w })}
                  selectedZoomDepth={
                    selectedZoomId ? zoomRegions.find((z) => z.id === selectedZoomId)?.depth : null
                  }
                  onZoomDepthChange={(depth) => selectedZoomId && handleZoomDepthChange(depth)}
                  selectedZoomCustomScale={
                    selectedZoomId
                      ? (zoomRegions.find((z) => z.id === selectedZoomId)?.customScale ?? null)
                      : null
                  }
                  onZoomCustomScaleChange={handleZoomCustomScaleChange}
                  onZoomCustomScaleCommit={handleZoomCustomScaleCommit}
                  onZoomPreviewStart={() => setIsPreviewingZoom(true)}
                  onZoomPreviewEnd={() => setIsPreviewingZoom(false)}
                  selectedZoomFocusMode={
                    selectedZoomId
                      ? (zoomRegions.find((z) => z.id === selectedZoomId)?.focusMode ?? "manual")
                      : null
                  }
                  onZoomFocusModeChange={(mode) =>
                    selectedZoomId && handleZoomFocusModeChange(mode)
                  }
                  selectedZoomFocus={
                    selectedZoomId
                      ? (zoomRegions.find((z) => z.id === selectedZoomId)?.focus ?? null)
                      : null
                  }
                  onZoomFocusCoordinateChange={(focus) =>
                    selectedZoomId && handleZoomFocusChange(selectedZoomId, focus)
                  }
                  onZoomFocusCoordinateCommit={commitState}
                  hasCursorTelemetry={combinedCursorTelemetry.length > 0}
                  selectedZoomId={selectedZoomId}
                  onZoomDelete={handleZoomDelete}
                  selectedZoomRotationPreset={
                    selectedZoomId
                      ? (zoomRegions.find((z) => z.id === selectedZoomId)?.rotationPreset ?? null)
                      : null
                  }
                  onZoomRotationPresetChange={handleZoomRotationPresetChange}
                  selectedTrimId={selectedTrimId}
                  onTrimDelete={handleTrimDelete}
                  shadowIntensity={shadowIntensity}
                  onShadowChange={(v) => updateState({ shadowIntensity: v })}
                  onShadowCommit={commitState}
                  showBlur={showBlur}
                  onBlurChange={(v) => pushState({ showBlur: v })}
                  motionBlurAmount={motionBlurAmount}
                  onMotionBlurChange={(v) => updateState({ motionBlurAmount: v })}
                  onMotionBlurCommit={commitState}
                  borderRadius={borderRadius}
                  onBorderRadiusChange={(v) => updateState({ borderRadius: v })}
                  onBorderRadiusCommit={commitState}
                  padding={padding}
                  onPaddingChange={(v) => updateState({ padding: v })}
                  onPaddingCommit={commitState}
                  cropRegion={cropRegion}
                  onCropChange={(r) => pushState({ cropRegion: r })}
                  aspectRatio={aspectRatio}
                  hasWebcam={Boolean(webcamVideoPath)}
                  webcamLayoutPreset={webcamLayoutPreset}
                  onWebcamLayoutPresetChange={(preset) =>
                    pushState({
                      webcamLayoutPreset: preset,
                      webcamPosition: preset === "picture-in-picture" ? webcamPosition : null,
                    })
                  }
                  webcamMaskShape={webcamMaskShape}
                  onWebcamMaskShapeChange={(shape) => pushState({ webcamMaskShape: shape })}
                  webcamSizePreset={webcamSizePreset}
                  onWebcamSizePresetChange={(v) => updateState({ webcamSizePreset: v })}
                  onWebcamSizePresetCommit={commitState}
                  webcamPosition={webcamPosition}
                  onWebcamPositionChange={(position) => updateState({ webcamPosition: position })}
                  onWebcamPositionCommit={commitState}
                  videoElement={videoPlaybackRef.current?.video || null}
                  exportQuality={exportQuality}
                  onExportQualityChange={setExportQuality}
                  exportFormat={exportFormat}
                  onExportFormatChange={setExportFormat}
                  noiseReductionEnabled={noiseReductionEnabled}
                  onNoiseReductionEnabledChange={setNoiseReductionEnabled}
                  noiseReductionAmount={noiseReductionAmount}
                  onNoiseReductionAmountChange={setNoiseReductionAmount}
                  gifFrameRate={gifFrameRate}
                  onGifFrameRateChange={setGifFrameRate}
                  gifLoop={gifLoop}
                  onGifLoopChange={setGifLoop}
                  gifSizePreset={gifSizePreset}
                  onGifSizePresetChange={setGifSizePreset}
                  gifOutputDimensions={calculateOutputDimensions(
                    calculateEffectiveSourceDimensions(
                      videoPlaybackRef.current?.video?.videoWidth ||
                        DEFAULT_SOURCE_DIMENSIONS.width,
                      videoPlaybackRef.current?.video?.videoHeight ||
                        DEFAULT_SOURCE_DIMENSIONS.height,
                      cropRegion,
                    ).width,
                    calculateEffectiveSourceDimensions(
                      videoPlaybackRef.current?.video?.videoWidth ||
                        DEFAULT_SOURCE_DIMENSIONS.width,
                      videoPlaybackRef.current?.video?.videoHeight ||
                        DEFAULT_SOURCE_DIMENSIONS.height,
                      cropRegion,
                    ).height,
                    gifSizePreset,
                    GIF_SIZE_PRESETS,
                    aspectRatio === "native"
                      ? getNativeAspectRatioValue(
                          videoPlaybackRef.current?.video?.videoWidth ||
                            DEFAULT_SOURCE_DIMENSIONS.width,
                          videoPlaybackRef.current?.video?.videoHeight ||
                            DEFAULT_SOURCE_DIMENSIONS.height,
                          cropRegion,
                        )
                      : getAspectRatioValue(aspectRatio),
                  )}
                  onExport={handleOpenExportDialog}
                  onExportPanelOpen={() => {
                    setSelectedZoomId(null);
                    setSelectedTrimId(null);
                    setSelectedSpeedId(null);
                  }}
                  selectedAnnotationId={selectedAnnotationId}
                  annotationRegions={annotationOnlyRegions}
                  onAnnotationContentChange={handleAnnotationContentChange}
                  onAnnotationTypeChange={handleAnnotationTypeChange}
                  onAnnotationStyleChange={handleAnnotationStyleChange}
                  onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
                  onAnnotationDuplicate={handleAnnotationDuplicate}
                  onAnnotationDelete={handleAnnotationDelete}
                  selectedBlurId={selectedBlurId}
                  blurRegions={blurRegions}
                  onBlurDataChange={handleBlurDataPanelChange}
                  onBlurDataCommit={commitState}
                  onBlurDelete={handleAnnotationDelete}
                  selectedSpeedId={selectedSpeedId}
                  selectedSpeedValue={
                    selectedSpeedId
                      ? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
                      : null
                  }
                  onSpeedChange={handleSpeedChange}
                  onSpeedDelete={handleSpeedDelete}
                  unsavedExport={unsavedExport}
                  onSaveUnsavedExport={handleSaveUnsavedExport}
                  onSaveDiagnostic={handleSaveDiagnostic}
                  showCursor={showCursor}
                  onShowCursorChange={setShowCursor}
                  cursorSize={cursorSize}
                  onCursorSizeChange={setCursorSize}
                  cursorStyle={cursorStyle}
                  onCursorStyleChange={setCursorStyle}
                  cursorSmoothing={cursorSmoothing}
                  onCursorSmoothingChange={setCursorSmoothing}
                  cursorMotionBlur={cursorMotionBlur}
                  onCursorMotionBlurChange={setCursorMotionBlur}
                  cursorClickBounce={cursorClickBounce}
                  onCursorClickBounceChange={setCursorClickBounce}
                  cursorClipToBounds={cursorClipToBounds}
                  onCursorClipToBoundsChange={setCursorClipToBounds}
                  hasCursorData={
                    combinedCursorTelemetry.length > 0 ||
                    hasNativeCursorRecordingData(cursorRecordingData)
                  }
                  showCursorSettings={showCursorSettings}
                  onAddZoom={handleAddZoomFromSettings}
                  onAddCaption={handleAddCaptionFromSettings}
                  onAddBlur={handleAddBlurFromSettings}
                />
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>

      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        progress={exportProgress}
        isExporting={isExporting}
        error={exportError}
        onCancel={handleCancelExport}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        exportQuality={exportQuality}
        onExportQualityChange={setExportQuality}
        onStartExport={handleStartExportFromDialog}
        exportedFilePath={exportedFilePath || undefined}
        onShowInFolder={
          exportedFilePath ? () => void handleShowExportedFile(exportedFilePath) : undefined
        }
      />

      <UnsavedChangesDialog
        isOpen={showCloseConfirmDialog}
        onSaveAndClose={handleCloseConfirmSave}
        onDiscardAndClose={handleCloseConfirmDiscard}
        onCancel={handleCloseConfirmCancel}
      />
    </div>
  );
}
