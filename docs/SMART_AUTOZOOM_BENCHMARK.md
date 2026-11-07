# Smart Auto-Zoom benchmark and ship gate

**Reviewed:** 2026-11-07  
**Purpose:** Turn “beat Screen Studio” into a reproducible quality claim.  
**Privacy:** Synthetic traces stay in tests. User recordings remain local and are not copied into fixtures.

## What Screen Studio publicly documents

Screen Studio's Auto Zoom guide says automatic zooms focus on recorded click locations; a zoom without a click needs manual focus. Its editing guide describes zooms as editable timeline regions that can be resized, adjusted, disabled, or removed. Screen Studio 4 also advertises a shared preview/export renderer, Glass Loupe, sharper zooms using an on-device upscaler, and an animation that can start before an action. The animation guide documents smooth/medium/rapid cursor movement and motion blur controls.

Sources: [Auto Zoom guide](https://screen.studio/guide/auto-zoom), [editing zooms](https://screen.studio/guide/adding-editing-zooms), [Screen Studio 4](https://screen.studio/4), [animations guide](https://preview.screen.studio/guide/animations).

This describes published behavior; it does not verify quality from a live Screen Studio build. Screen Studio currently supports macOS only, so this Windows workspace cannot run a valid same-machine A/B capture.

## foOom implementation inspected

- Click and dwell candidates are generated from normalized cursor telemetry in `src/components/vedio-editor/timeline/zoomSuggestionUtils.ts`.
- Suggested regions are created in `VideoEditor.tsx`; the timeline stores automatic regions separately from manual/user-edited regions.
- Playback and MP4 rendering both use `findDominantRegion` and `advanceFollowFocus`, keeping core zoom selection and cursor-follow smoothing shared.
- The legacy keyframe fallback in `src/lib/autozoom.ts` retains interaction intent for a timed hold, allows a newer zoom-out to cancel it, and returns to overview afterward.

## Quality metrics

Run the deterministic synthetic suite and record each metric. Do not convert unit-test pass rate into a competitor win claim.

| Metric | Definition | Release gate |
| --- | --- | ---: |
| Meaningful-click recall | Expected action windows with a zoom region whose focus is within 4% of frame diagonal | ≥ 95% |
| False-zoom rate | No-intent windows that receive a zoom | ≤ 5% |
| Focus error | Median normalized distance from expected target to rendered focus | ≤ 0.04 |
| Edge safety | Frames where the intended subject is outside the visible crop | 0 |
| Timeline integrity | Auto-generated regions overlapping each other or manual regions | 0 |
| Motion continuity | Zoom/focus jumps across region seams at 24, 30, 60, and 120 fps | 0 discontinuities |
| Preview/export parity | Maximum transform difference at identical media timestamps | ≤ 0.001 normalized units |
| Recovery | Seek, pause, reverse, and resume preserve deterministic framing | 100% of cases |

## Required fixtures

Each fixture has labeled intent windows and expected normalized focus coordinates. The tests in `src/lib/autozoom.test.ts`, `src/components/vedio-editor/timeline/zoomSuggestionUtils.test.ts`, and `src/components/vedio-editor/videoPlayback/zoomRegionUtils.test.ts` cover the current subset.

1. Single click on a control, followed by cursor travel.
2. Double click on one control.
3. Two rapid clicks on separate controls.
4. Repeated clicks on the same control.
5. Typing after a focus click.
6. Long stationary reading pause.
7. Brief accidental hover.
8. Slow pointer traverse.
9. Fast pointer traverse ending in a deliberate pause.
10. Telemetry dropout during a potential dwell.
11. Hidden pointer and malformed/out-of-range samples.
12. Clicks near each source edge and corner.
13. Portrait, ultrawide, and crop-adjusted output frames.
14. Existing manual zooms beside automatic suggestions.
15. Seek, pause, reverse, and frame-rate changes.
16. One fixture with cursor, click, webcam, caption, and annotation overlays to catch occlusion.

## Recorded-video audit (foOom only)

The most recent local recording inspected during this task is an H.264 1366×768 clip, 66.34 seconds long, with 2,040 cursor events and 14 click-down events. The detector produced 14 click candidates and the spacing/overlap policy retained 11 regions; the minimum gap between retained regions is 1.22 seconds. This confirms the pipeline can produce a bounded draft for a real clip. It is not a quality score: no human labels exist for that clip and no Screen Studio output was generated from the same recording.

## Fair competitor run still required

Before publishing “better than Screen Studio,” capture the 16 fixtures with both products on supported hardware, with the same display size, actions, and edit/export settings. Save the labeled event traces and resulting zoom timelines, then score both using the table above. Review at least two independent raters blind to product identity for subject visibility, reading comfort, and unwanted camera movement. Publish sample size, exclusions, per-case scores, and confidence intervals. If Screen Studio cannot ingest the same source recording or be run on this machine, mark the comparison unavailable instead of inferring its score from marketing pages.

## Current verdict

**foOom has a deterministic heuristic and unit-test coverage for core interaction cases. The recording audit and source inspection do not prove it beats Screen Studio.** The product-specific comparative score remains **not measured** until the same-fixture run is completed.
