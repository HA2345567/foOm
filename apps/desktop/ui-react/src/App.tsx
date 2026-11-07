import { lazy, Suspense, useEffect, useState } from "react";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { ShortcutsProvider } from "./contexts/ShortcutsContext";
import { loadAllCustomFonts } from "./lib/customFonts";
import { StudioHome } from "./components/StudioHome";

const VideoEditor = lazy(() => import("./components/vedio-editor/VideoEditor"));
const ShortcutsConfigDialog = lazy(() =>
  import("./components/vedio-editor/ShortcutsConfigDialog").then((module) => ({
    default: module.ShortcutsConfigDialog,
  })),
);

export default function App() {
  const [windowType, setWindowType] = useState(
    () => new URLSearchParams(window.location.search).get("windowType") || "",
  );

  useEffect(() => {
    const type = new URLSearchParams(window.location.search).get("windowType") || "";
    if (type !== windowType) {
      setWindowType(type);
    }

    if (type === "hud-overlay" || type === "source-selector") {
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
      document.getElementById("root")?.style.setProperty("background", "transparent");
    }

    // HUD is a fixed-size BrowserWindow; pin the document shell and hide overflow
    // so the renderer can't introduce scrollbars (see issue #305).
    if (type === "hud-overlay") {
      document.documentElement.style.height = "100%";
      document.documentElement.style.overflow = "hidden";
      document.body.style.height = "100%";
      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
      const root = document.getElementById("root");
      root?.style.setProperty("height", "100%");
      root?.style.setProperty("min-height", "0");
      root?.style.setProperty("overflow", "hidden");
    }
  }, [windowType]);

  useEffect(() => {
    // Load custom fonts on app initialization
    loadAllCustomFonts().catch((error) => {
      console.error("Failed to load custom fonts:", error);
    });
  }, []);

  const content = (() => {
    switch (windowType) {
      case "hud-overlay":
        return <LaunchWindow />;
      case "source-selector":
        return <SourceSelector />;
      case "editor":
        return (
          <ShortcutsProvider>
            <Suspense fallback={<div className="h-screen bg-background" />}>
              <VideoEditor />
              <ShortcutsConfigDialog />
            </Suspense>
          </ShortcutsProvider>
        );
      default:
        return <StudioHome />;
    }
  })();

  return (
    <TooltipProvider>
      {content}
      <Toaster theme="dark" className="pointer-events-auto" />
    </TooltipProvider>
  );
}
