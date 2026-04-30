import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
  generateZoomKeyframes,
  interpolateZoom,
  type ZoomKeyframe,
} from "./autoZoom";
import type { RecordingResult } from "../hooks/useScreenRecording";

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  if (onLog) ffmpeg.on("log", ({ message }) => onLog(message));
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(
      `${baseURL}/ffmpeg-core.wasm`,
      "application/wasm",
    ),
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
 * Decode the recording frame-by-frame into a canvas, apply zoom, capture as
 * a new MediaStream, encode back to MP4 via ffmpeg.wasm.
 *
 * Approach: render zoomed frames to canvas at source FPS, capture with
 * canvas.captureStream + MediaRecorder (webm), then transmux/transcode to MP4
 * with ffmpeg.wasm and mux original audio.
 */
export async function renderAutoZoom(
  recording: RecordingResult,
  opts: {
    fps?: number;
    format?: "mp4" | "webm";
    zoomScale?: number;
    onProgress?: (p: RenderProgress) => void;
  } = {},
): Promise<RenderOutput> {
  const fps = opts.fps ?? 30;
  const format = opts.format ?? "mp4";
  const onProgress = opts.onProgress ?? (() => {});

  const keyframes = generateZoomKeyframes(
    recording.clicks,
    recording.duration,
    {
      clickScale: opts.zoomScale ?? 1.7,
      scrolls: recording.scrolls,
      pauses: recording.pauses,
    },
  );

  // 1) Decode source via <video> element
  onProgress({ stage: "decoding", percent: 0 });
  const video = document.createElement("video");
  video.src = recording.url;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("video decode failed"));
  });

  const W = recording.width || video.videoWidth;
  const H = recording.height || video.videoHeight;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // 2) Capture canvas stream + record
  const canvasStream = canvas.captureStream(fps);
  const recorderMime = MediaRecorder.isTypeSupported(
    "video/webm;codecs=vp9",
  )
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(canvasStream, {
    mimeType: recorderMime,
    videoBitsPerSecond: 5_000_000,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const recordingDone = new Promise<Blob>((resolve) => {
    recorder.onstop = () =>
      resolve(new Blob(chunks, { type: recorderMime }));
  });

  // 3) Drive playback frame-by-frame using requestVideoFrameCallback when available
  recorder.start();
  await video.play().catch(() => {
    /* autoplay may need user gesture, but we have one from button click */
  });
  video.pause();
  video.currentTime = 0;

  const totalFrames = Math.ceil(recording.duration * fps);
  const renderFrame = (kf: ZoomKeyframe) => {
    const sw = W / kf.scale;
    const sh = H / kf.scale;
    let sx = kf.x * W - sw / 2;
    let sy = kf.y * H - sh / 2;
    sx = Math.max(0, Math.min(W - sw, sx));
    sy = Math.max(0, Math.min(H - sh, sy));
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
  };

  // Seek-based rendering (works cross-browser, slower than rVFC)
  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    await new Promise<void>((resolve) => {
      const onSeek = () => {
        video.removeEventListener("seeked", onSeek);
        resolve();
      };
      video.addEventListener("seeked", onSeek);
      video.currentTime = Math.min(t, recording.duration - 0.001);
    });
    const kf = interpolateZoom(keyframes, t);
    renderFrame(kf);
    // Pace canvas captureStream so recorder picks up the frame
    await new Promise((r) => setTimeout(r, 1000 / fps));
    if (i % 10 === 0) {
      onProgress({
        stage: "compositing",
        percent: Math.round((i / totalFrames) * 70),
      });
    }
  }

  recorder.stop();
  const zoomedWebm = await recordingDone;

  // 4) Mux audio + transcode to requested format with ffmpeg.wasm
  onProgress({ stage: "loading", percent: 75 });
  const ffmpeg = await getFFmpeg();

  await ffmpeg.writeFile("video.webm", await fetchFile(zoomedWebm));
  await ffmpeg.writeFile("audio.webm", await fetchFile(recording.blob));

  onProgress({ stage: "encoding", percent: 85 });

  const outName = format === "mp4" ? "out.mp4" : "out.webm";
  const args =
    format === "mp4"
      ? [
          "-i",
          "video.webm",
          "-i",
          "audio.webm",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0?",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-shortest",
          outName,
        ]
      : [
          "-i",
          "video.webm",
          "-i",
          "audio.webm",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0?",
          "-c:v",
          "copy",
          "-c:a",
          "libopus",
          "-shortest",
          outName,
        ];

  await ffmpeg.exec(args);
  const data = (await ffmpeg.readFile(outName)) as Uint8Array;
  // Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer / detached buffer issues
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy.buffer], {
    type: format === "mp4" ? "video/mp4" : "video/webm",
  });

  onProgress({ stage: "done", percent: 100 });
  return { blob, url: URL.createObjectURL(blob), format };
}
