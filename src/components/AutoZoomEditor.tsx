import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { RecordingResult, ClickEvent } from "../hooks/useScreenRecording";
import { generateZoomKeyframes, interpolateZoom } from "../lib/autoZoom";
import { drawComposite } from "../lib/composite";
import { transcribeAudioAI } from "../lib/gemini";
import { detectInterestPoints } from "../lib/detectInterest";
import { renderAutoZoom, type RenderProgress, type RenderOutput, type RenderFormat } from "../lib/renderZoom";
import {
  BACKGROUNDS,
  RAYCAST_BG_IDS,
  DEFAULT_FRAME,
  type Background,
  type BackgroundCategory,
  type FrameStyle,
  type Subtitle,
} from "../lib/backgrounds";

interface Props {
  recording: RecordingResult;
  onDiscard: () => void;
}

export function AutoZoomEditor({ recording, onDiscard }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
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

  const [selectedCategory, setSelectedCategory] = useState<BackgroundCategory>("wallpaper");
  const [cameraX, setCameraX] = useState(0.85);
  const [cameraY, setCameraY] = useState(0.82);
  const [cameraSize, setCameraSize] = useState(0.16);
  const [cameraShape, setCameraShape] = useState<"circle" | "square" | "rounded">(recording.cameraShape || "circle");
  const [showCamera, setShowCamera] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => { localStorage.setItem("zoomly_background", background.id); }, [background]);
  useEffect(() => { localStorage.setItem("zoomly_frame", JSON.stringify(frame)); }, [frame]);
  useEffect(() => { localStorage.setItem("zoomly_quality", quality.toString()); }, [quality]);
  useEffect(() => { localStorage.setItem("zoomly_format", format); }, [format]);

  // AI Subtitles
  const [subtitles, setSubtitles] = useState<Subtitle[] | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  // Auto-detected interest points
  const [autoClicks, setAutoClicks] = useState<ClickEvent[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (recording.clicks.length > 0) return;
    let cancelled = false;
    setAnalyzing(true);
    detectInterestPoints(recording.url, recording.duration)
      .then((points) => { if (!cancelled) setAutoClicks(points); })
      .finally(() => { if (!cancelled) setAnalyzing(false); });
    return () => { cancelled = true; };
  }, [recording]);

  const effectiveClicks = recording.clicks.length > 0 ? recording.clicks : (autoClicks ?? []);
  const isAuto = recording.clicks.length === 0 && (autoClicks?.length ?? 0) > 0;

  const keyframes = useMemo(
    () => generateZoomKeyframes(effectiveClicks, recording.duration, { scrolls: recording.scrolls, pauses: recording.pauses }),
    [effectiveClicks, recording],
  );

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d")!;
    const container = canvas.parentElement!;
    const srcW = video.videoWidth || recording.width || 1280;
    const srcH = video.videoHeight || recording.height || 720;
    const aspect = srcW / srcH;
    const PREVIEW_W = container.clientWidth;
    const PREVIEW_H = PREVIEW_W / aspect;
    canvas.width = PREVIEW_W; canvas.height = PREVIEW_H;

    let lastT = -1;
    const tick = () => {
      const t = video.currentTime;
      if (Math.abs(t - lastT) > 0.05) { setCurrentTime(t); lastT = t; }
      const kf = interpolateZoom(keyframes, t);
      const cam = cameraRef.current;
      if (cam) cam.currentTime = t;
      drawComposite(ctx, video, kf, {
        background, frame, subtitles: subtitles || undefined, currentTime: t,
        srcW, srcH, outW: PREVIEW_W, outH: PREVIEW_H,
        camera: (showCamera && cam) ? cam : undefined,
        cameraX, cameraY, cameraSize, cameraShape,
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [background, frame, keyframes, subtitles, recording, showCamera, cameraX, cameraY, cameraSize, cameraShape]);

  const togglePlay = () => {
    const v = videoRef.current; const c = cameraRef.current; const a = audioElRef.current;
    if (!v) return;
    if (v.paused) { v.play(); c?.play().catch(() => { }); a?.play().catch(() => { }); setPlaying(true); }
    else { v.pause(); c?.pause(); a?.pause(); setPlaying(false); }
  };

  const seek = (t: number) => {
    const v = videoRef.current; const c = cameraRef.current; const a = audioElRef.current;
    if (v) v.currentTime = t; if (c) c.currentTime = t; if (a) a.currentTime = t;
  };

  const handleExport = async () => {
    setRenderError(null); setRendered(null);
    try {
      const out = await renderAutoZoom(recording, {
        format, quality, background, frame, subtitles: subtitles || undefined,
        clicksOverride: effectiveClicks,
        cameraX: showCamera ? cameraX : undefined,
        cameraY: showCamera ? cameraY : undefined,
        cameraSize: showCamera ? cameraSize : undefined,
        cameraShape: showCamera ? cameraShape : undefined,
        onProgress: (p) => setRenderState(p),
      });
      setRendered(out);
    } catch (e) {
      console.error(e);
      setRenderError(e instanceof Error ? e.message : "Render failed");
    } finally { setRenderState(null); }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60); const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full max-w-7xl grid lg:grid-cols-[1fr_340px] gap-8">
      <div className="space-y-6">
        <div className="relative rounded-2xl overflow-hidden border border-border shadow-2xl" style={{ background: background.css }}>
          <canvas ref={canvasRef} className={`w-full h-auto block transition-opacity duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'}`} />
          {!isLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 backdrop-blur-md">
              <div className="w-10 h-10 rounded-full border-4 border-white/20 border-t-white animate-spin mb-4" />
              <p className="text-[10px] font-bold text-white uppercase tracking-widest">Loading Canvas Engine…</p>
            </div>
          )}

          {/* Draggable Camera Handle */}
          {recording.cameraUrl && showCamera && (
            <motion.div
              drag dragMomentum={false} dragElastic={0}
              onDrag={(_, info) => {
                const el = canvasRef.current; if (!el) return;
                const rect = el.getBoundingClientRect();
                const x = (info.point.x - rect.left) / rect.width;
                const y = (info.point.y - rect.top) / rect.height;
                setCameraX(Math.max(0, Math.min(1, x))); setCameraY(Math.max(0, Math.min(1, y)));
              }}
              style={{ position: 'absolute', left: `${cameraX * 100}%`, top: `${cameraY * 100}%`, width: `${cameraSize * 100}%`, aspectRatio: '1/1', x: '-50%', y: '-50%' }}
              className="z-20 cursor-grab active:cursor-grabbing group"
            >
              <div className={`w-full h-full border-2 border-white/50 shadow-2xl bg-black overflow-hidden relative transition-all duration-300
                ${cameraShape === 'circle' ? 'rounded-full' : cameraShape === 'rounded' ? 'rounded-[20%]' : 'rounded-lg'}
              `}>
                <video src={recording.cameraUrl} muted playsInline className="w-full h-full object-cover scale-x-[-1] opacity-50" />
                <div className="absolute inset-0 flex items-center justify-center bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" /></svg>
                </div>
              </div>
            </motion.div>
          )}

          <video ref={videoRef} src={recording.url} muted playsInline className="hidden"
            onLoadedData={() => { if (videoRef.current) videoRef.current.currentTime = 0.001; }}
            onCanPlay={() => setIsLoaded(true)} onEnded={() => setPlaying(false)} />
          <audio ref={audioElRef} src={recording.url} className="hidden" />
          {recording.cameraUrl && <video ref={cameraRef} src={recording.cameraUrl} muted playsInline className="hidden" />}
        </div>

        {/* Transport */}
        <div className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-card/50 backdrop-blur-sm">
          <button onClick={togglePlay} className="w-12 h-12 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-105 transition-transform">
            {playing ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>}
          </button>
          <span className="font-display text-xs text-muted-foreground tabular-nums w-12">{fmtTime(currentTime)}</span>
          <input type="range" min={0} max={recording.duration} step={0.01} value={currentTime} onChange={(e) => seek(parseFloat(e.target.value))} className="flex-1 accent-foreground h-1.5 rounded-full bg-muted appearance-none cursor-pointer" />
          <span className="font-display text-xs text-muted-foreground tabular-nums w-12">{fmtTime(recording.duration)}</span>
        </div>

        {/* Background Section (Restored & Enhanced) */}
        <div className="pt-8 border-t border-border space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex p-1 rounded-xl bg-card border border-border shadow-sm">
              {(["wallpaper", "gradient", "color", "image"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${selectedCategory === cat
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mr-2">
              Background Style
            </p>
          </div>

          <div className="space-y-6">
             {selectedCategory === 'wallpaper' && (
               <div>
                 <div className="flex items-center justify-between mb-3 px-1">
                   <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Raycast Originals</h3>
                   <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase font-bold tracking-tighter">Pro</span>
                 </div>
                 <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-2 p-4 bg-card/30 rounded-2xl border border-border">
                   {BACKGROUNDS.filter(bg => RAYCAST_BG_IDS.includes(bg.id)).map((bg) => (
                     <BackgroundButton key={bg.id} bg={bg} active={background.id === bg.id} onClick={() => setBackground(bg)} />
                   ))}
                 </div>
               </div>
             )}

             <div>
               <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3 px-1">
                 {selectedCategory === 'image' ? 'Professional Scenes' : `All ${selectedCategory}s`}
               </h3>
               <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-2 p-4 bg-card/30 rounded-2xl border border-border">
                 {BACKGROUNDS.filter(bg => bg.category === selectedCategory && !RAYCAST_BG_IDS.includes(bg.id)).map((bg) => (
                   <BackgroundButton key={bg.id} bg={bg} active={background.id === bg.id} onClick={() => setBackground(bg)} />
                 ))}
               </div>
             </div>
          </div>
        </div>
      </div>

      <aside className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">AI Features</h3>
          <button
            onClick={async () => {
              if (subtitles) { setSubtitles(null); return; }
              setTranscribing(true);
              try { const subs = await transcribeAudioAI(recording.blob); setSubtitles(subs); }
              catch (e) { console.error(e); } finally { setTranscribing(false); }
            }}
            disabled={transcribing}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all ${subtitles ? "border-primary/30 bg-primary/5" : "border-border bg-card hover:border-foreground/20"}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${subtitles ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-muted text-muted-foreground"}`}>
              {transcribing ? <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                           : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
            </div>
            <div className="text-left flex-1">
              <p className="text-[11px] font-bold text-foreground">AI Subtitles</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-tighter">{transcribing ? "Listening…" : subtitles ? "Captions active" : "Generate captions"}</p>
            </div>
            <div className={`w-10 h-5 rounded-full p-0.5 transition-colors ${subtitles ? "bg-primary" : "bg-muted"}`}>
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${subtitles ? "translate-x-5" : "translate-x-0 shadow-sm"}`} />
            </div>
          </button>
        </section>

        <section className="space-y-5">
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Frame Styling</h3>
          <Slider label="Padding" value={frame.padding} min={0} max={0.18} step={0.005} display={`${Math.round(frame.padding * 100)}%`} onChange={(v) => setFrame((f) => ({ ...f, padding: v }))} />
          <Slider label="Corners" value={frame.radius} min={0} max={48} step={1} display={`${frame.radius}px`} onChange={(v) => setFrame((f) => ({ ...f, radius: v }))} />
          <Slider label="Shadow" value={frame.shadow} min={0} max={80} step={1} display={`${frame.shadow}px`} onChange={(v) => setFrame((f) => ({ ...f, shadow: v }))} />

          {recording.cameraUrl && (
            <div className="pt-4 border-t border-border space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Face Bubble</h3>
                <button onClick={() => setShowCamera(!showCamera)} className={`w-10 h-5 rounded-full p-0.5 transition-colors ${showCamera ? "bg-primary" : "bg-muted"}`}>
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${showCamera ? "translate-x-5" : "translate-x-0 shadow-sm"}`} />
                </button>
              </div>
              {showCamera && (
                <>
                  <Slider label="Bubble Size" value={cameraSize} min={0.05} max={0.3} step={0.01} display={`${Math.round(cameraSize * 100)}%`} onChange={(v) => setCameraSize(v)} />
                  <div className="space-y-2">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold opacity-60">Bubble Shape</p>
                    <div className="flex gap-1.5 p-1 rounded-xl bg-card border border-border shadow-inner">
                      {(["circle", "rounded", "square"] as const).map((shape) => (
                        <button key={shape} onClick={() => setCameraShape(shape)} className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase transition-all ${cameraShape === shape ? "bg-foreground text-background shadow-md" : "text-muted-foreground hover:text-foreground"}`}>{shape}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* Analytics Card (Restored to Dark Minimalist) */}
        <section className="p-4 rounded-2xl bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Analytics</p>
            {isAuto && <span className="text-[9px] font-bold text-primary uppercase animate-pulse">AI Vision active</span>}
          </div>
          <div className="flex justify-between text-xs font-medium text-foreground tabular-nums">
            <span>{effectiveClicks.length} Zooms</span>
            <span>{recording.scrolls.length} Scrolls</span>
            <span>{recording.pauses.length} Pauses</span>
          </div>
        </section>

        <section className="space-y-4">
           <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-muted-foreground uppercase ml-1">Format</p>
                <select value={format} onChange={(e) => setFormat(e.target.value as any)} className="w-full p-2.5 rounded-xl border border-border bg-card text-[11px] font-bold outline-none text-foreground">
                  <option value="mp4">MP4 (H.264)</option>
                  <option value="webm">WebM (VP9)</option>
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-muted-foreground uppercase ml-1">Quality</p>
                <select value={quality} onChange={(e) => setQuality(parseInt(e.target.value) as any)} className="w-full p-2.5 rounded-xl border border-border bg-card text-[11px] font-bold outline-none text-foreground">
                  <option value="1080">1080p</option>
                  <option value="720">720p</option>
                  <option value="480">480p</option>
                </select>
              </div>
           </div>

          {renderState && (
            <div className="p-4 rounded-2xl border border-border bg-card shadow-sm animate-in fade-in slide-in-from-bottom-2">
              <div className="flex justify-between items-center text-[10px] font-bold mb-2.5">
                <span className="uppercase text-muted-foreground flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />{renderState.stage}…</span>
                <span className="tabular-nums text-foreground">{renderState.percent}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden"><motion.div className="h-full bg-primary shadow-[0_0_12px_rgba(var(--primary),0.3)]" initial={{ width: 0 }} animate={{ width: `${renderState.percent}%` }} transition={{ duration: 0.3 }} /></div>
            </div>
          )}

          {rendered && !renderState && (
            <button onClick={() => { const a = document.createElement("a"); a.href = rendered.url; a.download = `zoomly-${Date.now()}.${rendered.format}`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }}
              className="w-full py-4 rounded-2xl bg-primary text-primary-foreground text-sm font-bold shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
              Download Video
            </button>
          )}

          <button onClick={handleExport} disabled={!!renderState}
            className={`w-full py-4 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2.5 ${renderState ? "bg-muted text-muted-foreground" : rendered ? "bg-secondary text-secondary-foreground" : "bg-[#E4E4E7] text-black shadow-xl hover:scale-[1.02] active:scale-[0.98]"}`}>
            {renderState ? "Processing…" : rendered ? "Regenerate" : "Export Video"}
          </button>
        </section>
      </aside>
    </div>
  );
}

function BackgroundButton({ bg, active, onClick }: { bg: Background; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`aspect-[4/3] rounded-lg border-2 transition-all ${active ? "border-primary scale-110 shadow-lg z-10" : "border-transparent hover:border-foreground/20"}`} style={{ background: bg.css }} />
  );
}

function Slider({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center px-1">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
        <span className="text-[10px] font-bold text-foreground tabular-nums">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-foreground h-1 rounded-full bg-muted appearance-none cursor-pointer" />
    </div>
  );
}
