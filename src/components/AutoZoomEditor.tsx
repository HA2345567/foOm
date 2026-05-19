import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify: any;
  }
}

const SUGGESTED_TRACKS = [
  {
    id: "lofi-sunset",
    name: "Lofi Sunset Chillout",
    artist: "Chillhop Collective",
    albumArt: "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&q=80",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  },
  {
    id: "synthwave-drive",
    name: "Synthwave Drive",
    artist: "Neon Skyline",
    albumArt: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300&q=80",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
  },
  {
    id: "high-energy-gym",
    name: "High Energy Beats",
    artist: "Power Pulse",
    albumArt: "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=300&q=80",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
  },
  {
    id: "epic-cinematic",
    name: "Epic Horizon Theme",
    artist: "Orchestral Legends",
    albumArt: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
  },
];

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
  const bgMusicAudioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

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
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isLaunchingSpotify, setIsLaunchingSpotify] = useState(false);
  const [spotifyLink, setSpotifyLink] = useState("");
  const [isProcessingLink, setIsProcessingLink] = useState(false);
  const [selectedSong, setSelectedSong] = useState<{
    id: string;
    name: string;
    artist: string;
    albumArt?: string;
    url: string;
  } | null>(null);
  const [musicOffset, setMusicOffset] = useState(0);
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [pendingSong, setPendingSong] = useState<{
    id: string;
    name: string;
    artist: string;
    albumArt?: string;
    url: string;
  } | null>(null);
  const [bgMusicVolume, setBgMusicVolume] = useState(0.12);



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

  useEffect(() => {
    const video = videoRef.current;
    const camera = cameraRef.current;
    const audio = audioElRef.current;
    if (video) video.playbackRate = playbackSpeed;
    if (camera) camera.playbackRate = playbackSpeed;
    if (audio) audio.playbackRate = playbackSpeed;
  }, [playbackSpeed, isLoaded, recording]);

  useEffect(() => {
    const bgMusic = bgMusicAudioRef.current;
    if (bgMusic) {
      bgMusic.volume = 0.15;
      bgMusic.playbackRate = playbackSpeed;
    }
  }, [selectedSong, playbackSpeed]);

  useEffect(() => {
    const bgMusic = bgMusicAudioRef.current;
    if (bgMusic && selectedSong?.url && bgMusic.duration) {
      bgMusic.currentTime = (musicOffset + getRealTime(currentTime)) % bgMusic.duration;
    }
  }, [musicOffset]);

  useEffect(() => {
    const bgMusic = bgMusicAudioRef.current;
    if (!bgMusic) return;

    if (showMusicModal && pendingSong?.url) {
      // Direct assignment to make sure the element preloads the correct preview
      if (bgMusic.src !== pendingSong.url) {
        bgMusic.src = pendingSong.url;
        bgMusic.load();
      }

      bgMusic.volume = 0.45;
      bgMusic.currentTime = musicOffset;

      const playAudio = () => {
        bgMusic.play().catch((err) => {
          console.warn("Autoplay preview blocked or failed:", err);
        });
      };

      if (bgMusic.readyState >= 2) {
        playAudio();
      } else {
        bgMusic.addEventListener("canplay", playAudio);
      }

      return () => {
        bgMusic.removeEventListener("canplay", playAudio);
        bgMusic.pause();
      };
    }
  }, [showMusicModal, pendingSong, musicOffset]);

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
    const bgMusic = bgMusicAudioRef.current;
    if (!v) return;
    if (v.paused) {
      v.playbackRate = playbackSpeed;
      if (c) c.playbackRate = playbackSpeed;
      if (a) a.playbackRate = playbackSpeed;
      if (bgMusic && selectedSong?.url) {
        bgMusic.playbackRate = playbackSpeed;
        const realT = getRealTime(currentTime);
        bgMusic.currentTime = bgMusic.duration ? (musicOffset + realT) % bgMusic.duration : musicOffset;
        bgMusic.play().catch(() => { });
      }
      v.play(); c?.play().catch(() => { }); a?.play().catch(() => { }); setPlaying(true);
    }
    else {
      v.pause(); c?.pause(); a?.pause();
      if (bgMusic) bgMusic.pause();
      setPlaying(false);
    }
  };

  const seek = (t: number) => {
    const realT = getRealTime(t);
    const v = videoRef.current; const c = cameraRef.current; const a = audioElRef.current;
    const bgMusic = bgMusicAudioRef.current;
    if (v) v.currentTime = realT; if (c) c.currentTime = realT; if (a) a.currentTime = realT;
    if (bgMusic && selectedSong?.url && bgMusic.duration) {
      bgMusic.currentTime = (musicOffset + realT) % bgMusic.duration;
    }
    setCurrentTime(t);
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const downloadBlob = new Blob([blob], { type: "application/octet-stream" });
    const url = URL.createObjectURL(downloadBlob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
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
        speed: playbackSpeed,
        backgroundMusicUrl: selectedSong?.url || undefined,
        backgroundMusicOffset: selectedSong ? musicOffset : undefined,
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

  const handleSpotifyLinkPaste = async (val: string) => {
    if (!val || !val.trim()) return;
    const match = val.match(/track\/([a-zA-Z0-9]+)/);
    if (!match) {
      alert("Invalid Spotify Track Link. Please copy a link like: https://open.spotify.com/track/...");
      return;
    }
    const trackId = match[1];
    setIsProcessingLink(true);
    try {
      const res = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`);
      if (!res.ok) throw new Error("Track not found");
      const data = await res.json();

      const titleParts = data.title ? data.title.split(" - ") : ["Spotify Track", "Unknown Artist"];
      const name = titleParts[0] || "Spotify Track";
      let artist = titleParts[1] || "Unknown Artist";
      if (artist.toLowerCase().startsWith("song by ")) {
        artist = artist.substring(8);
      }

      // Let's query the iTunes API for the EXACT song audio stream!
      let url = "";
      try {
        const searchRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(name + " " + artist)}&limit=1`);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.results && searchData.results[0]?.previewUrl) {
            url = searchData.results[0].previewUrl;
          }
        }
      } catch (searchErr) {
        console.error("iTunes search failed, falling back to custom loop:", searchErr);
      }

      // Safe fallback if iTunes search fails or has no match
      if (!url) {
        const helixTracks = [
          "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
          "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
          "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
          "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
          "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
        ];
        const hash = trackId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
        url = helixTracks[hash % helixTracks.length];
      }

      setPendingSong({
        id: trackId,
        name,
        artist,
        albumArt: data.thumbnail_url,
        url,
      });
      setMusicOffset(0);
      setShowMusicModal(true);
    } catch (e) {
      console.error(e);
      alert("Could not fetch song details from Spotify. Please make sure it's a public track.");
    } finally {
      setIsProcessingLink(false);
    }
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
          <audio ref={bgMusicAudioRef} src={selectedSong?.url || pendingSong?.url || ""} className="hidden" loop preload="auto" />
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

            {/* Speed Control Wrapper */}
            <div className="relative z-40 ml-2">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all duration-300 relative z-40
                  ${showSpeedMenu
                    ? "bg-foreground text-background border-foreground shadow-lg"
                    : "bg-card/85 text-muted-foreground border-border hover:text-foreground hover:bg-card"
                  }`}
                title="Playback Speed"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {playbackSpeed !== 1 && (
                  <span className="absolute -top-1 -right-1 px-1 py-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold scale-90">
                    {playbackSpeed}x
                  </span>
                )}
              </button>

              {showSpeedMenu && (
                <>
                  {/* Click outside backdrop */}
                  <div className="fixed inset-0 z-30" onClick={() => setShowSpeedMenu(false)} />

                  {/* Floating Menu */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    transition={{ type: "spring", damping: 20, stiffness: 300 }}
                    className="absolute bottom-full right-0 mb-2.5 p-1.5 rounded-2xl bg-card/95 backdrop-blur-md border border-border shadow-2xl z-40 flex flex-col gap-1 w-24"
                  >
                    <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest px-2 py-1 select-none border-b border-border/40 mb-1">Speed</p>
                    {([0.5, 1, 1.5, 2] as const).map((spd) => (
                      <button
                        key={spd}
                        onClick={() => {
                          setPlaybackSpeed(spd);
                          setShowSpeedMenu(false);
                        }}
                        className={`w-full py-1.5 px-2.5 rounded-xl text-[10px] font-bold text-left transition-all uppercase tracking-wider flex items-center justify-between
                          ${playbackSpeed === spd
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                          }`}
                      >
                        <span>{spd}x</span>
                        {playbackSpeed === spd && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </div>
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5.5 3.483c0-1.248 1.436-1.95 2.421-1.184l13.514 10.513c1.128.877.508 2.684-.92 2.684h-6.853c-.505 0-.981.23-1.294.626l-4.191 5.3c-.882 1.116-2.677.492-2.677-.93zm15.014 10.513L7 3.483v17.009l4.191-5.3a3.15 3.15 0 0 1 2.47-1.196z" /></svg>
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
                className={`flex-1 py-2 rounded-xl text-[10px] font-bold transition-all duration-300 ${motionFeel === feel
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
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>}
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
            <button onClick={() => {
              const name = `${aiTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'foom'}-${Date.now()}.${rendered.format}`;
              triggerDownload(rendered.blob, name);
            }}
              className="w-full py-4 rounded-2xl bg-primary text-primary-foreground text-sm font-bold shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
              Download Video
            </button>
          )}

          <button onClick={handleExport} disabled={!!renderState}
            className={`w-full py-4 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2.5 ${renderState ? "bg-muted text-muted-foreground" : rendered ? "bg-secondary text-secondary-foreground" : "bg-[#E4E4E7] text-black shadow-xl hover:scale-[1.02] active:scale-[0.98]"}`}>
            {renderState ? "Processing…" : rendered ? "Regenerate" : "Export Video"}
          </button>

          {!renderState && (
            <button
              onClick={() => {
                const ext = recording.mimeType?.includes("mp4") ? "mp4" : "webm";
                const name = `raw-${Date.now()}.${ext}`;
                triggerDownload(recording.blob, name);
              }}
              className="w-full py-4 rounded-2xl bg-secondary text-secondary-foreground text-sm font-bold shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
              Download Raw Video
            </button>
          )}

          <div className="pt-2">
            <button
              onClick={onDiscard}
              className="w-full py-3 rounded-xl border border-destructive/10 bg-destructive/5 text-destructive/80 text-[11px] font-bold hover:bg-destructive hover:text-white hover:border-destructive transition-all duration-300 flex items-center justify-center gap-2 group"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="group-hover:rotate-12 transition-transform"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
              Discard Video
            </button>
          </div>
        </section>
      </aside>

      {/* Spotify Soundtrack Trimmer Modal */}
      <AnimatePresence>
        {showMusicModal && pendingSong && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#121214]/95 border border-white/10 rounded-[32px] p-6 max-w-sm w-full text-center relative shadow-2xl flex flex-col items-center space-y-6 backdrop-blur-2xl"
            >
              {/* Close Button */}
              <button
                onClick={() => {
                  setShowMusicModal(false);
                  setPendingSong(null);
                  if (bgMusicAudioRef.current) bgMusicAudioRef.current.pause();
                }}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/5 text-muted-foreground hover:text-white transition-all"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>

              {/* Header Green Tag */}
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1DB954]/10 text-[#1DB954] text-[9px] font-extrabold uppercase tracking-widest">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.893-1.002-.336.074-.668-.138-.742-.475-.074-.336.138-.668.475-.742 3.856-.88 7.15-.506 9.814 1.127.295.18.387.565.207.86zm1.224-2.72c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.076-1.185-.412.124-.847-.107-.97-.52-.124-.412.107-.847.52-.97 3.666-1.112 8.232-.572 11.34 1.343.367.226.487.707.26 1.074zm.107-2.835C14.492 8.78 8.822 8.592 5.534 9.59c-.506.154-1.04-.133-1.194-.64-.154-.506.133-1.04.64-1.194 3.77-1.144 10.012-.927 14.28 1.61.455.27.604.858.334 1.312-.27.455-.858.604-1.312.334z" /></svg>
                Sync Soundtrack
              </span>

              {/* Center Song Artwork */}
              <div className="relative group w-36 h-36">
                <div className="absolute inset-0 rounded-[24px] bg-gradient-to-tr from-[#1DB954] to-emerald-500 opacity-20 blur-lg group-hover:opacity-40 transition-opacity duration-500" />
                {pendingSong.albumArt ? (
                  <img
                    src={pendingSong.albumArt}
                    className="w-full h-full rounded-[24px] object-cover border border-white/10 shadow-2xl relative z-10 transition-transform duration-500 group-hover:scale-[1.03]"
                    alt="album artwork"
                  />
                ) : (
                  <div className="w-full h-full rounded-[24px] bg-gradient-to-b from-[#1DB954]/20 to-[#1DB954]/5 border border-white/10 flex items-center justify-center text-4xl shadow-2xl relative z-10">
                    ♫
                  </div>
                )}

                {/* Micro Equalizer visualizer overlay */}
                <div className="absolute bottom-2.5 right-2.5 z-20 flex gap-0.5 items-end h-4 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm border border-white/5">
                  <div className="w-0.5 h-1 bg-[#1DB954] animate-[bounce_0.8s_infinite]" />
                  <div className="w-0.5 h-3 bg-[#1DB954] animate-[bounce_0.5s_infinite]" />
                  <div className="w-0.5 h-2 bg-[#1DB954] animate-[bounce_0.6s_infinite]" />
                </div>
              </div>

              {/* Song details */}
              <div className="space-y-1 w-full text-center">
                <h4 className="text-base font-black text-foreground truncate px-4">{pendingSong.name}</h4>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider truncate px-4">{pendingSong.artist}</p>
              </div>

              {/* Suggested Songs Selection List */}
              <div className="w-full space-y-1.5">
                <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest block text-left pl-1">Suggested Tracks</span>
                <div className="grid grid-cols-2 gap-1.5 w-full">
                  {SUGGESTED_TRACKS.map((track) => {
                    const isSelected = pendingSong.id === track.id;
                    return (
                      <button
                        key={track.id}
                        onClick={() => {
                          setPendingSong(track);
                          setMusicOffset(0);
                        }}
                        className={`flex items-center gap-2 p-1.5 rounded-xl border text-left transition-all ${isSelected
                          ? "bg-[#1DB954]/10 border-[#1DB954] text-white"
                          : "bg-white/[0.02] border-white/5 hover:border-white/20 text-muted-foreground hover:text-white"
                          }`}
                      >
                        <img src={track.albumArt} className="w-6 h-6 rounded-md object-cover border border-white/5 shrink-0" alt="album art" />
                        <div className="min-w-0">
                          <p className="text-[9px] font-bold truncate leading-tight">{track.name}</p>
                          <p className="text-[7px] opacity-60 truncate leading-none mt-0.5">{track.artist}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Timer scrubber for song offset */}
              <div className="w-full space-y-3.5 bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-left">
                {/* Visual Video Period badge */}
                <div className="flex justify-between items-center border-b border-white/5 pb-2.5 mb-1">
                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Video Time Period</span>
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[8px] font-extrabold uppercase tracking-wider">
                    {Math.max(1, trimEnd - trimStart).toFixed(1)}s Duration
                  </span>
                </div>

                {/* Timers Row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider block">Start Timer</span>
                    <span className="text-xs font-black text-[#1DB954] tabular-nums bg-white/5 px-2.5 py-1 rounded-lg block text-center border border-white/5">
                      {(() => {
                        const m = Math.floor(musicOffset / 60);
                        const s = Math.floor(musicOffset % 60);
                        return `${m}:${s.toString().padStart(2, "0")}`;
                      })()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider block">End Timer</span>
                    <span className="text-xs font-black text-foreground/90 tabular-nums bg-white/5 px-2.5 py-1 rounded-lg block text-center border border-white/5">
                      {(() => {
                        const endT = musicOffset + Math.max(1, trimEnd - trimStart);
                        const m = Math.floor(endT / 60);
                        const s = Math.floor(endT % 60);
                        return `${m}:${s.toString().padStart(2, "0")}`;
                      })()}
                    </span>
                  </div>
                </div>

                {/* Range Slider */}
                <div className="space-y-1.5 pt-1">
                  <input
                    type="range"
                    min={0}
                    max={(() => {
                      const songDur = bgMusicAudioRef.current?.duration || 180;
                      const videoDur = Math.max(1, trimEnd - trimStart);
                      return Math.max(0, Math.floor(songDur - videoDur));
                    })()}
                    step={1}
                    value={musicOffset}
                    onChange={(e) => setMusicOffset(parseInt(e.target.value))}
                    className="w-full accent-[#1DB954] h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                  />
                  <span className="text-[8px] text-muted-foreground/60 leading-none block text-center">
                    Slide to shift the music window (automatically matches the video's time period)
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 w-full pt-2">
                <button
                  onClick={() => {
                    setSelectedSong(pendingSong);
                    setShowMusicModal(false);
                    setPendingSong(null);
                    // Start sync playback of background soundtrack
                    setTimeout(() => {
                      const bgMusic = bgMusicAudioRef.current;
                      if (bgMusic) {
                        bgMusic.volume = 0.15;
                        const realT = getRealTime(currentTime);
                        bgMusic.currentTime = bgMusic.duration ? (musicOffset + realT) % bgMusic.duration : musicOffset;
                        if (playing) bgMusic.play().catch(() => { });
                      }
                    }, 100);
                  }}
                  className="w-full py-3.5 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-white text-xs font-bold hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-[#1DB954]/10"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  Confirm & Sync Video
                </button>
                <button
                  onClick={() => {
                    setShowMusicModal(false);
                    setPendingSong(null);
                    if (bgMusicAudioRef.current) bgMusicAudioRef.current.pause();
                  }}
                  className="w-full py-3 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white text-xs font-bold transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BackgroundButton({ bg, active, onClick }: { bg: Background; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`group relative overflow-hidden aspect-[4/3] rounded-lg border-2 transition-all bg-muted/30 ${active ? "border-primary scale-110 shadow-lg z-10" : "border-border/50 hover:border-foreground/30"}`}>
      {/* Loading Skeleton */}
      <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
        <svg className="w-4 h-4 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
      </div>

      {bg.url ? (
        <img src={bg.url} loading="lazy" className="absolute inset-0 w-full h-full object-cover z-10 transition-opacity duration-500 opacity-0" onLoad={(e) => (e.target as HTMLImageElement).classList.remove('opacity-0')} alt={bg.name} />
      ) : (
        <div className="absolute inset-0 w-full h-full z-10" style={{ background: bg.css }} />
      )}
    </button>
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

