import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { LaunchWindow } from "@/components/launch/LaunchWindow";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createFileRoute("/overlay/recording")({
  component: OverlayRecordingRoute,
});

function OverlayRecordingRoute() {
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.documentElement.style.height = "100%";
    document.documentElement.style.overflow = "hidden";
    document.body.style.background = "transparent";
    document.body.style.height = "100%";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    document.getElementById("root")?.style.setProperty("background", "transparent");
    document.getElementById("root")?.style.setProperty("height", "100%");
    document.getElementById("root")?.style.setProperty("overflow", "hidden");
  }, []);

  return (
    <TooltipProvider>
      <LaunchWindow />
    </TooltipProvider>
  );
}
