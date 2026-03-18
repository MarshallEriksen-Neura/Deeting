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

    spawn_embed_knowledge_chunks(state.inner(), &file);
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

    let memory_service = state.memory.service.clone();
    let file_id_for_cleanup = file_id.clone();
    tokio::spawn(async move {
        if let Err(err) = memory_service
            .delete_knowledge_chunk_assets_by_document_id(&file_id_for_cleanup)
            .await
        {
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
    spawn_embed_knowledge_chunks(state.inner(), &file);
    Ok(file)
}

/// Fire-and-forget: embed all chunks of a successfully indexed document into LanceDB.
///
/// Reads chunks from SQLite, embeds each via the embedding service, and upserts
/// into `user_knowledge_chunks` with `pkg_name = {document_id}`.
fn spawn_embed_knowledge_chunks(app_state: &AppState, file: &LocalKnowledgeFile) {
    let status = file.status.trim().to_ascii_lowercase();
    if status != "indexed" && status != "active" {
        return;
    }
    let document_id = file.id.clone();
    let document_name = file.name.clone();
    let store = app_state.knowledge.store.clone();
    let providers = app_state.providers.clone();
    let memory_service = app_state.memory.service.clone();

    tokio::spawn(async move {
        let chunks_result = store
            .list_local_user_document_chunks(
                &document_id,
                LocalUserDocumentChunkListQuery {
                    offset: None,
                    limit: Some(500),
                },
            )
            .await;

        let chunks = match chunks_result {
            Ok(response) => response.items,
            Err(e) => {
                log::warn!(
                    "embed_knowledge_chunks: failed to list chunks for {}: {}",
                    document_id,
                    e
                );
                return;
            }
        };

        // Delete old embeddings for this document before re-inserting.
        let _ = memory_service
            .delete_knowledge_chunk_assets_by_document_id(&document_id)
            .await;

        for chunk in &chunks {
            let embed_result = providers.embedding.embed_text(&chunk.content).await;
            let vector = match embed_result {
                Ok(v) => v,
                Err(e) => {
                    log::warn!(
                        "embed_knowledge_chunks: failed to embed chunk {} of {}: {}",
                        chunk.id,
                        document_id,
                        e
                    );
                    continue;
                }
            };

            let metadata = serde_json::json!({
                "chunk_index": chunk.index,
                "document_name": document_name,
                "document_id": document_id,
                "token_count": chunk.token_count,
            });

            if let Err(e) = memory_service
                .upsert_knowledge_chunk_asset(
                    chunk.id.clone(),
                    document_id.clone(),
                    document_name.clone(),
                    chunk.content.clone(),
                    chunk.index,
                    chunk.token_count,
                    vector,
                    Some(metadata),
                )
                .await
            {
                log::warn!(
                    "embed_knowledge_chunks: failed to upsert chunk {} of {}: {}",
                    chunk.id,
                    document_id,
                    e
                );
            }
        }

        log::info!(
            "embed_knowledge_chunks: indexed {} chunks for document {}",
            chunks.len(),
            document_id
        );
    });
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
