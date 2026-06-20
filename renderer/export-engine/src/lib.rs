use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::{path::PathBuf, process::Command};

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

    on_progress(0.1);
    let ffmpeg_bin = get_ffmpeg_path();
    let scale_filter = format!("scale={}:{}:flags=lanczos,format=yuv420p", _width, _height);
    let mut ffmpeg_command = Command::new(&ffmpeg_bin);
    let status = hide_subprocess_window(&mut ffmpeg_command)
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
            output_path,
        ])
        .status()
        .map_err(|error| format!("Failed to start FFmpeg export: {}", error))?;

    if cancel_flag.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(output_path);
        return Err("Export cancelled".to_string());
    }

    if !status.success() {
        return Err(format!("FFmpeg export failed with status {}", status));
    }

    on_progress(1.0);

    Ok(())
}
