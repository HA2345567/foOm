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
/**
 * Uses Gemini 1.5 Flash to transcribe the audio and generate a summary + title.
 */
export async function analyzeRecordingAI(blob: Blob): Promise<{
  subtitles: Subtitle[];
  summary: string;
  title: string;
}> {
  if (!genAI) throw new Error("Gemini API key not configured");

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  // Extract only the audio to drastically reduce payload size (prevents 400 Payload Too Large)
  const audioBlob = await extractAudioFromVideo(blob);

  const base64 = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(audioBlob);
  });

  const prompt = `You are a professional video editor and copywriter. Analyze this audio recording from a screen recording.
  
  Perform three tasks:
  1. Transcribe the audio precisely. Break the text into short, readable phrases suitable for video subtitles (3-7 words per subtitle).
  2. Write a concise, engaging summary of what is happening or being discussed in the recording.
  3. Suggest a professional, "catchy" title for the video.

  Return a JSON object: 
  { 
    "subtitles": [ { "start": number, "end": number, "text": string } ],
    "summary": "string",
    "title": "string"
  }
  
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
  let text = response.text();

  // Strip potential markdown code blocks if the model ignored responseMimeType
  if (text.startsWith("```json")) {
    text = text.replace(/^```json\n?/, "").replace(/\n?```$/, "");
  } else if (text.startsWith("```")) {
    text = text.replace(/^```\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const data = JSON.parse(text);
    return {
      subtitles: Array.isArray(data.subtitles) ? data.subtitles : [],
      summary: data.summary || "",
      title: data.title || "Untitled Recording"
    };
  } catch (e) {
    console.error("Failed to parse Gemini transcription. Raw response:", text);
    console.error(e);
    return { subtitles: [], summary: "", title: "" };
  }
}


async function captureFrames(url: string, duration: number, count: number) {
  const video = document.createElement("video");
  video.style.position = "fixed";
  video.style.pointerEvents = "none";
  video.style.top = "-9999px";
  video.style.left = "-9999px";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  document.body.appendChild(video);

  try {
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
      // Yield to keep browser responsive
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return frames;
  } finally {
    try {
      video.pause();
      video.src = "";
      video.load();
      video.remove();
    } catch (e) {
      console.warn("Failed to clean up captureFrames video element", e);
    }
  }
}

/**
 * Extracts the audio track from a video Blob and encodes it as a mono 16kHz WAV.
 * This massively reduces the payload size sent to the Gemini API (from ~50MB to ~1MB).
 */
async function extractAudioFromVideo(videoBlob: Blob): Promise<Blob> {
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  try {
    const arrayBuffer = await videoBlob.arrayBuffer();

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.warn("No audio track found or decode failed. Sending original blob.", e);
      return videoBlob;
    }

    const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();

    const renderedBuffer = await offlineCtx.startRendering();
    return bufferToWav(renderedBuffer);
  } finally {
    try {
      await audioCtx.close();
    } catch (e) {
      console.warn("Failed to close AudioContext in extractAudioFromVideo", e);
    }
  }
}

function bufferToWav(abuffer: AudioBuffer): Blob {
  const numOfChan = abuffer.numberOfChannels;
  const length = abuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) { view.setUint16(offset, data, true); offset += 2; }
  function setUint32(data: number) { view.setUint32(offset, data, true); offset += 4; }

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  for (let i = 0; i < abuffer.numberOfChannels; i++) {
    channels.push(abuffer.getChannelData(i));
  }

  while (pos < abuffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([buffer], { type: "audio/wav" });
}
