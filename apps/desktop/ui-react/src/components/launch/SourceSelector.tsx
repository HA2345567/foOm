import { useCallback, useEffect, useState } from "react";
import { Check, Monitor, AppWindow, Scan } from "lucide-react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import styles from "./SourceSelector.module.css";
import { RegionPicker } from "./RegionPicker";

interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string | null;
  display_id: string;
  appIcon: string | null;
  bounds?: { x: number; y: number; width: number; height: number };
}

export function SourceSelector() {
  const t = useScopedT("launch");
  const tc = useScopedT("common");
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editingRegion, setEditingRegion] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const rawSources = await window.electronAPI.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      setSources(
        rawSources.map((source) => ({
          id: source.id,
          name:
            source.id.startsWith("window:") && source.name.includes(" — ")
              ? source.name.split(" — ")[1] || source.name
              : source.name,
          thumbnail: source.thumbnail,
          display_id: source.display_id,
          appIcon: source.appIcon,
          bounds: source.bounds,
        })),
      );
      setSelectedSource((current) =>
        current && rawSources.some((source) => source.id === current.id) ? current : null,
      );
    } catch (error) {
      console.error("Error loading sources:", error);
      setSources([]);
      setSelectedSource(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
  const windowSources = sources.filter((s) => s.id.startsWith("window:"));
  const hasNoSources = !loading && sources.length === 0;
  const canChooseRegion = Boolean(selectedSource?.id.startsWith("screen:") && selectedSource.bounds &&
    Object.values(selectedSource.bounds).every(Number.isFinite) && selectedSource.bounds.width > 0 && selectedSource.bounds.height > 0);

  const handleSourceSelect = (source: DesktopSource) => setSelectedSource(source);
  const handleShare = async () => {
    if (selectedSource) await window.electronAPI.selectSource(selectedSource);
  };
  const handleCancel = async () => {
    localStorage.removeItem("foom-start-recording-after-select");
    if ("__TAURI_INTERNALS__" in window) {
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const picker = await WebviewWindow.getByLabel("source-selector");
        if (picker) {
          await picker.hide();
          return;
        }
      } catch {
        // Fall back to closing the document below.
      }
    }
    window.close();
  };

  if (loading) {
    return (
      <div
        className={`h-full flex items-center justify-center ${styles.glassContainer}`}
        style={{ minHeight: "100vh" }}
      >
        <div className="text-center">
          <div className="animate-spin duration-500 rounded-[50%] h-6 w-6 border-2 border-b-transparent border-white/70 mx-auto mb-2" />
          <p className="text-xs text-zinc-400">{t("sourceSelector.loading")}</p>
        </div>
      </div>
    );
  }

  if (hasNoSources) {
    return (
      <div
        className={`h-full flex items-center justify-center ${styles.glassContainer}`}
        style={{ minHeight: "100vh" }}
      >
        <div className="max-w-[320px] px-6 text-center">
          <h2 className="text-sm font-semibold text-white">{t("sourceSelector.emptyTitle")}</h2>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            {loadFailed
              ? t("sourceSelector.loadFailedDescription")
              : t("sourceSelector.emptyDescription")}
          </p>
          <Button
            onClick={() => void fetchSources()}
            className="mt-4 h-8 rounded-lg bg-white px-5 text-[11px] font-semibold text-zinc-900 transition-transform duration-150 hover:bg-white/85 active:scale-95"
          >
            {tc("actions.reload")}
          </Button>
        </div>
      </div>
    );
  }

  if (editingRegion && selectedSource?.bounds) {
    return <div className={`min-h-screen ${styles.glassContainer}`}><RegionPicker
      bounds={selectedSource.bounds} name={selectedSource.name}
      onCancel={() => setEditingRegion(false)}
      onConfirm={region => window.electronAPI.selectSource({
        ...selectedSource, id: "custom_area", type: "region", region,
        name: `${selectedSource.name} · ${region.width} × ${region.height} region`,
      })}
    /></div>;
  }

  const renderSourceCard = (source: DesktopSource) => {
    const isSelected = selectedSource?.id === source.id;
    const sourceKind = source.id.startsWith("screen:") ? "screen" : "window";
    return (
      <div
        key={source.id}
        data-testid="source-selector-card"
        data-source-kind={sourceKind}
        role="button"
        tabIndex={0}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleSourceSelect(source); } }}
        className={`${styles.sourceCard} ${isSelected ? styles.selected : ""} p-1.5`}
        onClick={() => handleSourceSelect(source)}
      >
        <div className="relative mb-1.5 overflow-hidden rounded-lg border border-white/[0.06] bg-black/30">
          {source.thumbnail ? (
            <img src={source.thumbnail} alt={`Preview of ${source.name}`} className="w-full aspect-video object-cover" />
          ) : (
            <div className="aspect-video flex flex-col items-center justify-center gap-2 bg-[#222222] text-[#cccccc]">
              {sourceKind === "screen" ? <Monitor size={34} strokeWidth={1.2} /> : <AppWindow size={34} strokeWidth={1.2} />}
              <span className="text-[10px] tracking-wide text-white/45">Preview unavailable</span>
            </div>
          )}
          {isSelected && (
            <div className="absolute right-1.5 top-1.5">
              <div className={styles.checkBadge}>
                <Check size={11} className="text-zinc-900" />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-1 pb-0.5">
          {source.appIcon && (
            <img src={source.appIcon} alt="" className={`${styles.icon} flex-shrink-0`} />
          )}
          <div className={`${styles.name} truncate`}>{source.name}</div>
        </div>
      </div>
    );
  };

  return (
    <div className={`min-h-screen flex flex-col ${styles.glassContainer}`}>
      <header className="px-4 pt-4 pb-1 flex items-center gap-3"><span className="grid place-items-center rounded-lg w-9 h-9 bg-[#eeeeee]/10 text-[#eeeeee]"><Scan size={20}/></span><div><h1 className="text-sm font-semibold tracking-normal">Choose what to capture</h1><p className="text-[11px] text-[#a3a3a3] mt-1">Your screen. Your boundaries.</p></div></header>
      <div className="flex-1 flex flex-col w-full px-3.5 pt-3.5">
        <Tabs
          defaultValue={screenSources.length === 0 ? "windows" : "screens"}
          className="flex-1 flex flex-col"
        >
          <TabsList className="mb-3 grid h-8 grid-cols-2 rounded-xl border border-white/[0.06] bg-white/[0.04] p-0.5">
            <TabsTrigger
              value="screens"
              className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
            >
              {t("sourceSelector.screens", { count: String(screenSources.length) })}
            </TabsTrigger>
            <TabsTrigger
              value="windows"
              className="rounded-lg py-1 text-[11px] text-zinc-400 transition-all data-[state=active]:bg-white/[0.12] data-[state=active]:text-white"
            >
              {t("sourceSelector.windows", { count: String(windowSources.length) })}
            </TabsTrigger>
          </TabsList>
          <div className="flex-1 min-h-0">
            <TabsContent value="screens" className="h-full mt-0">
              <div
                className={`grid h-[282px] auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto pr-1.5 pt-1 ${styles.sourceGridScroll}`}
              >
                {screenSources.map(renderSourceCard)}
              </div>
            </TabsContent>
            <TabsContent value="windows" className="h-full mt-0">
              <div
                className={`grid h-[282px] auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto pr-1.5 pt-1 ${styles.sourceGridScroll}`}
              >
                {windowSources.map(renderSourceCard)}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
      <div className="flex justify-center gap-2 border-t border-white/[0.06] p-3">
        <Button variant="ghost" disabled={!canChooseRegion}
          onClick={() => setEditingRegion(true)} className="h-8 text-[11px]">Choose region</Button>
        <Button
          data-testid="source-selector-cancel-button"
          variant="ghost"
          onClick={() => { void handleCancel(); }}
          className="h-8 rounded-lg px-5 text-[11px] text-zinc-400 transition-transform duration-150 hover:bg-white/5 hover:text-white active:scale-95"
        >
          {tc("actions.cancel")}
        </Button>
        <Button
          data-testid="source-selector-share-button"
          onClick={handleShare}
          disabled={!selectedSource}
          className="h-8 rounded-lg bg-white px-5 text-[11px] font-semibold text-zinc-900 transition-transform duration-150 hover:bg-white/85 active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:opacity-50"
        >
          {tc("actions.share")}
        </Button>
      </div>
    </div>
  );
}
