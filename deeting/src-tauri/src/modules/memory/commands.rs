use tauri::State;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::types::{
    CreateLocalMemoryRequest, LocalMemoryClearRequest, LocalMemoryClearResponse,
    LocalMemoryDeleteResponse, LocalMemoryItem, LocalMemoryListQuery, LocalMemoryListResponse,
};
use crate::state::AppState;

#[tauri::command]
pub async fn append_local_memory(
    state: State<'_, AppState>,
    payload: CreateLocalMemoryRequest,
) -> Result<LocalMemoryItem, String> {
    state.memory.store.append(payload).await.map_err(to_string)
}

#[tauri::command]
pub async fn list_local_memories(
    state: State<'_, AppState>,
    query: Option<LocalMemoryListQuery>,
) -> Result<LocalMemoryListResponse, String> {
    state
        .memory
        .store
        .list(query.unwrap_or_default())
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_memory(
    state: State<'_, AppState>,
    id: String,
) -> Result<LocalMemoryDeleteResponse, String> {
    let deleted = state.memory.store.delete(&id).await.map_err(to_string)?;
    Ok(LocalMemoryDeleteResponse { id, deleted })
}

#[tauri::command]
pub async fn clear_local_memories(
    state: State<'_, AppState>,
    payload: Option<LocalMemoryClearRequest>,
) -> Result<LocalMemoryClearResponse, String> {
    let cleared = state
        .memory
        .store
        .clear(payload.unwrap_or_default())
        .await
        .map_err(to_string)?;
    Ok(LocalMemoryClearResponse { cleared })
}

fn to_string(err: MemoryError) -> String {
    err.to_string()
}
