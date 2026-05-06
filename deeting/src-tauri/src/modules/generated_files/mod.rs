use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

pub mod artifact_inspect;
pub mod artifact_patch;
pub mod artifact_store;
pub mod artifact_types;
pub mod docx_generator;
pub mod download;
pub mod pptx_generator;
pub mod storage;

pub fn resolve_generated_files_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let dir = if let Ok(app_data_dir) = app.path().app_data_dir() {
        app_data_dir.join("generated-files")
    } else if let Some(home) = dirs::home_dir() {
        home.join(".config").join("deeting").join("generated-files")
    } else {
        PathBuf::from("generated-files")
    };

    let _ = std::fs::create_dir_all(&dir);
    dir
}
