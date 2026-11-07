import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ShortcutsProvider, useShortcuts } from "@/contexts/ShortcutsContext";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import "./settings.css";
import {
  Keyboard,
  Volume2,
  Mic,
  Video,
  MousePointer,
  Info,
  ChevronLeft,
  RotateCcw,
  HelpCircle,
  Check,
  SlidersHorizontal,
} from "lucide-react";
import {
  DEFAULT_SHORTCUTS,
  FIXED_SHORTCUTS,
  findConflict,
  findGlobalRecordingShortcutConflict,
  formatBinding,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutsConfig,
} from "@/lib/shortcuts";

export const Route = createFileRoute("/settings")({
  component: () => (
    <ShortcutsProvider>
      <SettingsRoute />
    </ShortcutsProvider>
  ),
});

type SettingsTab = "general" | "shortcuts" | "about";
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function SettingsRoute() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // --- General Settings State ---
  const [defaultMic, setDefaultMic] = useState(false);
  const [defaultSystemAudio, setDefaultSystemAudio] = useState(false);
  const [defaultWebcam, setDefaultWebcam] = useState(false);
  const [defaultCursorMode, setDefaultCursorMode] = useState("editable-overlay");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Load General settings from localStorage
    try {
      setDefaultMic(localStorage.getItem("foom-setting-default-mic") === "true");
      setDefaultSystemAudio(localStorage.getItem("foom-setting-default-system-audio") === "true");
      setDefaultWebcam(localStorage.getItem("foom-setting-default-webcam") === "true");
      setDefaultCursorMode(
        localStorage.getItem("foom-setting-default-cursor-mode") || "editable-overlay",
      );
    } catch (e) {
      console.error("Failed to load general settings", e);
      setSaveError("Saved preferences could not be loaded. Your recording defaults are shown below.");
    }
  }, []);

  const saveGeneralSetting = (key: string, value: string | boolean) => {
    try {
      localStorage.setItem(key, String(value));
      setSaveError(null);
      toast.success("Setting updated");
      return true;
    } catch (e) {
      setSaveError("This setting could not be saved. Try again before starting a recording.");
      toast.error("Failed to save setting");
      return false;
    }
  };

  // --- Shortcuts State (Using ShortcutsContext) ---
  const {
    shortcuts,
    globalRecordingShortcut,
    isMac,
    setShortcuts,
    persistShortcuts,
    persistGlobalRecordingShortcut,
  } = useShortcuts();
  const [draftShortcuts, setDraftShortcuts] = useState<ShortcutsConfig>(shortcuts);
  const [draftGlobalRecordingShortcut, setDraftGlobalRecordingShortcut] =
    useState<ShortcutBinding>(globalRecordingShortcut);
  const [captureFor, setCaptureFor] = useState<ShortcutAction | null>(null);
  const [isCapturingGlobalShortcut, setIsCapturingGlobalShortcut] = useState(false);
  const [supportsGlobalRecordingShortcut, setSupportsGlobalRecordingShortcut] = useState(false);
  const [conflict, setConflict] = useState<{
    forAction: ShortcutAction;
    pending: ShortcutBinding;
    conflictWith:
      | { type: "configurable"; action: ShortcutAction }
      | { type: "fixed"; label: string };
  } | null>(null);

  useEffect(() => {
    if (activeTab !== "shortcuts") {
      setCaptureFor(null);
      setIsCapturingGlobalShortcut(false);
      setConflict(null);
    }
  }, [activeTab]);

  // Keep draft in sync with shortcuts when loaded
  useEffect(() => {
    setDraftShortcuts(shortcuts);
  }, [shortcuts]);

  useEffect(() => {
    setDraftGlobalRecordingShortcut(globalRecordingShortcut);
  }, [globalRecordingShortcut]);

  useEffect(() => {
    let cancelled = false;
    void window.foomNative
      ?.getPlatform()
      .then((platform) => {
        if (!cancelled) setSupportsGlobalRecordingShortcut(platform === "win32");
      })
      .catch(() => {
        if (!cancelled) setSupportsGlobalRecordingShortcut(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for keydown when capturing shortcuts
  useEffect(() => {
    if (!captureFor) return;

    const handleCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setCaptureFor(null);
        return;
      }

      if (MODIFIER_KEYS.has(e.key)) return;

      const binding: ShortcutBinding = {
        key: e.key.toLowerCase(),
        ...(e.ctrlKey || e.metaKey ? { ctrl: true } : {}),
        ...(e.shiftKey ? { shift: true } : {}),
        ...(e.altKey ? { alt: true } : {}),
      };

      const found = findConflict(binding, captureFor, draftShortcuts);
      setCaptureFor(null);

      if (found?.type === "fixed") {
        toast.error(`Reserved shortcut: conflicted with '${found.label}'`);
        return;
      }

      if (found?.type === "configurable") {
        setConflict({ forAction: captureFor, pending: binding, conflictWith: found });
        return;
      }

      setDraftShortcuts((prev) => ({ ...prev, [captureFor]: binding }));
      toast.success("Shortcut assigned. Don't forget to save changes!");
    };

    window.addEventListener("keydown", handleCapture, { capture: true });
    return () => window.removeEventListener("keydown", handleCapture, { capture: true });
  }, [captureFor, draftShortcuts]);

  useEffect(() => {
    if (!isCapturingGlobalShortcut) return;

    const handleCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setIsCapturingGlobalShortcut(false);
        return;
      }
      if (MODIFIER_KEYS.has(e.key)) return;

      const binding: ShortcutBinding = {
        key: e.key.toLowerCase(),
        ...(e.ctrlKey || (isMac && e.metaKey) ? { ctrl: true } : {}),
        ...(e.shiftKey ? { shift: true } : {}),
        ...(e.altKey ? { alt: true } : {}),
      };
      setIsCapturingGlobalShortcut(false);

      if (!binding.ctrl && !binding.shift && !binding.alt) {
        toast.error("Use at least one modifier (Ctrl, Shift, or Alt) for a global shortcut.");
        return;
      }
      const conflict = findGlobalRecordingShortcutConflict(binding, draftShortcuts);
      if (conflict?.type === "fixed") {
        toast.error(`Reserved shortcut: conflicts with '${conflict.label}'`);
        return;
      }
      if (conflict?.type === "configurable") {
        toast.error(`This combination is already assigned to '${SHORTCUT_LABELS[conflict.action]}'.`);
        return;
      }
      setDraftGlobalRecordingShortcut(binding);
    };

    window.addEventListener("keydown", handleCapture, { capture: true });
    return () => window.removeEventListener("keydown", handleCapture, { capture: true });
  }, [isCapturingGlobalShortcut, isMac, draftShortcuts]);

  const handleSwap = useCallback(() => {
    if (!conflict || conflict.conflictWith.type !== "configurable") return;
    const { forAction, pending, conflictWith } = conflict;
    setDraftShortcuts((prev) => ({
      ...prev,
      [forAction]: pending,
      [conflictWith.action]: prev[forAction],
    }));
    setConflict(null);
    toast.success("Shortcuts swapped. Save to apply.");
  }, [conflict]);

  const handleSaveShortcuts = useCallback(async () => {
    try {
      if (supportsGlobalRecordingShortcut) {
        const conflict = findGlobalRecordingShortcutConflict(
          draftGlobalRecordingShortcut,
          draftShortcuts,
        );
        if (conflict) {
          const message = conflict.type === "fixed"
            ? `Reserved shortcut: conflicts with '${conflict.label}'`
            : `This combination is already assigned to '${SHORTCUT_LABELS[conflict.action]}'.`;
          toast.error(message);
          return;
        }
        await persistGlobalRecordingShortcut(draftGlobalRecordingShortcut);
      }
      await persistShortcuts(draftShortcuts);
      setShortcuts(draftShortcuts);
      toast.success("Shortcuts saved successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to register shortcuts.");
    }
  }, [
    draftGlobalRecordingShortcut,
    draftShortcuts,
    persistGlobalRecordingShortcut,
    persistShortcuts,
    setShortcuts,
    supportsGlobalRecordingShortcut,
  ]);

  const handleResetShortcuts = useCallback(() => {
    setDraftShortcuts({ ...DEFAULT_SHORTCUTS });
    setDraftGlobalRecordingShortcut({ key: "r", ctrl: true, shift: true });
    toast.info("Shortcuts reset to defaults");
  }, []);

  const navigateBack = async () => {
    // If we came from the HUD overlay (no active project/video/recording loaded),
    // go back to the floating toolbar (HUD overlay).
    // Otherwise, go back to the editor.
    const hasActiveProject =
      localStorage.getItem("foom-current-video-path") ||
      localStorage.getItem("foom-current-recording-session") ||
      localStorage.getItem("foom-current-project-file");
    if (!hasActiveProject && window.foomNative) {
      await window.foomNative.startNewRecording();
    } else {
      void router.navigate({ to: "/video-editor" });
    }
  };

  const hasShortcutChanges = JSON.stringify(draftShortcuts) !== JSON.stringify(shortcuts) ||
    JSON.stringify(draftGlobalRecordingShortcut) !== JSON.stringify(globalRecordingShortcut);

  return (
    <div className="settings-studio">
      {/* Left Sidebar */}
      <aside className="settings-sidebar">
        <div>
          {/* Header */}
          <div className="settings-brand">
            <button
              onClick={navigateBack}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 transition-colors"
              title="Back to Editor"
              aria-label="Back to workspace"
            >
              <ChevronLeft size={16} />
            </button>
            <div><span className="settings-wordmark">foOom<span>●</span></span><p className="settings-brand-caption">Your recording studio</p></div>
          </div>

          {/* Navigation tabs */}
          <nav className="settings-navigation" aria-label="Settings sections">
            <p className="settings-nav-label">PREFERENCES</p>
            <button
              onClick={() => setActiveTab("general")}
              aria-current={activeTab === "general" ? "page" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === "general"
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <SlidersHorizontal size={16} />
              <span>General</span>
            </button>
            <button
              onClick={() => setActiveTab("shortcuts")}
              aria-current={activeTab === "shortcuts" ? "page" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === "shortcuts"
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Keyboard size={16} />
              <span>Keyboard Shortcuts</span>
            </button>
            <button
              onClick={() => setActiveTab("about")}
              aria-current={activeTab === "about" ? "page" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === "about"
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Info size={16} />
              <span>About</span>
            </button>
          </nav>
        </div>

        {/* Version footer */}
        <div className="settings-sidebar-footer">
          <span className="settings-status-dot" /> Local by default
          <p>foOom · v0.2.0 beta</p>
        </div>
      </aside>

      {/* Main Settings Panel */}
      <main className="settings-main">
        <header className="settings-topbar"><span>Workspace <span className="settings-crumb-separator">/</span> Settings</span><span className="settings-local-badge"><span className="settings-status-dot" /> {activeTab === "shortcuts" && hasShortcutChanges ? "Unsaved shortcut changes" : "On this device"}</span></header>
        <div className="settings-content space-y-8">
          {saveError && <div role="alert" className="settings-error">{saveError}</div>}
          {activeTab === "general" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white mb-1">
                  A studio that feels like you.
                </h2>
                <p className="text-xs text-zinc-400">
                  Set up your recording defaults once. Stay in your flow every time.
                </p>
              </div>

              <div className="bg-[#101015]/60 border border-white/5 rounded-2xl p-6 space-y-6">
                {/* Mic Switch */}
                <div className="flex items-center justify-between pb-6 border-b border-white/5">
                  <div className="space-y-1 pr-4">
                    <div className="text-sm font-semibold flex items-center gap-2 text-white">
                      <Mic size={15} className="text-zinc-400" />
                      Enable Microphone by Default
                    </div>
                    <p className="text-xs text-zinc-400">
                      Automatically turn on audio capture for your microphone when the recorder HUD
                      launches.
                    </p>
                  </div>
                  <Switch
                    aria-label="Enable microphone by default"
                    checked={defaultMic}
                    onCheckedChange={(checked) => {
                      if (saveGeneralSetting("foom-setting-default-mic", checked)) setDefaultMic(checked);
                    }}
                  />
                </div>

                {/* Webcam Switch */}
                <div className="flex items-center justify-between pb-6 border-b border-white/5">
                  <div className="space-y-1 pr-4">
                    <div className="text-sm font-semibold flex items-center gap-2 text-white">
                      <Video size={15} className="text-zinc-400" />
                      Enable Webcam by Default
                    </div>
                    <p className="text-xs text-zinc-400">
                      Automatically turn on camera preview overlay when launching the recording
                      toolbar.
                    </p>
                  </div>
                  <Switch
                    aria-label="Enable webcam by default"
                    checked={defaultWebcam}
                    onCheckedChange={(checked) => {
                      if (saveGeneralSetting("foom-setting-default-webcam", checked)) setDefaultWebcam(checked);
                    }}
                  />
                </div>

                {/* System Audio Switch */}
                <div className="flex items-center justify-between pb-6 border-b border-white/5">
                  <div className="space-y-1 pr-4">
                    <div className="text-sm font-semibold flex items-center gap-2 text-white">
                      <Volume2 size={15} className="text-zinc-400" />
                      Capture System Audio by Default
                    </div>
                    <p className="text-xs text-zinc-400">
                      Include system output/sound effects in screen recordings automatically.
                    </p>
                  </div>
                  <Switch
                    aria-label="Capture system audio by default"
                    checked={defaultSystemAudio}
                    onCheckedChange={(checked) => {
                      if (saveGeneralSetting("foom-setting-default-system-audio", checked)) setDefaultSystemAudio(checked);
                    }}
                  />
                </div>

                {/* Cursor Capture Mode Selector */}
                <div className="flex items-center justify-between pt-2">
                  <div className="space-y-1 pr-4">
                    <div className="text-sm font-semibold flex items-center gap-2 text-white">
                      <MousePointer size={15} className="text-zinc-400" />
                      Default Cursor Mode
                    </div>
                    <p className="text-xs text-zinc-400">
                      Choose between editable smart cursor overlay (supports size, smoothing, click
                      animation) or system cursor capture.
                    </p>
                  </div>
                  <Select
                    value={defaultCursorMode}
                    onValueChange={(val) => {
                      if (saveGeneralSetting("foom-setting-default-cursor-mode", val)) setDefaultCursorMode(val);
                    }}
                  >
                    <SelectTrigger aria-label="Default cursor mode" className="w-56 bg-zinc-900 border-zinc-800 text-zinc-100 text-xs">
                      <SelectValue placeholder="Select Cursor Mode" />
                    </SelectTrigger>
                    <SelectContent className="settings-select-content bg-zinc-900 border-zinc-800 text-zinc-100 text-xs">
                      <SelectItem value="editable-overlay">Editable Smart Overlay</SelectItem>
                      <SelectItem value="system">System (Standard Capture)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white mb-1">
                  Keyboard Shortcuts
                </h2>
                <p className="text-xs text-zinc-400">
                  Customize keyboard triggers for timeline actions and video playback.
                </p>
              </div>

              <div className="bg-[#101015]/60 border border-white/5 rounded-2xl p-6 space-y-6">
                {/* Configurable shortcuts list */}
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                    Configurable Actions
                  </h3>
                  <div className="space-y-1">
                    {SHORTCUT_ACTIONS.map((action) => {
                      const isCapturing = captureFor === action;
                      const hasConflict = conflict?.forAction === action;

                      return (
                        <div key={action} className="space-y-2">
                          <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                            <span className="text-sm text-zinc-300">{SHORTCUT_LABELS[action]}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setConflict(null);
                                setIsCapturingGlobalShortcut(false);
                                setCaptureFor(isCapturing ? null : action);
                              }}
                              className={[
                                "px-3 py-1.5 rounded-lg text-xs font-mono border transition-all min-w-[110px] text-center select-none cursor-pointer",
                                isCapturing
                                  ? "bg-white/15 border-white/50 text-white animate-pulse"
                                  : hasConflict
                                    ? "bg-amber-500/10 border-amber-500/50 text-amber-400"
                                    : "bg-white/5 border-white/10 text-zinc-200 hover:border-white/40 hover:text-white",
                              ].join(" ")}
                            >
                              {isCapturing
                                ? "Press keys..."
                                : formatBinding(draftShortcuts[action], isMac)}
                            </button>
                          </div>

                          {/* Conflict solver nested block */}
                          {hasConflict && conflict?.conflictWith.type === "configurable" && (
                            <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs">
                              <span className="text-amber-400 font-medium">
                                ⚠ Key conflict with action '
                                {SHORTCUT_LABELS[conflict.conflictWith.action]}'
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={handleSwap}
                                  className="h-7 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40"
                                >
                                  Swap Keys
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setConflict(null)}
                                  className="h-7 text-xs text-zinc-400 hover:text-white"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                      Global Recording Shortcut
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Toggle recording from any app with a registered Windows shortcut. The
                      shortcut only detects this exact combination; it does not record other
                      keystrokes.
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-300">Start / Stop Recording</span>
                    <button
                      type="button"
                      disabled={!supportsGlobalRecordingShortcut}
                      onClick={() => { setCaptureFor(null); setIsCapturingGlobalShortcut((capturing) => !capturing); }}
                      className={[
                        "px-3 py-1.5 rounded-lg text-xs font-mono border transition-all min-w-[110px] text-center select-none",
                        !supportsGlobalRecordingShortcut
                          ? "bg-white/5 border-white/5 text-zinc-600 cursor-not-allowed"
                          : isCapturingGlobalShortcut
                            ? "bg-white/15 border-white/50 text-white animate-pulse cursor-pointer"
                            : "bg-white/5 border-white/10 text-zinc-200 hover:border-white/40 hover:text-white cursor-pointer",
                      ].join(" ")}
                    >
                      {!supportsGlobalRecordingShortcut
                        ? "Windows only"
                        : isCapturingGlobalShortcut
                          ? "Press keys..."
                          : formatBinding(draftGlobalRecordingShortcut, isMac)}
                    </button>
                  </div>
                  {!supportsGlobalRecordingShortcut && (
                    <p className="text-xs text-amber-400">
                      Global recording shortcuts are not implemented on macOS/Linux yet.
                    </p>
                  )}
                </div>

                {/* Fixed shortcuts list */}
                <div className="pt-4 border-t border-white/5">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                    System Reserved Shortcuts
                  </h3>
                  <div className="space-y-1">
                    {FIXED_SHORTCUTS.map((fixed) => (
                      <div
                        key={fixed.i18nKey}
                        className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
                      >
                        <span className="text-sm text-zinc-400">{fixed.label}</span>
                        <kbd className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-zinc-500 min-w-[110px] text-center">
                          {fixed.display}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-zinc-400 hover:text-white flex items-center gap-2"
                    onClick={handleResetShortcuts}
                  >
                    <RotateCcw size={14} />
                    Reset to Defaults
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-2 px-4 py-2"
                    onClick={handleSaveShortcuts}
                  >
                    <Check size={14} />
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "about" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white mb-1">
                  Made for your next great demo.
                </h2>
                <p className="text-xs text-zinc-400">
                  Application build and local installation details.
                </p>
              </div>

              <div className="bg-[#101015]/60 border border-white/5 rounded-2xl p-8 space-y-6 text-center flex flex-col items-center">
                <img
                  src="/app-icon.png"
                  alt=""
                  aria-hidden="true"
                  className="w-16 h-16 rounded-2xl mb-2 shadow-lg"
                />

                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-white">foOom Studio</h3>
                  <p className="text-xs text-zinc-500">Version 0.2.0 · Desktop beta</p>
                </div>

                <div className="bg-white/[0.03] border border-white/5 rounded-xl px-6 py-4 max-w-sm w-full text-center">
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                    Edition
                  </div>
                  <div className="text-sm font-semibold text-white">Free Local Edition</div>
                  <p className="text-[11px] text-zinc-400 mt-2">
                    Record, edit, and export locally on this Windows device. No account is required
                    for the local build.
                  </p>
                </div>

                <p className="text-xs text-zinc-500 max-w-md">
                  Copyright 2026 Harsh Bhardwaj. Licensed under the MIT License. foOom automatically applies
                  smart zoom, focus, and cinematic overlays to screen recordings.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
