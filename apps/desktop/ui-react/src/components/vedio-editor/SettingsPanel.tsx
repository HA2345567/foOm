import * as SliderPrimitive from "@radix-ui/react-slider";
import {
  Captions,
  Crop,
  Download,
  Film,
  Image,
  ImagePlus,
  Lock,
  AudioLines,
  MousePointer2,
  Share2,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  Webcam,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
  ZoomIn,
} from "lucide-react";
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScopedT } from "@/contexts/I18nContext";
import { WEBCAM_LAYOUT_PRESETS } from "@/lib/compositeLayout";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import {
  calculateEffectiveSourceDimensions,
  calculateMp4ExportSettings,
  GIF_FRAME_RATES,
  GIF_SIZE_PRESETS,
} from "@/lib/exporter";
import { cn } from "@/lib/utils";
import { resolveImageWallpaperUrl, WALLPAPER_PATHS, BG_GRADIENT_PATHS } from "@/lib/wallpaper";
import {
  type AspectRatio,
  isPortraitAspectRatio,
  getAspectRatioValue,
  getNativeAspectRatioValue,
} from "@/utils/aspectRatioUtils";
import { getTestId } from "@/utils/getTestId";
import ColorPicker from "../ui/color-picker";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { BlurSettingsPanel } from "./BlurSettingsPanel";
import { BACKGROUND_IMAGE_ACCEPT, isSupportedBackgroundImageType } from "./backgroundImageUpload";
import { CropControl } from "./CropControl";
import { parseCustomPlaybackSpeedInput } from "./customPlaybackSpeed";
import {
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_EDITOR_LAYOUT_SETTINGS,
  DEFAULT_EXPORT_SETTINGS,
  DEFAULT_GIF_SETTINGS,
  DEFAULT_SOURCE_DIMENSIONS,
  DEFAULT_WEBCAM_SETTINGS,
  MAX_EDITOR_PADDING,
} from "./editorDefaults";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import type {
  AnnotationRegion,
  AnnotationType,
  BlurData,
  CropRegion,
  CursorStyle,
  FigureData,
  PlaybackSpeed,
  Rotation3DPreset,
  WebcamPosition,
  WebcamLayoutPreset,
  WebcamMaskShape,
  WebcamSizePreset,
  ZoomDepth,
  ZoomFocus,
  ZoomFocusMode,
} from "./types";
import {
  MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  ROTATION_3D_PRESET_ORDER,
  SPEED_OPTIONS,
  ZOOM_DEPTH_SCALES,
} from "./types";
import { getFocusBoundsForScale } from "./videoPlayback/focusUtils";

function CustomSpeedInput({
  value,
  onChange,
  onError,
}: {
  value: number;
  onChange: (val: number) => void;
  onError: () => void;
}) {
  const isPreset = SPEED_OPTIONS.some((o) => o.speed === value);
  const [draft, setDraft] = useState(isPreset ? "" : String(value));
  const [isFocused, setIsFocused] = useState(false);

  const prevValue = useRef(value);
  if (!isFocused && prevValue.current !== value) {
    prevValue.current = value;
    setDraft(isPreset ? "" : String(value));
  }

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const result = parseCustomPlaybackSpeedInput(e.target.value);
      if (result.status === "too-fast") {
        onError();
        return;
      }

      setDraft(result.draft);
      if (result.status === "valid") {
        onChange(result.speed);
      }
    },
    [onChange, onError],
  );

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    const result = parseCustomPlaybackSpeedInput(draft);
    if (result.status === "valid") {
      setDraft(String(result.speed));
    } else {
      setDraft(isPreset ? "" : String(value));
    }
  }, [draft, isPreset, value]);

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.]?[0-9]*"
        placeholder="--"
        value={draft}
        onFocus={() => setIsFocused(true)}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-12 bg-white/5 border border-white/10 rounded-md px-1 py-0.5 text-[11px] font-semibold text-[#d97706] text-center focus:outline-none focus:border-[#d97706]/40"
      />
      <span className="text-[11px] font-semibold text-slate-500">×</span>
    </div>
  );
}

function ZoomFocusCoordInput({
  percent,
  onChange,
  onCommit,
  disabled,
  ariaLabel,
}: {
  percent: number;
  onChange: (nextPercent: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  // While the input is focused (user is editing), show their draft text
  // so partial entries like "5" or "" don't get overwritten by re-renders.
  // When not focused, mirror the live prop value so external changes
  // (dragging the overlay on the preview) update the displayed number in real time.
  const [draft, setDraft] = useState<string | null>(null);
  const display = percent.toFixed(1);

  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={100}
      step={0.1}
      value={draft ?? display}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => setDraft(display)}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const parsed = Number(next);
        if (next !== "" && Number.isFinite(parsed)) {
          const clamped = Math.min(100, Math.max(0, parsed));
          onChange(clamped);
        }
      }}
      onBlur={() => {
        setDraft(null);
        onCommit?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-7 w-full rounded-md border border-white/10 bg-white/5 px-2 text-[11px] text-slate-200 outline-none focus:border-[#D4D4D8]/50 focus:ring-1 focus:ring-[#D4D4D8]/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

const GRADIENTS = [
  "linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(253,129,82,1) 54.8%, rgba(249,202,86,1) 86.3% )",
  "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  "radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
  "linear-gradient( 111.6deg,  rgba(0,56,68,1) 0%, rgba(163,217,185,1) 51.5%, rgba(231, 148, 6, 1) 88.6% )",
  "linear-gradient( 107.7deg,  rgba(235,230,44,0.55) 8.4%, rgba(252,152,15,1) 90.3% )",
  "linear-gradient( 91deg,  rgba(72,154,78,1) 5.2%, rgba(251,206,70,1) 95.9% )",
  "radial-gradient( circle farthest-corner at 10% 20%,  rgba(2,37,78,1) 0%, rgba(4,56,126,1) 19.7%, rgba(85,245,221,1) 100.2% )",
  "linear-gradient( 109.6deg,  rgba(15,2,2,1) 11.2%, rgba(36,163,190,1) 91.1% )",
  "linear-gradient(135deg, #FBC8B4, #2447B1)",
  "linear-gradient(109.6deg, #F635A6, #36D860)",
  "linear-gradient(90deg, #FF0101, #4DFF01)",
  "linear-gradient(315deg, #EC0101, #5044A9)",
  "linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)",
  "linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(to right, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)",
  "linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)",
  "linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)",
  "linear-gradient(to right, #fa709a 0%, #fee140 100%)",
  "linear-gradient(to top, #30cfd0 0%, #330867 100%)",
  "linear-gradient(to top, #c471f5 0%, #fa71cd 100%)",
  "linear-gradient(to right, #f78ca0 0%, #f9748f 19%, #fd868c 60%, #fe9a8b 100%)",
  "linear-gradient(to top, #48c6ef 0%, #6f86d6 100%)",
  "linear-gradient(to right, #0acffe 0%, #495aff 100%)",
];

interface SettingsPanelProps {
  selected: string;
  onWallpaperChange: (path: string) => void;
  selectedZoomDepth?: ZoomDepth | null;
  onZoomDepthChange?: (depth: ZoomDepth) => void;
  selectedZoomCustomScale?: number | null;
  onZoomCustomScaleChange?: (scale: number) => void;
  onZoomCustomScaleCommit?: () => void;
  onZoomPreviewStart?: () => void;
  onZoomPreviewEnd?: () => void;
  selectedZoomFocusMode?: ZoomFocusMode | null;
  onZoomFocusModeChange?: (mode: ZoomFocusMode) => void;
  focusModeLocked?: boolean;
  selectedZoomFocus?: ZoomFocus | null;
  onZoomFocusCoordinateChange?: (focus: ZoomFocus) => void;
  onZoomFocusCoordinateCommit?: () => void;
  hasCursorTelemetry?: boolean;
  selectedZoomId?: string | null;
  onZoomDelete?: (id: string) => void;
  selectedZoomRotationPreset?: Rotation3DPreset | null;
  onZoomRotationPresetChange?: (preset: Rotation3DPreset | null) => void;
  selectedTrimId?: string | null;
  onTrimDelete?: (id: string) => void;
  shadowIntensity?: number;
  onShadowChange?: (intensity: number) => void;
  onShadowCommit?: () => void;
  showBlur?: boolean;
  onBlurChange?: (showBlur: boolean) => void;
  motionBlurAmount?: number;
  onMotionBlurChange?: (amount: number) => void;
  onMotionBlurCommit?: () => void;
  borderRadius?: number;
  onBorderRadiusChange?: (radius: number) => void;
  onBorderRadiusCommit?: () => void;
  padding?: number;
  onPaddingChange?: (padding: number) => void;
  onPaddingCommit?: () => void;
  cropRegion?: CropRegion;
  onCropChange?: (region: CropRegion) => void;
  aspectRatio: AspectRatio;
  videoElement?: HTMLVideoElement | null;
  exportQuality?: ExportQuality;
  onExportQualityChange?: (quality: ExportQuality) => void;
  // Export format settings
  exportFormat?: ExportFormat;
  onExportFormatChange?: (format: ExportFormat) => void;
  noiseReductionEnabled?: boolean;
  onNoiseReductionEnabledChange?: (enabled: boolean) => void;
  showTrimWaveform?: boolean;
  onTrimWaveformChange?: (show: boolean) => void;
  noiseReductionAmount?: number;
  onNoiseReductionAmountChange?: (amount: number) => void;
  gifFrameRate?: GifFrameRate;
  onGifFrameRateChange?: (rate: GifFrameRate) => void;
  gifLoop?: boolean;
  onGifLoopChange?: (loop: boolean) => void;
  gifSizePreset?: GifSizePreset;
  onGifSizePresetChange?: (preset: GifSizePreset) => void;
  gifOutputDimensions?: { width: number; height: number };
  onExport?: () => void;
  onExportPanelOpen?: () => void;
  unsavedExport?: {
    arrayBuffer: ArrayBuffer;
    fileName: string;
    format: string;
  } | null;
  onSaveUnsavedExport?: () => void;
  selectedAnnotationId?: string | null;
  annotationRegions?: AnnotationRegion[];
  onAnnotationContentChange?: (id: string, content: string) => void;
  onAnnotationTypeChange?: (id: string, type: AnnotationType) => void;
  onAnnotationStyleChange?: (id: string, style: Partial<AnnotationRegion["style"]>) => void;
  onAnnotationFigureDataChange?: (id: string, figureData: FigureData) => void;
  onAnnotationDuplicate?: (id: string) => void;
  onAnnotationDelete?: (id: string) => void;
  selectedBlurId?: string | null;
  blurRegions?: AnnotationRegion[];
  onBlurDataChange?: (id: string, blurData: BlurData) => void;
  onBlurDataCommit?: () => void;
  onBlurDelete?: (id: string) => void;
  selectedSpeedId?: string | null;
  selectedSpeedValue?: PlaybackSpeed | null;
  onSpeedChange?: (speed: PlaybackSpeed) => void;
  onSpeedDelete?: (id: string) => void;
  hasWebcam?: boolean;
  webcamLayoutPreset?: WebcamLayoutPreset;
  onWebcamLayoutPresetChange?: (preset: WebcamLayoutPreset) => void;
  webcamMaskShape?: import("./types").WebcamMaskShape;
  onWebcamMaskShapeChange?: (shape: import("./types").WebcamMaskShape) => void;
  webcamSizePreset?: WebcamSizePreset;
  onWebcamSizePresetChange?: (size: WebcamSizePreset) => void;
  onWebcamSizePresetCommit?: () => void;
  webcamPosition?: WebcamPosition | null;
  onWebcamPositionChange?: (position: WebcamPosition | null) => void;
  onWebcamPositionCommit?: () => void;
  webcamMirrored?: boolean;
  onWebcamMirroredChange?: (mirrored: boolean) => void;
  webcamReactiveZoom?: boolean;
  onWebcamReactiveZoomChange?: (reactive: boolean) => void;
  onSaveDiagnostic?: () => Promise<void>;
  showCursor?: boolean;
  onShowCursorChange?: (show: boolean) => void;
  cursorSize?: number;
  onCursorSizeChange?: (size: number) => void;
  cursorStyle?: CursorStyle;
  onCursorStyleChange?: (style: CursorStyle) => void;
  cursorSmoothing?: number;
  onCursorSmoothingChange?: (smoothing: number) => void;
  cursorMotionBlur?: number;
  onCursorMotionBlurChange?: (blur: number) => void;
  cursorClickBounce?: number;
  onCursorClickBounceChange?: (bounce: number) => void;
  cursorClipToBounds?: boolean;
  onCursorClipToBoundsChange?: (clip: boolean) => void;
  hasCursorData?: boolean;
  showCursorSettings?: boolean;
  onAddZoom?: () => void;
  onAddCaption?: () => void;
  onAddBlur?: () => void;
  onSelectZoom?: (id: string | null) => void;
  onSelectTrim?: (id: string | null) => void;
  onSelectSpeed?: (id: string | null) => void;
  onSelectAnnotation?: (id: string | null) => void;
  onSelectBlur?: (id: string | null) => void;
}

export default SettingsPanel;

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
  { depth: 1, label: "1.25×" },
  { depth: 2, label: "1.5×" },
  { depth: 3, label: "1.8×" },
  { depth: 4, label: "2.2×" },
  { depth: 5, label: "3.5×" },
  { depth: 6, label: "5×" },
];

type SettingsPanelMode =
  | "background"
  | "timeline"
  | "zoom"
  | "effects"
  | "layout"
  | "cursor"
  | "captions"
  | "audio"
  | "export";

const MP4_EXPORT_SHORT_SIDES = {
  low: 480,
  medium: 720,
  good: 1080,
  ultra: 2160,
} as const;

const MP4_EXPORT_QUALITY_LABELS: Record<ExportQuality, string> = {
  medium: "720p",
  good: "1080p",
  source: "Source",
};

const WEBCAM_POSITION_PRESETS: Array<{
  label: string;
  icon: string;
  position: WebcamPosition;
}> = [
  { label: "Top left", icon: "↖", position: { cx: 0.18, cy: 0.18 } },
  { label: "Top center", icon: "↑", position: { cx: 0.5, cy: 0.18 } },
  { label: "Top right", icon: "↗", position: { cx: 0.82, cy: 0.18 } },
  { label: "Middle left", icon: "←", position: { cx: 0.18, cy: 0.5 } },
  { label: "Center", icon: "○", position: { cx: 0.5, cy: 0.5 } },
  { label: "Middle right", icon: "→", position: { cx: 0.82, cy: 0.5 } },
  { label: "Bottom left", icon: "↙", position: { cx: 0.18, cy: 0.82 } },
  { label: "Bottom center", icon: "↓", position: { cx: 0.5, cy: 0.82 } },
  { label: "Bottom right", icon: "↘", position: { cx: 0.82, cy: 0.82 } },
];

function isSameWebcamPosition(a: WebcamPosition | null | undefined, b: WebcamPosition) {
  return Boolean(a && Math.abs(a.cx - b.cx) < 0.001 && Math.abs(a.cy - b.cy) < 0.001);
}

function formatSourceDimensions(videoElement?: HTMLVideoElement | null, cropRegion?: CropRegion) {
  const width = videoElement?.videoWidth ?? 0;
  const height = videoElement?.videoHeight ?? 0;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const dimensions = calculateEffectiveSourceDimensions(width, height, cropRegion);
  return { ...dimensions, shortSide: Math.min(dimensions.width, dimensions.height) };
}

export function SettingsPanel({
  selected,
  onWallpaperChange,
  selectedZoomDepth,
  onZoomDepthChange,
  selectedZoomCustomScale,
  onZoomCustomScaleChange,
  onZoomCustomScaleCommit,
  onZoomPreviewStart,
  onZoomPreviewEnd,
  selectedZoomFocusMode,
  onZoomFocusModeChange,
  focusModeLocked = false,
  selectedZoomFocus,
  onZoomFocusCoordinateChange,
  onZoomFocusCoordinateCommit,
  hasCursorTelemetry = false,
  selectedZoomId,
  onZoomDelete,
  selectedZoomRotationPreset,
  onZoomRotationPresetChange,
  selectedTrimId,
  onTrimDelete,
  shadowIntensity = 0,
  onShadowChange,
  onShadowCommit,
  showBlur,
  onBlurChange,
  motionBlurAmount = 0,
  onMotionBlurChange,
  onMotionBlurCommit,
  borderRadius = 0,
  onBorderRadiusChange,
  onBorderRadiusCommit,
  padding = DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
  onPaddingChange,
  onPaddingCommit,
  cropRegion,
  onCropChange,
  aspectRatio,
  videoElement,
  exportQuality = DEFAULT_EXPORT_SETTINGS.quality,
  onExportQualityChange,
  exportFormat = DEFAULT_EXPORT_SETTINGS.format,
  onExportFormatChange,
  noiseReductionEnabled = DEFAULT_EXPORT_SETTINGS.noiseReduction.enabled,
  onNoiseReductionEnabledChange,
  showTrimWaveform = true,
  onTrimWaveformChange,
  noiseReductionAmount = DEFAULT_EXPORT_SETTINGS.noiseReduction.amount,
  onNoiseReductionAmountChange,
  gifFrameRate = DEFAULT_GIF_SETTINGS.frameRate,
  onGifFrameRateChange,
  gifLoop = DEFAULT_GIF_SETTINGS.loop,
  onGifLoopChange,
  gifSizePreset = DEFAULT_GIF_SETTINGS.sizePreset,
  onGifSizePresetChange,
  gifOutputDimensions = DEFAULT_GIF_SETTINGS.outputDimensions,
  onExport,
  onExportPanelOpen,
  unsavedExport,
  onSaveUnsavedExport,
  selectedAnnotationId,
  annotationRegions = [],
  onAnnotationContentChange,
  onAnnotationTypeChange,
  onAnnotationStyleChange,
  onAnnotationFigureDataChange,
  onAnnotationDuplicate,
  onAnnotationDelete,
  selectedBlurId,
  blurRegions = [],
  onBlurDataChange,
  onBlurDataCommit,
  onBlurDelete,
  selectedSpeedId,
  selectedSpeedValue,
  onSpeedChange,
  onSpeedDelete,
  hasWebcam = false,
  webcamLayoutPreset = DEFAULT_WEBCAM_SETTINGS.layoutPreset,
  onWebcamLayoutPresetChange,
  webcamMaskShape = DEFAULT_WEBCAM_SETTINGS.maskShape,
  onWebcamMaskShapeChange,
  webcamSizePreset = DEFAULT_WEBCAM_SETTINGS.sizePreset,
  onWebcamSizePresetChange,
  onWebcamSizePresetCommit,
  webcamPosition = DEFAULT_WEBCAM_SETTINGS.position,
  onWebcamPositionChange,
  onWebcamPositionCommit,
  webcamMirrored = false,
  onWebcamMirroredChange,
  webcamReactiveZoom = false,
  onWebcamReactiveZoomChange,
  onSaveDiagnostic,
  showCursor = DEFAULT_CURSOR_SETTINGS.show,
  onShowCursorChange,
  cursorSize = DEFAULT_CURSOR_SETTINGS.size,
  onCursorSizeChange,
  cursorStyle = "arrow",
  onCursorStyleChange,
  cursorSmoothing = DEFAULT_CURSOR_SETTINGS.smoothing,
  onCursorSmoothingChange,
  cursorMotionBlur = DEFAULT_CURSOR_SETTINGS.motionBlur,
  onCursorMotionBlurChange,
  cursorClickBounce = DEFAULT_CURSOR_SETTINGS.clickBounce,
  onCursorClickBounceChange,
  cursorClipToBounds = DEFAULT_CURSOR_SETTINGS.clipToBounds,
  onCursorClipToBoundsChange,
  hasCursorData = false,
  showCursorSettings = true,
  onAddZoom,
  onAddCaption,
  onAddBlur,
  onSelectZoom,
  onSelectTrim,
  onSelectSpeed,
  onSelectAnnotation,
  onSelectBlur,
}: SettingsPanelProps) {
  const t = useScopedT("settings");
  const [activePanelMode, setActivePanelMode] = useState<SettingsPanelMode>("background");
  const [previewMuted, setPreviewMuted] = useState(() => videoElement?.muted ?? false);
  const [previewVolume, setPreviewVolume] = useState(() =>
    Math.round((videoElement?.volume ?? 1) * 100),
  );
  const sourceDimensions = formatSourceDimensions(videoElement, cropRegion);
  // Resolved URLs are for DOM rendering only (backgroundImage). The canonical
  // `/wallpapers/wallpaperN.jpg` form in WALLPAPER_PATHS is what gets persisted
  // on click — never the machine-specific file:// URL.
  const wallpaperPreviewUrls = useMemo(() => WALLPAPER_PATHS.map(resolveImageWallpaperUrl), []);
  const gradientPreviewUrls = useMemo(() => BG_GRADIENT_PATHS.map(resolveImageWallpaperUrl), []);
  const [customImages, setCustomImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorPalette = [
    "#FF0000",
    "#FFD700",
    "#00FF00",
    "#FFFFFF",
    "#0000FF",
    "#FF6B00",
    "#9B59B6",
    "#E91E63",
    "#00BCD4",
    "#FF5722",
    "#8BC34A",
    "#FFC107",
    "#D4D4D8",
    "#000000",
    "#607D8B",
    "#795548",
  ];

  const [selectedColor, setSelectedColor] = useState("#ADADAD");
  const [gradient, setGradient] = useState<string>(GRADIENTS[0]);
  const [cropAspectLocked, setCropAspectLocked] = useState(false);
  const [cropAspectRatio, setCropAspectRatio] = useState("");
  const isPortraitCanvas = isPortraitAspectRatio(aspectRatio);

  // Automatically switch active panel mode to "zoom" when a zoom is selected
  useEffect(() => {
    if (selectedZoomId) {
      setActivePanelMode("zoom");
    }
  }, [selectedZoomId]);

  useEffect(() => {
    if (!videoElement) return;
    setPreviewMuted(videoElement.muted);
    setPreviewVolume(Math.round(videoElement.volume * 100));
  }, [videoElement]);

  const setPreviewAudioMuted = useCallback(
    (muted: boolean) => {
      setPreviewMuted(muted);
      if (videoElement) {
        videoElement.muted = muted;
      }
    },
    [videoElement],
  );

  const setPreviewAudioVolume = useCallback(
    (volume: number) => {
      const clamped = Math.max(0, Math.min(100, volume));
      setPreviewVolume(clamped);
      if (videoElement) {
        videoElement.volume = clamped / 100;
        if (clamped > 0 && videoElement.muted) {
          videoElement.muted = false;
          setPreviewMuted(false);
        }
      }
    },
    [videoElement],
  );

  // Sync selectedColor state with selected prop if it is a color
  useEffect(() => {
    if (
      selected &&
      (selected.startsWith("#") || selected.startsWith("rgb") || selected.startsWith("hsl"))
    ) {
      setSelectedColor(selected);
    }
  }, [selected]);

  const videoWidth = videoElement?.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
  const videoHeight = videoElement?.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;

  const handleCropNumericChange = useCallback(
    (field: "x" | "y" | "width" | "height", pixelValue: number) => {
      if (!cropRegion || !onCropChange) return;

      const next = { ...cropRegion };
      switch (field) {
        case "x":
          next.x = Math.max(0, Math.min(pixelValue / videoWidth, 1 - next.width));
          break;
        case "y":
          next.y = Math.max(0, Math.min(pixelValue / videoHeight, 1 - next.height));
          break;
        case "width": {
          const newWidth = Math.max(0.05, Math.min(pixelValue / videoWidth, 1 - next.x));
          if (cropAspectLocked && next.width > 0 && next.height > 0) {
            const ratio = next.width / next.height;
            const newHeight = newWidth / ratio;
            if (next.y + newHeight <= 1) {
              next.width = newWidth;
              next.height = newHeight;
            }
          } else {
            next.width = newWidth;
          }
          break;
        }
        case "height": {
          const newHeight = Math.max(0.05, Math.min(pixelValue / videoHeight, 1 - next.y));
          if (cropAspectLocked && next.width > 0 && next.height > 0) {
            const ratio = next.width / next.height;
            const newWidth = newHeight * ratio;
            if (next.x + newWidth <= 1) {
              next.height = newHeight;
              next.width = newWidth;
            }
          } else {
            next.height = newHeight;
          }
          break;
        }
      }

      onCropChange(next);
    },
    [cropRegion, onCropChange, videoWidth, videoHeight, cropAspectLocked],
  );

  const applyCropAspectPreset = useCallback(
    (preset: string) => {
      if (!cropRegion || !onCropChange) return;

      setCropAspectRatio(preset);
      if (preset === "") {
        setCropAspectLocked(false);
        return;
      }

      const [wStr, hStr] = preset.split(":");
      const targetRatio = Number(wStr) / Number(hStr);
      const next = { ...cropRegion };

      const nextHeight = (next.width * videoWidth) / (targetRatio * videoHeight);
      if (next.y + nextHeight <= 1 && nextHeight >= 0.05) {
        next.height = nextHeight;
      } else {
        const nextWidth = (next.height * videoHeight * targetRatio) / videoWidth;
        if (next.x + nextWidth <= 1 && nextWidth >= 0.05) {
          next.width = nextWidth;
        }
      }

      onCropChange(next);
      setCropAspectLocked(true);
    },
    [cropRegion, onCropChange, videoWidth, videoHeight],
  );

  const getCropPixelValue = useCallback(
    (field: "x" | "y" | "width" | "height"): number => {
      if (!cropRegion) return 0;
      switch (field) {
        case "x":
          return Math.round(cropRegion.x * videoWidth);
        case "y":
          return Math.round(cropRegion.y * videoHeight);
        case "width":
          return Math.round(cropRegion.width * videoWidth);
        case "height":
          return Math.round(cropRegion.height * videoHeight);
      }
    },
    [cropRegion, videoWidth, videoHeight],
  );
  const [showCropDropdown, setShowCropDropdown] = useState(false);
  const handleCropToggle = () => setShowCropDropdown((open) => !open);

  const getMp4ExportDimensions = useCallback(
    (quality: ExportQuality) => {
      if (!sourceDimensions) return { width: 0, height: 0 };
      const aspectRatioValue =
        aspectRatio === "native"
          ? getNativeAspectRatioValue(videoWidth, videoHeight, cropRegion)
          : getAspectRatioValue(aspectRatio);
      return calculateMp4ExportSettings({
        quality,
        sourceWidth: sourceDimensions.width,
        sourceHeight: sourceDimensions.height,
        aspectRatioValue,
      });
    },
    [sourceDimensions, aspectRatio, videoWidth, videoHeight, cropRegion],
  );

  const zoomEnabled = Boolean(selectedZoomDepth);
  const trimEnabled = Boolean(selectedTrimId);
  const hasTimelineSelection = Boolean(selectedZoomId || selectedTrimId || selectedSpeedId);
  const hasCursorPanel = showCursorSettings && hasCursorData;
  const panelModes: Array<{
    id: SettingsPanelMode;
    label: string;
    icon: ComponentType<{ className?: string }>;
    disabled?: boolean;
  }> = [
    { id: "background", label: "Canvas", icon: ImagePlus },
    { id: "timeline", label: "Timeline Tools", icon: WandSparkles },
    { id: "cursor", label: "Cursor", icon: MousePointer2, disabled: !hasCursorPanel },
    { id: "layout", label: "Webcam", icon: Webcam, disabled: !hasWebcam },
    { id: "captions", label: "Captions", icon: Captions },
    { id: "audio", label: "Audio", icon: AudioLines, disabled: !videoElement },
  ];
   const activeModeLabel =
    [...panelModes, { id: "zoom", label: "Zoom" }].find(
      (mode) => mode.id === activePanelMode,
    )?.label ?? "Canvas";
  const handleCloseInspector = () => {
    onSelectZoom?.(null);
    onSelectTrim?.(null);
    onSelectSpeed?.(null);
    onSelectAnnotation?.(null);
    onSelectBlur?.(null);
  };
  const handleDeleteClick = () => {
    if (selectedZoomId && onZoomDelete) {
      onZoomDelete(selectedZoomId);
    }
  };
  const handleTrimDeleteClick = () => {
    if (selectedTrimId && onTrimDelete) {
      onTrimDelete(selectedTrimId);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    if (!isSupportedBackgroundImageType(file.type, file.name)) {
      toast.error(t("imageUpload.invalidFileType"), {
        description: t("imageUpload.jpgOnly"),
      });
      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setCustomImages((prev) => [...prev, dataUrl]);
        onWallpaperChange(dataUrl);
        toast.success(t("imageUpload.uploadSuccess"));
      }
    };

    reader.onerror = () => {
      toast.error(t("imageUpload.failedToUpload"), {
        description: t("imageUpload.errorReading"),
      });
    };

    reader.readAsDataURL(file);
    // Reset input so the same file can be selected again
    event.target.value = "";
  };

  const handleRemoveCustomImage = (imageUrl: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCustomImages((prev) => prev.filter((img) => img !== imageUrl));
    // If the removed image was selected, clear selection
    if (selected === imageUrl) {
      onWallpaperChange(WALLPAPER_PATHS[0]);
    }
  };

  // Find selected annotation
  const selectedAnnotation = selectedAnnotationId
    ? annotationRegions.find((a) => a.id === selectedAnnotationId)
    : null;
  const selectedBlur = selectedBlurId
    ? blurRegions.find((region) => region.id === selectedBlurId)
    : null;
  // If an annotation is selected, show annotation settings instead
  if (
    selectedAnnotation &&
    onAnnotationContentChange &&
    onAnnotationTypeChange &&
    onAnnotationStyleChange &&
    onAnnotationDelete
  ) {
    return (
      <div className="editor-inspector-shell flex min-w-0 flex-col h-full overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <AnnotationSettingsPanel
            annotation={selectedAnnotation}
            onContentChange={(content) => onAnnotationContentChange(selectedAnnotation.id, content)}
            onTypeChange={(type) => onAnnotationTypeChange(selectedAnnotation.id, type)}
            onStyleChange={(style) => onAnnotationStyleChange(selectedAnnotation.id, style)}
            onFigureDataChange={
              onAnnotationFigureDataChange
                ? (figureData) => onAnnotationFigureDataChange(selectedAnnotation.id, figureData)
                : undefined
            }
            onDuplicate={
              onAnnotationDuplicate ? () => onAnnotationDuplicate(selectedAnnotation.id) : undefined
            }
            onDelete={() => onAnnotationDelete(selectedAnnotation.id)}
            onClose={() => onSelectAnnotation?.(null)}
          />
        </div>
      </div>
    );
  }

  if (selectedBlur && onBlurDataChange && onBlurDelete) {
    return (
      <div className="editor-inspector-shell flex min-w-0 flex-col h-full overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <BlurSettingsPanel
            blurRegion={selectedBlur}
            onBlurDataChange={(blurData) => onBlurDataChange(selectedBlur.id, blurData)}
            onBlurDataCommit={onBlurDataCommit}
            onDelete={() => onBlurDelete(selectedBlur.id)}
            onClose={() => onSelectBlur?.(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="editor-inspector-shell flex min-w-0 flex-col h-full overflow-hidden">
      <div className="flex flex-row-reverse min-h-0 flex-1">
        <div className="settings-mode-rail flex w-12 shrink-0 flex-col items-center gap-2 border-l border-white/[0.05] px-1.5 py-3">
          {panelModes.map((mode) => {
            const Icon = mode.icon;
            const isActive = activePanelMode === mode.id && !hasTimelineSelection;
            return (
              <button
                key={mode.id}
                type="button"
                title={mode.label}
                disabled={mode.disabled}
                onClick={() => {
                  if (mode.disabled) return;
                  setActivePanelMode(mode.id);
                }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-200 cursor-pointer",
                  mode.disabled
                    ? "cursor-not-allowed border-transparent text-slate-800"
                    : isActive
                      ? "border-white/12 bg-white text-[#09090b] shadow-[0_8px_22px_rgba(0,0,0,0.36)]"
                      : "border-transparent text-slate-500 hover:border-white/12 hover:bg-white/[0.07] hover:text-slate-100",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}

        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-4 pb-4">
          <div className="mb-4 flex items-center justify-between px-1">
            <span className="text-[14px] font-display font-semibold tracking-wide text-slate-50">
              {activeModeLabel}
            </span>
            {hasTimelineSelection || selectedAnnotationId || selectedBlurId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseInspector}
                className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 h-7 px-2 border border-white/10 rounded-md cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
                Close settings
              </Button>
            ) : (
              <KeyboardShortcutsHelp />
            )}
          </div>
          {zoomEnabled && (
            <div className="space-y-3 mb-4">
              <div className="foom-inspector-card">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t("zoom.level")}
                  </span>
                  <span className="rounded-full border border-[#D4D4D8]/25 bg-[#D4D4D8]/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#D4D4D8]">
                    {(
                      selectedZoomCustomScale ??
                      (selectedZoomDepth != null
                        ? ZOOM_DEPTH_SCALES[selectedZoomDepth]
                        : MIN_ZOOM_SCALE)
                    ).toFixed(2)}
                    ×
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1 mb-3">
                  {ZOOM_DEPTH_OPTIONS.map((option) => {
                    const effectiveScale =
                      selectedZoomCustomScale ??
                      (selectedZoomDepth != null ? ZOOM_DEPTH_SCALES[selectedZoomDepth] : null);
                    const isActive = effectiveScale === ZOOM_DEPTH_SCALES[option.depth];
                    return (
                      <Button
                        key={option.depth}
                        type="button"
                        disabled={!zoomEnabled}
                        onClick={() => onZoomDepthChange?.(option.depth)}
                        className={cn(
                          "h-8 w-full rounded-lg border px-1 text-center transition-all duration-150 ease-out cursor-pointer",
                          isActive
                            ? "border-[#D4D4D8]/70 bg-[#D4D4D8] text-[#09090b] shadow-[0_8px_20px_rgba(212, 212, 216,0.18)]"
                            : "border-white/[0.06] bg-white/[0.035] text-slate-400 hover:bg-white/[0.075] hover:border-white/15 hover:text-slate-200",
                        )}
                      >
                        <span className="text-[11px] font-semibold">{option.label}</span>
                      </Button>
                    );
                  })}
                </div>
                <div className="mb-2">
                  <SliderPrimitive.Root
                    min={MIN_ZOOM_SCALE}
                    max={MAX_ZOOM_SCALE}
                    step={0.01}
                    value={[
                      selectedZoomCustomScale ??
                        (selectedZoomDepth != null
                          ? ZOOM_DEPTH_SCALES[selectedZoomDepth]
                          : MIN_ZOOM_SCALE),
                    ]}
                    onValueChange={(values) => onZoomCustomScaleChange?.(values[0])}
                    onValueCommit={() => onZoomCustomScaleCommit?.()}
                    disabled={!zoomEnabled}
                    className="relative flex w-full touch-none select-none items-center py-1"
                  >
                    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full border border-white/10 bg-white/5">
                      <SliderPrimitive.Range
                        className={cn(
                          "absolute h-full transition-colors duration-150",
                          selectedZoomCustomScale != null ? "bg-[#D4D4D8]" : "bg-white/20",
                        )}
                      />
                    </SliderPrimitive.Track>
                    <SliderPrimitive.Thumb
                      className={cn(
                        "block h-3.5 w-3.5 rounded-full border-2 shadow transition-all duration-150",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4D4D8]/50",
                        "disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing",
                        selectedZoomCustomScale != null
                          ? "border-[#D4D4D8] bg-[#D4D4D8] shadow-[0_0_6px_rgba(212, 212, 216,0.35)]"
                          : "border-white/20 bg-[#2a2a30] hover:border-white/40",
                      )}
                    />
                  </SliderPrimitive.Root>
                  <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                    <span>{MIN_ZOOM_SCALE.toFixed(1)}×</span>
                    <span>{MAX_ZOOM_SCALE.toFixed(1)}×</span>
                  </div>
                </div>
                {onZoomPreviewStart && onZoomPreviewEnd && (
                  <Button
                    type="button"
                    onPointerDown={() => onZoomPreviewStart()}
                    onPointerUp={() => onZoomPreviewEnd()}
                    onPointerLeave={() => onZoomPreviewEnd()}
                    onPointerCancel={() => onZoomPreviewEnd()}
                    onKeyDown={(e) => {
                      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                        e.preventDefault();
                        onZoomPreviewStart();
                      }
                    }}
                    onKeyUp={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        onZoomPreviewEnd();
                      }
                    }}
                    onBlur={() => onZoomPreviewEnd()}
                    className="h-7 w-full select-none rounded-md border border-white/[0.08] bg-white/[0.04] text-[10px] font-semibold text-slate-300 transition-all duration-150 ease-out hover:bg-white/[0.08] hover:text-slate-100 active:border-[#D4D4D8]/50 active:bg-[#D4D4D8] active:text-[#09090b] cursor-pointer mt-3"
                  >
                    {t("zoom.previewHold")}
                  </Button>
                )}
              </div>

              <div className="foom-inspector-card">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t("zoom.focusMode.title")}
                  </span>
                  <div className="grid w-32 grid-cols-2 gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.035] p-0.5">
                    {(["manual", "auto"] as const).map((mode) => {
                      const isActive = selectedZoomFocusMode === mode;
                      return (
                        <Button
                          key={mode}
                          type="button"
                          disabled={focusModeLocked}
                          onClick={() => onZoomFocusModeChange?.(mode)}
                          className={cn(
                            "h-6 w-full rounded-md border px-1 text-center transition-all duration-150 ease-out cursor-pointer",
                            isActive
                              ? "border-[#D4D4D8]/50 bg-[#D4D4D8] text-[#09090b]"
                              : "border-transparent bg-transparent text-slate-400 hover:bg-white/[0.06] hover:text-slate-200",
                          )}
                        >
                          <span className="text-[10px] font-semibold capitalize">
                            {t(`zoom.focusMode.${mode}`)}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
                {zoomEnabled &&
                  selectedZoomFocusMode !== "auto" &&
                  selectedZoomFocus &&
                  onZoomFocusCoordinateChange &&
                  (() => {
                    const effectiveZoomScale =
                      selectedZoomCustomScale ??
                      (selectedZoomDepth != null
                        ? ZOOM_DEPTH_SCALES[selectedZoomDepth]
                        : MIN_ZOOM_SCALE);
                    const bounds = getFocusBoundsForScale(effectiveZoomScale);
                    const xRange = bounds.maxX - bounds.minX;
                    const yRange = bounds.maxY - bounds.minY;
                    const focusToPercentX = (cx: number) =>
                      xRange <= 0
                        ? 50
                        : Math.max(0, Math.min(100, ((cx - bounds.minX) / xRange) * 100));
                    const focusToPercentY = (cy: number) =>
                      yRange <= 0
                        ? 50
                        : Math.max(0, Math.min(100, ((cy - bounds.minY) / yRange) * 100));
                    const percentToFocusX = (p: number) =>
                      xRange <= 0 ? bounds.minX : bounds.minX + (p / 100) * xRange;
                    const percentToFocusY = (p: number) =>
                      yRange <= 0 ? bounds.minY : bounds.minY + (p / 100) * yRange;
                    return (
                      <div className="pt-2 border-t border-white/5 space-y-2">
                        <span className="text-[11px] font-medium text-slate-400 block">
                          {t("zoom.focusCoords")}
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                              {t("zoom.position.x")}
                            </label>
                            <ZoomFocusCoordInput
                              ariaLabel={t("zoom.position.x")}
                              percent={focusToPercentX(selectedZoomFocus.cx)}
                              onChange={(p) =>
                                onZoomFocusCoordinateChange({
                                  cx: percentToFocusX(p),
                                  cy: selectedZoomFocus.cy,
                                })
                              }
                              onCommit={onZoomFocusCoordinateCommit}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                              {t("zoom.position.y")}
                            </label>
                            <ZoomFocusCoordInput
                              ariaLabel={t("zoom.position.y")}
                              percent={focusToPercentY(selectedZoomFocus.cy)}
                              onChange={(p) =>
                                onZoomFocusCoordinateChange({
                                  cx: selectedZoomFocus.cx,
                                  cy: percentToFocusY(p),
                                })
                              }
                              onCommit={onZoomFocusCoordinateCommit}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
              </div>

              <div className="foom-inspector-card">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5 block">
                  {t("zoom.threeD.title")}
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {ROTATION_3D_PRESET_ORDER.map((preset) => {
                    const isActive = selectedZoomRotationPreset === preset;
                    return (
                      <Button
                        key={preset}
                        type="button"
                        onClick={() => onZoomRotationPresetChange?.(isActive ? null : preset)}
                        className={cn(
                          "h-8 w-full rounded-lg border px-1 text-center transition-all duration-150 ease-out cursor-pointer",
                          isActive
                            ? "border-[#D4D4D8]/60 bg-[#D4D4D8] text-[#09090b]"
                            : "border-white/[0.06] bg-white/[0.035] text-slate-400 hover:bg-white/[0.075] hover:border-white/15 hover:text-slate-200",
                        )}
                      >
                        <span className="text-xs font-semibold capitalize">
                          {t(`zoom.threeD.preset.${preset}`)}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={handleDeleteClick}
                variant="destructive"
                size="sm"
                className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs mt-2 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                {t("zoom.deleteZoom")}
              </Button>
            </div>
          )}

          {trimEnabled && (
            <div className="foom-inspector-card mb-4 space-y-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                Trim Settings
              </span>
              <p className="text-xs text-slate-400">{t("trim.trimInstruction")}</p>
              <Button
                onClick={handleTrimDeleteClick}
                variant="destructive"
                size="sm"
                className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                {t("trim.deleteRegion")}
              </Button>
            </div>
          )}

          {selectedSpeedId && (
            <div className="space-y-3 mb-4">
              <div className="foom-inspector-card">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t("speed.playbackSpeed")}
                  </span>
                  {selectedSpeedId && selectedSpeedValue && (
                    <span className="rounded-full border border-[#d97706]/25 bg-[#d97706]/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#d97706]">
                      {SPEED_OPTIONS.find((o) => o.speed === selectedSpeedValue)?.label ??
                        `${selectedSpeedValue}×`}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1 mb-3">
                  {SPEED_OPTIONS.map((option) => {
                    const isActive = selectedSpeedValue === option.speed;
                    return (
                      <Button
                        key={option.speed}
                        type="button"
                        disabled={!selectedSpeedId}
                        onClick={() => onSpeedChange?.(option.speed)}
                        className={cn(
                          "h-8 w-full rounded-lg border px-1 text-center transition-all duration-150 ease-out",
                          selectedSpeedId
                            ? "opacity-100 cursor-pointer"
                            : "opacity-40 cursor-not-allowed",
                          isActive
                            ? "border-[#d97706]/70 bg-[#d97706] text-white shadow-[0_8px_20px_rgba(217,119,6,0.16)]"
                            : "border-white/[0.06] bg-white/[0.035] text-slate-400 hover:bg-white/[0.075] hover:border-white/15 hover:text-slate-200",
                        )}
                      >
                        <span className="text-[11px] font-semibold">{option.label}</span>
                      </Button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                  <span
                    className={cn(
                      "text-[11px]",
                      selectedSpeedId ? "text-slate-500" : "text-slate-600",
                    )}
                  >
                    {t("speed.customPlaybackSpeed")}
                  </span>
                  {selectedSpeedId ? (
                    <CustomSpeedInput
                      value={selectedSpeedValue ?? 1}
                      onChange={(val) => onSpeedChange?.(val)}
                      onError={() => toast.error(t("speed.maxSpeedError"))}
                    />
                  ) : (
                    <div className="flex items-center gap-1 opacity-40">
                      <div className="w-12 bg-white/5 border border-white/10 rounded-md px-1 py-0.5 text-[11px] font-semibold text-slate-600 text-center">
                        --
                      </div>
                      <span className="text-[11px] font-semibold text-slate-600">×</span>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={() => selectedSpeedId && onSpeedDelete?.(selectedSpeedId)}
                variant="destructive"
                size="sm"
                className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                {t("speed.deleteRegion")}
              </Button>
            </div>
          )}

          {!hasTimelineSelection && (
            <div className="space-y-3">
              {activePanelMode === "zoom" && (
                <div className="space-y-4">
                  <div className="foom-inspector-card flex flex-col items-center text-center p-6 space-y-3 bg-white/[0.02] border-white/[0.05]">
                    <div className="w-10 h-10 rounded-full bg-[#D4D4D8]/10 flex items-center justify-center text-[#D4D4D8] mb-1">
                      <ZoomIn className="w-5 h-5" />
                    </div>
                    <span className="text-[13px] font-semibold text-slate-200">
                      No Zoom Selected
                    </span>
                    <p className="text-xs text-slate-400 leading-relaxed max-w-[200px]">
                      Select a zoom region on the timeline or add a new one at the current playhead
                      to edit zoom levels, 3D rotation, and camera focus.
                    </p>
                    <Button
                      onClick={onAddZoom}
                      className="w-full mt-2 py-4 text-xs font-semibold flex items-center justify-center gap-1.5 bg-[#D4D4D8] text-[#09090b] rounded-lg shadow-md shadow-[#D4D4D8]/10 hover:bg-[#E4E4E7] text-[#09090b] transition-all cursor-pointer"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                      Add Zoom Region
                    </Button>
                  </div>
                </div>
              )}

              {hasWebcam && activePanelMode === "layout" && (
                <div className="space-y-3">
                  <div className="foom-inspector-card">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      {t("layout.preset")}
                    </div>
                    <Select
                      value={webcamLayoutPreset}
                      onValueChange={(value: WebcamLayoutPreset) =>
                        onWebcamLayoutPresetChange?.(value)
                      }
                    >
                      <SelectTrigger className="h-8 bg-black/20 border-white/10 text-xs cursor-pointer">
                        <SelectValue placeholder={t("layout.selectPreset")} />
                      </SelectTrigger>
                      <SelectContent>
                        {WEBCAM_LAYOUT_PRESETS.filter((preset) => {
                          if (preset.value === "vertical-stack") return isPortraitCanvas;
                          if (preset.value === "dual-frame") return !isPortraitCanvas;
                          return true;
                        }).map((preset) => (
                          <SelectItem key={preset.value} value={preset.value} className="text-xs">
                            {preset.value === "picture-in-picture"
                              ? t("layout.pictureInPicture")
                              : preset.value === "vertical-stack"
                                ? t("layout.verticalStack")
                                : preset.value === "no-webcam"
                                  ? t("layout.noWebcam")
                                  : preset.value === "dual-frame"
                                    ? t("layout.dualFrame")
                                    : preset.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {webcamLayoutPreset === "picture-in-picture" && (
                    <div className="foom-inspector-card">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        {t("layout.webcamShape")}
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(
                          [
                            { value: "rectangle", label: "Rect" },
                            { value: "circle", label: "Circle" },
                            { value: "square", label: "Square" },
                            { value: "rounded", label: "Rounded" },
                          ] as Array<{ value: WebcamMaskShape; label: string }>
                        ).map((shape) => (
                          <button
                            key={shape.value}
                            type="button"
                            onClick={() => onWebcamMaskShapeChange?.(shape.value)}
                            className={cn(
                              "h-10 rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer",
                              webcamMaskShape === shape.value
                                ? "bg-[#D4D4D8] border-[#D4D4D8] text-[#09090b]"
                                : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-400",
                            )}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              {shape.value === "rectangle" && (
                                <rect
                                  x="1"
                                  y="3"
                                  width="14"
                                  height="10"
                                  rx="2"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                />
                              )}
                              {shape.value === "circle" && (
                                <circle
                                  cx="8"
                                  cy="8"
                                  r="6.5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                />
                              )}
                              {shape.value === "square" && (
                                <rect
                                  x="2"
                                  y="2"
                                  width="12"
                                  height="12"
                                  rx="1"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                />
                              )}
                              {shape.value === "rounded" && (
                                <rect
                                  x="1"
                                  y="3"
                                  width="14"
                                  height="10"
                                  rx="5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                />
                              )}
                            </svg>
                            <span className="text-[8px] leading-none">{shape.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {webcamLayoutPreset === "picture-in-picture" && (
                    <div className="foom-inspector-card">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {t("layout.webcamSize")}
                        </div>
                        <div className="text-[10px] font-medium text-slate-400 font-mono">
                          {webcamSizePreset}%
                        </div>
                      </div>
                      <Slider
                        value={[webcamSizePreset]}
                        onValueChange={(values) => onWebcamSizePresetChange?.(values[0])}
                        onValueCommit={() => onWebcamSizePresetCommit?.()}
                        min={10}
                        max={50}
                        step={1}
                        className="w-full"
                      />
                    </div>
                  )}

                  {webcamLayoutPreset === "picture-in-picture" && (
                    <div className="foom-inspector-card space-y-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Position
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {WEBCAM_POSITION_PRESETS.map((preset) => {
                          const active = isSameWebcamPosition(webcamPosition, preset.position);
                          return (
                            <button
                              key={preset.label}
                              type="button"
                              title={preset.label}
                              aria-pressed={active}
                              onClick={() => {
                                onWebcamPositionChange?.(preset.position);
                                onWebcamPositionCommit?.();
                              }}
                              className={cn(
                                "flex h-11 items-center justify-center rounded-md border text-[18px] transition-colors",
                                active
                                  ? "border-white bg-white text-[#09090b]"
                                  : "border-white/5 bg-black text-slate-300 hover:border-white/20 hover:bg-white/[0.08] hover:text-white",
                              )}
                            >
                              {preset.icon}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onWebcamPositionChange?.(webcamPosition ? null : { cx: 0.82, cy: 0.82 });
                          onWebcamPositionCommit?.();
                        }}
                        className="flex h-9 w-full items-center justify-between rounded-lg bg-black px-3 text-left text-[11px] font-semibold text-slate-200 transition-colors hover:bg-white/[0.06]"
                      >
                        <span>Custom position</span>
                        <span
                          className={cn(
                            "flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                            webcamPosition ? "bg-white" : "bg-white/20",
                          )}
                        >
                          <span
                            className={cn(
                              "h-4 w-4 rounded-full transition-transform",
                              webcamPosition
                                ? "translate-x-4 bg-[#09090b]"
                                : "translate-x-0 bg-slate-300",
                            )}
                          />
                        </span>
                      </button>
                    </div>
                  )}
                  {webcamLayoutPreset !== "no-webcam" && (
                    <div className="foom-inspector-card space-y-3.5">
                      <div className="flex items-center justify-between py-1">
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                            Mirror Webcam
                          </span>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Flip the webcam video horizontally.
                          </p>
                        </div>
                        <Switch
                          checked={webcamMirrored}
                          onCheckedChange={onWebcamMirroredChange}
                          className="data-[state=checked]:bg-[#D4D4D8] scale-90 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between py-1 border-t border-white/[0.04] pt-3">
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                            Reactive Zoom
                          </span>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Auto-scale/position webcam to zoom focuses.
                          </p>
                        </div>
                        <Switch
                          checked={webcamReactiveZoom}
                          onCheckedChange={onWebcamReactiveZoomChange}
                          className="data-[state=checked]:bg-[#D4D4D8] scale-90 cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activePanelMode === "background" && (
                <div className="space-y-3">
                  <div className="foom-inspector-card flex items-center justify-between py-3.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {t("effects.blurBg")}
                    </div>
                    <Switch
                      checked={showBlur}
                      onCheckedChange={onBlurChange}
                      className="data-[state=checked]:bg-[#D4D4D8] scale-90 cursor-pointer"
                    />
                  </div>

                  <div className="foom-inspector-card space-y-3.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                      Canvas Styling
                    </span>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                          <span>{t("effects.padding")}</span>
                          <span className="font-mono text-slate-500">
                            {webcamLayoutPreset === "vertical-stack" ? "—" : `${padding}%`}
                          </span>
                        </div>
                        <Slider
                          value={[webcamLayoutPreset === "vertical-stack" ? 0 : padding]}
                          onValueChange={(values) => onPaddingChange?.(values[0])}
                          onValueCommit={() => onPaddingCommit?.()}
                          min={0}
                          max={MAX_EDITOR_PADDING}
                          step={1}
                          disabled={webcamLayoutPreset === "vertical-stack"}
                          className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                          <span>{t("effects.roundness")}</span>
                          <span className="font-mono text-slate-500">{borderRadius}px</span>
                        </div>
                        <Slider
                          value={[borderRadius]}
                          onValueChange={(values) => onBorderRadiusChange?.(values[0])}
                          onValueCommit={() => onBorderRadiusCommit?.()}
                          min={0}
                          max={64}
                          step={0.5}
                          className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                          <span>{t("effects.shadow")}</span>
                          <span className="font-mono text-slate-500">
                            {Math.round(shadowIntensity * 100)}%
                          </span>
                        </div>
                        <Slider
                          value={[shadowIntensity]}
                          onValueChange={(values) => onShadowChange?.(values[0])}
                          onValueCommit={() => onShadowCommit?.()}
                          min={0}
                          max={1}
                          step={0.01}
                          className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                          <span>{t("effects.motionBlur")}</span>
                          <span className="font-mono text-slate-500">
                            {motionBlurAmount === 0
                              ? t("effects.off")
                              : motionBlurAmount.toFixed(2)}
                          </span>
                        </div>
                        <Slider
                          value={[motionBlurAmount]}
                          onValueChange={(values) => onMotionBlurChange?.(values[0])}
                          onValueCommit={() => onMotionBlurCommit?.()}
                          min={0}
                          max={1}
                          step={0.01}
                          className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activePanelMode === "timeline" && (
                <div className="space-y-3">
                  <div className="foom-inspector-card space-y-3">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                        Timeline Tools
                      </span>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        Add timeline-backed edit regions at the current playhead.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        onClick={onAddZoom}
                        className="h-9 gap-1.5 rounded-lg bg-[#8B5CF6]/12 text-[#C4B5FD] border border-[#8B5CF6]/20 hover:bg-[#8B5CF6]/20 text-[10px] font-semibold"
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                        Zoom
                      </Button>
                      <Button
                        type="button"
                        onClick={handleCropToggle}
                        className="h-9 gap-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 text-[10px] font-semibold"
                      >
                        <Crop className="h-3.5 w-3.5" />
                        Crop
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {activePanelMode === "cursor" && showCursorSettings && hasCursorData && (
                <div className="space-y-3">
                  <div className="foom-inspector-card space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        {t("cursor.show")}
                      </div>
                      <Switch
                        checked={showCursor}
                        onCheckedChange={onShowCursorChange}
                        className="data-[state=checked]:bg-[#D4D4D8] scale-90 cursor-pointer"
                      />
                    </div>
                    {showCursor && (
                      <div className="flex items-center justify-between pt-3.5 border-t border-white/5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {t("cursor.clipToBounds")}
                        </div>
                        <Switch
                          checked={cursorClipToBounds}
                          onCheckedChange={onCursorClipToBoundsChange}
                          className="data-[state=checked]:bg-[#D4D4D8] scale-90 cursor-pointer"
                          aria-label={t("cursor.clipToBounds")}
                        />
                      </div>
                    )}
                  </div>

                  {showCursor && (
                    <div className="foom-inspector-card space-y-3">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Cursor Style
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { value: "arrow" as const, label: "Arrow Cursor" },
                          { value: "normal" as const, label: "Normal Black" },
                        ].map((option) => {
                          const isActive = cursorStyle === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => onCursorStyleChange?.(option.value)}
                              className={cn(
                                "flex h-16 flex-col items-start justify-between rounded-lg border p-2 text-left transition-colors",
                                isActive
                                  ? "border-[#D4D4D8]/70 bg-white/[0.12] text-white"
                                  : "border-white/8 bg-white/[0.04] text-slate-400 hover:border-white/16 hover:bg-white/[0.07]",
                              )}
                              aria-pressed={isActive}
                            >
                              <span className="flex h-6 w-6 items-center justify-center rounded bg-white/90">
                                <MousePointer2
                                  className={cn(
                                    "h-[18px] w-[18px] fill-black stroke-black",
                                    option.value === "normal" && "-rotate-[18deg]",
                                  )}
                                  strokeWidth={2.4}
                                />
                              </span>
                              <span className="text-[10px] font-semibold leading-tight">
                                {option.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {showCursor && (
                    <div className="foom-inspector-card space-y-3.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                        Cursor Dynamics
                      </span>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-2 rounded-lg bg-white/5 border border-white/5 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                            <span>{t("cursor.size")}</span>
                            <span className="font-mono text-slate-500">
                              {cursorSize.toFixed(1)}
                            </span>
                          </div>
                          <Slider
                            value={[cursorSize]}
                            onValueChange={(values) => onCursorSizeChange?.(values[0])}
                            min={0.5}
                            max={10}
                            step={0.1}
                            className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-2.5 [&_[role=slider]]:w-2.5"
                          />
                        </div>
                        <div className="p-2 rounded-lg bg-white/5 border border-white/5 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                            <span>{t("cursor.smoothing")}</span>
                            <span className="font-mono text-slate-500">
                              {Math.round(cursorSmoothing * 100)}%
                            </span>
                          </div>
                          <Slider
                            value={[cursorSmoothing]}
                            onValueChange={(values) => onCursorSmoothingChange?.(values[0])}
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-2.5 [&_[role=slider]]:w-2.5"
                          />
                        </div>
                        <div className="p-2 rounded-lg bg-white/5 border border-white/5 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                            <span>{t("cursor.motionBlur")}</span>
                            <span className="font-mono text-slate-500">
                              {Math.round(cursorMotionBlur * 100)}%
                            </span>
                          </div>
                          <Slider
                            value={[cursorMotionBlur]}
                            onValueChange={(values) => onCursorMotionBlurChange?.(values[0])}
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-2.5 [&_[role=slider]]:w-2.5"
                          />
                        </div>
                        <div className="p-2 rounded-lg bg-white/5 border border-white/5 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                            <span>{t("cursor.clickBounce")}</span>
                            <span className="font-mono text-slate-500">
                              {cursorClickBounce.toFixed(1)}
                            </span>
                          </div>
                          <Slider
                            value={[cursorClickBounce]}
                            onValueChange={(values) => onCursorClickBounceChange?.(values[0])}
                            min={0}
                            max={5}
                            step={0.1}
                            className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-2.5 [&_[role=slider]]:w-2.5"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activePanelMode === "captions" && (
                <div className="space-y-3">
                  <div className="foom-inspector-card space-y-3">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                        Captions & Callouts
                      </span>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        Add real timeline-backed text or blur regions. They render in preview and
                        export with the annotation layer.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        onClick={onAddCaption}
                        className="h-9 gap-1.5 rounded-lg bg-[#8B5CF6]/12 text-[#C4B5FD] border border-[#8B5CF6]/20 hover:bg-[#8B5CF6]/20 text-[10px] font-semibold"
                      >
                        <Captions className="h-3.5 w-3.5" />
                        Add Text
                      </Button>
                      <Button
                        type="button"
                        onClick={onAddBlur}
                        className="h-9 gap-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 text-[10px] font-semibold"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Add Blur
                      </Button>
                    </div>
                  </div>

                  <div className="foom-inspector-card">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Active Regions
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {annotationRegions.length + blurRegions.length}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {annotationRegions.length === 0 && blurRegions.length === 0 ? (
                        <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-500">
                          No caption or callout regions yet.
                        </div>
                      ) : (
                        <>
                          {annotationRegions.map((region) => (
                            <div
                              key={region.id}
                              className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2 text-[11px]"
                            >
                              <span className="truncate text-slate-300">
                                {region.textContent || region.content || "Text"}
                              </span>
                              <span className="font-mono text-slate-500">
                                {(region.startMs / 1000).toFixed(1)}s
                              </span>
                            </div>
                          ))}
                          {blurRegions.map((region) => (
                            <div
                              key={region.id}
                              className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2 text-[11px]"
                            >
                              <span className="truncate text-slate-300">Blur region</span>
                              <span className="font-mono text-slate-500">
                                {(region.startMs / 1000).toFixed(1)}s
                              </span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activePanelMode === "audio" && (
                <div className="space-y-3">
                  <div className="foom-inspector-card flex items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                        Timeline Waveform
                      </span>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Show audio waveform visualization in the timeline track.
                      </p>
                    </div>
                    <Switch
                      checked={showTrimWaveform}
                      onCheckedChange={onTrimWaveformChange}
                      className="data-[state=checked]:bg-[#D4D4D8]"
                    />
                  </div>
                  <div className="foom-inspector-card space-y-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                          Background Sound Removal
                        </span>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Non-AI DSP cleanup for rumble, hiss, and low room noise in MP4 exports.
                        </p>
                      </div>
                      <Switch
                        checked={noiseReductionEnabled}
                        onCheckedChange={onNoiseReductionEnabledChange}
                        className="data-[state=checked]:bg-[#D4D4D8]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                        <span>Cleanup Amount</span>
                        <span className="font-mono text-slate-500">
                          {noiseReductionEnabled
                            ? `${Math.round(noiseReductionAmount * 100)}%`
                            : "Off"}
                        </span>
                      </div>
                      <Slider
                        value={[noiseReductionAmount]}
                        onValueChange={(values) => onNoiseReductionAmountChange?.(values[0])}
                        min={0}
                        max={1}
                        step={0.01}
                        disabled={!noiseReductionEnabled}
                        className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                      />
                    </div>
                  </div>
                  <div className="foom-inspector-card space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                          Preview Audio
                        </span>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Controls the editor playback audio immediately.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPreviewAudioMuted(!previewMuted)}
                        disabled={!videoElement}
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg border transition-all",
                          previewMuted
                            ? "border-red-500/25 bg-red-500/10 text-red-300"
                            : "border-[#D4D4D8]/25 bg-[#D4D4D8]/10 text-[#D4D4D8]",
                          !videoElement && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {previewMuted ? (
                          <VolumeX className="h-4 w-4" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-medium text-slate-300">
                        <span>Volume</span>
                        <span className="font-mono text-slate-500">
                          {previewMuted ? "Muted" : `${previewVolume}%`}
                        </span>
                      </div>
                      <Slider
                        value={[previewMuted ? 0 : previewVolume]}
                        onValueChange={(values) => setPreviewAudioVolume(values[0])}
                        min={0}
                        max={100}
                        step={1}
                        disabled={!videoElement}
                        className="w-full [&_[role=slider]]:bg-[#D4D4D8] [&_[role=slider]]:border-[#D4D4D8] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activePanelMode === "background" && (
                <div className="space-y-3">
                  <div className="foom-inspector-card">
                    <Tabs defaultValue="wallpaper" className="w-full">
                      <TabsList className="mb-3 bg-white/5 border border-white/5 p-0.5 w-full grid grid-cols-4 h-7 rounded-lg">
                        <TabsTrigger
                          value="wallpaper"
                          className="data-[state=active]:bg-[#D4D4D8] data-[state=active]:text-[#09090b] text-slate-400 text-[9px] py-1 rounded-md transition-all cursor-pointer"
                        >
                          Wallpapers
                        </TabsTrigger>
                        <TabsTrigger
                          value="gradient"
                          className="data-[state=active]:bg-[#D4D4D8] data-[state=active]:text-[#09090b] text-slate-400 text-[9px] py-1 rounded-md transition-all cursor-pointer"
                        >
                          {t("background.gradient")}
                        </TabsTrigger>
                        <TabsTrigger
                          value="color"
                          className="data-[state=active]:bg-[#D4D4D8] data-[state=active]:text-[#09090b] text-slate-400 text-[9px] py-1 rounded-md transition-all cursor-pointer"
                        >
                          {t("background.color")}
                        </TabsTrigger>
                        <TabsTrigger
                          value="image"
                          className="data-[state=active]:bg-[#D4D4D8] data-[state=active]:text-[#09090b] text-slate-400 text-[9px] py-1 rounded-md transition-all cursor-pointer"
                        >
                          {t("background.image")}
                        </TabsTrigger>
                      </TabsList>

                        <TabsContent value="wallpaper" className="mt-0">
                          <div className="grid grid-cols-4 gap-2.5">
                            {WALLPAPER_PATHS.map((canonicalPath, i) => {
                              const previewUrl = wallpaperPreviewUrls[i] ?? canonicalPath;
                              const isSelected = selected === canonicalPath;
                              return (
                                <div
                                  key={canonicalPath}
                                  className={cn(
                                    "aspect-square w-full rounded-lg border overflow-hidden cursor-pointer transition-all duration-150 shadow-sm",
                                    isSelected
                                      ? "border-[#D4D4D8] ring-1 ring-[#D4D4D8]/30"
                                      : "border-white/10 hover:border-[#D4D4D8]/40 opacity-80 hover:opacity-100 bg-white/5",
                                  )}
                                  style={{
                                    backgroundImage: `url(${previewUrl})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }}
                                  onClick={() => onWallpaperChange(canonicalPath)}
                                  role="button"
                                />
                              );
                            })}
                          </div>
                        </TabsContent>

                        <TabsContent value="image" className="mt-0 space-y-3">
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleImageUpload}
                            accept={BACKGROUND_IMAGE_ACCEPT}
                            className="hidden"
                          />
                          <Button
                            onClick={() => fileInputRef.current?.click()}
                            variant="outline"
                            className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-[#D4D4D8] hover:text-[#09090b] hover:border-[#D4D4D8] transition-all h-7 text-[10px] cursor-pointer"
                          >
                            <Upload className="w-3 h-3" />
                            {t("background.uploadCustom")}
                          </Button>

                          <div className="grid grid-cols-4 gap-2.5">
                            {customImages.map((imageUrl, idx) => {
                              const isSelected = selected === imageUrl;
                              return (
                                <div
                                  key={`custom-${idx}`}
                                  className={cn(
                                    "aspect-square w-full rounded-lg border overflow-hidden cursor-pointer transition-all duration-150 relative group shadow-sm",
                                    isSelected
                                      ? "border-[#D4D4D8] ring-1 ring-[#D4D4D8]/30"
                                      : "border-white/10 hover:border-[#D4D4D8]/40 opacity-80 hover:opacity-100 bg-white/5",
                                  )}
                                  style={{
                                    backgroundImage: `url(${imageUrl})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }}
                                  onClick={() => onWallpaperChange(imageUrl)}
                                  role="button"
                                >
                                  <button
                                    onClick={(e) => handleRemoveCustomImage(imageUrl, e)}
                                    className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer"
                                  >
                                    <X className="w-2 h-2 text-white" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </TabsContent>

                        <TabsContent value="color" className="mt-0">
                          <ColorPicker
                            selectedColor={selectedColor}
                            colorPalette={colorPalette}
                            translations={{
                              colorWheel: t("background.colorWheel"),
                              colorPalette: t("background.colorPalette"),
                            }}
                            onUpdateColor={(color) => {
                              setSelectedColor(color);
                              onWallpaperChange(color);
                            }}
                          />
                        </TabsContent>

                        <TabsContent value="gradient" className="mt-0">
                          <div className="grid grid-cols-4 gap-2.5">
                            {BG_GRADIENT_PATHS.map((canonicalPath, i) => {
                              const previewUrl = gradientPreviewUrls[i] ?? canonicalPath;
                              const isSelected = selected === canonicalPath;
                              return (
                                <div
                                  key={canonicalPath}
                                  className={cn(
                                    "aspect-square w-full rounded-lg border overflow-hidden cursor-pointer transition-all duration-150 shadow-sm",
                                    isSelected
                                      ? "border-[#D4D4D8] ring-1 ring-[#D4D4D8]/30"
                                      : "border-white/10 hover:border-[#D4D4D8]/40 opacity-80 hover:opacity-100 bg-white/5",
                                  )}
                                  style={{
                                    backgroundImage: `url(${previewUrl})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }}
                                  onClick={() => onWallpaperChange(canonicalPath)}
                                  role="button"
                                />
                              );
                            })}
                          </div>
                        </TabsContent>
                    </Tabs>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showCropDropdown && cropRegion && onCropChange && (
        <>
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-in fade-in duration-200"
            onClick={() => setShowCropDropdown(false)}
          />
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#09090b] rounded-2xl shadow-2xl border border-white/10 p-8 w-[90vw] max-w-5xl max-h-[90vh] overflow-auto animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div>
                <span className="text-xl font-bold text-slate-200">{t("crop.cropVideo")}</span>
                <p className="text-sm text-slate-400 mt-2">{t("crop.dragInstruction")}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowCropDropdown(false)}
                className="hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <CropControl
              videoElement={videoElement || null}
              cropRegion={cropRegion}
              onCropChange={onCropChange}
              aspectRatio={aspectRatio}
            />
            <div className="mt-6 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                {[
                  { label: "X", field: "x" as const, max: videoWidth },
                  { label: "Y", field: "y" as const, max: videoHeight },
                  { label: "W", field: "width" as const, max: videoWidth },
                  { label: "H", field: "height" as const, max: videoHeight },
                ].map(({ label, field, max }) => (
                  <div key={field} className="flex flex-col gap-1">
                    <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                      {label}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={max}
                      value={getCropPixelValue(field)}
                      onChange={(e) => handleCropNumericChange(field, Number(e.target.value))}
                      className="w-[90px] h-8 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-slate-200 outline-none focus:border-[#D4D4D8]/50 focus:ring-1 focus:ring-[#D4D4D8]/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                ))}

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                    {t("crop.ratio")}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={cropAspectRatio}
                      onChange={(e) => applyCropAspectPreset(e.target.value)}
                      className="h-8 rounded-md border border-white/10 bg-[#1a1a1f] px-2 text-xs text-slate-200 outline-none focus:border-[#D4D4D8]/50 cursor-pointer"
                    >
                      <option value="" className="bg-[#1a1a1f] text-slate-200">
                        {t("crop.free")}
                      </option>
                      <option value="16:9" className="bg-[#1a1a1f] text-slate-200">
                        16:9
                      </option>
                      <option value="9:16" className="bg-[#1a1a1f] text-slate-200">
                        9:16
                      </option>
                      <option value="4:3" className="bg-[#1a1a1f] text-slate-200">
                        4:3
                      </option>
                      <option value="3:4" className="bg-[#1a1a1f] text-slate-200">
                        3:4
                      </option>
                      <option value="1:1" className="bg-[#1a1a1f] text-slate-200">
                        1:1
                      </option>
                      <option value="21:9" className="bg-[#1a1a1f] text-slate-200">
                        21:9
                      </option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setCropAspectLocked((prev) => !prev)}
                      className={cn(
                        "h-8 w-8 flex items-center justify-center rounded-md border transition-all",
                        cropAspectLocked
                          ? "border-[#D4D4D8]/50 bg-[#D4D4D8]/10 text-[#D4D4D8]"
                          : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200",
                      )}
                      title={
                        cropAspectLocked ? t("crop.unlockAspectRatio") : t("crop.lockAspectRatio")
                      }
                    >
                      {cropAspectLocked ? (
                        <Lock className="w-3.5 h-3.5" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <p className="text-[10px] text-slate-500 self-center ml-2">
                  {videoWidth} × {videoHeight}px
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => setShowCropDropdown(false)}
                  size="lg"
                  className="bg-[#D4D4D8] hover:bg-[#D4D4D8]/90 text-[#09090b]"
                >
                  {t("crop.done")}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}


    </div>
  );
}