export type Background = {
  id: string;
  name: string;
  /** CSS string for UI swatches */
  css: string;
  /** Optional image URL for image-based backgrounds */
  url?: string;
  /** Function to paint onto canvas */
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

export type Subtitle = {
  start: number;
  end: number;
  text: string;
};



// ─────────────────────────────────────────────────────────────────────────────
// Primitive painters
// ─────────────────────────────────────────────────────────────────────────────

const solid = (ctx: CanvasRenderingContext2D, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, w, h);
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


/**
 * Radial glow — soft light source from a focal point.
 * cx/cy normalized 0..1. rf = radius as fraction of canvas diagonal.
 */
const radialGlow = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cx: number,
  cy: number,
  color: string,
  rf: number,
) => {
  const diag = Math.sqrt(w * w + h * h);
  const grd = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, diag * rf);
  grd.addColorStop(0, color);
  grd.addColorStop(1, "transparent");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
};

const _grainCache = new Map<string, HTMLCanvasElement>();

const grain = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  alpha: number = 8,
) => {
  if (alpha <= 0) return;
  const key = `${w}-${h}-${alpha}`;
  let gCanvas = _grainCache.get(key);

  if (!gCanvas) {
    gCanvas = document.createElement("canvas");
    gCanvas.width = w;
    gCanvas.height = h;
    const gctx = gCanvas.getContext("2d");
    if (gctx) {
      const imageData = gctx.createImageData(w, h);
      const buf = imageData.data;
      let seed = 0xdeadbeef;
      const rng = () => {
        seed = (seed * 1664525 + 1013904223) & 0xffffffff;
        return (seed >>> 0) / 0xffffffff;
      };
      for (let i = 0; i < buf.length; i += 4) {
        const v = (rng() * 255) | 0;
        buf[i] = v;
        buf[i + 1] = v;
        buf[i + 2] = v;
        buf[i + 3] = alpha;
      }
      gctx.putImageData(imageData, 0, 0);
    }
    _grainCache.set(key, gCanvas);
  }

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(gCanvas, 0, 0);
  ctx.restore();
};

/**
 * Core dark background painter.
 *
 * Each background uses 4 glow layers for depth:
 *   [0] tight bright core       — the dominant colour identity
 *   [1] wide soft spread        — fills the mid-field
 *   [2] top-right specular flare — subtle highlight, adds 3-D feel
 *   [3] bottom-left shadow bleed — dark accent, grounds the light source
 *
 * Dual-source backgrounds (Amethyst, Magenta, Infrared) instead use
 * two separated left/right blooms with a blended centre.
 */
const darkGlow = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  glows: { cx: number; cy: number; color: string; rf: number }[],
  grainAlpha: number = 8,
) => {
  solid(ctx, w, h, base);
  for (const g of glows) {
    radialGlow(ctx, w, h, g.cx, g.cy, g.color, g.rf);
  }
  grain(ctx, w, h, grainAlpha);
};

/**
 * Image painter with simple caching.
 * Draws a pre-loaded image or starts loading it if missing.
 */
export const _imgCache: Record<string, HTMLImageElement> = {};
const image = (ctx: CanvasRenderingContext2D, w: number, h: number, url: string) => {
  let img = _imgCache[url];
  if (!img) {
    img = new Image();
    img.src = url;
    _imgCache[url] = img;
  }

  if (img.complete && img.naturalWidth > 0) {
    // Cover logic
    const imgAspect = img.width / img.height;
    const canvasAspect = w / h;
    let drawW = w;
    let drawH = h;
    let offsetX = 0;
    let offsetY = 0;

    if (canvasAspect > imgAspect) {
      drawH = w / imgAspect;
      offsetY = (h - drawH) / 2;
    } else {
      drawW = h * imgAspect;
      offsetX = (w - drawW) / 2;
    }
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  } else {
    // Fallback while loading
    solid(ctx, w, h, "#111");
  }
};

/**
 * Multi-radial "mesh gradient" approximation.
 */
const meshGradient = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  blobs: { cx: number; cy: number; r: number; color: string }[],
  grainAlpha = 8,
) => {
  solid(ctx, w, h, base);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "screen";
  for (const b of blobs) {
    radialGlow(ctx, w, h, b.cx, b.cy, b.color, b.r);
  }
  ctx.globalCompositeOperation = prev;
  if (grainAlpha > 0) grain(ctx, w, h, grainAlpha);
};


// ─────────────────────────────────────────────────────────────────────────────
// CSS swatch helpers (mirrors the canvas look for UI swatches)
// ─────────────────────────────────────────────────────────────────────────────

const swatchRadial = (color: string, base: string) =>
  `radial-gradient(ellipse at 40% 52%, ${color} 0%, ${base} 72%)`;

const swatchDual = (c1: string, c2: string, base: string) =>
  `radial-gradient(ellipse at 26% 50%, ${c1} 0%, ${c2} 48%, ${base} 76%)`;

// ─────────────────────────────────────────────────────────────────────────────
// Background catalogue
// ─────────────────────────────────────────────────────────────────────────────

export const BACKGROUNDS: Background[] = [

  // ── RED ───────────────────────────────────────────────────────────────────
  {
    id: "crimson",
    name: "Crimson",
    css: swatchRadial("rgba(210,0,25,0.98)", "#080000"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#080000", [
      { cx: 0.38, cy: 0.52, color: "rgba(210,0,25,0.98)",   rf: 0.42 }, // core
      { cx: 0.38, cy: 0.52, color: "rgba(160,0,15,0.65)",   rf: 0.78 }, // spread
      { cx: 0.80, cy: 0.12, color: "rgba(255,40,40,0.30)",  rf: 0.32 }, // specular
      { cx: 0.10, cy: 0.88, color: "rgba(120,0,10,0.25)",   rf: 0.30 }, // shadow bleed
    ]),
  },

  // ── ORANGE ────────────────────────────────────────────────────────────────
  {
    id: "ember",
    name: "Ember",
    css: swatchRadial("rgba(235,85,0,0.98)", "#060200"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#060200", [
      { cx: 0.40, cy: 0.55, color: "rgba(235,85,0,0.98)",   rf: 0.44 },
      { cx: 0.40, cy: 0.55, color: "rgba(190,55,0,0.60)",   rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(255,170,0,0.38)",  rf: 0.34 },
      { cx: 0.08, cy: 0.80, color: "rgba(150,30,0,0.22)",   rf: 0.28 },
    ]),
  },

  // ── YELLOW ────────────────────────────────────────────────────────────────
  {
    id: "gold",
    name: "Gold",
    css: swatchRadial("rgba(225,165,0,0.98)", "#060500"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#060500", [
      { cx: 0.40, cy: 0.52, color: "rgba(225,165,0,0.98)",  rf: 0.42 },
      { cx: 0.40, cy: 0.52, color: "rgba(175,120,0,0.60)",  rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(255,220,30,0.32)", rf: 0.32 },
      { cx: 0.12, cy: 0.82, color: "rgba(140,80,0,0.20)",   rf: 0.28 },
    ]),
  },

  // ── LIME ──────────────────────────────────────────────────────────────────
  {
    id: "neon_lime",
    name: "Neon Lime",
    css: swatchRadial("rgba(90,225,0,0.98)", "#010700"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#010700", [
      { cx: 0.40, cy: 0.52, color: "rgba(90,225,0,0.98)",   rf: 0.42 },
      { cx: 0.40, cy: 0.52, color: "rgba(55,175,0,0.58)",   rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(150,255,30,0.30)", rf: 0.32 },
      { cx: 0.10, cy: 0.82, color: "rgba(30,130,0,0.20)",   rf: 0.28 },
    ]),
  },

  // ── BLUE ──────────────────────────────────────────────────────────────────
  {
    id: "sapphire",
    name: "Sapphire",
    css: swatchRadial("rgba(25,75,255,0.98)", "#00000c"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#00000c", [
      { cx: 0.38, cy: 0.52, color: "rgba(25,75,255,0.98)",  rf: 0.44 },
      { cx: 0.38, cy: 0.52, color: "rgba(10,45,205,0.65)",  rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(80,140,255,0.35)", rf: 0.34 },
      { cx: 0.10, cy: 0.84, color: "rgba(5,20,140,0.22)",   rf: 0.28 },
    ]),
  },

  // ── CYAN ──────────────────────────────────────────────────────────────────
  {
    id: "arctic",
    name: "Arctic",
    css: swatchRadial("rgba(0,205,255,0.98)", "#000910"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#000910", [
      { cx: 0.40, cy: 0.52, color: "rgba(0,205,255,0.98)",  rf: 0.42 },
      { cx: 0.40, cy: 0.52, color: "rgba(0,155,225,0.60)",  rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(100,235,255,0.32)",rf: 0.32 },
      { cx: 0.10, cy: 0.82, color: "rgba(0,80,140,0.20)",   rf: 0.28 },
    ]),
  },

  // ── PURPLE ────────────────────────────────────────────────────────────────
  {
    id: "violet",
    name: "Violet",
    css: swatchRadial("rgba(115,0,255,0.98)", "#030010"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#030010", [
      { cx: 0.38, cy: 0.52, color: "rgba(115,0,255,0.98)",  rf: 0.44 },
      { cx: 0.38, cy: 0.52, color: "rgba(80,0,205,0.65)",   rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(175,70,255,0.32)", rf: 0.34 },
      { cx: 0.10, cy: 0.84, color: "rgba(50,0,150,0.22)",   rf: 0.28 },
    ]),
  },

  // ── PURPLE + PINK dual ────────────────────────────────────────────────────
  {
    id: "amethyst",
    name: "Amethyst",
    css: swatchDual("rgba(170,0,230,0.92)", "rgba(230,0,175,0.85)", "#05000f"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#05000f", [
      { cx: 0.25, cy: 0.48, color: "rgba(170,0,230,0.92)",  rf: 0.40 }, // left bloom
      { cx: 0.72, cy: 0.52, color: "rgba(230,0,175,0.85)",  rf: 0.38 }, // right bloom
      { cx: 0.48, cy: 0.50, color: "rgba(140,0,210,0.25)",  rf: 0.70 }, // centre blend
      { cx: 0.50, cy: 0.08, color: "rgba(200,50,255,0.18)", rf: 0.28 }, // top specular
    ]),
  },

  // ── PINK ──────────────────────────────────────────────────────────────────
  {
    id: "rose",
    name: "Rose",
    css: swatchRadial("rgba(245,0,118,0.98)", "#090006"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#090006", [
      { cx: 0.40, cy: 0.52, color: "rgba(245,0,118,0.98)",  rf: 0.42 },
      { cx: 0.40, cy: 0.52, color: "rgba(200,0,88,0.62)",   rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(255,70,155,0.32)", rf: 0.32 },
      { cx: 0.10, cy: 0.82, color: "rgba(140,0,65,0.20)",   rf: 0.28 },
    ]),
  },

  // ── MAGENTA dual ──────────────────────────────────────────────────────────
  {
    id: "magenta",
    name: "Magenta",
    css: swatchDual("rgba(225,0,205,0.95)", "rgba(255,0,155,0.80)", "#070007"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#070007", [
      { cx: 0.28, cy: 0.50, color: "rgba(225,0,205,0.95)",  rf: 0.40 }, // left bloom
      { cx: 0.74, cy: 0.50, color: "rgba(255,0,155,0.80)",  rf: 0.38 }, // right bloom
      { cx: 0.50, cy: 0.50, color: "rgba(190,0,220,0.22)",  rf: 0.72 }, // centre blend
      { cx: 0.50, cy: 0.10, color: "rgba(220,0,180,0.16)",  rf: 0.26 }, // top specular
    ]),
  },

  // ── TEAL ──────────────────────────────────────────────────────────────────
  {
    id: "teal",
    name: "Teal",
    css: swatchRadial("rgba(0,205,172,0.98)", "#000908"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#000908", [
      { cx: 0.40, cy: 0.52, color: "rgba(0,205,172,0.98)",  rf: 0.42 },
      { cx: 0.40, cy: 0.52, color: "rgba(0,158,138,0.62)",  rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(0,245,205,0.30)",  rf: 0.32 },
      { cx: 0.10, cy: 0.82, color: "rgba(0,90,80,0.20)",    rf: 0.28 },
    ]),
  },

  // ── GREEN ─────────────────────────────────────────────────────────────────
  {
    id: "emerald",
    name: "Emerald",
    css: swatchRadial("rgba(0,205,75,0.98)", "#000900"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#000900", [
      { cx: 0.40, cy: 0.52, color: "rgba(0,205,75,0.98)",   rf: 0.42 },
      { cx: 0.40, cy: 0.52, color: "rgba(0,158,55,0.62)",   rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(30,245,100,0.30)", rf: 0.32 },
      { cx: 0.10, cy: 0.82, color: "rgba(0,90,30,0.20)",    rf: 0.28 },
    ]),
  },

  // ── COPPER ────────────────────────────────────────────────────────────────
  {
    id: "copper",
    name: "Copper",
    css: swatchRadial("rgba(200,95,18,0.98)", "#070300"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#070300", [
      { cx: 0.40, cy: 0.52, color: "rgba(200,95,18,0.98)",  rf: 0.42 },
      { cx: 0.40, cy: 0.52, color: "rgba(165,68,8,0.62)",   rf: 0.80 },
      { cx: 0.82, cy: 0.14, color: "rgba(245,140,38,0.35)", rf: 0.32 },
      { cx: 0.10, cy: 0.82, color: "rgba(110,40,5,0.22)",   rf: 0.28 },
    ]),
  },

  // ── RED + ORANGE dual ─────────────────────────────────────────────────────
  {
    id: "infrared",
    name: "Infrared",
    css: swatchDual("rgba(225,20,0,0.95)", "rgba(255,95,0,0.88)", "#050000"),
    paint: (ctx, w, h) => darkGlow(ctx, w, h, "#050000", [
      { cx: 0.25, cy: 0.52, color: "rgba(225,20,0,0.95)",   rf: 0.42 }, // left bloom
      { cx: 0.72, cy: 0.48, color: "rgba(255,95,0,0.88)",   rf: 0.40 }, // right bloom
      { cx: 0.48, cy: 0.50, color: "rgba(200,40,0,0.28)",   rf: 0.75 }, // centre blend
      { cx: 0.50, cy: 0.10, color: "rgba(255,60,0,0.18)",   rf: 0.26 }, // top specular
    ]),
  },

  // ── PURE ──────────────────────────────────────────────────────────────────
  {
    id: "white",
    name: "White",
    css: "radial-gradient(ellipse at 50% 50%, #ffffff 0%, #f0f0f0 100%)",
    paint: (ctx, w, h) => {
      solid(ctx, w, h, "#fafafa");
      radialGlow(ctx, w, h, 0.5, 0.5, "rgba(255,255,255,0.90)", 0.55);
      radialGlow(ctx, w, h, 0.5, 0.5, "rgba(200,200,200,0.35)", 0.95);
      grain(ctx, w, h, 4);
    },
  },
  {
    id: "black",
    name: "Black",
    css: "#000000",
    paint: (ctx, w, h) => {
      solid(ctx, w, h, "#000000");
      radialGlow(ctx, w, h, 0.38, 0.48, "rgba(30,30,30,0.70)", 0.55);
      radialGlow(ctx, w, h, 0.82, 0.18, "rgba(20,20,20,0.30)", 0.35);
      grain(ctx, w, h, 12);
    },
  },

  // ── PREMIUM DARK ───────────────────────────────────────────────────────────

  {
    id: "obsidian",
    name: "Obsidian",
    css: "linear-gradient(135deg, #0f0f11 0%, #1a1a2e 50%, #0f0f11 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,   "#0f0f11"],
        [0.5, "#1a1a2e"],
        [1,   "#0d0d0f"],
      ], 135);
      grain(ctx, w, h, 8);
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    css: "radial-gradient(ellipse at 30% 40%, #1e1b4b, #0f172a)",
    paint: (ctx, w, h) => {
      solid(ctx, w, h, "#090b14");
      radialGlow(ctx, w, h, 0.3, 0.38, "rgba(79,70,229,0.55)", 0.6);
      radialGlow(ctx, w, h, 0.75, 0.65, "rgba(139,92,246,0.25)", 0.45);
      grain(ctx, w, h, 10);
    },
  },
  {
    id: "carbon",
    name: "Carbon",
    css: "linear-gradient(160deg, #1c1c1e 0%, #2c2c2e 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,    "#1c1c1e"],
        [0.45, "#242426"],
        [1,    "#2c2c2e"],
      ], 160);
      grain(ctx, w, h, 7);
    },
  },
  {
    id: "deep_space",
    name: "Deep Space",
    css: "radial-gradient(ellipse at 60% 30%, #0c1445, #000000)",
    paint: (ctx, w, h) => {
      solid(ctx, w, h, "#000000");
      radialGlow(ctx, w, h, 0.6, 0.28, "rgba(14,30,89,0.9)", 0.65);
      radialGlow(ctx, w, h, 0.15, 0.75, "rgba(30,14,89,0.5)", 0.4);
      grain(ctx, w, h, 11);
    },
  },

  // ── MESH / LIT ──────────────────────────────────────────────────────────────

  {
    id: "aurora",
    name: "Aurora",
    css: "radial-gradient(ellipse at 25% 60%, #0d9488, #6d28d9)",
    paint: (ctx, w, h) =>
      meshGradient(ctx, w, h, "#05080f", [
        { cx: 0.22, cy: 0.62, r: 0.275, color: "rgba(13,148,136,0.7)"  },
        { cx: 0.75, cy: 0.3,  r: 0.25,  color: "rgba(109,40,217,0.65)" },
        { cx: 0.5,  cy: 0.85, r: 0.175, color: "rgba(6,182,212,0.3)"   },
      ], 10),
  },
  {
    id: "nebula",
    name: "Nebula",
    css: "radial-gradient(ellipse at 70% 30%, #7c3aed, #db2777)",
    paint: (ctx, w, h) =>
      meshGradient(ctx, w, h, "#0a040f", [
        { cx: 0.68, cy: 0.28, r: 0.275, color: "rgba(124,58,237,0.75)"  },
        { cx: 0.25, cy: 0.7,  r: 0.25,  color: "rgba(219,39,119,0.6)"   },
        { cx: 0.5,  cy: 0.45, r: 0.15,  color: "rgba(251,113,133,0.2)"  },
      ], 10),
  },
  {
    id: "northern",
    name: "Northern",
    css: "radial-gradient(ellipse at 40% 50%, #064e3b, #1e3a5f)",
    paint: (ctx, w, h) =>
      meshGradient(ctx, w, h, "#020d09", [
        { cx: 0.4,  cy: 0.45, r: 0.3,  color: "rgba(6,78,59,0.8)"    },
        { cx: 0.75, cy: 0.3,  r: 0.225, color: "rgba(30,58,95,0.7)"   },
        { cx: 0.15, cy: 0.7,  r: 0.2,  color: "rgba(16,185,129,0.25)" },
      ], 9),
  },

  // ── VIVID ──────────────────────────────────────────────────────────────────

  {
    id: "cosmic",
    name: "Cosmic",
    css: "linear-gradient(135deg, #1a0533 0%, #4f1787 40%, #e91e8c 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,    "#1a0533"],
        [0.38, "#4f1787"],
        [0.72, "#c2185b"],
        [1,    "#e91e8c"],
      ], 135);
      grain(ctx, w, h, 8);
    },
  },
  {
    id: "horizon",
    name: "Horizon",
    css: "linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,    "#0f2027"],
        [0.5,  "#203a43"],
        [1,    "#2c5364"],
      ], 160);
      radialGlow(ctx, w, h, 0.5, 1.05, "rgba(56,189,248,0.12)", 0.45);
      grain(ctx, w, h, 8);
    },
  },
  {
    id: "rose_gold",
    name: "Rose Gold",
    css: "linear-gradient(135deg, #b76e79 0%, #f4c2c2 50%, #e8a87c 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,    "#8b4a52"],
        [0.35, "#b76e79"],
        [0.65, "#f4c2c2"],
        [1,    "#e8a87c"],
      ], 135);
      grain(ctx, w, h, 6);
    },
  },
  {
    id: "forest_vivid",
    name: "Forest Vivid",
    css: "linear-gradient(135deg, #1b4332 0%, #2d6a4f 50%, #52b788 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,    "#0d2119"],
        [0.4,  "#1b4332"],
        [0.75, "#2d6a4f"],
        [1,    "#52b788"],
      ], 135);
      grain(ctx, w, h, 7);
    },
  },

  // ── NEUTRAL ────────────────────────────────────────────────────────────────

  {
    id: "slate",
    name: "Slate",
    css: "linear-gradient(160deg, #334155 0%, #1e293b 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,   "#334155"],
        [1,   "#1e293b"],
      ], 160);
      grain(ctx, w, h, 6);
    },
  },
  {
    id: "studio_neutral",
    name: "Studio Neutral",
    css: "linear-gradient(160deg, #f8fafc 0%, #e2e8f0 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,   "#f8fafc"],
        [0.6, "#f1f5f9"],
        [1,   "#e2e8f0"],
      ], 160);
      grain(ctx, w, h, 5);
    },
  },
  {
    id: "warm_white",
    name: "Warm White",
    css: "linear-gradient(135deg, #fefce8 0%, #fef3c7 100%)",
    paint: (ctx, w, h) => {
      linear(ctx, w, h, [
        [0,   "#fefce8"],
        [1,   "#fef3c7"],
      ], 135);
      grain(ctx, w, h, 4);
    },
  },

  // ── PROFESSIONAL SCENES ────────────────────────────────────────────────────

  {
    id: "pro_office",
    name: "Office",
    css: "url('/bg/office.png') center/cover",
    url: "/bg/office.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/office.png"),
  },
  {
    id: "pro_studio",
    name: "Studio",
    css: "url('/bg/studio.png') center/cover",
    url: "/bg/studio.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/studio.png"),
  },
  {
    id: "pro_boardroom",
    name: "Boardroom",
    css: "url('/bg/boardroom.png') center/cover",
    url: "/bg/boardroom.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/boardroom.png"),
  },
];


// ─────────────────────────────────────────────────────────────────────────────
// Frame styles
// ─────────────────────────────────────────────────────────────────────────────

export interface FrameStyle {
  /** Background padding ratio (0..0.3) of canvas width */
  padding: number;
  /** Corner radius in px relative to inset video */
  radius: number;
  /** Shadow blur radius */
  shadow: number;
}

export const DEFAULT_FRAME: FrameStyle = {
  padding: 0.06,
  radius: 16,
  shadow: 40,
};