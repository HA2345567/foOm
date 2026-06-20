import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import { detectZoomDwellCandidates, normalizeCursorTelemetry } from "./zoomSuggestionUtils";

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
        { timeMs: 700, cx: 0.52, cy: 0.51, interactionType: "double-click" },
        { timeMs: 1_200, cx: 0.8, cy: 0.8, interactionType: "right-click" },
      ],
      1_500,
    );

    const candidates = detectZoomDwellCandidates(samples);

    expect(candidates.map((candidate) => candidate.centerTimeMs)).toEqual([500, 1200]);
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
});
