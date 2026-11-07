# Desktop UI rebuild — 2026-11-03

The supplied reference and black/dark-gray preference replace the earlier green palette.

## Implemented

- Installed app launch opens the floating recording toolbar. Reopening the Windows shortcut activates the existing toolbar. Toolbar creation failures show the main window as a fallback.
- First-use Record remains enabled and opens source selection. Recording has a distinct red Stop state. Existing stop → saved session → editor handoff is retained.
- Editor has a compact header, centered document name, left icon rail and scrollable inspector, large right preview, and full-width resizable timeline.
- Explicit percentage panel sizes fix collapsed inspector widths with react-resizable-panels v4.
- Video textures load without autoplay; optional cursor assets no longer block preview initialization.
- Source-video timeline strip reflects actual duration and visible timeline range. Existing timeline scrubbing remains available.
- Home, settings, capture picker and recorder use neutral surfaces and controls. Wallpaper/media retain their own colors.

## Verification

- Desktop TypeScript check passes.
- Focused home/source/region/picker tests: 12 pass. Recorder hook tests: 8 pass.
- Rust formatting and git diff whitespace checks pass.
- Desktop UI production build passes; existing large-chunk warnings remain.
- `scripts/preview-desktop-ui.mjs` imports a generated three-second local clip, verifies an expanded inspector and loaded video/canvas, plays and pauses the clip, opens Export, and checks first-use Record is enabled. Browser run reports zero page errors.
- Actual rendered screenshots are in `target/ui-preview/studio-editor.png`, `studio-toolbar.png`, `studio-home.png`, and `studio-settings.png`.

## Remaining verification

Native Windows recording and installer runtime were not exercised in this UI pass. Existing installer downloads do not contain this redesign until repackaged. Export menu verification does not establish that encoding/export succeeds.

Primary environment: Windows desktop local SPA; no SEO requirement. Accessibility owner for this pass: Codex; target WCAG AA. Performance targets: p75 LCP ≤2500ms, INP ≤200ms, CLS ≤0.1; initial JS ≤200KB gzip plus ≤80KB per route; Lighthouse accessibility ≥95 and performance ≥90. These are targets, not measured results. Current production chunks exceed the JS budget (initial ~246KB gzip, editor ~349KB gzip); performance and accessibility certification remain outstanding.
