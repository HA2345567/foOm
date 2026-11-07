mod atomic_file;

use rust_core::platform::{
    CaptureBackend, CaptureFinishOptions, CaptureRequest, CaptureSession, CaptureSourceKind,
    CursorCaptureMode, NativeBackend,
};
#[cfg(windows)]
mod recording_shortcuts;
#[cfg(not(windows))]
mod recording_shortcuts {
    #[tauri::command]
    pub fn set_global_recording_shortcut(_binding: serde_json::Value) -> Result<(), String> {
        Err("Global recording shortcuts are not supported on this platform yet.".to_string())
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(windows)]
use rust_core::capture;
use rust_core::db;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
use tauri::{
    Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent,
    WebviewUrl, WebviewWindowBuilder,
};

static ACTIVE_EXPORTS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

#[derive(Clone, Default)]
struct ActiveCaptureSession(Arc<Mutex<Option<Box<dyn CaptureSession>>>>);

fn sync_recording_overlay_capture_affinity(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let capture_active = app
        .try_state::<ActiveCaptureSession>()
        .and_then(|active| active.0.lock().ok().map(|session| session.is_some()))
        .unwrap_or(false);

    if capture_active {
        exclude_recording_overlay_from_capture(window)
    } else {
        allow_window_in_capture(window)
    }
}

#[cfg(windows)]
static SINGLE_INSTANCE_MUTEX: OnceLock<usize> = OnceLock::new();

#[cfg(windows)]
fn allow_window_in_capture(window: &tauri::WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Dwm::DwmFlush;
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_NONE};

    match window.hwnd() {
        Ok(hwnd) => {
            // Source selection and countdown surfaces are only shown before
            // capture; leave them capturable if a frame races their dismissal.
            if unsafe { SetWindowDisplayAffinity(hwnd.0 as _, WDA_NONE) } == 0 {
                let error = std::io::Error::last_os_error();
                return Err(format!("Could not clear foOom capture exclusion: {error}"));
            }
            let _ = unsafe { DwmFlush() };
            Ok(())
        }
        Err(error) => Err(format!("Failed to resolve foOom overlay HWND: {error}")),
    }
}

#[cfg(windows)]
fn exclude_recording_overlay_from_capture(window: &tauri::WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Dwm::DwmFlush;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("Failed to resolve recorder overlay HWND: {error}"))?;
    if unsafe { SetWindowDisplayAffinity(hwnd.0 as _, WDA_EXCLUDEFROMCAPTURE) } == 0 {
        return Err(format!(
            "Could not exclude the recorder toolbar from screen capture: {}",
            std::io::Error::last_os_error()
        ));
    }
    let _ = unsafe { DwmFlush() };
    Ok(())
}

#[cfg(not(windows))]
fn exclude_recording_overlay_from_capture(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn allow_window_in_capture(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

fn active_exports() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_EXPORTS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ExportRegistration(String);

impl Drop for ExportRegistration {
    fn drop(&mut self) {
        if let Ok(mut exports) = active_exports().lock() {
            exports.remove(&self.0);
        }
    }
}

#[cfg(windows)]
fn hide_subprocess_window(command: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
fn hide_subprocess_window(command: &mut std::process::Command) -> &mut std::process::Command {
    command
}

#[cfg(windows)]
fn acquire_single_instance_lock() -> bool {
    use windows_sys::Win32::Foundation::{
        GetLastError, SetLastError, ERROR_ALREADY_EXISTS, WIN32_ERROR,
    };
    use windows_sys::Win32::System::Threading::CreateMutexW;

    if SINGLE_INSTANCE_MUTEX.get().is_some() {
        return true;
    }

    let name: Vec<u16> = "Local\\foom-desktop-single-instance"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe { SetLastError(0 as WIN32_ERROR) };
    let handle = unsafe { CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };

    if handle.is_null() {
        eprintln!("Failed to create foOom single-instance mutex; continuing without lock.");
        return true;
    }

    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, SetForegroundWindow, ShowWindow, SW_SHOW,
        };
        let overlay_title: Vec<u16> = "foOom Recording Controls"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let main_title: Vec<u16> = "foOom Studio"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let mut hwnd = FindWindowW(std::ptr::null(), overlay_title.as_ptr());
            if hwnd == std::ptr::null_mut() {
                hwnd = FindWindowW(std::ptr::null(), main_title.as_ptr());
            }
            if hwnd != std::ptr::null_mut() {
                ShowWindow(hwnd, SW_SHOW);
                SetForegroundWindow(hwnd);
            }
        }
        return false;
    }

    let _ = SINGLE_INSTANCE_MUTEX.set(handle as usize);
    true
}

#[cfg(not(windows))]
fn acquire_single_instance_lock() -> bool {
    true
}

fn install_main_window_menu(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let file_menu = SubmenuBuilder::new(handle, "File")
        .text("menu-load-project", "Open Project...")
        .separator()
        .text("menu-save-project", "Save Project")
        .text("menu-save-project-as", "Save Project As...")
        .separator()
        .text("menu-new-recording", "New Recording")
        .separator()
        .quit_with_text("Exit")
        .build()?;
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(handle, "View")
        .text("menu-reload-window", "Reload")
        .fullscreen_with_text("Toggle Full Screen")
        .build()?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(handle, "Help")
        .about_with_text(
            "About foOom",
            Some(AboutMetadata {
                name: Some("foOom".to_string()),
                version: Some(env!("CARGO_PKG_VERSION").to_string()),
                authors: Some(vec!["Harsh Bhardwaj".to_string()]),
                comments: Some(
                    "The fastest way to create beautiful screen recordings.".to_string(),
                ),
                copyright: Some(
                    "Copyright 2026 Harsh Bhardwaj. Licensed under the MIT License.".to_string(),
                ),
                ..Default::default()
            }),
        )
        .build()?;

    let menu = MenuBuilder::new(handle)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;
    #[cfg(target_os = "macos")]
    {
        app.set_menu(menu)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(main_window) = app.get_webview_window("main") {
            main_window.set_menu(menu)?;
        }
    }
    Ok(())
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlayPlacement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    monitor_name: Option<String>,
}

fn get_overlay_placement_path() -> std::path::PathBuf {
    let mut path =
        std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string()));
    path.push("foom");
    let _ = std::fs::create_dir_all(&path);
    path.push("recording-overlay-placement.json");
    path
}

fn write_overlay_placement(placement: &OverlayPlacement) -> Result<(), String> {
    let path = get_overlay_placement_path();
    let raw = serde_json::to_string_pretty(placement).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

fn read_overlay_placement() -> Option<OverlayPlacement> {
    let raw = std::fs::read_to_string(get_overlay_placement_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

fn clamp_overlay_placement_to_monitor(
    mut placement: OverlayPlacement,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    scale_factor: f64,
) -> OverlayPlacement {
    // Persisted values can outlive a monitor, resolution, or DPI change. Keep a
    // usable minimum size, cap it to the selected monitor, and use i64 math so
    // negative virtual-desktop origins and large coordinates cannot overflow.
    let max_width = monitor_width.max(1);
    let max_height = monitor_height.max(1);
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let min_width = ((80.0 * scale).round() as u32).clamp(1, max_width);
    let min_height = ((64.0 * scale).round() as u32).clamp(1, max_height);
    placement.width = placement.width.clamp(min_width, max_width);
    placement.height = placement.height.clamp(min_height, max_height);

    let min_x = i64::from(monitor_x);
    let min_y = i64::from(monitor_y);
    let max_x = min_x + i64::from(max_width.saturating_sub(placement.width));
    let max_y = min_y + i64::from(max_height.saturating_sub(placement.height));
    placement.x = (i64::from(placement.x).clamp(min_x, max_x)) as i32;
    placement.y = (i64::from(placement.y).clamp(min_y, max_y)) as i32;
    placement
}

#[tauri::command]
#[cfg(windows)]
async fn start_recording(
    app: tauri::AppHandle,
    options: Option<capture::CaptureOptions>,
    active: tauri::State<'_, ActiveCaptureSession>,
) -> Result<String, String> {
    let session_state = active.0.clone();
    let recording_id = tauri::async_runtime::spawn_blocking(move || {
        let options = options.unwrap_or_default();
        let kind = match options.source_type.as_deref().unwrap_or("screen") {
            "window" => CaptureSourceKind::Window,
            "area" | "region" | "browser" => CaptureSourceKind::Region,
            _ => CaptureSourceKind::Display,
        };
        let request = CaptureRequest {
            source_kind: kind,
            source_id: options.source.as_ref().map(|source| source.id.clone()),
            region: options
                .region
                .map(|region| rust_core::platform::CaptureRegion {
                    x: region.x,
                    y: region.y,
                    width: region.width.max(0) as u32,
                    height: region.height.max(0) as u32,
                }),
            system_audio: options.system_audio_enabled.unwrap_or(false),
            cursor_mode: if options.cursor_enabled.unwrap_or(true) {
                CursorCaptureMode::EditableTelemetry
            } else {
                CursorCaptureMode::BakedIntoVideo
            },
            ..CaptureRequest::default()
        };
        let backend = NativeBackend;
        let session = backend.start(request).map_err(|error| error.to_string())?;
        let id = session.id().to_string();
        let mut guard = session_state
            .lock()
            .map_err(|_| "Capture session state is unavailable".to_string())?;
        if guard.is_some() {
            let _ = session.cancel();
            return Err("Capture is already running".to_string());
        }
        *guard = Some(session);
        Ok(id)
    })
    .await
    .map_err(|e| format!("Recording startup failed: {e}"))??;

    // Keep the on-screen toolbar available to control recording while excluding
    // its transparent top-level window from captured frames.
    if let Some(window) = app.get_webview_window("recording-overlay") {
        if let Err(error) = exclude_recording_overlay_from_capture(&window) {
            eprintln!("Failed to exclude recorder controls from capture: {error}");
        }
    }

    Ok(recording_id)
}

#[tauri::command]
#[cfg(windows)]
async fn list_capture_sources() -> Result<Vec<capture::CaptureSource>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let sources = capture::enumerate_capture_sources_with_thumbnails();
        let _ = tx.send(sources);
    });

    // Enumeration touches every top-level window; never let the picker wait forever.
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(8))
            .map_err(|_| "Timed out while listing capture sources.".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[cfg(windows)]
fn append_recording_sidecar_chunk(
    kind: String,
    bytes: Vec<u8>,
    timestamp_ms: u64,
    sequence: u64,
) -> Result<(), String> {
    capture::append_sidecar_chunk(kind, bytes, timestamp_ms, sequence)
}

#[tauri::command]
#[cfg(windows)]
fn discard_recording_sidecar(kind: String) -> Result<(), String> {
    capture::discard_sidecar_track(kind)
}

#[tauri::command]
#[cfg(windows)]
fn pause_recording(active: tauri::State<'_, ActiveCaptureSession>) -> Result<(), String> {
    active
        .0
        .lock()
        .map_err(|_| "Capture session state is unavailable".to_string())?
        .as_mut()
        .ok_or_else(|| "No active capture session".to_string())?
        .pause()
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[cfg(windows)]
fn resume_recording(active: tauri::State<'_, ActiveCaptureSession>) -> Result<(), String> {
    active
        .0
        .lock()
        .map_err(|_| "Capture session state is unavailable".to_string())?
        .as_mut()
        .ok_or_else(|| "No active capture session".to_string())?
        .resume()
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[cfg(windows)]
async fn stop_recording(
    mic_audio_bytes: Option<Vec<u8>>,
    camera_video_bytes: Option<Vec<u8>>,
    camera_mime_type: Option<String>,
    camera_shape: Option<String>,
    active: tauri::State<'_, ActiveCaptureSession>,
) -> Result<db::Project, String> {
    let session_state = active.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let session = session_state
            .lock()
            .map_err(|_| "Capture session state is unavailable".to_string())?
            .take()
            .ok_or_else(|| "No active capture session".to_string())?;
        let id = session.id().to_string();
        session
            .finish(CaptureFinishOptions {
                microphone_audio: mic_audio_bytes,
                camera_video: camera_video_bytes,
                camera_mime_type,
                camera_shape,
            })
            .map_err(|error| error.to_string())?;
        db::get_project(&id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|e| format!("Recording finalization failed: {e}"))?
}

#[tauri::command]
#[cfg(windows)]
fn cancel_recording(active: tauri::State<'_, ActiveCaptureSession>) -> Result<(), String> {
    let session = active
        .0
        .lock()
        .map_err(|_| "Capture session state is unavailable".to_string())?
        .take()
        .ok_or_else(|| "No active capture session".to_string())?;
    session.cancel().map_err(|error| error.to_string())
}

#[cfg(not(windows))]
const CAPTURE_UNAVAILABLE: &str = "Native screen capture is not supported on this platform yet.";

#[cfg(not(windows))]
#[tauri::command]
async fn start_recording(_options: Option<serde_json::Value>) -> Result<String, String> {
    Err(CAPTURE_UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn list_capture_sources() -> Result<Vec<serde_json::Value>, String> {
    Err(CAPTURE_UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn append_recording_sidecar_chunk(
    _kind: String,
    _bytes: Vec<u8>,
    _timestamp_ms: u64,
    _sequence: u64,
) -> Result<(), String> {
    Err(CAPTURE_UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn discard_recording_sidecar(_kind: String) -> Result<(), String> {
    Err(CAPTURE_UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn pause_recording() -> Result<(), String> {
    Err(CAPTURE_UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn resume_recording() -> Result<(), String> {
    Err(CAPTURE_UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
async fn stop_recording() -> Result<db::Project, String> {
    Err(CAPTURE_UNAVAILABLE.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
fn cancel_recording() -> Result<(), String> {
    Err(CAPTURE_UNAVAILABLE.to_string())
}

#[tauri::command]
fn show_recording_overlay(app: tauri::AppHandle) -> Result<(), String> {
    ensure_recording_overlay(app, true)
}

fn ensure_recording_overlay(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let label = "recording-overlay";

    let available_monitors = app.available_monitors().unwrap_or_default();
    let primary_monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| available_monitors.first().cloned())
        .ok_or_else(|| "No monitor available".to_string())?;
    let saved_placement = read_overlay_placement();
    let monitor = saved_placement
        .as_ref()
        .and_then(|placement| placement.monitor_name.as_ref())
        .and_then(|saved_name| {
            available_monitors
                .iter()
                .find(|monitor| monitor.name() == Some(saved_name))
                .cloned()
        })
        .unwrap_or(primary_monitor);
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let scale = monitor.scale_factor();
    let logical_width = monitor_size.width as f64 / scale;
    let desired_placement = if let Some(placement) = saved_placement {
        placement
    } else {
        let overlay_width = 570.0_f64.min((logical_width - 32.0).max(320.0));
        let overlay_height = 190.0;
        let bottom_margin = 24.0;
        let physical_width = (overlay_width * scale).round() as u32;
        let physical_height = (overlay_height * scale).round() as u32;
        let x = monitor_position.x
            + ((monitor_size.width as i64 - i64::from(physical_width)) / 2) as i32;
        let y = monitor_position.y
            + (monitor_size.height as i64
                - i64::from(physical_height)
                - (bottom_margin * scale).round() as i64)
                .max((12.0 * scale).round() as i64) as i32;
        OverlayPlacement {
            x,
            y,
            width: physical_width,
            height: physical_height,
            monitor_name: monitor.name().cloned(),
        }
    };
    let placement = clamp_overlay_placement_to_monitor(
        desired_placement,
        monitor_position.x,
        monitor_position.y,
        monitor_size.width,
        monitor_size.height,
        scale,
    );
    let (physical_x, physical_y, physical_width, physical_height) =
        (placement.x, placement.y, placement.width, placement.height);
    let overlay_width = physical_width as f64 / scale;
    let overlay_height = physical_height as f64 / scale;
    let x = physical_x as f64 / scale;
    let y = physical_y as f64 / scale;

    if let Some(window) = app.get_webview_window(label) {
        // The renderer measures and sizes the toolbar itself; resizing here made it
        // jump back to its creation size every time it was shown again.
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        let was_visible = window.is_visible().unwrap_or(false);
        if visible && !was_visible {
            window.show().map_err(|e| e.to_string())?;
        } else if !visible && was_visible {
            window.hide().map_err(|e| e.to_string())?;
        }
        if visible {
            // Use normal display affinity while idle so the toolbar stays fully
            // visible; exclude it only while a capture session is active.
            if let Err(error) = sync_recording_overlay_capture_affinity(&app, &window) {
                eprintln!("Could not synchronize recorder capture visibility: {error}");
            }
        }
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App("index.html?windowType=hud-overlay".into()),
    )
    .title("foOom Recording Controls")
    .inner_size(overlay_width, overlay_height)
    .position(x, y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    // Prevent Windows from painting a white redirected bitmap before WebView2
    // renders the transparent recorder controls.
    .no_redirection_bitmap(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .shadow(false)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;

    window
        .set_size(PhysicalSize::new(physical_width, physical_height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(physical_x, physical_y))
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    if visible {
        window.show().map_err(|e| e.to_string())?;
        if let Err(error) = sync_recording_overlay_capture_affinity(&app, &window) {
            eprintln!("Could not synchronize recorder capture visibility: {error}");
        }
    }

    Ok(())
}

#[tauri::command]
fn persist_recording_overlay_placement(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("recording-overlay") else {
        return Ok(());
    };

    let position: PhysicalPosition<i32> = window.outer_position().map_err(|e| e.to_string())?;
    let size: PhysicalSize<u32> = window.outer_size().map_err(|e| e.to_string())?;
    let monitor_name = window
        .current_monitor()
        .ok()
        .flatten()
        .and_then(|monitor| monitor.name().map(|name| name.to_string()));

    write_overlay_placement(&OverlayPlacement {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        monitor_name,
    })
}

#[tauri::command]
fn move_recording_overlay_by(
    app: tauri::AppHandle,
    delta_x: f64,
    delta_y: f64,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("recording-overlay") else {
        return Err("Recording controls window is not available".to_string());
    };
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let x = position.x.saturating_add((delta_x * scale).round() as i32);
    let y = position.y.saturating_add((delta_y * scale).round() as i32);
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    // Preserve the capture exclusion after native window movement.
    sync_recording_overlay_capture_affinity(&app, &window)
}

#[tauri::command]
fn hide_recording_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("recording-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_hud_overlay_size(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    layout: Option<String>,
    preserve_position: Option<bool>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("recording-overlay") else {
        return Ok(());
    };

    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "No monitor available for the recording controls".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let max_width = (monitor_size.width as f64 / scale).max(80.0);
    let max_height = (monitor_size.height as f64 / scale).max(96.0);
    let new_physical_width = (width.max(80.0).min(max_width) * scale).round() as u32;
    let new_physical_height = (height.max(64.0).min(max_height) * scale).round() as u32;
    let layout = layout.as_deref().unwrap_or("bottom");
    let (x, y) = if preserve_position.unwrap_or(false) {
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let placement = clamp_overlay_placement_to_monitor(
            OverlayPlacement {
                x: position.x,
                y: position.y,
                width: new_physical_width,
                height: new_physical_height,
                monitor_name: monitor.name().cloned(),
            },
            monitor_position.x,
            monitor_position.y,
            monitor_size.width,
            monitor_size.height,
            scale,
        );
        (placement.x, placement.y)
    } else {
        let x = match layout {
            "left" | "vertical" => monitor_position.x,
            "right" => monitor_position.x + monitor_size.width as i32 - new_physical_width as i32,
            _ => monitor_position.x + (monitor_size.width as i32 - new_physical_width as i32) / 2,
        };
        let y = match layout {
            "top" => monitor_position.y,
            "left" | "right" | "vertical" => {
                monitor_position.y + (monitor_size.height as i32 - new_physical_height as i32) / 2
            }
            _ => monitor_position.y + monitor_size.height as i32 - new_physical_height as i32,
        };
        (x, y)
    };

    window
        .set_size(tauri::PhysicalSize::new(
            new_physical_width,
            new_physical_height,
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    // Tauri/Windows may rebuild a transparent window's composition surface during
    // resize/reposition, so preserve its capture exclusion.
    sync_recording_overlay_capture_affinity(&app, &window)?;

    Ok(())
}

fn ensure_source_selector(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    let label = "source-selector";

    if let Some(window) = app.get_webview_window(label) {
        if visible {
            // Source selection closes before recording starts; leave its surface
            // capturable so it cannot introduce a black hole if a frame races.
            allow_window_in_capture(&window)?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("index.html#/source-selector".into()),
    )
    .title("Select a source")
    .inner_size(620.0, 540.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .no_redirection_bitmap(true)
    .always_on_top(true)
    .center()
    .focused(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    allow_window_in_capture(&window)?;
    if visible {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn show_source_selector(app: tauri::AppHandle) -> Result<(), String> {
    ensure_source_selector(&app, true)
}

#[tauri::command]
fn switch_to_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.show().map_err(|e| e.to_string())?;
        main_window.set_focus().map_err(|e| e.to_string())?;
    }
    if let Some(overlay_window) = app.get_webview_window("recording-overlay") {
        let _ = overlay_window.hide();
    }
    Ok(())
}

#[tauri::command]
fn switch_to_overlay(app: tauri::AppHandle) -> Result<(), String> {
    show_recording_overlay(app.clone())?;
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.hide();
    }
    Ok(())
}

#[tauri::command]
async fn close_app(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        if capture::is_capturing() {
            capture::stop_capture(None, None, None, None)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Failed to finalize recording before exit: {e}"))??;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn get_recordings() -> Result<Vec<db::Project>, String> {
    db::list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_recording(id: String) -> Result<(), String> {
    db::delete_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project_document(id: String) -> Result<serde_json::Value, String> {
    db::get_project_document(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project_editor_state(id: String, editor: serde_json::Value) -> Result<(), String> {
    db::save_project_editor_state(&id, editor).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_video_file_picker(kind: Option<String>) -> Result<Option<String>, String> {
    let dialog = rfd::FileDialog::new();
    let file = if kind.as_deref() == Some("audio") {
        dialog.add_filter(
            "Audio files",
            &["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"],
        )
    } else {
        dialog.add_filter("Video Files", &["mp4", "webm", "mkv", "avi", "mov"])
    }
    .pick_file();
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[derive(Clone, serde::Serialize)]
struct ProjectFileResult {
    path: String,
    content: String,
}

#[tauri::command]
fn open_project_file_picker() -> Result<Option<ProjectFileResult>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("foOom Project", &["foom", "json"])
        .pick_file();

    let Some(path) = file else {
        return Ok(None);
    };

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read project file: {}", e))?;

    Ok(Some(ProjectFileResult {
        path: path.to_string_lossy().to_string(),
        content,
    }))
}

#[tauri::command]
fn save_project_file(
    project_data: serde_json::Value,
    suggested_name: Option<String>,
    existing_project_path: Option<String>,
) -> Result<Option<String>, String> {
    let target_path = if let Some(existing_path) = existing_project_path
        .as_ref()
        .filter(|path| !path.trim().is_empty())
        .filter(|path| !path.starts_with("local-storage://"))
    {
        std::path::PathBuf::from(existing_path)
    } else {
        let default_name = suggested_name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| {
                format!(
                    "foom-project-{}",
                    chrono::Local::now().format("%Y%m%d_%H%M%S")
                )
            });
        let default_name = if default_name.to_lowercase().ends_with(".json") {
            default_name
        } else {
            format!("{}.json", default_name.trim_end_matches(".foom"))
        };
        let Some(path) = rfd::FileDialog::new()
            .add_filter("foOom Project", &["json"])
            .set_file_name(&default_name)
            .save_file()
        else {
            return Ok(None);
        };
        path
    };

    let raw = serde_json::to_string_pretty(&project_data)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    atomic_file::write(&target_path, raw.as_bytes())
        .map_err(|e| format!("Failed to write project file: {}", e))?;
    Ok(Some(target_path.to_string_lossy().to_string()))
}

#[tauri::command]
fn pick_export_save_path(
    file_name: String,
    initial_directory: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    let lower = file_name.to_lowercase();
    if lower.ends_with(".gif") {
        dialog = dialog.add_filter("GIF", &["gif"]);
    } else {
        dialog = dialog.add_filter("MP4 Video", &["mp4"]);
    }
    if let Some(directory) = initial_directory
        .as_ref()
        .filter(|path| !path.trim().is_empty())
        .map(std::path::PathBuf::from)
        .filter(|path| path.exists() && path.is_dir())
    {
        dialog = dialog.set_directory(directory);
    }
    Ok(dialog
        .set_file_name(&file_name)
        .save_file()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<String, String> {
    let target_path = std::path::PathBuf::from(&path);
    let parent = target_path
        .parent()
        .ok_or_else(|| "Export destination is invalid.".to_string())?;
    if !parent.exists() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination folder: {}", e))?;
    }
    atomic_file::write(&target_path, &bytes).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let target_path = std::path::PathBuf::from(&path);
    if !target_path.exists() {
        return Err("File does not exist.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", target_path.to_string_lossy()))
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target_path)
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let folder = target_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("/"));
        std::process::Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct ExportPayload {
    status: String,
    path: Option<String>,
    error: Option<String>,
    percent: Option<f64>,
}

#[tauri::command]
fn export_recording(
    app: tauri::AppHandle,
    id: String,
    composition: Option<export_engine::ExportComposition>,
) -> Result<String, String> {
    use tauri::Emitter;
    let project = db::get_project(&id).map_err(|e| e.to_string())?;

    let raw_path = std::path::Path::new(&project.raw_video_path);
    if !raw_path.exists() {
        return Err("Raw recording file is missing. Cannot export this project.".to_string());
    }

    let output_path = raw_path.with_file_name(format!(
        "{}_cinematic.mp4",
        raw_path.file_stem().unwrap().to_string_lossy()
    ));
    let temp_output_path = raw_path.with_file_name(format!(
        "{}_cinematic.exporting.mp4",
        raw_path.file_stem().unwrap().to_string_lossy()
    ));
    let output_path_str = output_path.to_string_lossy().to_string();
    let temp_output_path_str = temp_output_path.to_string_lossy().to_string();

    // The engine reserves its own unique temporary file to check writability;
    // a fixed-name probe could overwrite a file that belongs to the user.

    let metadata_path = project.metadata_path.clone();
    let raw_video_path = project.raw_video_path.clone();
    let width = u32::try_from(project.width)
        .map_err(|_| format!("Invalid export width: {}", project.width))?;
    let height = u32::try_from(project.height)
        .map_err(|_| format!("Invalid export height: {}", project.height))?;
    if width == 0 || height == 0 {
        return Err("Export dimensions must be greater than zero.".to_string());
    }
    let duration = project.duration as f64;
    if !duration.is_finite() || duration <= 0.0 {
        return Err("Export duration must be greater than zero.".to_string());
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut exports = active_exports()
            .lock()
            .map_err(|_| "Export registry is poisoned")?;
        if exports.contains_key(&id) {
            return Err("This project is already exporting.".to_string());
        }
        exports.insert(id.clone(), cancel_flag.clone());
    }
    let registration = ExportRegistration(id.clone());

    let app_clone = app.clone();
    let id_clone = id.clone();
    let output_path_str_clone = output_path_str.clone();
    let temp_output_path_str_clone = temp_output_path_str.clone();
    let composition_clone = composition.clone();
    std::thread::spawn(move || {
        let _registration = registration;
        let _ = app_clone.emit(
            "export-status",
            ExportPayload {
                status: "started".to_string(),
                path: None,
                error: None,
                percent: Some(0.0),
            },
        );

        let app_progress = app_clone.clone();
        let progress_cancel = cancel_flag.clone();
        let export_result = export_engine::run_export_controlled(
            &raw_video_path,
            &metadata_path,
            &temp_output_path_str_clone,
            width,
            height,
            duration,
            composition_clone,
            cancel_flag.clone(),
            move |percent| {
                if progress_cancel.load(Ordering::SeqCst) {
                    return;
                }
                let _ = app_progress.emit(
                    "export-status",
                    ExportPayload {
                        status: "progress".to_string(),
                        path: None,
                        error: None,
                        percent: Some(percent),
                    },
                );
            },
        );

        if let Err(e) = export_result {
            eprintln!("Export failed for project {}: {}", id_clone, e);
            let _ = std::fs::remove_file(&temp_output_path_str_clone);
            let _ = app_clone.emit(
                "export-status",
                ExportPayload {
                    status: if e.starts_with("Export cancelled") {
                        "cancelled".to_string()
                    } else {
                        "failed".to_string()
                    },
                    path: None,
                    error: Some(e),
                    percent: None,
                },
            );
        } else {
            if cancel_flag.load(Ordering::SeqCst) {
                let _ = std::fs::remove_file(&temp_output_path_str_clone);
                let _ = app_clone.emit(
                    "export-status",
                    ExportPayload {
                        status: "cancelled".to_string(),
                        path: None,
                        error: Some("Export cancelled".to_string()),
                        percent: None,
                    },
                );
                return;
            }
            if let Err(error) = std::fs::rename(&temp_output_path_str_clone, &output_path_str_clone)
            {
                let _ = std::fs::remove_file(&temp_output_path_str_clone);
                let _ = app_clone.emit(
                    "export-status",
                    ExportPayload {
                        status: "failed".to_string(),
                        path: None,
                        error: Some(format!("Failed to finalize export file: {}", error)),
                        percent: None,
                    },
                );
                return;
            }
            println!(
                "Export succeeded for project {}! Output: {}",
                id_clone, output_path_str_clone
            );
            let _ = app_clone.emit(
                "export-status",
                ExportPayload {
                    status: "success".to_string(),
                    path: Some(output_path_str_clone),
                    error: None,
                    percent: Some(1.0),
                },
            );
        }
    });

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
fn cancel_export(id: String) -> Result<(), String> {
    let exports = active_exports()
        .lock()
        .map_err(|_| "Export registry is poisoned".to_string())?;
    if let Some(flag) = exports.get(&id) {
        flag.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        Err("No active export for this project.".to_string())
    }
}

#[tauri::command]
fn export_gif(app: tauri::AppHandle, id: String) -> Result<String, String> {
    use tauri::Emitter;
    let project = db::get_project(&id).map_err(|e| e.to_string())?;
    let raw_path = std::path::Path::new(&project.raw_video_path);
    let source_path = raw_path.with_file_name(format!(
        "{}_cinematic.mp4",
        raw_path.file_stem().unwrap().to_string_lossy()
    ));
    let input_path = if source_path.exists() {
        source_path
    } else {
        raw_path.to_path_buf()
    };
    let output_path = raw_path.with_file_name(format!(
        "{}_export.gif",
        raw_path.file_stem().unwrap().to_string_lossy()
    ));
    let output_path_str = output_path.to_string_lossy().to_string();
    let input_path_str = input_path.to_string_lossy().to_string();

    let app_clone = app.clone();
    let output_path_str_clone = output_path_str.clone();
    std::thread::spawn(move || {
        let _ = app_clone.emit(
            "export-status",
            ExportPayload {
                status: "started".to_string(),
                path: None,
                error: None,
                percent: Some(0.0),
            },
        );

        let ffmpeg_bin = get_ffmpeg_path();
        let filter = "fps=15,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5";
        let mut ffmpeg_command = std::process::Command::new(&ffmpeg_bin);
        let output = hide_subprocess_window(&mut ffmpeg_command)
            .args([
                "-i",
                &input_path_str,
                "-vf",
                filter,
                "-loop",
                "0",
                "-y",
                &output_path_str_clone,
            ])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let _ = app_clone.emit(
                    "export-status",
                    ExportPayload {
                        status: "success".to_string(),
                        path: Some(output_path_str_clone),
                        error: None,
                        percent: Some(1.0),
                    },
                );
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let _ = app_clone.emit(
                    "export-status",
                    ExportPayload {
                        status: "failed".to_string(),
                        path: None,
                        error: Some(stderr.lines().rev().take(12).collect::<Vec<_>>().join("\n")),
                        percent: None,
                    },
                );
            }
            Err(error) => {
                let _ = app_clone.emit(
                    "export-status",
                    ExportPayload {
                        status: "failed".to_string(),
                        path: None,
                        error: Some(error.to_string()),
                        percent: None,
                    },
                );
            }
        }
    });

    Ok(output_path_str)
}

#[tauri::command]
fn get_zoom_keyframes(
    clicks: Vec<motion_engine::ClickEvent>,
    duration: f64,
    opts: motion_engine::ZoomConfig,
    scrolls: Vec<motion_engine::ScrollEvent>,
    pauses: Vec<motion_engine::PauseEvent>,
    type_bursts: Vec<motion_engine::TypeBurstEvent>,
) -> Result<Vec<motion_engine::ZoomKeyframe>, String> {
    Ok(motion_engine::generate_zoom_keyframes(
        &clicks,
        duration,
        &opts,
        &scrolls,
        &pauses,
        &type_bursts,
    ))
}

fn get_ffmpeg_path() -> String {
    if let Ok(mut path) = std::env::current_exe() {
        path.pop(); // Remove exe name, now at target dir or bundle root

        let sidecar_path = path.join("ffmpeg.exe");
        if sidecar_path.exists() {
            return sidecar_path.to_string_lossy().to_string();
        }

        let dev_binaries = path
            .join("binaries")
            .join("ffmpeg-x86_64-pc-windows-msvc.exe");
        if dev_binaries.exists() {
            return dev_binaries.to_string_lossy().to_string();
        }

        let target_binaries = path
            .join("..")
            .join("..")
            .join("binaries")
            .join("ffmpeg-x86_64-pc-windows-msvc.exe");
        if target_binaries.exists() {
            return target_binaries.to_string_lossy().to_string();
        }
    }
    let development_sidecar = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries/ffmpeg-x86_64-pc-windows-msvc.exe");
    if development_sidecar.exists() {
        return development_sidecar.to_string_lossy().to_string();
    }
    "ffmpeg".to_string()
}

#[tauri::command]
fn extract_audio_wav(id: String) -> Result<String, String> {
    let project = db::get_project(&id).map_err(|e| e.to_string())?;
    let raw_path = std::path::Path::new(&project.raw_video_path);
    let wav_path = raw_path.with_file_name(format!("{}_audio.wav", project.id));

    if wav_path.exists() {
        return Ok(wav_path.to_string_lossy().to_string());
    }

    let ffmpeg_bin = get_ffmpeg_path();
    let mut ffmpeg_command = std::process::Command::new(&ffmpeg_bin);
    let status = hide_subprocess_window(&mut ffmpeg_command)
        .args([
            "-i",
            &project.raw_video_path,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-y",
            &wav_path.to_string_lossy().to_string(),
        ])
        .status()
        .map_err(|e| format!("Failed to spawn FFmpeg to extract audio: {}", e))?;

    if status.success() {
        Ok(wav_path.to_string_lossy().to_string())
    } else {
        Err("FFmpeg audio extraction failed".to_string())
    }
}

#[tauri::command]
fn save_to_downloads(
    app: tauri::AppHandle,
    id: String,
    is_raw: Option<bool>,
) -> Result<String, String> {
    use tauri::Manager;
    let project = db::get_project(&id).map_err(|e| e.to_string())?;

    let source_path = if is_raw.unwrap_or(false) {
        std::path::PathBuf::from(&project.raw_video_path)
    } else {
        let raw_path = std::path::Path::new(&project.raw_video_path);
        let cinematic = raw_path.with_file_name(format!(
            "{}_cinematic.mp4",
            raw_path.file_stem().unwrap().to_string_lossy()
        ));
        if cinematic.exists() {
            cinematic
        } else {
            raw_path.to_path_buf()
        }
    };

    if !source_path.exists() {
        return Err(format!(
            "Recorded video file missing at: {}",
            project.raw_video_path
        ));
    }

    let download_dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let prefix = if is_raw.unwrap_or(false) {
        "foom-raw"
    } else {
        "foom"
    };
    let dest_name = format!(
        "{}-{}.mp4",
        prefix,
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let dest_path = download_dir.join(dest_name);

    std::fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy file to downloads: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

pub fn run() {
    if !acquire_single_instance_lock() {
        eprintln!("foOom is already running; exiting duplicate launch.");
        return;
    }

    let app = tauri::Builder::default()
        .manage(ActiveCaptureSession::default())
        .setup(|app| {
            db::init_db();
            #[cfg(windows)]
            app.manage(recording_shortcuts::GlobalRecordingShortcutService::start(
                app.handle().clone(),
            ));
            install_main_window_menu(app)?;

            if let Some(main_window) = app.get_webview_window("main") {
                main_window.hide()?;
            }

            // Opening the installed app starts at the recorder; finished takes open in Studio.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(80));
                if let Err(error) = ensure_recording_overlay(handle.clone(), true) {
                    eprintln!("Failed to open recording controls: {error}");
                    if let Some(main_window) = handle.get_webview_window("main") {
                        let _ = main_window.show();
                        let _ = main_window.set_focus();
                    }
                }
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            match id {
                "menu-load-project" => {
                    let _ = app.emit_to("main", "menu-load-project", ());
                }
                "menu-save-project" => {
                    let _ = app.emit_to("main", "menu-save-project", ());
                }
                "menu-save-project-as" => {
                    let _ = app.emit_to("main", "menu-save-project-as", ());
                }
                "menu-new-recording" => {
                    let _ = app.emit_to("main", "menu-new-recording", ());
                }
                "menu-reload-window" => {
                    if let Some(main_window) = app.get_webview_window("main") {
                        let _ = main_window.eval("window.location.reload()");
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            list_capture_sources,
            append_recording_sidecar_chunk,
            discard_recording_sidecar,
            pause_recording,
            resume_recording,
            stop_recording,
            cancel_recording,
            show_recording_overlay,
            persist_recording_overlay_placement,
            move_recording_overlay_by,
            hide_recording_overlay,
            set_hud_overlay_size,
            show_source_selector,
            switch_to_main_window,
            switch_to_overlay,
            close_app,
            get_recordings,
            delete_recording,
            get_project_document,
            save_project_editor_state,
            export_recording,
            cancel_export,
            export_gif,
            get_zoom_keyframes,
            extract_audio_wav,
            save_to_downloads,
            open_video_file_picker,
            open_project_file_picker,
            save_project_file,
            pick_export_save_path,
            write_binary_file,
            read_binary_file,
            reveal_in_folder,
            recording_shortcuts::set_global_recording_shortcut,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            #[cfg(windows)]
            app_handle
                .state::<recording_shortcuts::GlobalRecordingShortcutService>()
                .shutdown();
        }
    });
}

#[cfg(test)]
mod overlay_placement_tests {
    use super::{clamp_overlay_placement_to_monitor, OverlayPlacement};

    fn placement(x: i32, y: i32, width: u32, height: u32) -> OverlayPlacement {
        OverlayPlacement {
            x,
            y,
            width,
            height,
            monitor_name: Some("Display".to_string()),
        }
    }

    #[test]
    fn keeps_saved_position_inside_monitor_with_negative_virtual_origin() {
        let result = clamp_overlay_placement_to_monitor(
            placement(-1800, -800, 570, 190),
            -1920,
            -1080,
            1920,
            1080,
            1.0,
        );

        assert_eq!((result.x, result.y), (-1800, -800));
        assert_eq!((result.width, result.height), (570, 190));
    }

    #[test]
    fn clamps_stale_coordinates_and_oversized_dimensions_to_monitor() {
        let result = clamp_overlay_placement_to_monitor(
            placement(5000, 4000, u32::MAX, u32::MAX),
            100,
            200,
            1280,
            720,
            1.5,
        );

        assert_eq!((result.x, result.y), (100, 200));
        assert_eq!((result.width, result.height), (1280, 720));
    }

    #[test]
    fn restores_minimum_toolbar_size_when_saved_dimensions_are_zero() {
        let result =
            clamp_overlay_placement_to_monitor(placement(100, 200, 0, 0), 0, 0, 1920, 1080, 1.5);

        assert_eq!((result.width, result.height), (120, 96));
    }
}
