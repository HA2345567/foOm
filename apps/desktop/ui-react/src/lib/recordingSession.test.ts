import { describe, expect, it } from "vitest";
import { normalizeCursorTelemetrySamples } from "./recordingSession";

describe("cursor telemetry normalization", () => {
	it("preserves recorded semantic cursor shapes and click interactions", () => {
		const samples = normalizeCursorTelemetrySamples([
			{ timeMs: 10, cx: 0.2, cy: 0.3, cursorType: "text", interactionType: "move" },
			{ timeMs: 20, cx: 0.4, cy: 0.5, cursorType: "pointer", interactionType: "right-click" },
			{ timeMs: 30, cx: 0.6, cy: 0.7, cursorType: "resize-nesw", interactionType: "click" },
		]);

		expect(samples.map(({ cursorType, interactionType }) => [cursorType, interactionType])).toEqual([
			["text", "move"],
			["pointer", "right-click"],
			["resize-nesw", "click"],
		]);
	});

	it("falls back to the arrow for invalid cursor data", () => {
		expect(normalizeCursorTelemetrySamples([
			{ timeMs: 0, cx: 0.5, cy: 0.5, cursorType: "made-up-cursor" },
		])[0].cursorType).toBe("arrow");
	});
});
