import { createFileRoute } from "@tanstack/react-router";
import { RecordingStudio } from "../components/RecordingStudio";

export const Route = createFileRoute("/record")({
  component: RecordPage,
  head: () => ({
    meta: [
      { title: "Record — ZoomCast" },
      { name: "description", content: "Start a new screen recording with AI auto-zoom, mic, and webcam." },
    ],
  }),
});

function RecordPage() {
  return <RecordingStudio />;
}
