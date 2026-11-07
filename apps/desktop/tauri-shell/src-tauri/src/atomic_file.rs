use std::{
    fs::{File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

struct PendingFile(PathBuf);

impl Drop for PendingFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Write beside the destination, then replace it only after every byte is flushed.
/// A failed write or replacement leaves any previous saved file intact.
pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_with(path, |file| file.write_all(bytes))
}

fn write_with(
    path: &Path,
    write_contents: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    for _ in 0..100 {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let temporary = parent.join(format!(".foom-save-{}-{id}.tmp", std::process::id()));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(mut file) => {
                let pending = PendingFile(temporary);
                let result = write_contents(&mut file).and_then(|()| file.sync_all());
                drop(file);
                result?;
                return std::fs::rename(&pending.0, path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Cannot reserve a temporary save file",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "foom-atomic-test-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn replaces_previous_file_after_complete_write() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("project.json");
        std::fs::write(&destination, b"previous project").unwrap();
        write(&destination, b"new complete project").unwrap();
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"new complete project"
        );
        assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
    }

    #[test]
    fn partial_write_failure_preserves_previous_file_and_cleans_temporary() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("video.mp4");
        std::fs::write(&destination, b"previous export").unwrap();
        let result = write_with(&destination, |file| {
            file.write_all(b"partial new export")?;
            Err(io::Error::new(io::ErrorKind::Other, "simulated disk full"))
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"previous export");
        assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
    }

    #[test]
    fn failed_commit_preserves_destination_and_cleans_temporary() {
        let directory = TestDirectory::new();
        let destination = directory.0.join("existing-directory");
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(destination.join("keep.txt"), b"keep").unwrap();
        assert!(write(&destination, b"cannot replace directory").is_err());
        assert_eq!(
            std::fs::read(destination.join("keep.txt")).unwrap(),
            b"keep"
        );
        assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
    }
}
