import { useMemo } from "react";

interface Star {
  id: number;
  top: string;
  left: string;
  size: number;
  duration: number;
  delay: number;
  isHigh: boolean;
}

export function BackgroundStars({ 
  count = 50,
  edgeProbability = 0.9,
  maxMargin = 8,
  minOpacity = 0.05,
  maxOpacity = 0.3,
  highMinOpacity = 0.2,
  highMaxOpacity = 0.8,
}: { 
  count?: number;
  edgeProbability?: number;
  maxMargin?: number;
  minOpacity?: number;
  maxOpacity?: number;
  highMinOpacity?: number;
  highMaxOpacity?: number;
}) {
  const stars = useMemo(() => {
    return [...Array(count)].map((_, i) => {
      // Logic to force stars into the borders
      const isEdgeStar = Math.random() < edgeProbability; // 90% chance by default to be an edge star
      let top, left;
      
      if (isEdgeStar) {
        const side = Math.floor(Math.random() * 4);
        const margin = Math.random() * maxMargin; // Within maxMargin% of the edge
        
        switch (side) {
          case 0: top = `${margin}%`; left = `${Math.random() * 100}%`; break; // Top
          case 1: top = `${100 - margin}%`; left = `${Math.random() * 100}%`; break; // Bottom
          case 2: top = `${Math.random() * 100}%`; left = `${margin}%`; break; // Left
          case 3: top = `${Math.random() * 100}%`; left = `${100 - margin}%`; break; // Right
          default: top = "0%"; left = "0%";
        }
      } else {
        top = `${Math.random() * 100}%`;
        left = `${Math.random() * 100}%`;
      }

      return {
        id: i,
        top,
        left,
        size: Math.random() > 0.8 ? 2 : 1,
        duration: 2 + Math.random() * 3, // Twinkle speed
        delay: Math.random() * -5, // Negative delay to start immediately in mid-animation
        isHigh: Math.random() > 0.85,
      };
    });
  }, [count, edgeProbability, maxMargin]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <style>{`
        @keyframes twinkle-star {
          0%, 100% {
            opacity: var(--min-opacity);
            transform: scale(var(--min-scale));
          }
          50% {
            opacity: var(--max-opacity);
            transform: scale(var(--max-scale));
          }
        }
      `}</style>
      {stars.map((star) => (
        <div
          key={star.id}
          className={`absolute rounded-full bg-white ${star.isHigh ? 'shadow-[0_0_10px_rgba(255,255,255,0.3)]' : ''}`}
          style={{
            top: star.top,
            left: star.left,
            width: `${star.size}px`,
            height: `${star.size}px`,
            animation: `twinkle-star ${star.duration}s ease-in-out infinite`,
            animationDelay: `${star.delay}s`,
            "--min-opacity": star.isHigh ? highMinOpacity : minOpacity,
            "--max-opacity": star.isHigh ? highMaxOpacity : maxOpacity,
            "--min-scale": star.isHigh ? 1 : 0.9,
            "--max-scale": star.isHigh ? 1.4 : 1.1,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
