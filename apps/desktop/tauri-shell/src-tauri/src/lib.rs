#[cfg_attr(mobile, tauri::mobile_entry_point)]
use rust_core::{capture, db, hooks};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

static ACTIVE_EXPORTS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
#[cfg(windows)]
static SINGLE_INSTANCE_MUTEX: OnceLock<usize> = OnceLock::new();

#[cfg(windows)]
fn exclude_window_from_capture(window: &tauri::WebviewWindow) {
    // Commented out display affinity changes to prevent WGC/DXGI screen capture from drawing a solid black box on top of the recording.
    // Instead of using SetWindowDisplayAffinity, we allow the small window controls overlay to be captured normally, avoiding a massive black box artifact.
    match window.hwnd() {
        Ok(_hwnd) => {}
        Err(error) => {
            eprintln!("Failed to resolve foOm overlay HWND: {error}");
        }
    }
}

#[cfg(not(windows))]
fn exclude_window_from_capture(_window: &tauri::WebviewWindow) {}

fn active_exports() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE_EXPORTS.get_or_init(|| Mutex::new(HashMap::new()))
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
        eprintln!("Failed to create foOm single-instance mutex; continuing without lock.");
        return true;
    }

    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, SetForegroundWindow, ShowWindow, SW_SHOW,
        };
        let overlay_title: Vec<u16> = "foOm Recording Controls"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let main_title: Vec<u16> = "foOm".encode_utf16().chain(std::iter::once(0)).collect();
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

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LicenseStatus {
    active: bool,
    email: Option<String>,
    license_key: Option<String>,
    plan: Option<String>,
    activated_at: Option<String>,
    #[serde(default)]
    free_exports_used: u32,
    #[serde(default)]
    free_exports_remaining: u32,
    #[serde(default = "default_free_export_limit")]
    free_export_limit: u32,
}

const FREE_EXPORT_LIMIT: u32 = 2;

fn default_free_export_limit() -> u32 {
    FREE_EXPORT_LIMIT
}

fn get_license_path() -> std::path::PathBuf {
    let mut path =
        std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string()));
    path.push("foom");
    let _ = std::fs::create_dir_all(&path);
    path.push("license.json");
    path
}

fn inactive_license() -> LicenseStatus {
    let used = read_free_exports_used();
    LicenseStatus {
        active: false,
        email: None,
        license_key: None,
        plan: None,
        activated_at: None,
        free_exports_used: used,
        free_exports_remaining: FREE_EXPORT_LIMIT.saturating_sub(used),
        free_export_limit: FREE_EXPORT_LIMIT,
    }
}

fn get_export_usage_path() -> std::path::PathBuf {
    let mut path =
        std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string()));
    path.push("foom");
    let _ = std::fs::create_dir_all(&path);
    path.push("export-usage.json");
    path
}

fn read_free_exports_used() -> u32 {
    let path = get_export_usage_path();
    let Ok(raw) = std::fs::read_to_string(path) else {
        return 0;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return 0;
    };
    value
        .get("freeExportsUsed")
        .and_then(|value| value.as_u64())
        .unwrap_or(0)
        .min(FREE_EXPORT_LIMIT as u64) as u32
}

fn write_free_exports_used(used: u32) -> Result<(), String> {
    let used = used.min(FREE_EXPORT_LIMIT);
    let raw = serde_json::to_string_pretty(&serde_json::json!({
        "freeExportsUsed": used,
        "freeExportLimit": FREE_EXPORT_LIMIT,
        "updatedAt": chrono::Local::now().to_rfc3339(),
    }))
    .map_err(|e| e.to_string())?;
    std::fs::write(get_export_usage_path(), raw).map_err(|e| e.to_string())
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
            "About foOm",
            Some(AboutMetadata {
                name: Some("foOm".to_string()),
                version: Some(env!("CARGO_PKG_VERSION").to_string()),
                authors: Some(vec!["Harsh Bhardwaj".to_string()]),
                comments: Some(
                    "The fastest way to create beautiful screen recordings.".to_string(),
                ),
                copyright: Some("Copyright 2026 Harsh Bhardwaj. All rights reserved.".to_string()),
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

fn with_export_usage(mut status: LicenseStatus) -> LicenseStatus {
    let used = read_free_exports_used();
    status.free_exports_used = used;
    status.free_exports_remaining = FREE_EXPORT_LIMIT.saturating_sub(used);
    status.free_export_limit = FREE_EXPORT_LIMIT;
    status
}

fn read_license_status() -> LicenseStatus {
    let Ok(raw) = std::fs::read_to_string(get_license_path()) else {
        return inactive_license();
    };
    serde_json::from_str::<LicenseStatus>(&raw).unwrap_or_else(|_| inactive_license())
}

fn write_license_status(status: &LicenseStatus) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(status).map_err(|e| e.to_string())?;
    std::fs::write(get_license_path(), raw).map_err(|e| e.to_string())
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

#[tauri::command]
fn start_recording(options: Option<capture::CaptureOptions>) -> Result<String, String> {
    let project_id = capture::start_capture(options)?;
    hooks::start_hooks();
    Ok(project_id)
}

#[tauri::command]
fn list_capture_sources() -> Result<Vec<capture::CaptureSource>, String> {
    capture::enumerate_capture_sources()
}

#[tauri::command]
fn append_recording_sidecar_chunk(
    kind: String,
    bytes: Vec<u8>,
    timestamp_ms: u64,
    sequence: u64,
) -> Result<(), String> {
    capture::append_sidecar_chunk(kind, bytes, timestamp_ms, sequence)
}

#[tauri::command]
fn pause_recording() -> Result<(), String> {
    capture::pause_capture()
}

#[tauri::command]
fn resume_recording() -> Result<(), String> {
    capture::resume_capture()
}

#[tauri::command]
fn stop_recording(
    mic_audio_bytes: Option<Vec<u8>>,
    camera_video_bytes: Option<Vec<u8>>,
    camera_mime_type: Option<String>,
    camera_shape: Option<String>,
) -> Result<db::Project, String> {
    capture::stop_capture(
        mic_audio_bytes,
        camera_video_bytes,
        camera_mime_type,
        camera_shape,
    )
}

#[tauri::command]
fn show_recording_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let label = "recording-overlay";

    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .ok_or_else(|| "No monitor available".to_string())?;
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let scale = monitor.scale_factor();
    let logical_width = monitor_size.width as f64 / scale;
    let logical_height = monitor_size.height as f64 / scale;
    let logical_origin_x = monitor_position.x as f64 / scale;
    let logical_origin_y = monitor_position.y as f64 / scale;
    let overlay_width = 570.0_f64.min((logical_width - 32.0).max(320.0));
    let overlay_height = 190.0;
    let bottom_margin = 24.0;
    let x = logical_origin_x + ((logical_width - overlay_width) / 2.0);
    let y = logical_origin_y + (logical_height - overlay_height - bottom_margin).max(12.0);

    if let Some(window) = app.get_webview_window(label) {
        window
            .set_size(LogicalSize::new(overlay_width, overlay_height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        exclude_window_from_capture(&window);
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App("index.html#/overlay/recording".into()),
    )
    .title("foOm Recording Controls")
    .inner_size(overlay_width, overlay_height)
    .min_inner_size(530.0, overlay_height)
    .position(x, y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .shadow(false)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;

    window
        .set_size(LogicalSize::new(overlay_width, overlay_height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    exclude_window_from_capture(&window);

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
fn hide_recording_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("recording-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_hud_overlay_size(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window("recording-overlay") else {
        return Ok(());
    };

    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let old_size = window.inner_size().map_err(|e| e.to_string())?;
    let old_position = window.outer_position().map_err(|e| e.to_string())?;

    let new_physical_width = (width * scale).round() as u32;
    let new_physical_height = (height * scale).round() as u32;

    let new_physical_x = old_position.x + (old_size.width as i32 - new_physical_width as i32) / 2;
    let new_physical_y = old_position.y + (old_size.height as i32 - new_physical_height as i32);

    window
        .set_size(tauri::PhysicalSize::new(new_physical_width, new_physical_height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(new_physical_x, new_physical_y))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn show_source_selector(app: tauri::AppHandle) -> Result<(), String> {
    let label = "source-selector";
    
    if let Some(window) = app.get_webview_window(label) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let _window = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App("index.html?windowType=source-selector".into()),
    )
    .title("Select a source")
    .inner_size(620.0, 540.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .center()
    .focused(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn show_countdown_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let label = "countdown-overlay";

    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .ok_or_else(|| "No monitor available".to_string())?;
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let scale = monitor.scale_factor();
    let logical_width = monitor_size.width as f64 / scale;
    let logical_height = monitor_size.height as f64 / scale;
    let logical_origin_x = monitor_position.x as f64 / scale;
    let logical_origin_y = monitor_position.y as f64 / scale;

    if let Some(window) = app.get_webview_window(label) {
        window
            .set_size(LogicalSize::new(logical_width, logical_height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(LogicalPosition::new(logical_origin_x, logical_origin_y))
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        exclude_window_from_capture(&window);
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App("index.html?windowType=countdown-overlay".into()),
    )
    .title("foOm Countdown")
    .inner_size(logical_width, logical_height)
    .position(logical_origin_x, logical_origin_y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .shadow(false)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;

    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    exclude_window_from_capture(&window);

    Ok(())
}

#[tauri::command]
fn hide_countdown_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("countdown-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
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
fn close_app(app: tauri::AppHandle) {
    app.exit(0);
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
fn license_status() -> Result<LicenseStatus, String> {
    Ok(with_export_usage(read_license_status()))
}

#[tauri::command]
fn activate_license(email: String, license_key: String) -> Result<LicenseStatus, String> {
    let email = email.trim();
    let license_key = license_key.trim();
    if email.is_empty() || license_key.is_empty() {
        return Err("Email and license key are required.".to_string());
    }

    let status = LicenseStatus {
        active: true,
        email: Some(email.to_string()),
        license_key: Some(license_key.to_string()),
        plan: Some("local".to_string()),
        activated_at: Some(chrono::Local::now().to_rfc3339()),
        free_exports_used: read_free_exports_used(),
        free_exports_remaining: FREE_EXPORT_LIMIT.saturating_sub(read_free_exports_used()),
        free_export_limit: FREE_EXPORT_LIMIT,
    };
    write_license_status(&status)?;
    Ok(status)
}

#[tauri::command]
fn clear_license() -> Result<LicenseStatus, String> {
    let path = get_license_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(inactive_license())
}

#[tauri::command]
fn consume_free_export() -> Result<LicenseStatus, String> {
    let mut status = read_license_status();
    if !status.active {
        let next_used = read_free_exports_used().saturating_add(1);
        write_free_exports_used(next_used)?;
        status = inactive_license();
    }
    Ok(with_export_usage(status))
}

#[tauri::command]
fn open_video_file_picker() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Video Files", &["mp4", "webm", "mkv", "avi", "mov"])
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
        .add_filter("foOm Project", &["foom", "json"])
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
            .add_filter("foOm Project", &["json"])
            .set_file_name(&default_name)
            .save_file()
        else {
            return Ok(None);
        };
        path
    };

    let raw = serde_json::to_string_pretty(&project_data)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    std::fs::write(&target_path, raw)
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
    std::fs::write(&target_path, bytes).map_err(|e| format!("Failed to write file: {}", e))?;
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

    if let Ok(raw_meta) = std::fs::metadata(raw_path) {
        let min_workspace_bytes = (raw_meta.len() / 3).max(250 * 1024 * 1024);
        let parent = output_path
            .parent()
            .ok_or_else(|| "Export output directory is invalid.".to_string())?;
        if !parent.exists() {
            return Err("Export output directory does not exist.".to_string());
        }
        let probe_path = parent.join(".foom-export-write-probe");
        std::fs::write(&probe_path, b"probe")
            .map_err(|e| format!("Cannot write to export directory: {}", e))?;
        let _ = std::fs::remove_file(probe_path);
        if raw_meta.len() > 0 && min_workspace_bytes == 0 {
            return Err("Could not estimate export workspace size.".to_string());
        }
    }

    {
        let mut exports = active_exports()
            .lock()
            .map_err(|_| "Export registry is poisoned")?;
        if exports.contains_key(&id) {
            return Err("This project is already exporting.".to_string());
        }
        exports.insert(id.clone(), Arc::new(AtomicBool::new(false)));
    }

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

    let app_clone = app.clone();
    let id_clone = id.clone();
    let output_path_str_clone = output_path_str.clone();
    let temp_output_path_str_clone = temp_output_path_str.clone();
    let composition_clone = composition.clone();
    let cancel_flag = active_exports()
        .lock()
        .ok()
        .and_then(|exports| exports.get(&id).cloned())
        .ok_or_else(|| "Failed to register export job.".to_string())?;

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

        let _ = active_exports()
            .lock()
            .map(|mut exports| exports.remove(&id_clone));

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
        raw_path.with_file_name(format!(
            "{}_cinematic.mp4",
            raw_path.file_stem().unwrap().to_string_lossy()
        ))
    };

    if !source_path.exists() {
        return Err("Source video file is missing. If downloading edited video, make sure to export it first.".to_string());
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
        eprintln!("foOm is already running; exiting duplicate launch.");
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            db::init_db();
            install_main_window_menu(app)?;

            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.hide();
            }

            // Spawn the floating recording overlay on startup in a separate thread
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(80));
                let _ = show_recording_overlay(handle);
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
            pause_recording,
            resume_recording,
            stop_recording,
            show_recording_overlay,
            persist_recording_overlay_placement,
            hide_recording_overlay,
            set_hud_overlay_size,
            show_source_selector,
            show_countdown_overlay,
            hide_countdown_overlay,
            switch_to_main_window,
            switch_to_overlay,
            close_app,
            get_recordings,
            delete_recording,
            get_project_document,
            save_project_editor_state,
            license_status,
            activate_license,
            clear_license,
            consume_free_export,
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
            reveal_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
