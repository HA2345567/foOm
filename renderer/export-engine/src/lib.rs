use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::{
    path::PathBuf,
    process::{Child, Command},
    time::Duration,
};

/// Own only a uniquely reserved temporary file, never a prior user export.
struct PendingExport {
    path: PathBuf,
    destination: PathBuf,
}

impl PendingExport {
    fn new(destination: &std::path::Path) -> Result<Self, String> {
        use std::sync::atomic::AtomicU64;
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        let parent = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."));
        for _ in 0..100 {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!(".foom-export-{}-{}.mp4", std::process::id(), id));
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(_) => {
                    return Ok(Self {
                        path,
                        destination: destination.to_path_buf(),
                    })
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("Cannot create temporary export: {error}")),
            }
        }
        Err("Cannot reserve a unique temporary export file".into())
    }

    fn commit(self, cancel: &AtomicBool) -> Result<(), String> {
        if cancel.load(Ordering::SeqCst) {
            return Err("Export cancelled".into());
        }
        std::fs::rename(&self.path, &self.destination)
            .map_err(|error| format!("Cannot finalize export: {error}"))
    }
}

impl Drop for PendingExport {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn wait_for_export(child: &mut Child, cancel_flag: &AtomicBool) -> Result<(), String> {
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Export cancelled".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => return Err(format!("FFmpeg export failed with status {}", status)),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Failed to wait for FFmpeg export: {}", error));
            }
        }
    }
}

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

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportComposition {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

fn get_ffmpeg_path() -> String {
    if let Ok(mut path) = std::env::current_exe() {
        path.pop();

        for candidate in [
            path.join("ffmpeg.exe"),
            path.join("binaries")
                .join("ffmpeg-x86_64-pc-windows-msvc.exe"),
            path.join("..")
                .join("..")
                .join("binaries")
                .join("ffmpeg-x86_64-pc-windows-msvc.exe"),
            PathBuf::from("apps")
                .join("desktop")
                .join("tauri-shell")
                .join("src-tauri")
                .join("binaries")
                .join("ffmpeg-x86_64-pc-windows-msvc.exe"),
        ] {
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    "ffmpeg".to_string()
}

fn composition_has_effects(composition: &Option<ExportComposition>) -> bool {
    match composition.as_ref().map(|composition| &composition.data) {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Object(map)) => !map.is_empty(),
        Some(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn export_test_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "foom-export-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn cancelled_export_preserves_prior_output_and_removes_only_its_temporary_file() {
        let root = export_test_dir();
        let output = root.join("final.mp4");
        std::fs::write(&output, b"previous export").unwrap();
        let pending = PendingExport::new(&output).unwrap();
        let temporary = pending.path.clone();
        std::fs::write(&temporary, b"partial new export").unwrap();
        assert_eq!(
            pending.commit(&AtomicBool::new(true)).unwrap_err(),
            "Export cancelled"
        );
        assert_eq!(std::fs::read(&output).unwrap(), b"previous export");
        assert!(!temporary.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completed_export_replaces_prior_output_and_reserves_distinct_files() {
        let root = export_test_dir();
        let output = root.join("final.mp4");
        std::fs::write(&output, b"old").unwrap();
        let pending = PendingExport::new(&output).unwrap();
        let other = PendingExport::new(&output).unwrap();
        assert_ne!(pending.path, other.path);
        std::fs::write(&pending.path, b"complete new export").unwrap();
        pending.commit(&AtomicBool::new(false)).unwrap();
        drop(other);
        assert_eq!(std::fs::read(&output).unwrap(), b"complete new export");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_commit_cleans_temporary_file_without_removing_destination() {
        let root = export_test_dir();
        let output = root.join("existing-directory");
        std::fs::create_dir(&output).unwrap();
        let pending = PendingExport::new(&output).unwrap();
        let temporary = pending.path.clone();
        assert!(pending.commit(&AtomicBool::new(false)).is_err());
        assert!(output.is_dir());
        assert!(!temporary.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn empty_composition_does_not_require_native_compositor() {
        assert!(!composition_has_effects(&None));
        assert!(!composition_has_effects(&Some(ExportComposition {
            data: serde_json::Value::Null,
        })));
        assert!(!composition_has_effects(&Some(ExportComposition {
            data: serde_json::json!({}),
        })));
    }

    #[test]
    fn non_empty_composition_requires_native_compositor() {
        assert!(composition_has_effects(&Some(ExportComposition {
            data: serde_json::json!({ "zoomRegions": [] }),
        })));
    }

    #[test]
    fn rejects_invalid_dimensions_before_starting_ffmpeg() {
        let result = run_export_controlled(
            "unused",
            "",
            "unused",
            1919,
            1080,
            1.0,
            None,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        );
        assert!(result.unwrap_err().contains("positive even numbers"));
    }

    #[test]
    fn refuses_to_overwrite_source_recording() {
        let path =
            std::env::temp_dir().join(format!("foom-export-source-{}.mp4", std::process::id()));
        std::fs::write(&path, b"source recording").unwrap();
        let result = run_export_controlled(
            path.to_str().unwrap(),
            "",
            path.to_str().unwrap(),
            1920,
            1080,
            1.0,
            None,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        );
        assert!(result.unwrap_err().contains("differ from the source"));
        assert_eq!(std::fs::read(&path).unwrap(), b"source recording");
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn cancellation_kills_and_reaps_ffmpeg_process() {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
        let mut child = hide_subprocess_window(&mut command).spawn().unwrap();
        let result = wait_for_export(&mut child, &AtomicBool::new(true));
        assert_eq!(result.unwrap_err(), "Export cancelled");
        assert!(child.try_wait().unwrap().is_some());
    }
}

pub fn run_export_controlled<F>(
    raw_video_path: &str,
    _metadata_path: &str,
    output_path: &str,
    _width: u32,
    _height: u32,
    _duration: f64,
    composition: Option<ExportComposition>,
    cancel_flag: Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    if cancel_flag.load(Ordering::SeqCst) {
        return Err("Export cancelled".to_string());
    }

    if composition_has_effects(&composition) {
        return Err(
            "Native export received composition effects, but the native compositor is not implemented yet. Use the browser/WebCodecs exporter for preview-matched exports until native composition is wired."
                .to_string(),
        );
    }

    if _width == 0 || _height == 0 || _width % 2 != 0 || _height % 2 != 0 {
        return Err("H.264 export dimensions must be positive even numbers".to_string());
    }
    let input = std::fs::canonicalize(raw_video_path)
        .map_err(|error| format!("Cannot read export source: {}", error))?;
    let output = PathBuf::from(output_path);
    if std::fs::canonicalize(&output).ok().as_ref() == Some(&input) {
        return Err("Export destination must differ from the source recording".to_string());
    }

    let pending = PendingExport::new(&output)?;

    on_progress(0.1);
    let ffmpeg_bin = get_ffmpeg_path();
    let scale_filter = format!("scale={}:{}:flags=lanczos,format=yuv420p", _width, _height);
    let mut ffmpeg_command = Command::new(&ffmpeg_bin);
    let mut child = hide_subprocess_window(&mut ffmpeg_command)
        .args([
            "-y",
            "-i",
            raw_video_path,
            "-vf",
            &scale_filter,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
        ])
        .arg(&pending.path)
        .spawn()
        .map_err(|error| format!("Failed to start FFmpeg export: {}", error))?;

    wait_for_export(&mut child, &cancel_flag)?;
    pending.commit(&cancel_flag)?;

    on_progress(1.0);

    Ok(())
}
