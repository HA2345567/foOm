import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { followSoundtrack, loadSoundtrack, type Soundtrack } from "@/lib/soundtrack";

export function SoundtrackPreview({ video, track }: { video: HTMLVideoElement | null; track?: Soundtrack | null }) {
  const mediaRef = useRef<HTMLAudioElement | null>(null);
  const volume = useRef(track?.volume ?? 0.5);
  volume.current = track?.volume ?? 0.5;
  useEffect(() => { if (mediaRef.current) mediaRef.current.volume = volume.current; }, [track?.volume]);
  const path = track?.path;
  useEffect(() => {
    if (!video || !path) return;
    const media = new Audio();
    mediaRef.current = media;
    let disposed = false;
    let url: string | undefined;
    let stop: (() => void) | undefined;
    const report = () => { if (!disposed) toast.error("Unable to preview imported audio. Check that the file is available and playable.", { id: "soundtrack-error" }); };
    media.addEventListener("error", report);
    void loadSoundtrack({ path, name: "", volume: 1 }).then(src => {
      if (disposed) { URL.revokeObjectURL(src); return; }
      url = src;
      media.volume = volume.current;
      media.src = url;
      stop = followSoundtrack(video, media, report);
    }).catch(report);
    return () => {
      disposed = true;
      stop?.();
      media.removeEventListener("error", report);
      media.removeAttribute("src");
      media.load();
      if (url) URL.revokeObjectURL(url);
      mediaRef.current = null;
    };
  }, [video, path]);
  return null;
}
