import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_SHORTCUTS, mergeWithDefaults, type ShortcutsConfig } from "@/lib/shortcuts";
import { isMac as getIsMac } from "@/utils/platformUtils";

interface ShortcutsContextValue {
  shortcuts: ShortcutsConfig;
  isMac: boolean;
  setShortcuts: (config: ShortcutsConfig) => void;
  persistShortcuts: (config?: ShortcutsConfig) => Promise<void>;
  isConfigOpen: boolean;
  openConfig: () => void;
  closeConfig: () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);
const SHORTCUTS_STORAGE_KEY = "foom-shortcuts";

export function useShortcuts(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useShortcuts must be used within <ShortcutsProvider>");
  return ctx;
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<ShortcutsConfig>(DEFAULT_SHORTCUTS);
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

  const openConfig = useCallback(() => setIsConfigOpen(true), []);
  const closeConfig = useCallback(() => setIsConfigOpen(false), []);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      shortcuts,
      isMac,
      setShortcuts,
      persistShortcuts,
      isConfigOpen,
      openConfig,
      closeConfig,
    }),
    [shortcuts, isMac, persistShortcuts, isConfigOpen, openConfig, closeConfig],
  );

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}
