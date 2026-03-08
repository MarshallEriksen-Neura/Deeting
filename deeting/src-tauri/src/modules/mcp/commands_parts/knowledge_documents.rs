use super::{
    assistants_knowledge_admin_impl::spawn_embed_knowledge_chunks,
    bootstrap_and_registry_impl::to_string,
    support::*,
};

#[tauri::command]
pub async fn create_local_user_document(
    state: State<'_, AppState>,
    payload: CreateLocalUserDocumentRequest,
) -> Result<LocalKnowledgeFile, String> {
    let requires_model_check = payload
        .status
        .as_ref()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized.is_empty()
                || normalized == "processing"
                || normalized == "pending"
                || normalized == "running"
        })
        .unwrap_or(true);

    if requires_model_check {
        crate::modules::providers::model_guard::ensure_required_local_models_configured(
            state.inner(),
        )
        .await?;
    }

    let file = state
        .mcp
        .store
        .create_local_user_document(payload)
        .await
        .map_err(to_string)?;

    spawn_embed_knowledge_chunks(state.inner(), &file);
    Ok(file)
}

#[tauri::command]
pub async fn list_local_user_documents(
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
pub async fn get_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<LocalKnowledgeFile, String> {
    state
        .mcp
        .store
        .get_local_user_document(&file_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn update_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
    payload: UpdateLocalUserDocumentRequest,
) -> Result<LocalKnowledgeFile, String> {
    state
        .mcp
        .store
        .update_local_user_document(&file_id, payload)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn delete_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<(), String> {
    state
        .mcp
        .store
        .delete_local_user_document(&file_id)
        .await
        .map_err(to_string)?;

    let pkg_name = format!("knowledge:{}", file_id);
    let memory_service = state.memory.service.clone();
    tokio::spawn(async move {
        if let Err(err) = memory_service.delete_assets_by_package(&pkg_name).await {
            log::warn!("delete_local_user_document: failed to clean up embeddings: {}", err);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn retry_local_user_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<LocalKnowledgeFile, String> {
    crate::modules::providers::model_guard::ensure_required_local_models_configured(state.inner())
        .await?;
    let file = state
        .mcp
        .store
        .retry_local_user_document(&file_id)
        .await
        .map_err(to_string)?;
    spawn_embed_knowledge_chunks(state.inner(), &file);
    Ok(file)
}

#[tauri::command]
pub async fn list_local_user_document_chunks(
    state: State<'_, AppState>,
    file_id: String,
    query: LocalUserDocumentChunkListQuery,
) -> Result<LocalKnowledgeChunkListResponse, String> {
    state
        .mcp
        .store
        .list_local_user_document_chunks(&file_id, query)
        .await
        .map_err(to_string)
}