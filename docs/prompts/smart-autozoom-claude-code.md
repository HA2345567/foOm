# Claude Code task: make foOom Smart Auto-Zoom feel intentional

Work in the native foOom desktop editor. Read the repository's `AGENTS.md`, `CLAUDE.md`, and relevant local skills before changing code. Preserve existing user changes. Do not claim “best in the world” without comparative evidence; build measurable, reviewable behavior.

## Product contract

Smart Auto-Zoom should quietly frame the part of a desktop recording the viewer needs to follow. It should react to meaningful interaction, keep the subject legible, move smoothly, and return to context when detail is no longer useful. It must never make the recording harder to follow through jitter, rapid oscillation, edge clipping, or surprise zooms.

Keep all analysis local. Use captured cursor and interaction telemetry already stored with a recording. Do not upload video, cursor paths, audio, or captions. Do not add a remote model dependency.

## First inspect

1. Trace cursor telemetry from the native capture sidecar through `useCursorTelemetry` into `VideoEditor` and `zoomSuggestionUtils.ts`.
2. Trace how suggested regions are rendered, edited, persisted, undone, and exported. Confirm the preview and export use the same zoom data.
3. Inspect at least one existing recording's metadata and sample its video at the generated suggestion boundaries. Keep personal recordings out of fixtures and logs.
4. Identify concrete failures before changing thresholds. Do not redesign unrelated editor UI.

## Behavior requirements

- Distinguish meaningful clicks, repeated clicks, deliberate stationary reading pauses, cursor travel, and telemetry gaps.
- A click creates a 2.2-second suggestion. Clicks within 500 ms and 2% of the frame merge into one stronger suggestion instead of causing multiple jumps.
- A dwell suggestion requires continuous, sufficiently dense samples within a small radius. Missing samples, hidden cursor samples, brief hovers, and slow traversals must not invent a dwell.
- Use a stable, time-weighted focus from the interaction or dwell. Clamp it so the crop remains within the source frame and keeps useful surrounding context.
- Bound zoom depth and suggestion density. Suggestions must not overlap each other or manually created/edited regions.
- Use eased transitions with a readable settle and exit. Do not chase every cursor movement. Disable must remove only untouched automatic regions; preserve manual and user-edited regions.
- Keep the editor timeline, playback preview, save/reopen, and rendered export consistent. Preserve keyboard and accessibility behavior.
- Make edge behavior safe for ultrawide, portrait, low-resolution, and mixed-DPI captures. Avoid assumptions that all sources are 16:9.

## Evaluation set

Add or extend deterministic unit cases for each scenario and report pass/fail:

1. One deliberate click creates one region at the click position.
2. Interactions within 500 ms and 2% of frame distance produce one stronger focus candidate.
3. Dense, stable dwell samples lasting over 600 ms produce a suggestion.
4. A short hover does not create a region.
5. A slow cursor traverse does not count as dwell.
6. A telemetry gap over 500 ms breaks a dwell.
7. Hidden and invalid samples do not influence focus.
8. Suggestions at either clip boundary stay within `[0, duration]`.
10. Existing and newly suggested regions never overlap.
11. Nearby suggestions respect minimum spacing and remain chronological.
12. Focus near every frame edge stays in bounds without cropping the active subject.
13. Turning Auto-Zoom off preserves manual and edited regions.
14. Preview, project reopen, and export produce the same framing at sampled timestamps.

## Acceptance and reporting

- Run the targeted auto-zoom tests, typecheck, and relevant editor/export tests.
- Test the native desktop route when UI automation is available; do not substitute the web preview for desktop verification.
- Include before/after generated regions for a synthetic fixture and one local recording review without exposing its contents.
- Report remaining untested cases plainly. Avoid “world's best” claims until a benchmark compares foOom with named alternatives on the same recordings and rubric.

## Final response format

Report four items: summary of behavior changes; changed files; each check with pass/fail; desktop verification evidence and any remaining limitations.
