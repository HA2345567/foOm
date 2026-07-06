import { useEffect, useState } from "react";

/**
 * Extracts audio peak data from a video URL for waveform visualisation.
 * Returns a Float32Array of normalised peak values (0–1), or null while loading.
 */
export function useAudioPeaks(videoUrl: string | undefined): Float32Array | null {
	const [peaks, setPeaks] = useState<Float32Array | null>(null);

	useEffect(() => {
		if (!videoUrl) {
			setPeaks(null);
			return;
		}

		let cancelled = false;
		const AudioContextClass =
			window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

		if (!AudioContextClass) {
			setPeaks(null);
			return;
		}

		const ctx = new AudioContextClass();

		fetch(videoUrl)
			.then((res) => res.arrayBuffer())
			.then((buffer) => ctx.decodeAudioData(buffer))
			.then((audioBuffer) => {
				if (cancelled) return;

				const channel = audioBuffer.getChannelData(0);
				const buckets = 512;
				const bucketSize = Math.floor(channel.length / buckets);
				const result = new Float32Array(buckets);

				for (let i = 0; i < buckets; i++) {
					let max = 0;
					const start = i * bucketSize;
					for (let j = start; j < start + bucketSize && j < channel.length; j++) {
						const abs = Math.abs(channel[j]);
						if (abs > max) max = abs;
					}
					result[i] = max;
				}

				setPeaks(result);
			})
			.catch(() => {
				if (!cancelled) setPeaks(null);
			})
			.finally(() => {
				void ctx.close();
			});

		return () => {
			cancelled = true;
		};
	}, [videoUrl]);

	return peaks;
}
