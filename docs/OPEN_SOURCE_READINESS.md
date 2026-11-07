# foOom open-source readiness audit

**Checked:** November 2, 2026  
**Status:** Needs work before describing a distributable release as fully open-source compliant. This is a repository inspection, not legal advice or a complete dependency-license scan.

## Verified state

- The repository root contains an [MIT LICENSE](../LICENSE) naming Harsh Bhardwaj and 2026.
- All five Rust package manifests currently declare `license = "MIT"` and the repository URL: `rust-core`, `shared-core`, `foOm` (Tauri shell), `motion-engine`, and `export-engine`.
- [README](../README.md) and [CONTRIBUTING](../CONTRIBUTING.md) identify MIT. The Tauri product description is now cross-platform/Windows-first.
- The Rust workspace lists the desktop shell, Rust core, shared core, motion engine, and export engine in root [Cargo.toml](../Cargo.toml). The npm/Bun workspace is private by design; `private: true` prevents accidental npm publication and does not contradict distribution of the source repository.
- [Cargo.lock](../Cargo.lock) exists in the working tree but was untracked at inspection. `bun.lockb` is modified, and the desktop package has a nested `bun.lock` visible in the lock metadata. CI uses `cargo --locked` and `bun install --frozen-lockfile`.
- Added root `SECURITY.md` and `THIRD_PARTY_NOTICES.md`. A separate code of conduct is not currently present.
- Windows workflows build and publish an installer. A separate [portable Rust workflow](../.github/workflows/portable-rust.yml) tests only `shared-core`, `motion-engine`, and `export-engine` across Windows, macOS, and Linux; this does not validate native desktop capture or packaging on those platforms.

## Release blockers

| Finding | Evidence | Required before a public binary/source release |
| --- | --- | --- |
| Lockfile reproducibility is not represented by the inspected working-tree status. | Root `Cargo.lock` is untracked; `bun.lockb` is modified. CI and release depend on locked/frozen installs. | Decide which Bun lockfile format is canonical, track the canonical Bun lock and `Cargo.lock`, and ensure clean-checkout locked/frozen CI passes. Do not assume an untracked lockfile will be included in a source archive. |
| Third-party license inventory and complete release source materials are missing. | Added [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The exact local sidecar reports FFmpeg 9.0.2 Gyan full build, `--enable-gpl`, `--enable-version3`, static, with no `--enable-nonfree`. The `web-demuxer` dependency and its FFmpeg-derived WASM were removed from the exporter; MediaBunny 1.45.4 (MPL-2.0) now supplies demuxing. Installed Bun metadata also identifies `lightningcss` as MPL-2.0 and `caniuse-lite` as CC-BY-4.0. | Produce an authoritative versioned dependency/asset inventory. Retain exact FFmpeg source/configuration materials, add corresponding source offers and required notices to app/site distributions, and verify CI uses the audited binaries. |
| Tauri copyright metadata was inconsistent with MIT during the initial audit. | `tauri.conf.json`, the Tauri About menu, and the Settings page now use MIT wording; a fresh Windows NSIS installer was built successfully after the change. | Confirm asset/code ownership provenance before public binary distribution. |
| Security reporting policy is newly added and needs operational ownership. | Root [SECURITY.md](../SECURITY.md) points to GitHub private vulnerability reporting but does not establish response-time or supported-version guarantees. | Confirm repository private reporting is enabled and assign maintainers to monitor it; add response expectations and supported-version policy when decided. |
| MIT header attribution and ownership scope are not proven for all shipped material. | The root LICENSE covers the project notice, but repository history/asset provenance and contributor rights were not audited. | Confirm rights for application code, visual assets, fonts, icons, website content, and earlier contributions. Ensure contributor terms or documented inbound=outbound policy is sufficient for maintainers. Add file-level notices where third-party licenses require them. |

## Follow-up risks

### Dependency-license scan

No authoritative locked dependency-license report has been generated. Cargo.lock contains 504 package versions (5 first-party and 499 external; 456 distinct external names). The prior Bun scan covered 553 unique names / 579 package versions and reported 17 license groups, including `Unknown` metadata for `web-demuxer@4.0.0` and transitive `exif-parser@0.1.12`. The demuxer package was subsequently removed from the desktop manifest and lockfile, and the exporter now uses MediaBunny. Installed-package metadata is not a reproducible license inventory from committed locks. Generate and preserve a lockfile-based report that includes build-time tools and shipped binary assets.

The npm scan also identified `mediabunny@1.45.4` as MPL-2.0, `lightningcss@1.32.0` and its Windows binary as MPL-2.0, and `caniuse-lite@1.0.30001793` as CC-BY-4.0. `lru-cache`, `minimatch`, and `sax` report BlueOak-1.0.0; `isbot` reports Unlicense. Confirm which artifacts/data are shipped, review MPL notice/source-modification obligations and any CC-BY attribution, and classify all 17 metadata groups.

### FFmpeg distribution

The current Windows CI/release workflows install FFmpeg with Chocolatey and copy the executable into Tauri's external binaries folder. `.gitignore` excludes the sidecar directory, so the executable is created during builds rather than tracked. The local build sidecar was inspected with `ffmpeg -version` and `-buildconf`: it reports `9.0.2-full_build-www.gyan.dev`, `--enable-gpl`, `--enable-version3`, and a static build. Gyan.dev identifies its builds as GPLv3 and lists FFmpeg commit `946fcce07b` for the 9.0.2 source. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Before shipping it:

1. Pin CI to the audited binary or record the exact FFmpeg package hash, source package, configure flags, and enabled codecs for every release.
2. Retain the exact FFmpeg and bundled external-library source/configuration materials required for the GPLv3 build; `THIRD_PARTY_NOTICES.md` currently records the upstream FFmpeg commit but is not a corresponding-source package.
3. Include applicable license texts, attribution, and the matching source offer with the distribution.
4. Put an FFmpeg/source notice next to the website download and verify the installer contains the notices.

Do not infer the binary's obligations from the Chocolatey package label alone; inspect the executable/build configuration that is actually bundled.

### Fonts and external resources

The web and desktop HTML load external fonts, and the desktop editor permits user-provided custom fonts. Confirm the external font provider's applicable license and privacy terms for shipped use. User-provided fonts remain the user's responsibility, but clarify whether foOom embeds, copies, or redistributes them. Search all bundled images, logos, wallpapers, and demo media for provenance and license records.

### Releases and supported platforms

The Windows release workflow publishes on version tags with `contents: write` and updater-signing secrets; signing secrets are scoped to the release job rather than the Windows pull-request workflow. Keep release secrets inaccessible to untrusted pull requests and add a release checklist that confirms license/notice files, dependency inventory, checksums, changelog, and artifact contents before publishing.

Do not claim macOS/Linux native support based on the portable Rust CI matrix. The current native capture modules, Windows packaging, and FFmpeg sidecar preparation are Windows-specific. Keep public platform claims aligned with completed native capture, permission handling, packaging, and end-to-end verification.

## Prioritized actions

### P0 before declaring source and releases ready

1. Track `Cargo.lock` and the chosen Bun lockfile; prove clean checkout locked builds.
2. Retain GPLv3 FFmpeg source/configuration materials, then audit all direct/transitive dependency licenses and ship required notices/source materials.
3. Audit copyright ownership/provenance for application code and shipped assets.
4. Confirm GitHub private vulnerability reporting is enabled and assign a monitoring owner.
5. Add a repeatable dependency-license inventory job to CI and a release artifact check for notices.

### P1 for a healthy public project

1. Add contributor code-of-conduct and maintainer/release policy if desired by maintainers.
2. Document the contribution licensing arrangement and third-party asset policy.
3. Pin toolchain versions used for releases instead of `bun-version: latest`; record FFmpeg and tool versions in release notes/SBOM.
4. Generate an SBOM for each binary release and retain checksums and provenance.
5. Keep Windows support claims distinct from portable-core build coverage and future macOS/Linux targets.

## Evidence boundaries

This audit inspected manifests, existing docs, lockfile presence/status, and workflow configuration. It did not enumerate every dependency's license, inspect the built installer contents, examine repository history/author rights, validate FFmpeg build flags, or seek legal advice. Therefore the verified claim is that MIT metadata and a root license are present; a complete open-source compliance or release-readiness claim is not yet supported.
