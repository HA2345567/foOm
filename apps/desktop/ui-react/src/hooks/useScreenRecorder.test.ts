// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenRecorder } from "./useScreenRecorder";

const { translate, toastError } = vi.hoisted(() => ({
  translate: (key: string) => key,
  toastError: vi.fn(),
}));
vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => translate }));
vi.mock("sonner", () => ({ toast: { error: toastError, info: vi.fn() } }));
vi.mock("@/lib/fixWebmDuration", () => ({ fixWebmDuration: async (blob: Blob) => blob }));

class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state: RecordingState = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    public stream: MediaStream,
    public options: MediaRecorderOptions,
  ) {
    super();
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded-sidecar"]) });
    this.onstop?.();
    this.dispatchEvent(new Event("stop"));
  }
}

class FakeMediaStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
}

class FakeScreenTrack extends EventTarget {
  kind = "video";
  stop = vi.fn();
  applyConstraints = vi.fn().mockResolvedValue(undefined);
  getSettings = vi.fn(() => ({ width: 1920, height: 1080, frameRate: 30 }));
}

describe("native Windows recording lifecycle", () => {
  let microphoneTrack: { stop: ReturnType<typeof vi.fn> };
  let cameraTrack: { stop: ReturnType<typeof vi.fn>; onended: unknown };
  let bridge: Record<string, ReturnType<typeof vi.fn>>;
  let getDisplayMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem("foom-setting-default-mic", "true");
    localStorage.setItem("foom-setting-default-webcam", "true");
    FakeRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("MediaStream", FakeMediaStream);
    microphoneTrack = { stop: vi.fn() };
    cameraTrack = { stop: vi.fn(), onended: null };
    const microphoneStream = { getTracks: () => [microphoneTrack] };
    const cameraStream = { getTracks: () => [cameraTrack], getVideoTracks: () => [cameraTrack] };
    getDisplayMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) =>
          constraints.video ? cameraStream : microphoneStream,
        ),
        getDisplayMedia,
      },
    });
    bridge = {
      getPlatform: vi.fn().mockResolvedValue("win32"),
      getSelectedSource: vi.fn().mockResolvedValue({ id: "screen:1", display_id: "1" }),
      isNativeWindowsCaptureAvailable: vi
        .fn()
        .mockResolvedValue({ success: true, available: true }),
      isNativeMacCaptureAvailable: vi.fn().mockResolvedValue({
        success: true,
        available: false,
        reason: "unsupported-platform",
      }),
      requestNativeMacCursorAccess: vi.fn().mockResolvedValue({ success: true, granted: true }),
      setRecordingState: vi.fn().mockResolvedValue({ success: true }),
      startNativeWindowsRecording: vi.fn().mockResolvedValue({ success: true, recordingId: 123 }),
      appendRecordingSidecarChunk: vi.fn().mockResolvedValue({ success: true }),
      discardRecordingSidecar: vi.fn().mockResolvedValue({ success: true }),
      stopNativeWindowsRecording: vi.fn().mockResolvedValue({
        success: true,
        session: { screenVideoPath: "C:/recording.mp4" },
      }),
      pauseNativeWindowsRecording: vi.fn().mockResolvedValue({ success: true }),
      resumeNativeWindowsRecording: vi.fn().mockResolvedValue({ success: true }),
      hudOverlayHide: vi.fn().mockResolvedValue({ success: true }),
      hudOverlayShow: vi.fn().mockResolvedValue({ success: true }),
      setCurrentRecordingSession: vi.fn().mockResolvedValue({ success: true }),
      switchToEditor: vi.fn().mockResolvedValue({ success: true }),
    };
    window.foomNative = bridge;
  });

  afterEach(async () => {
    cleanup();
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "foomNative");
  });

  it("records microphone audio and keeps both sidecars aligned across pause/resume", async () => {
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      result.current.toggleRecording();
      await vi.advanceTimersByTimeAsync(3250);
    });
    expect(result.current.recording).toBe(true);
    expect(FakeRecorder.instances).toHaveLength(2);
    await act(async () => result.current.togglePaused());
    expect(FakeRecorder.instances.map((recorder) => recorder.state)).toEqual(["paused", "paused"]);
    await act(async () => result.current.togglePaused());
    expect(FakeRecorder.instances.map((recorder) => recorder.state)).toEqual([
      "recording",
      "recording",
    ]);
    await act(async () => result.current.toggleRecording());
    expect(bridge.stopNativeWindowsRecording).toHaveBeenCalledOnce();
    const [stopOptions] = bridge.stopNativeWindowsRecording.mock.calls[0] as [
      {
        discard: boolean;
        micAudioData: ArrayBuffer | null;
        cameraVideoData: ArrayBuffer | null;
      },
    ];
    expect(stopOptions.discard).toBe(false);
    expect(stopOptions.micAudioData?.byteLength).toBeGreaterThan(0);
    expect(stopOptions.cameraVideoData).toBeNull();
    const [sidecarKind, sidecarChunk, sidecarTimestamp, sidecarSequence] =
      bridge.appendRecordingSidecarChunk.mock.calls[0] as [string, ArrayBuffer, number, number];
    expect(sidecarKind).toBe("webcam");
    expect(sidecarChunk.byteLength).toBeGreaterThan(0);
    expect(Number.isFinite(sidecarTimestamp)).toBe(true);
    expect(sidecarSequence).toBe(0);
    expect(microphoneTrack.stop).toHaveBeenCalled();
    expect(bridge.switchToEditor).toHaveBeenCalledOnce();
    expect(result.current.recording).toBe(false);
  });

  it("keeps the HUD in its compact finalizing state until the saved take opens", async () => {
    let completeStop!: (result: unknown) => void;
    bridge.stopNativeWindowsRecording.mockReturnValue(
      new Promise((resolve) => {
        completeStop = resolve;
      }),
    );
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      result.current.toggleRecording();
      await vi.advanceTimersByTimeAsync(3250);
    });

    await act(async () => result.current.toggleRecording());
    expect(result.current.finalizing).toBe(true);
    expect(result.current.recording).toBe(true);

    await act(async () => {
      result.current.toggleRecording();
    });
    expect(bridge.startNativeWindowsRecording).toHaveBeenCalledOnce();

    await act(async () => {
      completeStop({ success: true, session: { screenVideoPath: "C:/recording.mp4" } });
    });
    expect(bridge.switchToEditor).toHaveBeenCalledOnce();
    expect(result.current.finalizing).toBe(false);
    expect(result.current.recording).toBe(false);
  });

  it("shows a picker failure and clears pending auto-start without recording", async () => {
    bridge.getSelectedSource.mockResolvedValue(null);
    bridge.openSourceSelector = vi.fn().mockResolvedValue({ opened: false, reason: "Selector window failed" });
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      result.current.toggleRecording();
      await vi.advanceTimersByTimeAsync(3250);
    });
    expect(bridge.openSourceSelector).toHaveBeenCalledOnce();
    expect(bridge.startNativeWindowsRecording).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
    expect(localStorage.getItem("foom-start-recording-after-select")).toBeNull();
    expect(toastError).toHaveBeenCalledWith("Selector window failed");
  });

  it("forwards the selected region unchanged to native Windows capture", async () => {
    const region = { x: -1800, y: -100, width: 800, height: 600 };
    bridge.getSelectedSource.mockResolvedValue({ id: "custom_area", display_id: "2", type: "region", region });
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      result.current.toggleRecording();
      await vi.advanceTimersByTimeAsync(3250);
    });
    expect(bridge.startNativeWindowsRecording).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ type: "region", sourceId: "custom_area", region }),
    }));
    expect(getDisplayMedia).not.toHaveBeenCalled();
    await act(async () => result.current.toggleRecording());
  });

  it("discards native capture and releases microphone access when cancelled during startup", async () => {
    let finishStart!: (result: unknown) => void;
    bridge.startNativeWindowsRecording.mockReturnValue(
      new Promise((resolve) => {
        finishStart = resolve;
      }),
    );
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      result.current.toggleRecording();
      await vi.advanceTimersByTimeAsync(3250);
    });
    expect(bridge.startNativeWindowsRecording).toHaveBeenCalledOnce();
    await act(async () => result.current.cancelRecording());
    await act(async () => finishStart({ success: true, recordingId: 123 }));
    expect(bridge.stopNativeWindowsRecording).toHaveBeenCalledWith({ discard: true });
    expect(microphoneTrack.stop).toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(bridge.switchToEditor).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });

  it("still stops and saves the screen capture when microphone encoding fails", async () => {
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      result.current.toggleRecording();
      await vi.advanceTimersByTimeAsync(3250);
    });
    await act(async () => {
      FakeRecorder.instances.find((recorder) => recorder.options.audioBitsPerSecond)?.onerror?.();
      await Promise.resolve();
      result.current.toggleRecording();
    });
    expect(bridge.stopNativeWindowsRecording).toHaveBeenCalledWith(
      expect.objectContaining({ micAudioData: null }),
    );
    expect(bridge.switchToEditor).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Microphone recording failed"));
  });

  it("opens the screen recording if webcam sidecar streaming fails", async () => {
    bridge.appendRecordingSidecarChunk.mockResolvedValue({
      success: false,
      error: "sidecar disk write failed",
    });
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      result.current.toggleRecording();
      await vi.advanceTimersByTimeAsync(3250);
    });

    await act(async () => result.current.toggleRecording());

    expect(bridge.discardRecordingSidecar).toHaveBeenCalledWith("webcam");
    expect(bridge.stopNativeWindowsRecording).toHaveBeenCalledWith(
      expect.objectContaining({ cameraVideoData: null }),
    );
    expect(bridge.switchToEditor).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Opening the screen recording without it"),
    );
  });

  it("keeps the current capture alive and preserves its cursor mode when preferences change", async () => {
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      result.current.toggleRecording();
      await vi.advanceTimersByTimeAsync(3250);
    });
    await act(async () => result.current.setCursorCaptureMode("system"));
    expect(bridge.stopNativeWindowsRecording).not.toHaveBeenCalled();
    await act(async () => result.current.toggleRecording());
    expect(bridge.setCurrentRecordingSession).toHaveBeenCalledWith(expect.objectContaining({
      cursorCaptureMode: "editable-overlay",
    }));
  });

  it.each(["darwin", "linux"] as const)(
    "uses the standards-based display picker on %s when native capture is unavailable",
    async (platform) => {
      vi.resetModules();
      const { useScreenRecorder: platformRecorder } = await import("./useScreenRecorder");
      bridge.getPlatform.mockResolvedValue(platform);
      bridge.isNativeWindowsCaptureAvailable.mockResolvedValue({
        success: true,
        available: false,
      });
      localStorage.setItem("foom-setting-default-mic", "false");
      localStorage.setItem("foom-setting-default-webcam", "false");
      const screenTrack = new FakeScreenTrack();
      getDisplayMedia.mockResolvedValue(new FakeMediaStream([
        screenTrack as unknown as MediaStreamTrack,
      ]));

      const { result } = renderHook(() => platformRecorder());
      await act(async () => {
        result.current.toggleRecording();
        await vi.advanceTimersByTimeAsync(3250);
      });

      expect(bridge.getPlatform).toHaveBeenCalled();
      expect(getDisplayMedia).toHaveBeenCalledOnce();
      expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
        audio: false,
        video: expect.objectContaining({ width: { max: 3840 }, height: { max: 2160 } }),
      }));
      expect(result.current.recording).toBe(true);
      await act(async () => result.current.toggleRecording());
    },
  );
});
