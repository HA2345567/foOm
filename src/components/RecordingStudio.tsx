import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { useScreenRecording } from "../hooks/useScreenRecording";
import { WebcamOverlay } from "./WebcamOverlay";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function RecordingStudio() {
  const {
    state,
    result,
    elapsed,
    error,
    micEnabled,
    setMicEnabled,
    webcamEnabled,
    webcamStream,
    toggleWebcam,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    downloadRecording,
  } = useScreenRecording();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
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

          {/* Recording indicator */}
          {state === "recording" && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
              <span className="font-display text-sm font-medium text-foreground tabular-nums">
                {formatTime(elapsed)}
              </span>
            </div>
          )}
          {state === "paused" && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground" />
              <span className="font-display text-sm font-medium text-muted-foreground tabular-nums">
                {formatTime(elapsed)} · Paused
              </span>
            </div>
          )}

          <div className="w-24" />
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex items-center justify-center p-6">
        <AnimatePresence mode="wait">
          {/* === IDLE STATE === */}
          {state === "idle" && !result && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-lg"
            >
              <div className="text-center mb-10">
                <h1 className="text-display-section text-foreground">New Recording</h1>
                <p className="mt-2 text-body text-muted-foreground">
                  Choose your settings, then hit record.
                </p>
              </div>

              {/* Settings */}
              <div className="space-y-3 mb-10">
                {/* Mic toggle */}
                <button
                  onClick={() => setMicEnabled(!micEnabled)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                    micEnabled
                      ? "border-foreground/20 bg-card"
                      : "border-border bg-card/50"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    micEnabled ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"
                  }`}>
                    {micEnabled ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <line x1="2" x2="22" y1="2" y2="22" />
                        <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
                        <path d="M5 10v2a7 7 0 0 0 12 5" />
                        <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    )}
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-sm font-medium text-foreground">Microphone</p>
                    <p className="text-xs text-muted-foreground">
                      {micEnabled ? "Enabled — your voice will be recorded" : "Disabled — screen audio only"}
                    </p>
                  </div>
                  <div className={`w-10 h-6 rounded-full p-0.5 transition-colors ${
                    micEnabled ? "bg-primary" : "bg-muted"
                  }`}>
                    <div className={`w-5 h-5 rounded-full bg-foreground transition-transform ${
                      micEnabled ? "translate-x-4" : "translate-x-0"
                    }`} />
                  </div>
                </button>

                {/* Webcam toggle */}
                <button
                  onClick={toggleWebcam}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                    webcamEnabled
                      ? "border-foreground/20 bg-card"
                      : "border-border bg-card/50"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    webcamEnabled ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"
                  }`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" />
                      <rect x="3" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-sm font-medium text-foreground">Webcam</p>
                    <p className="text-xs text-muted-foreground">
                      {webcamEnabled ? "Enabled — face cam overlay active" : "Disabled — screen only"}
                    </p>
                  </div>
                  <div className={`w-10 h-6 rounded-full p-0.5 transition-colors ${
                    webcamEnabled ? "bg-primary" : "bg-muted"
                  }`}>
                    <div className={`w-5 h-5 rounded-full bg-foreground transition-transform ${
                      webcamEnabled ? "translate-x-4" : "translate-x-0"
                    }`} />
                  </div>
                </button>
              </div>

              {/* Error */}
              {error && (
                <div className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive text-center">
                  {error}
                </div>
              )}

              {/* Record button */}
              <button
                onClick={startRecording}
                disabled={state === "requesting"}
                className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-medium shadow-button hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <div className="w-4 h-4 rounded-full bg-destructive" />
                {state === "requesting" ? "Requesting access…" : "Start Recording"}
              </button>

              <p className="mt-4 text-center text-xs text-muted-foreground">
                You'll be asked to choose which screen or tab to share.
              </p>
            </motion.div>
          )}

          {/* === RECORDING / PAUSED STATE === */}
          {(state === "recording" || state === "paused") && (
            <motion.div
              key="recording"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center gap-8"
            >
              {/* Live preview area */}
              <div className="relative w-full max-w-2xl aspect-video rounded-xl border border-border bg-card shadow-card overflow-hidden flex items-center justify-center">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className={`w-3 h-3 rounded-full ${
                      state === "recording" ? "bg-destructive animate-pulse" : "bg-muted-foreground"
                    }`} />
                    <span className="font-display text-2xl font-bold text-foreground tabular-nums">
                      {formatTime(elapsed)}
                    </span>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {state === "recording" ? "Recording your screen…" : "Recording paused"}
                  </p>
                </div>

                {/* Webcam overlay */}
                {webcamStream && <WebcamOverlay stream={webcamStream} />}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3">
                {state === "recording" ? (
                  <button
                    onClick={pauseRecording}
                    className="px-6 py-3 rounded-xl border border-border bg-card text-foreground text-sm font-medium hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" rx="1" />
                      <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={resumeRecording}
                    className="px-6 py-3 rounded-xl border border-border bg-card text-foreground text-sm font-medium hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="6,4 20,12 6,20" />
                    </svg>
                    Resume
                  </button>
                )}

                <button
                  onClick={stopRecording}
                  className="px-8 py-3 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  Stop Recording
                </button>
              </div>
            </motion.div>
          )}

          {/* === STOPPED / PREVIEW STATE === */}
          {state === "stopped" && result && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-3xl"
            >
              <div className="text-center mb-8">
                <h2 className="text-display-section text-foreground">Recording complete</h2>
                <p className="mt-2 text-body text-muted-foreground">
                  {formatTime(Math.round(result.duration))} recorded · {(result.blob.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>

              {/* Video preview */}
              <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden mb-8">
                <video
                  src={result.url}
                  controls
                  className="w-full aspect-video bg-secondary"
                />
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={downloadRecording}
                  className="w-full sm:w-auto px-8 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-button hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" x2="12" y1="15" y2="3" />
                  </svg>
                  Download WebM
                </button>
                <button
                  onClick={discardRecording}
                  className="w-full sm:w-auto px-8 py-3 rounded-xl border border-border bg-card text-foreground text-sm font-medium hover:bg-accent transition-colors"
                >
                  Record Again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
