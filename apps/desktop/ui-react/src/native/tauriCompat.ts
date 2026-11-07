import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { NativeCursorType } from "./contracts";

const noop = () => {};
const ok = (extra: Record<string, unknown> = {}) => ({
  success: true,
  ...extra,
});
const unavailable = (message = "Native command is unavailable in browser preview.") => ({
  success: false,
  message,
  error: message,
});

const currentRecordingSessionKey = "foom-current-recording-session";
const currentVideoPathKey = "foom-current-video-path";
const currentProjectFileKey = "foom-current-project-file";
const currentProjectPathKey = "foom-current-project-path";
const editorRouteIntentKey = "foom-open-editor-route-intent";
const settingsRouteIntentKey = "foom-open-settings-route-intent";
const currentNativeCursorCaptureModeKey = "foom-current-native-cursor-capture-mode";
const localProjectPath = "local-storage://video-project";
const SUPPORTED_NATIVE_CURSOR_TYPES = new Set<NativeCursorType>([
  "arrow", "text", "pointer", "crosshair", "open-hand", "closed-hand", "resize-ew",
  "resize-ns", "resize-nesw", "resize-nwse", "move", "not-allowed", "wait",
  "app-starting", "help", "up-arrow",
]);

let currentHasUnsavedChanges = false;
let saveBeforeCloseCallback: (() => Promise<boolean>) | null = null;
let closeConfirmCallback: (() => void) | null = null;

async function returnToRecorder() {
  if (isTauriRuntime()) await invokeTauri("switch_to_overlay");
  currentHasUnsavedChanges = false;
  // Unmount the hidden editor so the next take starts with its own timeline.
  window.location.hash = isTauriRuntime() ? "/" : "/overlay/recording";
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported"));
      return;
    }
    const request = indexedDB.open("foom-browser-db", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("videos")) {
        db.createObjectStore("videos");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveVideoToIndexedDb(key: string, data: ArrayBuffer, type = "video/webm"): Promise<string> {
  return openDatabase().then((db) => {
    return new Promise<string>((resolve, reject) => {
      const transaction = db.transaction("videos", "readwrite");
      const store = transaction.objectStore("videos");
      const blob = new Blob([data], { type });
      const request = store.put(blob, key);
      request.onsuccess = () => {
        resolve(`indexeddb://${key}`);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

function loadVideoFromIndexedDb(key: string): Promise<string | null> {
  return openDatabase()
    .then((db) => {
      return new Promise<string | null>((resolve, reject) => {
        const transaction = db.transaction("videos", "readonly");
        const store = transaction.objectStore("videos");
        const request = store.get(key);
        request.onsuccess = () => {
          const blob = request.result;
          if (blob instanceof Blob) {
            resolve(URL.createObjectURL(blob));
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    })
    .catch(() => null);
}

function loadVideoFromIndexedDbRaw(key: string): Promise<Blob | null> {
  return openDatabase()
    .then((db) => {
      return new Promise<Blob | null>((resolve, reject) => {
        const transaction = db.transaction("videos", "readonly");
        const store = transaction.objectStore("videos");
        const request = store.get(key);
        request.onsuccess = () => {
          const blob = request.result;
          if (blob instanceof Blob) {
            resolve(blob);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    })
    .catch(() => null);
}

function deleteVideoFromIndexedDb(key: string): Promise<void> {
  return openDatabase()
    .then((db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("videos", "readwrite");
        const store = transaction.objectStore("videos");
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    })
    .catch(() => {});
}


function downloadBrowserFile(data: BlobPart, fileName: string, mimeType: string) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function getPlatform() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "darwin";
  if (platform.includes("win")) return "win32";
  return "linux";
}

function formatCaptureSourceName(kind: string, title: string | null | undefined, index = 0) {
  const normalizedTitle = title?.trim();
  if (kind === "monitor") {
    const windowsDisplay = normalizedTitle?.match(/DISPLAY\s*(\d+)$/i);
    return windowsDisplay ? `Display ${windowsDisplay[1]}` : normalizedTitle || `Display ${index + 1}`;
  }
  return normalizedTitle || "Window";
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function getCurrentTauriWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

async function getTauriWindowPosition() {
  const currentWindow = await getCurrentTauriWindow();
  return currentWindow.outerPosition();
}

function listenToTauriEvent(eventName: string, callback: () => void) {
  if (!isTauriRuntime()) return noop;
  let disposed = false;
  let unlisten: undefined | (() => void);
  import("@tauri-apps/api/event")
    .then(({ listen }) => listen(eventName, () => callback()))
    .then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    })
    .catch((error) => {
      console.error(`Failed to listen for ${eventName}:`, error);
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

function listenToTauriEventWithPayload<T>(eventName: string, callback: (payload: T) => void) {
  if (!isTauriRuntime()) {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<T>;
      callback(customEvent.detail);
    };
    window.addEventListener(`foom-${eventName}`, handler);
    return () => {
      window.removeEventListener(`foom-${eventName}`, handler);
    };
  }
  let disposed = false;
  let unlisten: undefined | (() => void);
  import("@tauri-apps/api/event")
    .then(({ listen }) => listen<T>(eventName, (event) => callback(event.payload)))
    .then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    })
    .catch((error) => {
      console.error(`Failed to listen for ${eventName}:`, error);
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

function arrayBufferToNumberArray(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer));
}

/** Shape returned by the Rust `stop_recording` command. */
interface NativeProject {
  id?: string;
  raw_video_path?: string;
  rawVideoPath?: string;
  metadata_path?: string;
  metadataPath?: string;
  path?: string;
  duration?: number;
  [key: string]: unknown;
}

function metadataString(document: NativeDocument | null | undefined, key: string) {
  const value = document?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function projectToRecordingSession(project: NativeProject) {
  const screenVideoPath = project?.raw_video_path ?? project?.rawVideoPath ?? project?.path;
  const document = await loadNativeRecordingDocument(screenVideoPath);
  const media =
    document?.media && typeof document.media === "object"
      ? (document.media as Record<string, unknown>)
      : null;
  const webcamVideoPath =
    metadataString(document, "cameraVideoPath") ??
    (typeof media?.cameraVideoPath === "string" ? media.cameraVideoPath : undefined);
  const cursorCaptureMode = localStorage.getItem(currentNativeCursorCaptureModeKey);
  return {
    screenVideoPath,
    ...(webcamVideoPath ? { webcamVideoPath } : {}),
    createdAt: Date.now(),
    durationMs:
      typeof project?.duration === "number" && Number.isFinite(project.duration)
        ? project.duration
        : typeof document?.duration === "number" && Number.isFinite(document.duration)
          ? document.duration
          : undefined,
    cursorCaptureMode:
      cursorCaptureMode === "system" || cursorCaptureMode === "editable-overlay"
        ? cursorCaptureMode
        : document?.cursorEnabled === false
          ? "system"
          : "editable-overlay",
  };
}

function projectIdFromVideoPath(videoPath?: string) {
  if (!videoPath) return null;
  const fileName = videoPath.split(/[\\/]/).pop() ?? "";
  const match = fileName.match(/^(proj_[^.]+)/);
  return match?.[1] ?? null;
}

async function loadNativeRecordingDocument(videoPath?: string) {
  const projectId = projectIdFromVideoPath(videoPath);
  if (!projectId) return null;
  try {
    return await invokeTauri<NativeDocument | null>("get_project_document", {
      id: projectId,
    });
  } catch {
    return null;
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** Shape returned by the Rust `get_project_document` command. */
interface NativeDocument {
  events?: NativeMouseEvent[];
  width?: number;
  height?: number;
  captureX?: number;
  captureY?: number;
  duration?: number;
  cursorEnabled?: boolean;
  media?: unknown;
  [key: string]: unknown;
}

interface NativeMouseEvent {
  type?: string;
  x?: number;
  y?: number;
  t?: number;
  btn?: string;
  [key: string]: unknown;
}

function nativeDocumentToCursorSamples(document: NativeDocument | null | undefined) {
  const events = Array.isArray(document?.events) ? document.events : [];
  const mediaDurationMs = Number(document?.duration);
  const lastEventMs = events.reduce((last, event) =>
    Math.max(last, Number.isFinite(Number(event?.t)) ? Number(event.t) : 0), 0);
  // Older recordings can contain fewer encoded frames than the capture clock
  // expected. Keep the cursor and autozoom timeline inside the actual video.
  const timeScale = mediaDurationMs > 0 && lastEventMs > mediaDurationMs * 1.05
    ? mediaDurationMs / lastEventMs
    : 1;
  const width = Number(document?.width);
  const height = Number(document?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return [];
  }

  const docX = document?.captureX;
  const captureX = Number.isFinite(Number(docX)) ? Number(docX) : 0;
  const docY = document?.captureY;
  const captureY = Number.isFinite(Number(docY)) ? Number(docY) : 0;

  return events
    .map((event: NativeMouseEvent) => {
      if (
        !event ||
        (event.type !== "move" && event.type !== "click_down" && event.type !== "click_up") ||
        !Number.isFinite(Number(event.x)) ||
        !Number.isFinite(Number(event.y)) ||
        !Number.isFinite(Number(event.t))
      ) {
        return null;
      }

      const button: "click" | "right-click" | "middle-click" =
        event.btn === "right" ? "right-click" : event.btn === "middle" ? "middle-click" : "click";
      const cursorType =
        typeof event.cursorType === "string" &&
        SUPPORTED_NATIVE_CURSOR_TYPES.has(event.cursorType as NativeCursorType)
          ? (event.cursorType as NativeCursorType)
          : "arrow";
      return {
        timeMs: Number(event.t) * timeScale,
        cx: clamp01((Number(event.x) - captureX) / width),
        cy: clamp01((Number(event.y) - captureY) / height),
        visible: true,
        cursorType,
        interactionType:
          event.type === "click_down" ? button : event.type === "click_up" ? "mouseup" : "move",
      };
    })
    .filter(
      (
        sample,
      ): sample is {
        timeMs: number;
        cx: number;
        cy: number;
        visible: boolean;
        cursorType: NativeCursorType;
        interactionType: "move" | "click" | "right-click" | "middle-click" | "mouseup";
      } => Boolean(sample),
    );
}

function pathsEqual(p1?: string, p2?: string): boolean {
  if (!p1 || !p2) {
    return p1 === p2;
  }
  if (
    (p1.startsWith("indexeddb://") && p2.startsWith("blob:")) ||
    (p2.startsWith("indexeddb://") && p1.startsWith("blob:"))
  ) {
    return true;
  }
  const n1 = fromFileUrl(p1).replace(/\\/g, "/").toLowerCase();
  const n2 = fromFileUrl(p2).replace(/\\/g, "/").toLowerCase();
  return n1 === n2;
}

function browserSessionCursorSamples(videoPath?: string) {
  const raw = localStorage.getItem(currentRecordingSessionKey);
  if (!raw) {
    return [];
  }

  try {
    const session = JSON.parse(raw);
    if (
      !session ||
      typeof session !== "object" ||
      (videoPath && !pathsEqual(session.screenVideoPath, videoPath)) ||
      !Array.isArray(session.cursorTelemetry)
    ) {
      return [];
    }

    return session.cursorTelemetry
      .map((sample: unknown) => {
        if (
          !sample ||
          typeof sample !== "object" ||
          !Number.isFinite(Number((sample as { timeMs?: unknown }).timeMs)) ||
          !Number.isFinite(Number((sample as { cx?: unknown }).cx)) ||
          !Number.isFinite(Number((sample as { cy?: unknown }).cy))
        ) {
          return null;
        }
        const rawSample = sample as {
          timeMs: unknown;
          cx: unknown;
          cy: unknown;
          visible?: boolean;
          cursorType?: string;
          interactionType?: string;
        };
        const interactionType =
          rawSample.interactionType === "click" ||
          rawSample.interactionType === "mouseup" ||
          rawSample.interactionType === "move"
            ? rawSample.interactionType
            : undefined;
        const cursorType =
          typeof rawSample.cursorType === "string" &&
          SUPPORTED_NATIVE_CURSOR_TYPES.has(rawSample.cursorType as NativeCursorType)
            ? (rawSample.cursorType as NativeCursorType)
            : "arrow";
        return {
          timeMs: Math.max(0, Number(rawSample.timeMs)),
          cx: clamp01(Number(rawSample.cx)),
          cy: clamp01(Number(rawSample.cy)),
          visible: rawSample.visible !== false,
          cursorType,
          ...(interactionType ? { interactionType } : {}),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Shape returned by the Rust `list_capture_sources` command. */
interface NativeCaptureSource {
  id: string;
  kind: "monitor" | "window";
  title?: string;
  primary?: boolean;
  thumbnail?: string | null;
  [key: string]: unknown;
}

/** Subset of the recording request that `startNativeWindowsRecording` receives. */
interface NativeWindowsRecordingRequest {
  recordingId?: string | number;
  source?: {
    id?: string;
    sourceId?: string;
    displayId?: string | number;
    display_id?: string | number;
    type?: "window" | "screen" | "monitor" | "display" | "region";
    region?: { x: number; y: number; width: number; height: number };
    [key: string]: unknown;
  };
  audio?: {
    system?: { enabled?: boolean; [key: string]: unknown };
    [key: string]: unknown;
  };
  video?: { width?: number; height?: number; [key: string]: unknown };
  cursor?: { mode?: string; [key: string]: unknown };
  [key: string]: unknown;
}

function normalizeCaptureSourceId(source: NativeWindowsRecordingRequest["source"]) {
  const rawSourceId = source?.sourceId ?? source?.id ?? source?.displayId ?? source?.display_id;
  if (typeof rawSourceId !== "string" && typeof rawSourceId !== "number") {
    return undefined;
  }

  const sourceId = String(rawSourceId);
  return sourceId.replace(/^screen:/, "").replace(/^window:/, "");
}

function getCaptureSourceType(source: NativeWindowsRecordingRequest["source"]) {
  const rawSourceId = source?.sourceId ?? source?.id;
  if (typeof rawSourceId === "string" && rawSourceId.startsWith("window:")) {
    return "window";
  }
  return source?.type === "window" ? "window" : "screen";
}

interface StopNativeWindowsRecordingInput {
  discard?: boolean;
  micAudioData?: ArrayBuffer | null;
  cameraVideoData?: ArrayBuffer | null;
  cameraMimeType?: string | null;
  cameraShape?: string | null;
}

/** Input shape passed to `storeRecordedSession`. */
interface RecordedSessionInput {
  screen: { videoData: ArrayBuffer; fileName?: string; [key: string]: unknown };
  webcam?: {
    videoData: ArrayBuffer;
    fileName?: string;
    [key: string]: unknown;
  } | null;
  createdAt?: number;
  durationMs?: number;
  cursorCaptureMode?: string;
  cursorTelemetry?: unknown[];
  [key: string]: unknown;
}

interface NativeBridgePayload {
  projectData?: unknown;
  suggestedName?: string | null;
  existingProjectPath?: string | null;
  path?: string;
  videoPath?: string;
  [key: string]: unknown;
}

/** Loosely typed incoming request to `invokeNativeBridge` — validated at runtime. */
interface NativeBridgeRequestInput {
  domain?: string;
  action?: string;
  requestId?: string;
  payload?: NativeBridgePayload;
  [key: string]: unknown;
}

function toFileUrl(filePath: string): string {
  if (/^(blob:|data:|https?:|file:|indexeddb:)/i.test(filePath)) {
    return filePath;
  }
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.match(/^[a-zA-Z]:/)) {
    return `file:///${normalized}`;
  }
  const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${absolutePath}`;
}

function fromFileUrl(fileUrl: string): string {
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

let tauriConvertFileSrc: ((path: string) => string) | null = null;
let tauriVideoDir: (() => Promise<string>) | null = null;
let tauriJoin: ((...paths: string[]) => Promise<string>) | null = null;

if (typeof window !== "undefined") {
  // Dynamically import when script loads
  import("@tauri-apps/api/core")
    .then((m) => {
      if (m) {
        tauriConvertFileSrc = m.convertFileSrc;
      }
    })
    .catch(() => {});
  import("@tauri-apps/api/path")
    .then((m) => {
      if (m) {
        tauriVideoDir = m.videoDir;
        tauriJoin = m.join;
      }
    })
    .catch(() => {});
}

export function installTauriCompatBridge() {
  const existingFoomNative = window.foomNative ?? window.electronAPI ?? {};
  const tauriRuntime = isTauriRuntime();
  const isBrowserPreview = !tauriRuntime;

  const compatBridge = {
    isBrowserPreview: true,
    assetBaseUrl: "/",
    convertFileSrc: (path: string) => {
      if (!path) return "";
      if (/^(blob:|data:|https?:)/i.test(path)) return path;
      if (tauriRuntime) {
        let cleanPath = path.startsWith("file://") ? fromFileUrl(path) : path;
        cleanPath = cleanPath.replace(/\\/g, "/");
        try {
          const fn = tauriConvertFileSrc || convertFileSrc;
          return fn(cleanPath);
        } catch (e) {
          console.warn("convertFileSrc error:", e);
        }
      }
      return /^(blob:|data:|https?:|file:)/i.test(path) ? path : toFileUrl(path);
    },
    resolveVideoPath: async (path: string) => {
      if (!path) return "";
      if (/^(blob:|data:|https?:)/i.test(path)) return path;
      if (path.startsWith("indexeddb://")) {
        const key = path.replace("indexeddb://", "");
        try {
          const objectUrl = await loadVideoFromIndexedDb(key);
          return objectUrl || "";
        } catch (e) {
          console.error("Failed to load video from IndexedDB in resolveVideoPath:", e);
          return "";
        }
      }
      if (tauriRuntime) {
        let cleanPath = path.startsWith("file://") ? fromFileUrl(path) : path;
        cleanPath = cleanPath.replace(/\\/g, "/");
        try {
          const fn = tauriConvertFileSrc || convertFileSrc;
          return fn(cleanPath);
        } catch (e) {
          console.warn("convertFileSrc error in resolveVideoPath:", e);
        }
      }
      return /^(blob:|data:|https?:|file:)/i.test(path) ? path : toFileUrl(path);
    },
    getPlatform: async () => getPlatform(),
    setLocale: async () => ok(),
    getShortcuts: async () => {
      const raw = localStorage.getItem("foom-shortcuts");
      return raw ? JSON.parse(raw) : null;
    },
    saveShortcuts: async (config: unknown) => {
      localStorage.setItem("foom-shortcuts", JSON.stringify(config));
      return ok();
    },
    getSelectedSource: async () => {
      const raw = localStorage.getItem("foom-selected-capture-source");
      if (raw) {
        try {
          const source = JSON.parse(raw);
          if (source && typeof source.id === "string" && source.id.length > 0 && (!tauriRuntime || source.id !== "screen")) {
            const normalizedName = formatCaptureSourceName(
              source.id.startsWith("window:") ? "window" : "monitor",
              source.name,
            );
            if (normalizedName !== source.name) {
              source.name = normalizedName;
              localStorage.setItem("foom-selected-capture-source", JSON.stringify(source));
            }
            return source;
          }
        } catch { /* A corrupt saved selection must not prevent choosing a new source. */ }
        localStorage.removeItem("foom-selected-capture-source");
      }
      return tauriRuntime ? null : { id: "screen", name: "Screen" };
    },
    showWindow: async () => {
      if (tauriRuntime) {
        try {
          const currentWindow = await getCurrentTauriWindow();
          await currentWindow.show();
          await currentWindow.setFocus();
        } catch (error) {
          console.error("Failed to show window:", error);
        }
      }
      return ok();
    },
    openSourceSelector: async () => {
      if (!tauriRuntime) {
        // Browser preview: show the same selector UI in a separate tab/window.
        const selectorUrl = new URL(window.location.href);
        selectorUrl.pathname = "/";
        selectorUrl.search = "?windowType=source-selector";
        selectorUrl.hash = "";
        const opened = window.open(
          selectorUrl.toString(),
          "source-selector",
          "popup,width=620,height=540",
        );
        if (!opened) {
          window.location.href = selectorUrl.toString();
        }
        return { opened: true };
      }
      try {
        await invokeTauri("show_source_selector");
        return { opened: true };
      } catch (error) {
        console.error("Failed to open source selector:", error);
        return { opened: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
    getSources: async (_opts?: {
      types?: string[];
      thumbnailSize?: { width: number; height: number };
      fetchWindowIcons?: boolean;
    }) => {
      if (!tauriRuntime) {
        return [
          {
            id: "screen:0",
            name: "Entire Screen",
            thumbnail: null,
            display_id: "screen:0",
            appIcon: null,
          },
        ];
      }
      try {
        const sources = await invokeTauri<NativeCaptureSource[]>("list_capture_sources");
        return sources.map((s, index) => ({
          id: s.kind === "monitor" ? `screen:${s.id}` : `window:${s.id}`,
          name: formatCaptureSourceName(s.kind, s.title, index),
          thumbnail: s.thumbnail ?? null,
          display_id: s.id,
          appIcon: null,
          bounds: { x: Number(s.x), y: Number(s.y), width: Number(s.width), height: Number(s.height) },
        }));
      } catch (error) {
        throw new Error(`Could not load capture sources: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    selectSource: async (source: ProcessedDesktopSource) => {
      // Normalize id: strip "screen:" prefix for storage so recording logic gets raw monitor id
      const rawId = source.id.replace(/^screen:/, "").replace(/^window:/, "");
      const stored = {
        id: source.id.startsWith("window:") ? `window:${rawId}` : rawId,
        name: source.name,
        display_id: source.display_id ?? rawId,
        ...(source.type === "region" ? { type: source.type, region: source.region, bounds: source.bounds } : {}),
      };
      localStorage.setItem("foom-selected-capture-source", JSON.stringify(stored));

      // Emit event to notify that a source was chosen
      if (tauriRuntime) {
        try {
          const { emit } = await import("@tauri-apps/api/event");
          await emit("source-selected", stored);
        } catch (error) {
          console.error("Failed to emit source-selected event:", error);
        }
      } else {
        window.dispatchEvent(new CustomEvent("foom-source-selected", { detail: stored }));
        window.opener?.dispatchEvent?.(new CustomEvent("foom-source-selected", { detail: stored }));
      }

      // Close the source selector window if open
      if (tauriRuntime) {
        try {
          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          const win = await WebviewWindow.getByLabel("source-selector");
          if (win) await win.hide();
        } catch {
          // ignore
        }
      }
    },
    isNativeWindowsCaptureAvailable: async () =>
      tauriRuntime && getPlatform() === "win32"
        ? ok({ available: true })
        : ok({ available: false, reason: "browser-preview" }),
    startNativeWindowsRecording: async (request: NativeWindowsRecordingRequest) => {
      if (!tauriRuntime) {
        return unavailable("Native Windows recording requires the desktop shell.");
      }
      try {
        const selectedSource = request?.source;
        const normalizedSourceId = normalizeCaptureSourceId(selectedSource);
        const normalizedSourceType = getCaptureSourceType(selectedSource);
        const isCustomArea = normalizedSourceId === "custom_area" || selectedSource?.type === "region";
        const region = selectedSource?.region;
        if (isCustomArea && (
          !region ||
          ![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) ||
          region.width <= 0 || region.height <= 0 ||
          region.width > 2147483647 || region.height > 2147483647 ||
          region.x < -2147483648 || region.y < -2147483648 ||
          region.x + region.width > 2147483647 || region.y + region.height > 2147483647
        )) {
          throw new Error("Select a valid capture area before recording.");
        }
        const options = {
          sourceType: isCustomArea
            ? "area"
            : normalizedSourceType === "window"
              ? "window"
              : "screen",
          source:
            !isCustomArea && normalizedSourceId && normalizedSourceId !== "screen"
              ? {
                  kind: normalizedSourceType === "window" ? "window" : "monitor",
                  id: normalizedSourceId,
                  title: undefined,
                  x: 0,
                  y: 0,
                  width: request?.video?.width ?? 1920,
                  height: request?.video?.height ?? 1080,
                  scaleFactor: 1,
                  primary: true,
                }
              : undefined,
          region: isCustomArea ? region : undefined,
          systemAudioEnabled: Boolean(request?.audio?.system?.enabled),
          cursorEnabled: request?.cursor?.mode === "editable-overlay",
        };
        const projectId = await invokeTauri<string>("start_recording", {
          options,
        });
        localStorage.setItem(
          currentNativeCursorCaptureModeKey,
          request?.cursor?.mode === "system" ? "system" : "editable-overlay",
        );
        return ok({
          recordingId: request?.recordingId ?? Date.now(),
          path: projectId,
        });
      } catch (error) {
        localStorage.removeItem(currentNativeCursorCaptureModeKey);
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message };
      }
    },
    appendRecordingSidecarChunk: async (
      kind: "mic" | "webcam",
      data: ArrayBuffer,
      timestampMs: number,
      sequence: number,
    ) => {
      if (!tauriRuntime) {
        return unavailable("Native recording sidecars require the desktop shell.");
      }
      try {
        await invokeTauri("append_recording_sidecar_chunk", {
          kind,
          bytes: arrayBufferToNumberArray(data),
          timestampMs: Math.max(0, Math.round(timestampMs)),
          sequence: Math.max(0, Math.round(sequence)),
        });
        return ok();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message };
      }
    },
    discardRecordingSidecar: async (kind: "mic" | "webcam") => {
      if (!tauriRuntime) {
        return unavailable("Native recording sidecars require the desktop shell.");
      }
      try {
        await invokeTauri("discard_recording_sidecar", { kind });
        return ok();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message };
      }
    },
    stopNativeWindowsRecording: async (input?: boolean | StopNativeWindowsRecordingInput) => {
      if (!tauriRuntime) {
        return unavailable("Native Windows recording requires the desktop shell.");
      }
      try {
        const discard = typeof input === "boolean" ? input : Boolean(input?.discard);
        if (discard) {
          await invokeTauri("cancel_recording");
          localStorage.removeItem(currentNativeCursorCaptureModeKey);
          return ok({ discarded: true });
        }
        const project = await invokeTauri<NativeProject>("stop_recording", {
          micAudioBytes:
            typeof input === "object" && input?.micAudioData
              ? arrayBufferToNumberArray(input.micAudioData)
              : null,
          cameraVideoBytes:
            typeof input === "object" && input?.cameraVideoData
              ? arrayBufferToNumberArray(input.cameraVideoData)
              : null,
          cameraMimeType: typeof input === "object" ? (input.cameraMimeType ?? null) : null,
          cameraShape: typeof input === "object" ? (input.cameraShape ?? null) : null,
        });
        const session = await projectToRecordingSession(project);
        if (session.screenVideoPath) {
          localStorage.setItem(currentRecordingSessionKey, JSON.stringify(session));
          localStorage.setItem(currentVideoPathKey, session.screenVideoPath);
          localStorage.removeItem(currentProjectFileKey);
          localStorage.removeItem(currentProjectPathKey);
        }
        localStorage.removeItem(currentNativeCursorCaptureModeKey);
        return ok({
          path: session.screenVideoPath,
          session,
          project,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message };
      }
    },
    pauseNativeWindowsRecording: async () => {
      if (!tauriRuntime) {
        return unavailable("Native Windows recording requires the desktop shell.");
      }
      await invokeTauri("pause_recording");
      return ok();
    },
    resumeNativeWindowsRecording: async () => {
      if (!tauriRuntime) {
        return unavailable("Native Windows recording requires the desktop shell.");
      }
      await invokeTauri("resume_recording");
      return ok();
    },
    isNativeMacCaptureAvailable: async () => ok({ available: false, reason: "browser-preview" }),
    requestNativeMacCursorAccess: async () => ({ granted: true }),
    startNativeMacRecording: async () =>
      unavailable("Native macOS recording requires the desktop shell."),
    stopNativeMacRecording: async () =>
      unavailable("Native macOS recording requires the desktop shell."),
    setRecordingState: async () => ok(),
    setHudOverlayIgnoreMouseEvents: async (ignore: boolean) => {
      if (tauriRuntime) {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const overlayWindow = await WebviewWindow.getByLabel("recording-overlay");
        if (!overlayWindow) {
          return {
            success: false,
            error: "Recording controls window is not available.",
            message: "Recording controls window is not available.",
          };
        }
        await overlayWindow.setIgnoreCursorEvents(ignore);
      }
      return ok();
    },
    setHudOverlaySize: async (
      width: number,
      height: number,
      layout?: string,
      preservePosition?: boolean,
    ) => {
      if (tauriRuntime) {
        await invokeTauri("set_hud_overlay_size", { width, height, layout, preservePosition });
      }
      return ok();
    },
    moveHudOverlayBy: async (deltaX: number, deltaY: number) => {
      if (tauriRuntime) {
        await invokeTauri("move_recording_overlay_by", { deltaX, deltaY });
      }
      return ok();
    },
    persistHudOverlayPlacement: async () => {
      if (tauriRuntime) {
        await invokeTauri("persist_recording_overlay_placement");
      }
      return ok();
    },
    getCurrentRecordingSession: async () => {
      const raw = localStorage.getItem(currentRecordingSessionKey);
      if (!raw) {
        return ok({ session: null });
      }
      try {
        const session = JSON.parse(raw);
        if (session && typeof session === "object") {
          if (
            typeof session.screenVideoPath === "string" &&
            session.screenVideoPath.startsWith("indexeddb://")
          ) {
            const key = session.screenVideoPath.replace("indexeddb://", "");
            const objectUrl = await loadVideoFromIndexedDb(key);
            if (objectUrl) {
              session.screenVideoPath = objectUrl;
            }
          }
          if (
            typeof session.webcamVideoPath === "string" &&
            session.webcamVideoPath.startsWith("indexeddb://")
          ) {
            const key = session.webcamVideoPath.replace("indexeddb://", "");
            const objectUrl = await loadVideoFromIndexedDb(key);
            if (objectUrl) {
              session.webcamVideoPath = objectUrl;
            }
          }
        }
        return ok({ session });
      } catch (err) {
        console.error("Error loading session:", err);
        return ok({ session: null });
      }
    },
    setCurrentRecordingSession: async (session: unknown) => {
      localStorage.setItem(currentRecordingSessionKey, JSON.stringify(session));
      return ok();
    },
    clearCurrentRecordingSession: async () => {
      localStorage.removeItem(currentRecordingSessionKey);
      return ok();
    },
    setHasUnsavedChanges: (hasChanges: boolean) => {
      currentHasUnsavedChanges = hasChanges;
    },
    onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => {
      saveBeforeCloseCallback = callback;
      return () => {
        if (saveBeforeCloseCallback === callback) {
          saveBeforeCloseCallback = null;
        }
      };
    },
    onRequestCloseConfirm: (callback: () => void) => {
      closeConfirmCallback = callback;
      return () => {
        if (closeConfirmCallback === callback) {
          closeConfirmCallback = null;
        }
      };
    },
    sendCloseConfirmResponse: async (response: "save" | "discard" | "cancel") => {
      if (response === "cancel") return;
      if (response === "save" && !(await saveBeforeCloseCallback?.())) return;
      await returnToRecorder();
    },
    onMenuNewProject: (callback: () => void) => listenToTauriEvent("menu-new-project", callback),
    onMenuNewRecording: (callback: () => void) => listenToTauriEvent("menu-new-recording", callback),
    onMenuLoadProject: (callback: () => void) => listenToTauriEvent("menu-load-project", callback),
    onMenuSaveProject: (callback: () => void) => listenToTauriEvent("menu-save-project", callback),
    onMenuSaveProjectAs: (callback: () => void) =>
      listenToTauriEvent("menu-save-project-as", callback),
    onSourceSelected: (callback: (source: ProcessedDesktopSource) => void) =>
      listenToTauriEventWithPayload("source-selected", callback),
    deleteRecording: async (id: string) => {
      localStorage.removeItem(currentVideoPathKey);
      localStorage.removeItem(currentRecordingSessionKey);
      localStorage.removeItem(currentProjectFileKey);
      localStorage.removeItem(currentProjectPathKey);

      if (tauriRuntime) {
        try {
          await invokeTauri("delete_recording", { id });
          return ok();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { success: false, error: message, message };
        }
      } else {
        try {
          const key = id.startsWith("indexeddb://") ? id.replace("indexeddb://", "") : id;
          await deleteVideoFromIndexedDb(key);
          await deleteVideoFromIndexedDb(`${key}-webcam`);
          await deleteVideoFromIndexedDb(`screen-${key}`);
          await deleteVideoFromIndexedDb(`webcam-${key}`);
          return ok();
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }
    },
    startNewRecording: async () => {
      try {
        await returnToRecorder();
        return ok();
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    switchToEditor: async () => {
      if (tauriRuntime) {
        try {
          const { emit } = await import("@tauri-apps/api/event");
          const rawSession = localStorage.getItem(currentRecordingSessionKey);
          const videoPath = localStorage.getItem(currentVideoPathKey);
          const projectRaw = localStorage.getItem(currentProjectFileKey);
          const projectPath = localStorage.getItem(currentProjectPathKey);

          const payload = {
            recordingSession: rawSession ? JSON.parse(rawSession) : undefined,
            videoPath: videoPath || undefined,
            projectRaw: projectRaw || undefined,
            projectPath: projectPath || undefined,
          };
          localStorage.setItem("foom-navigation-payload", JSON.stringify(payload));
          localStorage.setItem(editorRouteIntentKey, String(Date.now()));

          await emit("navigate-to-editor", payload);

          await invokeTauri("switch_to_main_window");

          window.location.hash = "/video-editor";

          await new Promise((resolve) => setTimeout(resolve, 25));

          await emit("navigate-to-editor", payload);
          window.location.hash = "/video-editor";
        } catch (error) {
          console.error("Error switching to editor:", error);
          return { success: false, error: String(error) };
        }
      } else {
        window.location.href = "#/video-editor";
      }
      return ok();
    },
    switchToOverlay: async () => {
      if (tauriRuntime) {
        try {
          await invokeTauri("switch_to_overlay");
          return ok();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { success: false, error: message, message };
        }
      }
      return ok();
    },
    switchToSettings: async () => {
      if (tauriRuntime) {
        try {
          // Store intent before switching windows so it's picked up if the
          // navigate-to-settings event arrives before the listener registers.
          localStorage.setItem(settingsRouteIntentKey, String(Date.now()));

          await invokeTauri("switch_to_main_window");

          await new Promise((resolve) => setTimeout(resolve, 250));

          const { emit } = await import("@tauri-apps/api/event");
          await emit("navigate-to-settings");
        } catch (error) {
          console.error("Error switching to settings:", error);
        }
      } else {
        window.location.href = "#/settings";
      }
      return ok();
    },
    openVideoFilePicker: async (kind: "video" | "audio" = "video") => {
      if (tauriRuntime) {
        try {
          const path = await invokeTauri<string | null>("open_video_file_picker", { kind });
          if (path) {
            return { success: true, path, canceled: false };
          }
          return { success: false, canceled: true };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      }
      // Browser fallback: open a standard file input and store selected file to IndexedDB
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = kind === "audio" ? "audio/*" : "video/*";
        input.style.display = "none";
        document.body.appendChild(input);
        
        input.onchange = async () => {
          const file = input.files?.[0];
          if (file) {
            try {
              const buffer = await file.arrayBuffer();
              const key = `screen-${Date.now()}`;
              const videoPath = await saveVideoToIndexedDb(key, buffer, file.type);
              if (kind === "video") localStorage.setItem(currentVideoPathKey, videoPath);
              resolve({ success: true, path: videoPath, name: file.name, canceled: false });
            } catch (err) {
              resolve({ success: false, error: String(err) });
            } finally {
              input.remove();
            }
          } else {
            input.remove();
            resolve({ success: false, canceled: true });
          }
        };
        
        input.oncancel = () => {
          input.remove();
          resolve({ success: false, canceled: true });
        };
        
        input.click();
      });
    },
    storeRecordedSession: async (input: RecordedSessionInput) => {
      if (tauriRuntime && tauriVideoDir && tauriJoin) {
        try {
          const videoDirPath = await tauriVideoDir();
          const recordingsDir = await tauriJoin(videoDirPath, "foom", "recordings");

          // Write screen data to file
          const screenFileName =
            input.screen.fileName || `recording-${input.createdAt || Date.now()}.webm`;
          const screenFilePath = await tauriJoin(recordingsDir, screenFileName);
          await invokeTauri("write_binary_file", {
            path: screenFilePath,
            bytes: arrayBufferToNumberArray(input.screen.videoData),
          });

          let webcamFilePath: string | undefined = undefined;
          if (input.webcam) {
            const webcamFileName =
              input.webcam.fileName || `recording-${input.createdAt || Date.now()}-webcam.webm`;
            webcamFilePath = await tauriJoin(recordingsDir, webcamFileName);
            await invokeTauri("write_binary_file", {
              path: webcamFilePath,
              bytes: arrayBufferToNumberArray(input.webcam.videoData),
            });
          }

          const session = {
            screenVideoPath: screenFilePath,
            ...(webcamFilePath ? { webcamVideoPath: webcamFilePath } : {}),
            createdAt: input.createdAt ?? Date.now(),
            ...(typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
              ? { durationMs: input.durationMs }
              : {}),
            cursorCaptureMode: input.cursorCaptureMode,
            ...(Array.isArray(input.cursorTelemetry)
              ? { cursorTelemetry: input.cursorTelemetry }
              : {}),
          };

          localStorage.setItem(currentRecordingSessionKey, JSON.stringify(session));
          localStorage.removeItem(currentProjectFileKey);
          localStorage.removeItem(currentProjectPathKey);
          localStorage.removeItem(currentVideoPathKey);
          return ok({ session });
        } catch (error) {
          console.error("Failed to store recorded session in Tauri:", error);
          return {
            success: false,
            error: String(error),
            message: String(error),
          };
        }
      }
      let screenVideoPath = "";
      let webcamVideoPath: string | undefined = undefined;
      try {
        screenVideoPath = await saveVideoToIndexedDb(
          `screen-${input.createdAt || Date.now()}`,
          input.screen.videoData,
        );
        if (input.webcam) {
          webcamVideoPath = await saveVideoToIndexedDb(
            `webcam-${input.createdAt || Date.now()}`,
            input.webcam.videoData,
          );
        }
      } catch (dbError) {
        console.warn("Failed to save to IndexedDB, falling back to data URL:", dbError);
        screenVideoPath = arrayBufferToDataUrl(input.screen.videoData, "video/webm");
        webcamVideoPath = input.webcam
          ? arrayBufferToDataUrl(input.webcam.videoData, "video/webm")
          : undefined;
      }
      const session = {
        screenVideoPath,
        ...(webcamVideoPath ? { webcamVideoPath } : {}),
        createdAt: input.createdAt ?? Date.now(),
        ...(typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
          ? { durationMs: input.durationMs }
          : {}),
        cursorCaptureMode: input.cursorCaptureMode,
        ...(Array.isArray(input.cursorTelemetry) ? { cursorTelemetry: input.cursorTelemetry } : {}),
      };
      localStorage.setItem(currentRecordingSessionKey, JSON.stringify(session));
      localStorage.removeItem(currentProjectFileKey);
      localStorage.removeItem(currentProjectPathKey);
      localStorage.removeItem(currentVideoPathKey);
      return ok({ session });
    },
    writeRecordedMediaFile: async (input: { videoData: ArrayBuffer; fileName: string }) => {
      if (tauriRuntime && tauriVideoDir && tauriJoin) {
        try {
          const videoDirPath = await tauriVideoDir();
          const recordingsDir = await tauriJoin(videoDirPath, "foom", "recordings");
          const filePath = await tauriJoin(recordingsDir, input.fileName);
          const path = await invokeTauri<string>("write_binary_file", {
            path: filePath,
            bytes: arrayBufferToNumberArray(input.videoData),
          });
          return ok({ path });
        } catch (error) {
          return {
            success: false,
            error: String(error),
            message: String(error),
          };
        }
      }
      return unavailable("Recording file writes require the desktop shell.");
    },
    revealInFolder: async (path: string) => {
      if (tauriRuntime) {
        await invokeTauri("reveal_in_folder", { path });
        return ok();
      }
      return unavailable();
    },
    pickExportSavePath: async (fileName: string, initialDirectory?: string) => {
      if (tauriRuntime) {
        const path = await invokeTauri<string | null>("pick_export_save_path", {
          fileName: fileName || `export-${Date.now()}.mp4`,
          initialDirectory: initialDirectory || null,
        });
        if (!path) {
          return { success: false, canceled: true };
        }
        return ok({ path, canceled: false });
      }
      return ok({
        path: `browser-download://${fileName || `export-${Date.now()}.mp4`}`,
      });
    },
    writeExportToPath: async (data: ArrayBuffer, targetPath: string) => {
      if (tauriRuntime) {
        const path = await invokeTauri<string>("write_binary_file", {
          path: targetPath,
          bytes: arrayBufferToNumberArray(data),
        });
        return ok({ path });
      }
      const fileName =
        targetPath.replace(/^browser-download:\/\//, "") || `export-${Date.now()}.mp4`;
      const extension = fileName.split(".").pop()?.toLowerCase();
      const mimeType =
        extension === "gif" ? "image/gif" : extension === "webm" ? "video/webm" : "video/mp4";
      downloadBrowserFile(data, fileName, mimeType);
      return ok({ path: fileName });
    },
    saveDiagnostic: async (diagnostic: unknown) => {
      const data = new TextEncoder().encode(JSON.stringify(diagnostic, null, 2)).buffer;
      return window.foomNative.writeExportToPath(
        data,
        `browser-download://diagnostic-${Date.now()}.json`,
      );
    },
    readBinaryFile: async (path: string) => {
      if (tauriRuntime) {
        try {
          const nativePath = fromFileUrl(path);
          const bytes = await invokeTauri<number[]>("read_binary_file", {
            path: nativePath,
          });
          return {
            success: true,
            data: new Uint8Array(bytes).buffer,
            path: nativePath,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { success: false, error: message, message, path };
        }
      }

      // Browser mode fallback
      if (path.startsWith("indexeddb://")) {
        const key = path.replace("indexeddb://", "");
        try {
          const blob = await loadVideoFromIndexedDbRaw(key);
          if (blob) {
            const buffer = await blob.arrayBuffer();
            return {
              success: true,
              data: buffer,
              path,
            };
          }
          return { success: false, error: "Video not found in IndexedDB", message: "Video not found in IndexedDB", path };
        } catch (error) {
          const message = String(error);
          return { success: false, error: message, message, path };
        }
      }

      // Fallback: fetch http/https/blob URLs
      try {
        const response = await fetch(path);
        if (!response.ok) {
          return { success: false, error: `HTTP error ${response.status}`, message: `HTTP error ${response.status}`, path };
        }
        const buffer = await response.arrayBuffer();
        return {
          success: true,
          data: buffer,
          path,
        };
      } catch (error) {
        const message = String(error);
        return { success: false, error: message, message, path };
      }
    },
    openExternalUrl: (url: string) => window.open(url, "_blank", "noopener,noreferrer"),
    hudOverlayHide: async () => {
      if (tauriRuntime) {
        await invokeTauri("hide_recording_overlay");
      }
      return ok();
    },
    hudOverlayShow: async () => {
      if (tauriRuntime) {
        await invokeTauri("show_recording_overlay");
      }
      return ok();
    },
    hudOverlayClose: async () => {
      if (tauriRuntime) {
        try {
          await invokeTauri("close_app");
        } catch (error) {
          console.error("Failed to close app via command:", error);
          try {
            const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
            const mainWindow = await WebviewWindow.getByLabel("main");
            if (mainWindow) {
              await mainWindow.close();
            }
            await (await getCurrentTauriWindow()).close();
          } catch {
            await (await getCurrentTauriWindow()).close();
          }
        }
      }
      return ok();
    },
    invokeNativeBridge: async (request: NativeBridgeRequestInput) => {
      const meta = {
        version: 1,
        requestId: request?.requestId ?? crypto.randomUUID?.() ?? String(Date.now()),
        timestampMs: Date.now(),
      };
      if (request?.domain === "project" && request?.action === "loadCurrentProjectFile") {
        const projectRaw = localStorage.getItem(currentProjectFileKey);
        const path = localStorage.getItem(currentProjectPathKey);
        return {
          ok: true,
          data: {
            success: true,
            project: projectRaw ? JSON.parse(projectRaw) : null,
            path,
          },
          meta,
        };
      }
      if (request?.domain === "project" && request?.action === "getCurrentContext") {
        return {
          ok: true,
          data: {
            currentProjectPath: localStorage.getItem(currentProjectPathKey),
            currentVideoPath: localStorage.getItem(currentVideoPathKey),
          },
          meta,
        };
      }
      if (request?.domain === "project" && request?.action === "saveProjectFile") {
        const projectData = request?.payload?.projectData;
        if (tauriRuntime) {
          try {
            const path = await invokeTauri<string | null>("save_project_file", {
              projectData,
              suggestedName: request?.payload?.suggestedName ?? null,
              existingProjectPath: request?.payload?.existingProjectPath ?? null,
            });
            if (!path) {
              return {
                ok: true,
                data: { success: false, canceled: true, path: null },
                meta,
              };
            }
            localStorage.setItem(currentProjectFileKey, JSON.stringify(projectData));
            localStorage.setItem(currentProjectPathKey, path);
            return {
              ok: true,
              data: { success: true, path },
              meta,
            };
          } catch (error) {
            return {
              ok: true,
              data: {
                success: false,
                canceled: false,
                path: null,
                message: error instanceof Error ? error.message : String(error),
              },
              meta,
            };
          }
        }
        localStorage.setItem(currentProjectFileKey, JSON.stringify(projectData));
        localStorage.setItem(currentProjectPathKey, localProjectPath);
        return {
          ok: true,
          data: {
            success: true,
            path: localProjectPath,
          },
          meta,
        };
      }
      if (request?.domain === "project" && request?.action === "loadProjectFile") {
        if (tauriRuntime) {
          try {
            const result = await invokeTauri<{
              path: string;
              content: string;
            } | null>("open_project_file_picker");
            if (!result) {
              return {
                ok: true,
                data: {
                  success: false,
                  canceled: true,
                  project: null,
                  path: null,
                },
                meta,
              };
            }
            const projectRaw = result.content;
            const path = result.path;
            let project: unknown;
            try {
              project = JSON.parse(projectRaw);
            } catch {
              return {
                ok: true,
                data: {
                  success: false,
                  canceled: false,
                  project: null,
                  path: null,
                  message: "Selected project file is corrupted.",
                },
                meta,
              };
            }
            localStorage.setItem(currentProjectFileKey, projectRaw);
            localStorage.setItem(currentProjectPathKey, path);
            localStorage.removeItem(currentVideoPathKey);
            localStorage.removeItem(currentRecordingSessionKey);
            return { ok: true, data: { success: true, project, path }, meta };
          } catch (error) {
            return {
              ok: true,
              data: {
                success: false,
                canceled: false,
                project: null,
                path: null,
                message: String(error),
              },
              meta,
            };
          }
        }

        const projectRaw = localStorage.getItem(currentProjectFileKey);
        const path = localStorage.getItem(currentProjectPathKey) || localProjectPath;
        if (!projectRaw) {
          return {
            ok: true,
            data: {
              success: false,
              canceled: false,
              project: null,
              path: null,
              message: "No locally saved video project found.",
            },
            meta,
          };
        }
        let project: unknown;
        try {
          project = JSON.parse(projectRaw);
        } catch {
          return {
            ok: true,
            data: {
              success: false,
              canceled: false,
              project: null,
              path: null,
              message: "Saved local video project is corrupted.",
            },
            meta,
          };
        }
        if (project && typeof project === "object") {
          const projectAny = project as Record<string, unknown>;
          if (projectAny.media && typeof projectAny.media === "object") {
            const media = projectAny.media as Record<string, unknown>;
            if (
              typeof media.screenVideoPath === "string" &&
              media.screenVideoPath.startsWith("indexeddb://")
            ) {
              const key = media.screenVideoPath.replace("indexeddb://", "");
              const objectUrl = await loadVideoFromIndexedDb(key);
              if (objectUrl) media.screenVideoPath = objectUrl;
            }
            if (
              typeof media.webcamVideoPath === "string" &&
              media.webcamVideoPath.startsWith("indexeddb://")
            ) {
              const key = media.webcamVideoPath.replace("indexeddb://", "");
              const objectUrl = await loadVideoFromIndexedDb(key);
              if (objectUrl) media.webcamVideoPath = objectUrl;
            }
          }
        }
        localStorage.removeItem(currentVideoPathKey);
        localStorage.removeItem(currentRecordingSessionKey);
        return {
          ok: true,
          data: {
            success: true,
            project,
            path,
          },
          meta,
        };
      }
      if (request?.domain === "project" && request?.action === "getCurrentVideoPath") {
        let path = localStorage.getItem(currentVideoPathKey);
        if (path && path.startsWith("indexeddb://")) {
          try {
            const key = path.replace("indexeddb://", "");
            const objectUrl = await loadVideoFromIndexedDb(key);
            if (objectUrl) {
              path = objectUrl;
            }
          } catch (e) {
            console.error("Failed to load video from IndexedDB:", e);
          }
        }
        return {
          ok: true,
          data: {
            success: true,
            path,
          },
          meta,
        };
      }
      if (request?.domain === "project" && request?.action === "setCurrentVideoPath") {
        localStorage.setItem(currentVideoPathKey, request?.payload?.path ?? "");
        localStorage.removeItem(currentRecordingSessionKey);
        localStorage.removeItem(currentProjectFileKey);
        localStorage.removeItem(currentProjectPathKey);
        return {
          ok: true,
          data: { success: true, path: request?.payload?.path },
          meta,
        };
      }
      if (request?.domain === "project" && request?.action === "clearCurrentVideoPath") {
        localStorage.removeItem(currentVideoPathKey);
        return { ok: true, data: { success: true, path: null }, meta };
      }
      if (request?.domain === "system" && request?.action === "getPlatform") {
        return { ok: true, data: getPlatform(), meta };
      }
      if (request?.domain === "system" && request?.action === "getAssetBasePath") {
        return { ok: true, data: "/", meta };
      }
      if (request?.domain === "system" && request?.action === "getCapabilities") {
        return {
          ok: true,
          data: {
            bridgeVersion: 1,
            platform: getPlatform(),
            cursor: {
              telemetry: true,
              systemAssets: false,
              provider: "none",
            },
            project: {
              currentContext: true,
            },
          },
          meta,
        };
      }
      if (request?.domain === "cursor") {
        if (request?.action === "getCapabilities") {
          return {
            ok: true,
            data: {
              telemetry: true,
              systemAssets: false,
              provider: "none",
            },
            meta,
          };
        }

        const document = await loadNativeRecordingDocument(request?.payload?.videoPath);
        const samples =
          document && Array.isArray(document.events)
            ? nativeDocumentToCursorSamples(document)
            : browserSessionCursorSamples(request?.payload?.videoPath);
        return {
          ok: true,
          data:
            request?.action === "getRecordingData"
              ? {
                  version: 1,
                  provider: "none",
                  samples,
                  assets: [],
                }
              : samples.map(({ visible: _visible, ...sample }) => sample),
          meta,
        };
      }
      return { ok: true, data: null, meta };
    },
  };
  const nativeBridge = {
    ...compatBridge,
    ...existingFoomNative,
    isBrowserPreview: existingFoomNative.isBrowserPreview ?? isBrowserPreview,
  };
  if (tauriRuntime) {
    try {
      const appWindow = getCurrentWindow();
      appWindow.onCloseRequested(async (event) => {
        if (closeConfirmCallback) {
          event.preventDefault();
          if (currentHasUnsavedChanges) closeConfirmCallback();
          else await returnToRecorder();
        }
      });
    } catch (err) {
      console.error("Failed to register onCloseRequested listener:", err);
    }
  }

  window.foomNative = nativeBridge;
  window.electronAPI = nativeBridge;
}
