use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::HINSTANCE;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{DeleteObject, GetObjectW, BITMAP};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorInfo, GetIconInfo, GetMessageW, LoadCursorW,
    PeekMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
    CURSORINFO, ICONINFO, IDC_APPSTARTING, IDC_ARROW, IDC_CROSS, IDC_HAND, IDC_HELP, IDC_IBEAM,
    IDC_NO, IDC_SIZEALL, IDC_SIZENESW, IDC_SIZENS, IDC_SIZENWSE, IDC_SIZEWE, IDC_UPARROW, IDC_WAIT,
    MSG, MSLLHOOKSTRUCT, PM_NOREMOVE, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
    WM_MOUSEWHEEL, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum InputEvent {
    #[serde(rename = "move")]
    MouseMove {
        x: i32,
        y: i32,
        t: u64,
        #[serde(rename = "cursorType")]
        cursor_type: String,
    },
    #[serde(rename = "click_down")]
    MouseDown {
        x: i32,
        y: i32,
        btn: String,
        t: u64,
        #[serde(rename = "cursorType")]
        cursor_type: String,
    },
    #[serde(rename = "click_up")]
    MouseUp {
        x: i32,
        y: i32,
        btn: String,
        t: u64,
        #[serde(rename = "cursorType")]
        cursor_type: String,
    },
    #[serde(rename = "scroll")]
    MouseScroll {
        x: i32,
        y: i32,
        delta: i32,
        t: u64,
        #[serde(rename = "cursorType")]
        cursor_type: String,
    },
}

/// Maps standard Windows cursor handles to semantic sprites for video playback.
/// Unknown app-specific shapes safely fall back to the default arrow.
fn cursor_type_for_handle(handle: isize) -> &'static str {
    static CURSOR_TYPES: OnceLock<std::collections::HashMap<isize, &'static str>> = OnceLock::new();
    let cursor_types = CURSOR_TYPES.get_or_init(|| unsafe {
        [
            (IDC_ARROW, "arrow"),
            (IDC_IBEAM, "text"),
            (IDC_HAND, "pointer"),
            (IDC_CROSS, "crosshair"),
            (IDC_SIZEALL, "move"),
            (IDC_SIZEWE, "resize-ew"),
            (IDC_SIZENS, "resize-ns"),
            (IDC_SIZENESW, "resize-nesw"),
            (IDC_SIZENWSE, "resize-nwse"),
            (IDC_NO, "not-allowed"),
            (IDC_WAIT, "wait"),
            (IDC_APPSTARTING, "app-starting"),
            (IDC_HELP, "help"),
            (IDC_UPARROW, "up-arrow"),
        ]
        .into_iter()
        .filter_map(|(resource, cursor_type)| {
            LoadCursorW(HINSTANCE::default(), resource)
                .ok()
                .map(|cursor| (cursor.0 as isize, cursor_type))
        })
        .collect()
    });

    cursor_types.get(&handle).copied().unwrap_or("arrow")
}

/// Chromium and other apps often create their own hand cursor instead of using
/// the shared IDC_HAND handle. Recognize that common custom cursor by its
/// upper-left pointing-finger hotspot; leave centered and top-left arrows alone.
fn classify_custom_cursor(
    handle: windows::Win32::UI::WindowsAndMessaging::HCURSOR,
) -> Option<&'static str> {
    let mut info = ICONINFO::default();
    if unsafe { GetIconInfo(handle, &mut info) }.is_err() {
        return None;
    }
    let bitmap_handle = if !info.hbmColor.0.is_null() {
        info.hbmColor
    } else {
        info.hbmMask
    };
    let mut bitmap = BITMAP::default();
    let bitmap_size = unsafe {
        GetObjectW(
            bitmap_handle,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bitmap as *mut _ as *mut _),
        )
    };
    unsafe {
        if !info.hbmColor.0.is_null() {
            let _ = DeleteObject(info.hbmColor);
        }
        if !info.hbmMask.0.is_null() {
            let _ = DeleteObject(info.hbmMask);
        }
    }
    if bitmap_size == 0 || bitmap.bmWidth <= 0 || bitmap.bmHeight <= 0 {
        return None;
    }
    let x = info.xHotspot as f32 / bitmap.bmWidth as f32;
    let y = info.yHotspot as f32 / bitmap.bmHeight as f32;
    (x > 0.08 && x < 0.42 && y < 0.28).then_some("pointer")
}

fn cursor_type_for_cursor(
    handle: windows::Win32::UI::WindowsAndMessaging::HCURSOR,
) -> &'static str {
    let known_type = cursor_type_for_handle(handle.0 as isize);
    if known_type == "arrow" {
        classify_custom_cursor(handle).unwrap_or(known_type)
    } else {
        known_type
    }
}

fn current_cursor_type() -> String {
    let mut info = CURSORINFO {
        cbSize: std::mem::size_of::<CURSORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetCursorInfo(&mut info) }.is_ok() {
        cursor_type_for_cursor(info.hCursor).to_string()
    } else {
        "arrow".to_string()
    }
}

lazy_static::lazy_static! {
    pub static ref EVENTS: Mutex<Vec<InputEvent>> = Mutex::new(Vec::new());
    static ref START_TIME: Mutex<Option<Instant>> = Mutex::new(None);
    static ref PAUSE_STARTED: Mutex<Option<Instant>> = Mutex::new(None);
    static ref PAUSED_TOTAL: Mutex<Duration> = Mutex::new(Duration::ZERO);
    static ref EVENT_TX: Mutex<Option<std::sync::mpsc::Sender<InputEvent>>> = Mutex::new(None);
    static ref HOOK_RUNTIME: Mutex<Option<HookRuntime>> = Mutex::new(None);
}

struct HookRuntime {
    thread_id: u32,
    hook_thread: thread::JoinHandle<()>,
    cursor_thread: thread::JoinHandle<()>,
    cursor_thread_stop: Arc<AtomicBool>,
    event_thread: thread::JoinHandle<()>,
}

fn get_elapsed_ms() -> u64 {
    if let Some(start) = *START_TIME.lock().unwrap() {
        let pause_started = PAUSE_STARTED.lock().unwrap();
        let paused_total = *PAUSED_TOTAL.lock().unwrap();
        let active_pause = pause_started
            .map(|pause_started| pause_started.elapsed())
            .unwrap_or(Duration::ZERO);
        start
            .elapsed()
            .saturating_sub(paused_total + active_pause)
            .as_millis() as u64
    } else {
        0
    }
}

fn hooks_are_paused() -> bool {
    PAUSE_STARTED.lock().unwrap().is_some()
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        if hooks_are_paused() {
            return CallNextHookEx(None, code, wparam, lparam);
        }
        let ms_struct = *(lparam.0 as *const MSLLHOOKSTRUCT);
        let x = ms_struct.pt.x;
        let y = ms_struct.pt.y;
        let t = get_elapsed_ms();
        let cursor_type = current_cursor_type();

        let event = match wparam.0 as u32 {
            WM_MOUSEMOVE => Some(InputEvent::MouseMove {
                x,
                y,
                t,
                cursor_type,
            }),
            WM_LBUTTONDOWN => Some(InputEvent::MouseDown {
                x,
                y,
                btn: "left".to_string(),
                t,
                cursor_type,
            }),
            WM_LBUTTONUP => Some(InputEvent::MouseUp {
                x,
                y,
                btn: "left".to_string(),
                t,
                cursor_type,
            }),
            WM_RBUTTONDOWN => Some(InputEvent::MouseDown {
                x,
                y,
                btn: "right".to_string(),
                t,
                cursor_type,
            }),
            WM_RBUTTONUP => Some(InputEvent::MouseUp {
                x,
                y,
                btn: "right".to_string(),
                t,
                cursor_type,
            }),
            WM_MOUSEWHEEL => {
                let delta = (ms_struct.mouseData >> 16) as i16 as i32;
                Some(InputEvent::MouseScroll {
                    x,
                    y,
                    delta,
                    t,
                    cursor_type,
                })
            }
            _ => None,
        };

        if let Some(ev) = event {
            if let Ok(tx_lock) = EVENT_TX.lock() {
                if let Some(ref tx) = *tx_lock {
                    let _ = tx.send(ev);
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub fn start_hooks() {
    let mut runtime = HOOK_RUNTIME.lock().unwrap();
    if runtime.is_some() {
        return;
    }
    // Prime system cursor handles before the low-level callback starts so the
    // first movement does not perform handle loading inside Windows' hook path.
    let _ = cursor_type_for_handle(0);
    *START_TIME.lock().unwrap() = Some(Instant::now());
    *PAUSE_STARTED.lock().unwrap() = None;
    *PAUSED_TOTAL.lock().unwrap() = Duration::ZERO;
    EVENTS.lock().unwrap().clear();

    let (tx, rx) = std::sync::mpsc::channel();
    if let Ok(mut tx_lock) = EVENT_TX.lock() {
        *tx_lock = Some(tx);
    }

    // Background thread to drain channel and populate EVENTS vector asynchronously
    // This resolves hook latency by avoiding mutex contention inside the mouse hook.
    let event_thread = thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            if let Ok(mut evs) = EVENTS.lock() {
                evs.push(event);
            }
        }
    });

    // Windows changes the cursor after delivering the mouse-move message to the
    // target window. Polling only in the low-level hook can therefore miss an
    // I-beam/hand change when the pointer stops immediately. Sample only type
    // transitions at 60Hz; ordinary positions still come from the low-level hook.
    let cursor_thread_stop = Arc::new(AtomicBool::new(false));
    let cursor_thread_stop_signal = Arc::clone(&cursor_thread_stop);
    let cursor_thread = thread::spawn(move || {
        let mut last_cursor_type: Option<String> = None;
        while !cursor_thread_stop_signal.load(Ordering::Relaxed) {
            if !hooks_are_paused() {
                let mut info = CURSORINFO {
                    cbSize: std::mem::size_of::<CURSORINFO>() as u32,
                    ..Default::default()
                };
                if unsafe { GetCursorInfo(&mut info) }.is_ok() {
                    // Use the same classifier as the low-level hook. Custom hand
                    // cursors often use app-owned handles instead of IDC_HAND; if
                    // only the hook path classifies them, a stationary hover loses
                    // its pointer transition as soon as the cursor stops moving.
                    let cursor_type = cursor_type_for_cursor(info.hCursor).to_string();
                    if last_cursor_type.as_deref() != Some(cursor_type.as_str()) {
                        if let Ok(tx_lock) = EVENT_TX.lock() {
                            if let Some(tx) = tx_lock.as_ref() {
                                let _ = tx.send(InputEvent::MouseMove {
                                    x: info.ptScreenPos.x,
                                    y: info.ptScreenPos.y,
                                    t: get_elapsed_ms(),
                                    cursor_type: cursor_type.clone(),
                                });
                            }
                        }
                        last_cursor_type = Some(cursor_type);
                    }
                }
            } else {
                last_cursor_type = None;
            }
            thread::sleep(Duration::from_millis(16));
        }
    });

    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
    let hook_thread = thread::spawn(move || unsafe {
        let thread_id = windows::Win32::System::Threading::GetCurrentThreadId();
        // PostThreadMessage requires a message queue, including when recording
        // is stopped immediately after start.
        let mut msg = MSG::default();
        let _ = PeekMessageW(&mut msg, HWND::default(), 0, 0, PM_NOREMOVE);

        let module = GetModuleHandleW(None).unwrap_or_default();

        let m_hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0) {
            Ok(h) => Some(h),
            Err(e) => {
                println!("Warning: Failed to set mouse hook: {:?}", e);
                None
            }
        };

        let _ = ready_tx.send(thread_id);

        while GetMessageW(&mut msg, HWND::default(), 0, 0).0 > 0 {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        if let Some(hook) = m_hook {
            let _ = UnhookWindowsHookEx(hook);
        }
    });
    if let Ok(thread_id) = ready_rx.recv() {
        *runtime = Some(HookRuntime {
            thread_id,
            hook_thread,
            cursor_thread,
            cursor_thread_stop,
            event_thread,
        });
    } else {
        cursor_thread_stop.store(true, Ordering::Relaxed);
        let _ = cursor_thread.join();
        *EVENT_TX.lock().unwrap() = None;
        let _ = hook_thread.join();
        let _ = event_thread.join();
    }
}

pub fn pause_hooks() {
    let mut pause_started = PAUSE_STARTED.lock().unwrap();
    if pause_started.is_none() {
        *pause_started = Some(Instant::now());
    }
}

pub fn resume_hooks() {
    let mut pause_started = PAUSE_STARTED.lock().unwrap();
    if let Some(started) = *pause_started {
        *PAUSED_TOTAL.lock().unwrap() += started.elapsed();
        *pause_started = None;
    }
}

pub fn stop_hooks() -> Vec<InputEvent> {
    let mut runtime = HOOK_RUNTIME.lock().unwrap();
    if let Some(runtime) = runtime.take() {
        unsafe {
            let _ = PostThreadMessageW(runtime.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        let _ = runtime.hook_thread.join();
        runtime.cursor_thread_stop.store(true, Ordering::Relaxed);
        let _ = runtime.cursor_thread.join();
        // Unhook before closing the channel, then wait until every queued event
        // is persisted. Otherwise the last clicks are lost or leak into the next recording.
        *EVENT_TX.lock().unwrap() = None;
        let _ = runtime.event_thread.join();
    }
    *START_TIME.lock().unwrap() = None;
    resume_hooks();
    std::mem::take(&mut *EVENTS.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immediate_stop_drains_events_and_next_recording_starts_clean() {
        start_hooks();
        for x in 1000..2000 {
            EVENT_TX
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .send(InputEvent::MouseMove {
                    x,
                    y: 20,
                    t: 0,
                    cursor_type: "arrow".into(),
                })
                .unwrap();
        }
        let events = stop_hooks();
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, InputEvent::MouseMove { x: 1000..=1999, .. }))
                .count(),
            1000
        );
        start_hooks();
        let events = stop_hooks();
        assert!(!events
            .iter()
            .any(|event| matches!(event, InputEvent::MouseMove { x: 1000..=1999, .. })));
        assert!(HOOK_RUNTIME.lock().unwrap().is_none());
    }

    #[test]
    fn standard_windows_cursor_handles_keep_their_semantic_type() {
        let text_cursor = unsafe { LoadCursorW(HINSTANCE::default(), IDC_IBEAM).unwrap() };
        let hand_cursor = unsafe { LoadCursorW(HINSTANCE::default(), IDC_HAND).unwrap() };
        let arrow_cursor = unsafe { LoadCursorW(HINSTANCE::default(), IDC_ARROW).unwrap() };

        assert_eq!(cursor_type_for_handle(text_cursor.0 as isize), "text");
        assert_eq!(cursor_type_for_handle(hand_cursor.0 as isize), "pointer");
        assert_eq!(cursor_type_for_handle(arrow_cursor.0 as isize), "arrow");
    }

    #[test]
    fn cursor_type_is_included_in_recording_event_json() {
        let event = InputEvent::MouseMove {
            x: 24,
            y: 48,
            t: 12,
            cursor_type: "text".into(),
        };

        let json = serde_json::to_value(event).unwrap();
        assert_eq!(json["cursorType"], "text");
    }
}
