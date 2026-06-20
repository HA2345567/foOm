import { VideoMuxer } from "./muxer";

export async function createBrowserTestVideoUrl() {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create test canvas context");
  }

  const frameRate = 30;
  const muxer = new VideoMuxer({
    width: canvas.width,
    height: canvas.height,
    frameRate,
    bitrate: 1_000_000,
  });
  await muxer.initialize();

  const encoderConfig: VideoEncoderConfig = {
    codec: "avc1.42001e",
    width: canvas.width,
    height: canvas.height,
    bitrate: 1_000_000,
    framerate: frameRate,
  };
  const support = await VideoEncoder.isConfigSupported(encoderConfig);
  if (!support.supported) {
    throw new Error("Browser test video encoder is not supported");
  }

  const encodeDone = new Promise<void>((resolve, reject) => {
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        void muxer.addVideoChunk(chunk, meta).catch(reject);
      },
      error: reject,
    });
    encoder.configure(encoderConfig);

    for (let frame = 0; frame < 45; frame++) {
      const t = frame / 44;
      context.fillStyle = `hsl(${Math.round(t * 240)}, 72%, 42%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(255, 255, 255, 0.92)";
      context.fillRect(20 + frame * 3, 44, 88, 88);
      context.fillStyle = "rgba(8, 10, 16, 0.9)";
      context.font = "600 24px sans-serif";
      context.fillText("foOm", 116, 98);

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1_000_000) / frameRate),
        duration: Math.round(1_000_000 / frameRate),
      });
      encoder.encode(videoFrame, { keyFrame: frame === 0 });
      videoFrame.close();
    }

    encoder.flush().then(() => {
      encoder.close();
      resolve();
    }, reject);
  });

  await encodeDone;

  const blob = await muxer.finalize();
  if (blob.size === 0) {
    throw new Error("Browser test video is empty");
  }

  const url = URL.createObjectURL(blob);
  return {
    url,
    revoke: () => URL.revokeObjectURL(url),
  };
}
