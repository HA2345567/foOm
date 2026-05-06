import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { RecordingResult, ClickEvent } from "../hooks/useScreenRecording";
import { generateZoomKeyframes, interpolateZoom } from "../lib/autoZoom";
import { drawComposite } from "../lib/composite";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { transcribeAudioAI, detectInterestAI } from "../lib/gemini";
import { detectInterestPoints } from "../lib/detectInterest";
import { renderAutoZoom, type RenderProgress, type RenderOutput, type RenderFormat } from "../lib/renderZoom";
import {
  BACKGROUNDS,
  RAYCAST_BG_IDS,
  DEFAULT_FRAME,
  type Background,
  type FrameStyle,
  type Subtitle,
} from "../lib/backgrounds";



interface Props {
  recording: RecordingResult;
  onDiscard: () => void;
}

export function AutoZoomEditor({ recording, onDiscard }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);

  const [background, setBackground] = useState<Background>(() => {
    const saved = localStorage.getItem("zoomly_background");
    if (saved) {
      const found = BACKGROUNDS.find(b => b.id === saved);
      if (found) return found;
    }
    return BACKGROUNDS[0];
  });
  const [frame, setFrame] = useState<FrameStyle>(() => {
    const saved = localStorage.getItem("zoomly_frame");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return DEFAULT_FRAME; }
    }
    return DEFAULT_FRAME;
  });
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [renderState, setRenderState] = useState<RenderProgress | null>(null);
  const [rendered, setRendered] = useState<RenderOutput | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [quality, setQuality] = useState<360 | 480 | 720 | 1080>(() => {
    const saved = localStorage.getItem("zoomly_quality");
    if (saved) return parseInt(saved) as any;
    return 720;
  });
  const [format, setFormat] = useState<RenderFormat>(() => {
    const saved = localStorage.getItem("zoomly_format");
    return (saved === "webm" ? "webm" : "mp4") as RenderFormat;
  });

  useEffect(() => {
    localStorage.setItem("zoomly_background", background.id);
  }, [background]);

  useEffect(() => {
    localStorage.setItem("zoomly_frame", JSON.stringify(frame));
  }, [frame]);

  useEffect(() => {
    localStorage.setItem("zoomly_quality", quality.toString());
  }, [quality]);

  useEffect(() => {
    localStorage.setItem("zoomly_format", format);
  }, [format]);

  // AI Subtitles
  const [subtitles, setSubtitles] = useState<Subtitle[] | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  // Auto-detected interest points (used when no real clicks were captured)


  const [autoClicks, setAutoClicks] = useState<ClickEvent[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [isAIVision, setIsAIVision] = useState(false);

  // If no real clicks were captured, analyze the video for interest points
  useEffect(() => {
    if (recording.clicks.length > 0) return;
    let cancelled = false;
    setAnalyzing(true);

    const useAI = !!import.meta.env.VITE_GEMINI_API_KEY;
    setIsAIVision(useAI);

    const detector = useAI ? detectInterestAI : detectInterestPoints;

    detector(recording.url, recording.duration)
      .then((points) => {
        if (!cancelled) setAutoClicks(points);
      })
      .catch((e) => {
        console.warn("interest detection failed", e);
        // Fallback if AI fails
        if (useAI && !cancelled) {
          setIsAIVision(false);
          detectInterestPoints(recording.url, recording.duration)
            .then(p => !cancelled && setAutoClicks(p));
        }
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [recording]);


  const effectiveClicks = recording.clicks.length > 0 ? recording.clicks : (autoClicks ?? []);
  const isAuto = recording.clicks.length === 0 && (autoClicks?.length ?? 0) > 0;

  const keyframes = useMemo(
    () =>
      generateZoomKeyframes(effectiveClicks, recording.duration, {
        scrolls: recording.scrolls,
        pauses: recording.pauses,
      }),
    [effectiveClicks, recording],
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

    let lastT = -1;
    const tick = () => {
      const t = video.currentTime;
      if (Math.abs(t - lastT) > 0.05) {
        setCurrentTime(t);
        lastT = t;
      }
      const kf = interpolateZoom(keyframes, t);
      drawComposite(ctx, video, kf, {
        background,
        frame,
        subtitles: subtitles || undefined,
        currentTime: t,
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
  }, [background, frame, keyframes, subtitles, recording]);

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
        quality,
        background,
        frame,
        subtitles: subtitles || undefined,
        clicksOverride: effectiveClicks,
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

        {/* Backgrounds moved to 'down side' of video */}
        <div className="pt-6 border-t border-border space-y-6">
          <section className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Raycast Wallpapers</h3>
                <span className="text-[9px] uppercase tracking-widest text-primary/80 font-bold">Pro</span>
              </div>
              <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
                {BACKGROUNDS.filter(bg => RAYCAST_BG_IDS.includes(bg.id)).map((bg) => (
                  <BackgroundButton key={bg.id} bg={bg} active={background.id === bg.id} onClick={() => setBackground(bg)} />
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-2.5">Professional Scenes</h3>
              <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
                {BACKGROUNDS.filter(bg => bg.id.startsWith('pro_')).map((bg) => (
                  <BackgroundButton key={bg.id} bg={bg} active={background.id === bg.id} onClick={() => setBackground(bg)} />
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-2.5">Dark Glow</h3>
              <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
                {BACKGROUNDS.filter(bg => ["crimson", "ember", "gold", "neon_lime", "sapphire", "arctic", "violet", "amethyst", "rose", "magenta", "teal", "emerald", "copper", "infrared"].includes(bg.id)).map((bg) => (
                  <BackgroundButton key={bg.id} bg={bg} active={background.id === bg.id} onClick={() => setBackground(bg)} />
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-2.5">Minimal & Pro</h3>
              <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
                {BACKGROUNDS.filter(bg => ["slate", "studio", "warm_white", "white", "black", "obsidian", "midnight", "carbon", "deep_space"].includes(bg.id)).map((bg) => (
                  <BackgroundButton key={bg.id} bg={bg} active={background.id === bg.id} onClick={() => setBackground(bg)} />
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-2.5">Creative</h3>
              <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
                {BACKGROUNDS.filter(bg => !bg.id.startsWith('pro_') && !RAYCAST_BG_IDS.includes(bg.id) && !["crimson", "ember", "gold", "neon_lime", "sapphire", "arctic", "violet", "amethyst", "rose", "magenta", "teal", "emerald", "copper", "infrared", "slate", "studio", "warm_white", "white", "black", "obsidian", "midnight", "carbon", "deep_space"].includes(bg.id)).map((bg) => (
                  <BackgroundButton key={bg.id} bg={bg} active={background.id === bg.id} onClick={() => setBackground(bg)} />
                ))}
              </div>
            </div>
          </section>
        </div>

      </div>


      {/* Sidebar */}
      <aside className="space-y-6">



        {/* Frame controls */}
        <section className="space-y-4">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">AI Features</h3>
          <button
            onClick={async () => {
              if (subtitles) {
                setSubtitles(null);
                return;
              }
              setTranscribing(true);
              try {
                const subs = await transcribeAudioAI(recording.blob);
                setSubtitles(subs);
              } catch (e) {
                console.error(e);
              } finally {
                setTranscribing(false);
              }
            }}
            disabled={transcribing}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
              subtitles ? "border-primary/30 bg-primary/5" : "border-border bg-card hover:border-foreground/20"
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${subtitles ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {transcribing ? (
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              )}
            </div>
            <div className="text-left flex-1">
              <p className="text-xs font-bold text-foreground">AI Subtitles</p>
              <p className="text-[10px] text-muted-foreground">
                {transcribing ? "Transcribing audio…" : subtitles ? "Captions active" : "Generate captions"}
              </p>
            </div>
            <div className={`w-8 h-5 rounded-full p-0.5 transition-colors ${subtitles ? "bg-primary" : "bg-muted"}`}>
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${subtitles ? "translate-x-3" : "translate-x-0 shadow-sm"}`} />
            </div>
          </button>

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
        <section className="p-3 rounded-xl bg-card border border-border space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Zoom moments</p>
            {isAuto && (
              <span className={`text-[10px] uppercase font-bold tracking-widest ${
                isAIVision 
                  ? "bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-500 animate-shimmer" 
                  : "text-primary"
              }`}>
                {isAIVision ? "AI Vision active" : "AI-detected"}
              </span>
            )}
            {analyzing && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground animate-pulse">
                {isAIVision ? "AI Analyzing…" : "Analyzing…"}
              </span>
            )}
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-foreground tabular-nums">{effectiveClicks.length} zooms</span>
            <span className="text-foreground tabular-nums">{recording.scrolls.length} scrolls</span>
            <span className="text-foreground tabular-nums">{recording.pauses.length} pauses</span>
          </div>
          {analyzing && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              No clicks were captured (browsers can't see clicks outside this tab).
              Detecting motion in your video to auto-zoom on the busiest moments…
            </p>
          )}
          {isAuto && !analyzing && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              Auto-zoom focused on {effectiveClicks.length} interest points detected from screen motion.
            </p>
          )}
        </section>

        {/* Export / Download Options */}
        <section className="space-y-4">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-bold ml-1">Quality</p>
            <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-card border border-border shadow-inner">
              {[360, 480, 720, 1080].map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q as any)}
                  className={`py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                    quality === q
                      ? "bg-foreground text-background shadow-sm scale-100"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50 scale-95"
                  }`}
                >
                  {q}P
                </button>
              ))}
            </div>
          </div>

          {renderState && (
            <div className="p-3 rounded-xl border border-border bg-card/50 backdrop-blur-sm shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center text-[10px] mb-2 px-0.5">
                <span className="capitalize text-muted-foreground font-medium flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-primary animate-pulse" />
                  {renderState.stage}…
                </span>
                <span className="tabular-nums text-foreground font-semibold">{renderState.percent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.4)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${renderState.percent}%` }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>
            </div>
          )}

          {rendered && !renderState && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-primary/10 border border-primary/20 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-primary flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Render Complete
                </p>
                <span className="text-[10px] text-primary/70 font-mono">
                  {(rendered.blob.size / (1024 * 1024)).toFixed(1)}MB
                </span>
              </div>
              <button
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = rendered.url;
                  a.download = `zoomcast-${Date.now()}.${rendered.format}`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
                className="w-full py-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
                Download {rendered.format.toUpperCase()}
              </button>
            </motion.div>
          )}

          {renderError && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 space-y-2 animate-in fade-in slide-in-from-top-1">
              <p className="text-xs font-bold text-destructive uppercase tracking-widest">Export Error</p>
              <p className="text-xs text-destructive/90 leading-relaxed font-medium">{renderError}</p>
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={!!renderState}
            className={`w-full py-3.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2.5 ${
              renderState 
                ? "bg-muted text-muted-foreground cursor-not-allowed" 
                : rendered 
                  ? "bg-secondary text-secondary-foreground hover:bg-secondary/80" 
                  : "bg-foreground text-background hover:opacity-90 shadow-xl shadow-foreground/10"
            }`}
          >
            {renderState ? (
              <>
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Processing…
              </>
            ) : rendered ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Regenerate Video
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
                Export Video
              </>
            )}
          </button>
          
          <button
            onClick={() => {
              const a = document.createElement("a");
              a.href = recording.url;
              a.download = `zoomcast-raw-${Date.now()}.webm`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }}
            className="w-full py-3 rounded-xl border border-border bg-card text-muted-foreground text-xs font-semibold hover:text-foreground hover:bg-accent transition-all flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            Simple Download (Original)
          </button>

          <button
            onClick={onDiscard}
            className="w-full py-2 text-[10px] text-muted-foreground/50 hover:text-destructive transition-colors"
          >
            Discard Recording
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

function BackgroundButton({ bg, active, onClick }: { bg: Background; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`aspect-square rounded-lg border-2 transition-all relative overflow-hidden ${
        active ? "border-foreground scale-105 z-10 shadow-lg" : "border-transparent hover:border-foreground/30"
      }`}
      style={{ background: bg.css }}
      title={bg.name}
      aria-label={bg.name}
    />
  );
}

