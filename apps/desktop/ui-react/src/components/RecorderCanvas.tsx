/**
 * @file RecorderCanvas.tsx
 * @description Interactive Recorder Canvas Component for foOom Screen Recorder.
 * Captures user pointer, click, scroll, and keystroke telemetry and feeds them into the IntentBus.
 */

import React, { useRef, useEffect, useCallback } from "react";

export interface RecorderCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  recordClick: (xNorm: number, yNorm: number) => void;
  recordScroll: (xNorm: number, yNorm: number, deltaY: number) => void;
  recordPointer: (xNorm: number, yNorm: number) => void;
  recordKeystroke: () => void;
  isRecording: boolean;
}

export const RecorderCanvas: React.FC<RecorderCanvasProps> = ({
  canvasRef,
  videoRef,
  recordClick,
  recordScroll,
  recordPointer,
  recordKeystroke,
  isRecording,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Normalize pointer coordinates relative to canvas bounds [0..1]
  const getNormalizedCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!canvasRef.current) return { x: 0.5, y: 0.5 };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }, [canvasRef]);

  const handlePointerMove = (e: React.MouseEvent) => {
    if (!isRecording) return;
    const { x, y } = getNormalizedCoords(e);
    recordPointer(x, y);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!isRecording) return;
    const { x, y } = getNormalizedCoords(e);
    recordClick(x, y);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!isRecording) return;
    const { x, y } = getNormalizedCoords(e);
    recordScroll(x, y, e.deltaY);
  };

  // Capture global keyboard burst events
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys alone
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      recordKeystroke();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecording, recordKeystroke]);

  return (
    <div
      ref={containerRef}
      onMouseMove={handlePointerMove}
      onClick={handleClick}
      onWheel={handleWheel}
      className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden select-none cursor-crosshair"
    >
      {/* Hidden Video Source */}
      <video ref={videoRef} className="hidden" playsInline muted autoPlay />

      {/* Main Composited Canvas */}
      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        className="max-w-full max-h-full aspect-video shadow-2xl rounded-xl object-contain border border-white/5"
      />
    </div>
  );
};
