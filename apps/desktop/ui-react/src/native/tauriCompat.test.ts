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
