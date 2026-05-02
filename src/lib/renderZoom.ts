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

export async function renderAutoZoom(
  recording: RecordingResult,
  opts: {
    fps?: number;
    format?: "mp4" | "webm";
    zoomScale?: number;
    background: Background;
    frame: FrameStyle;
    /** override the click events used for auto-zoom (e.g. detected interest points) */
    clicksOverride?: RecordingResult["clicks"];
    onProgress?: (p: RenderProgress) => void;
  },
): Promise<RenderOutput> {
  const fps = opts.fps ?? 30;
  const format = opts.format ?? "mp4";
  const onProgress = opts.onProgress ?? (() => {});

  const clicks = opts.clicksOverride ?? recording.clicks;
  const keyframes = generateZoomKeyframes(clicks, recording.duration, {
    clickScale: opts.zoomScale ?? 1.42,
    scrolls: recording.scrolls,
    pauses: recording.pauses,
  });

  onProgress({ stage: "decoding", percent: 0 });
  const video = document.createElement("video");
  video.src = recording.url;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("video decode failed"));
  });

  const srcW = recording.width || video.videoWidth;
  const srcH = recording.height || video.videoHeight;
  const outW = srcW;
  const outH = srcH;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;

  const canvasStream = canvas.captureStream(fps);
  const recorderMime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(canvasStream, {
    mimeType: recorderMime,
    videoBitsPerSecond: 6_000_000,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const recordingDone = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorderMime }));
  });

  recorder.start();
  await video.play().catch(() => {});
  video.pause();
  video.currentTime = 0;

  const totalFrames = Math.ceil(recording.duration * fps);
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
    drawComposite(ctx, video, kf, {
      background: opts.background,
      frame: opts.frame,
      srcW,
      srcH,
      outW,
      outH,
    });
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
          "22",
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
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy.buffer], {
    type: format === "mp4" ? "video/mp4" : "video/webm",
  });
  onProgress({ stage: "done", percent: 100 });
  return { blob, url: URL.createObjectURL(blob), format };
}
