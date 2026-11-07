import type { CursorTelemetryPoint, ZoomFocus } from "../types";

// Ignore short UI hovers (window chrome, tooltips, taskbar) that are not a
// deliberate reading pause. Clicks still create immediate candidates below.
export const MIN_DWELL_DURATION_MS = 600;
export const MAX_DWELL_DURATION_MS = 2600;
export const DWELL_RADIUS_THRESHOLD = 0.018;
export const MAX_DWELL_SAMPLE_GAP_MS = 500;
export const DOUBLE_CLICK_WINDOW_MS = 350;
export const DOUBLE_CLICK_DISTANCE = 0.02;
/** Minimum spacing between two accepted suggestion centres. */
export const SUGGESTION_SPACING_MS = 1800;
const CLICK_ZOOM_DURATION_MS = 2200;
const DOUBLE_CLICK_ZOOM_DURATION_MS = 2600;
const CONTEXT_ZOOM_DURATION_MS = 1800;

export interface ZoomDwellCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
	strength: number;
}

function normalizeTelemetrySample(
	sample: CursorTelemetryPoint,
	totalMs: number,
): CursorTelemetryPoint {
	return {
		timeMs: Math.max(0, Math.min(sample.timeMs, totalMs)),
		cx: Math.max(0, Math.min(sample.cx, 1)),
		cy: Math.max(0, Math.min(sample.cy, 1)),
		visible: sample.visible,
		interactionType: sample.interactionType,
		cursorType: sample.cursorType,
	};
}

function getTimeWeightedFocus(samples: CursorTelemetryPoint[]): ZoomFocus {
	let totalWeight = 0;
	let weightedX = 0;
	let weightedY = 0;

	for (let index = 0; index < samples.length; index += 1) {
		const previousGap = index > 0 ? samples[index].timeMs - samples[index - 1].timeMs : 0;
		const nextGap = index < samples.length - 1 ? samples[index + 1].timeMs - samples[index].timeMs : 0;
		const weight = (previousGap + nextGap) / 2 || 1;
		totalWeight += weight;
		weightedX += samples[index].cx * weight;
		weightedY += samples[index].cy * weight;
	}

	return { cx: weightedX / totalWeight, cy: weightedY / totalWeight };
}

export function normalizeCursorTelemetry(
	telemetry: CursorTelemetryPoint[],
	totalMs: number,
): CursorTelemetryPoint[] {
	return [...telemetry]
		.filter(
			(sample) =>
				sample.visible !== false &&
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy),
		)
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((sample) => normalizeTelemetrySample(sample, totalMs));
}

export function detectZoomDwellCandidates(samples: CursorTelemetryPoint[]): ZoomDwellCandidate[] {
	if (samples.length < 2) {
		return [];
	}

	const dwellCandidates: ZoomDwellCandidate[] = [];
	let runStart = 0;

	const pushRunIfDwell = (startIndex: number, endIndexExclusive: number) => {
		if (endIndexExclusive - startIndex < 2) {
			return;
		}

		const start = samples[startIndex];
		const end = samples[endIndexExclusive - 1];
		const runDuration = end.timeMs - start.timeMs;
		if (runDuration < MIN_DWELL_DURATION_MS) {
			return;
		}

		const runSamples = samples.slice(startIndex, endIndexExclusive);
		const focus = getTimeWeightedFocus(runSamples);

		dwellCandidates.push({
			// Place the suggestion near the start of a long dwell; centering on the
			// entire run can move a long reading pause's zoom several minutes late.
			centerTimeMs: Math.round(start.timeMs + Math.min(runDuration, MAX_DWELL_DURATION_MS) / 2),
			focus,
			// Long reading pauses still matter, but should not crowd out clicks.
			strength: Math.min(runDuration, MAX_DWELL_DURATION_MS),
		});
	};

	for (let index = 1; index < samples.length; index += 1) {
		const prev = samples[index - 1];
		const curr = samples[index];
		const gapMs = curr.timeMs - prev.timeMs;
		const runAnchor = samples[runStart];
		const distanceFromRunAnchor = Math.hypot(curr.cx - runAnchor.cx, curr.cy - runAnchor.cy);

		if (
			gapMs > MAX_DWELL_SAMPLE_GAP_MS ||
			gapMs <= 0 ||
			distanceFromRunAnchor > DWELL_RADIUS_THRESHOLD
		) {
			pushRunIfDwell(runStart, index);
			runStart = index;
		}
	}
	pushRunIfDwell(runStart, samples.length);

	// Add click/double-click/right-click interactions as high-strength candidates
	const clickCandidates: ZoomDwellCandidate[] = [];
	let previousClick: CursorTelemetryPoint | null = null;
	for (const sample of samples) {
		const isClick =
			sample.interactionType === "click" ||
			sample.interactionType === "right-click" ||
			sample.interactionType === "middle-click";
		const isDoubleClick =
			sample.interactionType === "double-click" ||
			(isClick &&
			previousClick !== null &&
			sample.timeMs - previousClick.timeMs <= DOUBLE_CLICK_WINDOW_MS &&
			Math.hypot(sample.cx - previousClick.cx, sample.cy - previousClick.cy) <=
				DOUBLE_CLICK_DISTANCE);
		const interactionType = isDoubleClick ? "double-click" : sample.interactionType;
		if (
			interactionType === "click" ||
			interactionType === "double-click" ||
			interactionType === "right-click" ||
			interactionType === "middle-click"
		) {
			const clickPriority =
				interactionType === "double-click"
					? 3
					: interactionType === "right-click" || interactionType === "middle-click"
						? 2
						: 1;
			clickCandidates.push({
				centerTimeMs: sample.timeMs,
				focus: { cx: sample.cx, cy: sample.cy },
				strength: MAX_DWELL_DURATION_MS + clickPriority,
			});
		}
		if (isClick) previousClick = sample;
	}

	// Merge and sort by centerTimeMs
	const allCandidates = [...dwellCandidates, ...clickCandidates].sort(
		(a, b) => a.centerTimeMs - b.centerTimeMs,
	);

  // Cluster repeated candidates only when they target the same small area.
  // Rapid clicks on different controls are distinct user intent and must not
  // silently inherit whichever point happens to have the higher strength.
	const clusteredCandidates: ZoomDwellCandidate[] = [];
	for (const candidate of allCandidates) {
		if (clusteredCandidates.length === 0) {
			clusteredCandidates.push(candidate);
		} else {
			const last = clusteredCandidates[clusteredCandidates.length - 1];
      if (
        candidate.centerTimeMs - last.centerTimeMs < 500 &&
        Math.hypot(candidate.focus.cx - last.focus.cx, candidate.focus.cy - last.focus.cy) <=
          DOUBLE_CLICK_DISTANCE
      ) {
				// Keep the one with higher strength (clicks have priority)
				if (candidate.strength >= last.strength) {
					clusteredCandidates[clusteredCandidates.length - 1] = candidate;
				}
			} else {
				clusteredCandidates.push(candidate);
			}
		}
	}

	return clusteredCandidates;
}

export interface AutoZoomSuggestion {
	span: { start: number; end: number };
	focus: ZoomFocus;
}

/**
 * Build non-overlapping zoom suggestions from cursor telemetry: detect dwell moments,
 * rank by duration, space by SUGGESTION_SPACING_MS, drop any overlapping an existing
 * region. Pure, shared by the magic-wand toggle and the on-load auto-suggest pass.
 */
export function buildAutoZoomSuggestions(options: {
	cursorTelemetry: CursorTelemetryPoint[];
	totalMs: number;
	existingRegions: { startMs: number; endMs: number }[];
	defaultDurationMs: number;
}): AutoZoomSuggestion[] {
	const { cursorTelemetry, totalMs, existingRegions, defaultDurationMs } = options;
	if (totalMs <= 0 || cursorTelemetry.length < 2) {
		return [];
	}

	const defaultDuration = Math.min(defaultDurationMs, totalMs);
	if (defaultDuration <= 0) {
		return [];
	}

	const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);
	if (normalizedSamples.length < 2) {
		return [];
	}

	const dwellCandidates = detectZoomDwellCandidates(normalizedSamples);
	if (dwellCandidates.length === 0) {
		return [];
	}

	const reservedSpans = existingRegions
		.filter(
			(region) =>
				Number.isFinite(region.startMs) &&
				Number.isFinite(region.endMs) &&
				region.endMs > region.startMs,
		)
		.map((region) => ({
			start: Math.max(0, Math.min(region.startMs, totalMs)),
			end: Math.max(0, Math.min(region.endMs, totalMs)),
		}))
		.filter((region) => region.end > region.start)
		.sort((a, b) => a.start - b.start);

	const sortedCandidates = [...dwellCandidates].sort(
		(a, b) => b.strength - a.strength || a.centerTimeMs - b.centerTimeMs,
	);
	const acceptedCenters: number[] = [];
	const suggestions: AutoZoomSuggestion[] = [];

	for (const candidate of sortedCandidates) {
		const tooCloseToAccepted = acceptedCenters.some(
			(center) => Math.abs(center - candidate.centerTimeMs) < SUGGESTION_SPACING_MS,
		);
		if (tooCloseToAccepted) {
			continue;
		}

		const durationByIntent =
			candidate.strength > MAX_DWELL_DURATION_MS
				? candidate.strength >= MAX_DWELL_DURATION_MS + 3
					? DOUBLE_CLICK_ZOOM_DURATION_MS
					: candidate.strength >= MAX_DWELL_DURATION_MS + 2
						? CONTEXT_ZOOM_DURATION_MS
						: CLICK_ZOOM_DURATION_MS
				: Math.min(3200, Math.max(CONTEXT_ZOOM_DURATION_MS, 1200 + candidate.strength * 0.5));
		const duration = Math.min(defaultDuration, durationByIntent, totalMs);
		const centeredStart = Math.round(candidate.centerTimeMs - duration / 2);
		const candidateStart = Math.max(0, Math.min(centeredStart, totalMs - duration));
		const candidateEnd = candidateStart + duration;
		const hasOverlap = reservedSpans.some(
			(span) => candidateEnd > span.start && candidateStart < span.end,
		);
		if (hasOverlap) {
			continue;
		}

		reservedSpans.push({ start: candidateStart, end: candidateEnd });
		acceptedCenters.push(candidate.centerTimeMs);
		suggestions.push({
			span: { start: candidateStart, end: candidateEnd },
			focus: candidate.focus,
		});
	}

	return suggestions.sort((a, b) => a.span.start - b.span.start);
}
