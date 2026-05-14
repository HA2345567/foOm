import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { RecordingResult, ClickEvent } from "../hooks/useScreenRecording";
import { generateZoomKeyframes, interpolateZoom } from "../lib/autoZoom";
import { drawComposite } from "../lib/composite";
import { analyzeRecordingAI, detectInterestAI } from "../lib/gemini";
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
import { detectSilence, type AudioSegment } from "../lib/audioAnalysis";

interface Props {
  recording: RecordingResult;
  onDiscard: () => void;
}

export function AutoZoomEditor({ recording, onDiscard }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);

  const [background, setBackground] = useState<Background>(() => {
    const saved = localStorage.getItem("foom_background");
    if (saved) {
      const found = BACKGROUNDS.find(b => b.id === saved);
      if (found) return found;
    }
    return BACKGROUNDS[0];
  });
  const [frame, setFrame] = useState<FrameStyle>(() => {
    const saved = localStorage.getItem("foom_frame");
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
    const saved = localStorage.getItem("foom_quality");
    if (saved) return parseInt(saved) as any;
    return 720;
  });
  const [format, setFormat] = useState<RenderFormat>(() => {
    const saved = localStorage.getItem("foom_format");
    return (saved === "webm" ? "webm" : "mp4") as RenderFormat;
  });

  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiTitle, setAiTitle] = useState<string>("");

  const [selectedCategory, setSelectedCategory] = useState<BackgroundCategory>("wallpaper");
  const [cameraX, setCameraX] = useState(0.85);
  const [cameraY, setCameraY] = useState(0.82);
  const [cameraSize, setCameraSize] = useState(0.16);
  const [cameraZoom, setCameraZoom] = useState(1.0);
  const [cameraShape, setCameraShape] = useState<"circle" | "square" | "rounded">(recording.cameraShape || "circle");
  const [showCamera, setShowCamera] = useState(true);
  const [showCursor, setShowCursor] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const aspectRatio = "16:9";

  useEffect(() => { localStorage.setItem("foom_background", background.id); }, [background]);
  useEffect(() => { localStorage.setItem("foom_frame", JSON.stringify(frame)); }, [frame]);
  useEffect(() => { localStorage.setItem("foom_quality", quality.toString()); }, [quality]);
  useEffect(() => { localStorage.setItem("foom_format", format); }, [format]);

  // AI Subtitles
  const [subtitles, setSubtitles] = useState<Subtitle[] | null>(null);
  const [motionFeel, setMotionFeel] = useState<"glass" | "velvet" | "silk" | "snap">("silk");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Auto-detected interest points
  const [autoClicks, setAutoClicks] = useState<ClickEvent[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Silence Removal
  const [removeSilence, setRemoveSilence] = useState(false);
  const [segments, setSegments] = useState<AudioSegment[] | null>(null);
  const [isAnalyzingSilence, setIsAnalyzingSilence] = useState(false);

  // Trimming
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(recording.duration);

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

  useEffect(() => {
    if (videoRef.current?.readyState && videoRef.current.readyState >= 3) {
      setIsLoaded(true);
    }
  }, [recording]);
  const isAuto = recording.clicks.length === 0 && (autoClicks?.length ?? 0) > 0;

  const keyframes = useMemo(() => {
    return generateZoomKeyframes(effectiveClicks, recording.duration, {
      feel: motionFeel,
      pauses: recording.pauses,
      scrolls: recording.scrolls,
      typeBursts: recording.typeBursts,
    });
  }, [effectiveClicks, recording.duration, motionFeel, recording.pauses, recording.scrolls, recording.typeBursts]);

  // Analyze silence on mount or recording change
  useEffect(() => {
    let cancelled = false;
    const analyze = async () => {
      setIsAnalyzingSilence(true);
      try {
        const arrBuf = await recording.blob.arrayBuffer();
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AC();
        const buffer = await ctx.decodeAudioData(arrBuf);
        await ctx.close();
        const detected = await detectSilence(buffer);
        if (!cancelled) setSegments(detected);
      } catch (e) {
        console.error("Silence detection failed", e);
      } finally {
        if (!cancelled) setIsAnalyzingSilence(false);
      }
    };
    analyze();
    return () => { cancelled = true; };
  }, [recording]);

  // Map "logical" time to "real" video time if silence is removed or trimmed
  const getRealTime = (logicalT: number) => {
    if (!removeSilence || !segments) {
      return Math.min(trimEnd, trimStart + logicalT);
    }
    
    // Silence removal logic (already maps segments relative to start of recording)
    // We should filter segments by trim range
    const activeSegments = segments.filter(s => s.end > trimStart && s.start < trimEnd)
      .map(s => ({
        start: Math.max(trimStart, s.start),
        end: Math.min(trimEnd, s.end)
      }));

    let currentLogical = 0;
    for (const seg of activeSegments) {
      const duration = seg.end - seg.start;
      if (logicalT <= currentLogical + duration) {
        return seg.start + (logicalT - currentLogical);
      }
      currentLogical += duration;
    }
    return activeSegments[activeSegments.length - 1]?.end || (trimStart + logicalT);
  };

  const totalDuration = useMemo(() => {
    if (!removeSilence || !segments) return trimEnd - trimStart;
    
    return segments
      .filter(s => s.end > trimStart && s.start < trimEnd)
      .reduce((sum, s) => sum + (Math.min(trimEnd, s.end) - Math.max(trimStart, s.start)), 0);
  }, [removeSilence, segments, trimStart, trimEnd, recording.duration]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d")!;
    const container = canvas.parentElement!;
    const srcW = video.videoWidth || recording.width || 1280;
    const srcH = video.videoHeight || recording.height || 720;
    
    let PREVIEW_W = container.clientWidth;
    let PREVIEW_H;
    
    if (aspectRatio === "16:9") {
      PREVIEW_H = Math.round(PREVIEW_W * (9 / 16));
    } else if (aspectRatio === "9:16") {
      // For mobile view, we limit the height so it fits the editor layout
      PREVIEW_H = Math.min(500, Math.round(container.clientHeight * 0.75));
      PREVIEW_W = Math.round(PREVIEW_H * (9 / 16));
    } else {
      PREVIEW_H = Math.min(500, PREVIEW_W);
      PREVIEW_W = PREVIEW_H;
    }
    
    canvas.width = PREVIEW_W; canvas.height = PREVIEW_H;
    // Force center align the canvas via styles if narrow
    canvas.style.margin = "0 auto";
    canvas.style.display = "block";

    let lastT = -1;
    const tick = () => {
      const realNow = video.currentTime;
      
      // Calculate logical time for UI
      let logicalNow = 0;
      if (!removeSilence || !segments) {
        logicalNow = Math.max(0, realNow - trimStart);
      } else {
        // Find logical time by summing up non-silent segments up to realNow
        for (const s of segments) {
          if (realNow >= s.start && realNow <= s.end) {
            logicalNow += (realNow - s.start);
            break;
          }
          if (realNow > s.end) {
            logicalNow += (s.end - s.start);
          }
        }
      }
      setCurrentTime(logicalNow);

      // Loop logic: if we reach the end of the trimmed section, go back to start
      if (realNow >= trimEnd - 0.05) {
        video.currentTime = trimStart;
      }
      
      const t = realNow;
      lastT = t; 
      const kf = interpolateZoom(keyframes, t);
      const cam = cameraRef.current;
      if (cam) cam.currentTime = t;
      drawComposite(ctx, video, kf, {
        background, frame, subtitles: subtitles || undefined, currentTime: t,
        srcW, srcH, outW: PREVIEW_W, outH: PREVIEW_H,
        camera: (showCamera && cam) ? cam : undefined,
        cameraX, cameraY, cameraSize, cameraShape,
        cameraZoom,
        mouseMoves: recording.mouseMoves,
        showCursor,
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [background, frame, keyframes, subtitles, recording, showCamera, cameraX, cameraY, cameraSize, cameraShape, cameraZoom, aspectRatio, removeSilence, segments, trimStart, trimEnd, isLoaded]);

  const togglePlay = () => {
    const v = videoRef.current; const c = cameraRef.current; const a = audioElRef.current;
    if (!v) return;
    if (v.paused) { v.play(); c?.play().catch(() => { }); a?.play().catch(() => { }); setPlaying(true); }
    else { v.pause(); c?.pause(); a?.pause(); setPlaying(false); }
  };

  const seek = (t: number) => {
    const realT = getRealTime(t);
    const v = videoRef.current; const c = cameraRef.current; const a = audioElRef.current;
    if (v) v.currentTime = realT; if (c) c.currentTime = realT; if (a) a.currentTime = realT;
    setCurrentTime(t);
  };

  const handleExport = async () => {
    setRenderError(null); setRendered(null);
    try {
      const out = await renderAutoZoom(recording, {
        format, quality, background, frame, subtitles: subtitles || undefined,
        clicksOverride: effectiveClicks,
        removeSilence,
        segments: segments || undefined,
        trimStart, trimEnd,
        aspectRatio,
        feel: motionFeel,
        cameraX: showCamera ? cameraX : undefined,
        cameraY: showCamera ? cameraY : undefined,
        cameraSize: showCamera ? cameraSize : undefined,
        cameraShape: showCamera ? cameraShape : undefined,
        cameraZoom: showCamera ? cameraZoom : undefined,
        mouseMoves: recording.mouseMoves,
        showCursor,
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

        {/* Transport with Timeline Markers */}
        <div className="space-y-2">
          <div className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-card/50 backdrop-blur-sm relative">
            <button onClick={togglePlay} className="z-10 w-12 h-12 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-105 transition-transform shrink-0">
              {playing ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>}
            </button>
            <span className="z-10 font-display text-xs text-muted-foreground tabular-nums w-12 shrink-0">{fmtTime(currentTime)}</span>
            
            <div ref={timelineRef} className="flex-1 relative h-10 flex items-center group">
              {/* Trim Area Background */}
              <div className="absolute inset-x-0 h-1.5 bg-muted rounded-full overflow-hidden">
                <div 
                  className="absolute h-full bg-primary/20" 
                  style={{ 
                    left: `${(trimStart / recording.duration) * 100}%`, 
                    right: `${100 - (trimEnd / recording.duration) * 100}%` 
                  }} 
                />
              </div>

              {/* Timeline Track (Original Time) */}
              <input 
                type="range" 
                min={0} 
                max={recording.duration} 
                step={0.01} 
                value={getRealTime(currentTime)} 
                onChange={(e) => {
                  const realT = parseFloat(e.target.value);
                  // Find logical time for this real time
                  if (!removeSilence || !segments) {
                    seek(Math.max(0, realT - trimStart));
                  } else {
                    let logical = 0;
                    for (const s of segments) {
                      if (realT >= s.start && realT <= s.end) {
                        seek(logical + (realT - s.start));
                        return;
                      }
                      logical += (s.end - s.start);
                    }
                  }
                }} 
                className="w-full accent-foreground h-1.5 rounded-full bg-transparent appearance-none cursor-pointer relative z-20" 
              />
              
              {/* Trim Handles */}
              <motion.div 
                drag="x"
                dragMomentum={false}
                dragElastic={0}
                onDrag={(_, info) => {
                  const rect = timelineRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const x = (info.point.x - rect.left) / rect.width;
                  setTrimStart(Math.max(0, Math.min(trimEnd - 0.5, x * recording.duration)));
                }}
                className="absolute top-0 bottom-0 z-30 cursor-ew-resize" 
                style={{ left: `${(trimStart / recording.duration) * 100}%`, x: '-50%' }}
              >
                <div className="w-1 h-full bg-primary relative">
                  <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-8 bg-white rounded-full shadow-xl flex flex-col items-center justify-center gap-1">
                    <div className="w-0.5 h-3 bg-black/20 rounded-full" />
                  </div>
                </div>
              </motion.div>

              <motion.div 
                drag="x"
                dragMomentum={false}
                dragElastic={0}
                onDrag={(_, info) => {
                  const rect = timelineRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const x = (info.point.x - rect.left) / rect.width;
                  setTrimEnd(Math.max(trimStart + 0.5, Math.min(recording.duration, x * recording.duration)));
                }}
                className="absolute top-0 bottom-0 z-30 cursor-ew-resize" 
                style={{ left: `${(trimEnd / recording.duration) * 100}%`, x: '-50%' }}
              >
                <div className="w-1 h-full bg-primary relative">
                  <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-8 bg-white rounded-full shadow-xl flex flex-col items-center justify-center gap-1">
                    <div className="w-0.5 h-3 bg-black/20 rounded-full" />
                  </div>
                </div>
              </motion.div>

              {/* Zoom Markers */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 px-[3px] pointer-events-none flex items-center z-10">
                {keyframes.map((kf, i) => {
                  if (kf.t < trimStart || kf.t > trimEnd) return null;
                  // Adjust marker position relative to original recording for visualization
                  return (
                    <div key={i} className="absolute w-1 h-3 bg-primary/40 rounded-full" style={{ left: `${(kf.t / recording.duration) * 100}%` }} />
                  );
                })}
              </div>
            </div>

            <span className="z-10 font-display text-xs text-muted-foreground tabular-nums w-12 shrink-0 text-right">{fmtTime(totalDuration)}</span>
          </div>
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
               <button
                onClick={() => setShowCursor(!showCursor)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${showCursor ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"}`}
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5.5 3.483c0-1.248 1.436-1.95 2.421-1.184l13.514 10.513c1.128.877.508 2.684-.92 2.684h-6.853c-.505 0-.981.23-1.294.626l-4.191 5.3c-.882 1.116-2.677.492-2.677-.93zm15.014 10.513L7 3.483v17.009l4.191-5.3a3.15 3.15 0 0 1 2.47-1.196z"/></svg>
                  <span className="text-[11px] font-bold uppercase tracking-wider">Designer Cursor</span>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${showCursor ? "bg-primary" : "bg-white/10"}`}>
                  <div className={`w-3 h-3 rounded-full bg-white transition-transform ${showCursor ? "translate-x-4" : "translate-x-0"}`} />
                </div>
              </button>
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
              setIsAnalyzing(true);
              try { 
                const result = await analyzeRecordingAI(recording.blob); 
                setSubtitles(result.subtitles);
                setAiSummary(result.summary);
                setAiTitle(result.title);
              }
              catch (e) { console.error(e); } finally { setIsAnalyzing(false); }
            }}
            disabled={isAnalyzing}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all ${subtitles ? "border-primary/30 bg-primary/5" : "border-border bg-card hover:border-foreground/20"}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${subtitles ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-muted text-muted-foreground"}`}>
              {isAnalyzing ? <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                           : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
            </div>
            <div className="text-left flex-1">
              <p className="text-[11px] font-bold text-foreground">AI Subtitles</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-tighter">{isAnalyzing ? "Listening…" : subtitles ? "Captions active" : "Generate captions"}</p>
            </div>
            <div className={`w-10 h-5 rounded-full p-0.5 transition-colors ${subtitles ? "bg-primary" : "bg-muted"}`}>
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${subtitles ? "translate-x-5" : "translate-x-0 shadow-sm"}`} />
            </div>
          </button>
        </section>

        <section className="space-y-4">
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Motion Feel</h3>
          <div className="relative p-1 rounded-[20px] bg-card border border-border shadow-inner flex items-center">
             {(["snap", "silk", "velvet", "glass"] as const).map((feel) => (
                <button
                  key={feel}
                  onClick={() => setMotionFeel(feel)}
                  className={`flex-1 py-2 rounded-xl text-[10px] font-bold transition-all duration-300 ${
                    motionFeel === feel
                      ? "bg-foreground text-background shadow-md"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {feel.charAt(0).toUpperCase() + feel.slice(1)}
                </button>
             ))}
          </div>

          <button
            onClick={() => setRemoveSilence(!removeSilence)}
            disabled={isAnalyzingSilence || !segments}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all ${removeSilence ? "border-primary/30 bg-primary/5" : "border-border bg-card hover:border-foreground/20"}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${removeSilence ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-muted text-muted-foreground"}`}>
              {isAnalyzingSilence ? <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                 : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>}
            </div>
            <div className="text-left flex-1">
              <p className="text-[11px] font-bold text-foreground">Remove Silence</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-tighter">{isAnalyzingSilence ? "Analyzing…" : removeSilence ? "Tight edit active" : "Auto-trim silences"}</p>
            </div>
            <div className={`w-10 h-5 rounded-full p-0.5 transition-colors ${removeSilence ? "bg-primary" : "bg-muted"}`}>
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${removeSilence ? "translate-x-5" : "translate-x-0 shadow-sm"}`} />
            </div>
          </button>

          {aiTitle && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl bg-primary/5 border border-primary/10 space-y-2">
              <h4 className="text-[11px] font-bold text-primary uppercase tracking-wider">AI Suggestions</h4>
              <div className="space-y-1">
                <p className="text-xs font-bold text-foreground">"{aiTitle}"</p>
                <p className="text-[10px] leading-relaxed text-muted-foreground italic">{aiSummary}</p>
              </div>
            </motion.div>
          )}
        </section>

        <section className="space-y-4">
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
                  <Slider label="Bubble Zoom" value={cameraZoom} min={1.0} max={2.5} step={0.05} display={`${cameraZoom.toFixed(1)}x`} onChange={(v) => setCameraZoom(v)} />
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
            <button onClick={() => { const a = document.createElement("a"); a.href = rendered.url; a.download = `${aiTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'foom'}-${Date.now()}.${rendered.format}`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }}
              className="w-full py-4 rounded-2xl bg-primary text-primary-foreground text-sm font-bold shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
              Download Video
            </button>
          )}

          <button onClick={handleExport} disabled={!!renderState}
            className={`w-full py-4 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2.5 ${renderState ? "bg-muted text-muted-foreground" : rendered ? "bg-secondary text-secondary-foreground" : "bg-[#E4E4E7] text-black shadow-xl hover:scale-[1.02] active:scale-[0.98]"}`}>
            {renderState ? "Processing…" : rendered ? "Regenerate" : "Export Video"}
          </button>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button 
              onClick={() => {
                const a = document.createElement("a");
                a.href = recording.url;
                a.download = `raw-${Date.now()}.mp4`;
                a.click();
              }}
              className="py-3 rounded-xl border border-white/5 bg-white/5 text-muted-foreground text-[11px] font-bold hover:text-white hover:bg-white/10 hover:border-white/10 transition-all duration-300 flex items-center justify-center gap-2 group"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="group-hover:-translate-y-0.5 transition-transform"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
              Download Raw
            </button>
            <button 
              onClick={onDiscard}
              className="py-3 rounded-xl border border-destructive/10 bg-destructive/5 text-destructive/80 text-[11px] font-bold hover:bg-destructive hover:text-white hover:border-destructive transition-all duration-300 flex items-center justify-center gap-2 group"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="group-hover:rotate-12 transition-transform"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
              Discard Video
            </button>
          </div>
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
