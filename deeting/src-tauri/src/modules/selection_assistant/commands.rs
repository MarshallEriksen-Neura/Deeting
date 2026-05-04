use super::capture::{capture_active_selection, SelectionCaptureResult};

#[tauri::command]
pub async fn capture_active_text_selection() -> Result<SelectionCaptureResult, String> {
    tauri::async_runtime::spawn_blocking(capture_active_selection)
        .await
        .map_err(|err| format!("selection capture task failed: {err}"))
}
