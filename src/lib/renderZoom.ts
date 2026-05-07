import type { RecordingResult } from "../hooks/useScreenRecording";
import { generateZoomKeyframes, interpolateZoom } from "./autoZoom";
import { drawComposite } from "./composite";
import {
  BACKGROUNDS,
  _imgCache,
  type Background,
  type FrameStyle,
  type Subtitle,
} from "./backgrounds";
import * as Muxer from "webm-muxer";

export interface RenderProgress {
  stage: "preparing" | "rendering" | "encoding" | "done";
  percent: number;
}

export interface RenderOutput {
  blob: Blob;
  url: string;
  format: "webm";
}

const QUALITY_PRESETS: Record<
  360 | 480 | 720 | 1080,
  { targetH: number; videoBps: number }
> = {
  360: { targetH: 360, videoBps: 1_200_000 },
  480: { targetH: 480, videoBps: 2_500_000 },
  720: { targetH: 720, videoBps: 5_000_000 },
  1080: { targetH: 1080, videoBps: 10_000_000 },
};

/** Target output frame rate */
const OUTPUT_FPS = 30;
/** Keyframe interval in seconds */
const KEYFRAME_INTERVAL_S = 2;

export async function renderAutoZoom(
  recording: RecordingResult,
  opts: {
    format?: "mp4" | "webm";
    quality?: 360 | 480 | 720 | 1080;
    background: Background;
    frame: FrameStyle;
    subtitles?: Subtitle[];
    clicksOverride?: RecordingResult["clicks"];
    cameraX?: number;
    cameraY?: number;
    cameraSize?: number;
    cameraShape?: "circle" | "square" | "rounded";
    onProgress?: (p: RenderProgress) => void;
  },
): Promise<RenderOutput> {
  const onProgress = opts.onProgress ?? (() => {});
  onProgress({ stage: "preparing", percent: 0 });

  const qualityKey = (opts.quality ?? 720) as 360 | 480 | 720 | 1080;
  const preset = QUALITY_PRESETS[qualityKey];

  // Pre-load background image if needed
  if (opts.background.url) {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = opts.background.url!;
      if (img.complete && img.naturalWidth > 0) return resolve();
      const timer = setTimeout(resolve, 5000);
      img.onload = () => {
        _imgCache[opts.background.url!] = img;
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => { clearTimeout(timer); resolve(); };
    });
  }

  const clicks = opts.clicksOverride ?? recording.clicks;
  const keyframes = generateZoomKeyframes(clicks, recording.duration, {
    scrolls: recording.scrolls,
    pauses: recording.pauses,
  });

  // ── Load video ────────────────────────────────────────────────────────────
  const video = document.createElement("video");
  video.src = recording.url;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  // Playback speed 1x — requestVideoFrameCallback captures every decoded frame
  video.playbackRate = 1.0;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Video failed to load"));
    video.load();
  });

  // Ensure enough data is buffered before we start
  await new Promise<void>((resolve) => {
    if (video.readyState >= 4) return resolve();
    const onReady = () => { video.removeEventListener("canplaythrough", onReady); resolve(); };
    video.addEventListener("canplaythrough", onReady);
    setTimeout(resolve, 3000); // fallback for blob URLs
  });

  // ── Load Camera if exists ─────────────────────────────────────────────────
  let camVideo: HTMLVideoElement | null = null;
  if (recording.cameraUrl) {
    camVideo = document.createElement("video");
    camVideo.src = recording.cameraUrl;
    camVideo.muted = true;
    camVideo.playsInline = true;
    camVideo.crossOrigin = "anonymous";
    camVideo.preload = "auto";
    await new Promise<void>((resolve) => {
      camVideo!.onloadedmetadata = () => resolve();
      camVideo!.onerror = () => resolve(); // continue without cam if fails
      camVideo!.load();
    });
  }

  const srcW = video.videoWidth || recording.width || 1280;
  const srcH = video.videoHeight || recording.height || 720;
  const srcAspect = srcW / srcH;

  const outH = Math.min(preset.targetH, srcH * 2);
  const outW = Math.round(outH * srcAspect) & ~1; // must be even

  // ── OffscreenCanvas ───────────────────────────────────────────────────────
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d", { alpha: false }) as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // ── Muxer (WebM with Audio) ────────────────────────────────────────────────
  const muxerTarget = new Muxer.ArrayBufferTarget();
  
  const hasAudio = recording.blob.type.includes('audio') || (recording.mimeType && recording.mimeType.includes('opus'));

  const muxer = new Muxer.Muxer({
    target: muxerTarget,
    video: {
      codec: "V_VP9",
      width: outW,
      height: outH,
    },
    audio: hasAudio ? {
      codec: 'A_OPUS',
      numberOfChannels: 2,
      sampleRate: 48000
    } : undefined,
    firstTimestampBehavior: "offset",
  });

  // ── VideoEncoder ──────────────────────────────────────────────────────────
  let videoError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { videoError = e; console.error("VideoEncoder error:", e); },
  });
  videoEncoder.configure({
    codec: "vp09.00.10.08",
    width: outW,
    height: outH,
    bitrate: preset.videoBps,
    framerate: OUTPUT_FPS,
  });

  // ── AudioEncoder ──────────────────────────────────────────────────────────
  let audioEncoder: AudioEncoder | null = null;
  if (hasAudio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => console.error("AudioEncoder error:", e),
    });
    audioEncoder.configure({
      codec: 'opus',
      numberOfChannels: 2,
      sampleRate: 48000,
      bitrate: 128000,
    });
  }

  // ── Audio Capture Setup ───────────────────────────────────────────────────
  let audioReader: ReadableStreamDefaultReader<AudioData> | null = null;
  if (hasAudio) {
    try {
      const stream = (video as any).captureStream ? (video as any).captureStream() : (video as any).mozCaptureStream();
      const track = stream.getAudioTracks()[0];
      if (track) {
        const processor = new (window as any).MediaStreamTrackProcessor({ track });
        audioReader = processor.readable.getReader();
      }
    } catch (e) {
      console.warn("Audio capture setup failed", e);
    }
  }

  // ── Real-time capture via requestVideoFrameCallback ───────────────────────
  // This is far faster than seek-per-frame: the browser decodes frames
  // sequentially as the video plays, and we capture each one as it arrives.
  // Total render time ≈ video duration (1× speed), not 10–20× slower.
  let frameIndex = 0;
  let lastReportedPct = -1;

  onProgress({ stage: "rendering", percent: 0 });
  
  // Audio loop
  let audioDone = false;
  const audioLoop = async () => {
    if (!audioReader || !audioEncoder) {
      audioDone = true;
      return;
    }
    try {
      while (true) {
        const { value, done } = await audioReader.read();
        if (done) break;
        if (audioEncoder.state === 'configured') {
          audioEncoder.encode(value);
        }
        value.close();
      }
    } catch (e) {
      console.warn("Audio loop error", e);
    }
    audioDone = true;
  };

  const audioPromise = audioLoop();

  await new Promise<void>((resolve, reject) => {
    const onFrame = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
      if (videoError) { reject(videoError); return; }

      const t = metadata.mediaTime;
      const timestampUs = Math.round(t * 1_000_000);
      const frameDurationUs = Math.round((1 / OUTPUT_FPS) * 1_000_000);

      // Draw composite (background + zoomed video + subtitles)
      const kf = interpolateZoom(keyframes, t);
      // Sync camera if active
      if (camVideo) camVideo.currentTime = t;

      drawComposite(ctx as unknown as CanvasRenderingContext2D, video, kf, {
        background: opts.background,
        frame: opts.frame,
        subtitles: opts.subtitles,
        currentTime: t,
        srcW,
        srcH,
        outW,
        outH,
        camera: camVideo || undefined,
        cameraX: opts.cameraX,
        cameraY: opts.cameraY,
        cameraSize: opts.cameraSize,
        cameraShape: opts.cameraShape,
      });

      // Encode this frame
      const outFrame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
        alpha: "discard",
      });

      const isKey = frameIndex === 0 || t % KEYFRAME_INTERVAL_S < (1 / OUTPUT_FPS);
      videoEncoder.encode(outFrame, { keyFrame: isKey });
      outFrame.close();
      frameIndex++;

      // Progress
      const pct = Math.min(99, Math.round((t / recording.duration) * 100));
      if (pct !== lastReportedPct) {
        lastReportedPct = pct;
        onProgress({ stage: "rendering", percent: pct });
      }

      // Schedule next frame capture
      if (t < recording.duration - 0.1) {
        video.requestVideoFrameCallback(onFrame);
      } else {
        resolve();
      }
    };

    // Kick off the callback chain and start playback
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(reject);

    // Safety net: resolve when video naturally ends
    video.addEventListener("ended", () => resolve(), { once: true });

    // Timeout guard: max duration + 10s buffer
    setTimeout(() => resolve(), (recording.duration + 10) * 1000);
  });

  video.pause();
  if (audioReader) await audioReader.cancel();
  await audioPromise;

  // ── Flush encoder & finalize mux ──────────────────────────────────────────
  onProgress({ stage: "encoding", percent: 100 });

  if (videoEncoder.state === "configured") await videoEncoder.flush();
  if (audioEncoder && audioEncoder.state === "configured") await audioEncoder.flush();

  muxer.finalize();
  const blob = new Blob([muxerTarget.buffer], { type: "video/webm" });

  return {
    blob,
    url: URL.createObjectURL(blob),
    format: "webm",
  };
}
