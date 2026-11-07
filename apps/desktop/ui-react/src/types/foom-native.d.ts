type ProcessedDesktopSource = {
  id: string;
  name: string;
  thumbnail?: string | null;
  display_id?: string;
  appIcon?: string | null;
  type?: "display" | "window" | "region";
  bounds?: { x: number; y: number; width: number; height: number };
  region?: { x: number; y: number; width: number; height: number };
};

interface Window {
  __FOOM_LAST_RESULT?: import("../hooks/useScreenRecording").RecordingResult;
  webkitAudioContext?: typeof AudioContext;
  /**
   * Tauri-backed native bridge installed by tauriCompat.ts.
   * The bridge is a dynamic object assembled at runtime, so the actual
   * call signatures are validated by tauriCompat.ts — not here.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  foomNative: any;
  /** Legacy bridge alias. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  electronAPI?: any;
}

declare module "gif.js" {
  class GIF {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(options?: Record<string, any>);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, callback: (...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addFrame(...args: any[]): void;
    render(): void;
    abort?(): void;
  }
  export default GIF;
}
