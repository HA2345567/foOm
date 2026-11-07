# Contributing to foOom

foOom is being developed as an open-source-first desktop recorder. Windows is the first complete platform. macOS and Linux support is planned around a shared Rust core and platform-specific adapters; native capture on those systems is not currently verified. Contributions that improve the Windows workflow or prepare well-scoped portable core and adapter work are welcome.

## Development setup

The current supported development path is Windows. From a clean checkout, install Bun, Node.js 22 LTS, the current stable Rust toolchain with the MSVC target, Visual Studio C++ Build Tools, WebView2, and FFmpeg. Add FFmpeg to `PATH` or set `FFMPEG_PATH` to its full executable path. Website database, payment, and email credentials are not required to build the desktop app.

```powershell
git clone https://github.com/HA2345567/foOm.git
cd foOom
bun install --frozen-lockfile
bun run dev:tauri
```

`bun run dev:tauri` starts the native Tauri desktop app and its Vite UI. `bun run dev:desktop` starts only the React UI and cannot exercise native capture. See [README.md](README.md) for installer and website commands.

## Before opening a pull request

Run the checks that cover your changes. The current Windows workflow runs desktop type checking and tests, Rust workspace tests, Tauri compilation, and a desktop build. Hardware capture behavior still needs a real Windows session; a passing UI or Rust test does not prove screen, camera, or audio capture works.

```powershell
bun run typecheck:desktop
bun run test:desktop
cargo test --workspace
bun run build:desktop-ui
```

For changes to browser-based export, install the Playwright browser and run the browser test suite:

```powershell
cd apps/desktop/ui-react
bun x playwright install chromium
bun run test:browser
```

For changes to WASAPI loopback capture, the explicit hardware test requires an enabled Windows output device:

```powershell
cargo test -p rust-core captures_loopback_wav_and_removes_pause -- --ignored --nocapture
```

When a change affects capture-to-export behavior, describe the manual path you exercised and note the OS, display setup, and audio devices involved. Do not report macOS or Linux support based only on compiling portable UI or Rust code.

## Coding and review expectations

- Keep changes focused and preserve unrelated work in the checkout.
- Keep portable project, timeline, and media behavior in shared Rust code where practical. Put native screen capture, permissions, device access, and system audio behind platform-specific adapters.
- Preserve existing Tauri/React contracts unless the change includes the corresponding UI and bridge updates.
- Report platform capability limits directly. Do not display an unsupported operation as successful.
- Do not include private screen recordings, credentials, or personal data in issues, logs, or pull requests. Redact paths and identifiers when sharing diagnostics.
- ESLint and Prettier are configured for `apps/desktop/ui-react`; use `bun run lint` and `bun run format:check` from that package when changing its files. The Windows workflow currently enforces type checking, tests, and builds; it does not establish a macOS/Linux release check.
- Rust code should pass `cargo fmt --all -- --check` and the relevant Rust tests.

There is no repository-specific branch naming or commit message convention documented yet. Keep pull requests small, explain the user-visible behavior, list the checks run, and include screenshots or a short screen recording for visible UI changes when it can be shared safely.

## Reporting bugs and requesting features

Open an issue at [GitHub Issues](https://github.com/HA2345567/foOm/issues). Include:

- the operating system and version, plus relevant hardware, display, and audio setup;
- steps to reproduce, expected behavior, and actual behavior;
- app version and relevant redacted logs or error messages;
- whether the issue occurs with a new recording/project or an existing one.

For feature requests, describe the task you are trying to complete and what currently makes it difficult. Do not attach a recording that contains private information; provide a minimal synthetic sample or a description instead.

## License

foOom is distributed under the [MIT License](LICENSE). Contributions are submitted under the same license.
