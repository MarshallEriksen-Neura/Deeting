use std::path::PathBuf;

use tauri::{AppHandle, Runtime};
use uuid::Uuid;

use super::resolve_generated_files_dir;

#[derive(Debug, Clone)]
pub struct GeneratedFileArtifact {
    pub file_id: String,
    pub filename: String,
    pub size: usize,
    pub content_type: String,
    pub preview_text: String,
}

#[derive(Debug, thiserror::Error)]
pub enum GeneratedFileError {
    #[error("invalid generated file input: {0}")]
    InvalidInput(String),
    #[error("generated file not found: {0}")]
    NotFound(String),
    #[error("generated file io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("generated file zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
}

pub fn put_generated_file<R: Runtime>(
    app: &AppHandle<R>,
    bytes: &[u8],
    filename: &str,
) -> Result<String, GeneratedFileError> {
    let trimmed_name = filename.trim();
    if trimmed_name.is_empty() {
        return Err(GeneratedFileError::InvalidInput(
            "filename is required".to_string(),
        ));
    }

    let dir = resolve_generated_files_dir(app);
    let file_id = Uuid::new_v4().to_string();
    let storage_name = format!("{}_{}", file_id, trimmed_name);
    let path = dir.join(storage_name);
    std::fs::write(path, bytes)?;
    Ok(file_id)
}

pub fn get_generated_file_path<R: Runtime>(
    app: &AppHandle<R>,
    file_id: &str,
) -> Result<PathBuf, GeneratedFileError> {
    let normalized_id = file_id.trim();
    if normalized_id.is_empty() {
        return Err(GeneratedFileError::InvalidInput(
            "file_id is required".to_string(),
        ));
    }

    let dir = resolve_generated_files_dir(app);
    let entries = std::fs::read_dir(&dir)?;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(normalized_id) {
            return Ok(entry.path());
        }
    }

    Err(GeneratedFileError::NotFound(normalized_id.to_string()))
}
