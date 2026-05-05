import { useEffect, useRef, useState } from "react";

interface Props {
  stream: MediaStream | null;
  /** number of vertical bars */
  bars?: number;
  className?: string;
}

/**
 * Live microphone level meter — renders an animated equalizer that reflects
 * real input volume from the mic stream. Uses Web Audio AnalyserNode.
 */
export function MicMeter({ stream, bars = 12, className = "" }: Props) {
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(0));
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevels(Array(bars).fill(0));
      return;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / bars);
      const next: number[] = [];
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j];
        next.push(Math.min(1, sum / step / 180));
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      source.disconnect();
      analyser.disconnect();
      ctx.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [stream, bars]);

  return (
    <div
      className={`flex items-end gap-0.5 h-5 ${className}`}
      aria-label="Microphone input level"
    >
      {levels.map((l, i) => (
        <div
          key={i}
          className="w-0.5 rounded-full bg-primary transition-[height] duration-75"
          style={{ height: `${Math.max(8, l * 100)}%` }}
        />
      ))}
    </div>
  );
}
