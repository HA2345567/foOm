import React, { useEffect, useRef } from 'react';
import { BackgroundStars } from './BackgroundStars';

interface VideoBackgroundProps {
  src: string;
}

export function VideoBackground({ src }: VideoBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Completely bypass loading video background on mobile devices to save battery and performance
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    // Convert Mux HLS url to direct native MP4 url for lightweight, hardware-accelerated playback
    const isMux = src.includes("stream.mux.com");
    const playUrl = isMux ? src.replace(/\.m3u8$/, "/medium.mp4") : src;

    video.src = playUrl;

    const playVideo = () => {
      video.play().catch(err => {
        console.warn("Video autoplay failed:", err);
      });
    };

    video.addEventListener('loadedmetadata', playVideo);
    
    // Trigger play if readyState suggests video is already loaded
    if (video.readyState >= 1) {
      playVideo();
    }

    return () => {
      video.removeEventListener('loadedmetadata', playVideo);
    };
  }, [src]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none bg-black">
      {/* 1. The Video Layer - Centered better to ensure the vortex is visible (hidden on mobile) */}
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        className="hidden md:block absolute inset-0 w-full h-full object-cover opacity-100 scale-125 origin-top translate-y-[5%]"
        style={{ filter: 'contrast(1.2) brightness(1.3)' }}
      />

      {/* 2. Refined Vignette (Lighter at top, deep at bottom) */}
      <div className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_50%_10%,transparent_0%,rgba(0,0,0,0.2)_50%,rgba(0,0,0,0.9)_90%,#000_100%)]" />
      
      {/* 3. Integrated Stars */}
      <div className="absolute inset-0 z-20">
        <BackgroundStars count={40} />
      </div>

      {/* 4. Fine Noise Grain */}
      <div className="absolute inset-0 z-30 opacity-[0.04] pointer-events-none mix-blend-soft-light" 
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }} 
      />
    </div>
  );
}
