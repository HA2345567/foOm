# PRD implementation audit

Date: November 3, 2026

Verdict: **PRD incomplete; Windows release readiness and Screen Studio workflow parity are not established.**

This audit compares PRODUCT_REQUIREMENTS.md with source inspection and the explicitly recorded checks from this session. Implementation presence is not acceptance-test completion. No percentage is assigned because requirements differ in size and many hardware/runtime criteria remain unverified.

## Release blockers and confirmed discrepancies

1. **EXP-01 / EXP-03: completed cinematic MP4 export remains unverified.** Previous native tests reached the save dialog but did not establish a playable output file. Recent error handling and duplicate-start fixes do not establish encoding success. VideoEditor.tsx still closes the export dialog and clears progress in `finally`, including after errors; the persistent error/success states in ExportDialog therefore cannot reliably serve their intended purpose.
2. **EXP-02: preset descriptions are incorrect.** ExportDialog labels the `medium` preset as 480p/30 FPS, but mp4ExportSettings.ts calculates a 720-pixel short side and VideoEditor.tsx requests 60 FPS. The `source` preset is described as 4K even though it retains source-dependent dimensions. Actual settings must be displayed from one shared configuration.
3. **CORE-01: the Rust-core goal is only partially delivered.** renderer/motion-engine/src/lib.rs returns an empty vector from generate_zoom_keyframes. Active auto-zoom suggestion, spring animation, timeline and composition behavior live in TypeScript. This does not mean the UI has no auto zoom; it means the Rust implementation is a placeholder.
4. **CORE-01 / preview-export parity:** renderer/export-engine/src/lib.rs explicitly rejects composition effects. Native FFmpeg conversion is not a cinematic compositor. The active WebCodecs exporter needs real preview/output comparison before parity can be claimed.
5. **Distribution:** the website's DownloadButton defaults to GitHub releases/latest rather than its local downloads/foom-setup.exe. The preceding live check found no published GitHub releases. The local public installer predates the preview/export/telemetry fixes in this conversation; its presence does not mean it contains current code. Deployment overrides were not inspected.
6. **CORE-06 / CORE-07:** macOS and Linux capture adapters are not delivered. Portable contracts and shell compile workflows exist; they do not provide native recording on these systems.
7. **AI-01:** lib/captioning.ts explicitly reports that no transcription engine exists. Automatic captions cannot be marked complete. README also identifies noise reduction as unimplemented.

## Requirement coverage

Statuses: **Present/unverified** means substantive code exists, but the full PRD acceptance criteria have not passed here. **Partial** means a known acceptance or integration gap. **Not established** means this review did not locate sufficient implementation/evidence; it is not proof that every related symbol is absent.

| PRD IDs | Assessment | Evidence / remaining acceptance work |
| --- | --- | --- |
| REC-01, REC-07 | Present; basic native behavior observed | LaunchWindow toolbar, visible timer and native launch observed earlier. Full keyboard/accessibility audit outstanding. |
| REC-02 | Present/unverified | Windows capture.rs and platform.rs support display/window/region. A selected fixture recording reached the editor earlier; monitor scaling, region bounds and closed-source recovery need a complete matrix. |
| REC-03, REC-04 | Present/unverified | Device UI, microphone/camera capture and WASAPI code exist. Live device levels, simultaneous tracks, drift and unavailable-device handling are not certified. |
| REC-05 | Present/unverified | Native hooks and cursor metadata plumbing exist. Verify timing and absence of a duplicate baked cursor in actual output. |
| REC-06 | Partial verification | Pause/resume observed; shortcut code exists. Global shortcut conflicts and stopping while another app has focus remain unverified. |
| REC-08, REC-09 | Not established | Interrupted recording recovery and low-disk behavior need explicit implementation tracing and destructive-failure fixtures. |
| POL-01 | Present; integration fix applied | zoomSuggestionUtils generates click/dwell suggestions. Telemetry loading/source races were patched. Visual validation on realistic walkthroughs remains open. |
| POL-02, POL-03 | Present/unverified | Zoom editing, cursor smoothing and shared rendering helpers exist. Persistence and exported visual equivalence require actual output checks. |
| POL-04, POL-05, POL-06 | Partial / acceptance not established | Cursor effects and spring transitions exist; all ripple/sound, idle/loop and user-adjustable easing criteria are not demonstrated. |
| EDT-01 | Present; basic preview observed | Actual captured video and timeline were visible after CORS fix. Scrub/frame-step coverage remains incomplete. |
| EDT-02, EDT-03 | Present/unverified | Trim/speed regions and exporter handling exist. Undo/reopen, resulting duration and audio behavior need integrated verification. |
| EDT-04 | Present/unverified | Webcam composition math and editor controls exist. Device capture plus preview/export parity remains open. |
| EDT-05, EDT-06, EDT-07 | Present/partial | Background/frame/ratio/annotation controls and renderer exist. Preset round trips, focus preservation across ratios and mask output need acceptance checks. |
| EDT-08 | Partial | background-music.ts exists with remote sample URLs. That alone does not establish editor timeline mixing, looping or export integration. |
| EDT-09 | Partial | Save flow and atomic native writes exist. Autosave, retained backups, recent projects and crash recovery are not established by the observed project save. |
| AI-01, AI-03 | Missing advertised processing capability | Automatic transcription explicitly unavailable; noise reduction documented unimplemented. |
| AI-02, AI-04 | Not established | Caption helpers/manual UI do not establish retimed SRT output or transcript-driven edits. |
| EXP-01, EXP-02, EXP-03 | Release blockers | See findings above. |
| EXP-04 | Partial verification | A JSON project was saved successfully. Reopen, missing-media relinking and recovery remain unverified. |
| EXP-05, EXP-06 | Present/unverified | GIF and source-resolution exporter code exists. Actual GIF output and 4K/60 hardware fallback need validation. |
| EXP-07, EXP-08 | Deferred | Hosted sharing and authenticated project transfer are later PRD scope, not Windows launch blockers. |
| CORE-01, CORE-02 | Partial | shared-core project schema and CaptureBackend contracts exist; Windows adapter is implemented. Motion/composition remain primarily TypeScript. Full device/permission/encoding adapter coverage is not established. |
| CORE-03 | Present/unverified | Versioned shared document schema and unsupported-version tests exist. Cross-platform media portability and recovery remain unverified. |
| CORE-04 | Present/partial release verification | MIT license, contribution/security docs and third-party notices exist. Packaged contents and dependency/source distribution obligations need release verification. |
| CORE-05 | Intended; unverified offline | Local core architecture exists. Clean installed app must complete recording/edit/save/export without network or activation. |
| CORE-06, CORE-07 | Not implemented | Native macOS/Linux capture remains planned. |
| CORE-08, CORE-09 | Present/unverified operationally | Windows/native, portable Rust and desktop-shell matrix workflow files and contributor/security docs exist. Successful current CI runs and clean-checkout build are not established here. |

## Evidence boundaries

Implementation follow-up: export errors now remain visible with a retry action; success is based on a saved file path rather than completed render progress; preset labels were corrected to 720p/60 FPS and source-dependent dimensions. Updated desktop typechecking passed. Browser export verification was attempted both as a full suite and as a single MP4 test; both stalled without a result and were interrupted. These changes do not close EXP-01 or certify an installer. The free/MIT core-product decision is now recorded in the PRD.

- Earlier in this session: desktop UI typecheck passed; 12 focused auto-zoom suggestion/spring tests passed; native toolbar and a short fixture capture-to-preview handoff were observed; project JSON save was observed.
- During this audit, `bun run test:desktop` passed: **30 test files, 219 tests**, exit code 0. This is the desktop unit suite, not the separate browser-export or native hardware suites.
- No current installer clean-install acceptance, full device matrix, long recording soak, crash recovery, offline acceptance, accessibility audit, or visual preview/export comparison has been completed in this audit.
- Existing test files and CI definitions are evidence of coverage intent, not proof of passing hardware behavior.

## Ordered completion plan

1. Finish one reproducible Windows path: installed shortcut → source selection → capture with cursor/clicks → stop → playable editor → trim/zoom → save/reopen → playable MP4. Check duration, audio and visible edits in the output.
2. Correct export presets and retain useful error/progress/success UI; validate cancellation and failed-save recovery.
3. Validate actual auto zoom/cursor paths against exported frames, including edges, rapid clicks, long dwells, pauses, trims and speed changes.
4. Complete device, global-shortcut, disk-space and recovery acceptance; publish supported Windows/GPU limits.
5. Rebuild the installer from verified source, connect the download button to that artifact, and repeat the workflow from a clean install.
6. Complete P1 polish and native platform ports in separate milestones. Decide explicitly whether the active TypeScript cinematic pipeline is acceptable for the first release or must move into shared Rust before it.

## PRD corrections

The PRD still asks whether the product should be paid even though the user has already selected free, open-source-first, MIT. Record that decision. Its foundation release prose includes autosave/recovery while individual entries classify those as P1; clarify the release gate. Preserve Windows-first ordering and distinguish Screen Studio workflow goals from demonstrated feature parity.
