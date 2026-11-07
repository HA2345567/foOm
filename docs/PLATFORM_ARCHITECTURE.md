# foOom cross-platform architecture

**Status:** Proposed implementation boundary  
**Product direction:** Windows first; macOS and Linux supported afterward; open source first  
**Owner:** Product/engineering review required for platform baseline and support policy; MIT license selected by maintainer  
**Basis:** Current Rust workspace and [product requirements](PRODUCT_REQUIREMENTS.md)

## Recommendation

Keep one desktop application and one shared Rust core. Move OS-specific work behind small, explicit platform adapters. The React editor can remain the presentation layer; the shared Rust core should own portable project/session models, event schemas, persistence rules, and operations that need consistent behavior across operating systems. Do not rewrite the editor or make a new crate for every module as a prerequisite.

The migration should preserve the current Windows recording path while creating stable boundaries that macOS and Linux backends can implement. Platform support means each OS has a real, tested capture backend; compiling the UI on another OS with capture disabled is not product parity.

## Current workspace map

| Area | Current responsibility | Portability observation |
| --- | --- | --- |
| `apps/desktop/rust-core` | Capture, global input hooks, WASAPI, SQLite projects | The crate directly combines Windows APIs and portable data/storage code. |
| `apps/desktop/tauri-shell/src-tauri` | Native windows, Tauri commands, FFmpeg orchestration, license/export state | Tauri commands call `rust_core::capture` directly; storage and FFmpeg paths also contain Windows assumptions. |
| `renderer/motion-engine` | Rust click/scroll/pause/type-burst/zoom types and zoom-keyframe generation | Closest existing portable domain/algorithm module; README calls it an unused placeholder while active zoom logic remains TypeScript. |
| `renderer/export-engine` | FFmpeg process orchestration and plain conversion | Process API is portable in shape; executable discovery and packaged binary names are Windows-specific. |
| `apps/desktop/ui-react` | Recording UI, editor, timeline, composition and preview | Keep UI platform-neutral and communicate through a stable, versioned native bridge. Avoid having duplicated OS decision logic in components. |

### Verified portability blockers

1. `apps/desktop/rust-core/Cargo.toml` declares `windows` as an unconditional dependency. `capture.rs` imports WinRT Graphics Capture, Direct3D 11, GDI, DWM, HiDPI, and Windows messaging APIs at module scope. Only the subprocess-window helper has a non-Windows branch. `capture` is exported unconditionally from `rust-core/src/lib.rs`.
2. `hooks.rs` is implemented with `SetWindowsHookExW` and Windows low-level keyboard/mouse structures. `loopback.rs` uses Windows COM/WASAPI. Both are exported/loaded without target-specific module boundaries.
3. `db.rs` uses `%LOCALAPPDATA%` and `%USERPROFILE%` to locate project and recording data. The fallback is the current directory, not an OS-standard application-data location.
4. `apps/desktop/tauri-shell/src-tauri/src/lib.rs` imports `rust_core::{capture, db}` and exposes Tauri commands around `capture::start_capture`, `pause_capture`, `resume_capture`, and `stop_capture`. The application layer is coupled to the Windows implementation instead of a backend contract.
5. Capture and shell FFmpeg lookup expect `ffmpeg.exe` or the Windows target name `ffmpeg-x86_64-pc-windows-msvc.exe`. `tauri.conf.json` bundles `binaries/ffmpeg` and declares the `nsis` installer target.
6. `apps/desktop/tauri-shell/src-tauri/Cargo.toml` currently declares `license = "Proprietary"` and an empty repository. The maintainer has selected MIT; all package metadata and the root LICENSE must be aligned before public release. The desktop Tauri config and README also describe a Windows-only product.
7. The README says `renderer/motion-engine` is not active and the zoom logic is TypeScript. This means the current Rust motion crate is not yet the source of truth for editor zoom behavior.

These are code-inspection findings, not a non-Windows build result. Run target builds before claiming a specific compiler failure or confirming a port.

## Proposed module boundaries

```text
React / TypeScript UI
  └── versioned Tauri command + event DTOs
        └── desktop application service (Rust)
              ├── portable domain and project/session orchestration
              ├── portable telemetry and timeline rules
              ├── storage and media policy
              └── platform service interfaces
                    ├── Windows: Graphics Capture, hooks, WASAPI, encoder integration
                    ├── macOS: ScreenCaptureKit, permitted input telemetry, Core Audio
                    └── Linux: portal/compositor capture, available telemetry, PipeWire/ALSA
```

### Portable core

Keep the following independent of OS handles and system frameworks:

- `CaptureRequest`, source identity, normalized geometry, dimensions, frame-rate intent, selected audio sources, and requested capabilities.
- Stable project and recording metadata schemas, versioning/migrations, event timestamps, pause intervals, cursor/click/scroll/type-burst data, and editor state.
- Session state transitions: ready → recording → paused → finalizing → complete/failed/cancelled.
- Timeline/zoom rules and motion math that must match across platforms. Promote existing Rust motion code only when it becomes the tested production source of truth for preview/export; otherwise keep current TypeScript logic until an explicit migration.
- Application-level operations such as create project, save project, list/reopen, recover partial recording, and produce an export job request.
- Typed, user-actionable errors that can be serialized over Tauri IPC without leaking platform handles or implementation details.

Do not put `HWND`, COM interfaces, `IDirect3DDevice`, `HMONITOR`, raw platform pointer types, or `windows` crate types in public portable models.

### Platform adapters

Define a small internal interface (one possible shape; names are illustrative):

```rust
pub trait CaptureBackend: Send + Sync {
    fn capabilities(&self) -> PlatformCapabilities;
    fn enumerate_sources(&self) -> Result<Vec<CaptureSource>, CaptureError>;
    fn start(&self, request: CaptureRequest) -> Result<Box<dyn CaptureSession>, CaptureError>;
}

pub trait CaptureSession: Send {
    fn pause(&mut self) -> Result<(), CaptureError>;
    fn resume(&mut self) -> Result<(), CaptureError>;
    fn finish(self: Box<Self>) -> Result<CaptureArtifacts, CaptureError>;
    fn cancel(self: Box<Self>) -> Result<(), CaptureError>;
}
```

Separate interfaces or backend responsibilities should cover:

- **Input telemetry:** start/stop, time-stamped pointer/click/scroll/keyboard-shortcut events, pause synchronization, and permission state. Never expose arbitrary keystrokes by default; collect only explicitly supported shortcut events and follow the product's privacy decision.
- **Audio capture:** enumerate mic/system devices, start/stop, pause/resume, independent track metadata, and timestamp alignment. Do not imply system-audio capture on a platform where the OS or desktop session does not permit it.
- **Camera discovery/capture:** enumerate devices and report capability/permission; decide consistently whether camera frames remain in the WebView/media layer or move to a Rust adapter.
- **Export execution:** submit a portable `ExportJob`, report progress/cancel/error, and resolve an installed or bundled encoder for the current target triple.
- **Paths and permissions:** obtain app-data, cache, recordings, and project locations through OS-appropriate APIs and surface permission requests/status to the application service.

`CaptureSource.id` should be an opaque, serializable stable identifier. Platform handles are stored inside the adapter session and are never persisted in the project. `PlatformCapabilities` should expose unavailable or restricted features to the UI so it can explain capability differences instead of silently failing.

### Application service and Tauri shell

The Tauri command layer should translate IPC requests into application service calls and serialize the results/events. It should not select WinRT APIs, construct Windows paths, or build FFmpeg filenames. Select the platform implementation once during startup (compile-time target module is preferred for native APIs); pass its service to commands. Keep command names and JSON casing compatible with the current React bridge or version their changes.

### Project and asset portability

- Version the project JSON/schema separately from the SQLite index.
- Keep paths relocatable where possible: store project-relative paths for project-owned media/assets, and use explicit external asset references with a relink flow.
- Normalize timestamps to a documented monotonic/session time unit; wall-clock timestamps are metadata only.
- Cross-platform projects must not store OS-specific window handles, device IDs as assumptions, or absolute paths that cannot be recovered.
- Preserve a raw recording before optional metadata, AI, composition, or export work. A backend failure must not erase the original media.
- Treat codec availability and platform-specific recording dimensions as capabilities; make import/export errors actionable.

## Platform-specific design constraints

| Platform | Capture direction | Constraints to resolve before claiming support |
| --- | --- | --- |
| Windows (first) | Keep the current Graphics Capture/Direct3D path and migrate it behind `CaptureBackend`. Keep WASAPI/input hooks in Windows-only modules. | Permission indicators, display scaling/multi-monitor behavior, audio synchronization, graphics adapter failures, and supported Windows versions. |
| macOS | Use native screen-capture APIs and OS permission flows; implement telemetry and audio only where permitted. | Screen Recording, Accessibility, Microphone, and System Audio permission behavior; notarization/signing; Intel vs Apple Silicon support; capture-kit availability by OS version. |
| Linux | Support specific compositor/session combinations with real backends; use portal/compositor-supported capture and available audio stack. | Wayland restricts global capture/input observation by design; portal consent and PipeWire availability vary. X11 and Wayland support must be stated separately. Do not promise global cursor/keyboard telemetry where it is unavailable. |

The supported OS versions, Linux desktops, and capabilities remain product decisions. Until each backend passes the end-to-end acceptance flow, label that platform experimental/unsupported.

## Safe migration sequence

1. **Apply the selected open-source release policy.** Add the MIT license, confirm ownership of assets/dependencies, add the repository URL, contribution and security-reporting instructions, and remove proprietary labels consistently.
2. **Write the portable contracts.** Define stable capture/source/session/capability/error/telemetry/project DTOs and a versioned project format. Keep IDs opaque and timestamps normalized. Add serialization fixtures for compatibility.
3. **Separate Windows modules without changing behavior.** Move existing implementation behind `platform::windows`; place Windows-only crate dependencies under a Windows target section. Keep `rust-core`'s portable modules compilable without compiling `capture.rs`, `hooks.rs`, or `loopback.rs` on another OS. Add explicit unsupported-platform errors until a native backend exists.
4. **Route Tauri through the application service.** Preserve existing command/IPC behavior while replacing direct `rust_core::capture` calls with service calls. Move DB/data/recording/FFmpeg path resolution to platform-aware providers. Avoid broad React changes in this step.
5. **Make the portable core build on all targets.** Add CI for portable Rust crates and native app builds; keep hardware capture tests behind OS-specific jobs. Prove project migrations and media/export behavior with fixtures before adding another capture API.
6. **Complete macOS backend.** Implement capture, permission reporting, camera/microphone/system-audio capability as supported, and native distribution. Run the complete capture → editor → export flow on supported macOS hardware.
7. **Complete Linux backend(s).** Select the initial desktop/session combinations and implement explicit capability reporting. Validate the flow on Wayland and/or X11 as claimed; do not infer support for untested compositors.
8. **Unify and document cross-platform projects.** Test creating on one OS and opening/exporting on another, including missing optional codecs, moved media, and schema migration.

Steps 2–5 make Windows a maintained backend while reducing blockers. The macOS and Linux work is additive and can proceed as separate, testable platform milestones once contracts are stable.

## Required verification gates

- Portable Rust crates pass formatting, tests, and `cargo check` on Windows, macOS, and Linux runners.
- Each supported OS has a documented compatibility matrix and a native capture-to-export acceptance run, not only a cross-compile.
- On each platform: select display/window/region where available, capture mic/camera/system audio only as supported, record editable cursor data only as permitted, pause/resume/stop, open the editor, save/reopen, and export/play a video.
- Backend failures preserve raw media and provide a clear recovery path.
- Project files created on each supported OS migrate and reopen on other supported OSes with referenced assets handled explicitly.
- CI does not run hardware-specific tests as if they were platform-neutral; tests must identify skipped hardware capabilities.
- The published license matches Cargo and website metadata before open-source distribution.

## Source files inspected

- [Rust core manifest](../apps/desktop/rust-core/Cargo.toml)
- [Rust core exports](../apps/desktop/rust-core/src/lib.rs)
- [Windows capture implementation](../apps/desktop/rust-core/src/capture.rs)
- [Local project database and file paths](../apps/desktop/rust-core/src/db.rs)
- [Windows input hooks](../apps/desktop/rust-core/src/hooks.rs)
- [WASAPI system audio](../apps/desktop/rust-core/src/loopback.rs)
- [Tauri application manifest](../apps/desktop/tauri-shell/src-tauri/Cargo.toml)
- [Tauri commands and shell operations](../apps/desktop/tauri-shell/src-tauri/src/lib.rs)
- [Tauri packaging configuration](../apps/desktop/tauri-shell/src-tauri/tauri.conf.json)
- [Rust motion engine](../renderer/motion-engine/src/lib.rs)
- [Rust export engine](../renderer/export-engine/src/lib.rs)
- [Current product flow](../apps/desktop/PRODUCT_FLOW.md)
- [Repository overview](../README.md)
- [Product requirements](PRODUCT_REQUIREMENTS.md)
