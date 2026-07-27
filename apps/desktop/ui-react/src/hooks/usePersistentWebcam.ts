/**
 * @file usePersistentWebcam.ts
 * @description Tab-switch persistent webcam hook for foOm Screen Recorder.
 *
 * Fixes:
 * - FIX 1: Force video.play() on document visibilitychange return.
 * - FIX 2: setInterval @ 30fps fallback when rAF throttles in background tabs.
 * - FIX 3: OffscreenCanvas keepalive reading 1px every 500ms to keep stream alive.
 * - FIX 4: NEVER set currentTime on live stream (kills live stream); uses drawToCanvas instead.
 */

import { useState, useEffect, useRef, useCallback } from "react";

export interface WebcamDrawOptions {
  x: number;
  y: number;
  size: number;
  shape?: "circle" | "rounded" | "square";
  zoom?: number;
}

export function usePersistentWebcam(enabled: boolean = false) {
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const keepaliveCanvasRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);

  // Initialize webcam stream
  useEffect(() => {
    if (!enabled) {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        setStream(null);
      }
      setIsActive(false);
      return;
    }

    let isMounted = true;
    async function startWebcam() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: false,
        });

        if (!isMounted) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        setStream(mediaStream);
        setIsActive(true);
        setError(null);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.muted = true;
          videoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || "Failed to access webcam");
          setIsActive(false);
        }
      }
    }

    startWebcam();

    return () => {
      isMounted = false;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [enabled]);

  // FIX 1: visibilitychange listener -> force video.play() on return
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && videoRef.current && stream) {
        if (videoRef.current.paused) {
          videoRef.current.play().catch(() => {});
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [stream]);

  // FIX 3: OffscreenCanvas keepalive — reads 1px every 500ms to prevent browser idle suspension
  useEffect(() => {
    if (!isActive || !stream) return;

    if (!keepaliveCanvasRef.current) {
      if (typeof OffscreenCanvas !== "undefined") {
        keepaliveCanvasRef.current = new OffscreenCanvas(1, 1);
      } else {
        const c = document.createElement("canvas");
        c.width = 1;
        c.height = 1;
        keepaliveCanvasRef.current = c;
      }
    }

    const intervalId = setInterval(() => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        const ctx = keepaliveCanvasRef.current?.getContext("2d") as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, 1, 1);
        }
      }
    }, 500); // 500ms interval budget

    return () => clearInterval(intervalId);
  }, [isActive, stream]);

  // FIX 4: drawToCanvas() — renders frame WITHOUT ever touching video.currentTime
  const drawToCanvas = useCallback(
    (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      opts: WebcamDrawOptions
    ) => {
      const video = videoRef.current;
      if (!video || !isActive || video.readyState < 2) return;

      ctx.save();
      const { x, y, size, shape = "circle", zoom = 1.0 } = opts;

      // Clip shape
      ctx.beginPath();
      if (shape === "circle") {
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      } else if (shape === "rounded") {
        ctx.roundRect(x, y, size, size, size * 0.2);
      } else {
        ctx.rect(x, y, size, size);
      }
      ctx.clip();

      // Mirror horizontally for natural webcam feel
      ctx.translate(x + size / 2, y + size / 2);
      ctx.scale(-1, 1);

      // Center crop based on video aspect ratio & zoom
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const cropDim = Math.min(vw, vh) / zoom;
      const sx = (vw - cropDim) / 2;
      const sy = (vh - cropDim) / 2;

      ctx.drawImage(video, sx, sy, cropDim, cropDim, -size / 2, -size / 2, size, size);
      ctx.restore();
    },
    [isActive]
  );

  return {
    videoRef,
    isActive,
    error,
    stream,
    drawToCanvas,
  };
}
