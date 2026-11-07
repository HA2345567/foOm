/**
 * @file editor.tsx
 * @description Post-Recording Editor Route for foOom Screen Recorder.
 * Renders AutoZoomEditor with Keyframe Log Handoff.
 */

import React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AutoZoomEditor } from "../components/AutoZoomEditor";
import { RecordingResult } from "../hooks/useScreenRecording";

export const Route = createFileRoute("/editor")({
  component: EditorPage,
});

function EditorPage() {
  const navigate = useNavigate();
  const lastResult: RecordingResult | undefined = window.__FOOM_LAST_RESULT;

  if (!lastResult) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white gap-4">
        <h2 className="text-2xl font-bold">No Active Recording Found</h2>
        <p className="text-sm text-neutral-400">Please record a clip first before opening the editor.</p>
        <button
          onClick={() => navigate({ to: "/record" })}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 font-bold text-white shadow-lg"
        >
          Go to Recorder
        </button>
      </div>
    );
  }

  return <AutoZoomEditor recordingResult={lastResult} />;
}
