import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useScopedT } from "@/contexts/I18nContext";
import { fixWebmDuration } from "@/lib/fixWebmDuration";
import {
  type NativeMacRecordingRequest,
  parseMacDisplayIdFromSourceId,
  parseMacWindowIdFromSourceId,
} from "@/lib/nativeMacRecording";
import {
  type NativeWindowsRecordingRequest,
  parseWindowHandleFromSourceId,
} from "@/lib/nativeWindowsRecording";
import type {
  CursorCaptureMode,
  CursorTelemetrySample,
  RecordedVideoAssetInput,
} from "@/lib/recordingSession";
import { requestCameraAccess } from "@/lib/requestCameraAccess";

let cachedPlatform: string | null = null;

async function getCachedPlatform() {
  if (cachedPlatform) {
    return cachedPlatform;
  }
  if (window.foomNative) {
    cachedPlatform = await window.foomNative.getPlatform();
  }
  return cachedPlatform || "win32";
}

const TARGET_FRAME_RATE = 60;
const MIN_FRAME_RATE = 30;
const TARGET_WIDTH = 3840;
const TARGET_HEIGHT = 2160;
const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;
const QHD_WIDTH = 2560;
const QHD_HEIGHT = 1440;
const QHD_PIXELS = QHD_WIDTH * QHD_HEIGHT;

const BITRATE_4K = 45_000_000;
const BITRATE_QHD = 28_000_000;
const BITRATE_BASE = 18_000_000;
const HIGH_FRAME_RATE_THRESHOLD = 60;
const HIGH_FRAME_RATE_BOOST = 1.7;

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

const CODEC_ALIGNMENT = 2;

const RECORDER_TIMESLICE_MS = 1000;
const BITS_PER_MEGABIT = 1_000_000;
const CHROME_MEDIA_SOURCE = "desktop";
const RECORDING_FILE_PREFIX = "recording-";
const VIDEO_FILE_EXTENSION = ".webm";
const WEBCAM_FILE_SUFFIX = "-webcam";

const AUDIO_BITRATE_VOICE = 128_000;
const AUDIO_BITRATE_SYSTEM = 192_000;

const MIC_GAIN_BOOST = 1.4;
const WEBCAM_TARGET_FRAME_RATE = 30;

type UseScreenRecorderReturn = {
  recording: boolean;
  paused: boolean;
  elapsedSeconds: number;
  toggleRecording: () => void;
  togglePaused: () => void;
  canPauseRecording: boolean;
  restartRecording: () => void;
  cancelRecording: () => void;
  microphoneEnabled: boolean;
  setMicrophoneEnabled: (enabled: boolean) => void;
  microphoneDeviceId: string | undefined;
  setMicrophoneDeviceId: (deviceId: string | undefined) => void;
  microphoneDeviceName: string | undefined;
  setMicrophoneDeviceName: (deviceName: string | undefined) => void;
  webcamDeviceId: string | undefined;
  setWebcamDeviceId: (deviceId: string | undefined) => void;
  webcamDeviceName: string | undefined;
  setWebcamDeviceName: (deviceName: string | undefined) => void;
  systemAudioEnabled: boolean;
  setSystemAudioEnabled: (enabled: boolean) => void;
  webcamEnabled: boolean;
  setWebcamEnabled: (enabled: boolean) => Promise<boolean>;
  cursorCaptureMode: CursorCaptureMode;
  setCursorCaptureMode: (mode: CursorCaptureMode) => void;
};

type RecorderHandle = {
  recorder: MediaRecorder;
  recordedBlobPromise: Promise<Blob>;
};

type NativeWindowsRecordingHandle = {
  recordingId: number;
  finalizing: boolean;
  paused: boolean;
  webcamRecorder: RecorderHandle | null;
};

type NativeMacRecordingHandle = {
  recordingId: number;
  finalizing: boolean;
  paused: boolean;
};

type BrowserCursorTelemetryRecorder = {
  stop: () => CursorTelemetrySample[];
};

function isTextCursorElement(element: Element | null) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === "textarea") {
    return true;
  }
  if (tagName === "input") {
    const type = (element as HTMLInputElement).type;
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }
  return element.closest('[contenteditable="true"]') !== null;
}

function getBrowserCursorType(
  event: MouseEvent | PointerEvent,
): CursorTelemetrySample["cursorType"] {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (isTextCursorElement(element)) {
    return "text";
  }
  if (element?.closest("a, button, [role='button'], [role='link'], label, select, summary")) {
    return "pointer";
  }

  const computedCursor = element ? window.getComputedStyle(element).cursor : "auto";
  if (computedCursor === "text" || computedCursor === "vertical-text") {
    return "text";
  }
  if (computedCursor === "pointer") {
    return "pointer";
  }
  return "arrow";
}

function createBrowserCursorTelemetryRecorder(startedAtMs: number): BrowserCursorTelemetryRecorder {
  const samples: CursorTelemetrySample[] = [];
  let lastMoveAtMs = 0;

  const pushSample = (
    event: MouseEvent | PointerEvent,
    interactionType: "move" | "click" | "mouseup",
  ) => {
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    samples.push({
      timeMs: Math.max(0, Math.round(performance.now() - startedAtMs)),
      cx: Math.max(0, Math.min(event.clientX / viewportWidth, 1)),
      cy: Math.max(0, Math.min(event.clientY / viewportHeight, 1)),
      visible: true,
      cursorType: getBrowserCursorType(event),
      interactionType,
    });
  };

  const handlePointerMove = (event: PointerEvent) => {
    const now = performance.now();
    if (now - lastMoveAtMs < 33) {
      return;
    }
    lastMoveAtMs = now;
    pushSample(event, "move");
  };
  const handlePointerDown = (event: PointerEvent) => pushSample(event, "click");
  const handlePointerUp = (event: PointerEvent) => pushSample(event, "mouseup");

  window.addEventListener("pointermove", handlePointerMove, { passive: true });
  window.addEventListener("pointerdown", handlePointerDown, { passive: true });
  window.addEventListener("pointerup", handlePointerUp, { passive: true });

  return {
    stop: () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      return samples;
    },
  };
}

function createRecorderHandle(stream: MediaStream, options: MediaRecorderOptions): RecorderHandle {
  const recorder = new MediaRecorder(stream, options);
  const chunks: Blob[] = [];
  const mimeType = options.mimeType || "video/webm";
  const recordedBlobPromise = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      reject(new Error("Recording failed"));
    };
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  recorder.start(RECORDER_TIMESLICE_MS);
  return { recorder, recordedBlobPromise };
}

export function useScreenRecorder(): UseScreenRecorderReturn {
  const t = useScopedT("editor");
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(() => {
    try {
      return localStorage.getItem("foom-setting-default-mic") === "true";
    } catch {
      return false;
    }
  });
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | undefined>(undefined);
  const [microphoneDeviceName, setMicrophoneDeviceName] = useState<string | undefined>(undefined);
  const [webcamDeviceId, setWebcamDeviceId] = useState<string | undefined>(undefined);
  const [webcamDeviceName, setWebcamDeviceName] = useState<string | undefined>(undefined);
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(() => {
    try {
      return localStorage.getItem("foom-setting-default-system-audio") === "true";
    } catch {
      return false;
    }
  });
  const [webcamEnabled, setWebcamEnabledState] = useState(() => {
    try {
      return localStorage.getItem("foom-setting-default-webcam") === "true";
    } catch {
      return false;
    }
  });
  const [cursorCaptureMode, setCursorCaptureMode] = useState<CursorCaptureMode>(() => {
    try {
      return (
        (localStorage.getItem("foom-setting-default-cursor-mode") as CursorCaptureMode) ||
        "editable-overlay"
      );
    } catch {
      return "editable-overlay";
    }
  });
  const screenRecorder = useRef<RecorderHandle | null>(null);
  const webcamRecorder = useRef<RecorderHandle | null>(null);
  const nativeWindowsRecording = useRef<NativeWindowsRecordingHandle | null>(null);
  const nativeMacRecording = useRef<NativeMacRecordingHandle | null>(null);
  const browserCursorTelemetryRecorder = useRef<BrowserCursorTelemetryRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const webcamStream = useRef<MediaStream | null>(null);
  const mixingContext = useRef<AudioContext | null>(null);
  const recordingId = useRef<number>(0);
  const accumulatedDurationMs = useRef(0);
  const segmentStartedAt = useRef<number | null>(null);
  const finalizingRecordingId = useRef<number | null>(null);
  const allowAutoFinalize = useRef(false);
  const discardRecordingId = useRef<number | null>(null);
  const restarting = useRef(false);
  const countdownRunId = useRef(0);
  const startRecordCountdownRef = useRef<(() => Promise<void>) | null>(null);
  const [countdownActive, setCountdownActive] = useState(false);
  const webcamReady = useRef(false);
  const webcamAcquireId = useRef(0);
  const canPauseRecording =
    recording &&
    Boolean(
      (nativeWindowsRecording.current && !nativeWindowsRecording.current.finalizing) ||
      (nativeMacRecording.current && !nativeMacRecording.current.finalizing) ||
      (screenRecorder.current && screenRecorder.current.recorder.state !== "inactive"),
    );

  const getRecordingDurationMs = useCallback(() => {
    const segmentDuration =
      segmentStartedAt.current === null ? 0 : Date.now() - segmentStartedAt.current;
    return accumulatedDurationMs.current + segmentDuration;
  }, []);

  const selectMimeType = () => {
    // H.264 first: hardware-accelerated on all modern devices, gives sharp
    // real-time output. AV1/VP9 are great for distribution but too
    // CPU-intensive for live 60 fps capture — they produce blurry frames
    // when the software encoder can't keep up.
    const preferred = [
      "video/webm;codecs=h264",
      "video/webm;codecs=vp8",
      "video/webm;codecs=vp9",
      "video/webm;codecs=av1",
      "video/webm",
    ];

    return preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
  };

  const computeBitrate = (width: number, height: number) => {
    const pixels = width * height;
    const highFrameRateBoost =
      TARGET_FRAME_RATE >= HIGH_FRAME_RATE_THRESHOLD ? HIGH_FRAME_RATE_BOOST : 1;

    if (pixels >= FOUR_K_PIXELS) {
      return Math.round(BITRATE_4K * highFrameRateBoost);
    }

    if (pixels >= QHD_PIXELS) {
      return Math.round(BITRATE_QHD * highFrameRateBoost);
    }

    return Math.round(BITRATE_BASE * highFrameRateBoost);
  };

  const teardownMedia = useCallback(() => {
    if (stream.current) {
      stream.current.getTracks().forEach((track) => track.stop());
      stream.current = null;
    }
    if (screenStream.current) {
      screenStream.current.getTracks().forEach((track) => track.stop());
      screenStream.current = null;
    }
    if (microphoneStream.current) {
      microphoneStream.current.getTracks().forEach((track) => track.stop());
      microphoneStream.current = null;
    }
    if (mixingContext.current) {
      mixingContext.current.close().catch(() => {
        // Ignore close errors during recorder teardown.
      });
      mixingContext.current = null;
    }
  }, []);

  const stopWebcamPreviewStream = useCallback(() => {
    if (!webcamStream.current) {
      return;
    }

    webcamAcquireId.current++;
    webcamStream.current.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    webcamStream.current = null;
    webcamReady.current = true;
  }, []);

  const setWebcamEnabled = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        setWebcamEnabledState(false);
        return true;
      }

      const accessResult = await requestCameraAccess();
      if (!accessResult.success) {
        toast.error(t("recording.failedCameraAccess"));
        return false;
      }

      if (!accessResult.granted) {
        toast.error(t("recording.cameraBlocked"));
        return false;
      }

      setWebcamEnabledState(true);
      return true;
    },
    [t],
  );

  useEffect(() => {
    void getCachedPlatform();
  }, []);

  useEffect(() => {
    if (!webcamEnabled) return;

    let cancelled = false;
    let acquiredStream: MediaStream | null = null;
    const thisAcquireId = ++webcamAcquireId.current;
    webcamReady.current = false;

    const acquire = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: webcamDeviceId
            ? {
                deviceId: { exact: webcamDeviceId },
                frameRate: {
                  ideal: WEBCAM_TARGET_FRAME_RATE,
                  max: WEBCAM_TARGET_FRAME_RATE,
                },
              }
            : {
                frameRate: {
                  ideal: WEBCAM_TARGET_FRAME_RATE,
                  max: WEBCAM_TARGET_FRAME_RATE,
                },
              },
        });

        if (cancelled || thisAcquireId !== webcamAcquireId.current) {
          stream.getTracks().forEach((track) => {
            track.onended = null;
            track.stop();
          });
          return;
        }

        acquiredStream = stream;
        stream.getVideoTracks().forEach((track) => {
          track.onended = () => {
            webcamStream.current = null;
            if (!restarting.current) {
              setWebcamEnabledState(false);
              toast.error(t("recording.cameraDisconnected"));
            }
          };
        });
        webcamStream.current = stream;
        webcamReady.current = true;
      } catch (cameraError) {
        if (!cancelled) {
          console.warn("Failed to get webcam access:", cameraError);
          setWebcamEnabledState(false);
          const isDeviceError =
            cameraError instanceof DOMException &&
            [
              "NotFoundError",
              "DevicesNotFoundError",
              "OverconstrainedError",
              "NotReadableError",
            ].includes(cameraError.name);
          toast.error(t(isDeviceError ? "recording.cameraNotFound" : "recording.cameraBlocked"));
          webcamReady.current = true;
        }
      }
    };

    void acquire();

    return () => {
      cancelled = true;
      webcamReady.current = false;
      if (acquiredStream) {
        acquiredStream.getTracks().forEach((track) => {
          track.onended = null;
          track.stop();
        });
        webcamStream.current = null;
      }
    };
  }, [webcamEnabled, webcamDeviceId, t]);

  const finalizeRecording = useCallback(
    (
      activeScreenRecorder: RecorderHandle,
      activeWebcamRecorder: RecorderHandle | null,
      duration: number,
      activeRecordingId: number,
    ) => {
      if (finalizingRecordingId.current === activeRecordingId) {
        return;
      }
      finalizingRecordingId.current = activeRecordingId;

      if (screenRecorder.current === activeScreenRecorder) {
        screenRecorder.current = null;
      }
      if (activeWebcamRecorder && webcamRecorder.current === activeWebcamRecorder) {
        webcamRecorder.current = null;
      }

      teardownMedia();
      const cursorTelemetry = browserCursorTelemetryRecorder.current?.stop() ?? [];
      browserCursorTelemetryRecorder.current = null;
      setRecording(false);
      setPaused(false);
      setElapsedSeconds(0);
      accumulatedDurationMs.current = 0;
      segmentStartedAt.current = null;
      window.foomNative?.setRecordingState?.(false);

      void (async () => {
        try {
          const screenBlob = await activeScreenRecorder.recordedBlobPromise;
          if (discardRecordingId.current === activeRecordingId) {
            window.foomNative?.discardCursorTelemetry?.(activeRecordingId);
            // Bring the floating HUD toolbar back after a cancelled recording
            void window.foomNative?.hudOverlayShow?.();
            return;
          }
          if (screenBlob.size === 0) {
            return;
          }

          const fixedScreenBlob = await fixWebmDuration(screenBlob, duration);
          let fixedWebcamBlob: Blob | null = null;
          if (activeWebcamRecorder) {
            const webcamBlob = await activeWebcamRecorder.recordedBlobPromise.catch(() => null);
            if (webcamBlob && webcamBlob.size > 0) {
              fixedWebcamBlob = await fixWebmDuration(webcamBlob, duration);
            }
          }

          const screenFileName = `${RECORDING_FILE_PREFIX}${activeRecordingId}${VIDEO_FILE_EXTENSION}`;
          const webcamFileName = `${RECORDING_FILE_PREFIX}${activeRecordingId}${WEBCAM_FILE_SUFFIX}${VIDEO_FILE_EXTENSION}`;
          const result = await window.foomNative.storeRecordedSession({
            screen: {
              videoData: await fixedScreenBlob.arrayBuffer(),
              fileName: screenFileName,
            },
            webcam: fixedWebcamBlob
              ? {
                  videoData: await fixedWebcamBlob.arrayBuffer(),
                  fileName: webcamFileName,
                }
              : undefined,
            createdAt: activeRecordingId,
            durationMs: duration,
            cursorCaptureMode: window.foomNative?.isBrowserPreview ? "system" : cursorCaptureMode,
            cursorTelemetry,
          });

          if (!result.success) {
            console.error("Failed to store recording session:", result.message);
            return;
          }

          if (result.session) {
            await window.foomNative.setCurrentRecordingSession(result.session);
          } else if (result.path) {
            await window.foomNative.setCurrentVideoPath(result.path);
          }

          await window.foomNative.switchToEditor();
        } catch (error) {
          console.error("Error saving recording:", error);
        } finally {
          if (finalizingRecordingId.current === activeRecordingId) {
            finalizingRecordingId.current = null;
          }
          if (discardRecordingId.current === activeRecordingId) {
            discardRecordingId.current = null;
          }
        }
      })();
    },
    [cursorCaptureMode, teardownMedia],
  );

  const finalizeNativeWindowsRecording = useCallback(
    async (discard = false) => {
      const activeNativeRecording = nativeWindowsRecording.current;
      if (!activeNativeRecording || activeNativeRecording.finalizing) {
        return false;
      }

      activeNativeRecording.finalizing = true;
      const activeWebcamRecorder = activeNativeRecording.webcamRecorder;
      const duration = Math.max(0, getRecordingDurationMs());
      if (
        activeWebcamRecorder?.recorder.state === "recording" ||
        activeWebcamRecorder?.recorder.state === "paused"
      ) {
        try {
          activeWebcamRecorder.recorder.stop();
        } catch {
          // Recorder may already be stopping.
        }
      }
      if (activeWebcamRecorder && webcamRecorder.current === activeWebcamRecorder) {
        webcamRecorder.current = null;
      }

      const clearNativeRecordingState = () => {
        nativeWindowsRecording.current = null;
        setRecording(false);
        setPaused(false);
        setElapsedSeconds(0);
        accumulatedDurationMs.current = 0;
        segmentStartedAt.current = null;
      };

      try {
        let fixedWebcamBlob: Blob | null = null;
        if (activeWebcamRecorder && !discard) {
          const webcamBlob = await activeWebcamRecorder.recordedBlobPromise.catch(() => null);
          if (webcamBlob && webcamBlob.size > 0) {
            fixedWebcamBlob = await fixWebmDuration(webcamBlob, duration);
          }
        }

        const result = await window.foomNative.stopNativeWindowsRecording({
          discard,
          cameraVideoData: fixedWebcamBlob ? await fixedWebcamBlob.arrayBuffer() : null,
          cameraMimeType: fixedWebcamBlob?.type || null,
          cameraShape: null,
        });
        if (discard || result.discarded) {
          clearNativeRecordingState();
          // Bring the floating HUD toolbar back after a cancelled recording
          void window.foomNative.hudOverlayShow?.();
          return true;
        }
        if (!result.success) {
          console.error("Failed to stop native Windows recording:", result.error);
          toast.error(result.error ?? "Failed to stop native Windows recording");
          activeNativeRecording.finalizing = false;
          return true;
        }

        const nativeScreenPath = result.session?.screenVideoPath ?? result.path;
        let storedSession = result.session;
        if (storedSession && nativeScreenPath) {
          storedSession = {
            ...storedSession,
            screenVideoPath: nativeScreenPath,
            createdAt: activeNativeRecording.recordingId,
            durationMs: storedSession.durationMs ?? duration,
            cursorCaptureMode,
          };
        }

        clearNativeRecordingState();
        if (storedSession) {
          await window.foomNative.setCurrentRecordingSession(storedSession);
        } else if (result.path) {
          await window.foomNative.setCurrentVideoPath(result.path);
        } else {
          toast.error("Recording finished, but no video file was created.");
          activeNativeRecording.finalizing = false;
          return true;
        }

        await window.foomNative.switchToEditor();
        return true;
      } catch (error) {
        console.error("Error saving native Windows recording:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to save native Windows recording",
        );
        activeNativeRecording.finalizing = false;
        return true;
      } finally {
        if (discardRecordingId.current === activeNativeRecording.recordingId) {
          discardRecordingId.current = null;
        }
      }
    },
    [cursorCaptureMode, getRecordingDurationMs],
  );

  const finalizeNativeMacRecording = useCallback(
    async (discard = false) => {
      const activeNativeRecording = nativeMacRecording.current;
      if (!activeNativeRecording || activeNativeRecording.finalizing) {
        return false;
      }

      activeNativeRecording.finalizing = true;
      const duration = Math.max(0, getRecordingDurationMs());
      const activeWebcamRecorder = webcamRecorder.current;
      if (activeWebcamRecorder && webcamRecorder.current === activeWebcamRecorder) {
        webcamRecorder.current = null;
      }
      const webcamAssetPromise = (async (): Promise<RecordedVideoAssetInput | undefined> => {
        if (!activeWebcamRecorder) {
          return undefined;
        }

        try {
          if (activeWebcamRecorder.recorder.state !== "inactive") {
            activeWebcamRecorder.recorder.stop();
          }
          const webcamBlob = await activeWebcamRecorder.recordedBlobPromise;
          if (!webcamBlob || webcamBlob.size === 0) {
            return undefined;
          }
          const fixedWebcamBlob = await fixWebmDuration(webcamBlob, duration);
          return {
            videoData: await fixedWebcamBlob.arrayBuffer(),
            fileName: `${RECORDING_FILE_PREFIX}${activeNativeRecording.recordingId}${WEBCAM_FILE_SUFFIX}${VIDEO_FILE_EXTENSION}`,
          };
        } catch (error) {
          console.error("Failed to finalize native macOS webcam recording:", error);
          return undefined;
        }
      })();

      const clearNativeRecordingState = () => {
        nativeMacRecording.current = null;
        setRecording(false);
        setPaused(false);
        setElapsedSeconds(0);
        accumulatedDurationMs.current = 0;
        segmentStartedAt.current = null;
      };

      try {
        const result = await window.foomNative.stopNativeMacRecording(discard);
        const webcamAsset = await webcamAssetPromise;
        if (discard || result.discarded) {
          clearNativeRecordingState();
          // Bring the floating HUD toolbar back after a cancelled recording
          void window.foomNative.hudOverlayShow?.();
          return true;
        }
        if (!result.success) {
          console.error("Failed to stop native macOS recording:", result.error);
          toast.error(result.error ?? "Failed to stop native macOS recording");
          activeNativeRecording.finalizing = false;
          return true;
        }

        if (webcamAsset && result.path) {
          const attachResult = await window.foomNative.attachNativeMacWebcamRecording({
            screenVideoPath: result.path,
            recordingId: activeNativeRecording.recordingId,
            webcam: webcamAsset,
            cursorCaptureMode,
          });
          if (attachResult.success) {
            result.session = attachResult.session;
          } else {
            console.error("Failed to attach native macOS webcam recording:", attachResult.error);
            toast.error(attachResult.error ?? "Failed to store webcam recording");
          }
        }

        clearNativeRecordingState();
        if (result.session) {
          await window.foomNative.setCurrentRecordingSession(result.session);
        } else if (result.path) {
          await window.foomNative.setCurrentVideoPath(result.path);
        } else {
          toast.error("Recording finished, but no video file was created.");
          activeNativeRecording.finalizing = false;
          return true;
        }

        await window.foomNative.switchToEditor();
        return true;
      } catch (error) {
        console.error("Error saving native macOS recording:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to save native macOS recording",
        );
        activeNativeRecording.finalizing = false;
        return true;
      } finally {
        if (discardRecordingId.current === activeNativeRecording.recordingId) {
          discardRecordingId.current = null;
        }
      }
    },
    [cursorCaptureMode, getRecordingDurationMs],
  );

  const stopRecording = useRef(() => {
    if (nativeWindowsRecording.current) {
      void finalizeNativeWindowsRecording(false);
      return;
    }
    if (nativeMacRecording.current) {
      void finalizeNativeMacRecording(false);
      return;
    }

    const activeScreenRecorder = screenRecorder.current;
    if (!activeScreenRecorder) {
      return;
    }

    const activeWebcamRecorder = webcamRecorder.current;
    const duration = getRecordingDurationMs();
    const activeRecordingId = recordingId.current;

    finalizeRecording(
      activeScreenRecorder,
      activeWebcamRecorder ?? null,
      duration,
      activeRecordingId,
    );

    if (
      activeScreenRecorder.recorder.state === "recording" ||
      activeScreenRecorder.recorder.state === "paused"
    ) {
      try {
        activeScreenRecorder.recorder.stop();
      } catch {
        // Recorder may already be stopping.
      }
    }
    if (activeWebcamRecorder) {
      if (
        activeWebcamRecorder.recorder.state === "recording" ||
        activeWebcamRecorder.recorder.state === "paused"
      ) {
        try {
          activeWebcamRecorder.recorder.stop();
        } catch {
          // Recorder may already be stopping.
        }
      }
    }
  });

  const safeHideCountdownOverlay = useCallback(async (runId: number) => {
    try {
      await window.foomNative.hideCountdownOverlay(runId);
    } catch (error) {
      console.warn("Failed to hide countdown overlay:", error);
    }
  }, []);

  const safeHideRecordingOverlayBeforeCapture = useCallback(async () => {
    try {
      await window.foomNative.hudOverlayHide?.();
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    } catch (error) {
      console.warn("Failed to hide recording toolbar before capture:", error);
    }
  }, []);

  const safeShowRecordingOverlayAfterCaptureStart = useCallback(async () => {
    try {
      await window.foomNative.hudOverlayShow?.();
    } catch (error) {
      console.warn("Failed to show recording toolbar after capture started:", error);
    }
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (window.foomNative?.onStopRecordingFromTray) {
      cleanup = window.foomNative.onStopRecordingFromTray(() => {
        stopRecording.current();
      });
    }

    return () => {
      const activeRunId = countdownRunId.current;
      if (cleanup) cleanup();
      countdownRunId.current += 1;
      void safeHideCountdownOverlay(activeRunId);
      allowAutoFinalize.current = false;
      restarting.current = false;
      discardRecordingId.current = null;
      if (nativeWindowsRecording.current) {
        void finalizeNativeWindowsRecording(true);
      }
      if (nativeMacRecording.current) {
        void finalizeNativeMacRecording(true);
      }

      if (
        screenRecorder.current?.recorder.state === "recording" ||
        screenRecorder.current?.recorder.state === "paused"
      ) {
        try {
          screenRecorder.current.recorder.stop();
        } catch {
          // Ignore recorder teardown errors during cleanup.
        }
      }
      if (
        webcamRecorder.current?.recorder.state === "recording" ||
        webcamRecorder.current?.recorder.state === "paused"
      ) {
        try {
          webcamRecorder.current.recorder.stop();
        } catch {
          // Ignore recorder teardown errors during cleanup.
        }
      }
      screenRecorder.current = null;
      webcamRecorder.current = null;
      teardownMedia();
    };
  }, [
    teardownMedia,
    safeHideCountdownOverlay,
    finalizeNativeWindowsRecording,
    finalizeNativeMacRecording,
  ]);

  useEffect(() => {
    if (!window.foomNative?.onSourceSelected) return;

    const unsubscribe = window.foomNative.onSourceSelected(() => {
      try {
        const pending = localStorage.getItem("foom-start-recording-after-select");
        if (pending === "true") {
          localStorage.removeItem("foom-start-recording-after-select");
          if (startRecordCountdownRef.current) {
            void startRecordCountdownRef.current();
          }
        }
      } catch (e) {
        console.warn("Failed to check pending recording start:", e);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const cancelCountdown = () => {
    const activeRunId = countdownRunId.current;
    countdownRunId.current += 1;
    setCountdownActive(false);
    setRecording(false);
    void safeHideCountdownOverlay(activeRunId);
    void safeShowRecordingOverlayAfterCaptureStart();
  };

  const isCountdownRunActive = (runId?: number) =>
    runId === undefined || countdownRunId.current === runId;

  const waitForWebcamReady = async () => {
    if (webcamReady.current) {
      return;
    }

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (webcamReady.current) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 5000);
    });
  };

  const startNativeWindowsRecordingIfAvailable = async (
    selectedSource: ProcessedDesktopSource,
    countdownRunToken?: number,
  ) => {
    try {
      const platform = await getCachedPlatform();
      if (platform !== "win32") {
        return false;
      }

      const availability = await window.foomNative.isNativeWindowsCaptureAvailable();
      if (!availability.success || !availability.available) {
        if (availability.reason === "unsupported-os") {
          return false;
        }
        if (availability.reason === "missing-helper") {
          console.warn("Native Windows capture helper is not available; using browser capture.");
          return false;
        }
        if (!availability.available) {
          console.warn(
            availability.error ?? "Native Windows capture is not available; using browser capture.",
          );
          return false;
        }

        throw new Error(availability.error ?? "Native Windows capture is not available.");
      }

      if (!isCountdownRunActive(countdownRunToken)) {
        return true;
      }

      const activeRecordingId = Date.now();
      const displayId = Number(selectedSource.display_id);
      const sourceType = selectedSource.id.startsWith("window:") ? "window" : "display";
      const windowHandle = parseWindowHandleFromSourceId(selectedSource.id);
      if (webcamEnabled) {
        await waitForWebcamReady();
        if (!isCountdownRunActive(countdownRunToken)) {
          return true;
        }
      }
      const browserWebcamRecorder =
        webcamEnabled && webcamStream.current
          ? createRecorderHandle(webcamStream.current, {
              mimeType: selectMimeType(),
              videoBitsPerSecond: BITRATE_BASE,
            })
          : null;
      if (webcamEnabled && !browserWebcamRecorder) {
        stopWebcamPreviewStream();
      }
      const request: NativeWindowsRecordingRequest = {
        recordingId: activeRecordingId,
        source: {
          type: sourceType,
          sourceId: selectedSource.id,
          ...(Number.isFinite(displayId) ? { displayId } : {}),
          ...(windowHandle ? { windowHandle } : {}),
        },
        video: {
          fps: TARGET_FRAME_RATE,
          width: TARGET_WIDTH,
          height: TARGET_HEIGHT,
        },
        audio: {
          system: {
            enabled: systemAudioEnabled,
          },
          microphone: {
            enabled: microphoneEnabled,
            deviceId: microphoneDeviceId,
            deviceName: microphoneDeviceName,
            gain: MIC_GAIN_BOOST,
          },
        },
        webcam: {
          enabled: webcamEnabled && !browserWebcamRecorder,
          deviceId: webcamDeviceId,
          deviceName: webcamDeviceName,
          width: 0,
          height: 0,
          fps: WEBCAM_TARGET_FRAME_RATE,
        },
        cursor: {
          mode: cursorCaptureMode,
        },
      };
      const result = await window.foomNative.startNativeWindowsRecording(request);
      if (!result.success || !result.recordingId) {
        if (
          browserWebcamRecorder?.recorder.state === "recording" ||
          browserWebcamRecorder?.recorder.state === "paused"
        ) {
          browserWebcamRecorder.recorder.stop();
        }
        throw new Error(result.error ?? "Native Windows capture failed.");
      }

      recordingId.current = result.recordingId;
      nativeWindowsRecording.current = {
        recordingId: result.recordingId,
        finalizing: false,
        paused: false,
        webcamRecorder: browserWebcamRecorder,
      };
      webcamRecorder.current = browserWebcamRecorder;
      accumulatedDurationMs.current = 0;
      segmentStartedAt.current = Date.now();
      allowAutoFinalize.current = true;
      setRecording(true);
      setPaused(false);
      setElapsedSeconds(0);
      await safeShowRecordingOverlayAfterCaptureStart();
      return true;
    } catch (error) {
      console.error("Native Windows capture failed:", error);
      throw error;
    }
  };

  const startNativeMacRecordingIfAvailable = async (
    selectedSource: ProcessedDesktopSource,
    countdownRunToken?: number,
  ) => {
    try {
      const platform = await getCachedPlatform();
      if (platform !== "darwin") {
        return false;
      }

      const availability = await window.foomNative.isNativeMacCaptureAvailable();
      if (!availability.success || !availability.available) {
        if (availability.reason === "unsupported-platform") {
          return false;
        }
        if (availability.reason === "missing-helper" || !availability.available) {
          console.warn(
            availability.error ?? "Native macOS capture is not available; using browser capture.",
          );
          return false;
        }

        throw new Error(
          availability.reason === "missing-helper"
            ? "Native macOS capture helper is not available."
            : (availability.error ?? "Native macOS capture is not available."),
        );
      }

      if (!isCountdownRunActive(countdownRunToken)) {
        return true;
      }

      const activeRecordingId = Date.now();
      const sourceType = selectedSource.id.startsWith("window:") ? "window" : "display";
      const displayId =
        Number(selectedSource.display_id) || parseMacDisplayIdFromSourceId(selectedSource.id);
      const windowId = parseMacWindowIdFromSourceId(selectedSource.id);
      let nativeWebcamRecorder: RecorderHandle | null = null;
      if (webcamEnabled) {
        if (!webcamReady.current) {
          await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              if (webcamReady.current) {
                clearInterval(interval);
                resolve();
              }
            }, 50);
            setTimeout(() => {
              clearInterval(interval);
              resolve();
            }, 5000);
          });
        }
        if (!isCountdownRunActive(countdownRunToken)) {
          return true;
        }
        if (webcamStream.current) {
          nativeWebcamRecorder = createRecorderHandle(webcamStream.current, {
            mimeType: selectMimeType(),
            videoBitsPerSecond: BITRATE_BASE,
          });
        } else {
          webcamAcquireId.current++;
          setWebcamEnabledState(false);
        }
      }
      if (!isCountdownRunActive(countdownRunToken)) {
        if (nativeWebcamRecorder && nativeWebcamRecorder.recorder.state !== "inactive") {
          nativeWebcamRecorder.recorder.stop();
        }
        return true;
      }
      const request: NativeMacRecordingRequest = {
        schemaVersion: 1,
        recordingId: activeRecordingId,
        source: {
          type: sourceType,
          sourceId: selectedSource.id,
          ...(displayId ? { displayId } : {}),
          ...(windowId ? { windowId } : {}),
        },
        video: {
          fps: TARGET_FRAME_RATE,
          width: TARGET_WIDTH,
          height: TARGET_HEIGHT,
          bitrate: computeBitrate(TARGET_WIDTH, TARGET_HEIGHT),
          hideSystemCursor: cursorCaptureMode === "editable-overlay",
        },
        audio: {
          system: {
            enabled: systemAudioEnabled,
          },
          microphone: {
            enabled: microphoneEnabled,
            deviceId: microphoneDeviceId,
            deviceName: microphoneDeviceName,
            gain: MIC_GAIN_BOOST,
          },
        },
        webcam: {
          enabled: webcamEnabled,
          deviceId: webcamDeviceId,
          deviceName: webcamDeviceName,
          width: 0,
          height: 0,
          fps: WEBCAM_TARGET_FRAME_RATE,
        },
        cursor: {
          mode: cursorCaptureMode,
        },
        outputs: {
          screenPath: "",
        },
      };
      const result = await window.foomNative.startNativeMacRecording(request);
      if (!result.success || !result.recordingId) {
        if (nativeWebcamRecorder && nativeWebcamRecorder.recorder.state !== "inactive") {
          nativeWebcamRecorder.recorder.stop();
        }
        throw new Error(result.error ?? "Native macOS capture failed.");
      }
      if (!isCountdownRunActive(countdownRunToken)) {
        if (nativeWebcamRecorder && nativeWebcamRecorder.recorder.state !== "inactive") {
          nativeWebcamRecorder.recorder.stop();
        }
        await window.foomNative.stopNativeMacRecording(true);
        return true;
      }

      recordingId.current = result.recordingId;
      nativeMacRecording.current = {
        recordingId: result.recordingId,
        finalizing: false,
        paused: false,
      };
      webcamRecorder.current = nativeWebcamRecorder;
      accumulatedDurationMs.current = 0;
      segmentStartedAt.current = Date.now();
      allowAutoFinalize.current = true;
      setRecording(true);
      setPaused(false);
      setElapsedSeconds(0);
      await safeShowRecordingOverlayAfterCaptureStart();
      return true;
    } catch (error) {
      console.error("Native macOS capture failed:", error);
      throw error;
    }
  };

  const startRecordCountdown = async () => {
    if (countdownActive || recording) {
      return;
    }

    const runId = countdownRunId.current + 1;
    countdownRunId.current = runId;

    // Optimistically hide the overlay immediately (feels instant!)
    let overlayHiddenBeforeStart = false;
    try {
      setRecording(true);
      setPaused(false);
      setElapsedSeconds(0);
      setCountdownActive(false);
      await safeHideCountdownOverlay(runId);
      await safeHideRecordingOverlayBeforeCapture();
      overlayHiddenBeforeStart = true;
    } catch (e) {
      console.warn("Failed to hide overlay on record start:", e);
    }

    if (!isCountdownRunActive(runId)) {
      if (overlayHiddenBeforeStart) {
        setRecording(false);
        await safeShowRecordingOverlayAfterCaptureStart();
      }
      return;
    }

    let selectedSource: ProcessedDesktopSource | null = null;
    try {
      selectedSource = await window.foomNative.getSelectedSource();
    } catch (error) {
      console.warn("Failed to read selected source before countdown:", error);
    }

    if (!isCountdownRunActive(runId)) {
      if (overlayHiddenBeforeStart) {
        setRecording(false);
        await safeShowRecordingOverlayAfterCaptureStart();
      }
      return;
    }

    if (!selectedSource) {
      if (countdownRunId.current === runId) {
        setCountdownActive(false);
      }
      if (overlayHiddenBeforeStart) {
        setRecording(false);
        await safeShowRecordingOverlayAfterCaptureStart();
      }
      alert(t("recording.selectSource"));
      return;
    }

    try {
      const platform = await getCachedPlatform();
      if (platform === "darwin" && cursorCaptureMode === "editable-overlay") {
        const access = await window.foomNative.requestNativeMacCursorAccess();
        if (!access.granted) {
          if (overlayHiddenBeforeStart) {
            setRecording(false);
            await safeShowRecordingOverlayAfterCaptureStart();
          }
          toast.info(t("recording.accessibilityAllowAndRetry"));
          return;
        }
      }
    } catch (error) {
      console.warn("Failed to preflight macOS cursor accessibility before countdown:", error);
    }

    if (!isCountdownRunActive(runId)) {
      if (overlayHiddenBeforeStart) {
        setRecording(false);
        await safeShowRecordingOverlayAfterCaptureStart();
      }
      return;
    }

    setCountdownActive(false);
    await safeHideCountdownOverlay(runId);
    // Give the overlay a short moment to disappear before capture starts without
    // making the user wait through a visible countdown.
    await new Promise((resolve) => window.setTimeout(resolve, 120));

    try {
      await startRecording(runId, selectedSource);
    } catch (error) {
      // Catch block of startRecording handles resetting state & restoring overlay
    }
  };
  startRecordCountdownRef.current = startRecordCountdown;

  const startRecording = async (
    countdownRunToken?: number,
    preselectedSource?: ProcessedDesktopSource | null,
  ) => {
    try {
      const selectedSource = preselectedSource || (await window.foomNative.getSelectedSource());
      if (!selectedSource) {
        alert(t("recording.selectSource"));
        return;
      }

      if (!isCountdownRunActive(countdownRunToken)) {
        teardownMedia();
        return;
      }

      if (await startNativeWindowsRecordingIfAvailable(selectedSource, countdownRunToken)) {
        return;
      }
      if (await startNativeMacRecordingIfAvailable(selectedSource, countdownRunToken)) {
        return;
      }

      let screenMediaStream: MediaStream;
      const platform = await getCachedPlatform();

      if (platform === "win32") {
        // getDisplayMedia + setDisplayMediaRequestHandler (main.ts) supplies the
        // pre-selected source. Editable cursor mode excludes the system cursor so
        // the editor can render a replacement; system mode bakes it into the video.
        screenMediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor:
              window.foomNative?.isBrowserPreview || cursorCaptureMode === "system"
                ? "always"
                : "never",
            width: { max: TARGET_WIDTH },
            height: { max: TARGET_HEIGHT },
            frameRate: { ideal: TARGET_FRAME_RATE },
          } as MediaTrackConstraints,
          audio: systemAudioEnabled,
        } as DisplayMediaStreamOptions);
      } else {
        const videoConstraints = {
          mandatory: {
            chromeMediaSource: CHROME_MEDIA_SOURCE,
            chromeMediaSourceId: selectedSource.id,
            maxWidth: TARGET_WIDTH,
            maxHeight: TARGET_HEIGHT,
            maxFrameRate: TARGET_FRAME_RATE,
            minFrameRate: MIN_FRAME_RATE,
          },
        };

        if (systemAudioEnabled) {
          try {
            screenMediaStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                mandatory: {
                  chromeMediaSource: CHROME_MEDIA_SOURCE,
                  chromeMediaSourceId: selectedSource.id,
                },
              },
              video: videoConstraints,
            } as unknown as MediaStreamConstraints);
          } catch (audioErr) {
            console.warn("System audio capture failed, falling back to video-only:", audioErr);
            toast.error(t("recording.systemAudioUnavailable"));
            screenMediaStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: videoConstraints,
            } as unknown as MediaStreamConstraints);
          }
        } else {
          screenMediaStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: videoConstraints,
          } as unknown as MediaStreamConstraints);
        }
      }
      screenStream.current = screenMediaStream;

      if (!isCountdownRunActive(countdownRunToken)) {
        teardownMedia();
        return;
      }

      if (microphoneEnabled) {
        try {
          microphoneStream.current = await navigator.mediaDevices.getUserMedia({
            audio: microphoneDeviceId
              ? {
                  deviceId: { exact: microphoneDeviceId },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                }
              : {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
            video: false,
          });
        } catch (audioError) {
          console.warn("Failed to get microphone access:", audioError);
          toast.error(t("recording.microphoneDenied"));
          setMicrophoneEnabled(false);
        }
      }

      if (!isCountdownRunActive(countdownRunToken)) {
        teardownMedia();
        return;
      }

      if (webcamEnabled) {
        if (!webcamReady.current) {
          await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              if (webcamReady.current) {
                clearInterval(interval);
                resolve();
              }
            }, 50);
            setTimeout(() => {
              clearInterval(interval);
              resolve();
            }, 5000);
          });
        }
        if (!webcamStream.current) {
          webcamAcquireId.current++;
          setWebcamEnabledState(false);
        }
      }

      if (!isCountdownRunActive(countdownRunToken)) {
        teardownMedia();
        return;
      }

      stream.current = new MediaStream();
      const videoTrack = screenMediaStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("Video track is not available.");
      }
      stream.current.addTrack(videoTrack);

      const systemAudioTrack = screenMediaStream.getAudioTracks()[0];
      const micAudioTrack = microphoneStream.current?.getAudioTracks()[0];

      if (systemAudioTrack && micAudioTrack) {
        const ctx = new AudioContext();
        mixingContext.current = ctx;
        const systemSource = ctx.createMediaStreamSource(new MediaStream([systemAudioTrack]));
        const micSource = ctx.createMediaStreamSource(new MediaStream([micAudioTrack]));
        const micGain = ctx.createGain();
        micGain.gain.value = MIC_GAIN_BOOST;
        const destination = ctx.createMediaStreamDestination();
        systemSource.connect(destination);
        micSource.connect(micGain).connect(destination);
        stream.current.addTrack(destination.stream.getAudioTracks()[0]);
      } else if (systemAudioTrack) {
        stream.current.addTrack(systemAudioTrack);
      } else if (micAudioTrack) {
        stream.current.addTrack(micAudioTrack);
      }

      try {
        await videoTrack.applyConstraints({
          frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
          width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
          height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
        });
      } catch (constraintError) {
        console.warn(
          "Unable to lock 4K/60fps constraints, using best available track settings.",
          constraintError,
        );
      }

      if (!isCountdownRunActive(countdownRunToken)) {
        teardownMedia();
        return;
      }

      const { frameRate = TARGET_FRAME_RATE } = videoTrack.getSettings();
      let { width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT } = videoTrack.getSettings();

      width = Math.floor(width / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;
      height = Math.floor(height / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;
      let videoBitsPerSecond = computeBitrate(width, height);
      if (window.foomNative?.isBrowserPreview) {
        // Lower the bitrate in browser mode to prevent software encoding lag and CPU overhead
        videoBitsPerSecond = Math.min(videoBitsPerSecond, 6_000_000);
      }
      const mimeType = selectMimeType();

      const hasAudio = stream.current.getAudioTracks().length > 0;
      if (!isCountdownRunActive(countdownRunToken)) {
        teardownMedia();
        return;
      }

      recordingId.current = Date.now();
      const activeRecordingId = recordingId.current;
      screenRecorder.current = createRecorderHandle(stream.current, {
        mimeType,
        videoBitsPerSecond,
        ...(hasAudio
          ? {
              audioBitsPerSecond: systemAudioTrack ? AUDIO_BITRATE_SYSTEM : AUDIO_BITRATE_VOICE,
            }
          : {}),
      });
      browserCursorTelemetryRecorder.current?.stop();
      browserCursorTelemetryRecorder.current = createBrowserCursorTelemetryRecorder(
        performance.now(),
      );
      screenRecorder.current.recorder.addEventListener(
        "error",
        () => {
          setRecording(false);
        },
        { once: true },
      );

      if (webcamStream.current) {
        webcamRecorder.current = createRecorderHandle(webcamStream.current, {
          mimeType,
          videoBitsPerSecond: window.foomNative?.isBrowserPreview
            ? 2_000_000
            : Math.min(videoBitsPerSecond, BITRATE_BASE),
        });
      }

      accumulatedDurationMs.current = 0;
      segmentStartedAt.current = Date.now();
      allowAutoFinalize.current = true;
      setRecording(true);
      setPaused(false);
      setElapsedSeconds(0);
      window.foomNative?.setRecordingState(true, recordingId.current, cursorCaptureMode);
      await safeShowRecordingOverlayAfterCaptureStart();

      const activeScreenRecorder = screenRecorder.current;
      const activeWebcamRecorder = webcamRecorder.current;
      if (activeScreenRecorder) {
        activeScreenRecorder.recorder.addEventListener(
          "stop",
          () => {
            if (!allowAutoFinalize.current) {
              return;
            }
            finalizeRecording(
              activeScreenRecorder,
              activeWebcamRecorder ?? null,
              Math.max(0, getRecordingDurationMs()),
              activeRecordingId,
            );
          },
          { once: true },
        );
      }
    } catch (error) {
      console.error("Failed to start recording:", error);
      const errorMsg = error instanceof Error ? error.message : "Failed to start recording";
      if (errorMsg.includes("Permission denied") || errorMsg.includes("NotAllowedError")) {
        toast.error(t("recording.permissionDenied"));
      } else {
        toast.error(errorMsg);
      }
      setRecording(false);
      setPaused(false);
      setElapsedSeconds(0);
      accumulatedDurationMs.current = 0;
      segmentStartedAt.current = null;
      screenRecorder.current = null;
      webcamRecorder.current = null;
      browserCursorTelemetryRecorder.current?.stop();
      browserCursorTelemetryRecorder.current = null;
      teardownMedia();
      await safeShowRecordingOverlayAfterCaptureStart();
    }
  };

  const togglePaused = () => {
    const activeNativeWindowsRecording = nativeWindowsRecording.current;
    if (activeNativeWindowsRecording && !activeNativeWindowsRecording.finalizing) {
      void (async () => {
        try {
          if (activeNativeWindowsRecording.paused) {
            const result = await window.foomNative.resumeNativeWindowsRecording();
            if (!result.success) {
              throw new Error(result.error ?? "Failed to resume native Windows recording");
            }
            activeNativeWindowsRecording.paused = false;
            segmentStartedAt.current = Date.now();
            setPaused(false);
            return;
          }

          const pausedAtMs = getRecordingDurationMs();
          const result = await window.foomNative.pauseNativeWindowsRecording();
          if (!result.success) {
            throw new Error(result.error ?? "Failed to pause native Windows recording");
          }
          activeNativeWindowsRecording.paused = true;
          accumulatedDurationMs.current = pausedAtMs;
          segmentStartedAt.current = null;
          setElapsedSeconds(Math.floor(accumulatedDurationMs.current / 1000));
          setPaused(true);
        } catch (error) {
          console.error("Failed to toggle native Windows pause state:", error);
          toast.error(error instanceof Error ? error.message : "Failed to toggle pause state");
        }
      })();
      return;
    }

    const activeNativeMacRecording = nativeMacRecording.current;
    if (activeNativeMacRecording && !activeNativeMacRecording.finalizing) {
      void (async () => {
        const activeWebcamRecorder = webcamRecorder.current?.recorder;
        try {
          if (activeNativeMacRecording.paused) {
            const result = await window.foomNative.resumeNativeMacRecording();
            if (!result.success) {
              throw new Error(result.error ?? "Failed to resume native macOS recording");
            }
            if (activeWebcamRecorder?.state === "paused") {
              activeWebcamRecorder.resume();
            }
            activeNativeMacRecording.paused = false;
            segmentStartedAt.current = Date.now();
            setPaused(false);
            return;
          }

          const pausedAtMs = getRecordingDurationMs();
          const result = await window.foomNative.pauseNativeMacRecording();
          if (!result.success) {
            throw new Error(result.error ?? "Failed to pause native macOS recording");
          }
          if (activeWebcamRecorder?.state === "recording") {
            activeWebcamRecorder.pause();
          }
          activeNativeMacRecording.paused = true;
          accumulatedDurationMs.current = pausedAtMs;
          segmentStartedAt.current = null;
          setElapsedSeconds(Math.floor(accumulatedDurationMs.current / 1000));
          setPaused(true);
        } catch (error) {
          console.error("Failed to toggle native macOS pause state:", error);
          toast.error(error instanceof Error ? error.message : "Failed to toggle pause state");
        }
      })();
      return;
    }

    const activeScreenRecorder = screenRecorder.current?.recorder;
    if (!activeScreenRecorder || activeScreenRecorder.state === "inactive") {
      return;
    }

    const activeWebcamRecorder = webcamRecorder.current?.recorder;

    if (activeScreenRecorder.state === "paused") {
      try {
        activeScreenRecorder.resume();
        if (activeWebcamRecorder?.state === "paused") {
          activeWebcamRecorder.resume();
        }
        segmentStartedAt.current = Date.now();
        setPaused(false);
      } catch (error) {
        console.error("Failed to resume recording:", error);
      }
      return;
    }

    if (activeScreenRecorder.state !== "recording") {
      return;
    }

    try {
      accumulatedDurationMs.current = getRecordingDurationMs();
      segmentStartedAt.current = null;
      setElapsedSeconds(Math.floor(accumulatedDurationMs.current / 1000));
      activeScreenRecorder.pause();
      if (activeWebcamRecorder?.state === "recording") {
        activeWebcamRecorder.pause();
      }
      setPaused(true);
    } catch (error) {
      console.error("Failed to pause recording:", error);
    }
  };

  const toggleRecording = () => {
    if (recording) {
      stopRecording.current();
      return;
    }

    if (countdownActive) {
      cancelCountdown();
      return;
    }

    if (window.foomNative?.isBrowserPreview) {
      void startRecording();
      return;
    }

    void (async () => {
      const selectedSource = await window.foomNative?.getSelectedSource?.().catch(() => null);
      if (selectedSource) {
        await startRecordCountdown();
        return;
      }

      try {
        localStorage.setItem("foom-start-recording-after-select", "true");
      } catch (e) {
        console.warn("Failed to set start-recording flag:", e);
      }

      if (window.foomNative?.openSourceSelector) {
        window.foomNative.openSourceSelector();
      } else {
        await startRecordCountdown();
      }
    })();
  };

  const restartRecording = async () => {
    if (restarting.current) return;

    if (nativeWindowsRecording.current) {
      const activeRecordingId = recordingId.current;
      restarting.current = true;
      discardRecordingId.current = activeRecordingId;
      try {
        await finalizeNativeWindowsRecording(true);
        // Bring back HUD, then open source selector with countdown — same flow as fresh record
        void window.foomNative.hudOverlayShow?.();
        if (window.foomNative?.openSourceSelector) {
          localStorage.setItem("foom-start-recording-after-select", "true");
          window.foomNative.openSourceSelector();
        } else {
          await startRecordCountdown();
        }
      } finally {
        restarting.current = false;
      }
      return;
    }
    if (nativeMacRecording.current) {
      const activeRecordingId = recordingId.current;
      restarting.current = true;
      discardRecordingId.current = activeRecordingId;
      try {
        await finalizeNativeMacRecording(true);
        // Bring back HUD, then open source selector with countdown — same flow as fresh record
        void window.foomNative.hudOverlayShow?.();
        if (window.foomNative?.openSourceSelector) {
          localStorage.setItem("foom-start-recording-after-select", "true");
          window.foomNative.openSourceSelector();
        } else {
          await startRecordCountdown();
        }
      } finally {
        restarting.current = false;
      }
      return;
    }

    const activeScreenRecorder = screenRecorder.current;
    if (!activeScreenRecorder || activeScreenRecorder.recorder.state === "inactive") return;

    const activeWebcamRecorder = webcamRecorder.current;
    const activeRecordingId = recordingId.current;

    restarting.current = true;
    discardRecordingId.current = activeRecordingId;

    const stopPromises = [
      new Promise<void>((resolve) => {
        activeScreenRecorder.recorder.addEventListener("stop", () => resolve(), { once: true });
      }),
    ];

    if (
      activeWebcamRecorder?.recorder.state === "recording" ||
      activeWebcamRecorder?.recorder.state === "paused"
    ) {
      stopPromises.push(
        new Promise<void>((resolve) => {
          activeWebcamRecorder.recorder.addEventListener("stop", () => resolve(), {
            once: true,
          });
        }),
      );
    }

    stopRecording.current();
    await Promise.all(stopPromises);

    try {
      // For browser-based recording restart go through countdown, no source selector needed
      await startRecordCountdown();
    } finally {
      restarting.current = false;
    }
  };

  useEffect(() => {
    if (!recording) {
      setElapsedSeconds(0);
      return;
    }

    setElapsedSeconds(Math.floor(getRecordingDurationMs() / 1000));
    if (paused) {
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor(getRecordingDurationMs() / 1000));
    }, 250);

    return () => window.clearInterval(interval);
  }, [getRecordingDurationMs, paused, recording]);

  const cancelRecording = () => {
    if (nativeWindowsRecording.current) {
      const activeRecordingId = recordingId.current;
      discardRecordingId.current = activeRecordingId;
      allowAutoFinalize.current = false;
      void finalizeNativeWindowsRecording(true);
      return;
    }
    if (nativeMacRecording.current) {
      const activeRecordingId = recordingId.current;
      discardRecordingId.current = activeRecordingId;
      allowAutoFinalize.current = false;
      void finalizeNativeMacRecording(true);
      return;
    }

    const activeScreenRecorder = screenRecorder.current;
    if (
      activeScreenRecorder?.recorder.state === "recording" ||
      activeScreenRecorder?.recorder.state === "paused"
    ) {
      const activeRecordingId = recordingId.current;
      discardRecordingId.current = activeRecordingId;
      allowAutoFinalize.current = false;

      stopRecording.current();
      return;
    }

    if (countdownActive) {
      cancelCountdown();
      return;
    }
  };

  return {
    recording,
    paused,
    elapsedSeconds,
    toggleRecording,
    togglePaused,
    canPauseRecording,
    restartRecording,
    cancelRecording,
    microphoneEnabled,
    setMicrophoneEnabled,
    microphoneDeviceId,
    setMicrophoneDeviceId,
    microphoneDeviceName,
    setMicrophoneDeviceName,
    webcamDeviceId,
    setWebcamDeviceId,
    webcamDeviceName,
    setWebcamDeviceName,
    systemAudioEnabled,
    setSystemAudioEnabled,
    webcamEnabled,
    setWebcamEnabled,
    cursorCaptureMode,
    setCursorCaptureMode,
  };
}
