import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOBAL_RECORDING_SHORTCUT,
  DEFAULT_SHORTCUTS,
  findGlobalRecordingShortcutConflict,
} from "./shortcuts";

describe("global recording shortcut validation", () => {
  it("defaults to Ctrl+Shift+R", () => {
    expect(DEFAULT_GLOBAL_RECORDING_SHORTCUT).toEqual({
      key: "r",
      ctrl: true,
      shift: true,
    });
  });

  it("reports conflicts with editor shortcuts", () => {
    expect(
      findGlobalRecordingShortcutConflict(
        { key: "z", ctrl: true },
        DEFAULT_SHORTCUTS,
      ),
    ).toEqual({ type: "fixed", label: "Undo" });
  });

  it("allows a binding that does not conflict with editor shortcuts", () => {
    expect(
      findGlobalRecordingShortcutConflict(
        DEFAULT_GLOBAL_RECORDING_SHORTCUT,
        DEFAULT_SHORTCUTS,
      ),
    ).toBeNull();
  });
});
