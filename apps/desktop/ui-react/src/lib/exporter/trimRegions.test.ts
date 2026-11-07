import { describe, expect, it } from "vitest";
import { normalizeTrimRegions } from "./trimRegions";

describe("normalizeTrimRegions", () => {
	it("merges nested and overlapping cuts without moving the timeline backwards", () => {
		const regions = [
			{ startMs: 1000, endMs: 6000 },
			{ startMs: 2000, endMs: 3000 },
			{ startMs: 5000, endMs: 7000 },
		];
		expect(normalizeTrimRegions(regions, 10000)).toEqual([{ startMs: 1000, endMs: 7000 }]);
		expect(regions[0].endMs).toBe(6000);
	});

	it("clamps cuts to the source and ignores invalid or reversed ranges", () => {
		expect(
			normalizeTrimRegions(
				[
					{ startMs: -2000, endMs: 1000 },
					{ startMs: 9000, endMs: 20000 },
					{ startMs: 5000, endMs: 4000 },
					{ startMs: NaN, endMs: 4000 },
				],
				10000,
			),
		).toEqual([
			{ startMs: 0, endMs: 1000 },
			{ startMs: 9000, endMs: 10000 },
		]);
	});
});
