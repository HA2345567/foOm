# P0 implementation gap audit

**Updated:** November 2, 2026  
**Scope:** P0 acceptance criteria in [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).  
**Verdict:** The Windows code path builds and has unit/UI coverage, but the native record → edit → save/reopen → export flow has not been runtime-verified. P0 requirements therefore remain partial until hardware acceptance evidence exists.

## Verification run

- Desktop TypeScript typecheck passed.
- Desktop UI: 197 tests passed across 27 files (serial run before the final auto-zoom adjustment); all 7 focused auto-zoom tests passed afterward.
- Cargo workspace: 23 passed, 2 hardware-dependent tests ignored.
- `rust-core` after region safety/source-bound fixes: 8 passed, 2 ignored.
- `shared-core`: 11 tests passed.
- Windows Tauri NSIS release build passed; installer and website copy match. This installer predates the latest MediaBunny exporter and must be rebuilt before distribution.
- Desktop UI and website production builds passed after the exporter and notice updates.
- Rust formatting and diff whitespace checks passed; high-severity source secret scan found 0 findings.
- No live desktop capture/export session was performed. macOS/Linux native capture was not tested.

## Requirements

| ID | Status | Evidence and remaining acceptance gap |
| --- | --- | --- |
| REC-01 | PARTIAL | First desktop recording requires an explicit source; missing/corrupt selections open the picker. Picker failures surface an error without silently selecting a display, and Cancel clears pending auto-start. Focused source/startup tests pass; a first-run native walkthrough remains unobserved. |
| REC-02 | PARTIAL | Windows source descriptors preserve desktop bounds/scaling. A display-map drag picker and exact-coordinate fields feed validated region bounds through selection storage and recorder/native bridges; 21 focused tests pass. The picker has no live screenshot yet. Actual multi-monitor capture, source closure, and error recovery still need runtime proof. |
| REC-03 | PARTIAL | Mic/camera selection paths exist. Live mic level, native device permissions, and unavailable-device messages are not verified. |
| REC-04 | PARTIAL | Windows WASAPI loopback is implemented. System-audio capture/mux, mic separation, and failure handling need hardware playback checks. |
| REC-05 | PARTIAL | Mouse/cursor events are stored as project metadata; global keyboard hooks were removed to prevent keystroke collection. Time alignment and editable-vs-baked cursor output need export verification. |
| REC-06 | PARTIAL | Start/pause/resume/stop/discard use a session contract with ID checks. Configurable global recording hotkey and conflict handling exist; 3 UI and 2 Rust tests pass, but OS registration and hidden-overlay activation are not runtime-verified. |
| REC-07 | PARTIAL | UI tracks recording state and elapsed time. Visibility/timing while unfocused needs a real recording check. |
| POL-01 | PARTIAL | Cursor-event zoom suggestions now retain long dwell moments, prioritize double/right-clicks in clusters, clamp at clip edges, preserve existing regions, and return chronologically; 7 focused tests pass. Suggested zoom persistence and enable/disable behavior still need a full editor session. |
| POL-02 | PARTIAL | Zoom edits feed editor/export configuration. Retarget/resize/reposition/remove and preview/export parity need evidence. |
| POL-03 | PARTIAL | Cursor telemetry enters editor/export paths. Size, visibility, smoothing reversibility, and final rendering are unverified. |
| EDT-01 | PARTIAL | Editor playback/timeline code exists. Scrub, frame-step, and full-length playback are unverified. |
| EDT-02 | PARTIAL | Trim regions and save-state paths exist. Undo and save/reopen preservation are unverified. |
| EDT-03 | PARTIAL | Speed regions feed exporter configuration. Result duration and audio treatment are unverified. |
| EDT-04 | PARTIAL | Webcam layout and export settings exist. Device capture, persistence, mirror/shape, and preview/export parity are unverified. |
| EDT-05 | PARTIAL | Background and framing controls exist. Preset persistence and aspect-ratio adaptation are unverified. |
| EXP-01 | PARTIAL | Local MP4 export paths exist. Actual output streams, duration/audio alignment, and playback have not been checked. |
| EXP-02 | PARTIAL | Quality/format controls exist. 720p/1080p labels and unsupported-setting reasons need UI review. |
| EXP-03 | PARTIAL | Native export uses unique temporary files and commits only after successful encoding; 8 engine tests cover prior-output preservation on cancellation, failed-commit cleanup, unique reservations, source protection, and process termination. Tauri keeps jobs registered through finalization and checks late cancellation. Full UI/native export and failure acceptance remain unverified. |
| EXP-04 | PARTIAL | Versioned project documents and save/load commands exist. Native save/reopen, missing-media recovery, and cross-platform open are unverified. |
| CORE-01 | PARTIAL | Shared versioned project types and capture-session traits exist; Tauri uses the Windows backend for lifecycle operations. Timeline semantics and all media orchestration are not in the shared Rust core. |
| CORE-02 | PARTIAL | Windows backend implements the first native path; non-Windows returns explicit unsupported capabilities. macOS/Linux capture, permissions, audio/device APIs, and full parity remain unimplemented. |
| CORE-03 | PARTIAL | Versionless docs normalize to v1; unknown fields are preserved; invalid/future versions fail safely with tests. Cross-platform asset path semantics/opening remain unverified. |
| CORE-04 | PARTIAL | MIT license/metadata, contribution/security docs, third-party notices, and Tauri resource staging exist. `web-demuxer` and its FFmpeg-derived WASM were removed from the desktop exporter in favor of MediaBunny; a complete dependency/asset inventory and GPLv3 FFmpeg source materials remain outstanding. |
| CORE-05 | PARTIAL | Unused activation/quota commands were removed; local export commands remain. A clean install must still prove offline, account-free recording/edit/save/export. |

## Remaining P0 work

1. Rebuild the installer and website download from the current MediaBunny exporter source.
2. Run an isolated Windows smoke flow through record, pause/resume, stop, editor, save/reopen, and MP4 export; inspect streams, duration, and playback. Add permission-denied, cancel, source-closed, and recovery cases.
3. Run the new macOS/Linux Tauri shell compile jobs, then implement ScreenCaptureKit and XDG ScreenCast/PipeWire capture adapters.
4. Complete and retain the exact GPLv3 FFmpeg source/configuration package plus a reproducible dependency inventory before publishing binary installers.

The ignored capture smoke records the actual desktop and system audio, so it was not run during this build/test pass. Compilation and unit tests are not substitutes for runtime capture evidence.
