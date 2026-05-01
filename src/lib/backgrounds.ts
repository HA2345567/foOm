export type Background = {
  id: string;
  name: string;
  /** CSS string for UI swatches */
  css: string;
  /** Function to paint onto canvas */
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

const linear = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stops: [number, string][],
  angle = 135,
) => {
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad);
  const y = Math.sin(rad);
  const len = Math.abs(w * x) + Math.abs(h * y);
  const cx = w / 2;
  const cy = h / 2;
  const grd = ctx.createLinearGradient(
    cx - (x * len) / 2,
    cy - (y * len) / 2,
    cx + (x * len) / 2,
    cy + (y * len) / 2,
  );
  for (const [pos, col] of stops) grd.addColorStop(pos, col);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
};

const solid = (ctx: CanvasRenderingContext2D, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, w, h);
};

export const BACKGROUNDS: Background[] = [
  {
    id: "violet",
    name: "Violet",
    css: "linear-gradient(135deg, #8b5cf6, #ec4899)",
    paint: (c, w, h) => linear(c, w, h, [[0, "#8b5cf6"], [1, "#ec4899"]]),
  },
  {
    id: "ocean",
    name: "Ocean",
    css: "linear-gradient(135deg, #0ea5e9, #6366f1)",
    paint: (c, w, h) => linear(c, w, h, [[0, "#0ea5e9"], [1, "#6366f1"]]),
  },
  {
    id: "sunset",
    name: "Sunset",
    css: "linear-gradient(135deg, #f97316, #ef4444)",
    paint: (c, w, h) => linear(c, w, h, [[0, "#f97316"], [1, "#ef4444"]]),
  },
  {
    id: "mint",
    name: "Mint",
    css: "linear-gradient(135deg, #10b981, #06b6d4)",
    paint: (c, w, h) => linear(c, w, h, [[0, "#10b981"], [1, "#06b6d4"]]),
  },
  {
    id: "noir",
    name: "Noir",
    css: "linear-gradient(135deg, #1f2937, #000000)",
    paint: (c, w, h) => linear(c, w, h, [[0, "#1f2937"], [1, "#000000"]]),
  },
  {
    id: "peach",
    name: "Peach",
    css: "linear-gradient(135deg, #fda4af, #fcd34d)",
    paint: (c, w, h) => linear(c, w, h, [[0, "#fda4af"], [1, "#fcd34d"]]),
  },
  {
    id: "white",
    name: "White",
    css: "#ffffff",
    paint: (c, w, h) => solid(c, w, h, "#ffffff"),
  },
  {
    id: "black",
    name: "Black",
    css: "#000000",
    paint: (c, w, h) => solid(c, w, h, "#000000"),
  },
];

export interface FrameStyle {
  /** background padding ratio (0..0.3) of canvas width */
  padding: number;
  /** corner radius in px relative to inset video */
  radius: number;
  /** shadow blur radius */
  shadow: number;
}

export const DEFAULT_FRAME: FrameStyle = {
  padding: 0.06,
  radius: 16,
  shadow: 40,
};
