import type { RecordingResult } from "../hooks/useScreenRecording";
import { generateZoomKeyframes, interpolateZoom } from "./autoZoom";
import { drawComposite } from "./composite";
import {
  _imgCache,
  type Background,
  type FrameStyle,
  type Subtitle,
} from "./backgrounds";
import * as WebMMuxer from "webm-muxer";
import * as MP4Muxer from "mp4-muxer";

export interface RenderProgress {
  stage: "preparing" | "rendering" | "encoding" | "done";
  percent: number;
}

export type RenderFormat = "mp4" | "webm";

export interface RenderOutput {
  blob: Blob;
  url: string;
  format: RenderFormat;
}

const QUALITY_PRESETS: Record<360 | 480 | 720 | 1080, { targetH: number; videoBps: number }> = {
  360: { targetH: 360, videoBps: 1_200_000 },
  480: { targetH: 480, videoBps: 2_500_000 },
  720: { targetH: 720, videoBps: 5_000_000 },
  1080: { targetH: 1080, videoBps: 10_000_000 },
};

const OUTPUT_FPS = 30;
const KEYFRAME_INTERVAL_S = 2;
const AUDIO_BPS = 128_000;

export async function renderAutoZoom(
  recording: RecordingResult,
  opts: {
    format?: RenderFormat;
    quality?: 360 | 480 | 720 | 1080;
    background: Background;
    frame: FrameStyle;
    subtitles?: Subtitle[];
    clicksOverride?: RecordingResult["clicks"];
    onProgress?: (p: RenderProgress) => void;
  },
): Promise<RenderOutput> {
  const onProgress = opts.onProgress ?? (() => {});
  const format: RenderFormat = opts.format ?? "mp4";
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

  // ── Decode audio once up front ────────────────────────────────────────────
  let audioBuffer: AudioBuffer | null = null;
  try {
    const arrBuf = await recording.blob.arrayBuffer();
    const AC = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tmpCtx = new AC();
    audioBuffer = await tmpCtx.decodeAudioData(arrBuf.slice(0));
    await tmpCtx.close();
  } catch (e) {
    console.warn("Audio decode failed, exporting video-only:", e);
  }

  // ── Load video ────────────────────────────────────────────────────────────
  const video = document.createElement("video");
  video.src = recording.url;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.playbackRate = 1.0;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Video failed to load"));
    video.load();
  });
  await new Promise<void>((resolve) => {
    if (video.readyState >= 4) return resolve();
    const onReady = () => { video.removeEventListener("canplaythrough", onReady); resolve(); };
    video.addEventListener("canplaythrough", onReady);
    setTimeout(resolve, 3000);
  });

  const srcW = recording.width || video.videoWidth || 1280;
  const srcH = recording.height || video.videoHeight || 720;
  const srcAspect = srcW / srcH;

  const outH = Math.min(preset.targetH, srcH * 2);
  // Both encoders prefer even dims; H.264 in particular requires it.
  const outW = Math.round(outH * srcAspect) & ~1;
  const outHEven = outH & ~1;

  const canvas = new OffscreenCanvas(outW, outHEven);
  const ctx = canvas.getContext("2d", { alpha: false }) as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // ── Set up muxer + encoders for chosen format ─────────────────────────────
  const sampleRate = audioBuffer?.sampleRate ?? 48000;
  const channelCount = Math.min(2, audioBuffer?.numberOfChannels ?? 2);

  let mp4Muxer: MP4Muxer.Muxer<MP4Muxer.ArrayBufferTarget> | null = null;
  let webmMuxer: WebMMuxer.Muxer<WebMMuxer.ArrayBufferTarget> | null = null;
  let mp4Target: MP4Muxer.ArrayBufferTarget | null = null;
  let webmTarget: WebMMuxer.ArrayBufferTarget | null = null;

  let videoCodec: string;
  let audioCodec: string;

  if (format === "mp4") {
    mp4Target = new MP4Muxer.ArrayBufferTarget();
    mp4Muxer = new MP4Muxer.Muxer({
      target: mp4Target,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
      video: { codec: "avc", width: outW, height: outHEven },
      audio: audioBuffer ? { codec: "aac", numberOfChannels: channelCount, sampleRate } : undefined,
    });
    videoCodec = "avc1.640028"; // H.264 High @ Level 4.0
    audioCodec = "mp4a.40.2";   // AAC LC
  } else {
    webmTarget = new WebMMuxer.ArrayBufferTarget();
    webmMuxer = new WebMMuxer.Muxer({
      target: webmTarget,
      firstTimestampBehavior: "offset",
      video: { codec: "V_VP9", width: outW, height: outHEven },
      audio: audioBuffer ? { codec: "A_OPUS", numberOfChannels: channelCount, sampleRate } : undefined,
    });
    videoCodec = "vp09.00.10.08";
    audioCodec = "opus";
  }

  // Verify codec support, fall back gracefully
  const videoSupport = await VideoEncoder.isConfigSupported({
    codec: videoCodec, width: outW, height: outHEven, bitrate: preset.videoBps, framerate: OUTPUT_FPS,
  }).catch(() => null);
  if (!videoSupport?.supported) {
    if (format === "mp4") {
      // Try baseline H.264
      videoCodec = "avc1.42E01F";
      const fallback = await VideoEncoder.isConfigSupported({
        codec: videoCodec, width: outW, height: outHEven, bitrate: preset.videoBps, framerate: OUTPUT_FPS,
      }).catch(() => null);
      if (!fallback?.supported) throw new Error("Browser doesn't support H.264 encoding for MP4 export. Try WebM instead.");
    } else {
      throw new Error("Browser doesn't support VP9 encoding for WebM export.");
    }
  }

  // ── Video encoder ─────────────────────────────────────────────────────────
  let videoError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (mp4Muxer) mp4Muxer.addVideoChunk(chunk, meta);
      if (webmMuxer) webmMuxer.addVideoChunk(chunk, meta);
    },
    error: (e) => { videoError = e; console.error("VideoEncoder error:", e); },
  });
  videoEncoder.configure({
    codec: videoCodec,
    width: outW,
    height: outHEven,
    bitrate: preset.videoBps,
    framerate: OUTPUT_FPS,
    ...(format === "mp4" ? { avc: { format: "avc" } as AvcEncoderConfig } : {}),
  });

  // ── Audio encoder ─────────────────────────────────────────────────────────
  let audioEncoder: AudioEncoder | null = null;
  if (audioBuffer && typeof AudioEncoder !== "undefined") {
    try {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          if (mp4Muxer) mp4Muxer.addAudioChunk(chunk, meta);
          if (webmMuxer) webmMuxer.addAudioChunk(chunk, meta);
        },
        error: (e) => console.error("AudioEncoder error:", e),
      });
      audioEncoder.configure({
        codec: audioCodec,
        sampleRate,
        numberOfChannels: channelCount,
        bitrate: AUDIO_BPS,
      });
    } catch (e) {
      console.warn("Audio encoder setup failed, video-only export:", e);
      audioEncoder = null;
    }
  }

  // Encode audio in chunks of ~50ms
  if (audioEncoder && audioBuffer) {
    const totalFrames = audioBuffer.length;
    const chunkFrames = Math.max(1, Math.floor(sampleRate * 0.05)); // 50ms
    const interleaved = new Float32Array(chunkFrames * channelCount);
    let frameOffset = 0;
    while (frameOffset < totalFrames) {
      const frames = Math.min(chunkFrames, totalFrames - frameOffset);
      const slice = new Float32Array(frames * channelCount);
      for (let ch = 0; ch < channelCount; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < frames; i++) {
          slice[i * channelCount + ch] = channelData[frameOffset + i];
        }
      }
      const ad = new AudioData({
        format: "f32",
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels: channelCount,
        timestamp: Math.round((frameOffset / sampleRate) * 1_000_000),
        data: slice,
      });
      audioEncoder.encode(ad);
      ad.close();
      frameOffset += frames;
    }
  }

  // ── Render frames via requestVideoFrameCallback ───────────────────────────
  let frameIndex = 0;
  let lastReportedPct = -1;
  onProgress({ stage: "rendering", percent: 0 });

  await new Promise<void>((resolve, reject) => {
    const onFrame = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
      if (videoError) { reject(videoError); return; }

      const t = metadata.mediaTime;
      const timestampUs = Math.round(t * 1_000_000);
      const frameDurationUs = Math.round((1 / OUTPUT_FPS) * 1_000_000);

      const kf = interpolateZoom(keyframes, t);
      drawComposite(ctx as unknown as CanvasRenderingContext2D, video, kf, {
        background: opts.background,
        frame: opts.frame,
        subtitles: opts.subtitles,
        currentTime: t,
        srcW,
        srcH,
        outW,
        outH: outHEven,
      });

      const outFrame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
        alpha: "discard",
      });

      const isKey = frameIndex === 0 || t % KEYFRAME_INTERVAL_S < (1 / OUTPUT_FPS);
      videoEncoder.encode(outFrame, { keyFrame: isKey });
      outFrame.close();
      frameIndex++;

      const pct = Math.min(99, Math.round((t / recording.duration) * 100));
      if (pct !== lastReportedPct) {
        lastReportedPct = pct;
        onProgress({ stage: "rendering", percent: pct });
      }

      if (t < recording.duration - 0.05) {
        video.requestVideoFrameCallback(onFrame);
      } else {
        resolve();
      }
    };

    video.requestVideoFrameCallback(onFrame);
    video.play().catch(reject);
    video.addEventListener("ended", () => resolve(), { once: true });
    setTimeout(() => resolve(), (recording.duration + 10) * 1000);
  });

  video.pause();

  onProgress({ stage: "encoding", percent: 100 });
  if (videoEncoder.state === "configured") await videoEncoder.flush();
  if (audioEncoder && audioEncoder.state === "configured") await audioEncoder.flush();

  let blob: Blob;
  if (mp4Muxer && mp4Target) {
    mp4Muxer.finalize();
    blob = new Blob([mp4Target.buffer], { type: "video/mp4" });
  } else if (webmMuxer && webmTarget) {
    webmMuxer.finalize();
    blob = new Blob([webmTarget.buffer], { type: "video/webm" });
  } else {
    throw new Error("Muxer not initialized");
  }

  return {
    blob,
    url: URL.createObjectURL(blob),
    format,
  };
}

// Minor type shim for AVC config
type AvcEncoderConfig = { format: "avc" | "annexb" };
