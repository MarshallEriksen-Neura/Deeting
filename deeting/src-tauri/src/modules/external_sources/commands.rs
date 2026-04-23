use tauri::State;

use crate::state::AppState;

use super::sync::{sync_external_source_inner, test_external_source_connection};
use super::types::{
    CreateExternalSourceRequest, CreateManualExternalRawRecordRequest, ExternalRawRecord,
    ExternalSourceConnectionTestResult, ExternalSourceRecord, ExternalSourceSyncResult,
    UpdateExternalSourceRequest,
};

#[tauri::command]
pub async fn list_local_external_sources(
    state: State<'_, AppState>,
) -> Result<Vec<ExternalSourceRecord>, String> {
    state
        .mcp
        .store
        .list_external_sources()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_local_external_source(
    state: State<'_, AppState>,
    payload: CreateExternalSourceRequest,
) -> Result<ExternalSourceRecord, String> {
    state
        .mcp
        .store
        .create_external_source(payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn update_local_external_source(
    state: State<'_, AppState>,
    source_id: String,
    payload: UpdateExternalSourceRequest,
) -> Result<ExternalSourceRecord, String> {
    state
        .mcp
        .store
        .update_external_source(&source_id, payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_local_external_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_external_source(&source_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn test_local_external_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<ExternalSourceConnectionTestResult, String> {
    test_external_source_connection(state.mcp.store.as_ref(), &source_id).await
}

#[tauri::command]
pub async fn sync_local_external_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<ExternalSourceSyncResult, String> {
    sync_external_source_inner(state.mcp.store.as_ref(), &source_id).await
}

#[tauri::command]
pub async fn list_local_external_source_records(
    state: State<'_, AppState>,
    source_id: String,
    limit: Option<usize>,
) -> Result<Vec<ExternalRawRecord>, String> {
    state
        .mcp
        .store
        .list_external_raw_records(&source_id, limit.unwrap_or(10))
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_local_manual_external_record(
    state: State<'_, AppState>,
    source_id: String,
    payload: CreateManualExternalRawRecordRequest,
) -> Result<ExternalRawRecord, String> {
    state
        .mcp
        .store
        .create_manual_external_raw_record(&source_id, payload)
        .await
        .map_err(|err| err.to_string())
}
