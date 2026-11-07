import { describe, expect, it } from "vitest";
import {
	StreamingVideoDecoder,
	shouldFailDecodeEndedEarly,
	validateDuration,
} from "./streamingDecoder";

describe("export timeline metrics", () => {
	function decoder() {
		const instance = new StreamingVideoDecoder();
		Object.assign(instance, { metadata: { duration: 10 } });
		return instance;
	}

	it("removes the union of nested cuts once", () => {
		expect(
			decoder().getExportMetrics(30, [
				{ id: "outer", startMs: 1000, endMs: 7000 },
				{ id: "inner", startMs: 2000, endMs: 3000 },
			]),
		).toEqual({ effectiveDuration: 4, totalFrames: 120 });
	});

	it("does not export past the source for out-of-bounds cuts", () => {
		expect(decoder().getExportMetrics(30, [{ id: "cut", startMs: 15000, endMs: 20000 }])).toEqual({
			effectiveDuration: 10,
			totalFrames: 300,
		});
	});

	it("uses the first active speed for overlapping edits and ignores zero speeds", () => {
		expect(
			decoder().getExportMetrics(
				30,
				[],
				[
					{ id: "first", startMs: 1000, endMs: 6000, speed: 2 },
					{ id: "nested", startMs: 2000, endMs: 4000, speed: 4 },
					{ id: "invalid", startMs: 7000, endMs: 8000, speed: 0 },
				],
			),
		).toEqual({ effectiveDuration: 7.5, totalFrames: 225 });
	});
});

describe("validateDuration", () => {
	it("returns scanned duration when container reports Infinity", () => {
		expect(validateDuration(Infinity, 15.3)).toBe(15.3);
	});

	it("returns scanned duration when container reports 0", () => {
		expect(validateDuration(0, 15.3)).toBe(15.3);
	});

	it("returns scanned duration when container reports NaN", () => {
		expect(validateDuration(NaN, 15.3)).toBe(15.3);
	});

	it("returns scanned duration when container is inflated beyond threshold", () => {
		expect(validateDuration(42, 15.3)).toBe(15.3);
	});

	it("returns container duration when values are close", () => {
		expect(validateDuration(15.5, 15.3)).toBe(15.5);
	});

	it("returns container duration when scanned is slightly higher", () => {
		// container < scanned (scanned overshoot from last frame duration)
		expect(validateDuration(15.0, 15.3)).toBe(15.0);
	});

	it("returns scanned duration when container under-reports beyond threshold", () => {
		expect(validateDuration(10, 15.3)).toBe(15.3);
	});

	it("returns container duration when scanned is zero (corrupted/empty file)", () => {
		expect(validateDuration(10, 0)).toBe(10);
	});

	it("returns 0 when both container is NaN and scanned is zero", () => {
		expect(validateDuration(NaN, 0)).toBe(0);
	});
});

describe("shouldFailDecodeEndedEarly", () => {
	it("does not fail once every segment has been satisfied", () => {
		expect(
			shouldFailDecodeEndedEarly({
				cancelled: false,
				lastDecodedFrameSec: 5.33,
				requiredEndSec: 6.498,
				streamDurationSec: 5.33,
			}),
		).toBe(false);
	});

	it("fails when decode stops far before the required end", () => {
		expect(
			shouldFailDecodeEndedEarly({
				cancelled: false,
				lastDecodedFrameSec: 5.33,
				requiredEndSec: 10,
				streamDurationSec: 5.33,
			}),
		).toBe(true);
	});

	it("fails when no frame could be decoded for a non-empty timeline", () => {
		expect(
			shouldFailDecodeEndedEarly({
				cancelled: false,
				lastDecodedFrameSec: null,
				requiredEndSec: 1,
			}),
		).toBe(true);
	});

	it("fails when the decoder has not reached the reported stream end", () => {
		expect(
			shouldFailDecodeEndedEarly({
				cancelled: false,
				lastDecodedFrameSec: 4.9,
				requiredEndSec: 6.498,
				streamDurationSec: 5.33,
			}),
		).toBe(true);
	});
});
