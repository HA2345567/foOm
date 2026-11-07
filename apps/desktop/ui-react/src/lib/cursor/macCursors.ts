import appStartingUrl from "@/assets/cursors/Cursor=App-Starting.svg";
import crosshairUrl from "@/assets/cursors/Cursor=Cross.svg";
import arrowUrl from "@/assets/cursors/Cursor=Default.svg";
import closedHandUrl from "@/assets/cursors/Cursor=Hand-(Grabbing).svg";
import openHandUrl from "@/assets/cursors/Cursor=Hand-(Open).svg";
import pointerUrl from "@/assets/cursors/Cursor=Hand-(Pointing).svg";
import helpUrl from "@/assets/cursors/Cursor=Help.svg";
import moveUrl from "@/assets/cursors/Cursor=Move.svg";
import notAllowedUrl from "@/assets/cursors/Cursor=Not-Allowed.svg";
import resizeNeswUrl from "@/assets/cursors/Cursor=Resize-North-East-South-West.svg";
import resizeNsUrl from "@/assets/cursors/Cursor=Resize-North-South.svg";
import resizeNwseUrl from "@/assets/cursors/Cursor=Resize-North-West-South-East.svg";
import resizeEwUrl from "@/assets/cursors/Cursor=Resize-West-East.svg";
import textUrl from "@/assets/cursors/Cursor=Text-Cursor.svg";
import upArrowUrl from "@/assets/cursors/Cursor=Up-Arrow.svg";
import waitUrl from "@/assets/cursors/Cursor=Wait.svg";
import beachballUrl from "@/assets/cursors/Cursor=Beachball.svg";
import zoom_inUrl from "@/assets/cursors/Cursor=Zoom-In.svg";
import zoom_outUrl from "@/assets/cursors/Cursor=Zoom-Out.svg";
import resize_leftUrl from "@/assets/cursors/Cursor=Resize-(Left).svg";
import resize_rightUrl from "@/assets/cursors/Cursor=Resize-(Right).svg";
import resize_upUrl from "@/assets/cursors/Cursor=Resize-(Up).svg";
import split_horizontalUrl from "@/assets/cursors/Cursor=Resize-(Left-Right).svg";
import split_verticalUrl from "@/assets/cursors/Cursor=Resize-(Up-Down).svg";
import arrowWhiteUrl from "@/assets/cursors/Cursor=Arrow-White.svg";
import arrowBlueUrl from "@/assets/cursors/Cursor=Arrow-Blue.svg";
import arrowVioletUrl from "@/assets/cursors/Cursor=Arrow-Violet.svg";
import arrowTealUrl from "@/assets/cursors/Cursor=Arrow-Teal.svg";
import arrowCoralUrl from "@/assets/cursors/Cursor=Arrow-Coral.svg";
import arrowAmberUrl from "@/assets/cursors/Cursor=Arrow-Amber.svg";
import arrowFigmaUrl from "@/assets/cursors/Cursor=Arrow-Figma.svg";
import arrowGraphiteUrl from "@/assets/cursors/Cursor=Arrow-Graphite.svg";
import arrowSolarUrl from "@/assets/cursors/Cursor=Arrow-Solar.svg";
import type { NativeCursorType } from "@/native/contracts";

export interface PrettyNativeCursorAsset {
	imageDataUrl: string;
	width: number;
	height: number;
	hotspotX: number;
	hotspotY: number;
}

export const PRETTY_NATIVE_CURSOR_ASSETS: Record<NativeCursorType, PrettyNativeCursorAsset> = {
	arrow: {
		imageDataUrl: arrowUrl,
		width: 32,
		height: 32,
		hotspotX: 5,
		hotspotY: 2,
	},
	text: {
		imageDataUrl: textUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	pointer: {
		imageDataUrl: pointerUrl,
		width: 32,
		height: 32,
		hotspotX: 13,
		hotspotY: 8,
	},
	crosshair: {
		imageDataUrl: crosshairUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	"open-hand": {
		imageDataUrl: openHandUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 9,
	},
	"closed-hand": {
		imageDataUrl: closedHandUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 9,
	},
	"resize-ew": {
		imageDataUrl: resizeEwUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	"resize-ns": {
		imageDataUrl: resizeNsUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	"resize-nesw": {
		imageDataUrl: resizeNeswUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	"resize-nwse": {
		imageDataUrl: resizeNwseUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	move: {
		imageDataUrl: moveUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	"not-allowed": {
		imageDataUrl: notAllowedUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	wait: {
		imageDataUrl: waitUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 16,
	},
	"app-starting": {
		imageDataUrl: appStartingUrl,
		width: 32,
		height: 32,
		hotspotX: 7.25,
		hotspotY: 4.03,
	},
	help: {
		imageDataUrl: helpUrl,
		width: 32,
		height: 32,
		hotspotX: 7.25,
		hotspotY: 4.03,
	},
	"up-arrow": {
		imageDataUrl: upArrowUrl,
		width: 32,
		height: 32,
		hotspotX: 16,
		hotspotY: 3,
	},
};

// Every preset uses the same artwork and logical hotspot in both renderers.
const cursorLabels: Record<NativeCursorType, string> = {
	"arrow": "Arrow",
	"text": "Text beam",
	"pointer": "Pointing hand",
	"crosshair": "Crosshair",
	"open-hand": "Open hand",
	"closed-hand": "Grabbing hand",
	"resize-ew": "Resize horizontally",
	"resize-ns": "Resize vertically",
	"resize-nesw": "Resize diagonally ↗",
	"resize-nwse": "Resize diagonally ↘",
	"move": "Move",
	"not-allowed": "Unavailable",
	"wait": "Wait",
	"app-starting": "Busy arrow",
	"help": "Help",
	"up-arrow": "Up arrow",
};

function centeredCursor(imageDataUrl: string): PrettyNativeCursorAsset {
	return { imageDataUrl, width: 32, height: 32, hotspotX: 16, hotspotY: 16 };
}

function macArrowCursor(imageDataUrl: string): PrettyNativeCursorAsset {
	return { imageDataUrl, width: 32, height: 32, hotspotX: 5, hotspotY: 2 };
}

const MAC_SYSTEM_CURSOR_OPTIONS = [
	...Object.entries(PRETTY_NATIVE_CURSOR_ASSETS).map(([key, asset]) => ({
		id: `mac-${key}`,
		label: cursorLabels[key as NativeCursorType],
		asset,
	})),
	{ id: "mac-beachball", label: "Beachball", asset: centeredCursor(beachballUrl) },
	{ id: "mac-zoom-in", label: "Zoom in", asset: centeredCursor(zoom_inUrl) },
	{ id: "mac-zoom-out", label: "Zoom out", asset: centeredCursor(zoom_outUrl) },
	{ id: "mac-resize-left", label: "Resize left", asset: centeredCursor(resize_leftUrl) },
	{ id: "mac-resize-right", label: "Resize right", asset: centeredCursor(resize_rightUrl) },
	{ id: "mac-resize-up", label: "Resize up", asset: centeredCursor(resize_upUrl) },
	{ id: "mac-split-horizontal", label: "Split horizontally", asset: centeredCursor(split_horizontalUrl) },
	{ id: "mac-split-vertical", label: "Split vertically", asset: centeredCursor(split_verticalUrl) },
];

/** User-selectable macOS-shaped arrow looks. Other interaction states (text, hand,
 * resize, etc.) continue to use the matching captured macOS cursor automatically. */
export const MAC_ARROW_OPTIONS = [
	MAC_SYSTEM_CURSOR_OPTIONS.find(({ id }) => id === "mac-arrow")!,
	{ id: "mac-arrow-white", label: "Snow", asset: macArrowCursor(arrowWhiteUrl) },
	{ id: "mac-arrow-blue", label: "Ocean", asset: macArrowCursor(arrowBlueUrl) },
	{ id: "mac-arrow-violet", label: "Iris", asset: macArrowCursor(arrowVioletUrl) },
	{ id: "mac-arrow-teal", label: "Mint", asset: macArrowCursor(arrowTealUrl) },
	{ id: "mac-arrow-coral", label: "Coral", asset: macArrowCursor(arrowCoralUrl) },
	{ id: "mac-arrow-amber", label: "Amber", asset: macArrowCursor(arrowAmberUrl) },
	{ id: "mac-arrow-figma", label: "Figma", asset: macArrowCursor(arrowFigmaUrl) },
	{ id: "mac-arrow-graphite", label: "Graphite", asset: macArrowCursor(arrowGraphiteUrl) },
	{ id: "mac-arrow-solar", label: "Solar", asset: macArrowCursor(arrowSolarUrl) },
];

export const MAC_CURSOR_OPTIONS = [
	...MAC_SYSTEM_CURSOR_OPTIONS,
	...MAC_ARROW_OPTIONS.slice(1),
];

const fixedCursors = new Map(MAC_CURSOR_OPTIONS.map(({ id, asset }) => [id, asset]));

export function getFixedMacCursor(id: string | null | undefined) {
	return id ? fixedCursors.get(id) : undefined;
}
