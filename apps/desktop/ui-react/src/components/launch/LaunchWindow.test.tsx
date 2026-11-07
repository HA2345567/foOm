// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip";
import { LaunchWindow } from "./LaunchWindow";

const mocks = vi.hoisted(() => ({
  recorder: {} as Record<string, unknown>,
  nativeSetHudSize: vi.fn(),
  nativePersistPlacement: vi.fn(),
  nativeMoveBy: vi.fn(),
  nativeSetIgnoreMouseEvents: vi.fn(),
  nativeGetSelectedSource: vi.fn(),
  nativeOpenSourceSelector: vi.fn(),
  nativeHideHud: vi.fn(),
  nativeCloseHud: vi.fn(),
  nativeSwitchToEditor: vi.fn(),
  nativeGetPlatform: vi.fn(),
  savePreferences: vi.fn(),
}));

vi.mock("@/contexts/I18nContext", () => ({
  useScopedT: () => (key: string) => key,
}));

vi.mock("@/lib/userPreferences", () => ({
  loadUserPreferences: () => ({}),
  saveUserPreferences: mocks.savePreferences,
}));

vi.mock("@/native", () => ({
  nativeBridgeClient: { system: { getPlatform: mocks.nativeGetPlatform } },
}));

vi.mock("../../hooks/useScreenRecorder", () => ({
  useScreenRecorder: () => mocks.recorder,
}));

vi.mock("../../hooks/useAudioLevelMeter", () => ({
  useAudioLevelMeter: () => ({ level: 0 }),
}));

vi.mock("../../hooks/useCameraDevices", () => ({
  useCameraDevices: () => ({
    devices: [],
    selectedDeviceId: "",
    setSelectedDeviceId: vi.fn(),
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../hooks/useMicrophoneDevices", () => ({
  useMicrophoneDevices: () => ({
    devices: [],
    selectedDeviceId: "default",
    setSelectedDeviceId: vi.fn(),
  }),
}));

vi.mock("../../lib/requestCameraAccess", () => ({
  requestCameraAccess: vi.fn().mockResolvedValue({ success: true, granted: true }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function makeRecorderState(overrides: Record<string, unknown> = {}) {
  return {
    recording: false,
    finalizing: false,
    paused: false,
    elapsedSeconds: 0,
    countdownValue: null,
    toggleRecording: vi.fn(),
    togglePaused: vi.fn(),
    canPauseRecording: true,
    restartRecording: vi.fn(),
    cancelRecording: vi.fn(),
    microphoneEnabled: false,
    setMicrophoneEnabled: vi.fn(),
    microphoneDeviceId: undefined,
    setMicrophoneDeviceId: vi.fn(),
    setMicrophoneDeviceName: vi.fn(),
    systemAudioEnabled: false,
    setSystemAudioEnabled: vi.fn(),
    webcamEnabled: false,
    setWebcamEnabled: vi.fn().mockResolvedValue(true),
    webcamDeviceId: undefined,
    setWebcamDeviceId: vi.fn(),
    setWebcamDeviceName: vi.fn(),
    cursorCaptureMode: "system",
    setCursorCaptureMode: vi.fn(),
    ...overrides,
  };
}

function installNativeBridge() {
  mocks.nativeSetHudSize.mockResolvedValue({ success: true });
  mocks.nativePersistPlacement.mockResolvedValue({ success: true });
  mocks.nativeMoveBy.mockResolvedValue({ success: true });
  mocks.nativeSetIgnoreMouseEvents.mockResolvedValue({ success: true });
  mocks.nativeGetSelectedSource.mockResolvedValue({
    id: "screen:1",
    name: "Display 1",
    type: "display",
  });
  mocks.nativeOpenSourceSelector.mockResolvedValue({ opened: true });
  mocks.nativeHideHud.mockResolvedValue({ success: true });
  mocks.nativeCloseHud.mockResolvedValue({ success: true });
  mocks.nativeSwitchToEditor.mockResolvedValue({ success: true });
  mocks.nativeGetPlatform.mockResolvedValue("win32");

  window.electronAPI = {
    ...window.electronAPI,
    setHudOverlaySize: mocks.nativeSetHudSize,
    persistHudOverlayPlacement: mocks.nativePersistPlacement,
    moveHudOverlayBy: mocks.nativeMoveBy,
    setHudOverlayIgnoreMouseEvents: mocks.nativeSetIgnoreMouseEvents,
    getSelectedSource: mocks.nativeGetSelectedSource,
    openSourceSelector: mocks.nativeOpenSourceSelector,
    requestScreenAccess: vi.fn().mockResolvedValue({ granted: true }),
    hudOverlayHide: mocks.nativeHideHud,
    hudOverlayClose: mocks.nativeCloseHud,
    switchToEditor: mocks.nativeSwitchToEditor,
  } as typeof window.electronAPI;
}

function renderToolbar() {
  return render(
    <TooltipProvider>
      <LaunchWindow />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recorder = makeRecorderState();
  installNativeBridge();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
});

describe("LaunchWindow controls", () => {
  it("maps each position choice to a native HUD size request", async () => {
    renderToolbar();

    for (const position of ["top", "left", "right", "bottom"] as const) {
      fireEvent.click(screen.getByRole("button", { name: "Choose toolbar position" }));
      fireEvent.click(screen.getByTestId(`launch-tray-position-${position}`));
      await waitFor(() => {
        expect(mocks.nativeSetHudSize.mock.calls.some((args) => args[2] === position)).toBe(true);
        expect(mocks.savePreferences).toHaveBeenLastCalledWith({ trayLayout: position });
      });
    }
    expect(mocks.savePreferences).toHaveBeenCalledTimes(4);
  });

  it("routes start and stop through the recorder and exposes pause/restart/cancel", () => {
    const recorder = makeRecorderState({ recording: true });
    mocks.recorder = recorder;
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "Stop recording and open editor" }));
    expect(recorder.toggleRecording).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "tooltips.pauseRecording" }));
    expect(recorder.togglePaused).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "tooltips.restartRecording" }));
    expect(recorder.restartRecording).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Finish or discard this recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard & record again" }));
    expect(recorder.cancelRecording).toHaveBeenCalledOnce();
  });

  it("starts recording, opens the source picker and opens the editor from idle", async () => {
    const recorder = makeRecorderState();
    mocks.recorder = recorder;
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(recorder.toggleRecording).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("launch-source-selector-button"));
    await waitFor(() => expect(mocks.nativeOpenSourceSelector).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
    expect(mocks.nativeSwitchToEditor).toHaveBeenCalledOnce();
  });

  it("wires the audio, microphone, webcam and cursor setup toggles while idle", async () => {
    const recorder = makeRecorderState();
    mocks.recorder = recorder;
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "audio.enableSystemAudio" }));
    fireEvent.click(screen.getByRole("button", { name: "audio.enableMicrophone" }));
    fireEvent.click(screen.getByRole("button", { name: "webcam.enableWebcam" }));
    fireEvent.click(await screen.findByRole("button", { name: "cursor.useEditableCursor" }));

    expect(recorder.setSystemAudioEnabled).toHaveBeenCalledWith(true);
    expect(recorder.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(recorder.setWebcamEnabled).toHaveBeenCalledWith(true);
    expect(recorder.setCursorCaptureMode).toHaveBeenCalledWith("editable-overlay");
  });

  it("hides the HUD while idle and closes immediately while idle", () => {
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "tooltips.hideHUD" }));
    expect(mocks.nativeHideHud).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "tooltips.closeApp" }));
    expect(mocks.nativeCloseHud).toHaveBeenCalledOnce();
  });

  it("disables hiding and prompts before closing an active recording", async () => {
    const recorder = makeRecorderState({ recording: true });
    mocks.recorder = recorder;
    const { rerender } = renderToolbar();

    expect(
      screen.getByRole("button", {
        name: "Hide recording controls (unavailable while recording)",
      }),
    ).toBeDisabled();
    expect(screen.queryByTestId("launch-system-audio-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("launch-microphone-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("launch-cursor-mode-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("launch-source-selector-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("launch-webcam-button")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close foOom and choose what to do with this recording",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Close foOom?" })).toBeInTheDocument();
    expect(mocks.nativeCloseHud).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard recording and close foOom" }));
    expect(recorder.cancelRecording).toHaveBeenCalledOnce();
    expect(mocks.nativeCloseHud).not.toHaveBeenCalled();

    mocks.recorder = makeRecorderState();
    rerender(
      <TooltipProvider>
        <LaunchWindow />
      </TooltipProvider>,
    );
    await waitFor(() => expect(mocks.nativeCloseHud).toHaveBeenCalledOnce());
  });

  it("saves an active take before opening the editor from the close prompt", async () => {
    const recorder = makeRecorderState({ recording: true });
    mocks.recorder = recorder;
    renderToolbar();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close foOom and choose what to do with this recording",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save recording and open editor" }));

    expect(recorder.toggleRecording).toHaveBeenCalledOnce();
    expect(mocks.nativeCloseHud).not.toHaveBeenCalled();
  });

  it("closes after discarding a countdown that has not started recording yet", async () => {
    const recorder = makeRecorderState({ countdownValue: 3 });
    mocks.recorder = recorder;
    const { rerender } = renderToolbar();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close foOom and choose what to do with this recording",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard recording and close foOom" }));
    expect(recorder.cancelRecording).toHaveBeenCalledOnce();
    expect(mocks.nativeCloseHud).not.toHaveBeenCalled();

    mocks.recorder = makeRecorderState({ countdownValue: null });
    rerender(
      <TooltipProvider>
        <LaunchWindow />
      </TooltipProvider>,
    );
    await waitFor(() => expect(mocks.nativeCloseHud).toHaveBeenCalledOnce());
  });
});
