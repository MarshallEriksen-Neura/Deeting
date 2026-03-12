use tauri::State;

use crate::modules::knowledge::types::*;
use crate::state::AppState;

fn to_string<T: std::fmt::Display>(err: T) -> String {
    err.to_string()
}

#[tauri::command]
pub async fn list_local_knowledge_files(
    state: State<'_, AppState>,
    query: LocalUserDocumentListQuery,
) -> Result<Vec<LocalKnowledgeFile>, String> {
    state
        .knowledge
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
        .knowledge
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
        .knowledge
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
        .knowledge
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
        .knowledge
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
        .knowledge
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
        .knowledge
        .store
        .get_local_knowledge_stats()
        .await
        .map_err(to_string)
}

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
        .knowledge
        .store
        .create_local_user_document(payload)
        .await
        .map_err(to_string)?;

    crate::modules::mcp::commands::assistants_knowledge_admin_impl::spawn_embed_knowledge_chunks(
        state.inner(),
        &file,
    );
    Ok(file)
}

#[tauri::command]
pub async fn list_local_user_documents(
    state: State<'_, AppState>,
    query: LocalUserDocumentListQuery,
) -> Result<Vec<LocalKnowledgeFile>, String> {
    state
        .knowledge
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
        .knowledge
        .store
        .get_local_user_document(&file_id)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn get_local_user_document_download_url(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<String, String> {
    state
        .knowledge
        .store
        .get_local_user_document_download_url(&file_id)
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
        .knowledge
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
    let object_key = state
        .knowledge
        .store
        .get_local_user_document_object_key(&file_id)
        .await
        .map_err(to_string)?;

    if let Some(object_key) = object_key {
        if let Err(err) = state
            .providers
            .store
            .delete_local_desktop_object_storage_object(&object_key)
            .await
        {
            log::warn!(
                "delete_local_user_document: failed to delete desktop object storage object {}: {}",
                object_key,
                err
            );
        }
    }

    state
        .knowledge
        .store
        .delete_local_user_document(&file_id)
        .await
        .map_err(to_string)?;

    let pkg_name = format!("knowledge:{}", file_id);
    let memory_service = state.memory.service.clone();
    tokio::spawn(async move {
        if let Err(err) = memory_service.delete_assets_by_package(&pkg_name).await {
            log::warn!(
                "delete_local_user_document: failed to clean up embeddings: {}",
                err
            );
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
        .knowledge
        .store
        .retry_local_user_document(&file_id)
        .await
        .map_err(to_string)?;
    crate::modules::mcp::commands::assistants_knowledge_admin_impl::spawn_embed_knowledge_chunks(
        state.inner(),
        &file,
    );
    Ok(file)
}

#[tauri::command]
pub async fn list_local_user_document_chunks(
    state: State<'_, AppState>,
    file_id: String,
    query: LocalUserDocumentChunkListQuery,
) -> Result<LocalKnowledgeChunkListResponse, String> {
    state
        .knowledge
        .store
        .list_local_user_document_chunks(&file_id, query)
        .await
        .map_err(to_string)
}
