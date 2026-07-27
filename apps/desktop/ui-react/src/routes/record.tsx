/**
 * @file record.tsx
 * @description Main Recording View Route for foOm Screen Recorder.
 * Wires RecorderCanvas, FloatingRecordingControls, useScreenRecording, and usePersistentWebcam.
 */

import React, { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useScreenRecording, RecordingResult } from "../hooks/useScreenRecording";
import { usePersistentWebcam } from "../hooks/usePersistentWebcam";
import { FloatingRecordingControls } from "../components/FloatingRecordingControls";
import { RecorderCanvas } from "../components/RecorderCanvas";

export const Route = createFileRoute("/record")({
  component: RecordPage,
});

function RecordPage() {
  const navigate = useNavigate();

  // Control States
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(false);
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [cursorEnabled, setCursorEnabled] = useState(true);
  const [selectedSource, setSelectedSource] = useState<"screen" | "window" | "area">("screen");

  // Persistent Webcam Hook
  const { stream: webcamStream } = usePersistentWebcam(webcamEnabled);

  // Screen Recording Lifecycle Hook
  const {
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
    videoRef,
    canvasRef,
  } = useScreenRecording({
    autoZoomEnabled,
    micEnabled,
    webcamStream,
    onRecordingStopped: (result: RecordingResult) => {
      // Store result in window state or navigate to editor route with payload
      (window as any).__FOOM_LAST_RESULT = result;
      navigate({ to: "/editor" as any });
    },
  });

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden flex flex-col items-center justify-center">
      {/* Live Composite Canvas */}
      <RecorderCanvas
        canvasRef={canvasRef}
        videoRef={videoRef}
        recordClick={recordClick}
        recordScroll={recordScroll}
        recordPointer={recordPointer}
        recordKeystroke={recordKeystroke}
        isRecording={status === "recording"}
      />

      {/* Screen Studio-Style Floating Toolbar */}
      <FloatingRecordingControls
        status={status}
        countdown={countdown}
        durationMs={durationMs}
        autoZoomEnabled={autoZoomEnabled}
        micEnabled={micEnabled}
        webcamEnabled={webcamEnabled}
        cursorEnabled={cursorEnabled}
        selectedSource={selectedSource}
        onStart={startRecording}
        onPause={pauseRecording}
        onResume={resumeRecording}
        onStop={stopRecording}
        onToggleAutoZoom={() => setAutoZoomEnabled((prev) => !prev)}
        onToggleMic={() => setMicEnabled((prev) => !prev)}
        onToggleWebcam={() => setWebcamEnabled((prev) => !prev)}
        onToggleCursor={() => setCursorEnabled((prev) => !prev)}
        onSelectSource={(source) => setSelectedSource(source)}
      />
    </div>
  );
}
