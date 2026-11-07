import { computeCompositeLayout, getWebcamLayoutPresetDefinition } from "./compositeLayout";

export const paddingSides = ["top", "right", "bottom", "left"] as const;
export type PaddingEdges = Record<(typeof paddingSides)[number], number>;
export const maxCanvasPadding = 50;

export function uniformPadding(amount: number): PaddingEdges {
  return { top: amount, right: amount, bottom: amount, left: amount };
}

export function readPaddingEdges(value: unknown): PaddingEdges | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = uniformPadding(0);
  for (const side of paddingSides) {
    const amount = (value as Partial<PaddingEdges>)[side];
    if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
    result[side] = Math.max(0, Math.min(maxCanvasPadding, amount));
  }
  return result;
}

export function layoutWithPadding(
  params: Parameters<typeof computeCompositeLayout>[0],
  padding: number,
  edges?: PaddingEdges,
) {
  const { width, height } = params.canvasSize;
  if (params.layoutPreset === "vertical-stack") return computeCompositeLayout(params);
  const { top, bottom, left, right } = edges ?? uniformPadding(padding);
  // Preserve the framing scale of existing projects: 50 produces 10% inset per edge.
  const maxContentSize = {
    width: width * (1 - (left + right) / 500),
    height: height * (1 - (top + bottom) / 500),
  };
  const layout = computeCompositeLayout({ ...params, maxContentSize });
  if (!layout) return null;
  const dx = width * (left - right) / 1000;
  const dy = height * (top - bottom) / 1000;
  layout.screenRect.x += dx;
  layout.screenRect.y += dy;
  if (layout.webcamRect && getWebcamLayoutPresetDefinition(params.layoutPreset).transform.type !== "overlay") {
    layout.webcamRect.x += dx;
    layout.webcamRect.y += dy;
  }
  return layout;
}
