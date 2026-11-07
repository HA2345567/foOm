//! Global start/stop recording shortcut, separate from cursor/input telemetry.

use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
#[cfg(windows)]
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const HOTKEY_ID: i32 = 41;
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingShortcut {
    pub key: String,
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub alt: bool,
}

impl Default for RecordingShortcut {
    fn default() -> Self {
        Self {
            key: "r".into(),
            ctrl: true,
            shift: true,
            alt: false,
        }
    }
}

pub struct GlobalRecordingShortcutService {
    #[cfg(windows)]
    thread_id: u32,
    #[cfg(windows)]
    sender: Sender<HotkeyCommand>,
    #[cfg(windows)]
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl GlobalRecordingShortcutService {
    pub fn start(app: AppHandle) -> Self {
        #[cfg(windows)]
        {
            let initial = load_saved_shortcut().unwrap_or_default();
            let (sender, receiver) = mpsc::channel();
            let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
            let worker =
                std::thread::spawn(move || run_hotkey_thread(app, receiver, ready_sender, initial));
            let thread_id = ready_receiver
                .recv()
                .expect("recording shortcut thread failed to initialize");
            return Self {
                thread_id,
                sender,
                worker: Mutex::new(Some(worker)),
            };
        }

        #[cfg(not(windows))]
        {
            let _ = app;
            Self {}
        }
    }

    pub fn set(&self, shortcut: RecordingShortcut) -> Result<(), String> {
        #[cfg(windows)]
        {
            if !shortcut.ctrl && !shortcut.shift && !shortcut.alt {
                return Err(
                    "Use at least one modifier (Ctrl, Shift, or Alt) for a global shortcut.".into(),
                );
            }
            if virtual_key(&shortcut.key).is_none() {
                return Err(
                    "Unsupported key. Use a letter, number, Space, arrow, or F1–F12.".into(),
                );
            }

            let (reply_sender, reply_receiver) = mpsc::sync_channel(1);
            self.sender
                .send(HotkeyCommand::Set(shortcut, reply_sender))
                .map_err(|_| "Global shortcut service is not running".to_string())?;
            post_hotkey_message(self.thread_id)?;
            return reply_receiver
                .recv_timeout(Duration::from_secs(3))
                .map_err(|_| "Timed out while registering the global shortcut".to_string())?;
        }

        #[cfg(not(windows))]
        {
            let _ = shortcut;
            Err("Global recording shortcuts are currently supported on Windows only.".into())
        }
    }

    pub fn shutdown(&self) {
        #[cfg(windows)]
        {
            let (reply_sender, reply_receiver) = mpsc::sync_channel(1);
            if self
                .sender
                .send(HotkeyCommand::Shutdown(reply_sender))
                .is_ok()
            {
                let _ = post_hotkey_message(self.thread_id);
                let _ = reply_receiver.recv_timeout(Duration::from_secs(2));
            }
            if let Ok(mut worker) = self.worker.lock() {
                if let Some(worker) = worker.take() {
                    let _ = worker.join();
                }
            }
        }
    }
}

#[tauri::command]
pub fn set_global_recording_shortcut(
    shortcut: RecordingShortcut,
    service: tauri::State<'_, GlobalRecordingShortcutService>,
) -> Result<(), String> {
    service.set(shortcut)
}

#[cfg(windows)]
enum HotkeyCommand {
    Set(RecordingShortcut, SyncSender<Result<(), String>>),
    Shutdown(SyncSender<()>),
}

#[cfg(windows)]
const WM_SET_RECORDING_HOTKEY: u32 = windows_sys::Win32::UI::WindowsAndMessaging::WM_APP + 1;

#[cfg(windows)]
fn run_hotkey_thread(
    app: AppHandle,
    receiver: Receiver<HotkeyCommand>,
    ready: SyncSender<u32>,
    initial: RecordingShortcut,
) {
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetMessageW, PeekMessageW, MSG, PM_NOREMOVE, WM_HOTKEY, WM_QUIT,
    };

    unsafe {
        let mut message = MSG::default();
        // Force creation of the per-thread message queue before another thread
        // can post the configuration/update message.
        let _ = PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
        let thread_id = GetCurrentThreadId();
        let mut active = None;
        match register_native(&initial) {
            Ok(()) => active = Some(initial),
            Err(error) => {
                eprintln!("Failed to register saved recording shortcut: {error}");
                let _ = app.emit("global-recording-hotkey-error", error);
            }
        }
        let _ = ready.send(thread_id);

        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            if message.message == WM_HOTKEY && message.wParam == HOTKEY_ID as usize {
                let _ = app.emit("global-recording-hotkey", ());
                continue;
            }
            if message.message == WM_QUIT {
                break;
            }
            if message.message == WM_SET_RECORDING_HOTKEY {
                let mut should_exit = false;
                while let Ok(command) = receiver.try_recv() {
                    match command {
                        HotkeyCommand::Set(shortcut, reply) => {
                            let previous = active.take();
                            if previous.is_some() {
                                unregister_native();
                            }
                            match register_native(&shortcut) {
                                Ok(()) => match persist_shortcut(&shortcut) {
                                    Ok(()) => {
                                        active = Some(shortcut);
                                        let _ = reply.send(Ok(()));
                                    }
                                    Err(error) => {
                                        unregister_native();
                                        active = restore_previous(previous);
                                        let _ = reply.send(Err(error));
                                    }
                                },
                                Err(error) => {
                                    active = restore_previous(previous);
                                    let _ = reply.send(Err(error));
                                }
                            }
                        }
                        HotkeyCommand::Shutdown(reply) => {
                            if active.take().is_some() {
                                unregister_native();
                            }
                            let _ = reply.send(());
                            should_exit = true;
                        }
                    }
                    if should_exit {
                        break;
                    }
                }
                if should_exit {
                    break;
                }
            }
        }

        if active.is_some() {
            unregister_native();
        }
    }
}

#[cfg(windows)]
fn restore_previous(previous: Option<RecordingShortcut>) -> Option<RecordingShortcut> {
    if let Some(shortcut) = previous {
        if let Err(error) = register_native(&shortcut) {
            eprintln!("Failed to restore previous recording shortcut: {error}");
            return None;
        }
        Some(shortcut)
    } else {
        None
    }
}

#[cfg(windows)]
fn post_hotkey_message(thread_id: u32) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::PostThreadMessageW;

    let posted = unsafe { PostThreadMessageW(thread_id, WM_SET_RECORDING_HOTKEY, 0, 0) };
    if posted == 0 {
        Err("Could not notify the global shortcut thread".into())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn register_native(shortcut: &RecordingShortcut) -> Result<(), String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
    };

    let key = virtual_key(&shortcut.key)
        .ok_or_else(|| "Unsupported key for a global shortcut".to_string())?;
    let modifiers = (if shortcut.ctrl { MOD_CONTROL } else { 0 })
        | (if shortcut.shift { MOD_SHIFT } else { 0 })
        | (if shortcut.alt { MOD_ALT } else { 0 })
        | MOD_NOREPEAT;
    if unsafe { RegisterHotKey(std::ptr::null_mut(), HOTKEY_ID, modifiers, key) } != 0 {
        return Ok(());
    }

    let error = unsafe { GetLastError() };
    Err(map_registration_error(error))
}

#[cfg(windows)]
fn unregister_native() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::UnregisterHotKey;
    let _ = unsafe { UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID) };
}

fn virtual_key(key: &str) -> Option<u32> {
    let key = key.to_ascii_lowercase();
    let key = if key == " " {
        "space".to_string()
    } else {
        key.trim().to_string()
    };
    if key.len() == 1 {
        let byte = key.as_bytes()[0];
        if byte.is_ascii_lowercase() {
            return Some(byte.to_ascii_uppercase() as u32);
        }
        if byte.is_ascii_digit() {
            return Some(byte as u32);
        }
    }

    match key.as_str() {
        " " | "space" => Some(0x20),
        "escape" | "esc" => Some(0x1B),
        "enter" => Some(0x0D),
        "tab" => Some(0x09),
        "backspace" => Some(0x08),
        "delete" | "del" => Some(0x2E),
        "arrowleft" => Some(0x25),
        "arrowup" => Some(0x26),
        "arrowright" => Some(0x27),
        "arrowdown" => Some(0x28),
        f if f.starts_with('f') => {
            let number = f[1..].parse::<u32>().ok()?;
            (1..=12).contains(&number).then_some(0x6F + number)
        }
        _ => None,
    }
}

fn map_registration_error(code: u32) -> String {
    if code == 1409 {
        "That shortcut is already in use by Windows or another application. Choose a different combination.".into()
    } else {
        format!("Windows could not register that shortcut (error {code}). Choose a different combination.")
    }
}

#[cfg(windows)]
fn shortcut_path() -> std::path::PathBuf {
    let mut path =
        std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_else(|| ".".into()));
    path.push("foom");
    path.push("recording-shortcut.json");
    path
}

#[cfg(windows)]
fn load_saved_shortcut() -> Option<RecordingShortcut> {
    let raw = std::fs::read_to_string(shortcut_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

#[cfg(windows)]
fn persist_shortcut(shortcut: &RecordingShortcut) -> Result<(), String> {
    let path = shortcut_path();
    let parent = path
        .parent()
        .ok_or_else(|| "Could not locate shortcut settings directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create shortcut settings directory: {error}"))?;
    let json = serde_json::to_vec_pretty(shortcut)
        .map_err(|error| format!("Could not serialize shortcut settings: {error}"))?;
    std::fs::write(path, json)
        .map_err(|error| format!("Could not save global shortcut settings: {error}"))
}

#[cfg(windows)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_supported_virtual_keys() {
        assert_eq!(virtual_key("r"), Some(0x52));
        assert_eq!(virtual_key("7"), Some(0x37));
        assert_eq!(virtual_key(" "), Some(0x20));
        assert_eq!(virtual_key("space"), Some(0x20));
        assert_eq!(virtual_key("F12"), Some(0x7B));
        assert_eq!(virtual_key("arrowleft"), Some(0x25));
        assert_eq!(virtual_key("not-a-key"), None);
    }

    #[test]
    fn reports_system_hotkey_conflicts_clearly() {
        assert!(map_registration_error(1409).contains("already in use"));
        assert!(map_registration_error(5).contains("error 5"));
    }
}
