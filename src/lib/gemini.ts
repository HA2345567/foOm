import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ClickEvent } from "../hooks/useScreenRecording";
import type { Subtitle } from "./backgrounds";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

/**
 * Uses Gemini 1.5 Flash to analyze video frames and detect points of interest.
 * This provides much smarter "semantic" zooming compared to pixel-diffing.
 */
export async function detectInterestAI(
  videoUrl: string,
  duration: number
): Promise<ClickEvent[]> {
  if (!genAI) throw new Error("Gemini API key not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  // 1. Capture 8-12 snapshots across the duration
  const sampleCount = Math.min(12, Math.max(5, Math.floor(duration / 2)));
  const frames = await captureFrames(videoUrl, duration, sampleCount);

  // 2. Prepare the prompt with images
  const prompt = `You are a cinematic video editor. Analyze these sequential frames from a screen recording.
Identify the specific coordinates (x, y) of the most important UI elements or actions occurring at each timestamp.
Focus on where the user is interacting: typing in an input, clicking a button, a menu opening, or a significant change in the UI.
Return a JSON array of objects: { "t": number, "x": number, "y": number, "reason": string }.
t should be the exact timestamp provided for each frame. x and y must be normalized coordinates between 0 and 1.`;

  const result = await model.generateContent([
    prompt,
    ...frames.flatMap(f => [
      `Frame at ${f.t.toFixed(2)}s:`,
      {
        inlineData: {
          data: f.base64.split(",")[1],
          mimeType: "image/jpeg"
        }
      }
    ])
  ]);

  const response = await result.response;
  const text = response.text();

  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data.map(d => ({ t: d.t, x: d.x, y: d.y })) : [];
  } catch (e) {
    console.error("Failed to parse Gemini response", e, text);
    return [];
  }
}

/**
 * Uses Gemini 1.5 Flash to transcribe the audio from a recording.
 */
export async function transcribeAudioAI(blob: Blob): Promise<Subtitle[]> {
  if (!genAI) throw new Error("Gemini API key not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });


  const base64 = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

  const prompt = `Transcribe this audio recording precisely. 
Return a JSON array of objects: { "start": number, "end": number, "text": string }.
Break the text into short, readable phrases suitable for video subtitles (3-7 words per subtitle).
Ensure timestamps are accurate and align with the speech.`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: base64.split(",")[1],
        mimeType: blob.type || "audio/webm"
      }
    }
  ]);

  const response = await result.response;
  const text = response.text();

  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Failed to parse Gemini transcription", e, text);
    return [];
  }
}


async function captureFrames(url: string, duration: number, count: number) {
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.crossOrigin = "anonymous";
  await new Promise((r) => (video.onloadedmetadata = r));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  // Small enough for Gemini but clear enough for UI
  canvas.width = 640;
  canvas.height = 360;

  const frames: { t: number; base64: string }[] = [];

  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * duration;
    video.currentTime = t;
    await new Promise((r) => (video.onseeked = r));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push({ t, base64: canvas.toDataURL("image/jpeg", 0.7) });
  }

  return frames;
}
