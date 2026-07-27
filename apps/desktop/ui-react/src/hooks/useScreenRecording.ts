/**
 * @file useScreenRecording.ts
 * @description High-Performance Recording Lifecycle Hook for foOm Screen Recorder.
 *
 * Performance Contract:
 * - rAF vs setInterval guard: rAF when active tab, setInterval when hidden tab. NEVER both.
 * - Reuses single AudioContext instance to avoid memory GC spikes.
 * - Offloads VisionEngine frame analysis to vision-worker Web Worker.
 * - Stores raw video Blobs in refs (NOT React state) to avoid re-renders.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  createInitialZoomState,
  tickEngine,
  renderFrame,
  IntentSignal,
  KeyframeLog,
  ZoomState,
} from "../lib/autozoom";
import { VisionWorkerResponse } from "../lib/vision-worker";

export type RecordingStatus = "idle" | "requesting" | "countdown" | "recording" | "paused" | "stopped";

export interface RecordingResult {
  blob: Blob;
  url: string;
  durationMs: number;
  width: number;
  height: number;
  clicks: { timestamp: number; x: number; y: number }[];
  scrolls: { timestamp: number; x: number; y: number; deltaY: number }[];
  pauses: { timestamp: number; durationMs: number }[];
  mimeType: string;
  keyframeLog: KeyframeLog;
}

export interface UseScreenRecordingConfig {
  autoZoomEnabled?: boolean;
  micEnabled?: boolean;
  webcamStream?: MediaStream | null;
  onRecordingStopped?: (result: RecordingResult) => void;
}

export function useScreenRecording(config: UseScreenRecordingConfig = {}) {
  const { autoZoomEnabled = true, micEnabled = false, webcamStream = null, onRecordingStopped } = config;

  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  // Core Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Web Worker for Vision Engine
  const visionWorkerRef = useRef<Worker | null>(null);

  // Engine States
  const zoomStateRef = useRef<ZoomState>(createInitialZoomState());
  const intentBusRef = useRef<IntentSignal[]>([]);
  const keyframeLogRef = useRef<KeyframeLog>([]);

  // Telemetry
  const clicksRef = useRef<{ timestamp: number; x: number; y: number }[]>([]);
  const scrollsRef = useRef<{ timestamp: number; x: number; y: number; deltaY: number }[]>([]);
  const pausesRef = useRef<{ timestamp: number; durationMs: number }[]>([]);

  const lastCursorMoveTimeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const animFrameIdRef = useRef<number | null>(null);
  const bgIntervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const frameCountRef = useRef<number>(0);

  // Hidden Video & Canvas for Compositing
  const videoElemRef = useRef<HTMLVideoElement | null>(null);
  const canvasElemRef = useRef<HTMLCanvasElement | null>(null);

  // Initialize Worker & Video elements
  useEffect(() => {
    // Instantiate Vision Engine Web Worker
    visionWorkerRef.current = new Worker(new URL("../lib/vision-worker.ts", import.meta.url), {
      type: "module",
    });

    visionWorkerRef.current.onmessage = (e: MessageEvent<VisionWorkerResponse>) => {
      if (e.data.type === "result") {
        const { x, y, confidence } = e.data.result;
        if (confidence > 0.3) {
          intentBusRef.current.push({
            type: "hint",
            x,
            y,
            strength: confidence,
            priority: 1,
            timestamp: performance.now() - startTimeRef.current,
          });
        }
      }
    };

    if (!videoElemRef.current) {
      const v = document.createElement("video");
      v.autoplay = true;
      v.muted = true;
      v.playsInline = true;
      videoElemRef.current = v;
    }

    if (!canvasElemRef.current) {
      const c = document.createElement("canvas");
      c.width = 1920;
      c.height = 1080;
      canvasElemRef.current = c;
    }

    return () => {
      visionWorkerRef.current?.terminate();
    };
  }, []);

  // Telemetry Recorders
  const recordClick = useCallback((xNorm: number, yNorm: number) => {
    const ts = performance.now() - startTimeRef.current;
    clicksRef.current.push({ timestamp: ts, x: xNorm, y: yNorm });
    intentBusRef.current.push({
      type: "click",
      x: xNorm,
      y: yNorm,
      priority: 10,
      timestamp: ts,
    });
  }, []);

  const recordScroll = useCallback((xNorm: number, yNorm: number, deltaY: number) => {
    const ts = performance.now() - startTimeRef.current;
    scrollsRef.current.push({ timestamp: ts, x: xNorm, y: yNorm, deltaY });
    intentBusRef.current.push({
      type: deltaY > 0 ? "scroll_out" : "click",
      x: xNorm,
      y: yNorm,
      priority: 7,
      timestamp: ts,
    });
  }, []);

  const recordPointer = useCallback((xNorm: number, yNorm: number) => {
    const now = performance.now();
    lastCursorMoveTimeRef.current = now;
    intentBusRef.current.push({
      type: "pointer",
      x: xNorm,
      y: yNorm,
      priority: 2,
      timestamp: now - startTimeRef.current,
    });
  }, []);

  const recordKeystroke = useCallback(() => {
    const ts = performance.now() - startTimeRef.current;
    intentBusRef.current.push({
      type: "type_burst",
      priority: 8,
      timestamp: ts,
    });
  }, []);

  // Main Render Frame Callback
  const drawFrame = useCallback(() => {
    const v = videoElemRef.current;
    const c = canvasElemRef.current;
    if (!v || !c || v.readyState < 2) return;

    const ctx = c.getContext("2d");
    if (!ctx) return;

    const now = performance.now();
    const elapsed = now - startTimeRef.current;
    setDurationMs(elapsed);

    // 1. Tick Spring Autozoom Engine
    tickEngine(
      zoomStateRef.current,
      intentBusRef.current,
      keyframeLogRef.current,
      elapsed,
      0.016, // ~16ms
      autoZoomEnabled
    );

    // Clear consumed intent signals older than 500ms
    intentBusRef.current = intentBusRef.current.filter((sig) => elapsed - sig.timestamp < 500);

    // 2. Render Frame (Crop Zoom + Optional Webcam)
    renderFrame(
      ctx,
      v,
      zoomStateRef.current,
      c.width,
      c.height,
      { padding: 0, borderRadius: 0 },
      webcamStream ? { stream: webcamStream } : undefined
    );

    // 3. Post to Vision Web Worker every 2nd frame (30fps analysis off-thread)
    frameCountRef.current++;
    if (frameCountRef.current % 2 === 0 && visionWorkerRef.current && typeof createImageBitmap !== "undefined") {
      createImageBitmap(v)
        .then((bitmap) => {
          visionWorkerRef.current?.postMessage({ action: "analyze", imageBitmap: bitmap }, [bitmap]);
        })
        .catch(() => {});
    }
  }, [autoZoomEnabled, webcamStream]);

  // Render Loop with Strict rAF vs setInterval Guard
  useEffect(() => {
    if (status !== "recording") {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      if (bgIntervalIdRef.current) clearInterval(bgIntervalIdRef.current);
      return;
    }

    const loop = () => {
      drawFrame();
      animFrameIdRef.current = requestAnimationFrame(loop);
    };

    const handleVisibilityChange = () => {
      // FIX: Guard against running rAF and setInterval simultaneously
      if (document.visibilityState === "hidden") {
        if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
        bgIntervalIdRef.current = setInterval(drawFrame, 1000 / 60);
      } else {
        if (bgIntervalIdRef.current) clearInterval(bgIntervalIdRef.current);
        animFrameIdRef.current = requestAnimationFrame(loop);
      }
    };

    // Start with active visibility state
    if (document.visibilityState === "visible") {
      animFrameIdRef.current = requestAnimationFrame(loop);
    } else {
      bgIntervalIdRef.current = setInterval(drawFrame, 1000 / 60);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      if (bgIntervalIdRef.current) clearInterval(bgIntervalIdRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [status, drawFrame]);

  // Start Recording Action
  const startRecording = useCallback(async () => {
    try {
      setStatus("requesting");

      // 1. Request Display Stream (60fps target)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });

      screenStreamRef.current = displayStream;

      if (videoElemRef.current) {
        videoElemRef.current.srcObject = displayStream;
        await videoElemRef.current.play();
      }

      // Resize canvas to match capture resolution
      const videoTrack = displayStream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      if (canvasElemRef.current && settings.width && settings.height) {
        canvasElemRef.current.width = settings.width;
        canvasElemRef.current.height = settings.height;
      }

      // 2. Reuse / Setup AudioContext
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const dest = audioCtx.createMediaStreamDestination();

      // Mix display audio if present
      if (displayStream.getAudioTracks().length > 0) {
        const displayAudioSource = audioCtx.createMediaStreamSource(displayStream);
        displayAudioSource.connect(dest);
      }

      // Mix microphone audio if requested
      if (micEnabled) {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        micStreamRef.current = micStream;
        const micAudioSource = audioCtx.createMediaStreamSource(micStream);
        micAudioSource.connect(dest);
      }

      // 3. Setup Composite Canvas Stream
      const canvasStream = canvasElemRef.current!.captureStream(60);
      const combinedTracks = [
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ];
      const finalStream = new MediaStream(combinedTracks);

      // 4. Countdown 3-2-1
      setStatus("countdown");
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise((r) => setTimeout(r, 800));
      }
      setCountdown(null);

      // 5. Reset Telemetry & Engine State
      clicksRef.current = [];
      scrollsRef.current = [];
      pausesRef.current = [];
      intentBusRef.current = [];
      keyframeLogRef.current = [];
      zoomStateRef.current = createInitialZoomState();
      startTimeRef.current = performance.now();

      // 6. Initialize MediaRecorder (VP9/WebM 12Mbps)
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";

      const recorder = new MediaRecorder(finalStream, {
        mimeType,
        videoBitsPerSecond: 12_000_000,
      });

      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const dur = performance.now() - startTimeRef.current;

        const result: RecordingResult = {
          blob,
          url,
          durationMs: dur,
          width: canvasElemRef.current?.width || 1920,
          height: canvasElemRef.current?.height || 1080,
          clicks: clicksRef.current,
          scrolls: scrollsRef.current,
          pauses: pausesRef.current,
          mimeType,
          keyframeLog: keyframeLogRef.current,
        };

        setStatus("stopped");
        if (onRecordingStopped) onRecordingStopped(result);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // 1s slice
      setStatus("recording");
    } catch (err: any) {
      setStatus("idle");
      console.error("Failed to start recording:", err);
    }
  }, [micEnabled, onRecordingStopped]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && status === "recording") {
      mediaRecorderRef.current.pause();
      setStatus("paused");
    }
  }, [status]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && status === "paused") {
      mediaRecorderRef.current.resume();
      setStatus("recording");
    }
  }, [status]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && (status === "recording" || status === "paused")) {
      mediaRecorderRef.current.stop();
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    }
  }, [status]);

  return {
    status,
    countdown,
    durationMs,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    recordClick,
    recordScroll,
    recordPointer,
    recordKeystroke,
    videoRef: videoElemRef,
    canvasRef: canvasElemRef,
  };
}
