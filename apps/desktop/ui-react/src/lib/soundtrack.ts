export interface Soundtrack {
  path: string;
  name: string;
  volume: number;
}

export function normalizeSoundtrack(input: unknown): Soundtrack | null {
  if (!input || typeof input !== "object") return null;
  const track = input as Partial<Soundtrack>;
  if (typeof track.path !== "string" || !/^(?:[A-Za-z]:[\\/]|\/(?!\/)|indexeddb:\/\/)/.test(track.path)) return null;
  return {
    path: track.path,
    name: typeof track.name === "string" && track.name ? track.name : track.path.split(/[\\/]/).pop() || "Audio",
    volume: typeof track.volume === "number" && Number.isFinite(track.volume) ? Math.max(0, Math.min(1, track.volume)) : 0.5,
  };
}

/** Follow the source timeline so a seek, trim or speed change also affects imported audio. */
export function followSoundtrack(clock: HTMLMediaElement, track: HTMLAudioElement, onError: (error: Error) => void) {
  let disposed = false;
  const sync = () => {
    if (track.readyState < 1) return;
    const position = Math.min(clock.currentTime, track.duration);
    if (Number.isFinite(position) && Math.abs(track.currentTime - position) > 0.12) track.currentTime = position;
    track.playbackRate = clock.playbackRate;
    track.muted = clock.muted;
    if (clock.paused || clock.ended || clock.seeking || position >= track.duration) {
      track.pause();
    } else if (track.paused) {
      void track.play().catch(error => { if (!disposed && error.name !== "AbortError") onError(error); });
    }
  };
  const events = ["playing", "pause", "ended", "seeking", "seeked", "timeupdate", "ratechange", "volumechange"];
  events.forEach(event => clock.addEventListener(event, sync));
  track.addEventListener("loadedmetadata", sync);
  sync();
  return () => {
    disposed = true;
    events.forEach(event => clock.removeEventListener(event, sync));
    track.removeEventListener("loadedmetadata", sync);
    track.pause();
  };
}

/** A local blob URL keeps Web Audio readable across WebView asset origins. Caller revokes it. */
export async function loadSoundtrack(track: Soundtrack): Promise<string> {
  const result = await window.electronAPI.readBinaryFile(track.path);
  if (!result.success || !result.data) throw new Error("Could not read the imported audio. Locate the file and import it again.");
  return URL.createObjectURL(new Blob([result.data]));
}
