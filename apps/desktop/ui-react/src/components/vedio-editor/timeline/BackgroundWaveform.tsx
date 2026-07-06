import { useEffect, useRef } from "react";
import { useTimelineContext } from "dnd-timeline";

interface BackgroundWaveformProps {
	peaks: Float32Array | null;
	videoDurationMs: number;
	topInset?: number;
	bottomInset?: number;
}

/**
 * Renders an audio waveform as a canvas background for the trim row in the timeline.
 * The waveform is clipped to the currently visible timeline range.
 */
export default function BackgroundWaveform({
	peaks,
	videoDurationMs,
	topInset = 0,
	bottomInset = 0,
}: BackgroundWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { range } = useTimelineContext();

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !peaks || peaks.length === 0 || videoDurationMs <= 0) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const { width, height } = canvas;
		const drawHeight = height - topInset - bottomInset;
		if (drawHeight <= 0) return;

		ctx.clearRect(0, 0, width, height);

		const visibleStart = range.start;
		const visibleEnd = range.end;
		const visibleDuration = visibleEnd - visibleStart;

		ctx.fillStyle = "rgba(52, 178, 123, 0.25)";

		for (let px = 0; px < width; px++) {
			const timeMs = visibleStart + (px / width) * visibleDuration;
			const peakIndex = Math.floor((timeMs / videoDurationMs) * peaks.length);
			const peak = peaks[Math.max(0, Math.min(peaks.length - 1, peakIndex))] ?? 0;
			const barHeight = peak * drawHeight;
			const y = topInset + (drawHeight - barHeight) / 2;
			ctx.fillRect(px, y, 1, barHeight);
		}
	}, [peaks, videoDurationMs, range, topInset, bottomInset]);

	return (
		<canvas
			ref={canvasRef}
			className="absolute inset-0 w-full h-full pointer-events-none"
			style={{ width: "100%", height: "100%" }}
			// Actual pixel dimensions are managed via CSS; canvas is redrawn on each range change
			width={512}
			height={36}
		/>
	);
}
