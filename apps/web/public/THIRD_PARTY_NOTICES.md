# Third-party notices

foOom is licensed under MIT. Third-party components retain their own licenses.

## FFmpeg sidecar

The Windows sidecar inspected for the November 2, 2026 build reports:

- FFmpeg `9.0.2-full_build-www.gyan.dev`, release build dated September 19, 2026.
- Configure flags include `--enable-gpl` and `--enable-version3`; the binary reports a static build and does not list `--enable-nonfree`.
- Gyan.dev identifies its Windows builds as GPLv3. FFmpeg's licensing page explains that enabling GPL components makes the FFmpeg build GPL covered.
- The associated upstream source revision listed by Gyan.dev is [FFmpeg commit 946fcce07b](https://github.com/FFmpeg/FFmpeg/commit/946fcce07b). The build provider is [Gyan.dev FFmpeg builds](https://www.gyan.dev/ffmpeg/builds/).

This notice records the local binary inspected; it does not establish that future CI downloads use the same build. The exact package, build configuration, source for the bundled external libraries, and release source offer must be captured for every shipped installer. Until that material is available and reviewed, the installer should not be represented as fully license-audited or published as a release.

The bundled FFmpeg is a separate executable invoked by foOom. It is not relicensed by foOom's MIT license. Keep applicable license texts and corresponding source materials available with any distribution, and include a clear FFmpeg/source notice on the download page when binary distribution is enabled.

## MediaBunny

The desktop UI uses `mediabunny` 1.45.4 for media demuxing. Its package metadata identifies Mozilla Public License 2.0 (MPL-2.0); retain the applicable license text and review MPL file-level obligations for any modified package files before distribution.

The prior `web-demuxer` dependency and its FFmpeg-derived WebAssembly were removed from the desktop dependency graph and exporter. A full lockfile-based license inventory and a clean build review are still required before claiming release compliance.

## Other identified package licenses

The current Bun-installed metadata scan identified:

- `mediabunny` 1.45.4: Mozilla Public License 2.0 (MPL-2.0).
- `lightningcss` 1.32.0 and its Windows binary: MPL-2.0.
- `caniuse-lite` 1.0.30001793: Creative Commons Attribution 4.0 (CC-BY-4.0) metadata; determine whether its data is distributed and include attribution if required.
- `lru-cache`, `minimatch`, and `sax`: BlueOak-1.0.0; `isbot`: Unlicense.

These versions and expressions come from installed package metadata, not a reviewed lockfile-based legal inventory. Include the applicable license texts/attribution with distributed artifacts after checking which packages and data are shipped. This list is incomplete.

## Remaining inventory

An authoritative inventory of Rust, Bun, font, icon, and media dependencies has not yet been generated. This file is not a substitute for that inventory or for release-specific notices required by those components.
