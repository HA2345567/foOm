# foOom product requirements document

**Status:** Draft for product review  
**Date:** November 2, 2026  
**Product:** foOom, cross-platform desktop screen recorder and focused video editor  
**Research basis:** [Screen Studio product research](SCREEN_STUDIO_RESEARCH.md)

## 1. Product vision

foOom helps people turn a screen walkthrough into a clear, polished video without learning a full video editor. A user should be able to record once, let foOom prepare useful cursor and zoom motion, make a few corrections, and export a video that looks intentional. foOom is open source first, with a shared Rust core and platform-specific capture and system integrations for Windows, macOS, and Linux.

Windows is the first supported platform and receives the first complete release. macOS and Linux are planned targets, not indefinite non-goals: platform boundaries and the Rust core must be designed so they can be added without forking product logic. The product follows the Screen Studio category workflow while using foOom's own design, implementation, and brand. It must not copy Screen Studio's proprietary assets, code, or marketing materials.

## 2. Problem statement

People who teach, demo, document, or promote software need screen recordings that are easy to follow. Raw recordings often have tiny UI details, distracting cursor movement, dead air, awkward framing, and a lot of manual editing work. General-purpose editors can fix these issues but demand time and editing skill. Many quick recorders capture a flattened video that cannot later adjust cursor behavior or focus intelligently.

foOom's opportunity is to combine reliable native capture with editable capture telemetry and a focused editor that automates the tedious polish while keeping corrections easy. A shared Rust core should keep project data, media orchestration, timing, and composition behavior consistent across operating systems while thin platform adapters handle capture, permissions, devices, and codecs.

## 3. Target users and jobs

### Primary users

- **Product builders and founders:** show a feature, workflow, or bug reproduction clearly.
- **Educators and technical writers:** create tutorials and course lessons with readable detail.
- **Product marketers and creators:** make polished launch, onboarding, and social clips.

### Secondary users

- Small teams that reuse visual presets and review recordings together.
- Support and customer success staff creating short asynchronous explanations.

### Jobs to be done

- When I explain software on screen, help me capture the important action and make it easy to follow.
- When a recording is finished, give me a polished first draft without requiring timeline expertise.
- When automation gets something wrong, let me fix the result quickly and predictably.
- When I need to share the result, let me export a portable file that plays reliably.

## 4. Product goals and non-goals

### Goals

1. Make first successful recording and export simple enough for a new user to complete without a tutorial.
2. Produce readable, composed videos with useful cursor and zoom behavior by default.
3. Preserve editable project data and recover work after interruptions.
4. Keep capture, editing, and local export dependable on supported Windows hardware.
5. Support common output shapes and quality levels without hand-rebuilding the composition.
6. Make permission, disk, export, and privacy states understandable.
7. Establish a clean open-source project with a documented license, build instructions, contribution path, and reproducible cross-platform CI.
8. Ship Windows first, then bring macOS and Linux to functional parity through platform adapters over the shared Rust core.

### Non-goals for the first release scope

- Replacing a professional multitrack/non-linear video editor.
- Real-time streaming, remote desktop control, or browser-based capture.
- Cloud accounts, hosted video links, comments, team administration, and billing.
- Shipping macOS/Linux before the Windows vertical slice is reliable.
- Requiring AI or cloud processing for the core recording/edit/export journey.
- Making essential local recording and export features paid-only; monetization may fund optional hosted services or support, subject to a separate decision.

## 5. Product principles

- **Record first:** put capture and source selection ahead of project-management complexity.
- **Useful defaults:** automation should save time on the first pass, then expose direct corrections.
- **Preview is trustworthy:** what the editor shows should match the exported result closely.
- **Local by default:** core capture, editing, persistence, and export work offline and without an account.
- **Shared core, native edges:** product rules and project behavior live in Rust core modules; OS-specific capture and device APIs stay behind platform interfaces.
- **Open source first:** users can inspect, build, and contribute to the application; no account or proprietary service is required for local workflows.
- **Recoverable work:** autosave, safe project updates, and clear export failure handling protect user effort.
- **Focused editing:** optimize for demos and tutorials rather than feature breadth of a full NLE.
- **Honest capability states:** never show an unavailable operation as if it succeeded.

## 6. Core user journey

1. User launches foOom and sees the floating recording toolbar.
2. User selects display/window/region, microphone, webcam, system audio, cursor mode, and zoom behavior.
3. foOom validates permissions and device availability and shows a clear readiness state.
4. User records and pauses/stops from visible controls or a configurable shortcut.
5. foOom finalizes the video and time-aligned metadata, then opens the editor automatically.
6. The editor presents a playable preview and a first-pass composition with cursor effects and suggested zooms.
7. User retargets/adds/removes zooms, trims or cuts unwanted sections, adjusts camera/background/framing, and reviews audio.
8. User selects aspect ratio and export format/quality, sees an estimate and progress, and saves the output.
9. The saved project remains available for later editing or export.

## 7. Functional requirements

Priority key: **P0** required for core product; **P1** important follow-up; **P2** later opportunity.

### 7.1 Recording and source selection

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| REC-01 | P0 | Launch into an accessible recording toolbar. | User can open source selection and reach Record without first navigating project management. |
| REC-02 | P0 | Capture a selected display, window, or region. | User sees the selected source before recording; missing/closed sources produce a recoverable message. |
| REC-03 | P0 | Select microphone and webcam devices independently. | Device names and live mic level are visible; unavailable devices are explained before start. |
| REC-04 | P0 | Record system audio when enabled. | User can distinguish system audio from mic audio and disable either before recording. |
| REC-05 | P0 | Record editable cursor telemetry and click events when editable cursor mode is selected. | A completed project retains time-aligned cursor data and does not display a duplicate baked cursor. |
| REC-06 | P0 | Offer visible stop/pause controls and configurable global start/stop shortcut. | User can stop safely without returning focus to the app; shortcut conflicts are reported. |
| REC-07 | P0 | Show recording state and elapsed time. | Active recording is clearly identifiable, including when the main editor is not focused. |
| REC-08 | P1 | Resume/recover an interrupted recording where technically possible. | App restart offers the last recoverable project and explains missing or partial assets. |
| REC-09 | P1 | Estimate storage impact and handle low disk space. | Warn before or during capture when space is low; finalization never silently discards the captured file. |

### 7.2 Automatic polish and cursor

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| POL-01 | P0 | Generate an initial zoom pass from click/focus telemetry. | Zoom events appear on a dedicated timeline; user can disable automatic zoom globally or per event. |
| POL-02 | P0 | Let users add, retarget, resize, reposition, and remove a zoom. | User can correct a poor target without re-recording; changes appear in preview and export. |
| POL-03 | P0 | Smooth editable cursor movement and adjust cursor visibility/size after capture. | Effect settings are reversible and do not alter the source recording. |
| POL-04 | P1 | Support click emphasis (visual ripple and optional click sound). | User can enable/disable effect and preview it in context. |
| POL-05 | P1 | Hide an idle cursor and optionally return it to its starting point for loopable clips. | User can configure idle delay and loop behavior; result is visible in preview. |
| POL-06 | P1 | Provide readable zoom animation controls with safe defaults. | Zoom duration and easing are adjustable; transitions do not introduce abrupt framing jumps. |

### 7.3 Editing and composition

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| EDT-01 | P0 | Preview and scrub the complete recording with timeline navigation. | Playback controls, timecode, and frame stepping operate predictably. |
| EDT-02 | P0 | Trim start/end and cut unwanted ranges. | Timeline reflects edits; undo/reopen preserves the same edit decisions. |
| EDT-03 | P0 | Adjust video speed for selected ranges. | Selected range and resulting duration are clear; audio behavior is defined and previewable. |
| EDT-04 | P0 | Compose webcam as an adjustable overlay. | Position, size, shape, and mirror state persist and render identically in output. |
| EDT-05 | P0 | Configure screen framing with background, padding, corner radius, and shadow. | User can save a preset and the composition adapts to chosen output ratio. |
| EDT-06 | P1 | Change output ratio between 16:9, 1:1, and 9:16. | Camera and screen framing adapt; zoom targets remain useful and never crop away the active focus by default. |
| EDT-07 | P1 | Add masks/highlights to hide or emphasize screen regions. | Mask coordinates persist relative to the composition and are visible in final export. |
| EDT-08 | P1 | Add background music and independently adjust track/voice volume. | Music can be trimmed/looped to duration; no unexpected clipping or audio drift. |
| EDT-09 | P1 | Provide safe project save, autosave, backups, and recent-project access. | App restart restores last saved state; interrupted writes leave a recoverable prior version. |

### 7.4 Captions and audio improvements

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| AI-01 | P1 | Generate editable captions from microphone audio locally when supported. | User can inspect and correct transcript; processing status and model/device requirements are clear. |
| AI-02 | P1 | Export captions embedded and/or as SRT. | SRT timing follows trims, cuts, and speed changes. |
| AI-03 | P2 | Offer microphone noise reduction as an explicit post-recording option. | Original audio is retained; before/after preview and processing state are available. |
| AI-04 | P2 | Offer transcript-based editing after transcript quality is validated. | Removing selected words removes the matching range; user can undo and inspect boundaries before applying. |

### 7.5 Export and delivery

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| EXP-01 | P0 | Export MP4 locally using standard playback-compatible encoding. | Output opens in common Windows players and duration/audio match the project. |
| EXP-02 | P0 | Provide clear resolution, frame-rate, and quality presets including 720p and 1080p. | Preset labels explain the quality/file-size tradeoff; unsupported settings are disabled with reason. |
| EXP-03 | P0 | Show export progress, destination, cancellation, and actionable errors. | Cancel cleans temporary output safely; failure never replaces a prior good export silently. |
| EXP-04 | P0 | Save and reopen an editable project separately from the final video. | Project references its media safely and reports missing assets with relink/recovery options. |
| EXP-05 | P1 | Export GIF with size/frame-rate controls for short clips. | GIF settings are visible and file-size expectations are given. |
| EXP-06 | P1 | Export 4K/60 where hardware, source, and encoder support it. | UI reports actual output dimensions/frame rate and gracefully falls back when unsupported. |
| EXP-07 | P2 | Generate optional hosted share links with privacy controls and timestamp comments. | Upload is explicit; owner can revoke/delete links and viewers cannot access private links without authorization. |
| EXP-08 | P2 | Share editable projects through an authenticated transfer. | Recipient requirements, project size, access, version compatibility, and deletion are clear. |

### 7.6 Cross-platform core and open-source project

| ID | Priority | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| CORE-01 | P0 | Keep project format, timeline rules, telemetry interpretation, and media workflow in shared Rust core modules where practical. | Platform-specific implementations cannot silently fork project semantics; shared modules build and have automated coverage on all target OSes. |
| CORE-02 | P0 | Define platform adapter interfaces for screen/window/region capture, system audio, camera/microphone enumeration, permissions, and encoding. | Windows backend implements the first full workflow; unavailable platform capabilities report explicit status through the shared contract. |
| CORE-03 | P0 | Version the on-disk project format and provide migration handling. | Projects created on one supported platform can be opened on another when codecs and assets are available; unsupported versions fail safely with a recovery path. |
| CORE-04 | P0 | Publish the source repository under the maintainer-selected MIT license. | Root LICENSE, package metadata, third-party notices, build prerequisites, and contribution instructions agree before public release. |
| CORE-05 | P0 | Keep local core functionality usable without proprietary accounts, cloud APIs, or paid activation. | A clean install can record, edit, save, and export locally without sign-in or network access. |
| CORE-06 | P1 | Add macOS capture and device adapters using native APIs while reusing shared project/editor behavior. | Supported macOS builds pass the published capture-to-export acceptance flow and declare OS/hardware support. |
| CORE-07 | P1 | Add Linux capture and device adapters behind the same contracts. | Supported Linux desktop/compositor environments pass the published acceptance flow; unsupported environments are clearly identified. |
| CORE-08 | P1 | Run CI builds and core tests for Windows, macOS, and Linux. | Pull requests receive per-platform build status; platform-specific capture tests are separated from portable core tests. |
| CORE-09 | P1 | Document contribution, issue reporting, security reporting, and release processes. | Contributors can build the app from a clean checkout using published steps; security reports have a private disclosure route. |

## 8. Non-functional requirements

- **Reliability:** recording must preserve the source file even if metadata generation or optional composition fails.
- **Data integrity:** project writes are atomic or recoverable; a crash must not corrupt the last known-good saved project.
- **Performance:** editor remains responsive while generating previews/exports; long jobs expose progress and cancellation.
- **Parity:** preview and export use shared composition math and are visually consistent within defined rendering tolerances.
- **Compatibility:** supported OS versions, desktop environments, GPU/encoder requirements, and permissions are listed before installation or capture.
- **Accessibility:** controls are keyboard operable, labeled for assistive technology, and have visible focus states.
- **Privacy:** local features run without an account; any upload or remote processing is opt-in and described at point of use.
- **Observability:** errors include a user-readable message and diagnostic details that can be copied without exposing recording content by default.
- **Maintainability:** native capture, project model, editor composition, and export share explicit versioned contracts.

## 9. Success metrics

Instrument only with appropriate consent and avoid collecting recording contents.

### Activation

- Time from first launch to first successful local export.
- Percentage of new users who complete a recording and export within the first session.
- Rate of recording starts abandoned before a usable project is opened.

### Quality and trust

- Export failure rate and export cancellation rate.
- Recording finalization failures and recoverable-project rate.
- Preview/export mismatch reports.
- Median number of manual zoom corrections per recording (track as product health, not as a lower-is-always-better target).

### Retention and value

- Projects with a second edit/export session.
- Repeat recordings per active user.
- Optional hosted-share creation and viewer completion, only after sharing exists.

Targets should be set after baseline data from a pilot; do not invent numeric thresholds before observing real use.

## 10. Release plan

### Foundation: shared core and Windows vertical slice (P0)

Define and publish the shared Rust core contracts, versioned project format, open-source license, build/contribution docs, and cross-platform CI skeleton. Complete and harden the Windows source selection, mic/webcam/system audio, editable cursor telemetry, automatic zoom draft, timeline corrections, basic composition, local MP4 export, autosave/recovery, and actionable failure states. Windows is the first full platform release.

### Polish: social and tutorial output (P1)

Add ratio adaptation, more cursor/click effects, presets, GIF, captions/SRT, music controls, masks/highlights, and supported 4K/60 export. Validate each on representative Windows hardware.

### macOS and Linux support (P1)

Implement native capture, device, permission, and encoding adapters for macOS and Linux over the shared core. Bring platforms to the published functional acceptance flow in separate releases, based on API and hardware support. Keep capability gaps explicit while each port is in progress.

### Collaboration and advanced processing (P2)

Consider optional hosted links, private access, comments, project collaboration, advanced camera layouts/cutout, noise cleanup, and transcript editing after storage/security/support costs and user demand are known.

## 11. Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Automatic zoom is wrong or disorienting | Provide manual retargeting and per-event suppression; test real walkthroughs and keep conservative defaults. |
| Long recordings exhaust memory/disk or fail late | Stream processing, estimate storage, checkpoint projects, and test duration/device limits explicitly. |
| Preview differs from final output | Share composition logic and use reference recordings to compare preview/export geometry and timing. |
| Capture behavior varies across OS versions, desktop environments, GPUs, and display configurations | Publish a per-platform support matrix; detect unsupported modes before recording; preserve raw capture when effects fail. |
| Cross-platform core becomes entangled with OS-specific APIs | Keep native operations behind Rust traits/interfaces; run portable core builds and tests on all three operating systems from the start. |
| Open-source dependencies carry incompatible licenses or vulnerable components | Maintain a dependency/license inventory, publish third-party notices, and establish a security-reporting and update process. |
| Cloud collaboration expands operational and privacy scope | Keep it post-core; require explicit uploads, access controls, retention/deletion, and incident/support processes. |
| AI caption/noise features promise more than the device can deliver | State model and hardware requirements; allow corrections; report confidence/failure rather than silently accepting output. |
| Feature parity expands into a full video editor | Preserve a narrow demo/tutorial workflow; gate features against time-to-polished-export and reliability goals. |

## 12. Open product decisions

1. Which output presets and maximum source duration define the first public release?
2. Resolved: foOom's core desktop product is free and open source under MIT. Recording, editing, project saving and local export require no paid activation or proprietary account.
3. Which Windows versions, macOS versions, Linux distributions/desktops, and GPU/encoder tiers are officially supported?
4. Should captions be strictly local, or can users opt into a cloud transcription service?
5. Is hosted sharing essential to the first version, or should local file and clipboard export establish product value first?
6. What minimum set of product analytics is acceptable, and what opt-out/control is needed?

## 13. Research validation plan

Before locking P0, run moderated usability sessions with Windows users who recently made a tutorial, software demo, or support walkthrough. Start with observed behavior and a recent recording task, not feature preference questions. Test first-run capture, permission handling, a bad auto-zoom correction, an export, and recovery from interruption.

For problem discovery, recruit 5 participants per materially different primary segment as a usability problem-finding sample, with low-to-moderate confidence and no prevalence claims. For broader thematic discovery across diverse segments, plan roughly 12 interviews and state saturation limits. These are method-based planning references, not a substitute for a study plan. Record participant-level evidence and do not promote an issue to a recurring insight from one person alone.

## References

- [Screen Studio research and source register](SCREEN_STUDIO_RESEARCH.md)
- [foOom product flow](../apps/desktop/PRODUCT_FLOW.md)
- [foOom README](../README.md)
