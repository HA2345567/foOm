import { describe, expect, it } from "vitest";
import { layoutWithPadding, readPaddingEdges, uniformPadding } from "./canvasPadding";

const params = {
  canvasSize: { width: 1000, height: 1000 },
  screenSize: { width: 1000, height: 1000 },
};

describe("canvas padding", () => {
  it("retains the framing of projects with linked padding", () => {
    expect(layoutWithPadding(params, 50)?.screenRect).toEqual({ x: 100, y: 100, width: 800, height: 800 });
    expect(layoutWithPadding(params, 0, uniformPadding(35))).toEqual(layoutWithPadding(params, 35));
  });

  it("positions the frame using each edge and preserves the source aspect ratio", () => {
    const edges = { left: 50, right: 0, top: 0, bottom: 50 };
    expect(layoutWithPadding(params, 0, edges)?.screenRect).toEqual({ x: 100, y: 0, width: 900, height: 900 });
    expect(layoutWithPadding({ ...params, layoutPreset: "vertical-stack" }, 50, edges)?.screenRect)
      .toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it("loads valid project edges, clamps outliers and falls back for malformed edges", () => {
    expect(readPaddingEdges({ top: 38, right: 900, bottom: -4, left: 1 })).toEqual({ top: 38, right: 50, bottom: 0, left: 1 });
    expect(readPaddingEdges({ top: 3 })).toBeUndefined();
    expect(readPaddingEdges(null)).toBeUndefined();
  });
});
