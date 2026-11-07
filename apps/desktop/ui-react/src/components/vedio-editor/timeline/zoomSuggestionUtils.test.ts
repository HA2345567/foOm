import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import {
  buildAutoZoomSuggestions,
  detectZoomDwellCandidates,
  MAX_DWELL_DURATION_MS,
  normalizeCursorTelemetry,
} from "./zoomSuggestionUtils";

describe("detectZoomDwellCandidates", () => {
  it("creates zoom candidates from click interactions while the cursor is moving", () => {
    const samples: CursorTelemetryPoint[] = normalizeCursorTelemetry(
      [
        { timeMs: 0, cx: 0.1, cy: 0.1 },
        { timeMs: 200, cx: 0.25, cy: 0.25 },
        { timeMs: 420, cx: 0.42, cy: 0.35, interactionType: "click" },
        { timeMs: 700, cx: 0.6, cy: 0.42 },
        { timeMs: 980, cx: 0.78, cy: 0.55 },
      ],
      1_000,
    );

    expect(detectZoomDwellCandidates(samples)).toEqual([
      {
        centerTimeMs: 420,
        focus: { cx: 0.42, cy: 0.35 },
        strength: 2601,
      },
    ]);
  });

  it("deduplicates clustered click interactions", () => {
    const samples: CursorTelemetryPoint[] = normalizeCursorTelemetry(
      [
        { timeMs: 0, cx: 0.1, cy: 0.1 },
        { timeMs: 500, cx: 0.5, cy: 0.5, interactionType: "click" },
        { timeMs: 610, cx: 0.51, cy: 0.5, interactionType: "mouseup" },
        { timeMs: 700, cx: 0.515, cy: 0.51, interactionType: "double-click" },
        { timeMs: 1_200, cx: 0.8, cy: 0.8, interactionType: "right-click" },
      ],
      1_500,
    );

    const candidates = detectZoomDwellCandidates(samples);

    expect(candidates.map((candidate) => candidate.centerTimeMs)).toEqual([700, 1200]);
    expect(candidates[0].focus).toEqual({ cx: 0.515, cy: 0.51 });
  });

  it("recognizes a close second click as stronger double-click intent", () => {
    const candidates = detectZoomDwellCandidates([
      { timeMs: 1_000, cx: 0.42, cy: 0.38, interactionType: "click" },
      { timeMs: 1_240, cx: 0.425, cy: 0.382, interactionType: "click" },
    ]);

    expect(candidates).toEqual([
      {
        centerTimeMs: 1_240,
        focus: { cx: 0.425, cy: 0.382 },
        strength: MAX_DWELL_DURATION_MS + 3,
      },
    ]);
  });

  it("keeps rapid clicks on separate controls as separate focus candidates", () => {
    const candidates = detectZoomDwellCandidates([
      { timeMs: 1_000, cx: 0.25, cy: 0.3, interactionType: "click" },
      { timeMs: 1_240, cx: 0.72, cy: 0.68, interactionType: "click" },
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.focus)).toEqual([
      { cx: 0.25, cy: 0.3 },
      { cx: 0.72, cy: 0.68 },
    ]);
  });

  it("keeps dwell candidates for still cursor pauses", () => {
    const samples: CursorTelemetryPoint[] = normalizeCursorTelemetry(
      [
        { timeMs: 0, cx: 0.25, cy: 0.4 },
        { timeMs: 500, cx: 0.255, cy: 0.405 },
        { timeMs: 900, cx: 0.26, cy: 0.41 },
      ],
      1_000,
    );

    const candidates = detectZoomDwellCandidates(samples);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].centerTimeMs).toBe(450);
  });

  it("ignores brief stationary hovers that commonly happen over window chrome", () => {
    const candidates = detectZoomDwellCandidates([
      { timeMs: 14_500, cx: 0.925, cy: 0.02 },
      { timeMs: 14_978, cx: 0.925, cy: 0.02 },
    ]);

    expect(candidates).toEqual([]);
  });

  it("does not turn a long telemetry gap into an invented dwell", () => {
    expect(
      detectZoomDwellCandidates([
        { timeMs: 0, cx: 0.25, cy: 0.4 },
        { timeMs: 2_000, cx: 0.25, cy: 0.4 },
      ]),
    ).toEqual([]);
  });

  it("does not mistake a slow deliberate pointer traverse for a stationary dwell", () => {
    const samples: CursorTelemetryPoint[] = Array.from({ length: 6 }, (_, index) => ({
      timeMs: index * 200,
      cx: 0.2 + index * 0.01,
      cy: 0.4,
    }));

    expect(detectZoomDwellCandidates(samples)).toEqual([]);
  });

  it("ignores hidden cursor samples when detecting dwell", () => {
    expect(
      normalizeCursorTelemetry(
        [
          { timeMs: 0, cx: 0.2, cy: 0.3 },
          { timeMs: 100, cx: 0.3, cy: 0.4, visible: false },
        ],
        1_000,
      ).map(({ timeMs, cx, cy }) => ({ timeMs, cx, cy })),
    ).toEqual([{ timeMs: 0, cx: 0.2, cy: 0.3 }]);
  });
});

describe("buildAutoZoomSuggestions", () => {
  it("keeps long reading dwells as one capped-strength suggestion", () => {
    const suggestions = buildAutoZoomSuggestions({
      cursorTelemetry: [
        { timeMs: 1_000, cx: 0.64, cy: 0.38 },
        { timeMs: 1_300, cx: 0.641, cy: 0.381 },
        { timeMs: 1_600, cx: 0.642, cy: 0.382 },
        { timeMs: 1_900, cx: 0.643, cy: 0.383 },
        { timeMs: 2_200, cx: 0.644, cy: 0.384 },
        { timeMs: 2_500, cx: 0.645, cy: 0.385 },
        { timeMs: 2_800, cx: 0.644, cy: 0.384 },
        { timeMs: 3_100, cx: 0.643, cy: 0.383 },
        { timeMs: 3_400, cx: 0.642, cy: 0.382 },
        { timeMs: 3_700, cx: 0.641, cy: 0.381 },
        { timeMs: 4_000, cx: 0.64, cy: 0.38 },
        { timeMs: 4_300, cx: 0.641, cy: 0.381 },
        { timeMs: 4_600, cx: 0.642, cy: 0.382 },
        { timeMs: 4_900, cx: 0.643, cy: 0.383 },
        { timeMs: 5_200, cx: 0.644, cy: 0.384 },
        { timeMs: 5_500, cx: 0.645, cy: 0.385 },
        { timeMs: 5_800, cx: 0.644, cy: 0.384 },
        { timeMs: 6_000, cx: 0.645, cy: 0.385 },
      ],
      totalMs: 8_000,
      existingRegions: [],
      defaultDurationMs: 2_000,
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].span).toEqual({ start: 1_300, end: 3_300 });
    expect(suggestions[0].focus.cx).toBeCloseTo(0.6425);
    expect(suggestions[0].focus.cy).toBeCloseTo(0.3825);
  });

  it("keeps higher-intent clustered clicks and spaces nearby suggestions", () => {
    const suggestions = buildAutoZoomSuggestions({
      cursorTelemetry: [
        { timeMs: 2_000, cx: 0.2, cy: 0.3, interactionType: "click" },
        { timeMs: 3_500, cx: 0.7, cy: 0.6, interactionType: "double-click" },
      ],
      totalMs: 8_000,
      existingRegions: [],
      defaultDurationMs: 2_000,
    });

    expect(suggestions).toEqual([
      { span: { start: 2_500, end: 4_500 }, focus: { cx: 0.7, cy: 0.6 } },
    ]);
  });

  it("clamps suggestions to clip edges and skips existing-region overlaps", () => {
    const suggestions = buildAutoZoomSuggestions({
      cursorTelemetry: [
        { timeMs: 0, cx: 0.2, cy: 0.3, interactionType: "click" },
        { timeMs: 4_000, cx: 0.5, cy: 0.5, interactionType: "click" },
        { timeMs: 10_000, cx: 0.8, cy: 0.7, interactionType: "click" },
      ],
      totalMs: 10_000,
      existingRegions: [{ startMs: 3_500, endMs: 4_500 }],
      defaultDurationMs: 2_000,
    });

    expect(suggestions).toEqual([
      { span: { start: 0, end: 2_000 }, focus: { cx: 0.2, cy: 0.3 } },
      { span: { start: 8_000, end: 10_000 }, focus: { cx: 0.8, cy: 0.7 } },
    ]);
  });

  it("returns accepted suggestions in chronological order after intent ranking", () => {
    const suggestions = buildAutoZoomSuggestions({
      cursorTelemetry: [
        { timeMs: 1_000, cx: 0.2, cy: 0.3, interactionType: "click" },
        { timeMs: 8_000, cx: 0.8, cy: 0.7, interactionType: "double-click" },
      ],
      totalMs: 10_000,
      existingRegions: [],
      defaultDurationMs: 2_000,
    });

    expect(suggestions.map((suggestion) => suggestion.span.start)).toEqual([0, 7_000]);
  });
});
