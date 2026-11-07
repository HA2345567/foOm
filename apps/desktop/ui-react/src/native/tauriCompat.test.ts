// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const { invoke, convertFileSrc, getByLabel, setIgnoreCursorEvents } = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
getByLabel: vi.fn(),
setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn().mockResolvedValue(() => {}) }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel },
}));

describe("tauriCompat desktop media", () => {
  it.each([true, false])("applies ignore-cursor-events=%s to the recording overlay", async (ignore) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const overlayWindow = { setIgnoreCursorEvents };
    getByLabel.mockResolvedValue(overlayWindow);
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    const result = await window.foomNative.setHudOverlayIgnoreMouseEvents(ignore);

    expect(getByLabel).toHaveBeenCalledWith("recording-overlay");
    expect(setIgnoreCursorEvents).toHaveBeenCalledWith(ignore);
    expect(result).toEqual({ success: true });
  });

  it("forwards the startup preserve-position flag when resizing the toolbar", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    await window.foomNative.setHudOverlaySize(640, 128, "right", true);

    expect(invoke).toHaveBeenCalledWith("set_hud_overlay_size", {
      width: 640,
      height: 128,
      layout: "right",
      preservePosition: true,
    });
  });

  it("returns to the recorder only after a successful save or explicit discard", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    const bridge = window.foomNative;
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const unregister = bridge.onRequestSaveBeforeClose(save);
    try {
      await bridge.sendCloseConfirmResponse("cancel");
      await bridge.sendCloseConfirmResponse("save");
      expect(invoke).not.toHaveBeenCalledWith("switch_to_overlay");
      await bridge.sendCloseConfirmResponse("save");
      await bridge.sendCloseConfirmResponse("discard");
      expect(invoke.mock.calls.filter(([command]) => command === "switch_to_overlay")).toHaveLength(2);
      expect(save).toHaveBeenCalledTimes(2);
    } finally {
      unregister();
    }
  });

  it("reads encoded Windows file URLs through a native filesystem path", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    invoke.mockResolvedValueOnce([1, 2, 3]);
    const result = await window.foomNative.readBinaryFile("file:///C:/Videos/My%20take.mp4");
    expect(invoke).toHaveBeenCalledWith("read_binary_file", { path: "C:/Videos/My take.mp4" });
    expect(result.success).toBe(true);
    expect(result.path).toBe("C:/Videos/My take.mp4");
    expect(new Uint8Array(result.data!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("requires an explicit desktop source and recovers from corrupt saved selection", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    expect(await window.foomNative.getSelectedSource()).toBeNull();
    localStorage.setItem("foom-selected-capture-source", "{bad-json");
    expect(await window.foomNative.getSelectedSource()).toBeNull();
    expect(localStorage.getItem("foom-selected-capture-source")).toBeNull();
    localStorage.setItem("foom-selected-capture-source", JSON.stringify({ id: "screen" }));
    expect(await window.foomNative.getSelectedSource()).toBeNull();
  });

  it("formats raw Windows monitor paths as readable display names", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    invoke.mockResolvedValueOnce([
      {
        kind: "monitor",
        id: "12345",
        title: "\\\\.\\DISPLAY1",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
    ]);
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    const [display] = await window.foomNative.getSources();

    expect(display.name).toBe("Display 1");
    expect(display.id).toBe("screen:12345");
  });

  it("reports selector failure without silently selecting a monitor", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    invoke.mockRejectedValue(new Error("Selector window failed"));
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    expect(await window.foomNative.openSourceSelector()).toEqual({ opened: false, reason: "Selector window failed" });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["show_source_selector"]);
    expect(await window.foomNative.getSelectedSource()).toBeNull();
    await expect(window.foomNative.getSources()).rejects.toThrow("Could not load capture sources");
  });
  it("preserves selected region bounds across bridge storage", async () => {
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    const region = { x: -1800, y: 40, width: 800, height: 600 };
    await window.foomNative.selectSource({ id: "custom_area", name: "Left display region", type: "region", region });
    expect(await window.foomNative.getSelectedSource()).toEqual(expect.objectContaining({ id: "custom_area", type: "region", region }));
  });
  it("uses the selected physical region instead of a hardcoded crop", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    invoke.mockResolvedValue("proj_region");
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    const region = { x: -1800, y: 40, width: 800, height: 600 };
    const result = await window.foomNative.startNativeWindowsRecording({
      source: { sourceId: "custom_area", type: "region", region },
    });
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith("start_recording", {
      options: expect.objectContaining({ sourceType: "area", region }),
    });
  });

  it("refuses area capture without selected bounds before invoking native capture", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    const result = await window.foomNative.startNativeWindowsRecording({ source: { sourceId: "custom_area" } });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Select a valid capture area");
    expect(invoke).not.toHaveBeenCalledWith("start_recording", expect.anything());
  });
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    Reflect.deleteProperty(window, "foomNative");
    Reflect.deleteProperty(window, "electronAPI");
  });

  it("passes recorded microphone bytes to native finalization", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    invoke.mockImplementation(async (command: string) =>
      command === "stop_recording"
        ? { id: "proj_test", raw_video_path: "C:/recordings/proj_test.mp4" }
        : null,
    );
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    const result = await window.foomNative.stopNativeWindowsRecording({
      micAudioData: new Uint8Array([1, 2, 3]).buffer,
    });
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "stop_recording",
      expect.objectContaining({ micAudioBytes: [1, 2, 3] }),
    );
  });

  it("streams webcam sidecar chunks to native storage without sending the whole recording", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    const data = new Uint8Array([4, 5, 6]).buffer;

    const result = await window.foomNative.appendRecordingSidecarChunk("webcam", data, 1250, 2);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith("append_recording_sidecar_chunk", {
      kind: "webcam",
      bytes: [4, 5, 6],
      timestampMs: 1250,
      sequence: 2,
    });
  });

  it("preserves native millisecond duration when opening a finished recording", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    invoke.mockImplementation(async (command: string) =>
      command === "stop_recording"
        ? { id: "proj_duration", raw_video_path: "C:/recordings/proj_duration.mp4", duration: 3250 }
        : null,
    );
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    const result = await window.foomNative.stopNativeWindowsRecording();

    expect(result.success).toBe(true);
    expect(result.session.durationMs).toBe(3250);
    expect(JSON.parse(localStorage.getItem("foom-current-recording-session") ?? "null").durationMs).toBe(3250);
  });

  it("uses explicit native cancellation when a recording is discarded", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    const result = await window.foomNative.stopNativeWindowsRecording({ discard: true });

    expect(result).toEqual({ success: true, discarded: true });
    expect(invoke).toHaveBeenCalledWith("cancel_recording", undefined);
    expect(invoke).not.toHaveBeenCalledWith("stop_recording", expect.anything());
  });

  it("keeps browser and remote media URLs usable inside the desktop shell", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    for (const path of [
      "blob:recording",
      "data:video/mp4;base64,AAAA",
      "https://example.com/video.mp4",
    ]) {
      expect(window.foomNative.convertFileSrc(path)).toBe(path);
      expect(await window.foomNative.resolveVideoPath(path)).toBe(path);
    }
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it("does not invent cursor positions and clicks for imported videos without telemetry", async () => {
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    const response = await window.foomNative.invokeNativeBridge({
      domain: "cursor", action: "getRecordingData", payload: { videoPath: "C:/imported.mp4" },
    });
    expect(response.data.samples).toEqual([]);
  });

  it("preserves every supported semantic cursor shape in the stored recording session", async () => {
    const videoPath = "C:/Videos/proj_semantic-cursors.mp4";
    localStorage.setItem("foom-current-recording-session", JSON.stringify({
      screenVideoPath: videoPath,
      cursorTelemetry: [
        { timeMs: 0, cx: 0.1, cy: 0.1, cursorType: "arrow" },
        { timeMs: 100, cx: 0.2, cy: 0.2, cursorType: "text" },
        { timeMs: 200, cx: 0.3, cy: 0.3, cursorType: "pointer" },
        { timeMs: 300, cx: 0.4, cy: 0.4, cursorType: "open-hand" },
        { timeMs: 400, cx: 0.5, cy: 0.5, cursorType: "resize-ew" },
      ],
    }));
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    const response = await window.foomNative.invokeNativeBridge({
      domain: "cursor", action: "getRecordingData", payload: { videoPath },
    });

    expect(response.data.samples.map((sample: { cursorType: string }) => sample.cursorType)).toEqual([
      "arrow", "text", "pointer", "open-hand", "resize-ew",
    ]);
  });

  it("preserves native text and hand cursor types from the Windows capture log", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    invoke.mockResolvedValueOnce({
      width: 1000,
      height: 500,
      captureX: 0,
      captureY: 0,
      events: [
        { type: "move", x: 100, y: 120, t: 20, cursorType: "text" },
        { type: "move", x: 300, y: 220, t: 40, cursorType: "pointer" },
        { type: "click_down", x: 300, y: 220, t: 50, btn: "left", cursorType: "pointer" },
      ],
    });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    const response = await window.foomNative.invokeNativeBridge({
      domain: "cursor",
      action: "getRecordingData",
      payload: { videoPath: "C:/Videos/proj_cursor.mp4" },
    });

    expect(response.data.samples.map((sample: { cursorType: string; interactionType?: string }) => [sample.cursorType, sample.interactionType])).toEqual([
      ["text", "move"],
      ["pointer", "move"],
      ["pointer", "click"],
    ]);
  });

  it("keeps cursor events within an undersized encoded video timeline", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    invoke.mockResolvedValueOnce({
      width: 100, height: 100, duration: 1000,
      events: [
        { type: "move", x: 10, y: 10, t: 0, cursorType: "arrow" },
        { type: "move", x: 20, y: 20, t: 1000, cursorType: "text" },
        { type: "move", x: 30, y: 30, t: 2000, cursorType: "pointer" },
      ],
    });
    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();
    const response = await window.foomNative.invokeNativeBridge({
      domain: "cursor", action: "getRecordingData", payload: { videoPath: "C:/Videos/proj_short.mp4" },
    });
    expect(response.data.samples.map((sample: { timeMs: number; cursorType: string }) => [sample.timeMs, sample.cursorType])).toEqual([
      [0, "arrow"], [500, "text"], [1000, "pointer"],
    ]);
  });
});

describe("tauriCompat browser preview source selection", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    Reflect.deleteProperty(window, "foomNative");
    Reflect.deleteProperty(window, "electronAPI");
  });

  it("notifies both the selector window and opener when a source is selected", async () => {
    const openerDispatch = vi.fn();
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { dispatchEvent: openerDispatch },
    });

    const localDispatch = vi.spyOn(window, "dispatchEvent");

    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    await window.foomNative.selectSource({
      id: "screen:1",
      name: "Display 1",
      display_id: "1",
    });

    expect(JSON.parse(localStorage.getItem("foom-selected-capture-source") ?? "null")).toEqual({
      id: "1",
      name: "Display 1",
      display_id: "1",
    });
    expect(localDispatch).toHaveBeenCalledWith(expect.any(CustomEvent));
    expect(openerDispatch).toHaveBeenCalledWith(expect.any(CustomEvent));
  });
});

describe("tauriCompat deleteRecording", () => {
  afterEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, "foomNative");
    Reflect.deleteProperty(window, "electronAPI");
  });

  it("clears localStorage recording session keys", async () => {
    localStorage.setItem("foom-current-video-path", "indexeddb://test");
    localStorage.setItem(
      "foom-current-recording-session",
      JSON.stringify({ screenVideoPath: "indexeddb://test" }),
    );
    localStorage.setItem("foom-current-project-file", "{}");
    localStorage.setItem("foom-current-project-path", "path/to/project");

    const { installTauriCompatBridge } = await import("./tauriCompat");
    installTauriCompatBridge();

    await window.foomNative.deleteRecording("test");

    expect(localStorage.getItem("foom-current-video-path")).toBeNull();
    expect(localStorage.getItem("foom-current-recording-session")).toBeNull();
    expect(localStorage.getItem("foom-current-project-file")).toBeNull();
    expect(localStorage.getItem("foom-current-project-path")).toBeNull();
  });
});
