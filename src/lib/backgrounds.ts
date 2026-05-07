// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

// Grain cache — keyed by dimensions + alpha so we never re-generate
const _grainCache = new Map<string, HTMLCanvasElement>();
const grain = (ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 8) => {
  if (alpha <= 0) return;
  const key = `${w}-${h}-${alpha}`;
  let gc = _grainCache.get(key);
  if (!gc) {
    gc = document.createElement("canvas");
    gc.width = w;
    gc.height = h;
    const gctx = gc.getContext("2d")!;
    const id = gctx.createImageData(w, h);
    const buf = id.data;
    let seed = 0xdeadbeef;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
    for (let i = 0; i < buf.length; i += 4) {
      const v = (rng() * 255) | 0;
      buf[i] = buf[i + 1] = buf[i + 2] = v;
      buf[i + 3] = alpha;
    }
    gctx.putImageData(id, 0, 0);
    _grainCache.set(key, gc);
  }
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(gc, 0, 0);
  ctx.restore();
};

const darkGlow = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  glows: { cx: number; cy: number; color: string; rf: number }[],
  grainAlpha = 8,
) => {
  solid(ctx, w, h, base);
  for (const g of glows) radialGlow(ctx, w, h, g.cx, g.cy, g.color, g.rf);
  grain(ctx, w, h, grainAlpha);
};

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
  for (const b of blobs) radialGlow(ctx, w, h, b.cx, b.cy, b.color, b.r);
  ctx.globalCompositeOperation = prev;
  if (grainAlpha > 0) grain(ctx, w, h, grainAlpha);
};

// Image painter with cover-fit + cache
export const _imgCache: Record<string, HTMLImageElement> = {};
const paintImage = (ctx: CanvasRenderingContext2D, w: number, h: number, url: string) => {
  let img = _imgCache[url];
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    _imgCache[url] = img;
  }
  if (img.complete && img.naturalWidth > 0) {
    const ia = img.naturalWidth / img.naturalHeight;
    const ca = w / h;
    let dw = w, dh = h, ox = 0, oy = 0;
    if (ca > ia) { dh = w / ia; oy = (h - dh) / 2; }
    else         { dw = h * ia; ox = (w - dw) / 2; }
    ctx.drawImage(img, ox, oy, dw, dh);
  } else {
    solid(ctx, w, h, "#111");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CSS swatch helpers
// ─────────────────────────────────────────────────────────────────────────────

const swatchRadial = (color: string, base: string) =>
  `radial-gradient(ellipse at 40% 52%, ${color} 0%, ${base} 72%)`;

const swatchDual = (c1: string, c2: string, base: string) =>
  `radial-gradient(ellipse at 26% 50%, ${c1} 0%, ${c2} 48%, ${base} 76%)`;

const swatchMesh = (c1: string, c2: string, c3: string, base: string) =>
  `radial-gradient(ellipse at 20% 70%, ${c1} 0%, transparent 55%), radial-gradient(ellipse at 80% 25%, ${c2} 0%, transparent 55%), radial-gradient(ellipse at 50% 50%, ${c3} 0%, ${base} 80%)`;

// ─────────────────────────────────────────────────────────────────────────────
// Unsplash scene image URLs (free, no auth, 1600px crops)
// ─────────────────────────────────────────────────────────────────────────────
const UNSPLASH = {
  office:    "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=85&fit=crop",
  studio:    "https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1600&q=85&fit=crop",
  boardroom: "https://images.unsplash.com/photo-1511578314322-379afb476865?w=1600&q=85&fit=crop",
  library:   "https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1600&q=85&fit=crop",
  mountain:  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=85&fit=crop",
  techroom:  "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1600&q=85&fit=crop",
  luxury:    "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1600&q=85&fit=crop",
  nightcity: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1600&q=85&fit=crop",
};

// ─────────────────────────────────────────────────────────────────────────────
// Background catalogue
// Every entry now has a `category` field — required by BackgroundCategory type
// ─────────────────────────────────────────────────────────────────────────────

export const BACKGROUNDS: Background[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // WALLPAPER — rich mesh multi-colour (Raycast-style)
  // ══════════════════════════════════════════════════════════════════════════

  { id:"w_flare",     category:"wallpaper", name:"Flare",
    css: swatchMesh("rgba(160,0,255,.7)","rgba(255,60,0,.7)","rgba(200,0,150,.4)","#0a0010"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#0a0010",[
      {cx:.20,cy:.80,r:.60,color:"rgba(160,0,255,.80)"},{cx:.80,cy:.20,r:.55,color:"rgba(255,60,0,.70)"},{cx:.50,cy:.50,r:.40,color:"rgba(200,0,150,.30)"}])},
  { id:"w_horizon",   category:"wallpaper", name:"Horizon",
    css: swatchMesh("rgba(0,200,160,.7)","rgba(0,80,255,.7)","rgba(0,180,100,.3)","#000a08"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#000a08",[
      {cx:.15,cy:.85,r:.60,color:"rgba(0,200,160,.80)"},{cx:.82,cy:.15,r:.55,color:"rgba(0,80,255,.70)"},{cx:.50,cy:.50,r:.38,color:"rgba(0,180,100,.25)"}])},
  { id:"w_nebula",    category:"wallpaper", name:"Nebula",
    css: swatchMesh("rgba(120,0,255,.7)","rgba(255,0,120,.7)","rgba(180,0,200,.3)","#04000a"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#04000a",[
      {cx:.25,cy:.65,r:.58,color:"rgba(120,0,255,.80)"},{cx:.78,cy:.28,r:.52,color:"rgba(255,0,120,.70)"},{cx:.50,cy:.50,r:.38,color:"rgba(180,0,200,.25)"}])},
  { id:"w_ember",     category:"wallpaper", name:"Ember",
    css: swatchMesh("rgba(255,80,0,.8)","rgba(220,160,0,.7)","rgba(200,40,0,.3)","#0a0200"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#0a0200",[
      {cx:.20,cy:.75,r:.58,color:"rgba(255,80,0,.85)"},{cx:.80,cy:.20,r:.52,color:"rgba(220,160,0,.70)"},{cx:.50,cy:.50,r:.38,color:"rgba(200,40,0,.25)"}])},
  { id:"w_arctic",    category:"wallpaper", name:"Arctic",
    css: swatchMesh("rgba(0,180,255,.7)","rgba(80,240,255,.6)","rgba(0,120,200,.3)","#000810"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#000810",[
      {cx:.18,cy:.78,r:.58,color:"rgba(0,180,255,.80)"},{cx:.80,cy:.20,r:.52,color:"rgba(80,240,255,.65)"},{cx:.50,cy:.50,r:.38,color:"rgba(0,120,200,.22)"}])},
  { id:"w_forest",    category:"wallpaper", name:"Forest",
    css: swatchMesh("rgba(0,200,80,.7)","rgba(0,220,180,.6)","rgba(0,160,40,.3)","#000a00"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#000a00",[
      {cx:.22,cy:.72,r:.58,color:"rgba(0,200,80,.80)"},{cx:.78,cy:.22,r:.52,color:"rgba(0,220,180,.65)"},{cx:.50,cy:.50,r:.38,color:"rgba(0,160,40,.22)"}])},
  { id:"w_candy",     category:"wallpaper", name:"Candy",
    css: swatchMesh("rgba(255,0,100,.8)","rgba(140,0,255,.7)","rgba(255,80,200,.3)","#06000a"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#06000a",[
      {cx:.18,cy:.50,r:.45,color:"rgba(255,0,100,.85)"},{cx:.75,cy:.50,r:.42,color:"rgba(140,0,255,.80)"},{cx:.45,cy:.20,r:.35,color:"rgba(255,80,200,.30)"}])},
  { id:"w_infrared",  category:"wallpaper", name:"Infrared",
    css: swatchMesh("rgba(220,20,0,.85)","rgba(255,120,0,.75)","rgba(200,0,20,.3)","#080000"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#080000",[
      {cx:.18,cy:.50,r:.45,color:"rgba(220,20,0,.90)"},{cx:.75,cy:.50,r:.42,color:"rgba(255,120,0,.80)"},{cx:.50,cy:.80,r:.35,color:"rgba(200,0,20,.25)"}])},
  { id:"w_galaxy",    category:"wallpaper", name:"Galaxy",
    css: swatchMesh("rgba(80,0,255,.8)","rgba(0,100,255,.7)","rgba(150,60,255,.3)","#000008"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#000008",[
      {cx:.20,cy:.50,r:.45,color:"rgba(80,0,255,.90)"},{cx:.75,cy:.50,r:.42,color:"rgba(0,100,255,.80)"},{cx:.50,cy:.15,r:.35,color:"rgba(150,60,255,.28)"}])},
  { id:"w_jungle",    category:"wallpaper", name:"Jungle",
    css: swatchMesh("rgba(200,160,0,.75)","rgba(0,180,60,.7)","rgba(0,210,180,.3)","#030800"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#030800",[
      {cx:.18,cy:.50,r:.44,color:"rgba(200,160,0,.85)"},{cx:.72,cy:.50,r:.42,color:"rgba(0,180,60,.80)"},{cx:.50,cy:.82,r:.34,color:"rgba(0,210,180,.25)"}])},
  { id:"w_sunrise",   category:"wallpaper", name:"Sunrise",
    css: swatchMesh("rgba(245,60,100,.8)","rgba(225,160,0,.75)","rgba(255,120,50,.3)","#080200"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#080200",[
      {cx:.18,cy:.50,r:.44,color:"rgba(245,60,100,.88)"},{cx:.72,cy:.50,r:.42,color:"rgba(225,160,0,.80)"},{cx:.50,cy:.15,r:.34,color:"rgba(255,120,50,.22)"}])},
  { id:"w_matrix",    category:"wallpaper", name:"Matrix",
    css: swatchMesh("rgba(0,220,180,.75)","rgba(60,220,0,.7)","rgba(0,100,255,.55)","#000a04"),
    paint:(ctx,w,h)=>meshGradient(ctx,w,h,"#000a04",[
      {cx:.18,cy:.50,r:.44,color:"rgba(0,220,180,.85)"},{cx:.72,cy:.50,r:.42,color:"rgba(60,220,0,.78)"},{cx:.82,cy:.72,r:.34,color:"rgba(0,100,255,.60)"}])},

  // ══════════════════════════════════════════════════════════════════════════
  // GRADIENT — dark single + dual glow
  // ══════════════════════════════════════════════════════════════════════════

  { id:"crimson",   category:"gradient", name:"Crimson",
    css: swatchRadial("rgba(210,0,25,0.98)","#080000"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#080000",[
      {cx:.38,cy:.52,color:"rgba(210,0,25,0.98)",rf:.42},{cx:.38,cy:.52,color:"rgba(160,0,15,0.65)",rf:.78},
      {cx:.80,cy:.12,color:"rgba(255,40,40,0.30)",rf:.32},{cx:.10,cy:.88,color:"rgba(120,0,10,0.25)",rf:.30}])},
  { id:"ember_g",   category:"gradient", name:"Ember",
    css: swatchRadial("rgba(235,85,0,0.98)","#060200"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#060200",[
      {cx:.40,cy:.55,color:"rgba(235,85,0,0.98)",rf:.44},{cx:.40,cy:.55,color:"rgba(190,55,0,0.60)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(255,170,0,0.38)",rf:.34},{cx:.08,cy:.80,color:"rgba(150,30,0,0.22)",rf:.28}])},
  { id:"gold",      category:"gradient", name:"Gold",
    css: swatchRadial("rgba(225,165,0,0.98)","#060500"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#060500",[
      {cx:.40,cy:.52,color:"rgba(225,165,0,0.98)",rf:.42},{cx:.40,cy:.52,color:"rgba(175,120,0,0.60)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(255,220,30,0.32)",rf:.32},{cx:.12,cy:.82,color:"rgba(140,80,0,0.20)",rf:.28}])},
  { id:"neon_lime", category:"gradient", name:"Neon Lime",
    css: swatchRadial("rgba(90,225,0,0.98)","#010700"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#010700",[
      {cx:.40,cy:.52,color:"rgba(90,225,0,0.98)",rf:.42},{cx:.40,cy:.52,color:"rgba(55,175,0,0.58)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(150,255,30,0.30)",rf:.32},{cx:.10,cy:.82,color:"rgba(30,130,0,0.20)",rf:.28}])},
  { id:"sapphire",  category:"gradient", name:"Sapphire",
    css: swatchRadial("rgba(25,75,255,0.98)","#00000c"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#00000c",[
      {cx:.38,cy:.52,color:"rgba(25,75,255,0.98)",rf:.44},{cx:.38,cy:.52,color:"rgba(10,45,205,0.65)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(80,140,255,0.35)",rf:.34},{cx:.10,cy:.84,color:"rgba(5,20,140,0.22)",rf:.28}])},
  { id:"arctic_g",  category:"gradient", name:"Arctic",
    css: swatchRadial("rgba(0,205,255,0.98)","#000910"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#000910",[
      {cx:.40,cy:.52,color:"rgba(0,205,255,0.98)",rf:.42},{cx:.40,cy:.52,color:"rgba(0,155,225,0.60)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(100,235,255,0.32)",rf:.32},{cx:.10,cy:.82,color:"rgba(0,80,140,0.20)",rf:.28}])},
  { id:"violet",    category:"gradient", name:"Violet",
    css: swatchRadial("rgba(115,0,255,0.98)","#030010"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#030010",[
      {cx:.38,cy:.52,color:"rgba(115,0,255,0.98)",rf:.44},{cx:.38,cy:.52,color:"rgba(80,0,205,0.65)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(175,70,255,0.32)",rf:.34},{cx:.10,cy:.84,color:"rgba(50,0,150,0.22)",rf:.28}])},
  { id:"amethyst",  category:"gradient", name:"Amethyst",
    css: swatchDual("rgba(170,0,230,0.92)","rgba(230,0,175,0.85)","#05000f"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#05000f",[
      {cx:.25,cy:.48,color:"rgba(170,0,230,0.92)",rf:.40},{cx:.72,cy:.52,color:"rgba(230,0,175,0.85)",rf:.38},
      {cx:.48,cy:.50,color:"rgba(140,0,210,0.25)",rf:.70},{cx:.50,cy:.08,color:"rgba(200,50,255,0.18)",rf:.28}])},
  { id:"rose",      category:"gradient", name:"Rose",
    css: swatchRadial("rgba(245,0,118,0.98)","#090006"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#090006",[
      {cx:.40,cy:.52,color:"rgba(245,0,118,0.98)",rf:.42},{cx:.40,cy:.52,color:"rgba(200,0,88,0.62)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(255,70,155,0.32)",rf:.32},{cx:.10,cy:.82,color:"rgba(140,0,65,0.20)",rf:.28}])},
  { id:"magenta",   category:"gradient", name:"Magenta",
    css: swatchDual("rgba(225,0,205,0.95)","rgba(255,0,155,0.80)","#070007"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#070007",[
      {cx:.28,cy:.50,color:"rgba(225,0,205,0.95)",rf:.40},{cx:.74,cy:.50,color:"rgba(255,0,155,0.80)",rf:.38},
      {cx:.50,cy:.50,color:"rgba(190,0,220,0.22)",rf:.72},{cx:.50,cy:.10,color:"rgba(220,0,180,0.16)",rf:.26}])},
  { id:"teal",      category:"gradient", name:"Teal",
    css: swatchRadial("rgba(0,205,172,0.98)","#000908"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#000908",[
      {cx:.40,cy:.52,color:"rgba(0,205,172,0.98)",rf:.42},{cx:.40,cy:.52,color:"rgba(0,158,138,0.62)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(0,245,205,0.30)",rf:.32},{cx:.10,cy:.82,color:"rgba(0,90,80,0.20)",rf:.28}])},
  { id:"emerald",   category:"gradient", name:"Emerald",
    css: swatchRadial("rgba(0,205,75,0.98)","#000900"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#000900",[
      {cx:.40,cy:.52,color:"rgba(0,205,75,0.98)",rf:.42},{cx:.40,cy:.52,color:"rgba(0,158,55,0.62)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(30,245,100,0.30)",rf:.32},{cx:.10,cy:.82,color:"rgba(0,90,30,0.20)",rf:.28}])},
  { id:"copper",    category:"gradient", name:"Copper",
    css: swatchRadial("rgba(200,95,18,0.98)","#070300"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#070300",[
      {cx:.40,cy:.52,color:"rgba(200,95,18,0.98)",rf:.42},{cx:.40,cy:.52,color:"rgba(165,68,8,0.62)",rf:.80},
      {cx:.82,cy:.14,color:"rgba(245,140,38,0.35)",rf:.32},{cx:.10,cy:.82,color:"rgba(110,40,5,0.22)",rf:.28}])},
  { id:"infrared_g",category:"gradient", name:"Infrared",
    css: swatchDual("rgba(225,20,0,0.95)","rgba(255,95,0,0.88)","#050000"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#050000",[
      {cx:.25,cy:.52,color:"rgba(225,20,0,0.95)",rf:.42},{cx:.72,cy:.48,color:"rgba(255,95,0,0.88)",rf:.40},
      {cx:.48,cy:.50,color:"rgba(200,40,0,0.28)",rf:.75},{cx:.50,cy:.10,color:"rgba(255,60,0,0.18)",rf:.26}])},
  { id:"ocean",     category:"gradient", name:"Ocean Depth",
    css: swatchDual("rgba(0,80,255,0.92)","rgba(0,210,255,0.80)","#000510"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#000510",[
      {cx:.25,cy:.52,color:"rgba(0,80,255,0.92)",rf:.42},{cx:.72,cy:.48,color:"rgba(0,210,255,0.80)",rf:.40},
      {cx:.48,cy:.50,color:"rgba(0,120,220,0.25)",rf:.75},{cx:.50,cy:.08,color:"rgba(80,230,255,0.18)",rf:.28}])},
  { id:"molten",    category:"gradient", name:"Molten",
    css: swatchDual("rgba(220,160,0,0.92)","rgba(220,20,0,0.85)","#080200"),
    paint:(ctx,w,h)=>darkGlow(ctx,w,h,"#080200",[
      {cx:.28,cy:.50,color:"rgba(220,160,0,0.92)",rf:.40},{cx:.72,cy:.50,color:"rgba(220,20,0,0.85)",rf:.38},
      {cx:.50,cy:.50,color:"rgba(200,80,0,0.25)",rf:.72},{cx:.50,cy:.10,color:"rgba(255,200,30,0.18)",rf:.26}])},

  // ══════════════════════════════════════════════════════════════════════════
  // COLOR — solids and neutrals
  // ══════════════════════════════════════════════════════════════════════════

  { id:"black",     category:"color", name:"Black",
    css:"#000000",
    paint:(ctx,w,h)=>{solid(ctx,w,h,"#000000");radialGlow(ctx,w,h,.38,.48,"rgba(30,30,30,.70)",.55);radialGlow(ctx,w,h,.82,.18,"rgba(20,20,20,.30)",.35);grain(ctx,w,h,12)}},
  { id:"obsidian",  category:"color", name:"Obsidian",
    css:"linear-gradient(135deg,#0f0f11 0%,#1a1a2e 50%,#0f0f11 100%)",
    paint:(ctx,w,h)=>{linear(ctx,w,h,[[0,"#0f0f11"],[.5,"#1a1a2e"],[1,"#0d0d0f"]],135);grain(ctx,w,h,8)}},
  { id:"carbon",    category:"color", name:"Carbon",
    css:"linear-gradient(160deg,#1c1c1e 0%,#2c2c2e 100%)",
    paint:(ctx,w,h)=>{linear(ctx,w,h,[[0,"#1c1c1e"],[.45,"#242426"],[1,"#2c2c2e"]],160);grain(ctx,w,h,7)}},
  { id:"deep_space",category:"color", name:"Deep Space",
    css:"radial-gradient(ellipse at 60% 30%,#0c1445,#000000)",
    paint:(ctx,w,h)=>{solid(ctx,w,h,"#000000");radialGlow(ctx,w,h,.60,.28,"rgba(14,30,89,.9)",.65);radialGlow(ctx,w,h,.15,.75,"rgba(30,14,89,.5)",.40);grain(ctx,w,h,11)}},
  { id:"slate",     category:"color", name:"Slate",
    css:"linear-gradient(160deg,#334155 0%,#1e293b 100%)",
    paint:(ctx,w,h)=>{linear(ctx,w,h,[[0,"#334155"],[1,"#1e293b"]],160);grain(ctx,w,h,6)}},
  { id:"white",     category:"color", name:"White",
    css:"radial-gradient(ellipse at 50% 50%,#ffffff 0%,#f0f0f0 100%)",
    paint:(ctx,w,h)=>{solid(ctx,w,h,"#fafafa");radialGlow(ctx,w,h,.5,.5,"rgba(255,255,255,.90)",.55);radialGlow(ctx,w,h,.5,.5,"rgba(200,200,200,.35)",.95);grain(ctx,w,h,4)}},
  { id:"studio",    category:"color", name:"Studio",
    css:"linear-gradient(160deg,#f8fafc 0%,#e2e8f0 100%)",
    paint:(ctx,w,h)=>{linear(ctx,w,h,[[0,"#f8fafc"],[.6,"#f1f5f9"],[1,"#e2e8f0"]],160);grain(ctx,w,h,5)}},
  { id:"warm_white",category:"color", name:"Warm White",
    css:"linear-gradient(135deg,#fefce8 0%,#fef3c7 100%)",
    paint:(ctx,w,h)=>{linear(ctx,w,h,[[0,"#fefce8"],[1,"#fef3c7"]],135);grain(ctx,w,h,4)}},

  // ══════════════════════════════════════════════════════════════════════════
  // IMAGE — premium Unsplash scenes
  // ══════════════════════════════════════════════════════════════════════════

  { id:"scene_office",    category:"image", name:"Dark Office",
    css:`url('${UNSPLASH.office}') center/cover`,       url:UNSPLASH.office,
    paint:(ctx,w,h)=>paintImage(ctx,w,h,UNSPLASH.office)},
  { id:"scene_studio",    category:"image", name:"Studio",
    css:`url('${UNSPLASH.studio}') center/cover`,       url:UNSPLASH.studio,
    paint:(ctx,w,h)=>paintImage(ctx,w,h,UNSPLASH.studio)},
  { id:"scene_boardroom", category:"image", name:"Boardroom",
    css:`url('${UNSPLASH.boardroom}') center/cover`,    url:UNSPLASH.boardroom,
    paint:(ctx,w,h)=>paintImage(ctx,w,h,UNSPLASH.boardroom)},
  { id:"scene_library",   category:"image", name:"Library",
    css:`url('${UNSPLASH.library}') center/cover`,      url:UNSPLASH.library,
    paint:(ctx,w,h)=>paintImage(ctx,w,h,UNSPLASH.library)},
  { id:"scene_mountain",  category:"image", name:"Mountain",
    css:`url('${UNSPLASH.mountain}') center/cover`,     url:UNSPLASH.mountain,
    paint:(ctx,w,h)=>paintImage(ctx,w,h,UNSPLASH.mountain)},
  { id:"scene_techroom",  category:"image", name:"Tech Room",
    css:`url('${UNSPLASH.techroom}') center/cover`,     url:UNSPLASH.techroom,
    paint:(ctx,w,h)=>paintImage(ctx,w,h,UNSPLASH.techroom)},
  { id:"scene_luxury",    category:"image", name:"Luxury",
    css:`url('${UNSPLASH.luxury}') center/cover`,       url:UNSPLASH.luxury,
    paint:(ctx,w,h)=>paintImage(ctx,w,h,UNSPLASH.luxury)},
  { id:"scene_nightcity", category:"image", name:"Night City",
    css:`url('${UNSPLASH.nightcity}') center/cover`,    url:UNSPLASH.nightcity,
    paint:(ctx,w,h)=>paintImage(ctx,w,h,UNSPLASH.nightcity)},
];

// ─────────────────────────────────────────────────────────────────────────────
// Frame styles
// ─────────────────────────────────────────────────────────────────────────────

export interface FrameStyle {
  padding: number;
  radius:  number;
  shadow:  number;
}

export const DEFAULT_FRAME: FrameStyle = {
  padding: 0.06,
  radius:  16,
  shadow:  40,
};