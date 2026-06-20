import { useEffect, useRef } from "react";

interface BackgroundStarsProps {
  count?: number;
  edgeProbability?: number;
  maxMargin?: number;
  minOpacity?: number;
  maxOpacity?: number;
  highMinOpacity?: number;
  highMaxOpacity?: number;
  minSize?: number;
  maxSize?: number;
}

export function BackgroundStars({
  count = 100,
  edgeProbability = 0,
  maxMargin = 0,
  minOpacity = 0.1,
  maxOpacity = 0.7,
  highMinOpacity = 0.2,
  highMaxOpacity = 0.8,
  minSize = 0.1,
  maxSize = 0.6,
}: BackgroundStarsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Initialize stars
    const stars = Array.from({ length: count }).map(() => {
      let x = Math.random() * canvas.width;
      let y = Math.random() * canvas.height;

      if (Math.random() < edgeProbability && maxMargin > 0) {
        const margin = maxMargin * 10;
        const onVerticalEdge = Math.random() < 0.5;
        if (onVerticalEdge) {
          x = Math.random() < 0.5 ? Math.random() * margin : canvas.width - Math.random() * margin;
        } else {
          y = Math.random() < 0.5 ? Math.random() * margin : canvas.height - Math.random() * margin;
        }
      }

      const isHighOpacity = Math.random() < 0.3;
      const minO = isHighOpacity ? highMinOpacity : minOpacity;
      const maxO = isHighOpacity ? highMaxOpacity : maxOpacity;

      return {
        x,
        y,
        size: Math.random() * (maxSize - minSize) + minSize,
        opacity: Math.random() * (maxO - minO) + minO,
        minO,
        maxO,
        speed: Math.random() * 0.04 + 0.015,
        direction: Math.random() < 0.5 ? 1 : -1,
      };
    });

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      stars.forEach((star) => {
        star.opacity += star.speed * star.direction;
        if (star.opacity >= star.maxO) {
          star.opacity = star.maxO;
          star.direction = -1;
        } else if (star.opacity <= star.minO) {
          star.opacity = star.minO;
          star.direction = 1;
        }

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [count, edgeProbability, maxMargin, minOpacity, maxOpacity, highMinOpacity, highMaxOpacity, minSize, maxSize]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none block z-0"
    />
  );
}
