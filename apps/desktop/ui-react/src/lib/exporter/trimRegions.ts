/** Clamp and merge cut ranges so overlapping edits never duplicate exported media. */
export function normalizeTrimRegions<T extends { startMs: number; endMs: number }>(
	regions: T[] | undefined,
	durationMs: number,
): T[] {
	const sorted = (regions ?? [])
		.filter((region) => Number.isFinite(region.startMs) && Number.isFinite(region.endMs))
		.map((region) => ({
			...region,
			startMs: Math.max(0, Math.min(durationMs, region.startMs)),
			endMs: Math.max(0, Math.min(durationMs, region.endMs)),
		}))
		.filter((region) => region.endMs > region.startMs)
		.sort((a, b) => a.startMs - b.startMs);
	const merged: T[] = [];
	for (const region of sorted) {
		const previous = merged[merged.length - 1];
		if (previous && region.startMs <= previous.endMs) {
			previous.endMs = Math.max(previous.endMs, region.endMs);
		} else {
			merged.push(region);
		}
	}
	return merged;
}
