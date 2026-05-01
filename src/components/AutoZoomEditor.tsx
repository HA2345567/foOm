import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { RecordingResult } from "../hooks/useScreenRecording";
import { generateZoomKeyframes, interpolateZoom } from "../lib/autoZoom";
import { drawComposite } from "../lib/composite";
import { BACKGROUNDS, DEFAULT_FRAME, type Background, type FrameStyle } from "../lib/backgrounds";
import { renderAutoZoom, type RenderProgress, type RenderOutput } from "../lib/renderZoom";

interface Props {
  recording: RecordingResult;
  onDiscard: () => void;
}

export function AutoZoomEditor({ recording, onDiscard }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);

  const [background, setBackground] = useState<Background>(BACKGROUNDS[0]);
  const [frame, setFrame] = useState<FrameStyle>(DEFAULT_FRAME);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [format, setFormat] = useState<"mp4" | "webm">("mp4");
  const [renderState, setRenderState] = useState<RenderProgress | null>(null);
  const [rendered, setRendered] = useState<RenderOutput | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const keyframes = useMemo(
    () =>
      generateZoomKeyframes(recording.clicks, recording.duration, {
        scrolls: recording.scrolls,
        pauses: recording.pauses,
      }),
    [recording],
  );

  // Live preview render loop — paints zoomed video onto canvas with chosen background
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d")!;
    const srcW = recording.width;
    const srcH = recording.height;

    // Match canvas to a reasonable preview resolution while keeping aspect
    const PREVIEW_W = 1280;
    const PREVIEW_H = Math.round((PREVIEW_W * srcH) / srcW);
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;

    const tick = () => {
      const t = video.currentTime;
      setCurrentTime(t);
      const kf = interpolateZoom(keyframes, t);
      drawComposite(ctx, video, kf, {
        background,
        frame,
        srcW,
        srcH,
        outW: PREVIEW_W,
        outH: PREVIEW_H,
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [background, frame, keyframes, recording]);

  const togglePlay = () => {
    const v = videoRef.current;
    const a = audioElRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      a?.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      a?.pause();
      setPlaying(false);
    }
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    const a = audioElRef.current;
    if (v) v.currentTime = t;
    if (a) a.currentTime = t;
  };

  const handleExport = async () => {
    setRenderError(null);
    setRendered(null);
    try {
      const out = await renderAutoZoom(recording, {
        format,
        background,
        frame,
        onProgress: (p) => setRenderState(p),
      });
      setRendered(out);
      // Auto-trigger download
      const a = document.createElement("a");
      a.href = out.url;
      a.download = `zoomcast-${Date.now()}.${out.format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error(e);
      setRenderError(e instanceof Error ? e.message : "Render failed");
    } finally {
      setRenderState(null);
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-7xl grid lg:grid-cols-[1fr_320px] gap-6">
      {/* Preview */}
      <div className="space-y-4">
        <div
          className="relative rounded-2xl overflow-hidden border border-border shadow-2xl"
          style={{ background: background.css }}
        >
          <canvas ref={canvasRef} className="w-full h-auto block" />
          {/* Hidden source video — provides frames to canvas */}
          <video
            ref={videoRef}
            src={recording.url}
            muted
            playsInline
            className="hidden"
            onEnded={() => setPlaying(false)}
          />
          <audio ref={audioElRef} src={recording.url} className="hidden" />
        </div>

        {/* Transport */}
        <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-90 transition-opacity"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            )}
          </button>
          <span className="font-display text-xs text-muted-foreground tabular-nums w-12">
            {fmtTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={recording.duration}
            step={0.01}
            value={currentTime}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="flex-1 accent-foreground"
          />
          <span className="font-display text-xs text-muted-foreground tabular-nums w-12">
            {fmtTime(recording.duration)}
          </span>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          ✨ Auto-zoom is active — preview shows clicks zooming in and easing out automatically.
        </p>
      </div>

      {/* Sidebar */}
      <aside className="space-y-6">
        {/* Backgrounds */}
        <section>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Background</h3>
          <div className="grid grid-cols-4 gap-2">
            {BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                onClick={() => setBackground(bg)}
                className={`aspect-square rounded-lg border-2 transition-all ${
                  background.id === bg.id
                    ? "border-foreground scale-105"
                    : "border-transparent hover:border-foreground/30"
                }`}
                style={{ background: bg.css }}
                title={bg.name}
                aria-label={bg.name}
              />
            ))}
          </div>
        </section>

        {/* Frame controls */}
        <section className="space-y-4">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Frame</h3>
          <Slider
            label="Padding"
            value={frame.padding}
            min={0}
            max={0.18}
            step={0.005}
            display={`${Math.round(frame.padding * 100)}%`}
            onChange={(v) => setFrame((f) => ({ ...f, padding: v }))}
          />
          <Slider
            label="Corners"
            value={frame.radius}
            min={0}
            max={48}
            step={1}
            display={`${frame.radius}px`}
            onChange={(v) => setFrame((f) => ({ ...f, radius: v }))}
          />
          <Slider
            label="Shadow"
            value={frame.shadow}
            min={0}
            max={80}
            step={1}
            display={`${frame.shadow}px`}
            onChange={(v) => setFrame((f) => ({ ...f, shadow: v }))}
          />
        </section>

        {/* Stats */}
        <section className="p-3 rounded-xl bg-card border border-border space-y-1">
          <p className="text-xs text-muted-foreground">Auto-detected events</p>
          <div className="flex justify-between text-sm">
            <span className="text-foreground">{recording.clicks.length} clicks</span>
            <span className="text-foreground">{recording.scrolls.length} scrolls</span>
            <span className="text-foreground">{recording.pauses.length} pauses</span>
          </div>
        </section>

        {/* Export */}
        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Export</h3>
          <div className="grid grid-cols-2 gap-2">
            {(["mp4", "webm"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`py-2 rounded-lg text-xs font-medium transition-colors ${
                  format === f
                    ? "bg-foreground text-background"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>

          {renderState && (
            <div className="p-3 rounded-lg border border-border bg-card">
              <div className="flex justify-between text-xs mb-2">
                <span className="capitalize text-foreground">{renderState.stage}…</span>
                <span className="tabular-nums text-muted-foreground">{renderState.percent}%</span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full bg-primary"
                  animate={{ width: `${renderState.percent}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}

          {renderError && (
            <p className="text-xs text-destructive">{renderError}</p>
          )}

          <button
            onClick={handleExport}
            disabled={!!renderState}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            {renderState ? "Rendering…" : rendered ? "Re-export" : `Export ${format.toUpperCase()}`}
          </button>

          <button
            onClick={onDiscard}
            className="w-full py-2 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Discard & Record Again
          </button>
        </section>
      </aside>
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{props.label}</span>
        <span className="text-foreground tabular-nums">{props.display}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        className="w-full accent-foreground"
      />
    </div>
  );
}
