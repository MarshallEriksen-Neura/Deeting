//! Tauri commands for the terminal panel.
//!
//! All four commands operate against a [`TerminalManager`] held in Tauri's
//! managed state. Errors are stringified before crossing the IPC boundary
//! so the frontend can surface them directly.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use super::manager::TerminalManager;
use super::session::{PtyReplayChunk, PtySessionConfig};

/// Response for `pty_open` / `pty_create`. Returned wrapped in a struct (instead of a bare
/// string) to leave room for additional metadata in v1.5+ without breaking
/// the IPC contract.
#[derive(Serialize)]
pub struct PtyOpenResponse {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Serialize)]
pub struct PtyListResponse {
    #[serde(rename = "sessionIds")]
    pub session_ids: Vec<String>,
    pub sessions: Vec<PtySessionInfoResponse>,
}

#[derive(Serialize)]
pub struct PtySessionInfoResponse {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub status: &'static str,
}

#[derive(Serialize)]
pub struct PtyReplayResponse {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "lastSequence")]
    pub last_sequence: u64,
    pub chunks: Vec<PtyReplayChunk>,
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
pub async fn pty_create(
    app: AppHandle,
    state: State<'_, Arc<TerminalManager>>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    client_session_id: Option<String>,
) -> Result<PtyOpenResponse, String> {
    let session_id = state
        .create(PtySessionConfig { cols, rows, cwd }, app, client_session_id)
        .map_err(|e| e.to_string())?;
    Ok(PtyOpenResponse { session_id })
}

#[tauri::command]
pub async fn pty_list(state: State<'_, Arc<TerminalManager>>) -> Result<PtyListResponse, String> {
    let sessions = state
        .session_infos()
        .into_iter()
        .map(|info| PtySessionInfoResponse {
            session_id: info.session_id,
            status: info.status,
        })
        .collect::<Vec<_>>();
    Ok(PtyListResponse {
        session_ids: state.session_ids(),
        sessions,
    })
}

#[tauri::command]
pub async fn pty_replay(
    state: State<'_, Arc<TerminalManager>>,
    session_id: String,
) -> Result<PtyReplayResponse, String> {
    let replay = state.replay(&session_id).map_err(|e| e.to_string())?;
    Ok(PtyReplayResponse {
        session_id,
        last_sequence: replay.last_sequence,
        chunks: replay.chunks,
    })
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
