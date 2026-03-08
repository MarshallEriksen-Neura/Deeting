use tauri::State;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::types::{
    CreateLocalMemoryRequest, LocalMemoryClearRequest, LocalMemoryClearResponse,
    LocalMemoryDeleteResponse, LocalMemoryItem, LocalMemoryListQuery, LocalMemoryListResponse,
    LocalMemorySearchQuery, LocalMemorySearchResult, MemorySnapshot, WriteGuardResult,
};
use crate::state::AppState;

#[tauri::command]
pub async fn append_local_memory(
    state: State<'_, AppState>,
    payload: CreateLocalMemoryRequest,
) -> Result<LocalMemoryItem, String> {
    state.memory.service.append(payload).await.map_err(to_string)
}

#[tauri::command]
pub async fn append_local_memory_guarded(
    state: State<'_, AppState>,
    payload: CreateLocalMemoryRequest,
) -> Result<WriteGuardResult, String> {
    state
        .memory
        .service
        .append_guarded(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_memories(
    state: State<'_, AppState>,
    query: Option<LocalMemoryListQuery>,
) -> Result<LocalMemoryListResponse, String> {
    state
        .memory
        .service
        .list(query.unwrap_or_default())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_memory(
    state: State<'_, AppState>,
    id: String,
) -> Result<LocalMemoryDeleteResponse, String> {
    let deleted = state.memory.service.delete(&id).await.map_err(to_string)?;
    Ok(LocalMemoryDeleteResponse { id, deleted })
}

#[tauri::command]
pub async fn clear_local_memories(
    state: State<'_, AppState>,
    payload: Option<LocalMemoryClearRequest>,
) -> Result<LocalMemoryClearResponse, String> {
    let cleared = state
        .memory
        .service
        .clear(payload.unwrap_or_default())
        .await
        .map_err(to_string)?;
    Ok(LocalMemoryClearResponse { cleared })
}

fn to_string(err: MemoryError) -> String {
    err.to_string()
}

#[tauri::command]
pub async fn search_local_memories(
    state: State<'_, AppState>,
    query: LocalMemorySearchQuery,
) -> Result<LocalMemorySearchResult, String> {
    state
        .memory
        .service
        .search(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_memory_snapshots(
    state: State<'_, AppState>,
    memory_id: String,
    limit: Option<i64>,
) -> Result<Vec<MemorySnapshot>, String> {
    state
        .memory
        .service
        .list_snapshots(&memory_id, limit.unwrap_or(20))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn rollback_memory(
    state: State<'_, AppState>,
    snapshot_id: String,
) -> Result<Option<LocalMemoryItem>, String> {
    state
        .memory
        .service
        .rollback_memory(&snapshot_id)
        .await
        .map_err(to_string)
}
