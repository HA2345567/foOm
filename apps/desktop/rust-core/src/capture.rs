use serde::{Deserialize, Serialize};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, EnumDisplayMonitors,
    GetDC, GetDIBits, GetMonitorInfoW, MonitorFromRect, MonitorFromWindow, ReleaseDC, SelectObject,
    StretchBlt, BITMAPINFO, BI_RGB, DIB_RGB_COLORS, HDC, HGDIOBJ, HMONITOR, MONITORINFOEXW,
    MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY, SRCCOPY,
};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

#[cfg(windows)]
fn hide_subprocess_window(command: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
fn hide_subprocess_window(command: &mut Command) -> &mut Command {
    command
}
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetShellWindow, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, IsIconic, IsWindowVisible, SendMessageTimeoutW, SMTO_ABORTIFHUNG, SMTO_BLOCK,
    WM_GETTEXT,
};

use crate::db;
use crate::hooks;

#[derive(Debug, Clone, Serialize)]
struct PauseInterval {
    t: f64,
    duration: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarChunkMetadata {
    sequence: u64,
    timestamp_ms: u64,
    byte_len: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarTrackMetadata {
    kind: String,
    path: String,
    chunks: Vec<SidecarChunkMetadata>,
    total_bytes: u64,
}

struct ActiveCapture {
    loopback: Option<crate::loopback::LoopbackCapture>,
    _session: GraphicsCaptureSession,
    frame_pool: Direct3D11CaptureFramePool,
    _capture_context: Arc<Mutex<CaptureContext>>,
    ffmpeg_process: Child,
    project_id: String,
    name: String,
    video_path: String,
    metadata_path: String,
    crop_x: i32,
    crop_y: i32,
    width: i32,
    height: i32,
    cursor_enabled: bool,
    source_metadata: CaptureSourceMetadata,
    start_time: Instant,
    pause_started: Option<Instant>,
    pause_started_active_ms: Option<u64>,
    paused_total: Duration,
    pause_intervals: Vec<PauseInterval>,
    sidecar_tracks: HashMap<String, SidecarTrackMetadata>,
    publisher_running: Arc<std::sync::atomic::AtomicBool>,
    publisher_paused: Arc<std::sync::atomic::AtomicBool>,
    publisher_thread: Option<std::thread::JoinHandle<()>>,
}

struct CaptureContext {
    _d3d_device: ID3D11Device,
    context: ID3D11DeviceContext,
    staging_texture: ID3D11Texture2D,
    texture_width: u32,
    texture_height: u32,
    crop_x: i32,
    crop_y: i32,
    output_width: i32,
    output_height: i32,
}

/// Close WGC from a detached worker so a stalled frame callback cannot block
/// recording finalization. The worker owns both COM objects until shutdown is
/// complete, keeping the frame pool alive while callbacks drain.
fn close_capture_producer_async(
    session: GraphicsCaptureSession,
    frame_pool: Direct3D11CaptureFramePool,
) {
    let _ = std::thread::Builder::new()
        .name("foom-wgc-close".to_string())
        .spawn(move || {
            let _ = session.Close();
            let _ = frame_pool.Close();
        });
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub kind: String,
    pub id: String,
    pub title: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale_factor: f64,
    #[serde(default)]
    pub primary: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureSourceMetadata {
    kind: String,
    id: String,
    title: Option<String>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    scale_factor: f64,
    #[serde(rename = "captureCropX")]
    capture_crop_x: i32,
    #[serde(rename = "captureCropY")]
    capture_crop_y: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    pub source_type: Option<String>,
    pub source: Option<CaptureSource>,
    pub region: Option<CaptureRegion>,
    pub system_audio_enabled: Option<bool>,
    pub cursor_enabled: Option<bool>,
}

impl Default for CaptureOptions {
    fn default() -> Self {
        Self {
            source_type: Some("screen".to_string()),
            source: None,
            region: None,
            system_audio_enabled: Some(false),
            cursor_enabled: Some(true),
        }
    }
}

lazy_static::lazy_static! {
    static ref ACTIVE_CAPTURE: Mutex<Option<ActiveCapture>> = Mutex::new(None);
}

struct LatestFrame {
    bytes: Vec<u8>,
    ready: bool,
}

fn get_recordings_dir() -> PathBuf {
    let mut path = std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| home.join("Videos"))
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string()))
        });
    path.push("foom");
    path.push("recordings");
    let _ = fs::create_dir_all(&path);
    path
}

fn get_ffmpeg_path() -> String {
    if let Ok(mut path) = std::env::current_exe() {
        path.pop(); // Remove exe name, now at target dir or bundle root

        // In bundled app, it's alongside the exe
        let sidecar_path = path.join("ffmpeg.exe");
        if sidecar_path.exists() {
            return sidecar_path.to_string_lossy().to_string();
        }

        // Try looking in binaries folder for development
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
    let development_sidecar = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tauri-shell/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe");
    if development_sidecar.exists() {
        return development_sidecar.to_string_lossy().to_string();
    }
    // Fallback to system PATH
    "ffmpeg".to_string()
}

fn clamp_region(region: CaptureRegion, max_width: i32, max_height: i32) -> CaptureRegion {
    let width = region.width.clamp(1, max_width.max(1));
    let height = region.height.clamp(1, max_height.max(1));
    let x = region.x.clamp(0, (max_width - width).max(0));
    let y = region.y.clamp(0, (max_height - height).max(0));
    CaptureRegion {
        x,
        y,
        width,
        height,
    }
}

fn rect_width(rect: RECT) -> i32 {
    rect.right - rect.left
}

fn rect_height(rect: RECT) -> i32 {
    rect.bottom - rect.top
}

fn monitor_scale_factor(monitor: HMONITOR) -> f64 {
    let mut dpi_x = 96u32;
    let mut dpi_y = 96u32;
    if unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) }.is_ok() {
        dpi_x as f64 / 96.0
    } else {
        1.0
    }
}

fn monitor_info(monitor: HMONITOR) -> Option<MONITORINFOEXW> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info as *mut _ as *mut _) }.as_bool() {
        Some(info)
    } else {
        None
    }
}

fn capture_source_thumbnail(source: &CaptureSource) -> Option<String> {
    const WIDTH: i32 = 160;
    const HEIGHT: i32 = 90;
    const PIXEL_BYTES: usize = (WIDTH as usize) * (HEIGHT as usize) * 4;

    if source.width <= 0 || source.height <= 0 {
        return None;
    }

    unsafe {
        let screen_dc = GetDC(HWND::default());
        if screen_dc.0.is_null() {
            return None;
        }
        let memory_dc = CreateCompatibleDC(screen_dc);
        if memory_dc.0.is_null() {
            ReleaseDC(HWND::default(), screen_dc);
            return None;
        }
        let result = (|| {
            let bitmap = CreateCompatibleBitmap(screen_dc, WIDTH, HEIGHT);
            if bitmap.0.is_null() {
                return None;
            }
            let previous = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
            let copied = StretchBlt(
                memory_dc,
                0,
                0,
                WIDTH,
                HEIGHT,
                screen_dc,
                source.x,
                source.y,
                source.width,
                source.height,
                SRCCOPY,
            )
            .as_bool();
            SelectObject(memory_dc, previous);
            if !copied {
                let _ = DeleteObject(HGDIOBJ(bitmap.0));
                return None;
            }

            let mut info = BITMAPINFO::default();
            info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
            info.bmiHeader.biWidth = WIDTH;
            info.bmiHeader.biHeight = -HEIGHT;
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB.0;
            info.bmiHeader.biSizeImage = PIXEL_BYTES as u32;
            let mut pixels = vec![0u8; PIXEL_BYTES];
            let lines = GetDIBits(
                screen_dc,
                bitmap,
                0,
                HEIGHT as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            );
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            if lines != HEIGHT {
                return None;
            }
            for pixel in pixels.chunks_exact_mut(4) {
                pixel[3] = 255;
            }

            // A tiny top-down BMP keeps the preview dependency-free and WebView2-readable.
            let mut bmp = Vec::with_capacity(54 + PIXEL_BYTES);
            bmp.extend_from_slice(b"BM");
            bmp.extend_from_slice(&((54 + PIXEL_BYTES) as u32).to_le_bytes());
            bmp.extend_from_slice(&[0; 4]);
            bmp.extend_from_slice(&54u32.to_le_bytes());
            bmp.extend_from_slice(&40u32.to_le_bytes());
            bmp.extend_from_slice(&WIDTH.to_le_bytes());
            bmp.extend_from_slice(&(-HEIGHT).to_le_bytes());
            bmp.extend_from_slice(&1u16.to_le_bytes());
            bmp.extend_from_slice(&32u16.to_le_bytes());
            bmp.extend_from_slice(&0u32.to_le_bytes());
            bmp.extend_from_slice(&(PIXEL_BYTES as u32).to_le_bytes());
            bmp.extend_from_slice(&[0; 16]);
            bmp.extend_from_slice(&pixels);
            Some(format!("data:image/bmp;base64,{}", BASE64_STANDARD.encode(bmp)))
        })();
        let _ = DeleteDC(memory_dc);
        ReleaseDC(HWND::default(), screen_dc);
        result
    }
}

fn hwnd_from_id(id: &str) -> Option<HWND> {
    let raw = id.parse::<isize>().ok()?;
    if raw == 0 {
        None
    } else {
        Some(HWND(raw as *mut std::ffi::c_void))
    }
}

fn hmonitor_from_id(id: &str) -> Option<HMONITOR> {
    let raw = id.parse::<isize>().ok()?;
    if raw == 0 {
        None
    } else {
        Some(HMONITOR(raw as *mut std::ffi::c_void))
    }
}

fn window_title(hwnd: HWND) -> Option<String> {
    // A cross-process WM_GETTEXT blocks while the target window is unresponsive,
    // which used to stall source enumeration indefinitely. Ask with a short
    // timeout so one hung application cannot break the source picker.
    let mut buf = [0u16; 512];
    let mut copied = 0usize;
    let sent = unsafe {
        SendMessageTimeoutW(
            hwnd,
            WM_GETTEXT,
            windows::Win32::Foundation::WPARAM(buf.len()),
            windows::Win32::Foundation::LPARAM(buf.as_mut_ptr() as isize),
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            50,
            Some(&mut copied),
        )
    };
    if sent.0 == 0 || copied == 0 {
        return None;
    }
    let title = String::from_utf16_lossy(&buf[..copied.min(buf.len())])
        .trim()
        .to_string();
    (!title.is_empty()).then_some(title)
}

fn visible_window_rect(hwnd: HWND) -> Option<RECT> {
    if hwnd.0.is_null()
        || !unsafe { IsWindowVisible(hwnd) }.as_bool()
        || unsafe { IsIconic(hwnd) }.as_bool()
        || hwnd == unsafe { GetShellWindow() }
    {
        return None;
    }

    let mut cloaked = 0u32;
    if unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut _ as *mut std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        )
    }
    .is_ok()
        && cloaked != 0
    {
        return None;
    }

    let mut rect = RECT::default();
    let dwm_rect = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut _ as *mut std::ffi::c_void,
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if dwm_rect.is_err() {
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
            return None;
        }
    }

    if rect_width(rect) >= 64 && rect_height(rect) >= 64 {
        Some(rect)
    } else {
        None
    }
}

pub fn enumerate_capture_sources() -> Result<Vec<CaptureSource>, String> {
    enumerate_capture_sources_internal(false)
}

pub fn enumerate_capture_sources_with_thumbnails() -> Result<Vec<CaptureSource>, String> {
    enumerate_capture_sources_internal(true)
}

fn enumerate_capture_sources_internal(include_thumbnails: bool) -> Result<Vec<CaptureSource>, String> {
    let mut sources = Vec::<CaptureSource>::new();

    unsafe extern "system" fn monitor_cb(
        monitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let sources = &mut *(data.0 as *mut Vec<CaptureSource>);
        if let Some(info) = monitor_info(monitor) {
            let rect = info.monitorInfo.rcMonitor;
            let name_end = info
                .szDevice
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(info.szDevice.len());
            let title = String::from_utf16_lossy(&info.szDevice[..name_end]);
            sources.push(CaptureSource {
                kind: "monitor".to_string(),
                id: (monitor.0 as isize).to_string(),
                title: Some(if title.is_empty() {
                    format!("Display {}", sources.len() + 1)
                } else {
                    title
                }),
                x: rect.left,
                y: rect.top,
                width: rect_width(rect),
                height: rect_height(rect),
                scale_factor: monitor_scale_factor(monitor),
                primary: info.monitorInfo.dwFlags & 1 != 0,
                thumbnail: None,
            });
        }
        true.into()
    }

    unsafe {
        let _ = EnumDisplayMonitors(
            HDC(std::ptr::null_mut()),
            None,
            Some(monitor_cb),
            LPARAM(&mut sources as *mut _ as isize),
        );
    }

    unsafe extern "system" fn window_cb(hwnd: HWND, data: LPARAM) -> BOOL {
        let sources = &mut *(data.0 as *mut Vec<CaptureSource>);
        if let (Some(rect), Some(title)) = (visible_window_rect(hwnd), window_title(hwnd)) {
            let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
            sources.push(CaptureSource {
                kind: "window".to_string(),
                id: (hwnd.0 as isize).to_string(),
                title: Some(title),
                x: rect.left,
                y: rect.top,
                width: rect_width(rect),
                height: rect_height(rect),
                scale_factor: monitor_scale_factor(monitor),
                primary: false,
                thumbnail: None,
            });
        }
        true.into()
    }

    unsafe {
        let _ = EnumWindows(Some(window_cb), LPARAM(&mut sources as *mut _ as isize));
    }

    if include_thumbnails {
        for source in &mut sources {
            source.thumbnail = capture_source_thumbnail(source);
        }
    }

    Ok(sources)
}

fn foreground_window_rect() -> Option<RECT> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    let mut rect = RECT::default();
    let ok = unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok();
    if ok && rect.right > rect.left && rect.bottom > rect.top {
        Some(rect)
    } else {
        None
    }
}

fn mux_microphone_audio(
    ffmpeg_bin: &str,
    video_path: &str,
    mic_audio_path: &str,
    temp_video_path: &str,
) -> bool {
    let mut mixed_command = Command::new(ffmpeg_bin);
    let mixed = hide_subprocess_window(&mut mixed_command)
        .args([
            "-i",
            video_path,
            "-i",
            mic_audio_path,
            "-filter_complex",
            "[0:a:0][1:a:0]amix=inputs=2:duration=longest:normalize=0[a]",
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-shortest",
            "-y",
            temp_video_path,
        ])
        .output();

    if matches!(mixed, Ok(ref out) if out.status.success()) {
        return true;
    }

    let mut fallback_command = Command::new(ffmpeg_bin);
    let fallback = hide_subprocess_window(&mut fallback_command)
        .args([
            "-i",
            video_path,
            "-i",
            mic_audio_path,
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-af",
            "apad",
            "-shortest",
            "-y",
            temp_video_path,
        ])
        .output();

    matches!(fallback, Ok(ref out) if out.status.success())
}

fn parse_ffmpeg_duration_ms(output: &str) -> Option<i64> {
    let duration_start = output.find("Duration: ")? + "Duration: ".len();
    let duration = output.get(duration_start..)?.split(',').next()?.trim();
    let mut parts = duration.split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    let millis = ((hours * 3600.0 + minutes * 60.0 + seconds) * 1000.0).round() as i64;
    if millis > 0 {
        Some(millis)
    } else {
        None
    }
}

fn probe_video_duration_ms(ffmpeg_bin: &str, video_path: &str) -> Option<i64> {
    let mut probe_command = Command::new(ffmpeg_bin);
    let output = hide_subprocess_window(&mut probe_command)
        .args(["-hide_banner", "-i", video_path])
        .output()
        .ok()?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_ffmpeg_duration_ms(&stderr)
}

fn retime_slow_capture(
    ffmpeg_bin: &str,
    video_path: &str,
    wall_duration_ms: i64,
    video_duration_ms: i64,
) -> i64 {
    if wall_duration_ms <= 0
        || video_duration_ms <= 0
        || wall_duration_ms <= video_duration_ms * 105 / 100
    {
        return video_duration_ms;
    }
    let scale = wall_duration_ms as f64 / video_duration_ms as f64;
    let staged = format!("{video_path}.retimed.mp4");
    let backup = format!("{video_path}.before-retime.mp4");
    let mut command = Command::new(ffmpeg_bin);
    let status = hide_subprocess_window(&mut command)
        .args([
            "-v",
            "error",
            "-itsscale",
            &format!("{scale:.9}"),
            "-i",
            video_path,
            "-map",
            "0:v:0",
            "-c:v",
            "copy",
            "-movflags",
            "+faststart",
            "-y",
            &staged,
        ])
        .status();
    let staged_duration = probe_video_duration_ms(ffmpeg_bin, &staged).unwrap_or(0);
    if !matches!(status, Ok(status) if status.success())
        || (staged_duration - wall_duration_ms).abs() > wall_duration_ms / 20
    {
        let _ = fs::remove_file(&staged);
        eprintln!("Could not correct capture timestamps; preserving original video");
        return video_duration_ms;
    }
    if fs::rename(video_path, &backup).is_err() {
        let _ = fs::remove_file(&staged);
        return video_duration_ms;
    }
    if let Err(error) = fs::rename(&staged, video_path) {
        let _ = fs::rename(&backup, video_path);
        eprintln!("Could not replace retimed capture: {error}");
        return video_duration_ms;
    }
    let _ = fs::remove_file(&backup);
    staged_duration
}

pub fn start_capture(options: Option<CaptureOptions>) -> Result<String, String> {
    let options = options.unwrap_or_default();
    let mut active = ACTIVE_CAPTURE.lock().unwrap();
    if active.is_some() {
        return Err("Capture is already running".to_string());
    }

    let project_id = format!("proj_{}", chrono::Local::now().timestamp_micros());
    let name = format!(
        "Recording {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    );

    let rec_dir = get_recordings_dir();
    let video_path = rec_dir
        .join(format!("{}.mp4", project_id))
        .to_string_lossy()
        .to_string();
    let metadata_path = rec_dir
        .join(format!("{}.json", project_id))
        .to_string_lossy()
        .to_string();

    let source_type = options
        .source_type
        .as_deref()
        .unwrap_or("screen")
        .to_string();
    let system_audio_enabled = options.system_audio_enabled.unwrap_or(false);
    let cursor_enabled = options.cursor_enabled.unwrap_or(true);

    if matches!(source_type.as_str(), "browser" | "area" | "region") {
        let region = options
            .region
            .as_ref()
            .ok_or("Select a capture region before recording")?;
        let request = shared_core::platform::CaptureRequest {
            source_kind: shared_core::platform::CaptureSourceKind::Region,
            region: Some(shared_core::platform::CaptureRegion {
                x: region.x,
                y: region.y,
                width: u32::try_from(region.width).map_err(|_| "Capture width must be positive")?,
                height: u32::try_from(region.height)
                    .map_err(|_| "Capture height must be positive")?,
            }),
            ..Default::default()
        };
        request.validate().map_err(|error| error.to_string())?;
    }

    // Initialize D3D11 Device
    let mut d3d_device = None;
    let mut context = None;
    unsafe {
        let _ = D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            None,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut d3d_device),
            None,
            Some(&mut context),
        );
    }

    let d3d_device = match d3d_device {
        Some(d) => d,
        None => return Err("Failed to create D3D11 device".to_string()),
    };
    let context = context.ok_or_else(|| "Failed to create D3D11 device context".to_string())?;

    // Create WinRT Direct3D Device
    let dxgi_device: IDXGIDevice = d3d_device
        .cast()
        .map_err(|e| format!("Failed to cast D3D device to DXGI: {e:?}"))?;
    let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device) }
        .map_err(|e| format!("Failed to create WinRT Direct3D device: {e:?}"))?;
    let winrt_device: IDirect3DDevice = inspectable
        .cast()
        .map_err(|e| format!("Failed to cast WinRT Direct3D device: {e:?}"))?;

    let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
        .map_err(|e| format!("Failed to access GraphicsCapture interop: {e:?}"))?;

    let default_monitor =
        unsafe { MonitorFromWindow(HWND(std::ptr::null_mut()), MONITOR_DEFAULTTOPRIMARY) };
    let selected_source = options.source.clone();
    let mut capture_crop_x = 0;
    let mut capture_crop_y = 0;
    let metadata_capture_x;
    let metadata_capture_y;
    let metadata_source;

    let (item, item_width, item_height, width, height) = if source_type == "window" {
        let hwnd = selected_source
            .as_ref()
            .filter(|source| source.kind == "window")
            .and_then(|source| hwnd_from_id(&source.id))
            .or_else(|| {
                let hwnd = unsafe { GetForegroundWindow() };
                if hwnd.0.is_null() {
                    None
                } else {
                    Some(hwnd)
                }
            })
            .ok_or_else(|| "No capturable window selected".to_string())?;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(hwnd) }
            .map_err(|e| format!("Failed to create capture item for window: {e:?}"))?;
        let size = item
            .Size()
            .map_err(|e| format!("Failed to read window capture item size: {e:?}"))?;
        let rect = visible_window_rect(hwnd)
            .or_else(|| foreground_window_rect())
            .unwrap_or(RECT {
                left: 0,
                top: 0,
                right: size.Width,
                bottom: size.Height,
            });
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        metadata_capture_x = rect.left;
        metadata_capture_y = rect.top;
        metadata_source = CaptureSourceMetadata {
            kind: "window".to_string(),
            id: (hwnd.0 as isize).to_string(),
            title: window_title(hwnd),
            x: rect.left,
            y: rect.top,
            width: rect_width(rect),
            height: rect_height(rect),
            scale_factor: monitor_scale_factor(monitor),
            capture_crop_x,
            capture_crop_y,
        };
        (item, size.Width, size.Height, size.Width, size.Height)
    } else {
        let source_region = if matches!(source_type.as_str(), "browser" | "area" | "region") {
            options.region.clone()
        } else {
            None
        };
        let monitor = selected_source
            .as_ref()
            .filter(|source| source.kind == "monitor")
            .and_then(|source| hmonitor_from_id(&source.id))
            .or_else(|| {
                source_region.as_ref().map(|region| {
                    let rect = RECT {
                        left: region.x,
                        top: region.y,
                        right: region.x + region.width,
                        bottom: region.y + region.height,
                    };
                    unsafe { MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST) }
                })
            })
            .unwrap_or(default_monitor);
        let info =
            monitor_info(monitor).ok_or_else(|| "Failed to read selected monitor".to_string())?;
        let monitor_rect = info.monitorInfo.rcMonitor;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForMonitor(monitor) }
            .map_err(|e| format!("Failed to create capture item for monitor: {e:?}"))?;
        let size = item
            .Size()
            .map_err(|e| format!("Failed to read monitor capture item size: {e:?}"))?;
        let monitor_width = rect_width(monitor_rect);
        let monitor_height = rect_height(monitor_rect);
        let is_area_capture = source_region.is_some();
        let region = source_region
            .clone()
            .map(|region| CaptureRegion {
                x: region.x - monitor_rect.left,
                y: region.y - monitor_rect.top,
                width: region.width,
                height: region.height,
            })
            .map(|region| clamp_region(region, monitor_width, monitor_height));
        let (output_width, output_height, source_x, source_y, source_w, source_h) =
            if let Some(region) = region {
                capture_crop_x = region.x;
                capture_crop_y = region.y;
                (
                    region.width,
                    region.height,
                    monitor_rect.left + region.x,
                    monitor_rect.top + region.y,
                    region.width,
                    region.height,
                )
            } else {
                (
                    size.Width,
                    size.Height,
                    monitor_rect.left,
                    monitor_rect.top,
                    monitor_width,
                    monitor_height,
                )
            };
        metadata_capture_x = source_x;
        metadata_capture_y = source_y;
        metadata_source = CaptureSourceMetadata {
            kind: if is_area_capture {
                "area".to_string()
            } else {
                "monitor".to_string()
            },
            id: (monitor.0 as isize).to_string(),
            title: selected_source
                .as_ref()
                .and_then(|source| source.title.clone())
                .or_else(|| Some("Display".to_string())),
            x: source_x,
            y: source_y,
            width: source_w,
            height: source_h,
            scale_factor: monitor_scale_factor(monitor),
            capture_crop_x,
            capture_crop_y,
        };
        (item, size.Width, size.Height, output_width, output_height)
    };

    // Create Frame Pool
    let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &winrt_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        item.Size()
            .map_err(|e| format!("Failed to read capture item size: {e:?}"))?,
    )
    .map_err(|e| format!("Failed to create capture frame pool: {e:?}"))?;

    // Create Staging Texture
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    desc.Width = item_width as u32;
    desc.Height = item_height as u32;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_STAGING;
    desc.BindFlags = 0;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
    desc.MiscFlags = 0;

    let mut staging_texture = None;
    unsafe {
        let _ = d3d_device.CreateTexture2D(&desc, None, Some(&mut staging_texture));
    }
    let staging_texture =
        staging_texture.ok_or_else(|| "Failed to create staging texture".to_string())?;

    // Launch FFmpeg Subprocess using resolved sidecar
    let ffmpeg_bin = get_ffmpeg_path();
    let mut ffmpeg_args = vec![
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgra",
        "-s",
        &format!("{}x{}", width, height),
        "-framerate",
        "60",
        "-i",
        "-",
    ]
    .into_iter()
    .map(String::from)
    .collect::<Vec<_>>();

    ffmpeg_args.extend(
        [
            "-map",
            "0:v:0",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-preset",
            "ultrafast",
            "-fps_mode",
            "cfr",
            "-r",
            "60",
            "-video_track_timescale",
            "60000",
        ]
        .into_iter()
        .map(String::from),
    );

    ffmpeg_args.extend(
        ["-movflags", "+faststart", "-y", &video_path]
            .into_iter()
            .map(String::from),
    );

    let mut ffmpeg_command = Command::new(&ffmpeg_bin);
    let mut ffmpeg_process = hide_subprocess_window(&mut ffmpeg_command)
        .args(&ffmpeg_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg recorder: {e}"))?;

    let mut ffmpeg_stdin = ffmpeg_process
        .stdin
        .take()
        .ok_or_else(|| "Failed to open FFmpeg stdin".to_string())?;

    // Setup Capture Context (without ffmpeg_stdin)
    let capture_context = Arc::new(Mutex::new(CaptureContext {
        _d3d_device: d3d_device,
        context,
        staging_texture,
        texture_width: item_width as u32,
        texture_height: item_height as u32,
        crop_x: capture_crop_x,
        crop_y: capture_crop_y,
        output_width: width,
        output_height: height,
    }));

    let capture_context_clone = capture_context.clone();

    // Pre-allocated latest-frame cache. The capture callback only updates
    // this buffer; the 60 Hz publisher reuses its own write buffer.
    let latest_frame = Arc::new((
        Mutex::new(LatestFrame {
            bytes: vec![0u8; (width * height * 4) as usize],
            ready: false,
        }),
        Condvar::new(),
    ));
    let publisher_running = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let publisher_paused = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let latest_frame_clone = latest_frame.clone();

    // Attach Frame Handler
    if let Err(e) = frame_pool.FrameArrived(&TypedEventHandler::new(
        move |pool: &Option<Direct3D11CaptureFramePool>,
              _args: &Option<windows::core::IInspectable>| {
            if let Some(pool) = pool {
                if let Ok(frame) = pool.TryGetNextFrame() {
                    if let Ok(mut ctx) = capture_context_clone.lock() {
                        if let Ok(dxgi_interface_access) = frame
                            .Surface()
                            .and_then(|s| s.cast::<IDirect3DDxgiInterfaceAccess>())
                        {
                            if let Ok(source_texture) =
                                unsafe { dxgi_interface_access.GetInterface::<ID3D11Texture2D>() }
                            {
                                unsafe {
                                    let mut source_desc = D3D11_TEXTURE2D_DESC::default();
                                    source_texture.GetDesc(&mut source_desc);
                                    if source_desc.Width != ctx.texture_width
                                        || source_desc.Height != ctx.texture_height
                                    {
                                        let mut resized_desc = source_desc;
                                        resized_desc.Usage = D3D11_USAGE_STAGING;
                                        resized_desc.BindFlags = 0;
                                        resized_desc.CPUAccessFlags =
                                            D3D11_CPU_ACCESS_READ.0 as u32;
                                        resized_desc.MiscFlags = 0;
                                        let mut resized_texture = None;
                                        ctx._d3d_device.CreateTexture2D(
                                            &resized_desc,
                                            None,
                                            Some(&mut resized_texture),
                                        )?;
                                        if let Some(texture) = resized_texture {
                                            ctx.staging_texture = texture;
                                            ctx.texture_width = source_desc.Width;
                                            ctx.texture_height = source_desc.Height;
                                        }
                                    }
                                    ctx.context
                                        .CopyResource(&ctx.staging_texture, &source_texture);
                                    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                                    if ctx
                                        .context
                                        .Map(
                                            &ctx.staging_texture,
                                            0,
                                            D3D11_MAP_READ,
                                            0,
                                            Some(&mut mapped),
                                        )
                                        .is_ok()
                                    {
                                        let row_pitch = mapped.RowPitch as usize;
                                        let data_ptr = mapped.pData as *const u8;
                                        let h = ctx.output_height as usize;
                                        let w = ctx.output_width as usize;

                                        let (frame_lock, frame_cv) = &*latest_frame_clone;
                                        if let Ok(mut latest) = frame_lock.lock() {
                                            // Ensure buffer has correct capacity
                                            if latest.bytes.len() != w * h * 4 {
                                                latest.bytes.resize(w * h * 4, 0);
                                            }
                                            let crop_x = ctx.crop_x.max(0) as usize;
                                            let crop_y = ctx.crop_y.max(0) as usize;
                                            let out_h = (ctx.output_height as usize).min(
                                                (ctx.texture_height as usize)
                                                    .saturating_sub(crop_y),
                                            );
                                            let out_w = (ctx.output_width as usize).min(
                                                (ctx.texture_width as usize).saturating_sub(crop_x),
                                            );
                                            // Never publish a partially copied frame. A region
                                            // whose physical coordinates no longer fit the
                                            // capture texture used to be padded with zeroes,
                                            // which produced black bands or an entirely black
                                            // recording on mixed-DPI displays. Keep the last
                                            // complete desktop frame until a full new frame is
                                            // available instead.
                                            if out_h == h && out_w == w && w > 0 && h > 0 {
                                                let mut dest_offset = 0;
                                                let mut row_start = data_ptr
                                                    .add((crop_y * row_pitch) + (crop_x * 4));
                                                for _ in 0..out_h {
                                                    let row_slice = std::slice::from_raw_parts(
                                                        row_start,
                                                        out_w * 4,
                                                    );
                                                    latest.bytes
                                                        [dest_offset..dest_offset + out_w * 4]
                                                        .copy_from_slice(row_slice);
                                                    dest_offset += w * 4;
                                                    row_start = row_start.add(row_pitch);
                                                }
                                                latest.ready = true;
                                                frame_cv.notify_one();
                                            }
                                        }
                                        ctx.context.Unmap(&ctx.staging_texture, 0);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Ok(())
        },
    )) {
        drop(ffmpeg_stdin);
        let _ = ffmpeg_process.kill();
        let _ = ffmpeg_process.wait();
        let _ = fs::remove_file(&video_path);
        return Err(format!("Failed to attach capture frame callback: {e:?}"));
    }

    // Spawn 60Hz publisher thread to solve VFR -> CFR mismatch
    let pub_latest_frame = latest_frame.clone();
    let pub_running = publisher_running.clone();
    let pub_paused = publisher_paused.clone();
    let recording_clock = Arc::new(Mutex::new(None));
    let publisher_clock = recording_clock.clone();
    let publisher_thread = std::thread::spawn(move || {
        let frame_duration = std::time::Duration::from_nanos(16_666_667); // 60 FPS
        let frame_size = (width * height * 4) as usize;
        let mut write_buffer = vec![0u8; frame_size];
        let (frame_lock, frame_cv) = &*pub_latest_frame;

        // Avoid leading black frames: CFR publishing starts with the first
        // actual desktop frame, then repeats the latest frame on every tick.
        let mut latest = frame_lock.lock().unwrap();
        while !latest.ready && pub_running.load(std::sync::atomic::Ordering::SeqCst) {
            let wait = frame_cv
                .wait_timeout(latest, std::time::Duration::from_millis(100))
                .unwrap();
            latest = wait.0;
        }
        if latest.ready && latest.bytes.len() == frame_size {
            write_buffer.copy_from_slice(&latest.bytes);
        }
        drop(latest);

        if pub_running.load(std::sync::atomic::Ordering::SeqCst) {
            *publisher_clock.lock().unwrap() = Some(Instant::now());
        }

        while pub_running.load(std::sync::atomic::Ordering::SeqCst) {
            let start_time = std::time::Instant::now();

            if pub_paused.load(std::sync::atomic::Ordering::SeqCst) {
                std::thread::sleep(frame_duration);
                continue;
            }

            if let Ok(frame_buf) = frame_lock.lock() {
                if frame_buf.ready && frame_buf.bytes.len() == frame_size {
                    write_buffer.copy_from_slice(&frame_buf.bytes);
                }
            }

            if ffmpeg_stdin.write_all(&write_buffer).is_err() {
                eprintln!("FFmpeg stdin write error - terminating publisher thread.");
                break;
            }

            let elapsed = start_time.elapsed();
            if elapsed < frame_duration {
                std::thread::sleep(frame_duration - elapsed);
            }
        }
        let _ = ffmpeg_stdin.flush();
    });

    // Create and Start Session
    let session = match frame_pool.CreateCaptureSession(&item) {
        Ok(session) => session,
        Err(e) => {
            publisher_running.store(false, std::sync::atomic::Ordering::SeqCst);
            {
                let (_, frame_cv) = &*latest_frame;
                frame_cv.notify_all();
            }
            let _ = publisher_thread.join();
            let _ = ffmpeg_process.kill();
            let _ = ffmpeg_process.wait();
            let _ = fs::remove_file(&video_path);
            return Err(format!("Failed to create capture session: {e:?}"));
        }
    };
    let loopback = if system_audio_enabled {
        match crate::loopback::LoopbackCapture::start(
            rec_dir.join(format!("{}_system.wav", project_id)),
            publisher_paused.clone(),
            recording_clock,
        ) {
            Ok(loopback) => Some(loopback),
            Err(error) => {
                let _ = frame_pool.Close();
                publisher_running.store(false, std::sync::atomic::Ordering::SeqCst);
                let _ = publisher_thread.join();
                let _ = ffmpeg_process.kill();
                let _ = ffmpeg_process.wait();
                return Err(error);
            }
        }
    } else {
        None
    };
    // Editable cursor mode hides the OS cursor in the video and stores cursor
    // telemetry for the editor. System cursor mode bakes the OS cursor into the
    // capture stream.
    let _ = session.SetIsCursorCaptureEnabled(!cursor_enabled);
    if let Err(e) = session.StartCapture() {
        publisher_running.store(false, std::sync::atomic::Ordering::SeqCst);
        {
            let (_, frame_cv) = &*latest_frame;
            frame_cv.notify_all();
        }
        let _ = publisher_thread.join();
        let _ = ffmpeg_process.kill();
        let _ = ffmpeg_process.wait();
        let _ = fs::remove_file(&video_path);
        return Err(format!("Failed to start capture session: {e:?}"));
    }

    let started_project_id = project_id.clone();
    *active = Some(ActiveCapture {
        loopback,
        _session: session,
        frame_pool,
        _capture_context: capture_context,
        ffmpeg_process,
        project_id,
        name,
        video_path,
        metadata_path,
        crop_x: metadata_capture_x,
        crop_y: metadata_capture_y,
        width,
        height,
        cursor_enabled,
        source_metadata: metadata_source,
        start_time: Instant::now(),
        pause_started: None,
        pause_started_active_ms: None,
        paused_total: Duration::ZERO,
        pause_intervals: Vec::new(),
        sidecar_tracks: HashMap::new(),
        publisher_running,
        publisher_paused,
        publisher_thread: Some(publisher_thread),
    });

    hooks::start_hooks();
    Ok(started_project_id)
}

pub fn append_sidecar_chunk(
    kind: String,
    bytes: Vec<u8>,
    timestamp_ms: u64,
    sequence: u64,
) -> Result<(), String> {
    if bytes.is_empty() {
        return Ok(());
    }

    let mut active = ACTIVE_CAPTURE.lock().unwrap();
    let Some(cap) = active.as_mut() else {
        return Err("No active capture session".to_string());
    };

    let suffix = match kind.as_str() {
        "mic" => "mic.webm",
        "webcam" => "webcam.webm",
        _ => return Err("Unsupported sidecar kind".to_string()),
    };

    let path = get_recordings_dir().join(format!("{}_{}", cap.project_id, suffix));
    let path_string = path.to_string_lossy().to_string();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open sidecar file: {}", e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to append sidecar chunk: {}", e))?;

    let chunk = SidecarChunkMetadata {
        sequence,
        timestamp_ms,
        byte_len: bytes.len() as u64,
    };
    let track = cap
        .sidecar_tracks
        .entry(kind.clone())
        .or_insert_with(|| SidecarTrackMetadata {
            kind,
            path: path_string,
            chunks: Vec::new(),
            total_bytes: 0,
        });
    track.total_bytes += chunk.byte_len;
    track.chunks.push(chunk);
    Ok(())
}

pub fn discard_sidecar_track(kind: String) -> Result<(), String> {
    let mut active = ACTIVE_CAPTURE.lock().unwrap();
    let Some(cap) = active.as_mut() else {
        return Err("No active capture session".to_string());
    };

    let suffix = match kind.as_str() {
        "mic" => "mic.webm",
        "webcam" => "webcam.webm",
        _ => return Err("Unsupported sidecar kind".to_string()),
    };
    let path = cap
        .sidecar_tracks
        .remove(&kind)
        .map(|track| std::path::PathBuf::from(track.path))
        .unwrap_or_else(|| get_recordings_dir().join(format!("{}_{}", cap.project_id, suffix)));

    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to discard recording sidecar: {error}")),
    }
}

pub fn pause_capture() -> Result<(), String> {
    pause_capture_session(None)
}

pub fn pause_capture_session(project_id: Option<&str>) -> Result<(), String> {
    let mut active = ACTIVE_CAPTURE.lock().unwrap();
    if let Some(cap) = active.as_mut() {
        if project_id.is_some_and(|id| id != cap.project_id) {
            return Err("Capture session is no longer active".to_string());
        }
        if cap.pause_started.is_some() {
            return Ok(());
        }
        let active_ms = cap
            .start_time
            .elapsed()
            .saturating_sub(cap.paused_total)
            .as_millis() as u64;
        cap.pause_started = Some(Instant::now());
        cap.pause_started_active_ms = Some(active_ms);
        cap.publisher_paused
            .store(true, std::sync::atomic::Ordering::SeqCst);
        hooks::pause_hooks();
        Ok(())
    } else {
        Err("No active capture session".to_string())
    }
}

pub fn resume_capture() -> Result<(), String> {
    resume_capture_session(None)
}

pub fn resume_capture_session(project_id: Option<&str>) -> Result<(), String> {
    let mut active = ACTIVE_CAPTURE.lock().unwrap();
    if let Some(cap) = active.as_mut() {
        if project_id.is_some_and(|id| id != cap.project_id) {
            return Err("Capture session is no longer active".to_string());
        }
        if let Some(started) = cap.pause_started.take() {
            let duration = started.elapsed();
            cap.paused_total += duration;
            let t = cap.pause_started_active_ms.take().unwrap_or_else(|| {
                cap.start_time
                    .elapsed()
                    .saturating_sub(cap.paused_total)
                    .as_millis() as u64
            });
            cap.pause_intervals.push(PauseInterval {
                t: t as f64 / 1000.0,
                duration: duration.as_secs_f64(),
            });
        }
        hooks::resume_hooks();
        cap.publisher_paused
            .store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    } else {
        Err("No active capture session".to_string())
    }
}

pub fn is_capturing() -> bool {
    ACTIVE_CAPTURE.lock().unwrap().is_some()
}

pub fn cancel_capture_session(project_id: &str) -> Result<(), String> {
    let mut active = ACTIVE_CAPTURE.lock().unwrap();
    let Some(mut cap) = active.take() else {
        return Err("No active capture session".to_string());
    };
    if cap.project_id != project_id {
        *active = Some(cap);
        return Err("Capture session is no longer active".to_string());
    }

    hooks::stop_hooks();
    if let Some(loopback) = cap.loopback.take() {
        loopback.request_stop();
        let _ = loopback.stop();
    }
    // Stop the consumer before asking WGC to close. Close can wait on an
    // in-flight free-threaded FrameArrived callback, so do not let it keep the
    // publisher feeding FFmpeg (and the Stop → editor transition) indefinitely.
    cap.publisher_running
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let _ = cap.ffmpeg_process.kill();
    close_capture_producer_async(cap._session.clone(), cap.frame_pool.clone());
    if let Some(handle) = cap.publisher_thread.take() {
        let _ = handle.join();
    }
    let _ = cap.ffmpeg_process.wait();

    // A cancelled, unfinished take has not been registered as a project. Only
    // remove files created for this exact active session; never delete a
    // finalized project or a path supplied by the caller.
    for path in [
        PathBuf::from(&cap.video_path),
        PathBuf::from(&cap.metadata_path),
        PathBuf::from(&cap.metadata_path).with_file_name(format!("{}_mic.webm", cap.project_id)),
        PathBuf::from(&cap.metadata_path).with_file_name(format!("{}_webcam.webm", cap.project_id)),
        PathBuf::from(&cap.metadata_path).with_file_name(format!("{}_system.wav", cap.project_id)),
        PathBuf::from(&cap.metadata_path).with_file_name(format!("{}_temp.mp4", cap.project_id)),
    ] {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

pub fn stop_capture(
    mic_audio_bytes: Option<Vec<u8>>,
    camera_video_bytes: Option<Vec<u8>>,
    camera_mime_type: Option<String>,
    camera_shape: Option<String>,
) -> Result<db::Project, String> {
    stop_capture_session(
        None,
        mic_audio_bytes,
        camera_video_bytes,
        camera_mime_type,
        camera_shape,
    )
}

fn persist_encoder_failure_recovery(
    cap: &ActiveCapture,
    input_events: &[hooks::InputEvent],
    stopped_at: Instant,
) -> Result<bool, String> {
    let video_path = PathBuf::from(&cap.video_path);
    let Ok(media) = fs::metadata(&video_path) else {
        return Ok(false);
    };
    if !media.is_file() || media.len() == 0 {
        return Ok(false);
    }

    let elapsed = stopped_at
        .duration_since(cap.start_time)
        .saturating_sub(cap.paused_total)
        .as_millis() as i64;
    let duration = probe_video_duration_ms(&get_ffmpeg_path(), &cap.video_path).unwrap_or(elapsed);
    let created_at = chrono::Local::now().to_rfc3339();
    let recovery_metadata = serde_json::json!({
        "documentVersion": 1,
        "id": cap.project_id,
        "name": cap.name,
        "createdAt": created_at,
        "width": cap.width,
        "height": cap.height,
        "captureX": cap.crop_x,
        "captureY": cap.crop_y,
        "duration": duration,
        "events": input_events,
        "pauses": cap.pause_intervals,
        "cursorEnabled": cap.cursor_enabled,
        "source": cap.source_metadata,
        "media": {
            "rawVideoPath": cap.video_path,
            "metadataPath": cap.metadata_path,
        },
        "editor": {},
        "recovery": { "postProcessingPending": true, "encoderFailed": true },
    });
    let json = serde_json::to_string_pretty(&recovery_metadata)
        .map_err(|error| format!("Failed to serialize recovery metadata: {error}"))?;
    fs::write(&cap.metadata_path, json)
        .map_err(|error| format!("Failed to save recovery metadata: {error}"))?;
    db::create_project(
        &cap.project_id,
        &cap.name,
        &cap.video_path,
        &cap.metadata_path,
        duration,
        cap.width,
        cap.height,
    )
    .map_err(|error| format!("Failed to register recoverable recording: {error}"))?;
    Ok(true)
}

pub fn stop_capture_session(
    project_id: Option<&str>,
    mic_audio_bytes: Option<Vec<u8>>,
    camera_video_bytes: Option<Vec<u8>>,
    camera_mime_type: Option<String>,
    camera_shape: Option<String>,
) -> Result<db::Project, String> {
    let mut active = ACTIVE_CAPTURE.lock().unwrap();
    if let Some(mut cap) = active.take() {
        if project_id.is_some_and(|id| id != cap.project_id) {
            *active = Some(cap);
            return Err("Capture session is no longer active".to_string());
        }
        println!("Stopping WGC capture session.");

        // Freeze input and elapsed time before encoder finalization and audio muxing.
        let input_events = hooks::stop_hooks();
        let stopped_at = Instant::now();
        if let Some(loopback) = cap.loopback.as_ref() {
            loopback.request_stop();
        }

        // Stop frame publication first. WGC Close can wait for an in-flight
        // FrameArrived callback, so run it on a detached worker while retaining
        // ownership of both COM objects until callbacks drain.
        cap.publisher_running
            .store(false, std::sync::atomic::Ordering::SeqCst);
        close_capture_producer_async(cap._session.clone(), cap.frame_pool.clone());

        // Stop and wait for publisher thread. Dropping its stdin closes FFmpeg's
        // rawvideo input so the MP4 trailer can be written before editor routing.
        let loopback_result = cap.loopback.take().map(|loopback| loopback.stop());
        if let Some(handle) = cap.publisher_thread.take() {
            let _ = handle.join();
        }

        // Wait for FFmpeg process to terminate
        match cap.ffmpeg_process.wait() {
            Ok(status) if status.success() => {}
            Ok(status) => {
                let recovery = persist_encoder_failure_recovery(&cap, &input_events, stopped_at)
                    .unwrap_or(false);
                return Err(if recovery {
                    format!(
                        "Recording encoder exited with {status}; a recoverable partial recording was saved at {}",
                        cap.metadata_path
                    )
                } else {
                    format!(
                        "Recording encoder exited with {status}; no recoverable media was produced"
                    )
                });
            }
            Err(error) => {
                let recovery = persist_encoder_failure_recovery(&cap, &input_events, stopped_at)
                    .unwrap_or(false);
                return Err(if recovery {
                    format!(
                        "Failed to finalize recording: {error}; a recoverable partial recording was saved at {}",
                        cap.metadata_path
                    )
                } else {
                    format!("Failed to finalize recording: {error}")
                });
            }
        };

        if let Some(started) = cap.pause_started.take() {
            let duration = stopped_at.duration_since(started);
            cap.paused_total += duration;
            let t = cap.pause_started_active_ms.take().unwrap_or_else(|| {
                cap.start_time
                    .elapsed()
                    .saturating_sub(cap.paused_total)
                    .as_millis() as u64
            });
            cap.pause_intervals.push(PauseInterval {
                t: t as f64 / 1000.0,
                duration: duration.as_secs_f64(),
            });
        }
        let elapsed = stopped_at
            .duration_since(cap.start_time)
            .saturating_sub(cap.paused_total)
            .as_millis() as i64;

        let rec_dir = get_recordings_dir();
        let ffmpeg_bin = get_ffmpeg_path();
        let encoded_duration =
            probe_video_duration_ms(&ffmpeg_bin, &cap.video_path).unwrap_or(elapsed);
        let media_duration =
            retime_slow_capture(&ffmpeg_bin, &cap.video_path, elapsed, encoded_duration);
        let created_at = chrono::Local::now().to_rfc3339();

        // Register the finalized raw recording before audio muxing or webcam
        // sidecar persistence can fail. The initial document is intentionally
        // sufficient to reopen the raw video; it is replaced with complete
        // timeline metadata after optional post-processing succeeds.
        let recovery_metadata = serde_json::json!({
            "documentVersion": 1,
            "id": cap.project_id.clone(),
            "name": cap.name.clone(),
            "createdAt": created_at.clone(),
            "width": cap.width,
            "height": cap.height,
            "captureX": cap.crop_x,
            "captureY": cap.crop_y,
            "duration": media_duration,
            "events": input_events.clone(),
            "pauses": cap.pause_intervals.clone(),
            "cursorEnabled": cap.cursor_enabled,
            "source": cap.source_metadata.clone(),
            "media": {
                "rawVideoPath": cap.video_path.clone(),
                "metadataPath": cap.metadata_path.clone(),
            },
            "editor": {},
            "recovery": { "postProcessingPending": true },
        });
        let recovery_json = serde_json::to_string_pretty(&recovery_metadata)
            .map_err(|e| format!("Failed to serialize recovery metadata: {e}"))?;
        fs::write(&cap.metadata_path, recovery_json)
            .map_err(|e| format!("Failed to save recovery metadata: {e}"))?;
        db::create_project(
            &cap.project_id,
            &cap.name,
            &cap.video_path,
            &cap.metadata_path,
            media_duration,
            cap.width,
            cap.height,
        )
        .map_err(|e| format!("Failed to register recoverable recording: {e}"))?;

        if let Some(result) = loopback_result {
            result?;
            let system_audio_path = rec_dir.join(format!("{}_system.wav", cap.project_id));
            let temp_video_path = rec_dir.join(format!("{}_temp.mp4", cap.project_id));
            if !mux_microphone_audio(
                &ffmpeg_bin,
                &cap.video_path,
                &system_audio_path.to_string_lossy(),
                &temp_video_path.to_string_lossy(),
            ) {
                return Err(format!(
                    "Failed to add system audio; recording and audio retained in {}",
                    rec_dir.display()
                ));
            }
            fs::rename(&temp_video_path, &cap.video_path)
                .map_err(|e| format!("Failed to save recording with system audio: {e}"))?;
            let _ = fs::remove_file(system_audio_path);
        }

        // Mux microphone audio if provided or streamed to a sidecar file.
        let mic_audio_path = rec_dir
            .join(format!("{}_mic.webm", cap.project_id))
            .to_string_lossy()
            .to_string();
        if let Some(audio_bytes) = mic_audio_bytes {
            if !audio_bytes.is_empty() {
                let _ = fs::write(&mic_audio_path, &audio_bytes);
            }
        }
        if std::path::Path::new(&mic_audio_path).exists() {
            let temp_video_path = rec_dir
                .join(format!("{}_temp.mp4", cap.project_id))
                .to_string_lossy()
                .to_string();
            if mux_microphone_audio(
                &ffmpeg_bin,
                &cap.video_path,
                &mic_audio_path,
                &temp_video_path,
            ) {
                // Replace the original atomically; deleting first can lose the
                // recording if the move fails (for example, while a file is locked).
                if let Err(error) = fs::rename(&temp_video_path, &cap.video_path) {
                    eprintln!("Failed to replace recording with mixed audio: {error}");
                } else {
                    let _ = fs::remove_file(&mic_audio_path);
                }
            } else {
                println!("ffmpeg microphone/system-audio muxing failed");
                let _ = fs::remove_file(&temp_video_path);
            }
        }

        let mut camera_video_path: Option<String> = None;
        if let Some(camera_bytes) = camera_video_bytes {
            if !camera_bytes.is_empty() {
                let extension = camera_mime_type
                    .as_deref()
                    .map(|mime| if mime.contains("mp4") { "mp4" } else { "webm" })
                    .unwrap_or("webm");
                let path = get_recordings_dir()
                    .join(format!("{}_webcam.{}", cap.project_id, extension))
                    .to_string_lossy()
                    .to_string();
                fs::write(&path, camera_bytes)
                    .map_err(|e| format!("Failed to save webcam sidecar: {}", e))?;
                camera_video_path = Some(path);
            }
        }
        if camera_video_path.is_none() {
            let streamed_path = get_recordings_dir()
                .join(format!("{}_webcam.webm", cap.project_id))
                .to_string_lossy()
                .to_string();
            if std::path::Path::new(&streamed_path).exists() {
                camera_video_path = Some(streamed_path);
            }
        }
        let mic_track = cap.sidecar_tracks.get("mic").cloned();
        let webcam_track = cap.sidecar_tracks.get("webcam").cloned();

        // Write timeline metadata JSON file
        #[derive(Serialize)]
        struct RecordingMetadata {
            #[serde(rename = "documentVersion")]
            document_version: u32,
            id: String,
            name: String,
            #[serde(rename = "createdAt")]
            created_at: String,
            width: i32,
            height: i32,
            #[serde(rename = "captureX")]
            capture_x: i32,
            #[serde(rename = "captureY")]
            capture_y: i32,
            duration: i64,
            events: Vec<hooks::InputEvent>,
            pauses: Vec<PauseInterval>,
            #[serde(rename = "cameraVideoPath", skip_serializing_if = "Option::is_none")]
            camera_video_path: Option<String>,
            #[serde(rename = "cameraMimeType", skip_serializing_if = "Option::is_none")]
            camera_mime_type: Option<String>,
            #[serde(rename = "cameraShape", skip_serializing_if = "Option::is_none")]
            camera_shape: Option<String>,
            #[serde(rename = "cursorEnabled")]
            cursor_enabled: bool,
            #[serde(rename = "micTrack", skip_serializing_if = "Option::is_none")]
            mic_track: Option<SidecarTrackMetadata>,
            #[serde(rename = "webcamTrack", skip_serializing_if = "Option::is_none")]
            webcam_track: Option<SidecarTrackMetadata>,
            source: CaptureSourceMetadata,
            media: serde_json::Value,
            editor: serde_json::Value,
        }

        let metadata = RecordingMetadata {
            document_version: 1,
            id: cap.project_id.clone(),
            name: cap.name.clone(),
            created_at,
            width: cap.width,
            height: cap.height,
            capture_x: cap.crop_x,
            capture_y: cap.crop_y,
            duration: media_duration,
            events: input_events,
            pauses: cap.pause_intervals,
            camera_video_path: camera_video_path.clone(),
            camera_mime_type,
            camera_shape,
            cursor_enabled: cap.cursor_enabled,
            mic_track,
            webcam_track,
            source: cap.source_metadata,
            media: serde_json::json!({
                "rawVideoPath": cap.video_path.clone(),
                "metadataPath": cap.metadata_path.clone(),
                "cameraVideoPath": camera_video_path.clone(),
            }),
            editor: serde_json::json!({}),
        };

        let json_str = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize recording metadata: {e}"))?;
        fs::write(&cap.metadata_path, json_str)
            .map_err(|e| format!("Failed to save recording metadata: {e}"))?;

        println!("Project {} created successfully.", cap.project_id);

        db::get_project(&cap.project_id)
            .map_err(|e| format!("Failed to retrieve saved project: {}", e))
    } else {
        Err("No active capture session".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "records a real Windows display and system output audio"]
    fn native_record_pause_resume_stop_and_export_smoke() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../target")
            .join(format!(
                "native-smoke-{}",
                chrono::Local::now().timestamp_micros()
            ));
        fs::create_dir_all(&root).unwrap();
        std::env::set_var("LOCALAPPDATA", &root);
        std::env::set_var("USERPROFILE", &root);
        db::init_db();
        let id = start_capture(Some(CaptureOptions {
            source_type: Some("area".to_string()),
            source: None,
            region: Some(CaptureRegion {
                x: 0,
                y: 0,
                width: 640,
                height: 360,
            }),
            system_audio_enabled: Some(true),
            cursor_enabled: Some(true),
        }))
        .unwrap();
        std::thread::sleep(Duration::from_millis(500));
        pause_capture().unwrap();
        std::thread::sleep(Duration::from_millis(400));
        resume_capture().unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let project = stop_capture(None, None, None, None).unwrap();
        assert_eq!(project.id, id);
        assert!(
            (600..=1400).contains(&project.duration),
            "unexpected video duration {}",
            project.duration
        );
        let document = db::get_project_document(&id).unwrap();
        assert_eq!(document["documentVersion"], 1);
        assert_eq!(document["pauses"].as_array().unwrap().len(), 1);
        let export_path = root.join("native-export.mp4");
        export_engine::run_export_controlled(
            &project.raw_video_path,
            &project.metadata_path,
            export_path.to_str().unwrap(),
            640,
            360,
            project.duration as f64 / 1000.0,
            None,
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
            |_| {},
        )
        .unwrap();
        for media in [
            project.raw_video_path.as_str(),
            export_path.to_str().unwrap(),
        ] {
            let mut command = Command::new(get_ffmpeg_path());
            let decoded = hide_subprocess_window(&mut command)
                .args([
                    "-hide_banner",
                    "-i",
                    media,
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0",
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .unwrap();
            assert!(
                decoded.status.success(),
                "decode failed: {}",
                String::from_utf8_lossy(&decoded.stderr)
            );
        }
        println!(
            "Native recording, pause/resume, system audio, metadata and export verified: {}",
            root.display()
        );
    }

    #[test]
    fn small_capture_regions_never_exceed_source_texture() {
        let region = clamp_region(
            CaptureRegion {
                x: 100,
                y: -10,
                width: 500,
                height: 500,
            },
            32,
            24,
        );
        assert_eq!(
            (region.x, region.y, region.width, region.height),
            (0, 0, 32, 24)
        );
    }
}
