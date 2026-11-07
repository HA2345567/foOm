pub mod db;
pub mod platform;

// These modules use WinRT, Win32, and WASAPI APIs. Keeping them behind the
// Windows target boundary lets the shared data and platform contracts compile
// on macOS/Linux before their native capture adapters are implemented.
#[cfg(windows)]
pub mod capture;
#[cfg(windows)]
pub mod hooks;
#[cfg(windows)]
mod loopback;
