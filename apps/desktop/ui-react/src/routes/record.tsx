/**
 * @file record.tsx
 * @description Main Recording View Route for foOom Screen Recorder.
 * Wires RecorderCanvas, FloatingRecordingControls, useScreenRecording, and usePersistentWebcam.
 */

import React, { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useScreenRecording, RecordingResult } from "../hooks/useScreenRecording";
import { usePersistentWebcam } from "../hooks/usePersistentWebcam";
import { FloatingRecordingControls } from "../components/FloatingRecordingControls";
import { RecorderCanvas } from "../components/RecorderCanvas";

export const Route = createFileRoute("/record")({
  component: RecordPage,
});

function RecordPage() {
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
    onRecordingStopped: async (result: RecordingResult) => {
      try {
        const stored = await window.foomNative.storeRecordedSession({
          screen: {
            videoData: await result.blob.arrayBuffer(),
            fileName: `recording-${Date.now()}.webm`,
          },
          createdAt: Date.now(),
          durationMs: result.durationMs,
        });

        if (!stored?.success || !stored.session) {
          throw new Error(stored?.error ?? stored?.message ?? "Could not save the recording.");
        }

        const loaded = await window.foomNative.setCurrentRecordingSession(stored.session);
        if (loaded?.success === false) {
          throw new Error(loaded.error ?? loaded.message ?? "Could not load the recording in the editor.");
        }

        const opened = await window.foomNative.switchToEditor();
        if (opened?.success === false) {
          throw new Error(opened.error ?? opened.message ?? "Could not open the video editor.");
        }
      } catch (error) {
        console.error("Failed to hand off recording to the video editor:", error);
        window.__FOOM_LAST_RESULT = result;
        toast.error(error instanceof Error ? error.message : "Could not open the video editor.");
        window.location.hash = "/editor";
      }
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
