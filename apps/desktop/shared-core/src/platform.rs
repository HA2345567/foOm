//! Portable contracts implemented by each operating-system capture backend.
//!
//! These types cross the application boundary as data only. Native handles,
//! permission objects, and device APIs remain private to each backend.

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureSourceKind {
    Display,
    Window,
    Region,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CursorCaptureMode {
    Disabled,
    EditableTelemetry,
    BakedIntoVideo,
}

impl Default for CursorCaptureMode {
    fn default() -> Self {
        Self::Disabled
    }
}

/// Geometry in physical desktop pixels. Negative origins are valid for displays
/// left of or above the primary display. UI adapters convert logical coordinates
/// using the selected source's scale factor before creating a request.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Safe, serializable source information. `id` is opaque and must not contain a
/// native window/display handle.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSourceDescriptor {
    pub id: String,
    pub kind: CaptureSourceKind,
    pub title: Option<String>,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub region: Option<CaptureRegion>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub platform: Platform,
    pub source_kinds: Vec<CaptureSourceKind>,
    pub can_pause: bool,
    pub can_capture_microphone: bool,
    pub can_capture_system_audio: bool,
    pub can_capture_camera: bool,
    pub cursor_modes: Vec<CursorCaptureMode>,
    /// Arbitrary key logging is never implied by cursor telemetry. A backend
    /// may expose shortcut capture only when explicitly requested and allowed.
    pub can_capture_keyboard_shortcuts: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    pub source_kind: CaptureSourceKind,
    pub source_id: Option<String>,
    pub region: Option<CaptureRegion>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: u32,
    pub microphone_device_id: Option<String>,
    pub system_audio: bool,
    pub camera_device_id: Option<String>,
    pub cursor_mode: CursorCaptureMode,
    /// Defaults to false; never collect arbitrary keystrokes.
    pub capture_keyboard_shortcuts: bool,
}

impl Default for CaptureRequest {
    fn default() -> Self {
        Self {
            source_kind: CaptureSourceKind::Display,
            source_id: None,
            region: None,
            width: None,
            height: None,
            frame_rate: 60,
            microphone_device_id: None,
            system_audio: false,
            camera_device_id: None,
            cursor_mode: CursorCaptureMode::Disabled,
            capture_keyboard_shortcuts: false,
        }
    }
}

impl CaptureRequest {
    /// Validate geometry before a native adapter converts it to OS coordinates.
    /// An invalid region must never silently become a full-display recording.
    pub fn validate(&self) -> Result<(), CaptureError> {
        let invalid =
            |message| CaptureError::new(CaptureErrorCategory::InvalidRequest, message, false);
        if self.frame_rate == 0 || self.frame_rate > 240 {
            return Err(invalid("Frame rate must be between 1 and 240"));
        }
        if self.width == Some(0) || self.height == Some(0) {
            return Err(invalid("Capture dimensions must be positive"));
        }
        if self.source_kind == CaptureSourceKind::Region {
            let region = self
                .region
                .ok_or_else(|| invalid("Select a capture region before recording"))?;
            let width = i32::try_from(region.width).ok().filter(|value| *value > 0);
            let height = i32::try_from(region.height).ok().filter(|value| *value > 0);
            if width
                .and_then(|width| region.x.checked_add(width))
                .is_none()
                || height
                    .and_then(|height| region.y.checked_add(height))
                    .is_none()
            {
                return Err(invalid("Capture region has invalid or overflowing bounds"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureSessionState {
    Recording,
    Paused,
    Finalizing,
    Complete,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactKind {
    ScreenVideo,
    MicrophoneAudio,
    SystemAudio,
    CameraVideo,
    CursorTelemetry,
    RecordingMetadata,
}

/// A file artifact returned by a backend. Paths are references only and are
/// resolved by the desktop application; this type never carries open handles.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureArtifact {
    pub kind: ArtifactKind,
    pub path: String,
    pub mime_type: Option<String>,
    pub byte_length: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureArtifacts {
    pub files: Vec<CaptureArtifact>,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CaptureFinishOptions {
    pub microphone_audio: Option<Vec<u8>>,
    pub camera_video: Option<Vec<u8>>,
    pub camera_mime_type: Option<String>,
    pub camera_shape: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureErrorCategory {
    PermissionDenied,
    Unsupported,
    InvalidRequest,
    DeviceUnavailable,
    Busy,
    Io,
    BackendFailure,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureError {
    pub category: CaptureErrorCategory,
    pub message: String,
    pub retryable: bool,
}

impl CaptureError {
    pub fn new(
        category: CaptureErrorCategory,
        message: impl Into<String>,
        retryable: bool,
    ) -> Self {
        Self {
            category,
            message: message.into(),
            retryable,
        }
    }
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CaptureError {}

/// Object-safe lifecycle contract for native implementations.
pub trait CaptureSession: Send {
    fn id(&self) -> &str;
    fn state(&self) -> CaptureSessionState;
    fn pause(&mut self) -> Result<(), CaptureError>;
    fn resume(&mut self) -> Result<(), CaptureError>;
    fn finish(
        self: Box<Self>,
        options: CaptureFinishOptions,
    ) -> Result<CaptureArtifacts, CaptureError>;
    fn cancel(self: Box<Self>) -> Result<(), CaptureError>;
}

/// Implemented by a platform adapter selected by the desktop application.
pub trait CaptureBackend: Send + Sync {
    fn capabilities(&self) -> PlatformCapabilities;
    fn enumerate_sources(
        &self,
        kind: CaptureSourceKind,
    ) -> Result<Vec<CaptureSourceDescriptor>, CaptureError>;
    fn start(&self, request: CaptureRequest) -> Result<Box<dyn CaptureSession>, CaptureError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_region_requests_cannot_fall_back_to_display_capture() {
        let mut request = CaptureRequest {
            source_kind: CaptureSourceKind::Region,
            ..CaptureRequest::default()
        };
        assert_eq!(
            request.validate().unwrap_err().category,
            CaptureErrorCategory::InvalidRequest
        );
        for region in [
            CaptureRegion {
                x: 0,
                y: 0,
                width: 0,
                height: 100,
            },
            CaptureRegion {
                x: 0,
                y: 0,
                width: 100,
                height: 0,
            },
            CaptureRegion {
                x: i32::MAX,
                y: 0,
                width: 100,
                height: 100,
            },
            CaptureRegion {
                x: 0,
                y: i32::MAX,
                width: 100,
                height: 100,
            },
            CaptureRegion {
                x: 0,
                y: 0,
                width: u32::MAX,
                height: 100,
            },
        ] {
            request.region = Some(region);
            assert!(request.validate().is_err(), "accepted {region:?}");
        }
    }

    #[test]
    fn valid_region_can_use_negative_desktop_coordinates() {
        let request = CaptureRequest {
            source_kind: CaptureSourceKind::Region,
            region: Some(CaptureRegion {
                x: -1920,
                y: -200,
                width: 1280,
                height: 720,
            }),
            ..CaptureRequest::default()
        };
        assert!(request.validate().is_ok());
    }

    #[test]
    fn request_defaults_do_not_enable_audio_video_or_keyboard_capture() {
        let request = CaptureRequest::default();
        assert!(!request.system_audio);
        assert!(!request.capture_keyboard_shortcuts);
        assert_eq!(request.cursor_mode, CursorCaptureMode::Disabled);
    }

    #[test]
    fn capability_and_error_contracts_are_serializable() {
        let capabilities = PlatformCapabilities {
            platform: Platform::Linux,
            source_kinds: vec![CaptureSourceKind::Display, CaptureSourceKind::Region],
            can_pause: true,
            can_capture_microphone: true,
            can_capture_system_audio: false,
            can_capture_camera: true,
            cursor_modes: vec![CursorCaptureMode::Disabled],
            can_capture_keyboard_shortcuts: false,
        };
        let serialized = serde_json::to_value(&capabilities).unwrap();
        assert_eq!(serialized["platform"], "linux");
        assert_eq!(serialized["canCaptureSystemAudio"], false);

        let error = CaptureError::new(
            CaptureErrorCategory::PermissionDenied,
            "Screen capture permission is required",
            true,
        );
        let serialized = serde_json::to_value(&error).unwrap();
        assert_eq!(serialized["category"], "permission-denied");
        assert_eq!(serialized["retryable"], true);
    }
}
