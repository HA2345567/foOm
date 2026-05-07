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
export type CameraShape = "circle" | "square" | "rounded";

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
  cameraBlob?: Blob;
  cameraUrl?: string;
  cameraMimeType?: string;
  cameraShape?: CameraShape;
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
  const [cameraShape, setCameraShape] = useState<CameraShape>("circle");
  const [sourceType, setSourceType] = useState<SourceType>("screen");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const camRecorderRef = useRef<MediaRecorder | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const camChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const clicksRef = useRef<ClickEvent[]>([]);
  const scrollsRef = useRef<ScrollEvent[]>([]);
  const pausesRef = useRef<PauseEvent[]>([]);
  const lastActivityRef = useRef<number>(0);
  const pauseStartTimeRef = useRef<number | null>(null);
  const dimsRef = useRef<{ w: number; h: number }>({ w: 1280, h: 720 });
  const mimeRef = useRef<string>("video/webm");
  const audioCtxRef = useRef<AudioContext | null>(null);

  const registerWebcamVideo = useCallback((el: HTMLVideoElement | null) => {
    webcamVideoRef.current = el;
  }, []);

  useEffect(() => {
    const restore = async () => {
      const saved = await loadRecording();
      if (saved && saved.blob) {
        const url = URL.createObjectURL(saved.blob);
        let cameraUrl;
        if (saved.cameraBlob) cameraUrl = URL.createObjectURL(saved.cameraBlob);
        setResult({ ...saved, url, cameraUrl });
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
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
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
          video: { width: 640, height: 480, facingMode: "user" },
          audio: micEnabled ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          } : false,
        });
        setWebcamStream(stream);
        setWebcamEnabled(true);
      } catch (err) {
        console.error("Webcam access denied", err);
        setError("Webcam access denied. Please check permissions.");
      }
    }
  }, [webcamStream, micEnabled]);

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
    // 1. Trigger PiP immediately to use the user gesture
    if (webcamEnabled && webcamVideoRef.current && !document.pictureInPictureElement) {
      try {
        await webcamVideoRef.current.requestPictureInPicture();
      } catch (e) {
        console.warn("Auto-PiP failed", e);
      }
    }

    setError(null);
    setState("requesting");
    chunksRef.current = [];
    camChunksRef.current = [];
    clicksRef.current = [];
    scrollsRef.current = [];
    pausesRef.current = [];

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

      const screenAudioTracks = screenStream.getAudioTracks();
      const finalTracks: MediaStreamTrack[] = [videoTrack];

      // Mix Audio
      try {
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const dest = audioCtx.createMediaStreamDestination();
        let hasAudio = false;

        // 1. System audio
        if (screenAudioTracks.length > 0) {
          const source = audioCtx.createMediaStreamSource(new MediaStream(screenAudioTracks));
          source.connect(dest);
          hasAudio = true;
        }

        // 2. Mic audio
        if (micEnabled) {
          try {
            let micStream: MediaStream;
            if (webcamStream && webcamStream.getAudioTracks().length > 0) {
              micStream = webcamStream;
            } else {
              micStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                } 
              });
              micStreamRef.current = micStream; // Store for cleanup
            }
            const source = audioCtx.createMediaStreamSource(micStream);
            source.connect(dest);
            hasAudio = true;
          } catch (e) {
            console.warn("Mic access failed during mix", e);
          }
        }

        if (hasAudio) {
          finalTracks.push(dest.stream.getAudioTracks()[0]);
        }
      } catch (e) {
        console.error("Audio mixing failed, falling back to raw tracks", e);
        if (screenAudioTracks.length > 0) finalTracks.push(screenAudioTracks[0]);
      }

      const combined = new MediaStream(finalTracks);
      const hasAudio = finalTracks.some(t => t.kind === 'audio');
      
      let mimeType = "video/webm";
      if (hasAudio) {
        mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
            ? "video/webm;codecs=vp8,opus"
            : "video/webm";
      } else {
        mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
      }
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
        
        let cameraBlob;
        let cameraUrl;
        if (camRecorderRef.current && camChunksRef.current.length > 0) {
          cameraBlob = new Blob(camChunksRef.current, { type: camRecorderRef.current.mimeType });
          cameraUrl = URL.createObjectURL(cameraBlob);
        }

        const duration = (Date.now() - startTimeRef.current) / 1000;
        const recordingResult: RecordingResult = {
          blob,
          url,
          cameraBlob,
          cameraUrl,
          cameraMimeType: camRecorderRef.current?.mimeType,
          cameraShape,
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
        
        // Exit PiP and stop live webcam if active
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        }
        webcamStream?.getTracks().forEach(t => t.stop());
        setWebcamStream(null);
        setWebcamEnabled(false);

        cleanup();
      };

      videoTrack.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
        if (camRecorderRef.current?.state !== "inactive") camRecorderRef.current?.stop();
      });

      mediaRecorderRef.current = recorder;

      // Handle Camera Recorder if enabled
      if (webcamEnabled && webcamStream) {
        try {
          const camRecorder = new MediaRecorder(webcamStream, {
            // Use a simpler mime for camera to avoid codec conflicts
            mimeType: "video/webm", 
            videoBitsPerSecond: 1_000_000,
          });
          camRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) camChunksRef.current.push(e.data);
          };
          camRecorderRef.current = camRecorder;
        } catch (e) {
          console.warn("Camera recorder failed to init", e);
        }
      }

      // Countdown 3-2-1
      setState("countdown");
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise((r) => setTimeout(r, 800));
      }
      setCountdown(0);

      recorder.start(1000);
      try {
        camRecorderRef.current?.start(1000);
      } catch (e) {
        console.warn("Cam recorder start failed", e);
      }
      startTimeRef.current = Date.now();
      setState("recording");
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (err) {
      console.error("Capture failed", err);
      cleanup();
      setState("idle");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Screen sharing was cancelled");
      } else {
        setError("Failed to start recording: " + (err as any).message);
      }
    }
  }, [micEnabled, sourceType, webcamEnabled, webcamStream, cleanup]);

  const pauseRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r?.state === "recording") {
      r.pause();
      camRecorderRef.current?.pause();
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
      camRecorderRef.current?.resume();
      setState("recording");
      const base = Date.now() - elapsed * 1000;
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - base) / 1000));
      }, 1000);
    }
  }, [elapsed]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    camRecorderRef.current?.stop();
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
    cameraShape,
    setCameraShape,
    screenStream: screenStreamRef.current,
    toggleWebcam,
    sourceType,
    setSourceType,
    startRecording: beginCapture,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    downloadRecording,
    registerWebcamVideo,
    recordClick,
  };
}
