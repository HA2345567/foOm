import { MAC_CURSOR_OPTIONS } from "./macCursors";
import { DEFAULT_CURSOR_SIZE } from "@/components/vedio-editor/types";
import { normalizeCursorThemeId } from "./cursorThemes";
import { describe, expect, it } from "vitest";
import {
  getNativeCursorClickBounceProgress,
  getNativeCursorClickBounceScale,
  hasNativeCursorRecordingData,
  resolveInterpolatedNativeCursorFrame,
  resolveNativeCursorRenderAsset,
} from "./nativeCursor";

describe("native cursor click bounce", () => {
	it("defaults the video cursor size to 1.5x", () => {
		expect(DEFAULT_CURSOR_SIZE).toBe(1.5);
	});

  it("keeps click progress visible across several frames", () => {
    const recordingData = {
      version: 2,
      provider: "native" as const,
      assets: [],
      samples: [
        { timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" as const },
        { timeMs: 100, cx: 0.5, cy: 0.5, interactionType: "click" as const },
        { timeMs: 133, cx: 0.5, cy: 0.5, interactionType: "move" as const },
        { timeMs: 166, cx: 0.5, cy: 0.5, interactionType: "move" as const },
        { timeMs: 200, cx: 0.5, cy: 0.5, interactionType: "move" as const },
        { timeMs: 300, cx: 0.5, cy: 0.5, interactionType: "move" as const },
      ],
    };

    expect(getNativeCursorClickBounceProgress(recordingData, 133)).toBeGreaterThan(0);
    expect(getNativeCursorClickBounceProgress(recordingData, 200)).toBeGreaterThan(0);
    expect(getNativeCursorClickBounceProgress(recordingData, 400)).toBe(0);
  });

  it("applies a visible press and rebound scale at high intensity", () => {
    expect(getNativeCursorClickBounceScale(5, 1)).toBe(1);
    expect(getNativeCursorClickBounceScale(5, 0.82)).toBeLessThan(0.9);
    expect(getNativeCursorClickBounceScale(5, 0.28)).toBeGreaterThan(1.05);
    expect(getNativeCursorClickBounceScale(5, 0)).toBe(1);
  });

  it("uses the default cursor asset for telemetry-only macOS recordings", () => {
    const recordingData = {
      version: 2,
      provider: "none" as const,
      assets: [],
      samples: [
        { timeMs: 0, cx: 0.25, cy: 0.4, visible: true },
        { timeMs: 100, cx: 0.75, cy: 0.6, visible: true },
      ],
    };

    expect(hasNativeCursorRecordingData(recordingData)).toBe(true);
    const frame = resolveInterpolatedNativeCursorFrame(recordingData, 50);
    expect(frame?.asset.cursorType).toBe("arrow");
    expect(frame?.sample.cx).toBeCloseTo(0.5);
    expect(frame?.sample.cy).toBeCloseTo(0.5);
  });

  it("applies click bounce to telemetry-only macOS recordings", () => {
    const recordingData = {
      version: 2,
      provider: "none" as const,
      assets: [],
      samples: [
        { timeMs: 0, cx: 0.5, cy: 0.5, visible: true, interactionType: "move" as const },
        { timeMs: 100, cx: 0.5, cy: 0.5, visible: true, interactionType: "click" as const },
        { timeMs: 133, cx: 0.5, cy: 0.5, visible: true, interactionType: "move" as const },
      ],
    };

    expect(getNativeCursorClickBounceProgress(recordingData, 133)).toBeGreaterThan(0);
  });

  it("renders a hand during click playback in preview and export, then restores the hovered cursor", () => {
    const recordingData = {
      version: 2,
      provider: "none" as const,
      assets: [],
      samples: [
        { timeMs: 0, cx: 0.5, cy: 0.5, visible: true, cursorType: "text" as const, interactionType: "move" as const },
        { timeMs: 100, cx: 0.5, cy: 0.5, visible: true, cursorType: "text" as const, interactionType: "click" as const },
        { timeMs: 140, cx: 0.5, cy: 0.5, visible: true, cursorType: "text" as const, interactionType: "move" as const },
        { timeMs: 500, cx: 0.5, cy: 0.5, visible: true, cursorType: "text" as const, interactionType: "move" as const },
      ],
    };

    expect(resolveInterpolatedNativeCursorFrame(recordingData, 120)?.sample.cursorType).toBe("pointer");
    expect(resolveInterpolatedNativeCursorFrame(recordingData, 400)?.sample.cursorType).toBe("text");
  });
});

describe("Mac-style cursor presets", () => {
  it.each(MAC_CURSOR_OPTIONS)("preserves $label artwork and hotspot for an untyped Windows take", ({ id, asset }) => {
    const recorded = {
      id: "captured", platform: "win32" as const, imageDataUrl: "", width: 20,
      height: 20, hotspotX: 5, hotspotY: 8,
    };
    expect(normalizeCursorThemeId(id)).toBe(id);
    expect(resolveNativeCursorRenderAsset(recorded, 1.5, undefined, id)).toEqual({ id, ...asset });
    expect(asset.imageDataUrl).toBeTruthy();
  });

  it("keeps text and pointing-hand shapes when a custom arrow preset is selected", () => {
    const recorded = {
      id: "telemetry",
      platform: "win32" as const,
      imageDataUrl: "",
      width: 32,
      height: 32,
      hotspotX: 16,
      hotspotY: 16,
    };
    const arrowPreset = MAC_CURSOR_OPTIONS[0].id;

    const text = resolveNativeCursorRenderAsset(
      recorded,
      1.5,
      { timeMs: 0, cx: 0.5, cy: 0.5, cursorType: "text" },
      arrowPreset,
    );
    const hand = resolveNativeCursorRenderAsset(
      recorded,
      1.5,
      { timeMs: 0, cx: 0.5, cy: 0.5, cursorType: "pointer" },
      arrowPreset,
    );

    expect(text.id).toBe("pretty:text");
    expect(hand.id).toBe("pretty:pointer");
    expect(hand.width).toBeCloseTo(41.6);
    expect(hand.height).toBeCloseTo(41.6);
    expect(hand.hotspotX).toBeCloseTo(16.9);
    expect(hand.hotspotY).toBeCloseTo(10.4);
  });

  it("infers arrow and hand shapes from untyped captured cursor hotspots", () => {
    const theme = "hello-kitty-watermelon";
    const untypedArrow = {
      id: "captured-arrow",
      platform: "darwin" as const,
      imageDataUrl: "data:image/png;base64,arrow",
      width: 32,
      height: 32,
      hotspotX: 2,
      hotspotY: 2,
    };
    const untypedHand = {
      ...untypedArrow,
      id: "captured-hand",
      imageDataUrl: "data:image/png;base64,hand",
      hotspotX: 16,
      hotspotY: 8,
    };

    const arrow = resolveNativeCursorRenderAsset(untypedArrow, 1, undefined, theme);
    const hand = resolveNativeCursorRenderAsset(untypedHand, 1, undefined, theme);

    expect(arrow.id).toBe(`theme:${theme}:arrow`);
    expect(hand.id).toBe(`theme:${theme}:pointer`);
    expect(hand.imageDataUrl).not.toBe(arrow.imageDataUrl);
  });
});
