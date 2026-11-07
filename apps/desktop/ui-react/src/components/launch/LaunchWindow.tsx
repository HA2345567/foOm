import {
  ChevronDown,
  Clapperboard,
  AppWindow,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  GripVertical,
  Monitor,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MousePointer,
  Pause,
  Play,
  Square,
  RefreshCw,
  XCircle,
  Circle,
  FileVideo,
  FolderOpen,
  Minus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { loadUserPreferences, saveUserPreferences } from "@/lib/userPreferences";
import { nativeBridgeClient } from "@/native";
import { useAudioLevelMeter } from "../../hooks/useAudioLevelMeter";
import { useCameraDevices } from "../../hooks/useCameraDevices";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { requestCameraAccess } from "../../lib/requestCameraAccess";
import { formatTimePadded } from "../../utils/timeUtils";
import { toast } from "sonner";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import styles from "./LaunchWindow.module.css";
import { openSourceSelectorWithPermissionRetry } from "./openSourceSelectorFlow";

const ICON_SIZE = 20;

// Vertical tray gap (px): bar's 20px edge offset plus an 8px gap.
const HUD_DEVICE_POPUP_GAP = 28;
// Horizontal layout: mirrors the former `bottom-[68px]` class on the popup element.
const HUD_DEVICE_POPUP_HORIZONTAL_BOTTOM = 68;

type TrayLayout = "top" | "right" | "bottom" | "left";

const ICON_CONFIG = {
  drag: { icon: GripVertical, size: ICON_SIZE },
  monitor: { icon: Monitor, size: ICON_SIZE },
  volumeOn: { icon: Volume2, size: ICON_SIZE },
  volumeOff: { icon: VolumeX, size: ICON_SIZE },
  micOn: { icon: Mic, size: ICON_SIZE },
  micOff: { icon: MicOff, size: ICON_SIZE },
  webcamOn: { icon: Video, size: ICON_SIZE },
  webcamOff: { icon: VideoOff, size: ICON_SIZE },
  cursor: { icon: MousePointer, size: ICON_SIZE },
  pause: { icon: Pause, size: ICON_SIZE },
  resume: { icon: Play, size: ICON_SIZE },
  stop: { icon: Square, size: ICON_SIZE },
  restart: { icon: RefreshCw, size: ICON_SIZE },
  cancel: { icon: XCircle, size: ICON_SIZE },
  record: { icon: Circle, size: ICON_SIZE },
  videoFile: { icon: FileVideo, size: ICON_SIZE },
  folder: { icon: FolderOpen, size: ICON_SIZE },
  minimize: { icon: Minus, size: ICON_SIZE },
  close: { icon: X, size: ICON_SIZE },
} as const;

type IconName = keyof typeof ICON_CONFIG;

/** Renders the configured icon for a HUD control. */
function getIcon(name: IconName, className?: string) {
  const { icon: Icon, size } = ICON_CONFIG[name];
  return <Icon size={size} className={className} />;
}

const hudGroupClasses =
  "flex items-center gap-0.5 rounded-xl border border-white/[0.07] bg-white/[0.045] transition-colors duration-150 hover:bg-white/[0.075]";

const hudIconBtnClasses =
  "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer text-white hover:bg-white/10 active:scale-95";

const hudAuxIconBtnClasses =
  "flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150 text-white/55 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed";

const windowBtnClasses =
  "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer opacity-50 hover:opacity-90 hover:bg-white/[0.08]";

/** Launches the floating recording HUD and its recorder controls. */
export function LaunchWindow() {
  const t = useScopedT("launch");

  const {
    recording,
    finalizing,
    paused,
    elapsedSeconds,
    countdownValue,
    toggleRecording,
    togglePaused,
    canPauseRecording,
    restartRecording,
    cancelRecording,
    microphoneEnabled,
    setMicrophoneEnabled,
    microphoneDeviceId,
    setMicrophoneDeviceId,
    setMicrophoneDeviceName,
    systemAudioEnabled,
    setSystemAudioEnabled,
    webcamEnabled,
    setWebcamEnabled,
    webcamDeviceId,
    setWebcamDeviceId,
    setWebcamDeviceName,
    cursorCaptureMode,
    setCursorCaptureMode,
  } = useScreenRecorder();
  const recordingUiActive = recording || finalizing || countdownValue !== null;
  const toggleRecordingRef = useRef(toggleRecording);

  useEffect(() => {
    toggleRecordingRef.current = toggleRecording;
  }, [toggleRecording]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return;

    let cancelled = false;
    const unlisten: Array<() => void> = [];
    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const stopListening = await listen("global-recording-hotkey", () => {
          toggleRecordingRef.current();
        });
        if (cancelled) {
          stopListening();
        } else {
          unlisten.push(stopListening);
        }

        const stopListeningForErrors = await listen<string>(
          "global-recording-hotkey-error",
          (event) => toast.error(event.payload),
        );
        if (cancelled) {
          stopListeningForErrors();
        } else {
          unlisten.push(stopListeningForErrors);
        }
      })
      .catch((error) => {
        console.error("Failed to register recording shortcut listeners:", error);
      });

    return () => {
      cancelled = true;
      unlisten.forEach((stopListening) => stopListening());
    };
  }, []);

  const showMicControls = microphoneEnabled && !recordingUiActive;
  const showWebcamControls = webcamEnabled && !recordingUiActive;

  const [isMicHovered, setIsMicHovered] = useState(false);
  const [isMicFocused, setIsMicFocused] = useState(false);
  const micExpanded = isMicHovered || isMicFocused;

  const [isWebcamHovered, setIsWebcamHovered] = useState(false);
  const [isWebcamFocused, setIsWebcamFocused] = useState(false);
  const webcamExpanded = isWebcamHovered || isWebcamFocused;
  const [trayLayout, setTrayLayout] = useState<TrayLayout>(() => {
    const saved = loadUserPreferences().trayLayout as string | undefined;
    // Migrate the old orientation-only setting to its nearest screen edge.
    if (saved === "horizontal") return "bottom";
    if (saved === "vertical") return "left";
    return saved === "top" || saved === "right" || saved === "left" || saved === "bottom"
      ? saved
      : "bottom";
  });
  const isVertical = trayLayout === "left" || trayLayout === "right";

  const [isPositionPickerOpen, setIsPositionPickerOpen] = useState(false);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const closeAfterDiscardRef = useRef(false);
  const [supportsCursorModeToggle, setSupportsCursorModeToggle] = useState(false);
  const hudBarRef = useRef<HTMLDivElement | null>(null);
  const deviceSelectorRef = useRef<HTMLDivElement | null>(null);
  // Measured bar height, anchors the popups beside the tall vertical tray so they don't overlap it.
  const [hudBarHeight, setHudBarHeight] = useState(0);

  const {
    devices: micDevices,
    selectedDeviceId: selectedMicId,
    setSelectedDeviceId: setSelectedMicId,
  } = useMicrophoneDevices(microphoneEnabled);
  const {
    devices: cameraDevices,
    selectedDeviceId: selectedCameraId,
    setSelectedDeviceId: setSelectedCameraId,
    isLoading: isCameraDevicesLoading,
    error: cameraDevicesError,
  } = useCameraDevices(webcamEnabled);

  const selectedMicLabel =
    micDevices.find((d) => d.deviceId === (microphoneDeviceId || selectedMicId))?.label ||
    t("audio.defaultMicrophone");
  const selectedCameraDevice = cameraDevices.find(
    (d) => d.deviceId === (webcamDeviceId || selectedCameraId),
  );
  const selectedCameraLabel = isCameraDevicesLoading
    ? t("webcam.searching")
    : cameraDevicesError
      ? t("webcam.unavailable")
      : cameraDevices.length === 0
        ? t("webcam.noneFound")
        : selectedCameraDevice?.label || t("webcam.defaultCamera");

  const { level } = useAudioLevelMeter({
    enabled: showMicControls,
    deviceId: microphoneDeviceId,
  });

  useEffect(() => {
    if (selectedMicId && selectedMicId !== "default") {
      setMicrophoneDeviceId(selectedMicId);
      setMicrophoneDeviceName(micDevices.find((d) => d.deviceId === selectedMicId)?.label);
    }
  }, [selectedMicId, micDevices, setMicrophoneDeviceId, setMicrophoneDeviceName]);

  useEffect(() => {
    if (selectedCameraId) {
      setWebcamDeviceId(selectedCameraId);
      setWebcamDeviceName(cameraDevices.find((d) => d.deviceId === selectedCameraId)?.label);
    }
  }, [selectedCameraId, cameraDevices, setWebcamDeviceId, setWebcamDeviceName]);

  useEffect(() => {
    let cancelled = false;
    nativeBridgeClient.system
      .getPlatform()
      .then((platform) => {
        if (!cancelled) {
          setSupportsCursorModeToggle(platform === "win32" || platform === "darwin");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSupportsCursorModeToggle(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    void requestCameraAccess().catch((error) => {
      console.warn("Failed to trigger camera access request during development:", error);
    });
  }, []);

  // Position picker: close on outside click / Escape.
  useEffect(() => {
    if (!isPositionPickerOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!hudBarRef.current?.contains(event.target as Node)) {
        setIsPositionPickerOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPositionPickerOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isPositionPickerOpen]);

  // Resize the overlay window to fit content, else the taller vertical tray gets clipped
  // and scrolls. Measure from the window's bottom-centre (the anchor the main process
  // preserves) so fixed bottom/centre offsets keep this stable and it doesn't oscillate.
  const lastHudSizeRef = useRef({ width: 0, height: 0, layout: "" });
  const hudSizeRequestRef = useRef(0);
  const hudNativeUpdateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistHudPositionRef = useRef(false);
  const measureHudSize = useCallback(
    (layoutOverride: TrayLayout = trayLayout, pickerOpenOverride = isPositionPickerOpen) => {
    const barEl = hudBarRef.current;
    if (!barEl || !window.electronAPI?.setHudOverlaySize) return;
    const verticalLayout = layoutOverride === "left" || layoutOverride === "right";

    // Breathing room so the drop shadow isn't clipped.
    const SIDE_MARGIN = 24;
    const TOP_MARGIN = 24;
    // Match the native overlay's minimum width so collapsed docks stay compact.
    const MIN_WIDTH = 80;
    // Keep the native transparent window large enough for the screen-shaped
    // position picker, including its soft edge shadow, while it is open.
    const POSITION_MENU_WIDTH = 224;
    const POSITION_MENU_HEIGHT = 168;
    const POSITION_MENU_GAP = 8;

    let topFromBottom = 20 + barEl.scrollHeight;

    // Popovers are absolutely positioned, so ResizeObserver does not include them in
    // the bar's measured bounds. Reserve space in the native overlay in every dock
    // direction or the transparent window clips the position menu at screen edges.
    if (pickerOpenOverride && !verticalLayout) {
      topFromBottom += POSITION_MENU_HEIGHT + POSITION_MENU_GAP * 2;
    }

    if (deviceSelectorRef.current) {
      const popupHeight = deviceSelectorRef.current.scrollHeight;
      if (popupHeight > 0) {
        const popupBottomOffset = verticalLayout
          ? barEl.scrollHeight + HUD_DEVICE_POPUP_GAP
          : HUD_DEVICE_POPUP_HORIZONTAL_BOTTOM;
        topFromBottom = Math.max(topFromBottom, popupBottomOffset + popupHeight);
      }
    }

    let halfWidth = barEl.scrollWidth / 2;

    if (pickerOpenOverride) {
      // The picker is centered above/below horizontal docks and sits beside
      // vertical docks. Reserve enough width for both placements.
      halfWidth = Math.max(
        halfWidth,
        verticalLayout
          ? POSITION_MENU_WIDTH / 2 + POSITION_MENU_GAP + 48
          : POSITION_MENU_WIDTH / 2,
      );
    }

    if (deviceSelectorRef.current) {
      const popupWidth = deviceSelectorRef.current.scrollWidth;
      halfWidth = Math.max(halfWidth, popupWidth / 2);
    }

    setHudBarHeight((prev) => {
      const next = Math.round(barEl.scrollHeight);
      return Math.abs(prev - next) > 1 ? next : prev;
    });

    const width = Math.max(MIN_WIDTH, Math.ceil(halfWidth * 2) + SIDE_MARGIN);
    const height = Math.ceil(topFromBottom) + TOP_MARGIN;
    if (
      width === lastHudSizeRef.current.width &&
      height === lastHudSizeRef.current.height &&
      layoutOverride === lastHudSizeRef.current.layout
    ) {
      return;
    }
    const requestId = ++hudSizeRequestRef.current;
    hudNativeUpdateQueueRef.current = hudNativeUpdateQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        // A previous resize can still be in flight when React changes orientation.
        // Drop stale measurements before they reach the native window, then apply
        // the latest requested edge in order.
        if (requestId !== hudSizeRequestRef.current) return;
        try {
          // The saved edge is the source of truth at startup. The Rust shell may
          // have a stale physical coordinate from an older/manual placement; keep
          // the visible toolbar aligned with the selected edge in the picker.
          const preservePosition = false;
          const result = await window.electronAPI!.setHudOverlaySize(
            width,
            height,
            layoutOverride,
            preservePosition,
          );
          if (requestId !== hudSizeRequestRef.current) return;
          if (result?.success === false) {
            lastHudSizeRef.current = { width: 0, height: 0, layout: "" };
            console.warn("Could not reposition recording controls:", result.message ?? result.error);
            return;
          }
          lastHudSizeRef.current = { width, height, layout: layoutOverride };
          if (persistHudPositionRef.current) {
            persistHudPositionRef.current = false;
            await window.electronAPI?.persistHudOverlayPlacement?.();
          }
        } catch (error) {
          if (requestId !== hudSizeRequestRef.current) return;
          lastHudSizeRef.current = { width: 0, height: 0, layout: "" };
          persistHudPositionRef.current = false;
          console.warn("Could not resize recording controls:", error);
        }
      });
    },
    [trayLayout, isPositionPickerOpen],
  );

  // One persistent observer; elements wire themselves up via callback refs as they
  // mount/unmount so measurement re-runs without recreating it or threading mount state through deps.
  const hudResizeObserverRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(() => measureHudSize());
    hudResizeObserverRef.current = observer;
    if (hudBarRef.current) observer.observe(hudBarRef.current);
    if (deviceSelectorRef.current) observer.observe(deviceSelectorRef.current);
    measureHudSize();
    return () => {
      observer.disconnect();
      hudResizeObserverRef.current = null;
    };
  }, [measureHudSize]);

  const observeHudElement = useCallback(
    <T extends HTMLElement>(el: T | null, ref: React.MutableRefObject<T | null>) => {
      const observer = hudResizeObserverRef.current;
      if (ref.current && observer) observer.unobserve(ref.current);
      ref.current = el;
      if (el && observer) observer.observe(el);
      measureHudSize();
    },
    [measureHudSize],
  );
  const setHudBarEl = useCallback(
    (el: HTMLDivElement | null) => observeHudElement(el, hudBarRef),
    [observeHudElement],
  );
  const setDeviceSelectorEl = useCallback(
    (el: HTMLDivElement | null) => observeHudElement(el, deviceSelectorRef),
    [observeHudElement],
  );

  const hudMouseEventsEnabledRef = useRef<boolean | undefined>(undefined);
  const setHudMouseEventsEnabled = useCallback((_enabled: boolean) => {
    // A click-through transparent window cannot receive the pointer event that
    // would turn click-through back off. Keep the compact toolbar surface hit-testable
    // so its controls remain usable after the pointer leaves it.
    if (hudMouseEventsEnabledRef.current === true) {
      return;
    }
    hudMouseEventsEnabledRef.current = true;
    window.electronAPI?.setHudOverlayIgnoreMouseEvents?.(false);
  }, []);

  useEffect(() => {
    setHudMouseEventsEnabled(true);
    return () => {
      window.electronAPI?.setHudOverlayIgnoreMouseEvents?.(false);
    };
  }, [setHudMouseEventsEnabled]);

  // Keep the overlay clickable while a modal surface is open.
  useEffect(() => {
    setHudMouseEventsEnabled(confirmRetake || confirmClose);
  }, [confirmRetake, confirmClose, setHudMouseEventsEnabled]);

  const [selectedSource, setSelectedSource] = useState({
    name: "Choose screen",
    kind: "display" as "display" | "window" | "region",
  });

  useEffect(() => {
    const checkSelectedSource = async () => {
      if (window.electronAPI) {
        const source = await window.electronAPI.getSelectedSource();
        if (source) {
          setSelectedSource({
            name: source.name || (source.id?.startsWith("window:") ? "Window" : "Display"),
            kind: source.type === "region"
              ? "region"
              : source.id?.startsWith("window:")
                ? "window"
                : "display",
          });
        } else {
          setSelectedSource({ name: "Choose screen", kind: "display" });
        }
      }
    };

    checkSelectedSource();

    const interval = setInterval(checkSelectedSource, 500);
    return () => clearInterval(interval);
  }, []);

  const openSourceSelector = async () => {
    if (window.electronAPI) {
      const result = await openSourceSelectorWithPermissionRetry({
        openSourceSelector: () => window.electronAPI.openSourceSelector(),
        requestScreenAccess: () => window.electronAPI.requestScreenAccess(),
      });
      if (!result.opened) {
        toast.error(result.reason || "Could not open capture source selection. Try again.");
      }
    }
  };

  const sendHudOverlayHide = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayHide) {
      window.electronAPI.hudOverlayHide();
    }
  };
  const sendHudOverlayClose = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayClose) {
      window.electronAPI.hudOverlayClose();
    }
  };
  const handleCloseSave = () => {
    setConfirmClose(false);
    // A take that is already finalizing will open in the editor when its save
    // completes. During countdown there is not a take to save yet.
    if (!finalizing && countdownValue === null) {
      void toggleRecording();
    }
  };
  const handleCloseDiscard = () => {
    if (finalizing) return;
    closeAfterDiscardRef.current = true;
    setConfirmClose(false);
    cancelRecording();
  };

  useEffect(() => {
    if (!closeAfterDiscardRef.current) return;
    if (!recording && !finalizing && countdownValue === null) {
      closeAfterDiscardRef.current = false;
      sendHudOverlayClose();
    } else if (recording && !finalizing) {
      // Discard finalization failed and left the take active; don't close on a
      // later stop that the user starts intentionally.
      closeAfterDiscardRef.current = false;
    }
  }, [recording, finalizing, countdownValue]);
  /** Selects a specific screen edge and immediately remeasures the native HUD. */
  const setTrayPosition = (position: TrayLayout) => {
    setTrayLayout(position);
    saveUserPreferences({ trayLayout: position });
    setIsPositionPickerOpen(false);
    persistHudPositionRef.current = true;
    // Let the dock's flex direction and dimensions commit before measuring. This
    // explicitly calls the native positioning command, even if ResizeObserver
    // does not report a size change for a different edge.
    requestAnimationFrame(() => measureHudSize(position, false));
  };

  const toggleMicrophone = () => {
    setMicrophoneEnabled(!microphoneEnabled);
  };
  const dragLastPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pendingDragDeltaRef = useRef({ x: 0, y: 0 });
  const dragFrameRef = useRef<number | null>(null);
  const dragMoveInFlightRef = useRef(false);
  const persistAfterDragRef = useRef(false);
  const flushDragMovementRef = useRef<() => void>(() => {});
  const scheduleDragMovement = () => {
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = requestAnimationFrame(() => flushDragMovementRef.current());
  };
  flushDragMovementRef.current = () => {
    dragFrameRef.current = null;
    if (dragMoveInFlightRef.current) return;

    const { x, y } = pendingDragDeltaRef.current;
    pendingDragDeltaRef.current = { x: 0, y: 0 };
    if (x || y) {
      dragMoveInFlightRef.current = true;
      Promise.resolve(window.electronAPI?.moveHudOverlayBy?.(x, y))
        .catch((error) => console.warn("Could not move recording controls:", error))
        .finally(() => {
          dragMoveInFlightRef.current = false;
          if (pendingDragDeltaRef.current.x || pendingDragDeltaRef.current.y) {
            scheduleDragMovement();
          } else if (persistAfterDragRef.current) {
            persistAfterDragRef.current = false;
            void window.electronAPI?.persistHudOverlayPlacement?.();
          }
        });
      return;
    }

    if (persistAfterDragRef.current) {
      persistAfterDragRef.current = false;
      void window.electronAPI?.persistHudOverlayPlacement?.();
    }
  };
  const handleHudDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHudMouseEventsEnabled(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    pendingDragDeltaRef.current = { x: 0, y: 0 };
    persistAfterDragRef.current = false;
    dragLastPositionRef.current = { x: event.screenX, y: event.screenY };
  };
  const handleHudDragPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const lastPosition = dragLastPositionRef.current;
    if (!lastPosition) return;
    const deltaX = event.screenX - lastPosition.x;
    const deltaY = event.screenY - lastPosition.y;
    dragLastPositionRef.current = { x: event.screenX, y: event.screenY };
    pendingDragDeltaRef.current.x += deltaX;
    pendingDragDeltaRef.current.y += deltaY;
    scheduleDragMovement();
  };
  const handleHudDragPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragLastPositionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persistAfterDragRef.current = true;
    if (pendingDragDeltaRef.current.x || pendingDragDeltaRef.current.y) {
      scheduleDragMovement();
    } else if (!dragMoveInFlightRef.current) {
      flushDragMovementRef.current();
    }
    if (!confirmRetake) {
      setHudMouseEventsEnabled(false);
    }
  };

  const releaseMouseIfIdle = () => {
    if (!confirmRetake) {
      setHudMouseEventsEnabled(false);
    }
  };

  // Device popup placement depends on which edge the bar is docked to.
  const devicePopupStyle: React.CSSProperties =
    trayLayout === "top"
      ? { top: hudBarHeight + HUD_DEVICE_POPUP_GAP }
      : isVertical
        ? { bottom: hudBarHeight + HUD_DEVICE_POPUP_GAP }
        : { bottom: HUD_DEVICE_POPUP_HORIZONTAL_BOTTOM };

  const barPositionStyle: React.CSSProperties =
    trayLayout === "top"
      ? { top: 20, left: "50%", bottom: "auto", right: "auto", transform: "translateX(-50%)" }
      : trayLayout === "left"
        ? { left: 20, top: "50%", bottom: "auto", right: "auto", transform: "translateY(-50%)" }
        : trayLayout === "right"
          ? { right: 20, left: "auto", top: "50%", bottom: "auto", transform: "translateY(-50%)" }
          : { bottom: 20, left: "50%", top: "auto", right: "auto", transform: "translateX(-50%)" };

  const positionMenuStyle: React.CSSProperties =
    trayLayout === "top"
      ? { left: "50%", top: "calc(100% + 8px)", transform: "translateX(-50%)" }
      : trayLayout === "left"
        ? { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" }
        : trayLayout === "right"
          ? { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" }
          : { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" };

  return (
    // Avoid w-screen/h-screen: 100vw can exceed the inner layout width when scrollbars
    // affect the viewport (Windows), causing a horizontal scrollbar (issue #305).
    <div
      className={`studio-recorder h-full w-full min-w-0 max-w-full overflow-x-hidden overflow-y-hidden bg-transparent ${styles.electronDrag}`}
      onPointerMove={(event) => {
        const target = event.target as HTMLElement | null;
        const shouldCapture =
          confirmRetake || confirmClose ||
          Boolean(target?.closest("[data-hud-interactive='true']"));
        setHudMouseEventsEnabled(shouldCapture);
      }}
      onPointerLeave={releaseMouseIfIdle}
    >
      {/* Device selectors, fixed beside the HUD bar, viewport-relative, never clipped */}
      {(showMicControls || showWebcamControls) && (
        <div
          ref={setDeviceSelectorEl}
          data-hud-interactive="true"
          style={devicePopupStyle}
          className={`fixed left-1/2 -translate-x-1/2 flex items-center gap-2 animate-mic-panel-in ${styles.electronNoDrag}`}
        >
          {/* Mic selector */}
          {showMicControls && (
            <div
              className={`flex h-9 items-center gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0c10]/90 px-3 py-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-all duration-300 ${!micExpanded ? "opacity-60 grayscale-[0.5]" : "opacity-100"}`}
              onMouseEnter={() => setIsMicHovered(true)}
              onMouseLeave={() => setIsMicHovered(false)}
              onFocus={() => setIsMicFocused(true)}
              onBlur={() => setIsMicFocused(false)}
              style={{ width: micExpanded ? "240px" : "140px", transition: "width 300ms ease" }}
            >
              <div className="relative flex-1 min-w-0">
                {!micExpanded && (
                  <div className="text-white/60 text-[10px] font-medium truncate">
                    {selectedMicLabel}
                  </div>
                )}
                <select
                  value={microphoneDeviceId || selectedMicId}
                  disabled={recordingUiActive}
                  onChange={(e) => {
                    const selectedDevice = micDevices.find((d) => d.deviceId === e.target.value);
                    setSelectedMicId(e.target.value);
                    setMicrophoneDeviceId(e.target.value);
                    setMicrophoneDeviceName(selectedDevice?.label);
                  }}
                  className={`w-full appearance-none bg-white/5 text-white text-[11px] rounded-lg pl-2 pr-6 py-1 border border-white/10 outline-none hover:bg-white/10 transition-colors cursor-pointer ${!micExpanded ? "sr-only" : ""}`}
                >
                  {micDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId} className="bg-[#1c1c24]">
                      {device.label}
                    </option>
                  ))}
                </select>
                {micExpanded && (
                  <ChevronDown
                    size={12}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
                  />
                )}
              </div>
              <AudioLevelMeter
                level={level}
                className={`${micExpanded ? "w-16" : "w-8"} h-2 transition-all duration-300`}
              />
            </div>
          )}

          {/* Webcam selector */}
          {showWebcamControls && (
            <div
              className={`flex h-9 items-center gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0c10]/90 px-3 py-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition-all duration-300 ${!webcamExpanded ? "opacity-60 grayscale-[0.5]" : "opacity-100"}`}
              onMouseEnter={() => setIsWebcamHovered(true)}
              onMouseLeave={() => setIsWebcamHovered(false)}
              onFocus={() => setIsWebcamFocused(true)}
              onBlur={() => setIsWebcamFocused(false)}
              style={{ width: webcamExpanded ? "240px" : "140px", transition: "width 300ms ease" }}
            >
              <div className="relative flex-1 min-w-0">
                {!webcamExpanded && (
                  <div className="text-white/60 text-[10px] font-medium truncate">
                    {selectedCameraLabel}
                  </div>
                )}
                {webcamExpanded &&
                  (isCameraDevicesLoading ? (
                    <span className="text-white/40 text-[10px] italic">
                      {t("webcam.searching")}
                    </span>
                  ) : cameraDevicesError ? (
                    <span className="text-white/40 text-[10px] italic">
                      {t("webcam.unavailable")}
                    </span>
                  ) : cameraDevices.length === 0 ? (
                    <span className="text-white/40 text-[10px] italic">
                      {t("webcam.noneFound")}
                    </span>
                  ) : (
                    <>
                      <select
                        value={webcamDeviceId || selectedCameraId}
                        disabled={recordingUiActive}
                        onChange={(e) => {
                          const device = cameraDevices.find(
                            (item) => item.deviceId === e.target.value,
                          );
                          setSelectedCameraId(e.target.value);
                          setWebcamDeviceId(e.target.value);
                          setWebcamDeviceName(device?.label);
                        }}
                        className="w-full appearance-none bg-white/5 text-white text-[11px] rounded-lg pl-2 pr-6 py-1 border border-white/10 outline-none hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        {cameraDevices.map((device) => (
                          <option
                            key={device.deviceId}
                            value={device.deviceId}
                            className="bg-[#1c1c24]"
                          >
                            {device.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
                      />
                    </>
                  ))}
                {(!webcamExpanded || cameraDevices.length === 0) && (
                  <select
                    value={webcamDeviceId || selectedCameraId}
                    disabled={recordingUiActive}
                    onChange={(e) => {
                      const device = cameraDevices.find((item) => item.deviceId === e.target.value);
                      setSelectedCameraId(e.target.value);
                      setWebcamDeviceId(e.target.value);
                      setWebcamDeviceName(device?.label);
                    }}
                    className="sr-only"
                  >
                    {cameraDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={confirmRetake} onOpenChange={setConfirmRetake}>
        <DialogContent className="border border-white/10 bg-[#111] text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keep this recording?</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-zinc-400">
            Save it and open the editor, or discard it and record again.
          </DialogDescription>
          <div className="mt-5 grid gap-2">
            <Button
              onClick={() => {
                setConfirmRetake(false);
                void toggleRecording();
              }}
            >
              Save recording &amp; edit
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRetake(false);
                cancelRecording();
              }}
            >
              Discard &amp; record again
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRetake(false)}>
              Keep recording
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent className="border border-white/10 bg-[#111] text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Close foOom?</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-zinc-400">
            {finalizing
              ? "Your recording is being saved. Let it finish to open it in the editor."
              : countdownValue !== null
                ? "The recording countdown is running. You can cancel it and close foOom."
                : "Save this take in the editor, or discard it before closing foOom."}
          </DialogDescription>
          <div className="mt-5 grid gap-2">
            <Button
              onClick={handleCloseSave}
              disabled={countdownValue !== null}
              aria-label="Save recording and open editor"
            >
              {finalizing ? "Continue saving & open editor" : "Save recording & open editor"}
            </Button>
            <Button
              variant="destructive"
              onClick={handleCloseDiscard}
              disabled={finalizing}
              aria-label="Discard recording and close foOom"
            >
              {finalizing ? "Discard unavailable while saving" : "Discard recording & close app"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmClose(false)}
              aria-label="Keep recording controls open"
            >
              Keep recording controls
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recorder dock can be positioned on any screen edge. */}
      <div
        ref={setHudBarEl}
        data-hud-interactive="true"
        data-tray-layout={trayLayout}
        style={barPositionStyle}
        className={`fixed flex rounded-full border border-white/[0.10] bg-[#07080a]/90 shadow-[0_20px_60px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl backdrop-saturate-[140%] ${
          isVertical
            ? `max-h-[calc(100vh-3rem)] flex-col items-center gap-1 px-1 py-1.5 ${
                isPositionPickerOpen ? "" : "overflow-y-auto"
              }`
            : "items-center gap-1.5 px-2 py-1.5"
        }`}
        onPointerEnter={() => setHudMouseEventsEnabled(true)}
        onPointerDown={() => setHudMouseEventsEnabled(true)}
        onMouseEnter={() => setHudMouseEventsEnabled(true)}
        onMouseLeave={releaseMouseIfIdle}
      >
        {/* Drag handle */}
        <div
          className={`flex ${isVertical ? "h-6 w-8" : "h-8 w-7"} cursor-grab items-center justify-center active:cursor-grabbing ${styles.electronNoDrag}`}
          onPointerDown={handleHudDragPointerDown}
          onPointerMove={handleHudDragPointerMove}
          onPointerUp={handleHudDragPointerEnd}
          onPointerCancel={handleHudDragPointerEnd}
        >
          {getIcon("drag", "text-white/30")}
        </div>

        <div className={`relative ${styles.electronNoDrag}`}>
          <Tooltip content="Toolbar position">
            <button
              data-testid="launch-tray-layout-button"
              type="button"
              aria-label="Choose toolbar position"
              aria-expanded={isPositionPickerOpen}
              aria-haspopup="menu"
              className={`${hudIconBtnClasses} ${isPositionPickerOpen ? "bg-white/15 text-white" : "text-white/60"} ${styles.electronNoDrag}`}
              onClick={() => setIsPositionPickerOpen((open) => !open)}
            >
              {trayLayout === "top" ? (
                <ArrowUp size={ICON_SIZE - 2} />
              ) : trayLayout === "left" ? (
                <ArrowLeft size={ICON_SIZE - 2} />
              ) : trayLayout === "right" ? (
                <ArrowRight size={ICON_SIZE - 2} />
              ) : (
                <ArrowDown size={ICON_SIZE - 2} />
              )}
            </button>
          </Tooltip>
          {isPositionPickerOpen && (
            <div
              role="menu"
              aria-label="Toolbar position"
              style={positionMenuStyle}
              className="absolute z-[80] h-[168px] w-[224px] rounded-[26px] border border-white/10 bg-[#111318]/95 p-2 shadow-[0_12px_40px_rgba(0,0,0,.55)] backdrop-blur-xl"
            >
              <div
                className="absolute inset-[9px] rounded-[21px] border border-white/35 bg-white/[.015]"
                aria-hidden="true"
              />
              {(
                [
                  [
                    "top",
                    "Top",
                    { left: "50%", top: 12, width: 88, height: 18, transform: "translateX(-50%)" },
                  ],
                  [
                    "left",
                    "Left",
                    { left: 12, top: "50%", width: 18, height: 56, transform: "translateY(-50%)" },
                  ],
                  [
                    "right",
                    "Right",
                    { right: 12, top: "50%", width: 18, height: 56, transform: "translateY(-50%)" },
                  ],
                  [
                    "bottom",
                    "Bottom",
                    { left: "50%", bottom: 12, width: 88, height: 18, transform: "translateX(-50%)" },
                  ],
                ] as const
              ).map(([position, label, placement]) => (
                <button
                  key={position}
                  type="button"
                  role="menuitemradio"
                  aria-checked={trayLayout === position}
                  aria-label={`Dock toolbar ${label.toLowerCase()}`}
                  title={`${label} edge`}
                  data-testid={`launch-tray-position-${position}`}
                  style={placement}
                  onClick={() => setTrayPosition(position)}
                  className={`absolute z-10 rounded-full border transition-[background,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80 ${
                    trayLayout === position
                      ? "border-violet-300 bg-violet-300/25 shadow-[0_0_0_2px_rgba(196,181,253,.2),0_0_16px_rgba(167,139,250,.3)]"
                      : "border-white/40 bg-[#15161a] hover:border-white/80 hover:bg-white/10"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Keep docking available while recording so users can move the compact HUD. */}
        {!recordingUiActive && (
          <>
        {/* Source selector */}
        <button
          data-testid="launch-source-selector-button"
          disabled={recordingUiActive}
          className={`${hudGroupClasses} h-8 ${isVertical ? "w-8 justify-center px-0" : "px-2.5"} ${styles.electronNoDrag}`}
          onClick={openSourceSelector}
          title={selectedSource.name}
          aria-label={`Choose capture source, ${selectedSource.name}`}
        >
          {selectedSource.kind === "window" ? (
            <AppWindow size={ICON_SIZE} className="text-white/80" />
          ) : (
            <Monitor size={ICON_SIZE} className="text-white/80" />
          )}
          <span
            className={`${isVertical ? "sr-only" : "max-w-[86px]"} truncate text-[11px] font-medium text-white/75`}
          >
            {selectedSource.name}
          </span>
        </button>

        {/* Audio controls group */}
        <div className={`${hudGroupClasses} ${isVertical ? "flex-col py-1" : ""} ${styles.electronNoDrag}`}>
          <button
            data-testid="launch-system-audio-button"
            disabled={recordingUiActive}
            className={`${hudIconBtnClasses} disabled:cursor-not-allowed disabled:opacity-40 ${systemAudioEnabled ? "drop-shadow-[0_0_8px_rgba(255,255,255,0.45)]" : ""}`}
            onClick={() => setSystemAudioEnabled(!systemAudioEnabled)}
            aria-label={systemAudioEnabled ? t("audio.disableSystemAudio") : t("audio.enableSystemAudio")}
            title={
              systemAudioEnabled ? t("audio.disableSystemAudio") : t("audio.enableSystemAudio")
            }
          >
            {systemAudioEnabled
              ? getIcon("volumeOn", "text-white")
              : getIcon("volumeOff", "text-white/40")}
          </button>
          <button
            data-testid="launch-microphone-button"
            disabled={recordingUiActive}
            className={`${hudIconBtnClasses} disabled:cursor-not-allowed disabled:opacity-40 ${microphoneEnabled ? "drop-shadow-[0_0_8px_rgba(255,255,255,0.45)]" : ""}`}
            onClick={toggleMicrophone}
            aria-label={microphoneEnabled ? t("audio.disableMicrophone") : t("audio.enableMicrophone")}
            title={microphoneEnabled ? t("audio.disableMicrophone") : t("audio.enableMicrophone")}
          >
            {microphoneEnabled
              ? getIcon("micOn", "text-white")
              : getIcon("micOff", "text-white/40")}
          </button>
          <button
            data-testid="launch-webcam-button"
            disabled={recordingUiActive}
            className={`${hudIconBtnClasses} disabled:cursor-not-allowed disabled:opacity-40 ${webcamEnabled ? "drop-shadow-[0_0_8px_rgba(255,255,255,0.45)]" : ""}`}
            aria-label={webcamEnabled ? t("webcam.disableWebcam") : t("webcam.enableWebcam")}
            onClick={async () => {
              await setWebcamEnabled(!webcamEnabled);
            }}
            title={webcamEnabled ? t("webcam.disableWebcam") : t("webcam.enableWebcam")}
          >
            {webcamEnabled
              ? getIcon("webcamOn", "text-white")
              : getIcon("webcamOff", "text-white/40")}
          </button>
          {supportsCursorModeToggle && (
            <button
              data-testid="launch-cursor-mode-button"
              disabled={recordingUiActive}
              className={`${hudIconBtnClasses} disabled:cursor-not-allowed disabled:opacity-40 ${
                cursorCaptureMode === "editable-overlay"
                  ? "drop-shadow-[0_0_8px_rgba(255,255,255,0.45)]"
                  : ""
              }`}
              aria-label={
                cursorCaptureMode === "editable-overlay"
                  ? t("cursor.useSystemCursor")
                  : t("cursor.useEditableCursor")
              }
              onClick={() =>
                setCursorCaptureMode(
                  cursorCaptureMode === "editable-overlay" ? "system" : "editable-overlay",
                )
              }
              title={
                cursorCaptureMode === "editable-overlay"
                  ? t("cursor.useSystemCursor")
                  : t("cursor.useEditableCursor")
              }
            >
              {getIcon(
                "cursor",
                cursorCaptureMode === "editable-overlay" ? "text-white" : "text-white/40",
              )}
            </button>
          )}
        </div>
          </>
        )}

        {/* Record/Stop group */}
        <button
          data-testid="launch-record-button"
          data-recording={recordingUiActive}
          aria-label={countdownValue !== null ? `Recording starts in ${countdownValue}` : finalizing ? "Saving recording" : recording ? "Stop recording and open editor" : "Start recording"}
          title={countdownValue !== null ? `Recording starts in ${countdownValue}` : finalizing ? "Saving recording" : recording ? "Stop recording and open editor" : "Start recording"}
          disabled={finalizing}
          className={`${styles.recordControl} flex items-center justify-center rounded-full transition-[min-width,background-color] duration-150 ${
            recordingUiActive
              ? isVertical
                ? "h-[52px] w-[52px] min-w-[52px] flex-col gap-0 px-1 py-1"
                : "h-9 min-w-[78px] gap-1.5 px-2 py-1"
              : "h-9 min-w-[36px] p-2"
          } ${styles.electronNoDrag} ${
            recordingUiActive
              ? paused
                ? "bg-white/10 hover:bg-white/15 border border-white/20"
                : "bg-white/20 hover:bg-white/25 border border-white/30 shadow-[0_0_12px_rgba(255,255,255,0.25)]"
              : "bg-white/[0.06] hover:bg-white/[0.10] border border-white/10"
          }`}
          onClick={toggleRecording}
          style={{ flex: "0 0 auto" }}
        >
          <div
            className={`flex items-center justify-center ${
              recordingUiActive ? (isVertical ? "flex-col gap-0.5" : "gap-1.5") : ""
            }`}
          >
            {countdownValue !== null ? (
              <span className="w-7 text-center text-white text-sm font-semibold tabular-nums">{countdownValue}</span>
            ) : recordingUiActive
              ? getIcon("stop", `text-white ${finalizing || paused ? "opacity-60" : "animate-pulse"}`)
              : getIcon("record", "text-white/80")}
            {recordingUiActive && countdownValue === null && (
              <span
                className={`${paused ? "text-white/60" : "text-white"} inline-block text-center font-semibold tabular-nums ${
                  isVertical ? "w-auto text-[10px] leading-none" : "w-[34px] text-left text-xs"
                }`}
              >
                {finalizing ? "Saving" : formatTimePadded(elapsedSeconds)}
              </span>
            )}
          </div>
        </button>

        {recordingUiActive && (
          <div
            className={`flex items-center gap-0.5 ${isVertical ? "flex-col" : ""} ${styles.electronNoDrag}`}
          >
            {(canPauseRecording || finalizing) && (
              <Tooltip
                content={paused ? t("tooltips.resumeRecording") : t("tooltips.pauseRecording")}
              >
                <button
                  className={hudAuxIconBtnClasses}
                  onClick={togglePaused}
                  disabled={finalizing}
                  aria-label={paused ? t("tooltips.resumeRecording") : t("tooltips.pauseRecording")}
                >
                  {getIcon(
                    paused ? "resume" : "pause",
                    paused
                      ? "text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]"
                      : "text-white/60",
                  )}
                </button>
              </Tooltip>
            )}
            <Tooltip content={t("tooltips.restartRecording")}>
              <button
                className={hudAuxIconBtnClasses}
                aria-label={t("tooltips.restartRecording")}
                onClick={restartRecording}
                disabled={finalizing}
              >
                {getIcon("restart", "text-white/60")}
              </button>
            </Tooltip>
            <Tooltip content={t("tooltips.cancelRecording")}>
              <button
                className={hudAuxIconBtnClasses}
                aria-label="Finish or discard this recording"
                onClick={() => setConfirmRetake(true)}
                disabled={finalizing}
              >
                {getIcon("cancel", "text-red-400")}
              </button>
            </Tooltip>
          </div>
        )}

        {!recordingUiActive && (
          <Tooltip content={t("tooltips.openStudio")}>
            <button
              data-testid="launch-open-studio-button"
              className={`${hudIconBtnClasses} ${styles.electronNoDrag}`}
              aria-label="Open editor"
              title={t("tooltips.openStudio") || "Open editor"}
              onClick={() => window.electronAPI.switchToEditor()}
            >
              <Clapperboard size={ICON_SIZE} className="text-white/60" />
            </button>
          </Tooltip>
        )}

        {/* Window controls remain available; recording mode keeps only essential actions. */}
        <div className={`flex items-center gap-0.5 ${isVertical ? "flex-col border-t border-white/10 pt-1.5" : "ml-0.5 border-l border-white/10 pl-1.5"} ${styles.electronNoDrag}`}>
            <button
              className={windowBtnClasses}
              disabled={recordingUiActive}
              title={t("tooltips.hideHUD")}
              aria-label={recordingUiActive ? "Hide recording controls (unavailable while recording)" : t("tooltips.hideHUD")}
              onClick={sendHudOverlayHide}
            >
              {getIcon("minimize", "text-white")}
            </button>
            <button
              className={windowBtnClasses}
              title={t("tooltips.closeApp")}
              aria-label={recordingUiActive ? "Close foOom and choose what to do with this recording" : t("tooltips.closeApp")}
              onClick={() => {
                if (recordingUiActive) {
                  setConfirmClose(true);
                } else {
                  sendHudOverlayClose();
                }
              }}
            >
              {getIcon("close", "text-white")}
            </button>
        </div>
      </div>
    </div>
  );
}
