import { describe, expect, it } from "vitest";
import { TRANSITION_WINDOW_MS, ZOOM_IN_TRANSITION_WINDOW_MS } from "./constants";
import { computeRegionStrength } from "./zoomRegionUtils";

describe("autozoom exit motion", () => {
	it("eases out of a zoom without a first-frame scale jump", () => {
		const region = {
			id: "auto-1",
			startMs: 1000,
			endMs: 2500,
			depth: 3 as const,
			focus: { cx: 0.5, cy: 0.5 },
		};
		expect(computeRegionStrength(region, region.endMs)).toBe(1);
		expect(computeRegionStrength(region, region.endMs + 1000 / 60)).toBeGreaterThan(0.999);
		expect(computeRegionStrength(region, region.endMs + TRANSITION_WINDOW_MS)).toBe(0);
	});

	it("eases into a zoom without a first-frame scale jump", () => {
		const region = {
			id: "auto-2",
			startMs: 1500,
			endMs: 3000,
			depth: 3 as const,
			focus: { cx: 0.5, cy: 0.5 },
		};
		const leadInStart = region.startMs + 500 - ZOOM_IN_TRANSITION_WINDOW_MS;
		expect(computeRegionStrength(region, leadInStart)).toBe(0);
		expect(computeRegionStrength(region, leadInStart + 1000 / 60)).toBeLessThan(0.001);
		expect(computeRegionStrength(region, region.startMs + 500)).toBe(1);
	});
});
