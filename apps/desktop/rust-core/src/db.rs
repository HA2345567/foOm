use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use shared_core::{DocumentIntegrity, ProjectDocument};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub raw_video_path: String,
    pub metadata_path: String,
    pub created_at: String,
    pub duration: i64,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIntegrity {
    pub ok: bool,
    pub missing_video: bool,
    pub missing_document: bool,
    pub migrated_document: bool,
}

fn get_db_path() -> PathBuf {
    let mut path = app_data_root();
    path.push("foom");
    let _ = fs::create_dir_all(&path);
    path.push("foom.db");
    path
}

fn app_data_root() -> PathBuf {
    app_data_root_for(
        std::env::consts::OS,
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from),
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from),
    )
}

fn app_data_root_for(
    operating_system: &str,
    local_app_data: Option<PathBuf>,
    xdg_data_home: Option<PathBuf>,
    home: Option<PathBuf>,
) -> PathBuf {
    match operating_system {
        // Keep the current Windows location; use the conventional path if the
        // environment variable is unavailable (for example in tests/tools).
        "windows" => local_app_data
            .or_else(|| home.map(|home| home.join("AppData").join("Local")))
            .unwrap_or_else(|| PathBuf::from(".")),
        "macos" => home
            .map(|home| home.join("Library").join("Application Support"))
            .unwrap_or_else(|| PathBuf::from(".")),
        "linux" => xdg_data_home
            .filter(|path| path.is_absolute())
            .or_else(|| home.map(|home| home.join(".local").join("share")))
            .unwrap_or_else(|| PathBuf::from(".")),
        _ => home
            .map(|home| home.join(".local").join("share"))
            .unwrap_or_else(|| PathBuf::from(".")),
    }
}

pub fn init_db() {
    let db_path = get_db_path();
    if let Ok(conn) = Connection::open(db_path) {
        let _ = conn.execute(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                raw_video_path TEXT NOT NULL,
                metadata_path TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                duration INTEGER DEFAULT 0,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL
            )",
            [],
        );
        migrate_project_documents(&conn);
        cleanup_orphaned_recording_files(&conn);
    }
}

fn get_recordings_dir() -> PathBuf {
    let user_profile = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let home = std::env::var_os("HOME")
        .or_else(|| user_profile.clone().map(|path| path.into_os_string()))
        .map(PathBuf::from);
    let mut path = recordings_root_for(
        std::env::consts::OS,
        user_profile,
        std::env::var_os("XDG_VIDEOS_DIR").map(PathBuf::from),
        home,
        app_data_root(),
    );
    path.push("foom");
    path.push("recordings");
    path
}

fn recordings_root_for(
    operating_system: &str,
    user_profile: Option<PathBuf>,
    xdg_videos_dir: Option<PathBuf>,
    home: Option<PathBuf>,
    app_data_root: PathBuf,
) -> PathBuf {
    match operating_system {
        "windows" => user_profile
            .map(|home| home.join("Videos"))
            .unwrap_or(app_data_root),
        "macos" => home
            .map(|home| home.join("Movies"))
            .unwrap_or(app_data_root),
        "linux" => xdg_videos_dir
            .filter(|path| path.is_absolute())
            .or_else(|| home.map(|home| home.join("Videos")))
            .unwrap_or(app_data_root),
        _ => home
            .map(|home| home.join("Videos"))
            .unwrap_or(app_data_root),
    }
}

fn cleanup_orphaned_recording_files(conn: &Connection) {
    let rec_dir = get_recordings_dir();
    cleanup_recording_directory(conn, &rec_dir);
}

fn cleanup_recording_directory(conn: &Connection, rec_dir: &std::path::Path) {
    let entries = match fs::read_dir(&rec_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let mut live_paths = HashSet::new();
    if let Ok(mut stmt) = conn.prepare("SELECT raw_video_path, metadata_path FROM projects") {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            for row in rows.flatten() {
                live_paths.insert(PathBuf::from(&row.0));
                live_paths.insert(PathBuf::from(&row.1));
                if let Some(camera_path) = read_camera_video_path(&row.1) {
                    live_paths.insert(PathBuf::from(camera_path));
                }
            }
        }
    }

    for entry in entries.flatten() {
        let path = entry.path();
        if live_paths.contains(&path) {
            continue;
        }

        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        let is_managed_temp = name.ends_with("_temp.mp4")
            || name.ends_with("_audio.wav")
            || name.starts_with("foom_filter_");
        // A recording without a database row may still be recoverable after a
        // crash or failed insert. Keep original media and documents on disk.
        if is_managed_temp {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_paths_follow_each_platform_convention() {
        let home = PathBuf::from("C:/Users/foom");
        let local = PathBuf::from("C:/Users/foom/AppData/Local");
        let xdg = std::env::temp_dir().join("foom-xdg-data");

        assert_eq!(
            app_data_root_for("windows", Some(local.clone()), None, Some(home.clone())),
            local
        );
        assert_eq!(
            app_data_root_for("macos", None, None, Some(PathBuf::from("/Users/foom"))),
            PathBuf::from("/Users/foom/Library/Application Support")
        );
        assert_eq!(
            app_data_root_for("linux", None, Some(xdg.clone()), Some(home.clone())),
            xdg
        );
        assert_eq!(
            app_data_root_for("linux", None, None, Some(home.clone())),
            home.join(".local").join("share")
        );
    }

    #[test]
    fn recordings_paths_follow_each_platform_convention() {
        let home = PathBuf::from("C:/Users/foom");
        let fallback = PathBuf::from("fallback-data");
        let xdg_videos = std::env::temp_dir().join("foom-xdg-videos");

        assert_eq!(
            recordings_root_for("windows", Some(home.clone()), None, None, fallback.clone()),
            home.join("Videos")
        );
        assert_eq!(
            recordings_root_for(
                "macos",
                None,
                None,
                Some(PathBuf::from("/Users/foom")),
                fallback.clone()
            ),
            PathBuf::from("/Users/foom/Movies")
        );
        assert_eq!(
            recordings_root_for(
                "linux",
                None,
                Some(xdg_videos.clone()),
                Some(home.clone()),
                fallback.clone()
            ),
            xdg_videos
        );
        assert_eq!(
            recordings_root_for("linux", None, None, Some(home.clone()), fallback.clone()),
            home.join("Videos")
        );
        assert_eq!(
            recordings_root_for("windows", None, None, None, fallback.clone()),
            fallback
        );
    }

    #[test]
    fn linux_ignores_relative_xdg_directory_overrides() {
        let home = PathBuf::from("/home/foom");
        assert_eq!(
            app_data_root_for(
                "linux",
                None,
                Some(PathBuf::from("relative-data")),
                Some(home.clone())
            ),
            home.join(".local").join("share")
        );
        assert_eq!(
            recordings_root_for(
                "linux",
                None,
                Some(PathBuf::from("relative-videos")),
                Some(home.clone()),
                PathBuf::from("fallback")
            ),
            home.join("Videos")
        );
    }

    #[test]
    fn project_document_save_replaces_existing_document() {
        let path =
            std::env::temp_dir().join(format!("foom-atomic-save-{}.json", std::process::id()));
        fs::write(&path, "old state").unwrap();
        write_project_document(&path, "new state").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new state");
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn startup_cleanup_preserves_recoverable_recordings() {
        let dir = std::env::temp_dir().join(format!(
            "foom-recovery-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&dir).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE projects (raw_video_path TEXT, metadata_path TEXT)",
            [],
        )
        .unwrap();
        let files = [
            "proj_crashed.mp4",
            "proj_crashed.json",
            "proj_crashed_mic.webm",
            "proj_crashed_webcam.webm",
        ];
        for name in files {
            fs::write(dir.join(name), b"recoverable").unwrap();
        }
        let temp = dir.join("proj_crashed_temp.mp4");
        fs::write(&temp, b"temporary").unwrap();
        cleanup_recording_directory(&conn, &dir);
        assert!(!temp.exists());
        for name in files {
            assert!(dir.join(name).exists(), "removed recoverable {name}");
            fs::remove_file(dir.join(name)).unwrap();
        }
        fs::remove_dir(dir).unwrap();
    }
}

fn read_camera_video_path(metadata_path: &str) -> Option<String> {
    let json = fs::read_to_string(metadata_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&json).ok()?;
    value
        .get("cameraVideoPath")
        .and_then(|path| path.as_str())
        .map(ToOwned::to_owned)
}

fn write_project_document(path: &std::path::Path, json: &str) -> std::io::Result<()> {
    use std::io::Write;
    let temporary = path.with_extension("json.tmp");
    let mut file = fs::File::create(&temporary)?;
    file.write_all(json.as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, path)
}

fn ensure_project_document(project: &Project) -> ProjectIntegrity {
    let missing_video = !PathBuf::from(&project.raw_video_path).exists();
    let document_path = PathBuf::from(&project.metadata_path);
    let missing_document = !document_path.exists();
    let mut migrated_document = false;

    if !missing_document {
        if let Ok(raw) = fs::read_to_string(&document_path) {
            if let Ok(mut value) = serde_json::from_str::<Value>(&raw) {
                if value.get("documentVersion").is_none() {
                    if let Some(obj) = value.as_object_mut() {
                        obj.insert("documentVersion".to_string(), json!(1));
                        obj.insert(
                            "media".to_string(),
                            json!({
                                "rawVideoPath": project.raw_video_path,
                                "metadataPath": project.metadata_path,
                            }),
                        );
                        obj.entry("editor".to_string()).or_insert_with(|| json!({}));
                        obj.entry("integrity".to_string()).or_insert_with(|| {
                            json!({
                                "checkedAt": chrono::Local::now().to_rfc3339(),
                                "missingVideo": missing_video,
                                "missingDocument": false,
                            })
                        });
                        if let Ok(json_str) = serde_json::to_string_pretty(&value) {
                            if write_project_document(&document_path, &json_str).is_ok() {
                                migrated_document = true;
                            }
                        }
                    }
                }
            }
        }
    }

    ProjectIntegrity {
        ok: !missing_video && !missing_document,
        missing_video,
        missing_document,
        migrated_document,
    }
}

fn migrate_project_documents(conn: &Connection) {
    if let Ok(projects) = list_projects_with_connection(conn) {
        for project in projects {
            let _ = ensure_project_document(&project);
        }
    }
}

pub fn create_project(
    id: &str,
    name: &str,
    raw_video_path: &str,
    metadata_path: &str,
    duration: i64,
    width: i32,
    height: i32,
) -> Result<()> {
    let db_path = get_db_path();
    let conn = Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO projects (id, name, raw_video_path, metadata_path, duration, width, height)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            id,
            name,
            raw_video_path,
            metadata_path,
            duration,
            width,
            height,
        ),
    )?;
    Ok(())
}

pub fn get_project(id: &str) -> Result<Project> {
    let db_path = get_db_path();
    let conn = Connection::open(db_path)?;
    let project = conn.query_row(
        "SELECT id, name, raw_video_path, metadata_path, created_at, duration, width, height FROM projects WHERE id = ?1",
        [id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                raw_video_path: row.get(2)?,
                metadata_path: row.get(3)?,
                created_at: row.get(4)?,
                duration: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
            })
        },
    )?;
    let _ = ensure_project_document(&project);
    Ok(project)
}

fn list_projects_with_connection(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, raw_video_path, metadata_path, created_at, duration, width, height FROM projects ORDER BY created_at DESC"
    )?;
    let project_iter = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            raw_video_path: row.get(2)?,
            metadata_path: row.get(3)?,
            created_at: row.get(4)?,
            duration: row.get(5)?,
            width: row.get(6)?,
            height: row.get(7)?,
        })
    })?;

    let mut projects = Vec::new();
    for p in project_iter {
        if let Ok(project) = p {
            projects.push(project);
        }
    }
    Ok(projects)
}

pub fn list_projects() -> Result<Vec<Project>> {
    let db_path = get_db_path();
    let conn = Connection::open(db_path)?;
    let projects = list_projects_with_connection(&conn)?;
    for project in &projects {
        let _ = ensure_project_document(project);
    }
    Ok(projects)
}

pub fn get_project_document(id: &str) -> Result<Value> {
    let project = get_project(id)?;
    let raw = fs::read_to_string(&project.metadata_path)
        .map_err(|_| rusqlite::Error::QueryReturnedNoRows)?;
    let document: ProjectDocument =
        serde_json::from_str(&raw).map_err(|_| rusqlite::Error::InvalidQuery)?;
    serde_json::to_value(document).map_err(|_| rusqlite::Error::InvalidQuery)
}

pub fn save_project_editor_state(id: &str, editor: Value) -> Result<()> {
    let project = get_project(id)?;
    let mut document: ProjectDocument = serde_json::from_value(get_project_document(id)?)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    let checked_at = chrono::Local::now().to_rfc3339();
    document.editor = editor;
    document.updated_at = Some(checked_at.clone());
    document.integrity = Some(DocumentIntegrity {
        checked_at: Some(checked_at),
        missing_video: !PathBuf::from(&project.raw_video_path).exists(),
        missing_document: false,
        ok: None,
        migrated_document: None,
    });
    let json_str =
        serde_json::to_string_pretty(&document).map_err(|_| rusqlite::Error::InvalidQuery)?;
    write_project_document(std::path::Path::new(&project.metadata_path), &json_str)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    Ok(())
}

pub fn delete_project(id: &str) -> Result<()> {
    // Attempt to delete files on disk first
    if let Ok(project) = get_project(id) {
        let _ = std::fs::remove_file(&project.raw_video_path);
        if let Some(camera_path) = read_camera_video_path(&project.metadata_path) {
            let _ = std::fs::remove_file(camera_path);
        }
        let _ = std::fs::remove_file(&project.metadata_path);

        // Also clean up any audio files if they were extracted natively
        let raw_path = std::path::Path::new(&project.raw_video_path);
        let wav_path = raw_path.with_file_name(format!("{}_audio.wav", project.id));
        let _ = std::fs::remove_file(wav_path);

        let temp_video = raw_path.with_file_name(format!("{}_temp.mp4", project.id));
        let _ = std::fs::remove_file(temp_video);

        let mic_audio = raw_path.with_file_name(format!("{}_mic.webm", project.id));
        let _ = std::fs::remove_file(mic_audio);

        if let Some(stem) = raw_path.file_stem() {
            let cinematic_video =
                raw_path.with_file_name(format!("{}_cinematic.mp4", stem.to_string_lossy()));
            let _ = std::fs::remove_file(cinematic_video);
        }
    }

    let db_path = get_db_path();
    let conn = Connection::open(db_path)?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}
