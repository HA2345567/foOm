import { useRef, useEffect, useState, useCallback } from "react";

interface WebcamOverlayProps {
  stream: MediaStream;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const cornerPositions: Record<Corner, string> = {
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-right": "bottom-4 right-4",
};

const cornerOrder: Corner[] = ["bottom-right", "bottom-left", "top-left", "top-right"];

export function WebcamOverlay({ stream }: WebcamOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [corner, setCorner] = useState<Corner>("bottom-right");

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const cycleCorner = useCallback(() => {
    setCorner((prev) => {
      const idx = cornerOrder.indexOf(prev);
      return cornerOrder[(idx + 1) % cornerOrder.length];
    });
  }, []);

  return (
    <div
      className={`absolute ${cornerPositions[corner]} z-10 cursor-pointer group`}
      onClick={cycleCorner}
      title="Click to reposition"
    >
      <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-2 border-border shadow-card-hover ring-2 ring-background">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover scale-x-[-1]"
        />
      </div>
      <div className="absolute inset-0 rounded-full bg-foreground/0 group-hover:bg-foreground/5 transition-colors" />
    </div>
  );
}
