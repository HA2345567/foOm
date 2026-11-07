# foOom Product Flow

This is the core desktop product flow. Implementation decisions should preserve this path first.

```txt
User visits website
-> Downloads Windows app
-> Installs foOom
-> Launches foOom
-> Floating toolbar appears instantly
-> User selects screen/window, mic, webcam, cursor mode, auto-zoom, and system audio
-> Clicks Record
-> Recording starts
-> User finishes recording
-> Clicks Stop
-> Rust finalizes the MP4, metadata JSON, cursor events, pauses, and local project row
-> Tauri emits `navigate-to-editor`
-> React stores the current recording session/project context
-> foOom opens `#/video-editor` automatically
-> The editor loads the recorded video from the local filesystem
-> Recording metadata is already processed
-> Auto-zoom is available from metadata/cursor events
-> Cursor effects are available when editable cursor mode was used
-> System cursor is already baked into the MP4 when system cursor mode was used
-> Webcam layout is ready for composition when webcam capture exists
-> User edits background, webcam size, webcam shape, layout, shadows, padding, blur, cursor, and zoom behavior
-> User exports 480p, 720p, 1080p, and later 4K
-> Final cinematic video is exported
```

## Architecture Contract

- The Tauri shell owns native windows, startup behavior, filesystem access, and FFmpeg orchestration.
- The floating recording toolbar is the primary capture entry point and must appear on app launch.
- React owns the workspace UI, editor controls, timeline, and source selection state.
- Toolbar recording state is owned by `useScreenRecorder`; desktop handoff state is shared through the native bridge and local project context.
- Rust owns native recording, hooks, metadata capture, and local project persistence.
- The scene layer owns shared layout math for preview, export, Canvas 2D, and future PixiJS/WebGL rendering.
- Export should prefer native FFmpeg for production desktop output.

## Current Status

- Startup toolbar window exists in Tauri.
- Toolbar can select capture mode, mic, webcam, cursor, auto-zoom, and system audio.
- Stop recording opens `#/video-editor`.
- Native metadata is persisted beside the MP4 and loaded into the editor through the native bridge/project context.
- Auto-zoom and cursor data are derived from metadata.
- PixiJS is installed and isolated behind the scene layer for future WebGL preview work.
- Editor export quality controls expose 480p, 720p, and 1080p. 4K also.

## End-to-End QA Contract

Run this flow for every launch-critical desktop change:

```txt
Start Vite on 127.0.0.1:5174
-> Start Tauri shell
-> Confirm floating toolbar appears without opening the editor
-> Select a screen/window
-> Record 5-10 seconds in editable cursor mode with movement and clicks
-> Stop recording
-> Confirm `#/video-editor` opens
-> Confirm MP4 exists in Videos/foom/recordings
-> Confirm metadata duration matches FFmpeg duration
-> Confirm cursor events exist and cursor controls appear
-> Export 1080p MP4
-> Confirm exported MP4 exists and plays
-> Repeat a short recording in system cursor mode
-> Confirm no duplicate editable cursor overlay appears
```
