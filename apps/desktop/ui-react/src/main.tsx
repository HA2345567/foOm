import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import App from "./App";
import { I18nProvider } from "./contexts/I18nContext";
import { getRouter } from "./router";
import { installTauriCompatBridge } from "./native/tauriCompat";
import "./styles.css";

installTauriCompatBridge();

// Preserve recording and project state so recordings can be recovered after a restart.
const router = getRouter();
const currentRecordingSessionKey = "foom-current-recording-session";
const currentVideoPathKey = "foom-current-video-path";
const currentProjectFileKey = "foom-current-project-file";
const currentProjectPathKey = "foom-current-project-path";
const editorRouteIntentKey = "foom-open-editor-route-intent";
const settingsRouteIntentKey = "foom-open-settings-route-intent";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

type NavigateToEditorPayload = {
  recordingSession?: unknown;
  videoPath?: unknown;
  projectRaw?: string;
  projectPath?: string;
};

function navigateToEditor() {
  const isVideoEditor =
    window.location.hash.startsWith("#/video-editor") ||
    window.location.pathname === "/video-editor";
  if (isVideoEditor) {
    window.location.reload();
    return;
  }

  window.location.hash = "/video-editor";
}

function applyNavigationPayload() {
  const rawPayload = localStorage.getItem("foom-navigation-payload");
  if (!rawPayload) return;
  try {
    const payload = JSON.parse(rawPayload);
    if (payload.recordingSession) {
      localStorage.setItem(currentRecordingSessionKey, JSON.stringify(payload.recordingSession));
      localStorage.removeItem(currentProjectFileKey);
      localStorage.removeItem(currentProjectPathKey);
    } else if (typeof payload.videoPath === "string" && payload.videoPath.trim()) {
      localStorage.setItem(currentVideoPathKey, payload.videoPath);
      localStorage.removeItem(currentRecordingSessionKey);
      localStorage.removeItem(currentProjectFileKey);
      localStorage.removeItem(currentProjectPathKey);
    } else if (payload.projectRaw && payload.projectPath) {
      localStorage.setItem(currentProjectFileKey, payload.projectRaw);
      localStorage.setItem(currentProjectPathKey, payload.projectPath);
      localStorage.removeItem(currentRecordingSessionKey);
      localStorage.removeItem(currentVideoPathKey);
    }
    localStorage.removeItem("foom-navigation-payload");
  } catch (e) {
    console.error("Failed to parse navigation payload", e);
  }
}

function consumeEditorRouteIntent() {
  const intent = localStorage.getItem(editorRouteIntentKey);
  if (!intent) {
    return;
  }

  localStorage.removeItem(editorRouteIntentKey);
  applyNavigationPayload();
  navigateToEditor();
}

function consumeSettingsRouteIntent() {
  const intent = localStorage.getItem(settingsRouteIntentKey);
  if (!intent) {
    return;
  }
  localStorage.removeItem(settingsRouteIntentKey);
  window.location.hash = "/settings";
}

async function installDesktopNavigationEvents() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { listen } = await import("@tauri-apps/api/event");
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = await getCurrentWindow();

    if (currentWindow.label !== "main") {
      return;
    }

    await listen<NavigateToEditorPayload>("navigate-to-editor", (event) => {
      localStorage.removeItem(editorRouteIntentKey);
      const payload = event.payload;
      if (
        payload &&
        (payload.recordingSession ||
          payload.videoPath ||
          (payload.projectRaw && payload.projectPath))
      ) {
        localStorage.setItem("foom-navigation-payload", JSON.stringify(payload));
      }
      applyNavigationPayload();
      navigateToEditor();
    });

    await listen("navigate-to-settings", () => {
      localStorage.removeItem(settingsRouteIntentKey);
      window.location.hash = "/settings";
    });

    consumeEditorRouteIntent();
    consumeSettingsRouteIntent();
    window.addEventListener("focus", consumeEditorRouteIntent);
    window.addEventListener("focus", consumeSettingsRouteIntent);
    document.addEventListener("visibilitychange", consumeEditorRouteIntent);
    document.addEventListener("visibilitychange", consumeSettingsRouteIntent);
  } catch (error) {
    console.warn("Tauri navigation event listener setup failed:", error);
  }
}

void installDesktopNavigationEvents();

function shouldRenderUtilityWindowApp() {
  const windowType = new URLSearchParams(window.location.search).get("windowType");
  return Boolean(windowType);
}

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {shouldRenderUtilityWindowApp() ? (
      <I18nProvider>
        <App />
      </I18nProvider>
    ) : (
      <RouterProvider router={router} />
    )}
  </React.StrictMode>,
);
