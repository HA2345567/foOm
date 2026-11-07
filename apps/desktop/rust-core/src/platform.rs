//! Operating-system capture backend selected by the desktop shell.

pub use shared_core::platform::{
    ArtifactKind, CaptureArtifact, CaptureArtifacts, CaptureBackend, CaptureError,
    CaptureErrorCategory, CaptureFinishOptions, CaptureRegion, CaptureRequest, CaptureSession,
    CaptureSessionState, CaptureSourceDescriptor, CaptureSourceKind, CursorCaptureMode, Platform,
    PlatformCapabilities,
};

#[cfg(windows)]
mod native {
    use super::*;
    use crate::capture;

    pub struct WindowsBackend;

    struct WindowsSession {
        project_id: String,
        state: CaptureSessionState,
    }

    fn backend_error(error: String) -> CaptureError {
        CaptureError::new(CaptureErrorCategory::BackendFailure, error, false)
    }

    fn describe_source(
        source: capture::CaptureSource,
        requested_kind: CaptureSourceKind,
    ) -> CaptureSourceDescriptor {
        let width = source.width.max(0) as u32;
        let height = source.height.max(0) as u32;
        CaptureSourceDescriptor {
            id: source.id,
            kind: if requested_kind == CaptureSourceKind::Region {
                CaptureSourceKind::Region
            } else if source.kind == "window" {
                CaptureSourceKind::Window
            } else {
                CaptureSourceKind::Display
            },
            title: source.title,
            width,
            height,
            scale_factor: source.scale_factor,
            region: Some(CaptureRegion {
                x: source.x,
                y: source.y,
                width,
                height,
            }),
        }
    }

    impl CaptureBackend for WindowsBackend {
        fn capabilities(&self) -> PlatformCapabilities {
            PlatformCapabilities {
                platform: Platform::Windows,
                source_kinds: vec![
                    CaptureSourceKind::Display,
                    CaptureSourceKind::Window,
                    CaptureSourceKind::Region,
                ],
                can_pause: true,
                can_capture_microphone: true,
                can_capture_system_audio: true,
                can_capture_camera: true,
                cursor_modes: vec![
                    CursorCaptureMode::EditableTelemetry,
                    CursorCaptureMode::BakedIntoVideo,
                ],
                can_capture_keyboard_shortcuts: false,
            }
        }

        fn enumerate_sources(
            &self,
            kind: CaptureSourceKind,
        ) -> Result<Vec<CaptureSourceDescriptor>, CaptureError> {
            let sources = capture::enumerate_capture_sources().map_err(backend_error)?;
            Ok(sources
                .into_iter()
                .filter(|source| match kind {
                    CaptureSourceKind::Display => source.kind == "monitor",
                    CaptureSourceKind::Window => source.kind == "window",
                    CaptureSourceKind::Region => source.kind == "monitor",
                })
                .map(|source| describe_source(source, kind))
                .collect())
        }

        fn start(&self, request: CaptureRequest) -> Result<Box<dyn CaptureSession>, CaptureError> {
            request.validate()?;
            if request.cursor_mode == CursorCaptureMode::Disabled {
                return Err(CaptureError::new(
                    CaptureErrorCategory::Unsupported,
                    "Disabling the cursor during capture is not available through this backend",
                    false,
                ));
            }
            if request.capture_keyboard_shortcuts {
                return Err(CaptureError::new(
                    CaptureErrorCategory::Unsupported,
                    "Keyboard shortcut capture is not available through this backend",
                    false,
                ));
            }
            let source_type = match request.source_kind {
                CaptureSourceKind::Display => "screen",
                CaptureSourceKind::Window => "window",
                CaptureSourceKind::Region => "area",
            };
            let source = if request.source_kind == CaptureSourceKind::Region {
                None
            } else {
                let source_id = request.source_id.as_deref().ok_or_else(|| {
                    CaptureError::new(
                        CaptureErrorCategory::InvalidRequest,
                        "A capture source must be selected",
                        false,
                    )
                })?;
                capture::enumerate_capture_sources()
                    .map_err(backend_error)?
                    .into_iter()
                    .find(|source| source.id == source_id)
                    .ok_or_else(|| {
                        CaptureError::new(
                            CaptureErrorCategory::DeviceUnavailable,
                            "The selected capture source is no longer available",
                            true,
                        )
                    })
                    .map(Some)?
            };
            let region = request.region.map(|region| capture::CaptureRegion {
                x: region.x,
                y: region.y,
                width: region.width.min(i32::MAX as u32) as i32,
                height: region.height.min(i32::MAX as u32) as i32,
            });
            let project_id = capture::start_capture(Some(capture::CaptureOptions {
                source_type: Some(source_type.to_string()),
                source,
                region,
                system_audio_enabled: Some(request.system_audio),
                cursor_enabled: Some(request.cursor_mode == CursorCaptureMode::EditableTelemetry),
            }))
            .map_err(backend_error)?;
            Ok(Box::new(WindowsSession {
                project_id,
                state: CaptureSessionState::Recording,
            }))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn source_descriptors_preserve_secondary_display_bounds() {
            for kind in [CaptureSourceKind::Display, CaptureSourceKind::Region] {
                let descriptor = describe_source(
                    capture::CaptureSource {
                        kind: "monitor".into(),
                        id: "display-test".into(),
                        title: None,
                        x: -1920,
                        y: -200,
                        width: 1920,
                        height: 1080,
                        scale_factor: 1.5,
                        primary: false,
                        thumbnail: None,
                    },
                    kind,
                );
                assert_eq!(descriptor.kind, kind);
                assert_eq!(descriptor.scale_factor, 1.5);
                assert_eq!(
                    descriptor.region,
                    Some(CaptureRegion {
                        x: -1920,
                        y: -200,
                        width: 1920,
                        height: 1080,
                    })
                );
            }
        }
    }

    impl CaptureSession for WindowsSession {
        fn id(&self) -> &str {
            &self.project_id
        }

        fn state(&self) -> CaptureSessionState {
            self.state
        }

        fn pause(&mut self) -> Result<(), CaptureError> {
            if self.state != CaptureSessionState::Recording {
                return Err(CaptureError::new(
                    CaptureErrorCategory::InvalidRequest,
                    "Capture session is not recording",
                    false,
                ));
            }
            capture::pause_capture_session(Some(&self.project_id)).map_err(backend_error)?;
            self.state = CaptureSessionState::Paused;
            Ok(())
        }

        fn resume(&mut self) -> Result<(), CaptureError> {
            if self.state != CaptureSessionState::Paused {
                return Err(CaptureError::new(
                    CaptureErrorCategory::InvalidRequest,
                    "Capture session is not paused",
                    false,
                ));
            }
            capture::resume_capture_session(Some(&self.project_id)).map_err(backend_error)?;
            self.state = CaptureSessionState::Recording;
            Ok(())
        }

        fn finish(
            self: Box<Self>,
            options: CaptureFinishOptions,
        ) -> Result<CaptureArtifacts, CaptureError> {
            if self.state == CaptureSessionState::Finalizing {
                return Err(CaptureError::new(
                    CaptureErrorCategory::InvalidRequest,
                    "Capture session is already finalizing",
                    false,
                ));
            }
            let project = capture::stop_capture_session(
                Some(&self.project_id),
                options.microphone_audio,
                options.camera_video,
                options.camera_mime_type,
                options.camera_shape,
            )
            .map_err(backend_error)?;
            let mut files = vec![
                CaptureArtifact {
                    kind: ArtifactKind::ScreenVideo,
                    path: project.raw_video_path,
                    mime_type: Some("video/mp4".to_string()),
                    byte_length: None,
                },
                CaptureArtifact {
                    kind: ArtifactKind::RecordingMetadata,
                    path: project.metadata_path,
                    mime_type: Some("application/json".to_string()),
                    byte_length: None,
                },
            ];
            // Project DB dimensions/duration are authoritative after finalization.
            Ok(CaptureArtifacts {
                files: std::mem::take(&mut files),
                duration_ms: project.duration.max(0) as u64,
                width: project.width.max(0) as u32,
                height: project.height.max(0) as u32,
            })
        }

        fn cancel(self: Box<Self>) -> Result<(), CaptureError> {
            capture::cancel_capture_session(&self.project_id).map_err(backend_error)
        }
    }
}

#[cfg(not(windows))]
pub struct NativeBackend;

#[cfg(windows)]
pub use native::WindowsBackend as NativeBackend;

#[cfg(not(windows))]
impl CaptureBackend for NativeBackend {
    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            platform: if cfg!(target_os = "macos") {
                Platform::MacOs
            } else {
                Platform::Linux
            },
            source_kinds: Vec::new(),
            can_pause: false,
            can_capture_microphone: false,
            can_capture_system_audio: false,
            can_capture_camera: false,
            cursor_modes: Vec::new(),
            can_capture_keyboard_shortcuts: false,
        }
    }

    fn enumerate_sources(
        &self,
        _kind: CaptureSourceKind,
    ) -> Result<Vec<CaptureSourceDescriptor>, CaptureError> {
        Err(unsupported())
    }

    fn start(&self, _request: CaptureRequest) -> Result<Box<dyn CaptureSession>, CaptureError> {
        Err(unsupported())
    }
}

#[cfg(not(windows))]
fn unsupported() -> CaptureError {
    CaptureError::new(
        CaptureErrorCategory::Unsupported,
        "Native screen capture is not implemented for this platform",
        false,
    )
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    use super::*;

    #[cfg(not(windows))]
    #[test]
    fn non_windows_backend_reports_capture_as_unsupported() {
        let backend = NativeBackend;
        assert!(backend.capabilities().source_kinds.is_empty());
        let error = backend
            .enumerate_sources(CaptureSourceKind::Display)
            .unwrap_err();
        assert_eq!(error.category, CaptureErrorCategory::Unsupported);
    }
}
