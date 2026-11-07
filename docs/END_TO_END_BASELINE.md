# foOom end-to-end baseline

**Updated:** November 2, 2026  
**Scope:** Current Windows-first desktop implementation and requested cross-platform/open-source direction.  
**Evidence:** Source inspection plus the checks listed below. No interactive recording was performed.

## Current implementation

- A shared, OS-neutral Rust crate defines a versioned project document and capture-session contract. Legacy documents without a version normalize to v1; invalid and future versions fail safely; unknown document fields are preserved.
- The Windows Tauri adapter routes start, pause, resume, finish, and cancel through a session object and checks the session ID on lifecycle calls. Discard cancels the encoder and removes only files derived from the generated session ID.
- Capture requests now validate region presence, positive dimensions, and coordinate overflow before reaching native capture. Negative desktop coordinates remain valid for monitors left of or above the primary display. The low-level Windows capture entry point also enforces these region checks, preventing invalid region requests from falling back to full-display capture.
- Windows source descriptors preserve desktop x/y bounds and display scaling. Region-source enumeration returns display bounds for region selection rather than an empty list; multi-monitor runtime selection still needs acceptance testing.
- The source selector now offers a region picker for displays with known bounds. Users drag on a display map or enter exact physical coordinates, with the selection constrained to the chosen display. Bounds survive selection storage and recorder forwarding; the bridge rejects missing geometry instead of inventing a crop. The picker currently uses a schematic display map rather than a live screenshot, and native capture of the chosen rectangle remains runtime-unverified.
- Desktop first launch now requires an explicit source selection. Corrupt selections and old generic `screen` placeholders return to the picker. Picker failures return an `opened: false` result and show an error without selecting another monitor or starting capture; Cancel clears the pending start-after-selection flag. Native source-list failures reach the selector's existing retry state.
- Windows global start/stop hotkeys use a dedicated `RegisterHotKey` message thread, separate from cursor telemetry. Settings persist the binding, reject local conflicts and missing modifiers, and report OS registration conflicts. The recording overlay stays mounted while hidden, and app exit unregisters the native hotkey.
- The reusable `rust-core` crate target-gates Windows capture, hooks, and WASAPI dependencies/modules. A new CI workflow tests the core on Windows, macOS, and Linux and adds macOS/Ubuntu Tauri-shell compile jobs. The shell now gates Windows-only capture/shortcut code and reports capture as unsupported on non-Windows; the new shell CI jobs have not run yet, and native macOS/Linux capture remains unimplemented.
- Windows capture uses Windows Graphics Capture/D3D11 with FFmpeg and optional WASAPI loopback. The React recorder has a browser `getDisplayMedia` path for non-Windows web capture, but the native macOS/Linux Rust backend currently reports capture as unsupported.
- Finalized source media is registered before optional audio/webcam post-processing. Nonzero encoder exits register a recoverable partial recording when a non-empty video file exists.
- Recording metadata includes mouse/cursor telemetry. The native recording hook no longer installs a global keyboard hook or stores keystrokes.
- The primary Tauri editor's auto-zoom suggestions now retain long dwells with early placement, prioritize double/right-clicks within clusters, clamp suggestions to clip edges, preserve existing zoom regions, and return chronological spans. Seven focused tests cover these policies; visual preview/export behavior remains to be accepted in a real editor session.
- Local project persistence and MP4/GIF export paths exist. Their complete native runtime behavior has not been proven by the checks below.
- The reusable native export engine now writes to a uniquely reserved temporary MP4 in the destination directory, then replaces the destination only after success and a final cancellation check. Cancellation/failure removes only its own temporary file. Tauri validates before registering a job, retains the registration through finalization, and no longer writes a fixed-name directory probe.
- Source, Cargo manifests, README, contribution guide, security policy, and Tauri metadata identify MIT licensing. The exporter now uses MediaBunny instead of `web-demuxer`; exact third-party dependency and FFmpeg distribution obligations remain under audit.

## Verification completed on this workspace

| Check | Result |
| --- | --- |
| Desktop TypeScript typecheck | Passed |
| Desktop Vitest suite | 197 passed across 27 files (serial run before the final auto-zoom adjustment); the affected auto-zoom file then passed all 7 focused tests |
| Focused global shortcut UI tests | 3 passed |
| Last full Cargo workspace run | 23 passed; 2 hardware-dependent tests ignored, before the subsequent focused capture/export fixes listed below |
| Rust core tests after region safety/source-bound changes | 8 passed; 2 Windows hardware tests ignored |
| Focused global shortcut Rust tests | 2 passed in the workspace run |
| Focused auto-zoom suggestion tests | 7 passed after dwell, click-priority, spacing, edge, overlap, and order updates |
| Focused source selection/startup and recorder tests | 23 passed across bridge, recorder, and selector; 2 additional region geometry tests passed in the prior picker run |
| Shared-core project format and capture-contract tests | 11 passed |
| Native export engine tests | 8 passed, including previous-output preservation, unique temporary files, failed-commit cleanup, source protection, and process cancellation |
| Tauri/Rust release build | Passed; `target/release/foOm.exe` produced |
| Windows NSIS installer | Passed; 317,680,677 bytes. Installer and website download copy match at SHA-256 `c53c94f7732e806c507453317689dd12d904e2086c9066f64859e61eb63ba474`. This installer predates the latest MediaBunny exporter and must be rebuilt before distribution. |
| Desktop UI production build | Passed after removing `web-demuxer` and switching to MediaBunny |
| Website production build | Passed with the current download and notice panel |
| Rust formatting and `git diff --check` | Passed |
| High-severity source security scan | 0 findings in `apps/` |

The first parallel UI/Rust test attempt had two Vitest worker-start timeouts while compiling Rust concurrently. A serial rerun passed all 197 tests. Vite reports non-fatal large-chunk and mixed dynamic/static import warnings; Tauri reports a deprecated static-runtime configuration warning.

## Not verified at runtime

- A real Windows record → pause/resume → stop → editor → project save/reopen → MP4/GIF export session, including codec playback and audio synchronization.
- Microphone/webcam device selection and permissions, system-audio output capture, recording recovery after process interruption, export cancellation, and prior-export preservation.
- Runtime verification of global hotkey registration, conflict reporting, activation while the overlay is hidden, and unregister-on-exit.
- macOS or Linux native capture, permissions, devices, packaging, and shell CI. Their native capture backend currently returns an explicit unsupported capability.
- Release-level third-party notices, an authoritative dependency license inventory, and the corresponding source/configuration package for the exact FFmpeg sidecar.

The ignored native smoke test captures a real desktop and system audio. It was not run in this session; compilation and unit tests do not substitute for that hardware/runtime evidence.

## Remaining P0 work

1. Add a consented Windows hardware smoke flow that records a controlled test window, verifies pause/resume/stop, reopens the project, exports a short MP4, and checks output streams/duration/playability. Include failure, cancel, and recovery cases.
2. Rebuild the installer with the latest MediaBunny exporter and verify the matching site download hash.
3. Runtime-test the configurable global recording shortcut and native Windows record/edit/save/reopen/export flow in an isolated Windows environment.
4. Complete the dependency/asset license inventory and FFmpeg corresponding-source package before publishing binaries.
5. Keep macOS/Linux listed as planned until native backends and platform acceptance flows pass; run the new shell compile jobs and implement native capture adapters.

## Workspace preservation

This repository contained extensive pre-existing working-tree modifications. All work was applied in place, and no unrelated changes were reset or committed.
