import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import { getCursorVisualState } from "./cursorRenderer";

describe("recorded cursor visual state", () => {
	it("shows the Mac-style hand briefly for a click, then restores the hover cursor", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.4, cy: 0.5, cursorType: "arrow", interactionType: "move" },
			{ timeMs: 100, cx: 0.4, cy: 0.5, cursorType: "arrow", interactionType: "click" },
		];

		expect(getCursorVisualState(samples, 120).cursorType).toBe("pointer");
		expect(getCursorVisualState(samples, 260).cursorType).toBe("arrow");
	});

	it("returns to the text I-beam after clicking inside text", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.4, cy: 0.5, cursorType: "text", interactionType: "move" },
			{ timeMs: 100, cx: 0.4, cy: 0.5, cursorType: "text", interactionType: "click" },
		];

		expect(getCursorVisualState(samples, 120).cursorType).toBe("pointer");
		expect(getCursorVisualState(samples, 260).cursorType).toBe("text");
	});
});
