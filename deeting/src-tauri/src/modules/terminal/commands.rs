//! Tauri commands for the terminal panel.
//!
//! All four commands operate against a [`TerminalManager`] held in Tauri's
//! managed state. Errors are stringified before crossing the IPC boundary
//! so the frontend can surface them directly.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use super::manager::TerminalManager;
use super::session::PtySessionConfig;

/// Response for `pty_open`. Returned wrapped in a struct (instead of a bare
/// string) to leave room for additional metadata in v1.5+ without breaking
/// the IPC contract.
#[derive(Serialize)]
pub struct PtyOpenResponse {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, Arc<TerminalManager>>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<PtyOpenResponse, String> {
    let session_id = state
        .open(PtySessionConfig { cols, rows, cwd }, app)
        .map_err(|e| e.to_string())?;
    Ok(PtyOpenResponse { session_id })
}

#[tauri::command]
pub async fn pty_write(
    state: State<'_, Arc<TerminalManager>>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state
        .write(&session_id, data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, Arc<TerminalManager>>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .resize(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_close(
    state: State<'_, Arc<TerminalManager>>,
    session_id: String,
) -> Result<(), String> {
    state.close(&session_id).map_err(|e| e.to_string())
}
