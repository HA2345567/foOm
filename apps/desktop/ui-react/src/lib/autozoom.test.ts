import { describe, expect, it } from "vitest";
import {
  createInitialZoomState,
  fuseIntent,
  generateZoomKeyframes,
  interpolateZoom,
  tickEngine,
} from "./autozoom";

describe("Smart Auto-Zoom intent timing", () => {
  it("holds a click zoom for a readable interval before returning to overview", () => {
    const keyframes = generateZoomKeyframes(
      [{ timestamp: 100, x: 0.32, y: 0.42, type: "click" }],
      4_000,
    );

    expect(interpolateZoom(keyframes, 700).scale).toBeGreaterThan(1.5);
    expect(interpolateZoom(keyframes, 3_000).scale).toBeLessThan(1.1);
  });

  it("lets a newer scroll-out cancel a stronger latched click", () => {
    const state = createInitialZoomState();
    tickEngine(state, [{ type: "click", x: 0.3, y: 0.4, priority: 10, timestamp: 100 }], null, 100, 1 / 60);
    tickEngine(state, [], null, 300, 1 / 60);

    const result = fuseIntent(
      [
        { type: "click", x: 0.3, y: 0.4, priority: 10, timestamp: 100 },
        { type: "scroll_out", priority: 7, timestamp: 400 },
      ],
      state,
      400,
    );

    expect(result).toMatchObject({ targetX: 0.5, targetY: 0.5, targetScale: 1, priority: 0 });
  });

  it("lets a new click replace the previous focus and hold window", () => {
    const state = createInitialZoomState();
    tickEngine(state, [{ type: "click", x: 0.3, y: 0.4, priority: 10, timestamp: 100 }], null, 100, 1 / 60);
    tickEngine(state, [{ type: "click", x: 0.72, y: 0.61, priority: 10, timestamp: 800 }], null, 800, 1 / 60);

    expect(state.targetX).toBe(0.72);
    expect(state.targetY).toBe(0.61);
    expect(state.holdUntil).toBe(2_600);
  });

  it("does not let ordinary cursor movement cancel the current click zoom", () => {
    const state = createInitialZoomState();
    tickEngine(state, [{ type: "click", x: 0.3, y: 0.4, priority: 10, timestamp: 100 }], null, 100, 1 / 60);
    tickEngine(state, [{ type: "pointer", x: 0.8, y: 0.7, priority: 2, timestamp: 300 }], null, 300, 1 / 60);

    expect(state.targetScale).toBe(1.85);
    expect(state.targetX).toBe(0.3);
    expect(state.priority).toBe(10);
  });

  it("does not re-trigger a consumed signal after its hold expires", () => {
    const state = createInitialZoomState();
    const click = [{ type: "click" as const, x: 0.35, y: 0.45, priority: 10, timestamp: 100 }];
    tickEngine(state, click, null, 100, 1 / 60);

    const expired = fuseIntent(click, state, 2_000);
    expect(expired).toMatchObject({ targetX: 0.5, targetY: 0.5, targetScale: 1, priority: 0 });
  });
});
