import { useState, useEffect } from "react";
import { useMotionValue, useSpring } from "framer-motion";

export type CursorState = "default" | "pointer" | "text" | "hidden";

export function useCustomCursor() {
  const [cursorState, setCursorState] = useState<CursorState>("default");
  const [isClicked, setIsClicked] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  // Premium buttery easing for that "Screen Studio" / "Figma" feel
  const springConfig = { damping: 28, stiffness: 350, mass: 0.5 };

  const smoothX = useSpring(cursorX, springConfig);
  const smoothY = useSpring(cursorY, springConfig);

  useEffect(() => {
    // Check if we are running in the Tauri desktop environment
    const isTauri =
      "__TAURI_INTERNALS__" in window ||
      "__TAURI__" in window ||
      window.navigator.userAgent.includes("Tauri");

    if (!isTauri) {
      // Do nothing in browser/landing page. Custom cursor remains invisible and native cursor acts normally.
      return;
    }

    // Apply CSS class to hide native cursor in webview
    document.documentElement.classList.add("hide-cursor");

    // 1. OS-Level Native Suppression (Tauri)
    // We try to import Tauri dynamically so it doesn't crash the web version
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        try {
          const appWindow = getCurrentWindow();
          if (appWindow) {
            appWindow.setCursorVisible(false).catch(() => {});
          }
        } catch (e) {
          // Not running in Tauri environment
        }
      })
      .catch(() => {});

    // 2. Drag-and-Drop native cursor suppression
    // Browsers force a drag cursor. We neutralize it with a transparent 1x1 pixel.
    const transparentPixel = new Image();
    transparentPixel.src =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

    const handleDragStart = (e: DragEvent) => {
      if (e.dataTransfer) {
        e.dataTransfer.setDragImage(transparentPixel, 0, 0);
      }
    };

    // 3. Continuous Web Fallback Enforcement
    // Periodically re-apply cursor: none to body in case Chromium tries to restore it
    const enforceCursorNone = () => {
      document.documentElement.classList.add("hide-cursor");
      if (document.body.style.cursor !== "none") {
        document.body.style.setProperty("cursor", "none", "important");
      }
      document.documentElement.style.setProperty("cursor", "none", "important");
    };

    // Run enforcement loop
    const enforcementInterval = setInterval(enforceCursorNone, 500);

    const moveCursor = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      if (!isVisible) setIsVisible(true);

      // Force enforce on move just to be absolutely certain
      if (Math.random() > 0.9) enforceCursorNone();

      // Magnetic/Hover Detection
      const target = e.target as HTMLElement;

      const isInteractive =
        window.getComputedStyle(target).cursor === "pointer" ||
        target.tagName.toLowerCase() === "button" ||
        target.tagName.toLowerCase() === "a" ||
        target.closest("button") ||
        target.closest("a");

      const isText = window.getComputedStyle(target).cursor === "text";

      if (isText) setCursorState("text");
      else if (isInteractive) setCursorState("pointer");
      else setCursorState("default");
    };

    const handleMouseDown = () => setIsClicked(true);
    const handleMouseUp = () => setIsClicked(false);
    const handleMouseLeave = () => setIsVisible(false);
    const handleMouseEnter = () => setIsVisible(true);

    window.addEventListener("mousemove", moveCursor, { passive: true });
    window.addEventListener("mousedown", handleMouseDown, { passive: true });
    window.addEventListener("mouseup", handleMouseUp, { passive: true });
    window.addEventListener("mouseleave", handleMouseLeave, { passive: true });
    window.addEventListener("mouseenter", handleMouseEnter, { passive: true });
    window.addEventListener("dragstart", handleDragStart);

    return () => {
      window.removeEventListener("mousemove", moveCursor);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("mouseenter", handleMouseEnter);
      window.removeEventListener("dragstart", handleDragStart);
      clearInterval(enforcementInterval);
      document.documentElement.classList.remove("hide-cursor");
      document.body.style.removeProperty("cursor");
      document.documentElement.style.removeProperty("cursor");
    };
  }, [cursorX, cursorY, isVisible]);

  return {
    x: smoothX,
    y: smoothY,
    cursorState,
    isClicked,
    isVisible,
  };
}
