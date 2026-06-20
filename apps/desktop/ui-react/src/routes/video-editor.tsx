import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import { ShortcutsProvider } from "@/contexts/ShortcutsContext";

const VideoEditor = lazy(() => import("@/components/vedio-editor/VideoEditor"));

export const Route = createFileRoute("/video-editor")({
  component: VideoEditorRoute,
});

function VideoEditorRoute() {
  return (
    <ShortcutsProvider>
      <Suspense fallback={<div className="h-screen bg-background" />}>
        <VideoEditor />
      </Suspense>
    </ShortcutsProvider>
  );
}
