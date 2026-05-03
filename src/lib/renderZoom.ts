import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { generateZoomKeyframes, interpolateZoom } from "./autoZoom";
import type { RecordingResult } from "../hooks/useScreenRecording";
import { drawComposite } from "./composite";
import type { Background, FrameStyle } from "./backgrounds";

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on("log", ({ message }) => onLog(message));
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export interface RenderProgress {
  stage: "loading" | "decoding" | "compositing" | "encoding" | "done";
  percent: number;
}

export interface RenderOutput {
  blob: Blob;
  url: string;
  format: "mp4" | "webm";
}

/**
 * Deterministic frame-by-frame renderer.
 *
 * For each output frame we:
 *   1. Seek the source <video> to the exact frame timestamp and await `seeked`
 *   2. Draw composite (background + zoomed video) onto an offscreen canvas
 *   3. Encode that canvas as JPEG and feed it to FFmpeg as an image sequence
 *
 * FFmpeg then assembles the JPEGs at the requested fps and muxes the original
 * recording audio. This guarantees the spring-physics zoom curve is sampled
 * at uniform intervals — no MediaRecorder real-time drift, no duplicated /
 * dropped frames, perfectly smooth motion.
 */
export async function renderAutoZoom(
  recording: RecordingResult,
  opts: {
    fps?: number;
    format?: "mp4" | "webm";
    zoomScale?: number;
    background: Background;
    frame: FrameStyle;
    clicksOverride?: RecordingResult["clicks"];
    onProgress?: (p: RenderProgress) => void;
  },
): Promise<RenderOutput> {
  const fps = opts.fps ?? 30;
  const format = opts.format ?? "mp4";
  const onProgress = opts.onProgress ?? (() => {});

  const clicks = opts.clicksOverride ?? recording.clicks;
  const keyframes = generateZoomKeyframes(clicks, recording.duration, {
    clickScale: opts.zoomScale ?? 1.55,
    feel: "silk",
    scrolls: recording.scrolls,
    pauses: recording.pauses,
  });

  onProgress({ stage: "loading", percent: 2 });
  const ffmpeg = await getFFmpeg();

  onProgress({ stage: "decoding", percent: 5 });
  const video = document.createElement("video");
  video.src = recording.url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("video decode failed"));
  });
  // Some browsers need a play()/pause() cycle before currentTime seeks reliably
  try {
    await video.play();
    video.pause();
  } catch {
    /* ignore */
  }

  const srcW = recording.width || video.videoWidth;
  const srcH = recording.height || video.videoHeight;
  // Cap output at 1080p-ish for reasonable encode time / memory
  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const outW = Math.round(srcW * scale / 2) * 2;
  const outH = Math.round(srcH * scale / 2) * 2;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const totalFrames = Math.max(1, Math.ceil(recording.duration * fps));

  // Helper: seek to exact time, wait for the seeked event
  const seekTo = (t: number) =>
    new Promise<void>((resolve) => {
      const onSeek = () => {
        video.removeEventListener("seeked", onSeek);
        resolve();
      };
      video.addEventListener("seeked", onSeek);
      video.currentTime = Math.min(t, Math.max(0, recording.duration - 1e-3));
    });

  // Helper: canvas → JPEG Uint8Array
  const canvasToJpeg = (quality = 0.92): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("toBlob failed"));
          const reader = new FileReader();
          reader.onloadend = () => {
            const buf = reader.result as ArrayBuffer;
            resolve(new Uint8Array(buf));
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(blob);
        },
        "image/jpeg",
        quality,
      );
    });

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    await seekTo(t);
    const kf = interpolateZoom(keyframes, t);
    drawComposite(ctx, video, kf, {
      background: opts.background,
      frame: opts.frame,
      srcW,
      srcH,
      outW,
      outH,
    });
    const jpeg = await canvasToJpeg(0.92);
    const name = `f${i.toString().padStart(6, "0")}.jpg`;
    await ffmpeg.writeFile(name, jpeg);

    if (i % 3 === 0 || i === totalFrames - 1) {
      onProgress({
        stage: "compositing",
        percent: 5 + Math.round((i / totalFrames) * 75),
      });
    }
  }

  onProgress({ stage: "encoding", percent: 82 });
  await ffmpeg.writeFile("audio.webm", await fetchFile(recording.blob));

  const outName = format === "mp4" ? "out.mp4" : "out.webm";
  const args =
    format === "mp4"
      ? [
          "-framerate", String(fps),
          "-i", "f%06d.jpg",
          "-i", "audio.webm",
          "-map", "0:v:0",
          "-map", "1:a:0?",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "20",
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          "-c:a", "aac",
          "-b:a", "160k",
          "-shortest",
          outName,
        ]
      : [
          "-framerate", String(fps),
          "-i", "f%06d.jpg",
          "-i", "audio.webm",
          "-map", "0:v:0",
          "-map", "1:a:0?",
          "-c:v", "libvpx-vp9",
          "-b:v", "0",
          "-crf", "32",
          "-c:a", "libopus",
          "-shortest",
          outName,
        ];

  await ffmpeg.exec(args);
  const data = (await ffmpeg.readFile(outName)) as Uint8Array;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy.buffer], {
    type: format === "mp4" ? "video/mp4" : "video/webm",
  });

  // Cleanup frame files to free WASM memory for next export
  for (let i = 0; i < totalFrames; i++) {
    const name = `f${i.toString().padStart(6, "0")}.jpg`;
    try {
      await ffmpeg.deleteFile(name);
    } catch {
      /* ignore */
    }
  }
  try {
    await ffmpeg.deleteFile("audio.webm");
    await ffmpeg.deleteFile(outName);
  } catch {
    /* ignore */
  }

  onProgress({ stage: "done", percent: 100 });
  return { blob, url: URL.createObjectURL(blob), format };
}
