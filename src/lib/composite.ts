import type { ZoomKeyframe } from "./autoZoom";
import type { Background, FrameStyle, Subtitle } from "./backgrounds";

export interface CompositeOptions {
  background: Background;
  frame: FrameStyle;
  subtitles?: Subtitle[];
  currentTime?: number;
  /** source video natural size */
  srcW: number;
  srcH: number;
  /** output canvas size */
  outW: number;
  outH: number;
  /** PIP camera element */
  camera?: HTMLVideoElement | HTMLCanvasElement;
  /** PIP position normalized 0..1 (default 0.9, 0.9) */
  cameraX?: number;
  cameraY?: number;
  /** PIP size (fraction of output width, default 0.15) */
  cameraSize?: number;
  cameraShape?: "circle" | "square" | "rounded";
  /** Zoom level for the PIP camera (default 1.0) */
  cameraZoom?: number;
  /** Mouse movement data for custom cursor */
  mouseMoves?: { t: number, x: number, y: number }[];
  /** Whether to show the designer cursor */
  showCursor?: boolean;
}


/**
 * Draw one frame: background fill + zoomed/cropped video inset with rounded
 * corners and shadow. Pure function of the canvas + a video element + a
 * zoom keyframe.
 */
export function drawComposite(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | HTMLCanvasElement,
  kf: ZoomKeyframe,
  opts: CompositeOptions,
) {
  const { background, frame, srcW, srcH, outW, outH } = opts;

  // 1) Background fill
  background.paint(ctx, outW, outH);

  // 2) Inset target rect (video panel after padding)
  const padX = outW * frame.padding;
  const padY = outH * frame.padding;
  const availableW = outW - padX * 2;
  const availableH = outH - padY * 2;
  
  const videoAspect = srcW / srcH;
  const targetAspect = availableW / availableH;
  
  let targetW, targetH;
  if (videoAspect > targetAspect) {
    targetW = availableW;
    targetH = availableW / videoAspect;
  } else {
    targetH = availableH;
    targetW = availableH * videoAspect;
  }
  
  const targetX = padX + (availableW - targetW) / 2;
  const targetY = padY + (availableH - targetH) / 2;
  
  // 3) Source rect from zoom keyframe (crop window inside source)
  const sw = srcW / kf.scale;
  const sh = srcH / kf.scale;
  let sx = kf.x * srcW - sw / 2;
  let sy = kf.y * srcH - sh / 2;
  sx = Math.max(0, Math.min(srcW - sw, sx));
  sy = Math.max(0, Math.min(srcH - sh, sy));

  // Scale UI values (radius, shadow) relative to a baseline width of 1280px
  const scaleRatio = outW / 1280;
  const scaledRadius = frame.radius * scaleRatio;
  const scaledShadow = frame.shadow * scaleRatio;

  // 4) Rounded clip + shadow
  ctx.save();
  if (scaledShadow > 0) {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = scaledShadow;
    ctx.shadowOffsetY = scaledShadow * 0.4;
  }
  ctx.fillStyle = "#000";
  roundedRectPath(ctx, targetX, targetY, targetW, targetH, scaledRadius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, targetX, targetY, targetW, targetH, scaledRadius);
  ctx.clip();
  ctx.drawImage(video, sx, sy, sw, sh, targetX, targetY, targetW, targetH);
  ctx.restore();

  // 5) Subtitles
  if (opts.subtitles && opts.currentTime !== undefined) {
    const sub = opts.subtitles.find(
      (s) => opts.currentTime! >= s.start && opts.currentTime! <= s.end,
    );
    if (sub) {
      ctx.save();
      const fontSize = Math.round(outH * 0.042);
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      const paddingH = fontSize * 0.8;
      const paddingV = fontSize * 0.4;
      const textW = ctx.measureText(sub.text).width;

      const subX = outW / 2;
      const subY = targetY + targetH - fontSize * 1.5;

      // Pill background
      ctx.fillStyle = "rgba(0,0,0,0.8)";
      ctx.beginPath();
      const bx = subX - textW / 2 - paddingH;
      const by = subY - fontSize;
      const bw = textW + paddingH * 2;
      const bh = fontSize + paddingV * 2;
      const br = bh / 2;
      ctx.moveTo(bx + br, by);
      ctx.lineTo(bx + bw - br, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
      ctx.lineTo(bx + bw, by + bh - br);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
      ctx.lineTo(bx + br, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
      ctx.lineTo(bx, by + br);
      ctx.quadraticCurveTo(bx, by, bx + br, by);
      ctx.fill();

      // Text
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(sub.text, subX, subY - fontSize / 2 + paddingV);
      ctx.restore();
    }
  }

  // 6) Designer Cursor
  if (opts.showCursor && opts.mouseMoves) {
    drawDesignerCursor(ctx, opts.mouseMoves, opts.currentTime ?? 0, targetX, targetY, targetW, targetH, kf);
  }

  // 7) PIP Camera
  if (opts.camera) {
    ctx.save();
    const pipSize = outW * (opts.cameraSize ?? 0.15);
    const cx = opts.cameraX ?? 0.85;
    const cy = opts.cameraY ?? 0.85;
    
    let px = cx * outW - pipSize / 2;
    let py = cy * outH - pipSize / 2;

    px = Math.max(0, Math.min(outW - pipSize, px));
    py = Math.max(0, Math.min(outH - pipSize, py));

    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 15 * scaleRatio;
    ctx.shadowOffsetY = 5 * scaleRatio;

    ctx.beginPath();
    const shape = opts.cameraShape ?? "circle";
    if (shape === "circle") {
      ctx.arc(px + pipSize / 2, py + pipSize / 2, pipSize / 2, 0, Math.PI * 2);
    } else if (shape === "rounded") {
      roundedRectPath(ctx, px, py, pipSize, pipSize, pipSize * 0.2);
    } else {
      ctx.rect(px, py, pipSize, pipSize);
    }
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.clip();

    const cw = opts.camera.width || (opts.camera as any).videoWidth || 320;
    const ch = opts.camera.height || (opts.camera as any).videoHeight || 240;
    const zoom = opts.cameraZoom ?? 1.0;
    const cSize = Math.min(cw, ch) / zoom;
    const csx = (cw - cSize) / 2;
    const csy = (ch - cSize) / 2;

    ctx.drawImage(opts.camera, csx, csy, cSize, cSize, px, py, pipSize, pipSize);
    
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 3 * scaleRatio;
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(px + pipSize / 2, py + pipSize / 2, pipSize / 2, 0, Math.PI * 2);
    } else if (shape === "rounded") {
      roundedRectPath(ctx, px, py, pipSize, pipSize, pipSize * 0.2);
    } else {
      ctx.rect(px, py, pipSize, pipSize);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawDesignerCursor(
  ctx: CanvasRenderingContext2D,
  moves: { t: number, x: number, y: number }[],
  t: number,
  panelX: number,
  panelY: number,
  panelW: number,
  panelH: number,
  kf: ZoomKeyframe
) {
  let x, y;

  // 1. Determine Position (Real Data vs. Cinematic Fallback)
  if (moves.length > 0) {
    // Standard Interpolation
    let lo = 0, hi = moves.length - 1;
    if (t <= moves[0].t) { lo = 0; hi = 0; }
    else if (t >= moves[hi].t) { lo = hi; hi = hi; }
    else {
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (moves[mid].t <= t) lo = mid; else hi = mid;
      }
    }
    const a = moves[lo];
    const b = moves[hi];
    const span = b.t - a.t;
    if (span < 0.001) {
      x = a.x; y = a.y;
    } else {
      const r = (t - a.t) / span;
      x = a.x + (b.x - a.x) * r;
      y = a.y + (b.y - a.y) * r;
    }
  } else {
    // Fallback: If no mouse data, follow the focus
    x = kf.x;
    y = kf.y;
  }

  const zoomX = (x - kf.x) * kf.scale + 0.5;
  const zoomY = (y - kf.y) * kf.scale + 0.5;

  const screenX = panelX + zoomX * panelW;
  const screenY = panelY + zoomY * panelH;

  ctx.save();
  ctx.translate(screenX, screenY);
  
  // Spotlight
  const aura = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
  aura.addColorStop(0, "rgba(255, 255, 255, 0.25)");
  aura.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 0, 30, 0, Math.PI * 2);
  ctx.fill();

  // Vector Body
  ctx.scale(2.2, 2.2); 
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 5;
  
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(5, 14);
  ctx.lineTo(9, 22);
  ctx.lineTo(11, 21);
  ctx.lineTo(7, 13);
  ctx.lineTo(13, 13);
  ctx.closePath();
  
  ctx.fillStyle = "black";
  ctx.fill();
  
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Active Tip
  ctx.fillStyle = "#3b82f6"; 
  ctx.beginPath();
  ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
