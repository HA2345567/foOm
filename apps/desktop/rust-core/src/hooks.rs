use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
    WM_MOUSEWHEEL, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum InputEvent {
    #[serde(rename = "move")]
    MouseMove { x: i32, y: i32, t: u64 },
    #[serde(rename = "click_down")]
    MouseDown { x: i32, y: i32, btn: String, t: u64 },
    #[serde(rename = "click_up")]
    MouseUp { x: i32, y: i32, btn: String, t: u64 },
    #[serde(rename = "scroll")]
    MouseScroll { x: i32, y: i32, delta: i32, t: u64 },
    #[serde(rename = "key_down")]
    KeyDown { key: u32, t: u64 },
    #[serde(rename = "key_up")]
    KeyUp { key: u32, t: u64 },
}

lazy_static::lazy_static! {
    pub static ref EVENTS: Mutex<Vec<InputEvent>> = Mutex::new(Vec::new());
    static ref START_TIME: Mutex<Option<Instant>> = Mutex::new(None);
    static ref PAUSE_STARTED: Mutex<Option<Instant>> = Mutex::new(None);
    static ref PAUSED_TOTAL: Mutex<Duration> = Mutex::new(Duration::ZERO);
    static ref EVENT_TX: Mutex<Option<std::sync::mpsc::Sender<InputEvent>>> = Mutex::new(None);
}

static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static mut MOUSE_HHOOK: Option<HHOOK> = None;
static mut KEYBOARD_HHOOK: Option<HHOOK> = None;

fn get_elapsed_ms() -> u64 {
    if let Some(start) = *START_TIME.lock().unwrap() {
        let paused_total = *PAUSED_TOTAL.lock().unwrap();
        let active_pause = PAUSE_STARTED
            .lock()
            .unwrap()
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

        let event = match wparam.0 as u32 {
            WM_MOUSEMOVE => Some(InputEvent::MouseMove { x, y, t }),
            WM_LBUTTONDOWN => Some(InputEvent::MouseDown {
                x,
                y,
                btn: "left".to_string(),
                t,
            }),
            WM_LBUTTONUP => Some(InputEvent::MouseUp {
                x,
                y,
                btn: "left".to_string(),
                t,
            }),
            WM_RBUTTONDOWN => Some(InputEvent::MouseDown {
                x,
                y,
                btn: "right".to_string(),
                t,
            }),
            WM_RBUTTONUP => Some(InputEvent::MouseUp {
                x,
                y,
                btn: "right".to_string(),
                t,
            }),
            WM_MOUSEWHEEL => {
                let delta = (ms_struct.mouseData >> 16) as i16 as i32;
                Some(InputEvent::MouseScroll { x, y, delta, t })
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

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        if hooks_are_paused() {
            return CallNextHookEx(None, code, wparam, lparam);
        }
        let kb_struct = *(lparam.0 as *const KBDLLHOOKSTRUCT);
        let key = kb_struct.vkCode;
        let t = get_elapsed_ms();

        let event = match wparam.0 as u32 {
            WM_KEYDOWN | WM_SYSKEYDOWN => Some(InputEvent::KeyDown { key, t }),
            WM_KEYUP | WM_SYSKEYUP => Some(InputEvent::KeyUp { key, t }),
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
    *START_TIME.lock().unwrap() = Some(Instant::now());
    *PAUSE_STARTED.lock().unwrap() = None;
    *PAUSED_TOTAL.lock().unwrap() = Duration::ZERO;
    EVENTS.lock().unwrap().clear();

    let (tx, rx) = std::sync::mpsc::channel();
    if let Ok(mut tx_lock) = EVENT_TX.lock() {
        *tx_lock = Some(tx);
    }

    // Background thread to drain channel and populate EVENTS vector asynchronously
    // This resolves hook latency by avoiding mutex contention inside keyboard/mouse hook procedures
    thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            if let Ok(mut evs) = EVENTS.lock() {
                evs.push(event);
            }
        }
    });

    thread::spawn(|| unsafe {
        let thread_id = windows::Win32::System::Threading::GetCurrentThreadId();
        HOOK_THREAD_ID.store(thread_id, Ordering::SeqCst);

        let module = GetModuleHandleW(None).unwrap_or_default();

        let m_hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0) {
            Ok(h) => Some(h),
            Err(e) => {
                println!("Warning: Failed to set mouse hook: {:?}", e);
                None
            }
        };
        MOUSE_HHOOK = m_hook;

        let k_hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0) {
            Ok(h) => Some(h),
            Err(e) => {
                println!("Warning: Failed to set keyboard hook: {:?}", e);
                None
            }
        };
        KEYBOARD_HHOOK = k_hook;

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let mouse_hook = std::ptr::replace(std::ptr::addr_of_mut!(MOUSE_HHOOK), None);
        if let Some(hook) = mouse_hook {
            let _ = UnhookWindowsHookEx(hook);
        }
        let keyboard_hook = std::ptr::replace(std::ptr::addr_of_mut!(KEYBOARD_HHOOK), None);
        if let Some(hook) = keyboard_hook {
            let _ = UnhookWindowsHookEx(hook);
        }
    });
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
    resume_hooks();
    let thread_id = HOOK_THREAD_ID.load(Ordering::SeqCst);
    if thread_id != 0 {
        unsafe {
            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        HOOK_THREAD_ID.store(0, Ordering::SeqCst);
    }
    // Drop the sender to break the background receiver thread loop
    if let Ok(mut tx_lock) = EVENT_TX.lock() {
        *tx_lock = None;
    }
    let evs = EVENTS.lock().unwrap().clone();
    evs
}
