import { afterEach, expect, it, vi } from "vitest";
import { VideoExporter } from "./videoExporter";

const failures = vi.hoisted(() => ({ finalize: vi.fn(), cancel: vi.fn() }));
vi.mock("@/utils/platformUtils", () => ({ getPlatform: async () => "win32" }));
vi.mock("./frameRenderer", () => ({ FrameRenderer: class {
  async initialize() {}
  async renderFrame() {}
  getCanvas() { return {}; }
  destroy() {}
} }));
vi.mock("./streamingDecoder", () => ({ StreamingVideoDecoder: class {
  async loadMetadata() { return { width: 1280, height: 720, duration: 1, frameRate: 30, hasAudio: false }; }
  getDemuxer() { return null; }
  getExportMetrics() { return { totalFrames: 1 }; }
  async decodeAll(_fps: number, _trims: unknown, _speeds: unknown, onFrame: (frame: unknown, time: number, sourceTime: number) => Promise<void>) {
    await onFrame({ close() {} }, 0, 0);
  }
  cancel = failures.cancel;
  destroy() {}
} }));
vi.mock("./muxer", () => ({ VideoMuxer: class {
  async initialize() {}
  async addVideoChunk() {
    await Promise.resolve();
    await Promise.resolve();
    throw new Error("simulated packet mux failure");
  }
  finalize = failures.finalize;
} }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("fails export instead of reporting success when the final packet cannot be muxed", async () => {
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("VideoFrame", class { close() {} });
  vi.stubGlobal("VideoEncoder", class {
    static async isConfigSupported() { return { supported: true }; }
    state = "unconfigured";
    encodeQueueSize = 0;
    constructor(private callbacks: { output: (chunk: unknown, metadata: unknown) => void }) {}
    configure() { this.state = "configured"; }
    encode() {}
    async flush() { this.callbacks.output({}, undefined); }
    close() { this.state = "closed"; }
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const exporter = new VideoExporter({
    videoUrl: "test.mp4", width: 640, height: 360, frameRate: 30, bitrate: 1_000_000,
    wallpaper: "#101010", zoomRegions: [], trimRegions: [], speedRegions: [],
    cropRegion: { x: 0, y: 0, width: 1, height: 1 },
    showShadow: false, shadowIntensity: 0, showBlur: false,
  });
  const result = await exporter.export();
  expect(result.success).toBe(false);
  expect(result.error).toContain("simulated packet mux failure");
  expect(failures.finalize).not.toHaveBeenCalled();
  expect(failures.cancel).toHaveBeenCalled();
});
