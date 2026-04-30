import { useState, useRef, useCallback, useEffect } from "react";

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
  const [micEnabled, setMicEnabled] = useState(true);
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
  const dimsRef = useRef<{ w: number; h: number }>({ w: 1280, h: 720 });
  const mimeRef = useRef<string>("video/webm");

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

  const beginCapture = useCallback(async () => {
    setError(null);
    setState("requesting");
    chunksRef.current = [];
    clicksRef.current = [];

    try {
      const constraints: DisplayMediaStreamOptions = {
        video: {
          frameRate: 30,
          displaySurface: displaySurfaceMap[sourceType],
        } as MediaTrackConstraints,
        audio: true,
      };
      const screenStream =
        await navigator.mediaDevices.getDisplayMedia(constraints);
      screenStreamRef.current = screenStream;

      const videoTrack = screenStream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      dimsRef.current = {
        w: settings.width ?? 1280,
        h: settings.height ?? 720,
      };

      const tracks: MediaStreamTrack[] = [videoTrack];
      const screenAudioTracks = screenStream.getAudioTracks();
      if (screenAudioTracks.length > 0) tracks.push(...screenAudioTracks);

      if (micEnabled) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          micStreamRef.current = micStream;
          tracks.push(...micStream.getAudioTracks());
        } catch {
          console.warn("Mic denied");
        }
      }

      const combined = new MediaStream(tracks);
      const mimeType = MediaRecorder.isTypeSupported(
        "video/webm;codecs=vp9,opus",
      )
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
          ? "video/webm;codecs=vp8,opus"
          : "video/webm";
      mimeRef.current = mimeType;

      const recorder = new MediaRecorder(combined, {
        mimeType,
        videoBitsPerSecond: 3_000_000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const duration = (Date.now() - startTimeRef.current) / 1000;
        setResult({
          blob,
          url,
          duration,
          width: dimsRef.current.w,
          height: dimsRef.current.h,
          clicks: clicksRef.current.slice(),
          mimeType,
        });
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
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r?.state === "paused") {
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
    };
  }, [cleanup, webcamStream]);

  return {
    state,
    result,
    elapsed,
    countdown,
    error,
    micEnabled,
    setMicEnabled,
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
