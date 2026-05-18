export type BackgroundCategory = "wallpaper" | "gradient" | "color" | "image";

export type Background = {
  id: string;
  name: string;
  category: BackgroundCategory;
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
  {
    id: "default_transparent",
    name: "Transparent",
    category: "color",
    css: "transparent",
    paint: (ctx, w, h) => { ctx.clearRect(0, 0, w, h); },
  },
  {
    id: "bg_Screenshot_2026_05_17_214005_png",
    name: "Gradient 1",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 214005.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 214005.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 214005.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_214214_png",
    name: "Gradient 2",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 214214.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 214214.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 214214.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_214246_png",
    name: "Gradient 3",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 214246.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 214246.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 214246.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_214324_png",
    name: "Gradient 4",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 214324.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 214324.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 214324.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_215058_png",
    name: "Gradient 5",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 215058.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 215058.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 215058.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_215258_png",
    name: "Gradient 6",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 215258.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 215258.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 215258.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_215405_png",
    name: "Gradient 7",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 215405.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 215405.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 215405.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_215748_png",
    name: "Gradient 8",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 215748.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 215748.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 215748.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_215824_png",
    name: "Gradient 9",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 215824.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 215824.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 215824.png"),
  },
  {
    id: "bg_Screenshot_2026_05_17_215919_png",
    name: "Gradient 10",
    category: "gradient",
    css: "url('/bg/Screenshot 2026-05-17 215919.png') center/cover",
    url: "/bg/Screenshot 2026-05-17 215919.png",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/Screenshot 2026-05-17 215919.png"),
  },
  {
    id: "bg__Pngtree_pastel_watercolor_gradient_background_with_16657211_jpg",
    name: "Gradient 11",
    category: "gradient",
    css: "url('/bg/—Pngtree—pastel watercolor gradient background with_16657211.jpg') center/cover",
    url: "/bg/—Pngtree—pastel watercolor gradient background with_16657211.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/bg/—Pngtree—pastel watercolor gradient background with_16657211.jpg"),
  },
  {
    id: "wp_001-desktop",
    name: "Wallpaper 001",
    category: "wallpaper",
    css: "url('/thumbnails/001-desktop.jpg') center/cover",
    url: "/thumbnails/001-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/001-desktop.jpg"),
  },
  {
    id: "wp_002-desktop",
    name: "Wallpaper 002",
    category: "wallpaper",
    css: "url('/thumbnails/002-desktop.jpg') center/cover",
    url: "/thumbnails/002-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/002-desktop.jpg"),
  },
  {
    id: "wp_003-desktop",
    name: "Wallpaper 003",
    category: "wallpaper",
    css: "url('/thumbnails/003-desktop.jpg') center/cover",
    url: "/thumbnails/003-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/003-desktop.jpg"),
  },
  {
    id: "wp_004-desktop",
    name: "Wallpaper 004",
    category: "wallpaper",
    css: "url('/thumbnails/004-desktop.jpg') center/cover",
    url: "/thumbnails/004-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/004-desktop.jpg"),
  },
  {
    id: "wp_005-desktop",
    name: "Wallpaper 005",
    category: "wallpaper",
    css: "url('/thumbnails/005-desktop.jpg') center/cover",
    url: "/thumbnails/005-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/005-desktop.jpg"),
  },
  {
    id: "wp_006-desktop",
    name: "Wallpaper 006",
    category: "wallpaper",
    css: "url('/thumbnails/006-desktop.jpg') center/cover",
    url: "/thumbnails/006-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/006-desktop.jpg"),
  },
  {
    id: "wp_007-desktop",
    name: "Wallpaper 007",
    category: "wallpaper",
    css: "url('/thumbnails/007-desktop.jpg') center/cover",
    url: "/thumbnails/007-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/007-desktop.jpg"),
  },
  {
    id: "wp_008-desktop",
    name: "Wallpaper 008",
    category: "wallpaper",
    css: "url('/thumbnails/008-desktop.jpg') center/cover",
    url: "/thumbnails/008-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/008-desktop.jpg"),
  },
  {
    id: "wp_009-desktop",
    name: "Wallpaper 009",
    category: "wallpaper",
    css: "url('/thumbnails/009-desktop.jpg') center/cover",
    url: "/thumbnails/009-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/009-desktop.jpg"),
  },
  {
    id: "wp_010-desktop",
    name: "Wallpaper 010",
    category: "wallpaper",
    css: "url('/thumbnails/010-desktop.jpg') center/cover",
    url: "/thumbnails/010-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/010-desktop.jpg"),
  },
  {
    id: "wp_011-desktop",
    name: "Wallpaper 011",
    category: "wallpaper",
    css: "url('/thumbnails/011-desktop.jpg') center/cover",
    url: "/thumbnails/011-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/011-desktop.jpg"),
  },
  {
    id: "wp_012-desktop",
    name: "Wallpaper 012",
    category: "wallpaper",
    css: "url('/thumbnails/012-desktop.jpg') center/cover",
    url: "/thumbnails/012-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/012-desktop.jpg"),
  },
  {
    id: "wp_013-desktop",
    name: "Wallpaper 013",
    category: "wallpaper",
    css: "url('/thumbnails/013-desktop.jpg') center/cover",
    url: "/thumbnails/013-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/013-desktop.jpg"),
  },
  {
    id: "wp_014-desktop",
    name: "Wallpaper 014",
    category: "wallpaper",
    css: "url('/thumbnails/014-desktop.jpg') center/cover",
    url: "/thumbnails/014-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/014-desktop.jpg"),
  },
  {
    id: "wp_015-desktop",
    name: "Wallpaper 015",
    category: "wallpaper",
    css: "url('/thumbnails/015-desktop.jpg') center/cover",
    url: "/thumbnails/015-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/015-desktop.jpg"),
  },
  {
    id: "wp_016-desktop",
    name: "Wallpaper 016",
    category: "wallpaper",
    css: "url('/thumbnails/016-desktop.jpg') center/cover",
    url: "/thumbnails/016-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/016-desktop.jpg"),
  },
  {
    id: "wp_017-desktop",
    name: "Wallpaper 017",
    category: "wallpaper",
    css: "url('/thumbnails/017-desktop.jpg') center/cover",
    url: "/thumbnails/017-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/017-desktop.jpg"),
  },
  {
    id: "wp_018-desktop",
    name: "Wallpaper 018",
    category: "wallpaper",
    css: "url('/thumbnails/018-desktop.jpg') center/cover",
    url: "/thumbnails/018-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/018-desktop.jpg"),
  },
  {
    id: "wp_019-desktop",
    name: "Wallpaper 019",
    category: "wallpaper",
    css: "url('/thumbnails/019-desktop.jpg') center/cover",
    url: "/thumbnails/019-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/019-desktop.jpg"),
  },
  {
    id: "wp_020-desktop",
    name: "Wallpaper 020",
    category: "wallpaper",
    css: "url('/thumbnails/020-desktop.jpg') center/cover",
    url: "/thumbnails/020-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/020-desktop.jpg"),
  },
  {
    id: "wp_021-desktop",
    name: "Wallpaper 021",
    category: "wallpaper",
    css: "url('/thumbnails/021-desktop.jpg') center/cover",
    url: "/thumbnails/021-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/021-desktop.jpg"),
  },
  {
    id: "wp_022-desktop",
    name: "Wallpaper 022",
    category: "wallpaper",
    css: "url('/thumbnails/022-desktop.jpg') center/cover",
    url: "/thumbnails/022-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/022-desktop.jpg"),
  },
  {
    id: "wp_023-desktop",
    name: "Wallpaper 023",
    category: "wallpaper",
    css: "url('/thumbnails/023-desktop.jpg') center/cover",
    url: "/thumbnails/023-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/023-desktop.jpg"),
  },
  {
    id: "wp_024-desktop",
    name: "Wallpaper 024",
    category: "wallpaper",
    css: "url('/thumbnails/024-desktop.jpg') center/cover",
    url: "/thumbnails/024-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/024-desktop.jpg"),
  },
  {
    id: "wp_025-desktop",
    name: "Wallpaper 025",
    category: "wallpaper",
    css: "url('/thumbnails/025-desktop.jpg') center/cover",
    url: "/thumbnails/025-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/025-desktop.jpg"),
  },
  {
    id: "wp_026-desktop",
    name: "Wallpaper 026",
    category: "wallpaper",
    css: "url('/thumbnails/026-desktop.jpg') center/cover",
    url: "/thumbnails/026-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/026-desktop.jpg"),
  },
  {
    id: "wp_027-desktop",
    name: "Wallpaper 027",
    category: "wallpaper",
    css: "url('/thumbnails/027-desktop.jpg') center/cover",
    url: "/thumbnails/027-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/027-desktop.jpg"),
  },
  {
    id: "wp_028-desktop",
    name: "Wallpaper 028",
    category: "wallpaper",
    css: "url('/thumbnails/028-desktop.jpg') center/cover",
    url: "/thumbnails/028-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/028-desktop.jpg"),
  },
  {
    id: "wp_029-desktop",
    name: "Wallpaper 029",
    category: "wallpaper",
    css: "url('/thumbnails/029-desktop.jpg') center/cover",
    url: "/thumbnails/029-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/029-desktop.jpg"),
  },
  {
    id: "wp_030-desktop",
    name: "Wallpaper 030",
    category: "wallpaper",
    css: "url('/thumbnails/030-desktop.jpg') center/cover",
    url: "/thumbnails/030-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/030-desktop.jpg"),
  },
  {
    id: "wp_031-desktop",
    name: "Wallpaper 031",
    category: "wallpaper",
    css: "url('/thumbnails/031-desktop.jpg') center/cover",
    url: "/thumbnails/031-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/031-desktop.jpg"),
  },
  {
    id: "wp_032-desktop",
    name: "Wallpaper 032",
    category: "wallpaper",
    css: "url('/thumbnails/032-desktop.jpg') center/cover",
    url: "/thumbnails/032-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/032-desktop.jpg"),
  },
  {
    id: "wp_033-desktop",
    name: "Wallpaper 033",
    category: "wallpaper",
    css: "url('/thumbnails/033-desktop.jpg') center/cover",
    url: "/thumbnails/033-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/033-desktop.jpg"),
  },
  {
    id: "wp_034-desktop",
    name: "Wallpaper 034",
    category: "wallpaper",
    css: "url('/thumbnails/034-desktop.jpg') center/cover",
    url: "/thumbnails/034-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/034-desktop.jpg"),
  },
  {
    id: "wp_035-desktop",
    name: "Wallpaper 035",
    category: "wallpaper",
    css: "url('/thumbnails/035-desktop.jpg') center/cover",
    url: "/thumbnails/035-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/035-desktop.jpg"),
  },
  {
    id: "wp_036-desktop",
    name: "Wallpaper 036",
    category: "wallpaper",
    css: "url('/thumbnails/036-desktop.jpg') center/cover",
    url: "/thumbnails/036-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/036-desktop.jpg"),
  },
  {
    id: "wp_037-desktop",
    name: "Wallpaper 037",
    category: "wallpaper",
    css: "url('/thumbnails/037-desktop.jpg') center/cover",
    url: "/thumbnails/037-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/037-desktop.jpg"),
  },
  {
    id: "wp_038-desktop",
    name: "Wallpaper 038",
    category: "wallpaper",
    css: "url('/thumbnails/038-desktop.jpg') center/cover",
    url: "/thumbnails/038-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/038-desktop.jpg"),
  },
  {
    id: "wp_039-desktop",
    name: "Wallpaper 039",
    category: "wallpaper",
    css: "url('/thumbnails/039-desktop.jpg') center/cover",
    url: "/thumbnails/039-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/039-desktop.jpg"),
  },
  {
    id: "wp_040-desktop",
    name: "Wallpaper 040",
    category: "wallpaper",
    css: "url('/thumbnails/040-desktop.jpg') center/cover",
    url: "/thumbnails/040-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/040-desktop.jpg"),
  },
  {
    id: "wp_041-desktop",
    name: "Wallpaper 041",
    category: "wallpaper",
    css: "url('/thumbnails/041-desktop.jpg') center/cover",
    url: "/thumbnails/041-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/041-desktop.jpg"),
  },
  {
    id: "wp_042-desktop",
    name: "Wallpaper 042",
    category: "wallpaper",
    css: "url('/thumbnails/042-desktop.jpg') center/cover",
    url: "/thumbnails/042-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/042-desktop.jpg"),
  },
  {
    id: "wp_043-desktop",
    name: "Wallpaper 043",
    category: "wallpaper",
    css: "url('/thumbnails/043-desktop.jpg') center/cover",
    url: "/thumbnails/043-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/043-desktop.jpg"),
  },
  {
    id: "wp_044-desktop",
    name: "Wallpaper 044",
    category: "wallpaper",
    css: "url('/thumbnails/044-desktop.jpg') center/cover",
    url: "/thumbnails/044-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/044-desktop.jpg"),
  },
  {
    id: "wp_045-desktop",
    name: "Wallpaper 045",
    category: "wallpaper",
    css: "url('/thumbnails/045-desktop.jpg') center/cover",
    url: "/thumbnails/045-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/045-desktop.jpg"),
  },
  {
    id: "wp_046-desktop",
    name: "Wallpaper 046",
    category: "wallpaper",
    css: "url('/thumbnails/046-desktop.jpg') center/cover",
    url: "/thumbnails/046-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/046-desktop.jpg"),
  },
  {
    id: "wp_047-desktop",
    name: "Wallpaper 047",
    category: "wallpaper",
    css: "url('/thumbnails/047-desktop.jpg') center/cover",
    url: "/thumbnails/047-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/047-desktop.jpg"),
  },
  {
    id: "wp_048-desktop",
    name: "Wallpaper 048",
    category: "wallpaper",
    css: "url('/thumbnails/048-desktop.jpg') center/cover",
    url: "/thumbnails/048-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/048-desktop.jpg"),
  },
  {
    id: "wp_049-desktop",
    name: "Wallpaper 049",
    category: "wallpaper",
    css: "url('/thumbnails/049-desktop.jpg') center/cover",
    url: "/thumbnails/049-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/049-desktop.jpg"),
  },
  {
    id: "wp_050-desktop",
    name: "Wallpaper 050",
    category: "wallpaper",
    css: "url('/thumbnails/050-desktop.jpg') center/cover",
    url: "/thumbnails/050-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/050-desktop.jpg"),
  },
  {
    id: "wp_051-desktop",
    name: "Wallpaper 051",
    category: "wallpaper",
    css: "url('/thumbnails/051-desktop.jpg') center/cover",
    url: "/thumbnails/051-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/051-desktop.jpg"),
  },
  {
    id: "wp_052-desktop",
    name: "Wallpaper 052",
    category: "wallpaper",
    css: "url('/thumbnails/052-desktop.jpg') center/cover",
    url: "/thumbnails/052-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/052-desktop.jpg"),
  },
  {
    id: "wp_053-desktop",
    name: "Wallpaper 053",
    category: "wallpaper",
    css: "url('/thumbnails/053-desktop.jpg') center/cover",
    url: "/thumbnails/053-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/053-desktop.jpg"),
  },
  {
    id: "wp_054-desktop",
    name: "Wallpaper 054",
    category: "wallpaper",
    css: "url('/thumbnails/054-desktop.jpg') center/cover",
    url: "/thumbnails/054-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/054-desktop.jpg"),
  },
  {
    id: "wp_055-desktop",
    name: "Wallpaper 055",
    category: "wallpaper",
    css: "url('/thumbnails/055-desktop.jpg') center/cover",
    url: "/thumbnails/055-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/055-desktop.jpg"),
  },
  {
    id: "wp_056-desktop",
    name: "Wallpaper 056",
    category: "wallpaper",
    css: "url('/thumbnails/056-desktop.jpg') center/cover",
    url: "/thumbnails/056-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/056-desktop.jpg"),
  },
  {
    id: "wp_057-desktop",
    name: "Wallpaper 057",
    category: "wallpaper",
    css: "url('/thumbnails/057-desktop.jpg') center/cover",
    url: "/thumbnails/057-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/057-desktop.jpg"),
  },
  {
    id: "wp_058-desktop",
    name: "Wallpaper 058",
    category: "wallpaper",
    css: "url('/thumbnails/058-desktop.jpg') center/cover",
    url: "/thumbnails/058-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/058-desktop.jpg"),
  },
  {
    id: "wp_059-desktop",
    name: "Wallpaper 059",
    category: "wallpaper",
    css: "url('/thumbnails/059-desktop.jpg') center/cover",
    url: "/thumbnails/059-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/059-desktop.jpg"),
  },
  {
    id: "wp_060-desktop",
    name: "Wallpaper 060",
    category: "wallpaper",
    css: "url('/thumbnails/060-desktop.jpg') center/cover",
    url: "/thumbnails/060-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/060-desktop.jpg"),
  },
  {
    id: "wp_061-desktop",
    name: "Wallpaper 061",
    category: "wallpaper",
    css: "url('/thumbnails/061-desktop.jpg') center/cover",
    url: "/thumbnails/061-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/061-desktop.jpg"),
  },
  {
    id: "wp_062-desktop",
    name: "Wallpaper 062",
    category: "wallpaper",
    css: "url('/thumbnails/062-desktop.jpg') center/cover",
    url: "/thumbnails/062-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/062-desktop.jpg"),
  },
  {
    id: "wp_063-desktop",
    name: "Wallpaper 063",
    category: "wallpaper",
    css: "url('/thumbnails/063-desktop.jpg') center/cover",
    url: "/thumbnails/063-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/063-desktop.jpg"),
  },
  {
    id: "wp_064-desktop",
    name: "Wallpaper 064",
    category: "wallpaper",
    css: "url('/thumbnails/064-desktop.jpg') center/cover",
    url: "/thumbnails/064-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/064-desktop.jpg"),
  },
  {
    id: "wp_065-desktop",
    name: "Wallpaper 065",
    category: "wallpaper",
    css: "url('/thumbnails/065-desktop.jpg') center/cover",
    url: "/thumbnails/065-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/065-desktop.jpg"),
  },
  {
    id: "wp_066-desktop",
    name: "Wallpaper 066",
    category: "wallpaper",
    css: "url('/thumbnails/066-desktop.jpg') center/cover",
    url: "/thumbnails/066-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/066-desktop.jpg"),
  },
  {
    id: "wp_067-desktop",
    name: "Wallpaper 067",
    category: "wallpaper",
    css: "url('/thumbnails/067-desktop.jpg') center/cover",
    url: "/thumbnails/067-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/067-desktop.jpg"),
  },
  {
    id: "wp_068-desktop",
    name: "Wallpaper 068",
    category: "wallpaper",
    css: "url('/thumbnails/068-desktop.jpg') center/cover",
    url: "/thumbnails/068-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/068-desktop.jpg"),
  },
  {
    id: "wp_069-desktop",
    name: "Wallpaper 069",
    category: "wallpaper",
    css: "url('/thumbnails/069-desktop.jpg') center/cover",
    url: "/thumbnails/069-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/069-desktop.jpg"),
  },
  {
    id: "wp_070-desktop",
    name: "Wallpaper 070",
    category: "wallpaper",
    css: "url('/thumbnails/070-desktop.jpg') center/cover",
    url: "/thumbnails/070-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/070-desktop.jpg"),
  },
  {
    id: "wp_071-desktop",
    name: "Wallpaper 071",
    category: "wallpaper",
    css: "url('/thumbnails/071-desktop.jpg') center/cover",
    url: "/thumbnails/071-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/071-desktop.jpg"),
  },
  {
    id: "wp_072-desktop",
    name: "Wallpaper 072",
    category: "wallpaper",
    css: "url('/thumbnails/072-desktop.jpg') center/cover",
    url: "/thumbnails/072-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/072-desktop.jpg"),
  },
  {
    id: "wp_073-desktop",
    name: "Wallpaper 073",
    category: "wallpaper",
    css: "url('/thumbnails/073-desktop.jpg') center/cover",
    url: "/thumbnails/073-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/073-desktop.jpg"),
  },
  {
    id: "wp_074-desktop",
    name: "Wallpaper 074",
    category: "wallpaper",
    css: "url('/thumbnails/074-desktop.jpg') center/cover",
    url: "/thumbnails/074-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/074-desktop.jpg"),
  },
  {
    id: "wp_081-desktop",
    name: "Wallpaper 081",
    category: "wallpaper",
    css: "url('/thumbnails/081-desktop.jpg') center/cover",
    url: "/thumbnails/081-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/081-desktop.jpg"),
  },
  {
    id: "wp_082-desktop",
    name: "Wallpaper 082",
    category: "wallpaper",
    css: "url('/thumbnails/082-desktop.jpg') center/cover",
    url: "/thumbnails/082-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/082-desktop.jpg"),
  },
  {
    id: "wp_083-desktop",
    name: "Wallpaper 083",
    category: "wallpaper",
    css: "url('/thumbnails/083-desktop.jpg') center/cover",
    url: "/thumbnails/083-desktop.jpg",
    paint: (ctx, w, h) => image(ctx, w, h, "/wallpapers/083-desktop.jpg"),
  },
];

/** IDs of Raycast-style mesh wallpapers, used by the editor for grouping. */
export const RAYCAST_BG_IDS = [
  "ray_pulse", "ray_glass", "ray_sunset", "ray_mint", "ray_blossom",
  "ray_ocean", "ray_lava", "ray_aurora2", "ray_candy", "ray_void",
  "ray_solar", "ray_iris",
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