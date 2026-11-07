import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_GLOBAL_RECORDING_SHORTCUT,
  DEFAULT_SHORTCUTS,
  mergeWithDefaults,
  type ShortcutBinding,
  type ShortcutsConfig,
} from "@/lib/shortcuts";
import { isMac as getIsMac } from "@/utils/platformUtils";

interface ShortcutsContextValue {
  shortcuts: ShortcutsConfig;
  globalRecordingShortcut: ShortcutBinding;
  isMac: boolean;
  setShortcuts: (config: ShortcutsConfig) => void;
  setGlobalRecordingShortcut: (binding: ShortcutBinding) => void;
  persistShortcuts: (config?: ShortcutsConfig) => Promise<void>;
  persistGlobalRecordingShortcut: (binding?: ShortcutBinding) => Promise<void>;
  isConfigOpen: boolean;
  openConfig: () => void;
  closeConfig: () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);
const SHORTCUTS_STORAGE_KEY = "foom-shortcuts";
const GLOBAL_RECORDING_SHORTCUT_STORAGE_KEY = "foom-global-recording-shortcut";

export function useShortcuts(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useShortcuts must be used within <ShortcutsProvider>");
  return ctx;
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<ShortcutsConfig>(DEFAULT_SHORTCUTS);
  const [globalRecordingShortcut, setGlobalRecordingShortcut] = useState<ShortcutBinding>(
    DEFAULT_GLOBAL_RECORDING_SHORTCUT,
  );
  const [isMac, setIsMac] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  useEffect(() => {
    getIsMac()
      .then(setIsMac)
      .catch(() => {
        // Keep default non-mac fallback if detection fails.
      });

    try {
      const saved = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
      if (saved) {
        setShortcuts(mergeWithDefaults(JSON.parse(saved) as Partial<ShortcutsConfig>));
      }
      const savedGlobalShortcut = localStorage.getItem(GLOBAL_RECORDING_SHORTCUT_STORAGE_KEY);
      if (savedGlobalShortcut) {
        const parsed = JSON.parse(savedGlobalShortcut) as Partial<ShortcutBinding>;
        if (typeof parsed.key === "string" && parsed.key.length > 0) {
          setGlobalRecordingShortcut({
            key: parsed.key,
            ctrl: !!parsed.ctrl,
            shift: !!parsed.shift,
            alt: !!parsed.alt,
          });
        }
      }
    } catch {
      // Keep default shortcuts if persisted settings can't be loaded.
    }
  }, []);

  const persistShortcuts = useCallback(
    async (config?: ShortcutsConfig) => {
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(config ?? shortcuts));
    },
    [shortcuts],
  );

  const persistGlobalRecordingShortcut = useCallback(
    async (binding: ShortcutBinding = globalRecordingShortcut) => {
      const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
      if (isTauri) {
        const platform = await window.foomNative?.getPlatform();
        if (platform !== "win32") {
          throw new Error("Global recording shortcuts are currently supported on Windows only.");
        }
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_global_recording_shortcut", { shortcut: binding });
      }

      localStorage.setItem(GLOBAL_RECORDING_SHORTCUT_STORAGE_KEY, JSON.stringify(binding));
      setGlobalRecordingShortcut(binding);
    },
    [globalRecordingShortcut],
  );

  const openConfig = useCallback(() => setIsConfigOpen(true), []);
  const closeConfig = useCallback(() => setIsConfigOpen(false), []);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      shortcuts,
      globalRecordingShortcut,
      isMac,
      setShortcuts,
      setGlobalRecordingShortcut,
      persistShortcuts,
      persistGlobalRecordingShortcut,
      isConfigOpen,
      openConfig,
      closeConfig,
    }),
    [
      shortcuts,
      globalRecordingShortcut,
      isMac,
      persistShortcuts,
      persistGlobalRecordingShortcut,
      isConfigOpen,
      openConfig,
      closeConfig,
    ],
  );

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}
