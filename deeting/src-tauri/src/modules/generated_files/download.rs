use std::path::PathBuf;

use tauri::Runtime;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::storage::get_generated_file_path;

#[derive(Debug, serde::Serialize)]
pub struct SaveGeneratedFileResponse {
    pub saved: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn open_generated_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    file_id: String,
) -> Result<(), String> {
    let path = get_generated_file_path(&app, &file_id).map_err(|err| err.to_string())?;

    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    // Use Tauri opener plugin to open or reveal file
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open file: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn reveal_generated_file_in_folder<R: Runtime>(
    app: tauri::AppHandle<R>,
    file_id: String,
) -> Result<(), String> {
    let path = get_generated_file_path(&app, &file_id).map_err(|err| err.to_string())?;

    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Failed to reveal file: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn save_generated_file_as<R: Runtime>(
    app: tauri::AppHandle<R>,
    file_id: String,
) -> Result<SaveGeneratedFileResponse, String> {
    let source_path = get_generated_file_path(&app, &file_id).map_err(|err| err.to_string())?;
    if !source_path.exists() {
        return Err("File does not exist".to_string());
    }

    let source_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or_else(|| "Failed to resolve source filename".to_string())?;

    let mut dialog = app.dialog().file().set_file_name(source_name.clone());
    if let Some(downloads_dir) = dirs::download_dir() {
        dialog = dialog.set_directory(downloads_dir);
    }
    if let Some(extension) = source_path.extension().and_then(|value| value.to_str()) {
        let upper = extension.to_ascii_uppercase();
        dialog = dialog.add_filter(upper, &[extension]);
    }

    let destination = dialog.blocking_save_file();
    let Some(destination) = destination else {
        return Ok(SaveGeneratedFileResponse {
            saved: false,
            path: None,
        });
    };

    let destination_path = destination
        .into_path()
        .map_err(|err| format!("Invalid destination path: {err}"))?;
    let parent_dir = destination_path
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Destination path has no parent directory".to_string())?;
    std::fs::create_dir_all(&parent_dir)
        .map_err(|err| format!("Failed to create destination directory: {err}"))?;
    std::fs::copy(&source_path, &destination_path)
        .map_err(|err| format!("Failed to export file: {err}"))?;

    Ok(SaveGeneratedFileResponse {
        saved: true,
        path: Some(destination_path.to_string_lossy().to_string()),
    })
}
