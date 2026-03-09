use super::{common_impl::to_string, support::*};

#[tauri::command]
pub async fn list_local_knowledge_files(
    state: State<'_, AppState>,
    query: LocalUserDocumentListQuery,
) -> Result<Vec<LocalKnowledgeFile>, String> {
    state
        .mcp
        .store
        .list_local_user_documents(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn list_local_knowledge_folders(
    state: State<'_, AppState>,
) -> Result<Vec<LocalKnowledgeFolder>, String> {
    let tree = state
        .mcp
        .store
        .get_local_knowledge_tree(LocalKnowledgeTreeQuery {
            parent_id: None,
            q: None,
            sort_field: None,
            sort_direction: None,
        })
        .await
        .map_err(to_string)?;
    Ok(tree.folders)
}

#[tauri::command]
pub async fn get_local_knowledge_tree(
    state: State<'_, AppState>,
    query: LocalKnowledgeTreeQuery,
) -> Result<LocalKnowledgeTreeResponse, String> {
    state
        .mcp
        .store
        .get_local_knowledge_tree(query)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn create_local_knowledge_folder(
    state: State<'_, AppState>,
    payload: CreateLocalKnowledgeFolderRequest,
) -> Result<LocalKnowledgeFolder, String> {
    state
        .mcp
        .store
        .create_local_knowledge_folder(payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_knowledge_folder(
    state: State<'_, AppState>,
    id: String,
    payload: UpdateLocalKnowledgeFolderRequest,
) -> Result<LocalKnowledgeFolder, String> {
    state
        .mcp
        .store
        .update_local_knowledge_folder(&id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_knowledge_folder(
    state: State<'_, AppState>,
    id: String,
    recursive: Option<bool>,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_local_knowledge_folder(&id, recursive.unwrap_or(false))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_knowledge_stats(
    state: State<'_, AppState>,
) -> Result<LocalKnowledgeStatsResponse, String> {
    state
        .mcp
        .store
        .get_local_knowledge_stats()
        .await
        .map_err(to_string)
}
