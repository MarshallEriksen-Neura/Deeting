use std::collections::HashSet;

use log::warn;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

use super::types::{
    LocalKnowledgeFile, LocalUserDocumentChunkListQuery, LocalUserDocumentListQuery,
};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocalEmbeddingRebuildScope {
    All,
    Memory,
    Assets,
}

impl LocalEmbeddingRebuildScope {
    fn parse(raw: Option<&str>) -> Result<Self, String> {
        let normalized = raw
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("all")
            .to_ascii_lowercase();

        match normalized.as_str() {
            "all" => Ok(Self::All),
            "memory" => Ok(Self::Memory),
            "assets" => Ok(Self::Assets),
            _ => Err(format!(
                "unsupported embedding rebuild scope: {} (expected all|memory|assets)",
                normalized
            )),
        }
    }

    fn rebuilds_memory(self) -> bool {
        matches!(self, Self::All | Self::Memory)
    }

    fn rebuilds_assets(self) -> bool {
        matches!(self, Self::All | Self::Assets)
    }
}

fn to_string(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn is_indexed_local_knowledge_file(file: &LocalKnowledgeFile) -> bool {
    matches!(
        file.status.trim().to_ascii_lowercase().as_str(),
        "active" | "indexed"
    )
}

async fn list_all_local_user_document_chunks(
    app_state: &AppState,
    file_id: &str,
) -> Result<Vec<super::types::LocalKnowledgeChunk>, String> {
    let mut items = Vec::new();
    let mut offset = 0_i64;

    loop {
        let response = app_state
            .knowledge
            .store
            .list_local_user_document_chunks(
                file_id,
                LocalUserDocumentChunkListQuery {
                    offset: Some(offset),
                    limit: Some(100),
                },
            )
            .await
            .map_err(to_string)?;

        if response.items.is_empty() {
            break;
        }

        let batch_len = response.items.len() as i64;
        items.extend(response.items);
        offset += batch_len;

        if offset >= response.total || batch_len < response.limit {
            break;
        }
    }

    Ok(items)
}

async fn rebuild_local_knowledge_chunks_for_file(
    app_state: &AppState,
    file: &LocalKnowledgeFile,
) -> Result<bool, String> {
    if !is_indexed_local_knowledge_file(file) {
        return Ok(true);
    }

    let chunks = list_all_local_user_document_chunks(app_state, &file.id).await?;
    if chunks.is_empty() {
        return Ok(false);
    }

    app_state
        .memory
        .service
        .delete_knowledge_chunk_assets_by_document_id(&file.id)
        .await
        .map_err(to_string)?;

    let mut success = true;
    for chunk in chunks {
        let vector = match app_state
            .providers
            .embedding
            .embed_text(&chunk.content)
            .await
        {
            Ok(vector) => vector,
            Err(error) => {
                warn!(
                    "knowledge rebuild embedding failed for chunk {} of {}: {}",
                    chunk.id, file.id, error
                );
                success = false;
                continue;
            }
        };

        if let Err(error) = app_state
            .memory
            .service
            .upsert_knowledge_chunk_asset(
                chunk.id,
                file.id.clone(),
                file.name.clone(),
                chunk.content,
                chunk.index,
                chunk.token_count,
                vector,
                None,
            )
            .await
        {
            warn!(
                "knowledge rebuild upsert failed for document {}: {}",
                file.id, error
            );
            success = false;
        }
    }

    Ok(success)
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
        .knowledge
        .store
        .list_local_user_documents(LocalUserDocumentListQuery {
            folder_id: None,
            status: None,
            q: None,
        })
        .await
        .map_err(to_string)?;
    let probe_vector = app_state
        .providers
        .embedding
        .embed_text("local_knowledge_vector_rebuild_probe")
        .await
        .map_err(to_string)?;
    let vector_dimension = probe_vector.len();
    if vector_dimension == 0 {
        return Err("embedding model returned empty vector".to_string());
    }
    app_state
        .memory
        .service
        .recreate_knowledge_chunk_table(vector_dimension as i32)
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
        let summary_indexed =
            if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
                app_state
                    .memory
                    .service
                    .upsert_asset(
                        file.id.clone(),
                        file.name.clone(),
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
        let chunk_indexed = rebuild_local_knowledge_chunks_for_file(app_state, &file).await?;
        if summary_indexed && chunk_indexed {
            indexed = indexed.saturating_add(1);
        }
    }
    Ok(indexed)
}

#[tauri::command]
pub async fn rebuild_local_embedding_assets(
    app: AppHandle,
    app_state: State<'_, AppState>,
    scope: Option<String>,
) -> Result<LocalEmbeddingRebuildResponse, String> {
    emit_local_embedding_rebuild_progress(&app, "prepare", 0, 0, 0, 0, None);
    let rebuild_scope = LocalEmbeddingRebuildScope::parse(scope.as_deref())?;
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

    let memories = if rebuild_scope.rebuilds_memory() {
        app_state
            .memory
            .store
            .list_all_memories()
            .await
            .map_err(to_string)?
    } else {
        Vec::new()
    };

    let (tools, assistant_candidates, local_knowledge_files) = if rebuild_scope.rebuilds_assets() {
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
            .knowledge
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
        (tools, assistant_candidates, local_knowledge_files)
    } else {
        (Vec::new(), Vec::new(), Vec::new())
    };

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
                warn!(
                    "memory rebuild embedding failed for {}: {}",
                    memory.id, error
                );
                failed += 1;
                memory_failed += 1;
                None
            }
        };
        processed += 1;
        rebuilt_memories.push((memory, embedding));
    }

    if rebuild_scope.rebuilds_memory() {
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
    }

    if rebuild_scope.rebuilds_assets() {
        app_state
            .memory
            .service
            .recreate_local_asset_table(vector_dimension as i32)
            .await
            .map_err(to_string)?;
        app_state
            .memory
            .service
            .recreate_knowledge_chunk_table(vector_dimension as i32)
            .await
            .map_err(to_string)?;

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
            let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await
            {
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
            let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await
            {
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
            let summary_upserted =
                if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
                    app_state
                        .memory
                        .store
                        .upsert_asset(
                            file.id.clone(),
                            file.name.clone(),
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
            let chunk_upserted = rebuild_local_knowledge_chunks_for_file(app_state.inner(), &file)
                .await
                .unwrap_or(false);
            let upserted = summary_upserted && chunk_upserted;
            processed += 1;
            if upserted {
                indexed += 1;
                asset_indexed += 1;
            } else {
                failed += 1;
                asset_failed += 1;
            }
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
