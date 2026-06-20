import React, { useEffect, useRef } from "react";
import Hls from "hls.js";
import { BackgroundStars } from "./BackgroundStars";

interface VideoBackgroundProps {
  src: string;
}

export function VideoBackground({ src }: VideoBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;

    // Explicitly enforce DOM properties for reliable autoplay
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    const handleInteraction = () => {
      if (video.paused) {
        video.play().catch((err) => {
          console.warn("Interaction play blocked:", err);
        });
      }
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
    };

    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);

    const startVideo = () => {
      video.play().catch((err) => {
        console.warn("Autoplay blocked:", err);
      });
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      if (video.readyState >= 1) {
        startVideo();
      } else {
        video.addEventListener("loadedmetadata", startVideo);
        video.addEventListener("loadeddata", startVideo);
        video.addEventListener("canplay", startVideo);
      }
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        autoStartLoad: true,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        startVideo();
      });
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        startVideo();
      });
    }

    // Force play attempt
    startVideo();

    return () => {
      video.removeEventListener("loadedmetadata", startVideo);
      video.removeEventListener("loadeddata", startVideo);
      video.removeEventListener("canplay", startVideo);
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      if (hls) {
        hls.destroy();
      }
    };
  }, [src]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black select-none pointer-events-none z-0">
      {/* Light gradient overlays for readability while keeping video clearly visible */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/40 z-10" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.3)_100%)] z-10" />
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          filter: "contrast(1.1) brightness(1.3)", // Increased brightness for clear visibility
        }}
        onCanPlay={(e) => {
          e.currentTarget.play().catch((err) => console.warn("onCanPlay auto-start failed:", err));
        }}
      />

      <div className="absolute inset-0 z-20 opacity-60">
        <BackgroundStars count={100} />
      </div>
    </div>
  );
}
