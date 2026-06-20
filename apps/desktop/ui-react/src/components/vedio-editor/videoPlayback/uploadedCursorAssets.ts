import crosshairUrl from "../../../assets/Cursor=Cross.svg";
import arrowUrl from "../../../assets/Cursor=Default.svg";
import closedHandUrl from "../../../assets/Cursor=Hand-(Grabbing).svg";
import openHandUrl from "../../../assets/Cursor=Hand-(Open).svg";
import pointerUrl from "../../../assets/Cursor=Hand-(Pointing).svg";
import resizeNsUrl from "../../../assets/Cursor=Resize-North-South.svg";
import resizeEwUrl from "../../../assets/Cursor=Resize-West-East.svg";
import textUrl from "../../../assets/Cursor=Text-Cursor.svg";
import type { CursorTelemetryPoint } from "../types";

type CursorAssetKey = NonNullable<CursorTelemetryPoint["cursorType"]>;

export type UploadedCursorAsset = {
  url: string;
  trim: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fallbackAnchor: {
    x: number;
    y: number;
  };
};

export const UPLOADED_CURSOR_SAMPLE_SIZE = 1024;

export const uploadedCursorAssets: Partial<Record<CursorAssetKey, UploadedCursorAsset>> = {
  arrow: {
    url: arrowUrl,
    trim: { x: 130, y: 115, width: 790, height: 840 },
    fallbackAnchor: { x: 0.11, y: 0.07 },
  },
  normal: {
    url: "/cursor.svg",
    trim: { x: 0, y: 0, width: 1024, height: 1024 },
    fallbackAnchor: { x: 0.1, y: 0.0714 },
  },
  text: {
    url: textUrl,
    trim: { x: 404, y: 192, width: 247, height: 596 },
    fallbackAnchor: { x: 0.5, y: 0.5 },
  },
  pointer: {
    url: pointerUrl,
    trim: { x: 352, y: 441, width: 466, height: 583 },
    fallbackAnchor: { x: 0.37, y: 0.08 },
  },
  crosshair: {
    url: crosshairUrl,
    trim: { x: 288, y: 288, width: 480, height: 480 },
    fallbackAnchor: { x: 0.5, y: 0.5 },
  },
  "open-hand": {
    url: openHandUrl,
    trim: { x: 288, y: 188, width: 512, height: 580 },
    fallbackAnchor: { x: 0.5, y: 0.28 },
  },
  "closed-hand": {
    url: closedHandUrl,
    trim: { x: 344, y: 365, width: 432, height: 403 },
    fallbackAnchor: { x: 0.5, y: 0.28 },
  },
  "resize-ew": {
    url: resizeEwUrl,
    trim: { x: 187, y: 384, width: 669, height: 270 },
    fallbackAnchor: { x: 0.5, y: 0.5 },
  },
  "resize-ns": {
    url: resizeNsUrl,
    trim: { x: 376, y: 178, width: 271, height: 669 },
    fallbackAnchor: { x: 0.5, y: 0.5 },
  },
};
