import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface WebcamOverlayProps {
  stream: MediaStream;
  shape?: "circle" | "square" | "rounded";
  onRegister?: (el: HTMLVideoElement | null) => void;
}

export function WebcamOverlay({ stream, shape = "circle", onRegister }: WebcamOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPip, setIsPip] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    video.srcObject = stream;
    video.play().catch(err => console.warn("Webcam play failed", err));
    onRegister?.(video);

    const handleEnterPip = () => setIsPip(true);
    const handleLeavePip = () => setIsPip(false);

    video.addEventListener("enterpictureinpicture", handleEnterPip);
    video.addEventListener("leavepictureinpicture", handleLeavePip);

    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnterPip);
      video.removeEventListener("leavepictureinpicture", handleLeavePip);
    };
  }, [stream]);

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error("PiP failed", err);
    }
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.1}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      className="fixed bottom-8 right-8 z-[9999] cursor-grab active:cursor-grabbing"
      style={{ touchAction: "none" }}
    >
      <div className={`relative w-32 h-32 md:w-44 md:h-44 overflow-hidden border-[3px] border-white/30 shadow-[0_12px_40px_rgba(0,0,0,0.6)] bg-black ring-4 ring-white/10 group transition-all duration-500
        ${shape === 'circle' ? 'rounded-full' : shape === 'rounded' ? 'rounded-[20%]' : 'rounded-lg'}
      `}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-300 ${isPip ? 'opacity-20' : 'opacity-100'}`}
        />
        
        {/* PIP Mode Overlay State */}
        {isPip && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="mb-2 opacity-80">
               <path d="M19 11V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2v-6" />
               <path d="M14 13h7v7h-7z" />
            </svg>
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">In PiP Mode</span>
          </div>
        )}

        {/* Action Controls */}
        <div className={`absolute inset-0 flex items-center justify-center gap-2 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${isHovered && !isPip ? 'opacity-100' : 'opacity-0'}`}>
          <button 
            onClick={togglePip}
            className="p-2.5 rounded-full bg-white text-black hover:scale-110 active:scale-95 transition-transform shadow-lg"
            title="Toggle Picture-in-Picture (Float on top of other tabs)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
          </button>
        </div>
        
        {/* Active pulse indicator */}
        <div className={`absolute top-3 right-3 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white shadow-[0_0_10px_rgba(255,0,0,0.8)] animate-pulse ${isPip ? 'hidden' : ''}`} />
      </div>

      {/* Floating Tooltip */}
      <AnimatePresence>
        {isHovered && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-white text-[10px] font-bold whitespace-nowrap uppercase tracking-widest shadow-xl"
          >
            {isPip ? "Camera Floating" : "Drag or click for Floating Mode"}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

