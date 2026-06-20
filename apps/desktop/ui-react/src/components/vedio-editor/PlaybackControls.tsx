import { Maximize, Minimize, Pause, Play } from "lucide-react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onTogglePlayPause: () => void;
  onSeek: (time: number) => void;
}

export default function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  isFullscreen = false,
  onToggleFullscreen,
  onTogglePlayPause,
  onSeek,
}: PlaybackControlsProps) {
  const t = useScopedT("common");

  function formatTime(seconds: number) {
    if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
    onSeek(parseFloat(e.target.value));
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2 px-1 py-0.5 rounded-full bg-black/55 backdrop-blur-md border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition-all duration-300 hover:bg-black/68 hover:border-white/16">
      <Button
        onClick={onTogglePlayPause}
        size="icon"
        className={cn(
          "w-8 h-8 rounded-full transition-all duration-200 border",
          isPlaying
            ? "border-white/12 bg-white/[0.09] text-white/88 hover:bg-white/[0.14]"
            : "border-white/12 bg-[#d7d7dc] text-[#0b0b0d] hover:bg-[#eeeeef] shadow-[0_4px_14px_rgba(255,255,255,0.14)]",
        )}
        aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
      >
        {isPlaying ? (
          <Pause className="w-3.5 h-3.5 fill-current" />
        ) : (
          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
        )}
      </Button>

      <span className="text-[9px] font-medium text-slate-300 tabular-nums w-[30px] text-right">
        {formatTime(currentTime)}
      </span>

      <div className="flex-1 relative h-6 flex items-center group">
        {/* Custom Track Background */}
        <div className="absolute left-0 right-0 h-0.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-white/55 rounded-full" style={{ width: `${progress}%` }} />
        </div>

        {/* Interactive Input */}
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSeekChange}
          step="0.01"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />

        {/* Custom Thumb (visual only, follows progress) */}
        <div
          className="absolute w-2.5 h-2.5 bg-[#d7d7dc] rounded-full shadow-[0_2px_8px_rgba(255,255,255,0.16)] pointer-events-none group-hover:scale-110 transition-transform duration-100"
          style={{
            left: `${progress}%`,
            transform: "translateX(-50%)",
          }}
        />
      </div>

      <span className="text-[9px] font-medium text-slate-500 tabular-nums w-[30px]">
        {formatTime(duration)}
      </span>

      {onToggleFullscreen && (
        <Button
          onClick={onToggleFullscreen}
          variant="ghost"
          size="icon"
          className="w-7 h-7 rounded-full transition-all duration-200 border border-transparent hover:bg-white/10 text-white hover:border-white/10 shrink-0 shadow-none ml-0.5"
          aria-label={isFullscreen ? t("playback.exitFullscreen") : t("playback.fullscreen")}
        >
          {isFullscreen ? (
            <Minimize className="w-3.5 h-3.5" />
          ) : (
            <Maximize className="w-3.5 h-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}
