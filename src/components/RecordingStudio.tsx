import { type ReactNode, useEffect, useRef } from "react";
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
            <div className="w-7 h-7 rounded-md bg-[#f5f5f7] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-black">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="4" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-sm font-medium tracking-tight text-foreground">ZoOmly</span>
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
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-5xl">
              
              <div className="text-center mb-12">
                <h1 className="text-display-section">Studio Setup</h1>
                <p className="mt-3 text-body-large max-w-xl mx-auto">Configure your capture sources before the cinematic auto-zoom begins.</p>
              </div>

              <div className="flex flex-col md:flex-row rounded-3xl border border-border shadow-2xl bg-card overflow-hidden relative">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                
                {/* Left: Source Selection */}
                <div className="flex-1 p-8 md:p-10 border-b md:border-b-0 md:border-r border-border bg-background/40">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    Video Source
                  </h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {sources.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => r.setSourceType(s.value)}
                        className={`group relative p-5 rounded-2xl border text-left transition-all duration-300 ${
                          r.sourceType === s.value
                            ? "border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary),0.1)]"
                            : "border-border bg-card hover:border-foreground/30 hover:bg-accent/50"
                        }`}
                      >
                        {r.sourceType === s.value && (
                          <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary animate-pulse" />
                        )}
                        <div className={`mb-4 transition-colors ${r.sourceType === s.value ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
                          {s.icon}
                        </div>
                        <p className={`text-sm font-semibold transition-colors ${r.sourceType === s.value ? "text-primary" : "text-foreground"}`}>{s.label}</p>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{s.desc}</p>
                      </button>
                    ))}
                  </div>

                  <div className="mt-10 p-5 rounded-2xl bg-primary/5 border border-primary/10">
                    <p className="text-xs font-bold text-primary flex items-center gap-2 uppercase tracking-widest mb-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                      Pro Tip: Floating Mode
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Enable your webcam below and toggle the <strong>Floating Mode (PiP)</strong> on the bubble. Your camera will stay visible perfectly synced across all browser tabs while you present.
                    </p>
                  </div>
                </div>

                {/* Right: Inputs & CTA */}
                <div className="w-full md:w-[380px] p-8 md:p-10 bg-card/80 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">Input Devices</h3>
                    
                    <div className="space-y-4">
                      {/* Mic Toggle */}
                      <button
                        onClick={() => r.setMicEnabled(!r.micEnabled)}
                        className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 ${r.micEnabled ? "border-primary/30 bg-primary/5" : "border-border bg-background"}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${r.micEnabled ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-muted text-muted-foreground"}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                              <line x1="12" x2="12" y1="19" y2="22" />
                            </svg>
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-semibold text-foreground">Microphone</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{r.micEnabled ? "Voice active" : "Screen only"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {r.micEnabled && r.micStream && <MicMeter stream={r.micStream} className="w-8" />}
                          <div className={`w-12 h-6 rounded-full p-1 transition-colors ${r.micEnabled ? "bg-primary" : "bg-muted"}`}>
                            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${r.micEnabled ? "translate-x-6" : "translate-x-0 shadow-sm"}`} />
                          </div>
                        </div>
                      </button>

                      {/* Webcam Toggle */}
                      <button
                        onClick={r.toggleWebcam}
                        className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 ${r.webcamEnabled ? "border-primary/30 bg-primary/5" : "border-border bg-background"}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${r.webcamEnabled ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-muted text-muted-foreground"}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" />
                              <rect x="3" y="6" width="12" height="12" rx="2" />
                            </svg>
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-semibold text-foreground">Webcam</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{r.webcamEnabled ? "Overlay active" : "Off"}</p>
                          </div>
                        </div>
                        <div className={`w-12 h-6 rounded-full p-1 transition-colors ${r.webcamEnabled ? "bg-primary" : "bg-muted"}`}>
                          <div className={`w-4 h-4 rounded-full bg-white transition-transform ${r.webcamEnabled ? "translate-x-6" : "translate-x-0 shadow-sm"}`} />
                        </div>
                      </button>

                      {r.webcamEnabled && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="pt-2 px-1">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">Lens Shape</p>
                          <div className="flex gap-2 p-1.5 rounded-xl bg-background border border-border">
                            {(["circle", "rounded", "square"] as const).map((shape) => (
                              <button
                                key={shape}
                                onClick={() => r.setCameraShape(shape)}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
                                  r.cameraShape === shape
                                    ? "bg-foreground text-background shadow-md scale-100"
                                    : "text-muted-foreground hover:text-foreground scale-95 hover:scale-100"
                                }`}
                              >
                                {shape}
                              </button>
                            ))}
                          </div>
                          
                          {r.webcamStream && (
                            <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-background border border-border">
                               <WebcamPreview stream={r.webcamStream} />
                               <div className="text-[11px] text-muted-foreground leading-tight">
                                 Live preview active. Ensure you are well lit for the best result.
                               </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-border">
                    {r.error && (
                      <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive text-center flex items-center justify-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        {r.error}
                      </div>
                    )}
                    
                    <button
                      onClick={r.startRecording}
                      disabled={r.state === "requesting"}
                      className="w-full py-5 rounded-2xl bg-foreground text-background font-bold text-lg shadow-xl hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-3 relative overflow-hidden group"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                      <div className="w-3.5 h-3.5 rounded-full bg-destructive shadow-[0_0_12px_rgba(255,0,0,0.6)]" />
                      {r.state === "requesting" ? "Requesting access…" : "Start Recording"}
                    </button>
                    <p className="mt-4 text-center text-[11px] font-medium text-muted-foreground tracking-wide uppercase">3-second countdown</p>
                  </div>
                </div>
              </div>
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
                {r.screenStream ? (
                  <video
                    autoPlay
                    playsInline
                    muted
                    ref={(el) => { if (el && r.screenStream) el.srcObject = r.screenStream; }}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <span className={`w-3 h-3 rounded-full ${r.state === "recording" ? "bg-destructive animate-pulse" : "bg-muted-foreground"}`} />
                      <span className="font-display text-2xl font-bold text-foreground tabular-nums">{formatTime(r.elapsed)}</span>
                    </div>
                    <p className="text-caption text-muted-foreground">{r.state === "recording" ? "Recording your screen…" : "Paused"}</p>
                  </div>
                )}
                
                {r.screenStream && (
                  <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                    <span className={`w-2 h-2 rounded-full ${r.state === "recording" ? "bg-destructive animate-pulse" : "bg-muted-foreground"}`} />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">{formatTime(r.elapsed)}</span>
                  </div>
                )}
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

          {/* STOPPED — Editor */}
          {r.state === "stopped" && r.result && (
            <motion.div key="editor" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full">
              <div className="text-center mb-6">
                <h2 className="text-display-section">Edit & Export</h2>
                <p className="mt-2 text-body text-muted-foreground">
                  {formatTime(r.result.duration)} · {(r.result.blob.size / 1024 / 1024).toFixed(1)} MB · auto-zoom is live in preview
                </p>
              </div>
              <AutoZoomEditor recording={r.result} onDiscard={r.discardRecording} />
            </motion.div>
          )}
        </AnimatePresence>
        
        {r.webcamStream && (
          <WebcamOverlay stream={r.webcamStream} onRegister={r.registerWebcamVideo} />
        )}
      </div>
    </div>
  );
}

function WebcamPreview({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-primary shadow-lg shadow-primary/20 shrink-0">
      <video ref={ref} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
    </div>
  );
}
