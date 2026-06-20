import { getAssetPath } from "@/lib/assetPath";

export const WALLPAPER_PATHS: readonly string[] = [
  "/wallp/01.jpg",
  "/wallp/02.jpg",
  "/wallp/03.jpg",
  "/wallp/04.jpg",
  "/wallp/05.jpg",
  "/wallp/06.png",
  "/wallp/07.jpg",
  "/wallp/08.jpg",
  "/wallp/09.jpg",
  "/wallp/10.jpg",
  "/wallp/11.jpg",
  "/wallp/12.jpg",
  "/wallp/13.jpg",
  "/wallp/14.jpg",
  "/wallp/15.png",
  "/wallp/16.jpg",
  "/wallp/17.jpg",
  "/wallp/18.png",
  "/wallp/19.jpg",
  "/wallp/wallpaper6.jpg",
  "/wallp/wallpaper10.jpg",
  "/wallp/wallpaper13.jpg",
  "/wallp/wallpaper14.jpg",
  "/wallp/wallpaper16.jpg",
  "/wallp/wallpaper17.jpg",
];

export const WALLPAPER_COUNT = WALLPAPER_PATHS.length;

export const BG_GRADIENT_PATHS: readonly string[] = [
  "/bg/autumnal-peach.png",
  "/bg/blossom-2.png",
  "/bg/blushing-fire.png",
  "/bg/bright-rain.png",
  "/bg/floss.png",
  "/bg/glass-rainbow.png",
  "/bg/good-vibes.png",
  "/bg/moonrise.png",
  "/bg/ray-of-lights.png",
  "/bg/rose-thorn.png",
  "/bg/002-desktop.jpg",
  "/bg/003-desktop.jpg",
  "/bg/004-desktop.jpg",
  "/bg/006-desktop.jpg",
  "/bg/008-desktop.jpg",
  "/bg/010-desktop.jpg",
  "/bg/011-desktop.jpg",
  "/bg/012-desktop.jpg",
  "/bg/016-desktop.jpg",
  "/bg/018-desktop.jpg",
  "/bg/025-desktop.jpg",
  "/bg/029-desktop.jpg",
  "/bg/031-desktop.jpg",
  "/bg/041-desktop.jpg",
  "/bg/054-desktop.jpg",
  "/bg/061-desktop.jpg",
  "/bg/069-desktop.jpg",
];

export const DEFAULT_WALLPAPER = WALLPAPER_PATHS[0];

export type WallpaperClassification =
  | { kind: "color"; value: string }
  | { kind: "gradient"; value: string }
  | { kind: "image"; path: string };

const GRADIENT_RE = /^(repeating-)?(linear|radial|conic)-gradient\(/;
const COLOR_FUNC_RE = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/;
const IMAGE_URL_RE = /^(\/|https?:\/\/|file:\/\/|data:)/;
const ALLOWED_IMAGE_PREFIXES = ["/wallpapers/", "/wallp/", "/bg/"];

function isAllowedBundledImagePath(value: string): boolean {
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return ALLOWED_IMAGE_PREFIXES.some((prefix) => withLeadingSlash.startsWith(prefix));
}

export function classifyWallpaper(value: string): WallpaperClassification {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { kind: "color", value: "#000000" };
  }
  if (trimmed.startsWith("#") || COLOR_FUNC_RE.test(trimmed)) {
    return { kind: "color", value: trimmed };
  }
  if (GRADIENT_RE.test(trimmed)) {
    return { kind: "gradient", value: trimmed };
  }
  if (IMAGE_URL_RE.test(trimmed)) {
    return { kind: "image", path: trimmed };
  }
  if (isAllowedBundledImagePath(trimmed)) {
    return { kind: "image", path: trimmed };
  }
  return { kind: "color", value: trimmed };
}

export class UnsafeImagePrefixError extends Error {
  constructor(prefixes: string[]) {
    super(`Image wallpaper path must live under one of: ${prefixes.join(", ")}`);
    this.name = "UnsafeImagePrefixError";
  }
}

export function resolveImageWallpaperUrl(imagePath: string): string {
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("file://") ||
    imagePath.startsWith("data:")
  ) {
    return imagePath;
  }
  const withLeadingSlash = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
  if (!isAllowedBundledImagePath(withLeadingSlash)) {
    throw new BackgroundLoadError(imagePath, new UnsafeImagePrefixError(ALLOWED_IMAGE_PREFIXES));
  }
  try {
    return getAssetPath(withLeadingSlash.slice(1));
  } catch (cause) {
    if (cause instanceof BackgroundLoadError) throw cause;
    throw new BackgroundLoadError(imagePath, cause);
  }
}

export class BackgroundLoadError extends Error {
  readonly url: string;
  readonly cause?: unknown;

  constructor(url: string, cause?: unknown) {
    super(`Failed to load background image: ${displayBasename(url)}`);
    this.name = "BackgroundLoadError";
    this.url = url;
    this.cause = cause;
  }

  get displayUrl(): string {
    return displayBasename(this.url);
  }
}

function displayBasename(url: string): string {
  if (url.startsWith("data:")) {
    return "data:...";
  }
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "(unknown)";
  } catch {
    const last = url.split("/").filter(Boolean).pop();
    return last ?? "(unknown)";
  }
}
