/**
 * @file FloatingRecordingControls.tsx
 * @description Screen Studio-Style Floating Glass Recording Toolbar for foOom Screen Recorder.
 *
 * Performance Contract:
 * - Glass morphism uses backdrop-filter blur capped at max 40px (backdrop-blur-2xl).
 * - Auto-sleep timer (2.6s) minimizes visual footprint during recording.
 * - Tauri native startDragging() with web drag fallback.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Square,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Sparkles,
  MousePointer,
  GripHorizontal,
  Monitor,
  Layout,
  Maximize,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface FloatingRecordingControlsProps {
  status: "idle" | "requesting" | "countdown" | "recording" | "paused" | "stopped";
  countdown: number | null;
  durationMs: number;
  autoZoomEnabled: boolean;
  micEnabled: boolean;
  webcamEnabled: boolean;
  cursorEnabled: boolean;
  selectedSource: "screen" | "window" | "area";
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onToggleAutoZoom: () => void;
  onToggleMic: () => void;
  onToggleWebcam: () => void;
  onToggleCursor: () => void;
  onSelectSource: (source: "screen" | "window" | "area") => void;
}

export const FloatingRecordingControls: React.FC<FloatingRecordingControlsProps> = ({
  status,
  countdown,
  durationMs,
  autoZoomEnabled,
  micEnabled,
  webcamEnabled,
  cursorEnabled,
  selectedSource,
  onStart,
  onPause,
  onResume,
  onStop,
  onToggleAutoZoom,
  onToggleMic,
  onToggleWebcam,
  onToggleCursor,
  onSelectSource,
}) => {
  const [isAsleep, setIsAsleep] = useState(false);
  const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-sleep after 2.6s of inactivity during recording
  const resetSleepTimer = useCallback(() => {
    setIsAsleep(false);
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    if (status === "recording") {
      sleepTimerRef.current = setTimeout(() => {
        setIsAsleep(true);
      }, 2600);
    }
  }, [status]);

  useEffect(() => {
    resetSleepTimer();
    return () => {
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    };
  }, [status, resetSleepTimer]);

  // Keyboard Shortcuts (Space = Pause/Resume, Esc = Stop)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (status === "recording" && e.code === "Space") {
        e.preventDefault();
        onPause();
      } else if (status === "paused" && e.code === "Space") {
        e.preventDefault();
        onResume();
      } else if ((status === "recording" || status === "paused") && e.code === "Escape") {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, onPause, onResume, onStop]);

  // Native Tauri Dragging with Web fallback
  const handleDragStart = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    } catch {
      // Fallback in web browser mode
    }
  };

  const formatTime = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <>
      {/* Countdown Overlay */}
      <AnimatePresence>
        {countdown !== null && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1.2, opacity: 1 }}
            exit={{ scale: 2, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md pointer-events-none"
          >
            <span className="text-9xl font-black bg-gradient-to-r from-orange-400 via-pink-500 to-purple-600 bg-clip-text text-transparent drop-shadow-2xl">
              {countdown}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Toolbar Container */}
      <motion.div
        onMouseMove={resetSleepTimer}
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 25 }}
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40"
      >
        <div
          className={`flex items-center gap-3 p-2.5 rounded-2xl bg-neutral-950/80 backdrop-blur-[40px] border border-white/10 shadow-2xl text-white transition-all duration-300 ${
            isAsleep ? "opacity-40 scale-95 hover:opacity-100 hover:scale-100" : "opacity-100 scale-100"
          }`}
        >
          {/* Drag Handle */}
          <button
            onMouseDown={handleDragStart}
            className="p-1.5 text-neutral-400 hover:text-white cursor-grab active:cursor-grabbing rounded-lg transition-colors"
            title="Drag toolbar"
          >
            <GripHorizontal className="w-4 h-4" />
          </button>

          {/* Source Selector (Idle Mode) */}
          {status === "idle" && (
            <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => onSelectSource("screen")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedSource === "screen" ? "bg-white/15 text-white shadow-sm" : "text-neutral-400 hover:text-white"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" /> Screen
              </button>
              <button
                onClick={() => onSelectSource("window")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedSource === "window" ? "bg-white/15 text-white shadow-sm" : "text-neutral-400 hover:text-white"
                }`}
              >
                <Layout className="w-3.5 h-3.5" /> Window
              </button>
              <button
                onClick={() => onSelectSource("area")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedSource === "area" ? "bg-white/15 text-white shadow-sm" : "text-neutral-400 hover:text-white"
                }`}
              >
                <Maximize className="w-3.5 h-3.5" /> Area
              </button>
            </div>
          )}

          {/* Recording Timer Display */}
          {(status === "recording" || status === "paused") && (
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-xl border border-white/5 font-mono text-sm font-semibold">
              <span className={`w-2 h-2 rounded-full ${status === "recording" ? "bg-red-500 animate-pulse" : "bg-amber-400"}`} />
              {formatTime(durationMs)}
            </div>
          )}

          {/* Feature Toggles */}
          <div className="flex items-center gap-1 border-l border-r border-white/10 px-2">
            {/* Smart AutoZoom Toggle */}
            <button
              onClick={onToggleAutoZoom}
              className={`p-2 rounded-xl transition-all relative ${
                autoZoomEnabled ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "text-neutral-400 hover:text-white"
              }`}
              title="Smart Autozoom (Spring Physics)"
            >
              <Sparkles className="w-4 h-4" />
              {autoZoomEnabled && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 bg-purple-400 rounded-full" />}
            </button>

            {/* Mic Toggle */}
            <button
              onClick={onToggleMic}
              className={`p-2 rounded-xl transition-all relative ${
                micEnabled ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "text-neutral-400 hover:text-white"
              }`}
              title="Toggle Microphone"
            >
              {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>

            {/* Webcam Toggle */}
            <button
              onClick={onToggleWebcam}
              className={`p-2 rounded-xl transition-all relative ${
                webcamEnabled ? "bg-white/15 text-white border border-white/25" : "text-neutral-400 hover:text-white"
              }`}
              title="Toggle Webcam Overlay"
            >
              {webcamEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>

            {/* Cursor Overlay Toggle */}
            <button
              onClick={onToggleCursor}
              className={`p-2 rounded-xl transition-all relative ${
                cursorEnabled ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-neutral-400 hover:text-white"
              }`}
              title="Toggle Designer Cursor"
            >
              <MousePointer className="w-4 h-4" />
            </button>
          </div>

          {/* Action Buttons: Record / Pause / Resume / Stop */}
          {status === "idle" && (
            <button
              onClick={onStart}
              className="flex items-center gap-2 px-5 py-2 rounded-xl font-bold bg-gradient-to-r from-orange-500 to-rose-600 hover:from-orange-400 hover:to-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all active:scale-95"
            >
              <div className="w-3 h-3 rounded-full bg-white animate-ping" />
              Record
            </button>
          )}

          {status === "recording" && (
            <div className="flex items-center gap-2">
              <button
                onClick={onPause}
                className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all"
                title="Pause (Space)"
              >
                <Pause className="w-4 h-4" />
              </button>
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold transition-all shadow-md shadow-red-600/40"
                title="Stop (Esc)"
              >
                <Square className="w-3.5 h-3.5 fill-white" /> Stop
              </button>
            </div>
          )}

          {status === "paused" && (
            <div className="flex items-center gap-2">
              <button
                onClick={onResume}
                className="p-2.5 rounded-xl bg-white/90 hover:bg-white text-[#0a0a0b] transition-all"
                title="Resume (Space)"
              >
                <Play className="w-4 h-4 fill-white" />
              </button>
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold transition-all"
                title="Stop (Esc)"
              >
                <Square className="w-3.5 h-3.5 fill-white" /> Stop
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
};
