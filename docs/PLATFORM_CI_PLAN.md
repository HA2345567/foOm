# foOom cross-platform CI and release plan

**Purpose:** Stage CI and release support for a Windows-first desktop app that intends to support Windows, macOS, and Linux over a shared Rust core.  
**Status:** Recommendation; no workflows were changed or run as part of this analysis.  
**Basis:** Current workflow, Cargo/Tauri configuration, package scripts, and the open-source-first direction in `docs/PRODUCT_REQUIREMENTS.md`.

## Current state

| Area | Observed repository state | Consequence |
| --- | --- | --- |
| Pull request CI | `.github/workflows/windows-native-check.yml` runs on `windows-latest`. It installs Bun/Node/Rust, FFmpeg via Chocolatey, prepares a Windows FFmpeg sidecar, builds the UI, runs desktop TypeScript tests and Rust workspace tests, checks the Tauri workspace, then builds the Tauri app. | This is a useful Windows integration gate. It currently does not validate macOS/Linux builds. |
| Tagged release | `.github/workflows/publish-windows-release.yml` builds and publishes one Windows Tauri installer through `tauri-apps/tauri-action@v0`. It requires GitHub release-write permission and Tauri updater signing secrets. | Tags currently publish only the Windows artifact. Release secrets must not be required for PR validation. |
| Rust workspace | Root `Cargo.toml` includes Tauri, `rust-core`, `motion-engine`, and `export-engine`. The motion and export engine manifests use portable Rust/Serde dependencies. | The renderer crates are the clearest initial candidates for Linux/macOS CI. Workspace-wide testing is not yet evidence of cross-platform support. |
| Native capture | `apps/desktop/rust-core/Cargo.toml` has an unconditional `windows` dependency with WinRT/Win32 features. `capture.rs`, `hooks.rs`, and `loopback.rs` use Windows APIs; most source is not fully target-gated. | `rust-core` cannot yet be treated as a portable crate. Cross-target/full-workspace checks are blocked until native code is isolated behind target-specific adapters. |
| Tauri shell | `apps/desktop/tauri-shell/src-tauri/src/lib.rs` contains some `cfg` branches for Windows/macOS, but imports and commands still call Windows-only `rust-core` APIs. The Tauri manifest has only a small `cfg(windows)` dependency block. | A Tauri macOS/Linux build is not currently proven and likely cannot compile until the core API and native commands are separated. |
| FFmpeg | `scripts/prepare-desktop.ps1`, the Windows workflows, the Tauri `externalBin` declaration, and hard-coded Windows sidecar filenames in capture/shell code prepare `ffmpeg-x86_64-pc-windows-msvc.exe`. | A per-target FFmpeg acquisition/naming strategy is required for macOS/Linux; do not reuse the Windows binary in other bundles. |
| Tauri packaging | `apps/desktop/tauri-shell/src-tauri/tauri.conf.json` sets bundle target `nsis` and specifies Windows/macOS icon formats and Windows NSIS options. | Bundle targets and native dependencies must be configured per OS. Build artifacts need host-native runners. |
| Build scripts | Root `package.json` calls PowerShell from `prepare:desktop`; the Tauri `beforeDevCommand`/`beforeBuildCommand` run this preparation step. | Full Tauri packaging on macOS/Linux is blocked until these scripts are platform-neutral or dispatched by OS. |
| Open-source release metadata | `apps/desktop/tauri-shell/src-tauri/Cargo.toml` currently declares `license = "Proprietary"` and an empty repository URL. The maintainer has selected MIT. Workflows use `--locked`, while `Cargo.lock` is currently untracked in the inspected checkout. | Add the MIT license, align package metadata, and commit lockfiles before public release. |

The assessment is static. No Linux/macOS build was attempted, so “blocked” is based on the concrete platform-specific code and build configuration above, not on a recorded compiler failure.

## Recommended staged matrix

### Stage 0: Keep Windows as the required integration gate

Continue to run a full Windows build on PRs and pushes. Separate fast checks from slower packaging so developers get quick feedback, but keep at least one required Windows job covering:

- frozen Bun install and desktop UI build/typecheck/tests;
- Rust workspace tests and Tauri compile check;
- Windows FFmpeg sidecar preparation;
- unsigned Tauri installer build (signing only for release).

The current `windows-native-check.yml` already covers these areas, although it uses `bun-version: latest` and downloads FFmpeg on each run. Pinning the Bun version to a known-good value and caching downloads/build output can make CI repeatable and faster. Avoid reworking this workflow while its current uncommitted edits are active.

### Stage 1: Add portable-core CI before platform ports

Create a CI job that explicitly targets only portable crates and tests, initially on Linux and later as a 3-OS matrix:

| Job | Windows | macOS | Linux | Scope |
| --- | --- | --- | --- | --- |
| Frontend build/typecheck/unit tests | Yes | Yes | Yes | React/Vite workspace only; no native capture claim. |
| `motion-engine` test/check | Yes | Yes | Yes | Portable Rust math/data behavior. |
| `export-engine` test/check | Yes | Yes | Yes | Portable code paths and command construction; actual FFmpeg packaging remains a host integration check. |
| `rust-core` full check | Windows only initially | Blocked | Blocked | Expand after separating shared project/storage code from Windows capture/hooks/audio modules. |
| Tauri desktop build | Windows only initially | Blocked | Blocked | Expand after shell/native APIs, preparation scripts, FFmpeg and bundler targets are ported. |

Use package-level `cargo test -p motion-engine --locked` and `cargo test -p export-engine --locked` to avoid implying the entire Rust workspace is portable. Add a Linux job for those package tests as the first concrete cross-platform CI increment, after confirming the current manifests resolve with the committed lockfile.

Do not globally gate `cargo test --workspace` on Linux or macOS until the native modules have target-specific implementations or compile-time exclusions and the Tauri shell has matching capability handling.

### Stage 2: macOS native build and CI

After a macOS capture/audio backend and shell capability layer exist:

- Add a `macos-latest` PR job for UI checks, all shared Rust crate tests, `rust-core` tests, and `cargo check` for the Tauri shell.
- Add a full Tauri bundle job with macOS-specific FFmpeg sidecar, bundle targets, entitlements/permissions, icons, and native prerequisites.
- Keep signing/notarization secrets out of pull-request jobs. Gate signed/notarized artifacts to trusted tags or protected release workflows.
- Run capture tests on macOS runners where APIs and permissions permit; label tests that require an interactive screen, camera, or microphone as manual/hardware tests rather than silently skipping them.

### Stage 3: Linux native build and CI

After Linux capture is implemented and supported desktop/compositor environments are defined:

- Add an `ubuntu-latest` PR job for UI, portable Rust crates, Linux `rust-core`, and Tauri compile/build checks.
- Install the documented Tauri system packages (WebKitGTK and other required libraries) before building.
- Package only tested formats (for example, AppImage/deb) and verify FFmpeg sidecar naming and runtime linking.
- Document the supported environment boundary (such as X11/Wayland and relevant portal support); “Linux” alone is not a sufficient compatibility claim.
- Keep screen-capture integration tests separately labeled because ordinary headless CI cannot prove a real desktop capture path.

### Stage 4: Release artifacts for all supported OSes

Keep release packaging native to each OS rather than cross-compiling full desktop bundles from a single runner:

| Runner | First artifact | Release-specific checks |
| --- | --- | --- |
| `windows-latest` | NSIS installer | unsigned PR bundle; release signing/update secrets only on trusted tag |
| `macos-latest` | DMG or app archive, once supported | code signing, notarization, privacy permissions, updater signature |
| `ubuntu-latest` | AppImage/deb, once supported | required runtime libraries, desktop metadata, AppImage/deb smoke checks |

The release workflow should build a matrix keyed by OS/target, upload each artifact once, and publish checksums and release notes. Release jobs should use least-privilege `contents: write`; fork PRs must never receive signing keys. Do not enable a platform in the public download UI until its artifact is built and smoke-tested.

## Open-source and reproducibility prerequisites

Before the first public source release:

1. Add the maintainer-selected MIT license; update `Cargo.toml` package metadata and include the actual `LICENSE` file. Do not label a proprietary build “open source.”
2. Set repository URLs and consistent app/package metadata in the Rust manifests, Tauri config, web download page, and project docs.
3. Track `Cargo.lock` and `bun.lockb`; preserve `--locked` and `bun install --frozen-lockfile` in CI/release.
4. Publish clean-checkout Windows build steps and later platform-specific prerequisite/install steps.
5. Add contribution and code-of-conduct decisions, third-party notices, dependency/license inventory, and a private security-reporting path.
6. Document platform support and known hardware/API limitations; distinguish shared-core build coverage from native capture verification.
7. Ensure untrusted PR workflows run without signing secrets and avoid executing untrusted code in privileged `pull_request_target` contexts.

## Immediate sequence

1. Preserve the current Windows CI/release changes and establish their passing state after they are ready to validate.
2. Add portable CI for `motion-engine` and `export-engine` on Linux; this demonstrates shared Rust behavior without claiming native capture support.
3. Split `rust-core` into shared data/project logic and OS-specific capture, hooks, and audio implementations; keep Windows behavior as the compatibility baseline.
4. Make FFmpeg acquisition, sidecar path, and Tauri bundle targets host/target aware.
5. Port the Tauri shell and permission handling to macOS; add native build checks.
6. Port the Tauri shell/capture to the declared Linux environment; add native build checks.
7. Enable staged macOS/Linux release artifacts only after native end-to-end verification.

## Source files reviewed

- `.github/workflows/windows-native-check.yml`
- `.github/workflows/publish-windows-release.yml`
- `Cargo.toml`
- `apps/desktop/rust-core/Cargo.toml`
- `apps/desktop/rust-core/src/capture.rs`
- `apps/desktop/rust-core/src/hooks.rs`
- `apps/desktop/rust-core/src/loopback.rs`
- `apps/desktop/tauri-shell/src-tauri/Cargo.toml`
- `apps/desktop/tauri-shell/src-tauri/src/lib.rs`
- `apps/desktop/tauri-shell/src-tauri/tauri.conf.json`
- `renderer/export-engine/Cargo.toml`
- `renderer/export-engine/src/lib.rs`
- `renderer/motion-engine/Cargo.toml`
- `package.json`
- `apps/desktop/ui-react/package.json`
- `scripts/prepare-desktop.ps1`
- `docs/PRODUCT_REQUIREMENTS.md`
