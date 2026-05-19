import React, { useEffect, useRef } from "react";
import Hls from "hls.js";
import { BackgroundStars } from "./BackgroundStars";

interface VideoBackgroundProps {
  src: string;
}

export function VideoBackground({
  src,
}: VideoBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;

    const startVideo = async () => {
      try {
        await video.play();
      } catch (err) {
        console.error("Autoplay failed:", err);
      }
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;

      video.addEventListener("loadedmetadata", startVideo);
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        autoStartLoad: true,
        abrEwmaDefaultEstimate: 10000000, // Prime estimator with 10 Mbps for high quality
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Force the highest quality level for the background video
        if (hls && hls.levels && hls.levels.length > 0) {
          hls.currentLevel = hls.levels.length - 1;
        }
        startVideo();
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        console.error("HLS ERROR:", data);
      });
    }

    return () => {
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full"
        style={{
          objectFit: "cover",
          objectPosition: "center",
          filter: "contrast(1.1) brightness(1.1)",
        }}
      />

      <div className="absolute inset-0 z-20">
        <BackgroundStars count={40} />
      </div>
    </div>
  );
}