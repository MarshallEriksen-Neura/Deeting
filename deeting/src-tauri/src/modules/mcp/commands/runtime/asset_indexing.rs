use super::super::{common_impl::to_string, support::*};

const LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT: &str = "local-embedding-rebuild-progress";

#[derive(Debug, Clone, Serialize)]
pub struct LocalEmbeddingRebuildProgress {
    pub phase: String,
    pub progress: i64,
    pub total: i64,
    pub processed: i64,
    pub indexed: i64,
    pub failed: i64,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalEmbeddingRebuildResponse {
    pub vector_dimension: i64,
    pub total: i64,
    pub indexed: i64,
    pub failed: i64,
    pub memory_total: i64,
    pub memory_indexed: i64,
    pub memory_failed: i64,
    pub asset_total: i64,
    pub asset_indexed: i64,
    pub asset_failed: i64,
}

fn emit_local_embedding_rebuild_progress(
    app: &AppHandle,
    phase: &str,
    total: usize,
    processed: usize,
    indexed: usize,
    failed: usize,
    current: Option<String>,
) {
    let progress = if total == 0 {
        100
    } else {
        ((processed.saturating_mul(100)) / total) as i64
    };
    let payload = LocalEmbeddingRebuildProgress {
        phase: phase.to_string(),
        progress,
        total: total as i64,
        processed: processed as i64,
        indexed: indexed as i64,
        failed: failed as i64,
        current,
    };
    let _ = app.emit(LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT, payload);
}

pub(crate) async fn rebuild_local_knowledge_vector_index(
    app_state: &AppState,
) -> Result<usize, String> {
    let files = app_state
        .mcp
        .store
        .list_local_user_documents(LocalUserDocumentListQuery {
            folder_id: None,
            status: None,
            q: None,
        })
        .await
        .map_err(to_string)?;
    let mut indexed = 0usize;
    for file in files {
        let text = format!(
            "name: {}\nstatus: {}\nsize: {}\nchunks: {}",
            file.name,
            file.status,
            file.size,
            file.chunks.unwrap_or(0)
        );
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .service
                .upsert_asset(
                    file.id,
                    file.name,
                    format!("local knowledge file ({})", file.file_type),
                    "knowledge_file".to_string(),
                    "local_knowledge".to_string(),
                    None,
                    vector,
                    None,
                )
                .await;
            indexed = indexed.saturating_add(1);
        }
    }
    Ok(indexed)
}

#[tauri::command]
pub async fn rebuild_local_embedding_assets(
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<LocalEmbeddingRebuildResponse, String> {
    emit_local_embedding_rebuild_progress(&app, "prepare", 0, 0, 0, 0, None);
    let probe_vector = app_state
        .providers
        .embedding
        .embed_text("local_embedding_rebuild_probe")
        .await
        .map_err(to_string)?;
    let vector_dimension = probe_vector.len();
    if vector_dimension == 0 {
        return Err("embedding model returned empty vector".to_string());
    }

    let memories = app_state
        .memory
        .store
        .list_all_memories()
        .await
        .map_err(to_string)?;
    app_state
        .memory
        .service
        .recreate_local_asset_table(vector_dimension as i32)
        .await
        .map_err(to_string)?;

    let tools = app_state.mcp.store.list_tools().await.map_err(to_string)?;
    let assistants = app_state
        .mcp
        .store
        .list_local_assistants()
        .await
        .map_err(to_string)?;
    let enabled_assistant_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let local_knowledge_files = app_state
        .mcp
        .store
        .list_local_user_documents(LocalUserDocumentListQuery {
            folder_id: None,
            status: None,
            q: None,
        })
        .await
        .map_err(to_string)?;

    let assistant_candidates = assistants
        .into_iter()
        .filter(|assistant| enabled_assistant_ids.contains(assistant.id.as_str()))
        .collect::<Vec<_>>();
    let memory_total = memories.len();
    let asset_total = tools.len() + assistant_candidates.len() + local_knowledge_files.len();
    let total = memory_total + asset_total;
    let (mut processed, mut indexed, mut failed) = (0usize, 0usize, 0usize);
    let (mut memory_indexed, mut memory_failed, mut asset_indexed, mut asset_failed) =
        (0usize, 0usize, 0usize, 0usize);

    let mut rebuilt_memories = Vec::with_capacity(memories.len());
    for memory in memories {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_memories",
            total,
            processed,
            indexed,
            failed,
            Some(memory.content.chars().take(48).collect()),
        );
        let embedding = match app_state
            .providers
            .embedding
            .embed_text(&memory.content)
            .await
        {
            Ok(vector) => {
                indexed += 1;
                memory_indexed += 1;
                Some(vector)
            }
            Err(error) => {
                log::warn!(
                    "memory rebuild embedding failed for {}: {}",
                    memory.id,
                    error
                );
                failed += 1;
                memory_failed += 1;
                None
            }
        };
        processed += 1;
        rebuilt_memories.push((memory, embedding));
    }

    app_state
        .memory
        .store
        .recreate_local_memory_table(vector_dimension as i32)
        .await
        .map_err(to_string)?;
    for (memory, embedding) in rebuilt_memories {
        let embedding_model = if embedding.is_some() {
            Some("rebuild".to_string())
        } else {
            None
        };
        app_state
            .memory
            .store
            .insert_memory_record(&memory, embedding, embedding_model)
            .await
            .map_err(to_string)?;
    }

    for tool in tools {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_tools",
            total,
            processed,
            indexed,
            failed,
            Some(tool.name.clone()),
        );
        let text = format!("name: {}\ndescription: {}", tool.name, tool.description);
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .service
                .upsert_asset(
                    tool.id,
                    tool.name,
                    tool.description,
                    "tool".to_string(),
                    "mcp".to_string(),
                    tool.identifier,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed += 1;
        if upserted {
            indexed += 1;
            asset_indexed += 1;
        } else {
            failed += 1;
            asset_failed += 1;
        }
    }

    for assistant in assistant_candidates {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_assistants",
            total,
            processed,
            indexed,
            failed,
            Some(assistant.name.clone()),
        );
        let tags = if assistant.tags.is_empty() {
            String::new()
        } else {
            assistant.tags.join(", ")
        };
        let text = format!(
            "name: {}\ndescription: {}\ntags: {}",
            assistant.name,
            assistant.description.as_deref().unwrap_or(""),
            tags
        );
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .service
                .upsert_asset(
                    assistant.id,
                    assistant.name,
                    assistant.description.unwrap_or_default(),
                    "assistant".to_string(),
                    "local_assistant".to_string(),
                    None,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed += 1;
        if upserted {
            indexed += 1;
            asset_indexed += 1;
        } else {
            failed += 1;
            asset_failed += 1;
        }
    }

    for file in local_knowledge_files {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_knowledge",
            total,
            processed,
            indexed,
            failed,
            Some(file.name.clone()),
        );
        let text = format!(
            "name: {}\nstatus: {}\nsize: {}\nchunks: {}",
            file.name,
            file.status,
            file.size,
            file.chunks.unwrap_or(0)
        );
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .store
                .upsert_asset(
                    file.id,
                    file.name,
                    format!("local knowledge file ({})", file.file_type),
                    "knowledge_file".to_string(),
                    "local_knowledge".to_string(),
                    None,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed += 1;
        if upserted {
            indexed += 1;
            asset_indexed += 1;
        } else {
            failed += 1;
            asset_failed += 1;
        }
    }

    emit_local_embedding_rebuild_progress(
        &app,
        "completed",
        total,
        processed,
        indexed,
        failed,
        None,
    );
    Ok(LocalEmbeddingRebuildResponse {
        vector_dimension: vector_dimension as i64,
        total: total as i64,
        indexed: indexed as i64,
        failed: failed as i64,
        memory_total: memory_total as i64,
        memory_indexed: memory_indexed as i64,
        memory_failed: memory_failed as i64,
        asset_total: asset_total as i64,
        asset_indexed: asset_indexed as i64,
        asset_failed: asset_failed as i64,
    })
}
