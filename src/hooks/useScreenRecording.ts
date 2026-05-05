import { useState, useRef, useCallback, useEffect } from "react";
import { saveRecording, loadRecording, clearRecording } from "../lib/db";

export type RecordingState =
  | "idle"
  | "requesting"
  | "countdown"
  | "recording"
  | "paused"
  | "stopped";

export type SourceType = "screen" | "window" | "browser";

export interface ClickEvent {
  /** seconds from recording start */
  t: number;
  /** normalized 0..1 within video frame */
  x: number;
  y: number;
}

export interface ScrollEvent {
  t: number;
  /** normalized scroll delta magnitude */
  intensity: number;
}

export interface PauseEvent {
  /** start time, seconds */
  t: number;
  /** duration of pause, seconds */
  duration: number;
}

export interface RecordingResult {
  blob: Blob;
  url: string;
  duration: number;
  width: number;
  height: number;
  clicks: ClickEvent[];
  scrolls: ScrollEvent[];
  pauses: PauseEvent[];
  mimeType: string;
}

const displaySurfaceMap: Record<SourceType, DisplayCaptureSurfaceType> = {
  screen: "monitor",
  window: "window",
  browser: "browser",
};

export function useScreenRecording() {
  const [state, setState] = useState<RecordingState>("idle");
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [micEnabled, setMicEnabledState] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>("screen");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const clicksRef = useRef<ClickEvent[]>([]);
  const scrollsRef = useRef<ScrollEvent[]>([]);
  const pausesRef = useRef<PauseEvent[]>([]);
  const lastActivityRef = useRef<number>(0);
  const pauseStartTimeRef = useRef<number | null>(null);
  const dimsRef = useRef<{ w: number; h: number }>({ w: 1280, h: 720 });
  const mimeRef = useRef<string>("video/webm");

  useEffect(() => {
    const restore = async () => {
      const saved = await loadRecording();
      if (saved && saved.blob) {
        const url = URL.createObjectURL(saved.blob);
        setResult({ ...saved, url });
        setState("stopped");
      }
    };
    restore();
  }, []);

  const cleanup = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    micStreamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const toggleWebcam = useCallback(async () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      setWebcamStream(null);
      setWebcamEnabled(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
        });
        setWebcamStream(stream);
        setWebcamEnabled(true);
      } catch {
        setError("Webcam access denied");
      }
    }
  }, [webcamStream]);

  const setMicEnabled = useCallback(
    async (next: boolean) => {
      if (next === micEnabled) return;
      if (!next) {
        micStream?.getTracks().forEach((t) => t.stop());
        setMicStream(null);
        setMicEnabledState(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicStream(stream);
        setMicEnabledState(true);
      } catch {
        setError("Microphone access denied");
        setMicEnabledState(false);
      }
    },
    [micEnabled, micStream],
  );

  const toggleMic = useCallback(() => setMicEnabled(!micEnabled), [micEnabled, setMicEnabled]);

  // Global click listener tied to OS cursor isn't possible in the browser;
  // we approximate by listening to pointerdown on the page during recording.
  // For full-screen captures these clicks won't fire, so we expose `recordClick`
  // for the recording UI to call when a click is detected via the screen stream.
  const recordClick = useCallback((xNorm: number, yNorm: number) => {
    if (!startTimeRef.current) return;
    const t = (Date.now() - startTimeRef.current) / 1000;
    clicksRef.current.push({ t, x: xNorm, y: yNorm });
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const handler = (e: PointerEvent) => {
      // Map viewport click to normalized (best-effort for tab capture)
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      recordClick(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
    };
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [state, recordClick]);

  useEffect(() => {
    if (state !== "recording") return;
    const handler = (e: WheelEvent) => {
      const t = (Date.now() - startTimeRef.current) / 1000;
      const intensity = Math.min(1, Math.abs(e.deltaY) / 500);
      scrollsRef.current.push({ t, intensity });
    };
    window.addEventListener("wheel", handler, { passive: true });
    return () => window.removeEventListener("wheel", handler);
  }, [state]);

  const beginCapture = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    clicksRef.current = [];
    scrollsRef.current = [];
    pausesRef.current = [];

    // Pre-flight checks
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen capture isn't supported in this browser. Try the latest Chrome, Edge, or Firefox.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("Your browser doesn't support MediaRecorder.");
      return;
    }

    setState("requesting");

    let screenStream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;

    try {
      // 1) Acquire display stream — MUST be inside the user gesture, so do it first
      const constraints: DisplayMediaStreamOptions = {
        video: {
          frameRate: { ideal: 30, max: 60 },
          displaySurface: displaySurfaceMap[sourceType],
        } as MediaTrackConstraints,
        audio: true,
      };
      screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
      screenStreamRef.current = screenStream;

      const videoTrack = screenStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("No video track returned from screen capture");
      const settings = videoTrack.getSettings();
      dimsRef.current = {
        w: settings.width ?? 1280,
        h: settings.height ?? 720,
      };

      // 2) Reuse existing mic stream if user already enabled it; otherwise acquire fresh
      let micTrack: MediaStreamTrack | null = null;
      if (micEnabled) {
        try {
          const liveMic =
            micStream && micStream.getAudioTracks().some((t) => t.readyState === "live")
              ? micStream
              : await navigator.mediaDevices.getUserMedia({
                  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                });
          micStreamRef.current = liveMic;
          if (liveMic !== micStream) setMicStream(liveMic);
          micTrack = liveMic.getAudioTracks()[0] ?? null;
        } catch (e) {
          console.warn("Mic acquisition failed:", e);
        }
      }

      // 3) Mix system audio + mic into a single track via Web Audio (max compat across browsers)
      const screenAudioTracks = screenStream.getAudioTracks();
      const tracks: MediaStreamTrack[] = [videoTrack];

      if (screenAudioTracks.length > 0 || micTrack) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          audioCtx = new AudioCtx();
          const dest = audioCtx.createMediaStreamDestination();
          if (screenAudioTracks.length > 0) {
            const sysSrc = audioCtx.createMediaStreamSource(new MediaStream(screenAudioTracks));
            const sysGain = audioCtx.createGain();
            sysGain.gain.value = 0.9;
            sysSrc.connect(sysGain).connect(dest);
          }
          if (micTrack) {
            const micSrc = audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
            const micGain = audioCtx.createGain();
            micGain.gain.value = 1.0;
            micSrc.connect(micGain).connect(dest);
          }
          tracks.push(...dest.stream.getAudioTracks());
        } catch (e) {
          console.warn("Audio mixing failed, falling back to raw tracks:", e);
          if (screenAudioTracks.length > 0) tracks.push(...screenAudioTracks);
          if (micTrack) tracks.push(micTrack);
        }
      }

      const combined = new MediaStream(tracks);

      // 4) Choose a supported mime type (try several, in order of quality)
      const candidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=h264,opus",
        "video/webm",
        "video/mp4",
      ];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      if (!mimeType) {
        throw new Error("No supported video MIME type found for MediaRecorder");
      }
      mimeRef.current = mimeType;

      const recorder = new MediaRecorder(combined, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
        audioBitsPerSecond: 128_000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const duration = (Date.now() - startTimeRef.current) / 1000;
        const recordingResult: RecordingResult = {
          blob,
          url,
          duration,
          width: dimsRef.current.w,
          height: dimsRef.current.h,
          clicks: clicksRef.current.slice(),
          scrolls: scrollsRef.current.slice(),
          pauses: pausesRef.current.slice(),
          mimeType,
        };
        setResult(recordingResult);
        saveRecording(recordingResult);
        setState("stopped");
        cleanup();
      };

      videoTrack.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
      });

      mediaRecorderRef.current = recorder;

      // Countdown 3-2-1
      setState("countdown");
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise((r) => setTimeout(r, 800));
      }
      setCountdown(0);

      recorder.start(1000);
      startTimeRef.current = Date.now();
      setState("recording");
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (err) {
      cleanup();
      setState("idle");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Screen sharing was cancelled");
      } else {
        setError("Failed to start recording");
      }
    }
  }, [micEnabled, sourceType, cleanup]);

  const pauseRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r?.state === "recording") {
      r.pause();
      setState("paused");
      pauseStartTimeRef.current = Date.now();
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r?.state === "paused") {
      if (pauseStartTimeRef.current) {
        const pauseT = (pauseStartTimeRef.current - startTimeRef.current) / 1000;
        const duration = (Date.now() - pauseStartTimeRef.current) / 1000;
        pausesRef.current.push({ t: pauseT, duration });
        pauseStartTimeRef.current = null;
      }
      r.resume();
      setState("recording");
      const base = Date.now() - elapsed * 1000;
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - base) / 1000));
      }, 1000);
    }
  }, [elapsed]);

  const stopRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  const discardRecording = useCallback(() => {
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);
    clearRecording();
    setState("idle");
    setElapsed(0);
    setError(null);
  }, [result]);

  const downloadRecording = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `zoomcast-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [result]);

  useEffect(() => {
    return () => {
      cleanup();
      webcamStream?.getTracks().forEach((t) => t.stop());
      micStream?.getTracks().forEach((t) => t.stop());
    };
  }, [cleanup, webcamStream, micStream]);

  return {
    state,
    result,
    elapsed,
    countdown,
    error,
    micEnabled,
    setMicEnabled,
    toggleMic,
    micStream,
    webcamEnabled,
    webcamStream,
    toggleWebcam,
    sourceType,
    setSourceType,
    startRecording: beginCapture,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    downloadRecording,
    recordClick,
  };
}
