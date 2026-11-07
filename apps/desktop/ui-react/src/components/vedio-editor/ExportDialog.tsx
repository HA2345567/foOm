import { Download, Film, Image, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import type { ExportFormat, ExportProgress, ExportQuality } from "@/lib/exporter";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  progress: ExportProgress | null;
  isExporting: boolean;
  isPreparingExport?: boolean;
  error: string | null;
  onCancel?: () => void;
  exportFormat?: ExportFormat;
  onExportFormatChange?: (format: ExportFormat) => void;
  exportQuality?: ExportQuality;
  onExportQualityChange?: (quality: ExportQuality) => void;
  onStartExport?: () => void;
  exportedFilePath?: string;
  onShowInFolder?: () => void;
}

const EXPORT_QUALITY_OPTIONS: Array<{
  value: ExportQuality;
  label: string;
  summary: string;
}> = [
  { value: "medium", label: "720p", summary: "720p short side • 60 FPS" },
  { value: "good", label: "Medium", summary: "Full HD 1080p • 60 FPS • High Quality" },
  { value: "source", label: "Source", summary: "Source-based dimensions • 60 FPS" },
];

export function ExportDialog({
  isOpen,
  onClose,
  progress,
  isExporting,
  isPreparingExport = false,
  error,
  onCancel,
  exportFormat = "mp4",
  onExportFormatChange,
  exportQuality = "good",
  onExportQualityChange,
  onStartExport,
  exportedFilePath,
  onShowInFolder,
}: ExportDialogProps) {
  const t = useScopedT("dialogs");
  const [showSuccess, setShowSuccess] = useState(false);

  // Reset showSuccess when a new export starts or dialog reopens
  useEffect(() => {
    if (isExporting) {
      setShowSuccess(false);
    }
  }, [isExporting]);

  // Reset showSuccess when dialog opens fresh
  useEffect(() => {
    if (isOpen && !isExporting && !progress) {
      setShowSuccess(false);
    }
  }, [isOpen, isExporting, progress]);

  useEffect(() => {
    setShowSuccess(Boolean(exportedFilePath) && !isExporting && !isPreparingExport && !error);
  }, [exportedFilePath, isExporting, isPreparingExport, error]);

  if (!isOpen) return null;

  const formatLabel = exportFormat === "gif" ? "GIF" : "Video";
  const selectedQualitySummary =
    EXPORT_QUALITY_OPTIONS.find((option) => option.value === exportQuality)?.summary ??
    EXPORT_QUALITY_OPTIONS[2].summary;

  // Determine if we're in the compiling phase (frames done but still exporting)
  const isCompiling =
    isExporting && progress && progress.percentage >= 100 && exportFormat === "gif";
  const isFinalizing = progress?.phase === "finalizing";
  const renderProgress = progress?.renderProgress;

  // Get status message based on phase
  const getStatusMessage = () => {
    if (error) return t("export.tryAgain");
    if (isPreparingExport) return "Choose where to save your video.";
    if (isCompiling || isFinalizing) {
      if (exportFormat === "mp4") {
        return t("export.finalizingVideo");
      }
      if (renderProgress !== undefined && renderProgress > 0) {
        return t("export.compilingGifProgress", { progress: String(renderProgress) });
      }
      return t("export.compilingGifWait");
    }
    return t("export.takeMoment");
  };

  // Get title based on phase
  const getTitle = () => {
    if (error) return t("export.failed");
    if (isPreparingExport) return "Choose save location";
    if (isFinalizing && exportFormat === "mp4") return t("export.finalizingVideoTitle");
    if (isCompiling || isFinalizing) return t("export.compilingGif");
    return t("export.exportingFormat", { format: formatLabel });
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 animate-in fade-in duration-200"
        onClick={isExporting || isPreparingExport ? undefined : onClose}
      />
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#09090b] rounded-lg shadow-2xl border border-white/10 p-4 w-[min(340px,calc(100vw-24px))] animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            {!isExporting && !isPreparingExport && !progress && !error && !showSuccess ? (
              <div>
                <span className="text-sm font-semibold text-white block">Export</span>
                <span className="text-xs text-slate-400">
                  Choose format and quality before rendering.
                </span>
              </div>
            ) : showSuccess ? (
              <>
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center ring-1 ring-white/50">
                  <Download className="w-6 h-6 text-white/80" />
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xl font-bold text-slate-200 block">
                    {t("export.complete")}
                  </span>
                  <span className="text-sm text-slate-400">
                    {t("export.yourFormatReady", { format: formatLabel.toLowerCase() })}
                  </span>
                  {exportedFilePath && (
                    <Button
                      variant="secondary"
                      onClick={onShowInFolder}
                      className="mt-2 w-fit px-3 py-1 text-sm rounded-md bg-white/10 hover:bg-white/20 text-slate-200"
                    >
                      {t("export.showInFolder")}
                    </Button>
                  )}
                  {exportedFilePath && (
                    <span className="text-xs text-slate-500 break-all max-w-xs mt-1">
                      {exportedFilePath.split("/").pop()}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                {isExporting || isPreparingExport ? (
                  <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-white/80 animate-spin" />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                    <Download className="w-6 h-6 text-slate-200" />
                  </div>
                )}
                <div>
                  <span className="text-xl font-bold text-slate-200 block">{getTitle()}</span>
                  <span className="text-sm text-slate-400">{getStatusMessage()}</span>
                </div>
              </>
            )}
          </div>
          {!isExporting && !isPreparingExport && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="hover:bg-white/10 text-slate-400 hover:text-white rounded-full"
            >
              <X className="w-5 h-5" />
            </Button>
          )}
        </div>

        {!isExporting && !isPreparingExport && !progress && !error && !showSuccess && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 rounded-md bg-[#2A2727] p-1">
              <button
                type="button"
                onClick={() => onExportFormatChange?.("mp4")}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded text-sm font-semibold transition-colors",
                  exportFormat === "mp4"
                    ? "bg-black text-white"
                    : "text-slate-400 hover:text-slate-100",
                )}
              >
                <Film className="h-4 w-4" />
                MP4
              </button>
              <button
                type="button"
                onClick={() => onExportFormatChange?.("gif")}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded text-sm font-semibold transition-colors",
                  exportFormat === "gif"
                    ? "bg-black text-white"
                    : "text-slate-400 hover:text-slate-100",
                )}
              >
                <Image className="h-4 w-4" />
                GIF
              </button>
            </div>

            {exportFormat === "mp4" && (
              <>
                <div className="grid grid-cols-3 rounded-md bg-[#2A2727] p-1">
                  {EXPORT_QUALITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onExportQualityChange?.(option.value)}
                      className={cn(
                        "h-9 rounded text-xs font-semibold transition-colors",
                        exportQuality === option.value
                          ? "bg-black text-white"
                          : "text-slate-400 hover:text-slate-100",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-center text-[11px] text-slate-300">{selectedQualitySummary}</p>
              </>
            )}

            {exportFormat === "gif" && (
              <p className="text-center text-[11px] text-slate-300">
                Animated GIF • uses current GIF settings
              </p>
            )}

            <Button
              type="button"
              onClick={onStartExport}
              className="h-9 w-full rounded-md bg-white text-sm font-semibold text-[#18181B] hover:bg-zinc-200"
            >
              <Download className="mr-2 h-4 w-4" />
              {exportFormat === "gif" ? "Export GIF" : "Export Video"}
            </Button>
          </div>
        )}

        {error && (
          <div className="mb-6 animate-in slide-in-from-top-2">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
              <div className="p-1 bg-red-500/20 rounded-full">
                <X className="w-3 h-3 text-red-400" />
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-red-400 leading-relaxed">
                {error}
              </p>
            </div>
            <Button type="button" onClick={onStartExport} className="mt-3 w-full">
              Try export again
            </Button>
          </div>
        )}

        {isExporting && progress && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-slate-400 uppercase tracking-wider">
                <span>
                  {isCompiling || isFinalizing
                    ? t("export.compiling")
                    : t("export.renderingFrames")}
                </span>
                <span className="font-mono text-slate-200">
                  {isCompiling || isFinalizing ? (
                    renderProgress !== undefined && renderProgress > 0 ? (
                      `${renderProgress}%`
                    ) : (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t("export.processing")}
                      </span>
                    )
                  ) : (
                    `${progress.percentage.toFixed(0)}%`
                  )}
                </span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                {isCompiling || isFinalizing ? (
                  // Show render progress if available, otherwise animated indeterminate bar
                  renderProgress !== undefined && renderProgress > 0 ? (
                    <div
                      className="h-full bg-white/80 shadow-[0_0_10px_rgba(255,255,255,0.25)] transition-all duration-300 ease-out"
                      style={{ width: `${renderProgress}%` }}
                    />
                  ) : (
                    <div className="h-full w-full relative overflow-hidden">
                      <div
                        className="absolute h-full w-1/3 bg-white/80 shadow-[0_0_10px_rgba(255,255,255,0.25)]"
                        style={{
                          animation: "indeterminate 1.5s ease-in-out infinite",
                        }}
                      />
                      <style>{`
                        @keyframes indeterminate {
                          0% { transform: translateX(-100%); }
                          100% { transform: translateX(400%); }
                        }
                      `}</style>
                    </div>
                  )
                ) : (
                  <div
                    className="h-full bg-white/80 shadow-[0_0_10px_rgba(255,255,255,0.25)] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(progress.percentage, 100)}%` }}
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  {isCompiling || isFinalizing ? t("export.status") : t("export.format")}
                </div>
                <div className="text-slate-200 font-medium text-sm">
                  {isFinalizing && exportFormat === "mp4"
                    ? t("export.finalizing")
                    : isCompiling || isFinalizing
                      ? t("export.compilingStatus")
                      : formatLabel}
                </div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  {t("export.frames")}
                </div>
                <div className="text-slate-200 font-medium text-sm">
                  {progress.currentFrame} / {progress.totalFrames}
                </div>
              </div>
            </div>

            {onCancel && (
              <div className="pt-2">
                <Button
                  onClick={onCancel}
                  variant="destructive"
                  className="w-full py-6 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all rounded-xl"
                >
                  {t("export.cancelExport")}
                </Button>
              </div>
            )}
          </div>
        )}

        {showSuccess && (
          <div className="text-center py-4 animate-in zoom-in-95">
            <p className="text-lg text-slate-200 font-medium">
              {t("export.savedSuccessfully", { format: formatLabel })}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
