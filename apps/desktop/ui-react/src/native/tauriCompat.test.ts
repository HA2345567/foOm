// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

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
    localStorage.setItem("foom-current-recording-session", JSON.stringify({ screenVideoPath: "indexeddb://test" }));
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
