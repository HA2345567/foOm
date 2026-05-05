import { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useScreenRecording, type SourceType } from "../hooks/useScreenRecording";
import { WebcamOverlay } from "./WebcamOverlay";
import { MicMeter } from "./MicMeter";
import { AutoZoomEditor } from "./AutoZoomEditor";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const sources: { value: SourceType; label: string; desc: string; icon: ReactNode }[] = [
  {
    value: "screen",
    label: "Entire Screen",
    desc: "Capture your full display",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    ),
  },
  {
    value: "window",
    label: "Application Window",
    desc: "A single app window",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
      </svg>
    ),
  },
  {
    value: "browser",
    label: "Browser Tab",
    desc: "Just one tab — best for web demos",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 8h4l2-3h6l2 3h4v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    ),
  },
];

export function RecordingStudio() {
  const r = useScreenRecording();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-primary-foreground">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="4" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-sm font-semibold text-foreground">ZoomCast</span>
          </Link>
          {r.state === "recording" && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
              <span className="font-display text-sm font-medium text-foreground tabular-nums">{formatTime(r.elapsed)}</span>
            </div>
          )}
          {r.state === "paused" && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground" />
              <span className="font-display text-sm font-medium text-muted-foreground tabular-nums">{formatTime(r.elapsed)} · Paused</span>
            </div>
          )}
          <div className="w-24" />
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-6 max-w-[1400px] mx-auto w-full">
        <AnimatePresence mode="wait">
          {/* IDLE */}
          {(r.state === "idle" || r.state === "requesting") && !r.result && (
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-2xl">
              <div className="text-center mb-10">
                <h1 className="text-display-section text-foreground">New Recording</h1>
                <p className="mt-2 text-body text-muted-foreground">AI auto-zoom turns clicks into cinematic moments.</p>
              </div>

              {/* Source picker */}
              <div className="mb-8">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Capture source</p>
                <div className="grid grid-cols-3 gap-3">
                  {sources.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => r.setSourceType(s.value)}
                      className={`p-4 rounded-xl border text-left transition-colors ${
                        r.sourceType === s.value
                          ? "border-foreground/30 bg-card"
                          : "border-border bg-card/50 hover:border-foreground/20"
                      }`}
                    >
                      <div className={`mb-3 ${r.sourceType === s.value ? "text-foreground" : "text-muted-foreground"}`}>{s.icon}</div>
                      <p className="text-sm font-medium text-foreground">{s.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-3 mb-8">
                <button
                  onClick={r.toggleMic}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-colors ${r.micEnabled ? "border-foreground/20 bg-card" : "border-border bg-card/50"}`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${r.micEnabled ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-sm font-medium text-foreground">Microphone</p>
                    <p className="text-xs text-muted-foreground">{r.micEnabled ? "Live — speak to test" : "Screen audio only"}</p>
                  </div>
                  {r.micEnabled && r.micStream && (
                    <MicMeter stream={r.micStream} className="mr-2" />
                  )}
                  <div className={`w-10 h-6 rounded-full p-0.5 transition-colors ${r.micEnabled ? "bg-primary" : "bg-muted"}`}>
                    <div className={`w-5 h-5 rounded-full bg-foreground transition-transform ${r.micEnabled ? "translate-x-4" : "translate-x-0"}`} />
                  </div>
                </button>

                <button
                  onClick={r.toggleWebcam}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-colors ${r.webcamEnabled ? "border-foreground/20 bg-card" : "border-border bg-card/50"}`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${r.webcamEnabled ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" />
                      <rect x="3" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-sm font-medium text-foreground">Webcam overlay</p>
                    <p className="text-xs text-muted-foreground">{r.webcamEnabled ? "Face cam active" : "Screen only"}</p>
                  </div>
                  <div className={`w-10 h-6 rounded-full p-0.5 transition-colors ${r.webcamEnabled ? "bg-primary" : "bg-muted"}`}>
                    <div className={`w-5 h-5 rounded-full bg-foreground transition-transform ${r.webcamEnabled ? "translate-x-4" : "translate-x-0"}`} />
                  </div>
                </button>
              </div>

              {(r.webcamStream || r.micStream) && (
                <div className="mb-6 p-4 rounded-xl border border-border bg-card flex items-center gap-4">
                  {r.webcamStream && <WebcamPreview stream={r.webcamStream} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Live preview</p>
                    <p className="text-sm text-foreground">
                      {r.webcamStream && r.micStream
                        ? "Camera and mic are active. You're ready to record."
                        : r.webcamStream
                          ? "Camera is active. Position yourself in the frame."
                          : "Mic is active. Speak to test the input level."}
                    </p>
                    {r.micStream && (
                      <div className="mt-2">
                        <MicMeter stream={r.micStream} bars={20} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {r.error && (
                <div className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive text-center">{r.error}</div>
              )}

              <button
                onClick={r.startRecording}
                disabled={r.state === "requesting"}
                className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-medium shadow-button hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <div className="w-4 h-4 rounded-full bg-destructive" />
                {r.state === "requesting" ? "Requesting access…" : "Start Recording"}
              </button>
              <p className="mt-4 text-center text-xs text-muted-foreground">A 3-second countdown begins after you pick a source.</p>
            </motion.div>
          )}

          {/* COUNTDOWN */}
          {r.state === "countdown" && (
            <motion.div key="countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              <motion.div
                key={r.countdown}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="font-display text-[12rem] font-bold text-foreground leading-none tabular-nums"
              >
                {r.countdown || "Go!"}
              </motion.div>
              <p className="text-muted-foreground mt-4">Recording starts in…</p>
            </motion.div>
          )}

          {/* RECORDING / PAUSED */}
          {(r.state === "recording" || r.state === "paused") && (
            <motion.div key="rec" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex flex-col items-center gap-8">
              <div className="relative w-full max-w-2xl aspect-video rounded-xl border border-border bg-card shadow-card overflow-hidden flex items-center justify-center">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className={`w-3 h-3 rounded-full ${r.state === "recording" ? "bg-destructive animate-pulse" : "bg-muted-foreground"}`} />
                    <span className="font-display text-2xl font-bold text-foreground tabular-nums">{formatTime(r.elapsed)}</span>
                  </div>
                  <p className="text-caption text-muted-foreground">{r.state === "recording" ? "Recording your screen…" : "Paused"}</p>
                </div>
                {r.webcamStream && <WebcamOverlay stream={r.webcamStream} />}
              </div>

              <div className="flex items-center gap-3">
                {r.state === "recording" ? (
                  <button onClick={r.pauseRecording} className="px-6 py-3 rounded-xl border border-border bg-card text-foreground text-sm font-medium hover:bg-accent transition-colors flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                    Pause
                  </button>
                ) : (
                  <button onClick={r.resumeRecording} className="px-6 py-3 rounded-xl border border-border bg-card text-foreground text-sm font-medium hover:bg-accent transition-colors flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
                    Resume
                  </button>
                )}
                <button onClick={r.stopRecording} className="px-8 py-3 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                  Stop Recording
                </button>
              </div>
            </motion.div>
          )}

          {/* STOPPED — open the editor with live auto-zoom + background picker */}
          {r.state === "stopped" && r.result && (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full"
            >
              <div className="text-center mb-6">
                <h2 className="text-display-section text-foreground">Edit & Export</h2>
                <p className="mt-2 text-body text-muted-foreground">
                  {formatTime(r.result.duration)} · {(r.result.blob.size / 1024 / 1024).toFixed(1)} MB · auto-zoom is live in preview
                </p>
              </div>
              <AutoZoomEditor recording={r.result} onDiscard={r.discardRecording} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
