/**
 * Analyzes an AudioBuffer to find periods of significant audio (non-silence).
 */
export interface AudioSegment {
  start: number;
  end: number;
}

export async function detectSilence(
  audioBuffer: AudioBuffer,
  options: {
    threshold?: number; // 0 to 1, volume threshold for silence
    minSilenceDuration?: number; // seconds, minimum duration to consider it silence
    minAudioDuration?: number; // seconds, minimum duration to keep a segment
    padding?: number; // seconds, add padding around audio segments
  } = {}
): Promise<AudioSegment[]> {
  const {
    threshold = 0.02,
    minSilenceDuration = 0.4,
    minAudioDuration = 0.2,
    padding = 0.1,
  } = options;

  const sampleRate = audioBuffer.sampleRate;
  const data = audioBuffer.getChannelData(0); // Use first channel for analysis
  const step = Math.floor(sampleRate * 0.05); // Sample every 50ms
  
  const segments: AudioSegment[] = [];
  let isSilent = true;
  let segmentStart = 0;

  for (let i = 0; i < data.length; i += step) {
    // Calculate RMS volume for this window
    let sum = 0;
    const windowEnd = Math.min(i + step, data.length);
    for (let j = i; j < windowEnd; j++) {
      sum += data[j] * data[j];
    }
    const rms = Math.sqrt(sum / (windowEnd - i));
    const time = i / sampleRate;

    if (isSilent && rms > threshold) {
      // Audio started
      isSilent = false;
      segmentStart = Math.max(0, time - padding);
    } else if (!isSilent && rms <= threshold) {
      // Potential silence started
      // We need to look ahead to see if it stays silent for minSilenceDuration
      let stillSilent = true;
      const lookAheadSteps = Math.floor(minSilenceDuration * sampleRate / step);
      for (let k = 1; k < lookAheadSteps; k++) {
        const nextIdx = i + k * step;
        if (nextIdx >= data.length) break;
        
        let nextSum = 0;
        const nextWindowEnd = Math.min(nextIdx + step, data.length);
        for (let j = nextIdx; j < nextWindowEnd; j++) {
          nextSum += data[j] * data[j];
        }
        const nextRms = Math.sqrt(nextSum / (nextWindowEnd - nextIdx));
        if (nextRms > threshold) {
          stillSilent = false;
          break;
        }
      }

      if (stillSilent) {
        isSilent = true;
        const segmentEnd = Math.min(audioBuffer.duration, time + padding);
        if (segmentEnd - segmentStart >= minAudioDuration) {
          segments.push({ start: segmentStart, end: segmentEnd });
        }
      }
    }
  }

  // Close last segment if needed
  if (!isSilent) {
    const segmentEnd = audioBuffer.duration;
    if (segmentEnd - segmentStart >= minAudioDuration) {
      segments.push({ start: segmentStart, end: segmentEnd });
    }
  }

  // Merge segments that are very close to each other
  const merged: AudioSegment[] = [];
  if (segments.length > 0) {
    let current = segments[0];
    for (let i = 1; i < segments.length; i++) {
      const next = segments[i];
      if (next.start - current.end < 0.2) {
        current.end = next.end;
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
  }

  return merged;
}
