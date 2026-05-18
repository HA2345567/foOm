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
import { type AudioSegment } from "./audioAnalysis";

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
    cameraX?: number;
    cameraY?: number;
    cameraSize?: number;
    cameraShape?: "circle" | "square" | "rounded";
    cameraZoom?: number;
    mouseMoves?: { t: number, x: number, y: number }[];
    showCursor?: boolean;
    removeSilence?: boolean;
    segments?: AudioSegment[];
    trimStart?: number;
    trimEnd?: number;
    aspectRatio?: "16:9" | "9:16" | "1:1";
    feel?: "glass" | "velvet" | "silk" | "snap";
    speed?: number;
    backgroundMusicUrl?: string;
    backgroundMusicOffset?: number;
    onProgress?: (p: RenderProgress) => void;
  },
): Promise<RenderOutput> {
  const onProgress = opts.onProgress ?? (() => {});
  const format: RenderFormat = opts.format ?? "mp4";
  const speed = opts.speed ?? 1;
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

  // ── Decode background music if provided ─────────────────────────────────────
  let bgMusicBuffer: AudioBuffer | null = null;
  if (opts.backgroundMusicUrl) {
    try {
      const res = await fetch(opts.backgroundMusicUrl);
      const arrBuf = await res.arrayBuffer();
      const AC = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const tmpCtx = new AC();
      bgMusicBuffer = await tmpCtx.decodeAudioData(arrBuf);
      await tmpCtx.close();
    } catch (e) {
      console.warn("Failed to load background music:", e);
    }
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

  // ── Load camera video if exists ───────────────────────────────────────────
  let cameraVideo: HTMLVideoElement | null = null;
  if (recording.cameraUrl) {
    cameraVideo = document.createElement("video");
    cameraVideo.src = recording.cameraUrl;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    cameraVideo.crossOrigin = "anonymous";
    cameraVideo.preload = "auto";
    cameraVideo.playbackRate = 1.0;
    await new Promise<void>((resolve) => {
      cameraVideo!.onloadedmetadata = () => resolve();
      cameraVideo!.onerror = () => { cameraVideo = null; resolve(); };
      cameraVideo!.load();
    });
  }

  await new Promise<void>((resolve) => {
    if (video.readyState >= 4) return resolve();
    const onReady = () => { video.removeEventListener("canplaythrough", onReady); resolve(); };
    video.addEventListener("canplaythrough", onReady);
    setTimeout(resolve, 3000);
  });

  const srcW = recording.width || video.videoWidth || 1280;
  const srcH = recording.height || video.videoHeight || 720;
  const srcAspect = srcW / srcH;

  const outH_target = preset.targetH;
  let outW, outHEven;

  if (opts.aspectRatio === "9:16") {
    outHEven = outH_target & ~1;
    outW = Math.round(outHEven * (9 / 16)) & ~1;
  } else if (opts.aspectRatio === "1:1") {
    outHEven = outH_target & ~1;
    outW = outHEven;
  } else {
    // Default 16:9 or auto
    outHEven = outH_target & ~1;
    outW = Math.round(outHEven * (16 / 9)) & ~1;
  }

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
    latencyMode: "realtime",
    hardwareAcceleration: "prefer-hardware",
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

  // Encode audio in chunks
  if (audioEncoder && audioBuffer) {
    const totalFrames = audioBuffer.length;
    const chunkFrames = Math.max(1, Math.floor(sampleRate * 0.05)); // 50ms
    
    // If removeSilence is true, we only encode the non-silent segments within the trim range
    if (opts.removeSilence && opts.segments) {
      const trimStart = opts.trimStart ?? 0;
      const trimEnd = opts.trimEnd ?? recording.duration;
      const activeSegments = opts.segments
        .filter(s => s.end > trimStart && s.start < trimEnd)
        .map(s => ({
          start: Math.max(trimStart, s.start),
          end: Math.min(trimEnd, s.end)
        }));

      let logicalTimeUs = 0;
      for (const seg of activeSegments) {
        const startFrame = Math.floor(seg.start * sampleRate);
        const endFrame = Math.min(totalFrames, Math.floor(seg.end * sampleRate));
        
        let f = startFrame;
        while (f < endFrame) {
          const frames = Math.min(chunkFrames, Math.floor((endFrame - f) / speed));
          if (frames <= 0) break;
          const slice = new Float32Array(frames * channelCount);
          for (let ch = 0; ch < channelCount; ch++) {
            const data = audioBuffer.getChannelData(ch);
            for (let i = 0; i < frames; i++) {
              const srcIdx = Math.floor(f + i * speed);
              const voiceSample = srcIdx < data.length ? data[srcIdx] : 0;
              
              let bgSample = 0;
              if (bgMusicBuffer && ch < bgMusicBuffer.numberOfChannels) {
                const bgData = bgMusicBuffer.getChannelData(ch);
                const sampleTimeS = (opts.backgroundMusicOffset ?? 0) + (logicalTimeUs / 1_000_000) + (i / sampleRate);
                const bgFrameIndex = Math.floor(sampleTimeS * bgMusicBuffer.sampleRate) % bgMusicBuffer.length;
                bgSample = bgData[bgFrameIndex] * 0.12; // 12% background music volume
              }
              
              const mixed = voiceSample + bgSample;
              slice[i * channelCount + ch] = Math.max(-1, Math.min(1, mixed));
            }
          }
          const ad = new AudioData({
            format: "f32",
            sampleRate,
            numberOfFrames: frames,
            numberOfChannels: channelCount,
            timestamp: logicalTimeUs,
            data: slice,
          });
          audioEncoder.encode(ad);
          ad.close();
          f += Math.floor(frames * speed);
          logicalTimeUs += Math.round((frames / sampleRate) * 1_000_000);
        }
      }
    } else {
      const trimStart = opts.trimStart ?? 0;
      const trimEnd = opts.trimEnd ?? recording.duration;
      const startFrame = Math.floor(trimStart * sampleRate);
      const endFrame = Math.min(totalFrames, Math.floor(trimEnd * sampleRate));
      
      let frameOffset = startFrame;
      let logicalTimeUs = 0;
      while (frameOffset < endFrame) {
        const frames = Math.min(chunkFrames, Math.floor((endFrame - frameOffset) / speed));
        if (frames <= 0) break;
        const slice = new Float32Array(frames * channelCount);
        for (let ch = 0; ch < channelCount; ch++) {
          const channelData = audioBuffer.getChannelData(ch);
          for (let i = 0; i < frames; i++) {
            const srcIdx = Math.floor(frameOffset + i * speed);
            const voiceSample = srcIdx < channelData.length ? channelData[srcIdx] : 0;
            
            let bgSample = 0;
            if (bgMusicBuffer && ch < bgMusicBuffer.numberOfChannels) {
              const bgData = bgMusicBuffer.getChannelData(ch);
              const sampleTimeS = (opts.backgroundMusicOffset ?? 0) + (logicalTimeUs / 1_000_000) + (i / sampleRate);
              const bgFrameIndex = Math.floor(sampleTimeS * bgMusicBuffer.sampleRate) % bgMusicBuffer.length;
              bgSample = bgData[bgFrameIndex] * 0.12; // 12% background music volume
            }
            
            const mixed = voiceSample + bgSample;
            slice[i * channelCount + ch] = Math.max(-1, Math.min(1, mixed));
          }
        }
        const ad = new AudioData({
          format: "f32",
          sampleRate,
          numberOfFrames: frames,
          numberOfChannels: channelCount,
          timestamp: logicalTimeUs,
          data: slice,
        });
        audioEncoder.encode(ad);
        ad.close();
        frameOffset += Math.floor(frames * speed);
        logicalTimeUs += Math.round((frames / sampleRate) * 1_000_000);
      }
    }
  }

  // ── Render frames ────────────────────────────────────────────────────────
  let frameIndex = 0;
  let lastReportedPct = -1;
  const trimStart = opts.trimStart ?? 0;
  const trimEnd = opts.trimEnd ?? recording.duration;

  const totalDuration = opts.removeSilence && opts.segments
    ? opts.segments
        .filter(s => s.end > trimStart && s.start < trimEnd)
        .reduce((sum, s) => sum + (Math.min(trimEnd, s.end) - Math.max(trimStart, s.start)), 0)
    : trimEnd - trimStart;

  if (opts.removeSilence && opts.segments) {
    const activeSegments = opts.segments
      .filter(s => s.end > trimStart && s.start < trimEnd)
      .map(s => ({
        start: Math.max(trimStart, s.start),
        end: Math.min(trimEnd, s.end)
      }));

    let logicalTime = 0;
    for (const seg of activeSegments) {
      let segTime = seg.start;
      while (segTime < seg.end) {
        const timestampUs = Math.round(logicalTime * 1_000_000);
        const frameDurationS = 1 / OUTPUT_FPS;
        const frameDurationUs = Math.round(frameDurationS * 1_000_000);

        // SMART SEEK: Skip the expensive 'await seeked' for small sequential jumps.
        const needsSeek = Math.abs(video.currentTime - segTime) > 0.04;
        video.currentTime = segTime;
        if (needsSeek) {
          await new Promise<void>((r) => {
            const onSeek = () => { video.removeEventListener("seeked", onSeek); r(); };
            video.addEventListener("seeked", onSeek);
            setTimeout(r, 60); // Safety timeout
          });
        }

        const kf = interpolateZoom(keyframes, segTime);
        if (cameraVideo) {
          const camNeedsSeek = Math.abs(cameraVideo.currentTime - segTime) > 0.04;
          cameraVideo.currentTime = segTime;
          if (camNeedsSeek) {
            await new Promise<void>((r) => {
              const onSeek = () => { cameraVideo!.removeEventListener("seeked", onSeek); r(); };
              cameraVideo!.addEventListener("seeked", onSeek);
              setTimeout(r, 60); 
            });
          }
        }

        drawComposite(ctx as unknown as CanvasRenderingContext2D, video, kf, {
          background: opts.background,
          frame: opts.frame,
          subtitles: opts.subtitles,
          currentTime: segTime,
          srcW, srcH, outW, outH: outHEven,
          camera: cameraVideo || undefined,
          cameraX: opts.cameraX, cameraY: opts.cameraY,
          cameraSize: opts.cameraSize, cameraShape: opts.cameraShape,
          cameraZoom: opts.cameraZoom,
          mouseMoves: opts.mouseMoves,
          showCursor: opts.showCursor,
        });

        const outFrame = new VideoFrame(canvas, {
          timestamp: timestampUs,
          duration: frameDurationUs,
          alpha: "discard",
        });

        const isKey = frameIndex % (OUTPUT_FPS * KEYFRAME_INTERVAL_S) === 0;
        videoEncoder.encode(outFrame, { keyFrame: isKey });
        outFrame.close();
        frameIndex++;

        logicalTime += frameDurationS;
        segTime += frameDurationS * speed;

        const pct = Math.min(99, Math.round((logicalTime / (totalDuration / speed)) * 100));
        if (pct !== lastReportedPct) {
          lastReportedPct = pct;
          onProgress({ stage: "rendering", percent: pct });
        }
      }
    }
  } else {
    // Linear rendering logic respecting trim range
    let t = trimStart;
    let logicalTime = 0;
    while (t < trimEnd) {
      if (videoError) throw videoError;

      const timestampUs = Math.round(logicalTime * 1_000_000);
      const frameDurationS = 1 / OUTPUT_FPS;
      const frameDurationUs = Math.round(frameDurationS * 1_000_000);

      video.currentTime = t;
      await new Promise<void>((r) => {
        const onSeek = () => { video.removeEventListener("seeked", onSeek); r(); };
        video.addEventListener("seeked", onSeek);
      });

      const kf = interpolateZoom(keyframes, t);
      if (cameraVideo) {
        cameraVideo.currentTime = t;
        await new Promise<void>((r) => {
          const onSeek = () => { cameraVideo!.removeEventListener("seeked", onSeek); r(); };
          cameraVideo!.addEventListener("seeked", onSeek);
        });
      }

      drawComposite(ctx as unknown as CanvasRenderingContext2D, video, kf, {
        background: opts.background,
        frame: opts.frame,
        subtitles: opts.subtitles,
        currentTime: t,
        srcW, srcH, outW, outH: outHEven,
        camera: cameraVideo || undefined,
        cameraX: opts.cameraX, cameraY: opts.cameraY,
        cameraSize: opts.cameraSize, cameraShape: opts.cameraShape,
        cameraZoom: opts.cameraZoom,
        mouseMoves: opts.mouseMoves,
        showCursor: opts.showCursor,
      });

      const outFrame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
        alpha: "discard",
      });

      const isKey = frameIndex % (OUTPUT_FPS * KEYFRAME_INTERVAL_S) === 0;
      videoEncoder.encode(outFrame, { keyFrame: isKey });
      outFrame.close();
      frameIndex++;

      t += frameDurationS * speed;
      logicalTime += frameDurationS;

      const pct = Math.min(99, Math.round((logicalTime / ((trimEnd - trimStart) / speed)) * 100));
      if (pct !== lastReportedPct) {
        lastReportedPct = pct;
        onProgress({ stage: "rendering", percent: pct });
      }
    }
  }

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
