import type { ZoomKeyframe } from "./autoZoom";
import type { Background, FrameStyle } from "./backgrounds";

export interface CompositeOptions {
  background: Background;
  frame: FrameStyle;
  /** source video natural size */
  srcW: number;
  srcH: number;
  /** output canvas size */
  outW: number;
  outH: number;
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
  const targetW = outW - padX * 2;
  const targetH = outH - padY * 2;
  const targetX = padX;
  const targetY = padY;

  // 3) Source rect from zoom keyframe (crop window inside source)
  const sw = srcW / kf.scale;
  const sh = srcH / kf.scale;
  let sx = kf.x * srcW - sw / 2;
  let sy = kf.y * srcH - sh / 2;
  sx = Math.max(0, Math.min(srcW - sw, sx));
  sy = Math.max(0, Math.min(srcH - sh, sy));

  // 4) Rounded clip + shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = frame.shadow;
  ctx.shadowOffsetY = frame.shadow * 0.4;
  ctx.fillStyle = "#000";
  roundedRectPath(ctx, targetX, targetY, targetW, targetH, frame.radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, targetX, targetY, targetW, targetH, frame.radius);
  ctx.clip();
  ctx.drawImage(video, sx, sy, sw, sh, targetX, targetY, targetW, targetH);
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
