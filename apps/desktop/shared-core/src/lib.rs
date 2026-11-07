//! Portable, operating-system-neutral foOom project document types.
//!
//! These types mirror the version-1 JSON document currently written by the
//! Windows recorder. They intentionally contain no native handles or paths
//! resolved from a particular operating system.

pub mod platform;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt;

/// Version of the on-disk recording document format.
pub const PROJECT_DOCUMENT_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProjectDocumentError {
    InvalidJson(String),
    InvalidVersion,
    UnsupportedVersion { found: u64, supported: u32 },
}

impl fmt::Display for ProjectDocumentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson(message) => write!(f, "Invalid project document: {message}"),
            Self::InvalidVersion => f.write_str("Project document version must be an integer"),
            Self::UnsupportedVersion { found, supported } => write!(
                f,
                "Project document version {found} is newer than supported version {supported}"
            ),
        }
    }
}

impl std::error::Error for ProjectDocumentError {}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocument {
    #[serde(default = "default_document_version")]
    pub document_version: u32,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub width: i32,
    #[serde(default)]
    pub height: i32,
    #[serde(default)]
    pub capture_x: i32,
    #[serde(default)]
    pub capture_y: i32,
    #[serde(default)]
    pub duration: i64,
    #[serde(default)]
    pub events: Vec<InputEvent>,
    #[serde(default)]
    pub pauses: Vec<PauseInterval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_video_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_shape: Option<String>,
    #[serde(default)]
    pub cursor_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mic_track: Option<SidecarTrack>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webcam_track: Option<SidecarTrack>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<CaptureSource>,
    #[serde(default)]
    pub media: ProjectMediaReferences,
    /// Editor state is owned by the editor and evolves independently of the
    /// capture document, so preserve it as JSON until its schema is versioned.
    #[serde(default = "empty_object")]
    pub editor: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integrity: Option<DocumentIntegrity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<RecoveryStatus>,
    /// Preserve document fields introduced by newer clients so older clients
    /// can still save editor changes without deleting newer metadata.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

fn default_document_version() -> u32 {
    PROJECT_DOCUMENT_VERSION
}

impl Default for ProjectDocument {
    fn default() -> Self {
        Self {
            document_version: PROJECT_DOCUMENT_VERSION,
            id: String::new(),
            name: String::new(),
            created_at: String::new(),
            updated_at: None,
            width: 0,
            height: 0,
            capture_x: 0,
            capture_y: 0,
            duration: 0,
            events: Vec::new(),
            pauses: Vec::new(),
            camera_video_path: None,
            camera_mime_type: None,
            camera_shape: None,
            cursor_enabled: false,
            mic_track: None,
            webcam_track: None,
            source: None,
            media: ProjectMediaReferences::default(),
            editor: empty_object(),
            integrity: None,
            recovery: None,
            extra: BTreeMap::new(),
        }
    }
}

impl ProjectDocument {
    /// Parse a stored project document, treating versionless legacy documents
    /// as v1 while rejecting versions this client cannot safely rewrite.
    pub fn parse_json(input: &str) -> Result<Self, ProjectDocumentError> {
        let value: Value = serde_json::from_str(input)
            .map_err(|error| ProjectDocumentError::InvalidJson(error.to_string()))?;
        let object = value
            .as_object()
            .ok_or_else(|| ProjectDocumentError::InvalidJson("expected an object".to_string()))?;

        let version = match object.get("documentVersion") {
            None => u64::from(PROJECT_DOCUMENT_VERSION),
            Some(value) => value.as_u64().ok_or(ProjectDocumentError::InvalidVersion)?,
        };
        if version > u64::from(PROJECT_DOCUMENT_VERSION) {
            return Err(ProjectDocumentError::UnsupportedVersion {
                found: version,
                supported: PROJECT_DOCUMENT_VERSION,
            });
        }
        if version == 0 {
            return Err(ProjectDocumentError::InvalidVersion);
        }

        let mut document: Self = serde_json::from_value(value)
            .map_err(|error| ProjectDocumentError::InvalidJson(error.to_string()))?;
        // A missing version is the supported legacy format and is normalized
        // on the next save; callers can detect this through the document value.
        document.document_version = PROJECT_DOCUMENT_VERSION;
        Ok(document)
    }

    /// Serialize only versions this implementation understands. This prevents
    /// callers from accidentally downgrading a future-version document.
    pub fn to_json_string(&self) -> Result<String, ProjectDocumentError> {
        if self.document_version != PROJECT_DOCUMENT_VERSION {
            return Err(ProjectDocumentError::UnsupportedVersion {
                found: u64::from(self.document_version),
                supported: PROJECT_DOCUMENT_VERSION,
            });
        }
        serde_json::to_string_pretty(self)
            .map_err(|error| ProjectDocumentError::InvalidJson(error.to_string()))
    }
}

fn empty_object() -> Value {
    Value::Object(Default::default())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMediaReferences {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_video_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_video_path: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PauseInterval {
    #[serde(default)]
    pub t: f64,
    #[serde(default)]
    pub duration: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarTrack {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub chunks: Vec<SidecarChunk>,
    #[serde(default)]
    pub total_bytes: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarChunk {
    #[serde(default)]
    pub sequence: u64,
    #[serde(default)]
    pub timestamp_ms: u64,
    #[serde(default)]
    pub byte_len: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    #[serde(default)]
    pub width: i32,
    #[serde(default)]
    pub height: i32,
    #[serde(default)]
    pub scale_factor: f64,
    #[serde(default)]
    pub capture_crop_x: i32,
    #[serde(default)]
    pub capture_crop_y: i32,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIntegrity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
    #[serde(default)]
    pub missing_video: bool,
    #[serde(default)]
    pub missing_document: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migrated_document: Option<bool>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    #[serde(default)]
    pub post_processing_pending: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERSION_1_DOCUMENT: &str = r#"{
      "documentVersion": 1,
      "id": "project-123",
      "name": "Product walkthrough",
      "createdAt": "2026-11-02T10:20:30+05:30",
      "updatedAt": "2026-11-02T10:21:00+05:30",
      "width": 1920,
      "height": 1080,
      "captureX": 12,
      "captureY": 34,
      "duration": 42000,
      "events": [
        {"type": "move", "x": 600, "y": 400, "t": 100},
        {"type": "click_down", "x": 600, "y": 400, "btn": "left", "t": 250},
        {"type": "scroll", "x": 600, "y": 400, "delta": -120, "t": 500},
        {"type": "key_down", "key": 65, "t": 600}
      ],
      "pauses": [{"t": 20000.0, "duration": 3000.0}],
      "cameraVideoPath": "recording_webcam.webm",
      "cameraMimeType": "video/webm",
      "cameraShape": "circle",
      "cursorEnabled": true,
      "micTrack": {
        "kind": "mic",
        "path": "recording_mic.webm",
        "chunks": [{"sequence": 0, "timestampMs": 0, "byteLen": 512}],
        "totalBytes": 512
      },
      "webcamTrack": {
        "kind": "webcam",
        "path": "recording_webcam.webm",
        "chunks": [],
        "totalBytes": 0
      },
      "source": {
        "kind": "window",
        "id": "opaque-source-id",
        "title": "Code Editor",
        "x": 10,
        "y": 20,
        "width": 1920,
        "height": 1080,
        "scaleFactor": 1.5,
        "captureCropX": 12,
        "captureCropY": 34
      },
      "media": {
        "rawVideoPath": "recording.mp4",
        "metadataPath": "recording.json",
        "cameraVideoPath": "recording_webcam.webm"
      },
      "editor": {"aspectRatio": "16:9", "zoomRegions": [{"start": 2.0, "end": 3.5}]},
      "integrity": {
        "checkedAt": "2026-11-02T10:22:00+05:30",
        "missingVideo": false,
        "missingDocument": false
      },
      "recovery": {"postProcessingPending": false}
    }"#;

    #[test]
    fn version_1_recording_document_round_trips_without_losing_fields() {
        let original: ProjectDocument = serde_json::from_str(VERSION_1_DOCUMENT).unwrap();
        let serialized = serde_json::to_string(&original).unwrap();
        let restored: ProjectDocument = serde_json::from_str(&serialized).unwrap();

        assert_eq!(restored, original);
        assert_eq!(restored.document_version, PROJECT_DOCUMENT_VERSION);
        assert_eq!(restored.events.len(), 4);
        assert_eq!(restored.pauses.len(), 1);
        assert_eq!(restored.editor["zoomRegions"][0]["start"], 2.0);
    }

    #[test]
    fn legacy_migrated_document_defaults_optional_fields() {
        let json = r#"{
          "documentVersion": 1,
          "id": "legacy-project",
          "name": "Legacy recording",
          "createdAt": "2025-05-01T12:00:00Z",
          "width": 1280,
          "height": 720,
          "duration": 9000,
          "media": {"rawVideoPath": "legacy.mp4", "metadataPath": "legacy.json"},
          "editor": {}
        }"#;

        let document: ProjectDocument = serde_json::from_str(json).unwrap();
        assert!(document.events.is_empty());
        assert!(document.pauses.is_empty());
        assert!(!document.cursor_enabled);
        assert!(document.source.is_none());
        assert!(document.mic_track.is_none());
        assert_eq!(document.media.raw_video_path.as_deref(), Some("legacy.mp4"));
    }

    #[test]
    fn recovery_document_round_trips() {
        let document = ProjectDocument {
            id: "recovery-project".to_string(),
            name: "Recoverable capture".to_string(),
            recovery: Some(RecoveryStatus {
                post_processing_pending: true,
            }),
            ..ProjectDocument::default()
        };

        let json = serde_json::to_string(&document).unwrap();
        let restored: ProjectDocument = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, document);
        assert_eq!(restored.document_version, PROJECT_DOCUMENT_VERSION);
    }

    #[test]
    fn unknown_document_media_and_source_fields_are_preserved() {
        let json = r#"{
          "documentVersion": 1,
          "id": "future-compatible",
          "events": [],
          "pauses": [],
          "media": {"rawVideoPath": "raw.mp4", "futureMediaField": {"checksum": "abc"}},
          "source": {"kind": "display", "id": "screen-1", "futureSourceField": true},
          "editor": {"futureEditorField": 4},
          "futureDocumentField": [1, 2, 3]
        }"#;

        let document: ProjectDocument = serde_json::from_str(json).unwrap();
        let serialized = serde_json::to_value(document).unwrap();

        assert_eq!(serialized["futureDocumentField"][2], 3);
        assert_eq!(serialized["media"]["futureMediaField"]["checksum"], "abc");
        assert_eq!(serialized["source"]["futureSourceField"], true);
        assert_eq!(serialized["editor"]["futureEditorField"], 4);
    }

    #[test]
    fn parser_migrates_versionless_legacy_document_to_current_version() {
        let document = ProjectDocument::parse_json(
            r#"{"id":"legacy","media":{"rawVideoPath":"raw.mp4","future":"keep"}}"#,
        )
        .unwrap();

        assert_eq!(document.document_version, PROJECT_DOCUMENT_VERSION);
        assert_eq!(document.id, "legacy");
        assert_eq!(document.media.extra["future"], "keep");
    }

    #[test]
    fn parser_rejects_future_version_without_rewriting_input() {
        let input = r#"{"documentVersion":2,"futureDocumentField":{"must":"survive"}}"#;
        let original: Value = serde_json::from_str(input).unwrap();

        assert_eq!(
            ProjectDocument::parse_json(input),
            Err(ProjectDocumentError::UnsupportedVersion {
                found: 2,
                supported: PROJECT_DOCUMENT_VERSION,
            })
        );
        assert_eq!(serde_json::from_str::<Value>(input).unwrap(), original);

        let mut future = ProjectDocument::default();
        future.document_version = 2;
        assert!(matches!(
            future.to_json_string(),
            Err(ProjectDocumentError::UnsupportedVersion { found: 2, .. })
        ));
    }

    #[test]
    fn parser_rejects_invalid_or_zero_versions() {
        assert_eq!(
            ProjectDocument::parse_json(r#"{"documentVersion":"1"}"#),
            Err(ProjectDocumentError::InvalidVersion)
        );
        assert_eq!(
            ProjectDocument::parse_json(r#"{"documentVersion":0}"#),
            Err(ProjectDocumentError::InvalidVersion)
        );
    }
}
