use tauri::State;

use crate::modules::memory::error::MemoryError;
use crate::modules::memory::types::{
    CreateLocalMemoryRequest, KnowledgeSearchResult, LocalMemoryClearRequest,
    LocalMemoryClearResponse, LocalMemoryDeleteResponse, LocalMemoryItem, LocalMemoryListQuery,
    LocalMemoryListResponse, LocalMemorySearchQuery, LocalMemorySearchResult, MemorySnapshot,
    UnifiedSearchResult, UnifiedSearchSource, WriteGuardResult,
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

#[tauri::command]
pub async fn search_knowledge_semantic(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<KnowledgeSearchResult>, String> {
    state
        .memory
        .service
        .search_knowledge(&query, limit.unwrap_or(10))
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn search_unified(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<UnifiedSearchResult>, String> {
    let k = limit.unwrap_or(10).clamp(1, 50);
    let service = &state.memory.service;
    let mcp_store = &state.mcp.store;

    // Run memory search, knowledge search, and summary search concurrently
    let memory_query = crate::modules::memory::types::LocalMemorySearchQuery {
        query: query.clone(),
        limit: Some(k),
        session_id: None,
        assistant_id: None,
    };

    let (memory_res, knowledge_res, summary_res) = tokio::join!(
        service.search(memory_query),
        service.search_knowledge(&query, k),
        search_summaries(&mcp_store.pool, &query, k),
    );

    let mut results = Vec::new();

    // Memory results (weight = 1.0)
    if let Ok(mem) = memory_res {
        for item in mem.items {
            results.push(UnifiedSearchResult {
                id: item.id,
                source: UnifiedSearchSource::Memory,
                content: item.content,
                score: item.score, // already vitality-reranked
                metadata: item.meta_info,
            });
        }
    }

    // Knowledge results (weight = 0.8)
    if let Ok(know) = knowledge_res {
        for item in know {
            results.push(UnifiedSearchResult {
                id: item.chunk_id,
                source: UnifiedSearchSource::Knowledge,
                content: item.content,
                score: item.score * 0.8,
                metadata: item.metadata,
            });
        }
    }

    // Summary results (weight = 0.6)
    if let Ok(sums) = summary_res {
        for (id, text, base_score) in sums {
            results.push(UnifiedSearchResult {
                id,
                source: UnifiedSearchSource::Summary,
                content: text,
                score: base_score * 0.6,
                metadata: None,
            });
        }
    }

    // Sort by weighted score descending, take top-K
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(k);

    Ok(results)
}

/// Simple keyword search on conversation_summary table.
/// Returns (id, summary_text, score) tuples.
async fn search_summaries(
    pool: &sqlx::SqlitePool,
    query: &str,
    limit: usize,
) -> Result<Vec<(String, String, f32)>, String> {
    // Tokenize query for LIKE matching
    let tokens: Vec<&str> = query.split_whitespace().filter(|t| t.len() >= 2).collect();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    // Build WHERE clause: each token must match via LIKE
    let mut conditions = Vec::new();
    let mut bindings = Vec::new();
    for token in &tokens {
        conditions.push("summary_text LIKE ?");
        bindings.push(format!("%{}%", token));
    }

    let sql = format!(
        "SELECT id, summary_text FROM conversation_summary WHERE {} ORDER BY created_at DESC LIMIT ?",
        conditions.join(" AND ")
    );

    let mut q = sqlx::query_as::<_, (String, String)>(&sql);
    for binding in &bindings {
        q = q.bind(binding);
    }
    q = q.bind(limit as i64);

    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    // Score: fraction of query tokens matched (simple relevance)
    let total_tokens = tokens.len() as f32;
    Ok(rows
        .into_iter()
        .map(|(id, text)| {
            let lower_text = text.to_lowercase();
            let matched = tokens
                .iter()
                .filter(|t| lower_text.contains(&t.to_lowercase()))
                .count() as f32;
            (id, text, matched / total_tokens)
        })
        .collect())
}
