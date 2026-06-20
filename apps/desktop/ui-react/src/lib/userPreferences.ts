import {
  DEFAULT_EDITOR_LAYOUT_SETTINGS,
  DEFAULT_EXPORT_SETTINGS,
  LEGACY_OVERSIZED_EDITOR_PADDING,
  MAX_EDITOR_PADDING,
} from "@/components/video-editor/editorDefaults";
import type { ExportFormat, ExportQuality } from "@/lib/exporter";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { videoDir } from "@tauri-apps/api/path";

const PREFS_KEY = "foom_user_preferences";

const VALID_ASPECT_RATIOS: readonly string[] = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "4:5",
  "16:10",
  "10:16",
  "native",
];

export interface UserPreferences {
  trayLayout: "horizontal" | "vertical";
  /** Default padding % */
  padding: number;
  /** Default aspect ratio */
  aspectRatio: AspectRatio;
  /** Default export quality */
  exportQuality: ExportQuality;
  /** Default export format */
  exportFormat: ExportFormat;
  /** Folder used for the most recent successful export, if any */
  exportFolder: string | null;
  /** Default wallpaper */
  wallpaper: string;
}

export const DEFAULT_PREFS: UserPreferences = {
  padding: DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
  aspectRatio: DEFAULT_EDITOR_LAYOUT_SETTINGS.aspectRatio,
  exportQuality: DEFAULT_EXPORT_SETTINGS.quality,
  exportFormat: DEFAULT_EXPORT_SETTINGS.format,
  exportFolder: null,
  wallpaper: DEFAULT_EDITOR_LAYOUT_SETTINGS.wallpaper,
};

function safeJsonParse(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Load persisted user preferences from localStorage.
 * Returns defaults for any missing or invalid fields.
 */
export function loadUserPreferences(): UserPreferences {
  let raw: Record<string, unknown> | null = null;
  try {
    raw = safeJsonParse(localStorage.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };

  return {
    padding:
      typeof raw.padding === "number" &&
      Number.isFinite(raw.padding) &&
      raw.padding >= 0 &&
      raw.padding <= MAX_EDITOR_PADDING &&
      raw.padding !== LEGACY_OVERSIZED_EDITOR_PADDING
        ? raw.padding
        : DEFAULT_PREFS.padding,
    aspectRatio:
      typeof raw.aspectRatio === "string" && VALID_ASPECT_RATIOS.includes(raw.aspectRatio)
        ? (raw.aspectRatio as AspectRatio)
        : DEFAULT_PREFS.aspectRatio,
    exportQuality:
      raw.exportQuality === "low" ||
      raw.exportQuality === "medium" ||
      raw.exportQuality === "good" ||
      raw.exportQuality === "ultra" ||
      raw.exportQuality === "source"
        ? (raw.exportQuality as ExportQuality)
        : DEFAULT_PREFS.exportQuality,
    exportFormat:
      raw.exportFormat === "gif" || raw.exportFormat === "mp4"
        ? (raw.exportFormat as ExportFormat)
        : DEFAULT_PREFS.exportFormat,
    exportFolder:
      typeof raw.exportFolder === "string" && raw.exportFolder.length > 0
        ? raw.exportFolder
        : DEFAULT_PREFS.exportFolder,
    wallpaper:
      typeof raw.wallpaper === "string" && raw.wallpaper.length > 0
        ? raw.wallpaper
        : DEFAULT_PREFS.wallpaper,
  };
}

/**
 * Extracts the parent directory from a saved file path. Handles both POSIX
 * and Windows separators since the path comes from the OS save dialog.
 *
 * Root directories are preserved with their trailing separator so that the
 * value is still a valid directory path:
 *   "/video.mp4"      -> "/"
 *   "C:\\video.mp4"   -> "C:\\"
 *
 * Returns null if no separator is found.
 */
export function parentDirectoryOf(filePath: string): string | null {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (lastSep < 0) return null;

  // POSIX root, e.g. "/video.mp4" -> "/"
  if (lastSep === 0) return filePath[0];

  // Windows drive root, e.g. "C:\\video.mp4" -> "C:\\"
  if (lastSep === 2 && /^[A-Za-z]:[/\\]/.test(filePath)) {
    return filePath.slice(0, lastSep + 1);
  }

  return filePath.slice(0, lastSep);
}

/**
 * Returns the remembered export folder as `string | undefined`, suitable for
 * passing directly to IPC handlers that treat absence as "use the default".
 */
export async function getExportFolder(): Promise<string | undefined> {
  const saved = loadUserPreferences().exportFolder;
  if (saved) return saved;

  try {
    if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) {
      const videoPath = await videoDir();
      if (videoPath) return videoPath;
    }
  } catch (e) {
    console.warn("Failed to get default video dir", e);
  }

  return undefined;
}

/**
 * Persist user preferences to localStorage.
 * Only the explicitly provided fields are updated.
 */
export function saveUserPreferences(partial: Partial<UserPreferences>): void {
  const current = loadUserPreferences();
  const merged = { ...current, ...partial };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
  } catch {
    // localStorage may be unavailable (e.g. private browsing quota exceeded)
  }
}
