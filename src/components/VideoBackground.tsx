import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { BackgroundStars } from './BackgroundStars';

interface VideoBackgroundProps {
  src: string;
}

export function VideoBackground({ src }: VideoBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;

    const playVideo = () => {
      video.play().catch(err => {
        console.warn("Video autoplay failed:", err);
      });
    };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.addEventListener('loadedmetadata', playVideo);
    } else if (Hls.isSupported()) {
      hls = new Hls({
        maxMaxBufferLength: 30,
        enableWorker: true,
        autoStartLoad: true,
      });
      
      hls.loadSource(src);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        playVideo();
      });
    }

    return () => {
      if (hls) hls.destroy();
      video.removeEventListener('loadedmetadata', playVideo);
    };
  }, [src]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none bg-black">
      {/* 1. The Video Layer - Centered better to ensure the vortex is visible */}
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover opacity-100 scale-125 origin-top translate-y-[5%]"
        style={{ filter: 'contrast(1.1) brightness(1.2)' }}
      />

      {/* 2. Refined Vignette (Lighter at top, deep at bottom) */}
      <div className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_50%_10%,transparent_0%,rgba(0,0,0,0.2)_50%,rgba(0,0,0,0.9)_90%,#000_100%)]" />
      
      {/* 3. Integrated Stars */}
      <div className="absolute inset-0 z-20">
        <BackgroundStars count={40} />
      </div>

      {/* 4. Fine Noise Grain */}
      <div className="absolute inset-0 z-30 opacity-[0.04] pointer-events-none mix-blend-soft-light" 
        style={{ backgroundImage: 'url("https://grainy-gradients.vercel.app/noise.svg")' }} 
      />
    </div>
  );
}
