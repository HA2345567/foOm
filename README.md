# foOom — Cinematic Screen Recorder with Auto-Zoom

foOom is an open-source-first desktop screen recorder built with Tauri 2, Rust, React, and TypeScript. Windows is the first native capture target. macOS and Linux are planned over a shared Rust core; their native capture backends are not yet implemented or verified. The editor adds cursor-driven zooms, backgrounds, webcam composition, annotations, trims, and speed changes before MP4 or GIF export. foOom is licensed under MIT; see [LICENSE](LICENSE) and the [third-party notices](THIRD_PARTY_NOTICES.md), including the Windows FFmpeg sidecar's GPLv3 details.

The product category reference is [Screen Studio](https://screen.studio/); foOom uses its own code, design, and brand. The product requirements and research distinguish implemented features from planned and unverified behavior. See the [Screen Studio research](docs/SCREEN_STUDIO_RESEARCH.md), [product requirements](docs/PRODUCT_REQUIREMENTS.md), and [platform architecture](docs/PLATFORM_ARCHITECTURE.md).

## Workspace

| Directory | Responsibility |
| --- | --- |
| `apps/desktop/ui-react` | Recording toolbar, source picker, editor, preview, WebCodecs export |
| `apps/desktop/tauri-shell/src-tauri` | Native windows, IPC commands, file dialogs, packaging |
| `apps/desktop/rust-core` | Windows Graphics Capture, input telemetry, WASAPI loopback, local SQLite projects |
| `apps/desktop/shared-core` | Portable project-document schema and OS-neutral capture contracts |
| `apps/desktop/ui-react/src/lib/exporter` | WebCodecs decode/encode, PixiJS composition, MP4/GIF muxing, audio processing |
| `renderer/export-engine` | Native FFmpeg conversion and cancellation for supported source-copy exports |
| `apps/web` | Website and installer download page |

### Desktop feature map

- `components/launch` and `routes/source-selector.tsx` implement the recording toolbar and capture-source picker.
- `hooks` and `native` connect the React UI to screen, microphone, camera, and system-audio capture in the Tauri shell.
- `components/vedio-editor` contains the timeline, canvas styling, cursor, audio, captions, webcam, and export controls.
- `lib/exporter` decodes media, renders the edited composition, encodes MP4/GIF, and reports export progress.
- `apps/desktop/tauri-shell/src-tauri/src/lib.rs` registers native commands and owns window and file-dialog behavior.
- `apps/desktop/rust-core` implements Windows capture, input events, audio loopback, and local project storage.

## Windows development

Install Bun, Node.js 22 LTS, a current Rust stable toolchain with the MSVC target, Visual Studio C++ Build Tools, WebView2, and FFmpeg. Put FFmpeg on PATH, or set `FFMPEG_PATH` to the full executable path. The desktop app does not require the website's database, payment, or email credentials.

From the repository root:

```powershell
bun install --frozen-lockfile
bun run dev:tauri
```

Tauri prepares its FFmpeg sidecar and starts the Vite server on port 5174. The floating recording toolbar is the desktop entry point. `bun run dev:desktop` starts only the React UI, which cannot exercise native capture without Tauri.

## Verification

```powershell
bun run typecheck:desktop
bun run test:desktop
bun run prepare:desktop
cargo test --workspace --locked
bun run build:desktop-ui
```

Browser export tests require a Playwright browser:

```powershell
cd apps/desktop/ui-react
bun x playwright install chromium
bun run test:browser
```

The explicit WASAPI hardware test requires an enabled Windows output device:

```powershell
cargo test -p rust-core captures_loopback_wav_and_removes_pause -- --ignored --nocapture
```

## Build an installer

```powershell
bun run build:desktop
```

This checks desktop types and unit tests, builds the React UI and Tauri application, and copies the NSIS installer to `apps/web/public/downloads/foom-setup.exe`. A custom `CARGO_TARGET_DIR` is supported. For a direct Tauri build, run `bun run tauri build -- --locked`.

The Windows workflows verify desktop types, unit tests, Rust tests, and compilation. Tagged release builds publish through the existing GitHub Actions workflow.

## Export and current limitations

MP4 export uses a source-copy fast path when no edit changes the frames. Edited exports use WebCodecs and the editor compositor, preferring hardware encoding and falling back to software encoding when the device cannot initialize a hardware encoder. The compositor still renders output frames sequentially, so complex compositions and high resolutions can take longer than real time. GIF export is also a frame-rendering workload.

The editor supports adding an audio soundtrack and timed captions. Automatic captions and noise reduction depend on their configured providers and device support. Native capture and installer configuration currently target Windows; a portable web editor does not establish macOS or Linux capture support.

## Website

```powershell
bun run dev:web
bun run build:web
```

The website runs on port 8080. Its deployment integrations are separate from desktop recording.
