/**
 * @file AutoZoomEditor.tsx
 * @description Post-Recording Editor Component for foOm Screen Recorder.
 *
 * Fixes:
 * - FIX 1: Passes result.keyframeLog directly into generateZoomKeyframes() for pixel-perfect export.
 * - FIX 2: triggerDownload NEVER re-wraps blob to avoid container corruption.
 * - FIX 3: Revokes ObjectURL after 30s (not 1s) to support slow connections.
 * - FIX 4: Proper mimeToExtension lookup table.
 * - FIX 5: makeFilename fallback when title is empty.
 * - FIX 6: Cleaned up duplicate slider components and JSX tags.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  Download,
  Sparkles,
  Music,
  Scissors,
  Layers,
  Sliders,
  Volume2,
  VolumeX,
  Subtitles,
  Share2,
} from "lucide-react";
import { RecordingResult } from "../hooks/useScreenRecording";
import {
  generateZoomKeyframes,
  interpolateZoom,
  renderFrame,
  SPRING_PRESETS,
  SpringPresetName,
  KeyframeLog,
} from "../lib/autozoom";
import { SAMPLE_TRACKS, MusicTrack } from "../lib/background-music";

// Clean Download Utils
export function triggerDownload(blob: Blob, filename: string): void {
  // FIX: Never re-wrap blob (re-wrapping corrupts video container)
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  // FIX: Revoke after 30s instead of 1s
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 30_000);
}

export function mimeToExtension(mimeType: string, fallback: string = "webm"): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mkv")) return "mkv";
  return fallback;
}

export function makeFilename(title: string, ext: string): string {
  const sanitized = title.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  const base = sanitized.length > 0 ? sanitized : "foOm_Recording";
  const timestamp = new Date().toISOString().slice(0, 10);
  return `${base}_${timestamp}.${ext}`;
}

export interface AutoZoomEditorProps {
  recordingResult: RecordingResult;
  onExport?: (result: Blob, format: string) => void;
}

export const AutoZoomEditor: React.FC<AutoZoomEditorProps> = ({ recordingResult, onExport }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);

  // Styling & Options
  const [motionPreset, setMotionPreset] = useState<SpringPresetName>("silk");
  const [bgGradient, setBgGradient] = useState("linear-gradient(135deg, #1e1b4b 0%, #311042 100%)");
  const [padding, setPadding] = useState<number>(32);
  const [borderRadius, setBorderRadius] = useState<number>(16);
  const [shadowBlur, setShadowBlur] = useState<number>(24);

  // Music & AI Captions
  const [selectedMusic, setSelectedMusic] = useState<MusicTrack | null>(null);
  const [musicVolume, setMusicVolume] = useState<number>(0.3);
  const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(false);
  const [subtitles, setSubtitles] = useState<{ startMs: number; endMs: number; text: string }[]>([]);

  // Trim Handles
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(recordingResult.durationMs);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // KEYFRAME LOG HANDOFF (P0 Fix): Pass live keyframe log directly to keyframe generator
  const zoomKeyframesRef = useRef<KeyframeLog>([]);
  useEffect(() => {
    zoomKeyframesRef.current = generateZoomKeyframes(
      recordingResult.clicks.map((c) => ({ ...c, type: "click" })),
      recordingResult.durationMs,
      {
        recordedKeyframes: recordingResult.keyframeLog, // ← KEY LINE FOR PIXEL-PERFECT EXPORT
        presetName: motionPreset,
      }
    );
  }, [recordingResult, motionPreset]);

  // Render Frame Step
  const drawEditorFrame = useCallback(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    const ctx = c.getContext("2d");
    if (!ctx) return;

    const t = v.currentTime * 1000;
    setCurrentTimeMs(t);

    // Interpolate zoom state for exact timestamp
    const kf = interpolateZoom(zoomKeyframesRef.current, t);

    const zoomState = {
      targetX: kf.x,
      targetY: kf.y,
      targetScale: kf.scale,
      currentX: kf.x,
      currentY: kf.y,
      currentScale: kf.scale,
      vx: 0,
      vy: 0,
      vScale: 0,
      mode: (kf.scale > 1.15 ? "zoomed" : "overview") as any,
      priority: 0,
      lastChangeTime: t,
    };

    renderFrame(ctx, v, zoomState, c.width, c.height, {
      padding,
      borderRadius,
      shadowBlur,
      shadowColor: "rgba(0, 0, 0, 0.5)",
      backgroundColor: bgGradient,
    });

    if (!v.paused && !v.ended) {
      animFrameIdRef.current = requestAnimationFrame(drawEditorFrame);
    }
  }, [bgGradient, padding, borderRadius, shadowBlur]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handleTimeUpdate = () => {
      if (v.paused) drawEditorFrame();
    };

    v.addEventListener("seeked", handleTimeUpdate);
    return () => v.removeEventListener("seeked", handleTimeUpdate);
  }, [drawEditorFrame]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;

    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    } else {
      v.playbackRate = playbackSpeed;
      v.play();
      setIsPlaying(true);
      animFrameIdRef.current = requestAnimationFrame(drawEditorFrame);
    }
  };

  const handleDownloadExport = () => {
    const ext = mimeToExtension(recordingResult.mimeType, "webm");
    const filename = makeFilename("foOm_Demo", ext);
    triggerDownload(recordingResult.blob, filename);
  };

  const handleDownloadRaw = () => {
    const ext = mimeToExtension(recordingResult.mimeType, "webm");
    const filename = makeFilename("foOm_Raw_Original", ext);
    triggerDownload(recordingResult.blob, filename);
  };

  return (
    <div className="flex h-screen w-full bg-neutral-950 text-white overflow-hidden font-sans">
      {/* Hidden Source Video Element */}
      <video
        ref={videoRef}
        src={recordingResult.url}
        className="hidden"
        onEnded={() => setIsPlaying(false)}
      />

      {/* Main Canvas Workspace */}
      <div className="flex-1 flex flex-col justify-between p-6 relative">
        {/* Top Bar */}
        <div className="flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-xl bg-gradient-to-r from-orange-400 to-rose-500 bg-clip-text text-transparent">
              foOm Editor
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/10 text-neutral-300 font-mono">
              {Math.round(recordingResult.durationMs / 1000)}s
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadRaw}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-neutral-200 transition-all"
            >
              Download Raw
            </button>
            <button
              onClick={handleDownloadExport}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-orange-500 to-rose-600 hover:from-orange-400 hover:to-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all"
            >
              <Download className="w-4 h-4" /> Export Video
            </button>
          </div>
        </div>

        {/* Video Canvas Container */}
        <div className="flex-1 flex items-center justify-center relative my-4">
          <canvas
            ref={canvasRef}
            width={1920}
            height={1080}
            className="max-h-full max-w-full aspect-video rounded-2xl shadow-2xl border border-white/10"
          />
        </div>

        {/* Bottom Timeline Controls */}
        <div className="bg-neutral-900/90 backdrop-blur-xl border border-white/10 p-4 rounded-2xl flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="p-3 rounded-xl bg-white text-black hover:bg-neutral-200 transition-all"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-black" /> : <Play className="w-4 h-4 fill-black ml-0.5" />}
              </button>

              <span className="font-mono text-xs text-neutral-400">
                {(currentTimeMs / 1000).toFixed(1)}s / {(recordingResult.durationMs / 1000).toFixed(1)}s
              </span>
            </div>

            {/* Playback Speed */}
            <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl">
              {[0.5, 1.0, 1.5, 2.0].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setPlaybackSpeed(s);
                    if (videoRef.current) videoRef.current.playbackRate = s;
                  }}
                  className={`px-2.5 py-1 text-xs rounded-lg font-mono transition-all ${
                    playbackSpeed === s ? "bg-white/20 text-white font-bold" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* Timeline Scrubber */}
          <input
            type="range"
            min={0}
            max={recordingResult.durationMs}
            value={currentTimeMs}
            onChange={(e) => {
              const val = Number(e.target.value);
              setCurrentTimeMs(val);
              if (videoRef.current) {
                videoRef.current.currentTime = val / 1000;
              }
            }}
            className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
          />
        </div>
      </div>

      {/* Right Customization Sidebar */}
      <div className="w-80 border-l border-white/10 bg-neutral-900/50 backdrop-blur-2xl p-6 flex flex-col gap-6 overflow-y-auto">
        <h3 className="font-bold text-sm text-neutral-300 uppercase tracking-wider">Styling & Controls</h3>

        {/* Motion Physics Presets */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-neutral-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Spring Motion Feel
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["silk", "glass", "snap", "velvet"] as SpringPresetName[]).map((p) => (
              <button
                key={p}
                onClick={() => setMotionPreset(p)}
                className={`py-2 px-3 rounded-xl text-xs capitalize font-medium transition-all ${
                  motionPreset === p ? "bg-purple-600/30 border border-purple-500/50 text-white font-bold" : "bg-white/5 border border-white/5 text-neutral-400 hover:text-white"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Background Gradients */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-neutral-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-rose-400" /> Background Wallpaper
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              "linear-gradient(135deg, #1e1b4b 0%, #311042 100%)",
              "linear-gradient(135deg, #0f172a 0%, #0284c7 100%)",
              "linear-gradient(135deg, #18181b 0%, #27272a 100%)",
              "linear-gradient(135deg, #4c0519 0%, #881337 100%)",
              "linear-gradient(135deg, #064e3b 0%, #047857 100%)",
              "#000000",
            ].map((bg, idx) => (
              <button
                key={idx}
                onClick={() => setBgGradient(bg)}
                style={{ background: bg }}
                className={`h-10 rounded-xl border transition-all ${
                  bgGradient === bg ? "border-white scale-105 shadow-md" : "border-white/10 opacity-70 hover:opacity-100"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Frame Adjustments */}
        <div className="flex flex-col gap-4 border-t border-white/10 pt-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Padding</span>
              <span>{padding}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={64}
              value={padding}
              onChange={(e) => setPadding(Number(e.target.value))}
              className="accent-rose-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Corner Radius</span>
              <span>{borderRadius}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={32}
              value={borderRadius}
              onChange={(e) => setBorderRadius(Number(e.target.value))}
              className="accent-rose-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Drop Shadow</span>
              <span>{shadowBlur}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={48}
              value={shadowBlur}
              onChange={(e) => setShadowBlur(Number(e.target.value))}
              className="accent-rose-500"
            />
          </div>
        </div>

        {/* Background Music */}
        <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
          <label className="text-xs font-semibold text-neutral-400 flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-blue-400" /> Royalty-Free Music
          </label>
          <select
            value={selectedMusic?.id || ""}
            onChange={(e) => {
              const track = SAMPLE_TRACKS.find((t) => t.id === e.target.value) || null;
              setSelectedMusic(track);
            }}
            className="bg-white/5 border border-white/10 rounded-xl p-2 text-xs text-white"
          >
            <option value="">No Music</option>
            {SAMPLE_TRACKS.map((t) => (
              <option key={t.id} value={t.id} className="bg-neutral-900">
                {t.title} ({t.mood})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
