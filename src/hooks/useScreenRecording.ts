import { useState, useRef, useCallback, useEffect } from "react";

export type RecordingState = "idle" | "requesting" | "recording" | "paused" | "stopped";

export interface RecordingOptions {
  audio: boolean;
  webcam: boolean;
}

export interface RecordingResult {
  blob: Blob;
  url: string;
  duration: number;
}

export function useScreenRecording() {
  const [state, setState] = useState<RecordingState>("idle");
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  // Cleanup all streams
  const cleanup = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    micStreamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Toggle webcam
  const toggleWebcam = useCallback(async () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      setWebcamStream(null);
      setWebcamEnabled(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" },
        });
        setWebcamStream(stream);
        setWebcamEnabled(true);
      } catch {
        setError("Webcam access denied");
      }
    }
  }, [webcamStream]);

  // Start recording
  const startRecording = useCallback(async () => {
    setError(null);
    setState("requesting");
    chunksRef.current = [];

    try {
      // Request screen capture
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true, // tab audio if available
      });
      screenStreamRef.current = screenStream;

      // Combine tracks
      const tracks: MediaStreamTrack[] = [...screenStream.getVideoTracks()];

      // Add screen audio if present
      const screenAudioTracks = screenStream.getAudioTracks();
      if (screenAudioTracks.length > 0) {
        tracks.push(...screenAudioTracks);
      }

      // Request microphone if enabled
      if (micEnabled) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = micStream;
          tracks.push(...micStream.getAudioTracks());
        } catch {
          console.warn("Mic access denied, recording without mic");
        }
      }

      const combinedStream = new MediaStream(tracks);

      // Determine supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
          ? "video/webm;codecs=vp8,opus"
          : "video/webm";

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 3_000_000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const duration = (Date.now() - startTimeRef.current) / 1000;
        setResult({ blob, url, duration });
        setState("stopped");
        cleanup();
      };

      // Handle user stopping screen share via browser UI
      screenStream.getVideoTracks()[0].addEventListener("ended", () => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      });

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // collect data every second
      startTimeRef.current = Date.now();
      setState("recording");

      // Start timer
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (err) {
      cleanup();
      setState("idle");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Screen sharing was cancelled");
      } else {
        setError("Failed to start recording");
      }
    }
  }, [micEnabled, cleanup]);

  // Pause / resume
  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setState("paused");
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "paused") {
      recorder.resume();
      setState("recording");
      const resumeBase = Date.now() - elapsed * 1000;
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - resumeBase) / 1000));
      }, 1000);
    }
  }, [elapsed]);

  // Stop recording
  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  // Discard and reset
  const discardRecording = useCallback(() => {
    if (result?.url) {
      URL.revokeObjectURL(result.url);
    }
    setResult(null);
    setState("idle");
    setElapsed(0);
    setError(null);
  }, [result]);

  // Download recording
  const downloadRecording = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `zoomcast-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [result]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      webcamStream?.getTracks().forEach((t) => t.stop());
    };
  }, [cleanup, webcamStream]);

  return {
    state,
    result,
    elapsed,
    error,
    micEnabled,
    setMicEnabled,
    webcamEnabled,
    webcamStream,
    toggleWebcam,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    downloadRecording,
  };
}
