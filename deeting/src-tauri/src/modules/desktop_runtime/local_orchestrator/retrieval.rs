#[cfg(test)]
use std::collections::HashMap;
use std::collections::HashSet;

use futures_util::future::BoxFuture;
use serde_json::{json, Value};

use super::workflow::{
    status_patch, ContextPatch, LocalStepResult, LocalWorkflowContext, LocalWorkflowStep,
    StepResult,
};
use crate::modules::desktop_runtime::context_orchestrator::{
    render_context_manifest_prompt, ContextManifest, SelectedKnowledgeManifestItem,
};
use crate::modules::desktop_runtime::runtime::{
    build_runtime_discovery_bundle_with_runtime_query_vector, should_run_semantic_recall,
};
#[cfg(test)]
use crate::modules::knowledge::types::{LocalKnowledgeChunk, LocalKnowledgeSearchHit};
#[cfg(test)]
use crate::modules::memory::types::LocalMemorySearchQuery;
use crate::modules::memory::types::{LocalMemoryItem, LocalMemoryListQuery};
#[cfg(test)]
use crate::modules::retrieval_kernel::ranking::reciprocal_rank_fusion;

pub(super) struct ContextManifestStep;

#[derive(Debug, Clone)]
pub(super) struct InjectedMemory {
    pub(super) content: String,
    pub(super) recall_when: Option<String>,
    pub(super) memory_tier: Option<String>,
    pub(super) is_core: bool,
    pub(super) is_boot: bool,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub(super) struct SelectedKnowledgeDocumentContext {
    pub(super) file_id: String,
    pub(super) file_name: String,
    #[allow(dead_code)]
    pub(super) overview: Option<String>,
    pub(super) leading_chunks: Vec<LocalKnowledgeChunk>,
}

pub(super) const CORE_MEMORY_LIST_LIMIT: i64 = 20;
#[cfg(test)]
pub(super) const SEMANTIC_MEMORY_SEARCH_LIMIT: usize = 5;

impl LocalWorkflowStep<LocalWorkflowContext> for ContextManifestStep {
    fn name(&self) -> &'static str {
        "context_manifest"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["persona_prompt_injection"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let latest_user_query = ctx.latest_user_query().unwrap_or_default().to_string();
            let selected_ids =
                normalize_selected_knowledge_file_ids(&ctx.selected_knowledge_file_ids);
            let semantic_enabled = should_run_semantic_recall(&latest_user_query);
            let (query_vector, request_query_patch) = if semantic_enabled {
                ctx.resolve_request_query_embedding().await
            } else {
                (None, None)
            };

            let core_memories_fut = load_core_memory_manifest_lines(ctx, &latest_user_query);
            let selected_knowledge_fut = load_selected_knowledge_manifest_items(ctx, &selected_ids);
            let runtime_discovery_fut =
                prefetch_runtime_discovery(ctx, &latest_user_query, query_vector);

            let (core_memories, selected_knowledge, runtime_discovery) = tokio::join!(
                core_memories_fut,
                selected_knowledge_fut,
                runtime_discovery_fut,
            );

            let core_memories = core_memories?;
            let manifest = ContextManifest::new(core_memories, selected_knowledge);
            let mut result = StepResult::success();
            if let Some(prompt) = render_context_manifest_prompt(&manifest) {
                result = result.with_system_message(prompt);
            }
            if let Some(patch) = request_query_patch {
                result = result.with_patch(patch);
            }
            if let Some(bundle) = runtime_discovery {
                result = result.with_patch(ContextPatch::SetRuntimeDiscovery(Some(bundle)));
            }
            Ok(result.with_patch(status_patch(
                "remember",
                Some("context_manifest"),
                "success",
                "context.manifest.loaded",
                Some(json!({
                    "core_memory_count": manifest.core_memories.len(),
                    "selected_knowledge_count": manifest.selected_knowledge.len(),
                    "available_sources": manifest
                        .available_sources
                        .iter()
                        .map(|source| source.as_str())
                        .collect::<Vec<_>>(),
                    "available_tools": manifest.available_tools,
                })),
            )))
        })
    }
}

impl InjectedMemory {
    pub(super) fn from_item(item: LocalMemoryItem) -> Self {
        let recall_when = memory_meta_string(&item.meta_info, "recall_when");
        let memory_tier = memory_meta_string(&item.meta_info, "memory_tier");
        let is_boot = memory_meta_bool(&item.meta_info, "is_boot");
        let is_core =
            memory_meta_bool(&item.meta_info, "is_core") || memory_tier.as_deref() == Some("core");
        Self {
            content: item.content,
            recall_when,
            memory_tier,
            is_core,
            is_boot,
        }
    }
}

fn memory_meta_string(meta_info: &Option<Value>, key: &str) -> Option<String> {
    meta_info
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn memory_meta_bool(meta_info: &Option<Value>, key: &str) -> bool {
    meta_info
        .as_ref()
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

pub(super) fn matches_recall_when(query: &str, recall_when: Option<&str>) -> bool {
    let hint = recall_when.unwrap_or("").trim().to_lowercase();
    if hint.is_empty() {
        return true;
    }
    let query_text = query.trim().to_lowercase();
    if query_text.is_empty() {
        return false;
    }
    if query_text.contains(&hint) || hint.contains(&query_text) {
        return true;
    }
    hint.replace([';', ',', '|'], " ")
        .split_whitespace()
        .filter(|token| token.len() > 1)
        .any(|token| query_text.contains(token))
}

#[cfg(test)]
pub(super) fn build_global_semantic_memory_search_query(query: &str) -> LocalMemorySearchQuery {
    LocalMemorySearchQuery {
        query: query.to_string(),
        limit: Some(SEMANTIC_MEMORY_SEARCH_LIMIT),
        session_id: None,
        capability_id: None,
        category: None,
        source: None,
        tags: None,
    }
}

pub(super) fn build_global_memory_list_query(limit: i64) -> LocalMemoryListQuery {
    LocalMemoryListQuery {
        cursor: None,
        limit: Some(limit),
        session_id: None,
        capability_id: None,
    }
}

#[cfg(test)]
pub(super) fn build_scoped_memory_list_query(
    session_id: &str,
    capability_id: Option<&str>,
    limit: i64,
) -> LocalMemoryListQuery {
    LocalMemoryListQuery {
        cursor: None,
        limit: Some(limit),
        session_id: Some(session_id.to_string()),
        capability_id: capability_id.map(str::to_string),
    }
}

async fn prefetch_runtime_discovery(
    ctx: &LocalWorkflowContext,
    latest_user_query: &str,
    query_vector: Option<Vec<f32>>,
) -> Option<mcp_runtime::policy::RuntimeDiscoveryBundle> {
    if latest_user_query.trim().is_empty() {
        return None;
    }

    Some(
        build_runtime_discovery_bundle_with_runtime_query_vector(
            ctx.app_state.mcp.store.as_ref(),
            &ctx.app_state.providers.embedding,
            ctx.app_state.memory.service.as_ref(),
            latest_user_query,
            query_vector,
            6,
        )
        .await,
    )
}

async fn load_core_memory_manifest_lines(
    ctx: &LocalWorkflowContext,
    latest_user_query: &str,
) -> Result<Vec<String>, String> {
    let global_memories = ctx
        .app_state
        .memory
        .service
        .list(build_global_memory_list_query(CORE_MEMORY_LIST_LIMIT))
        .await
        .map_err(|e| e.to_string())?;
    let global_items = global_memories
        .items
        .into_iter()
        .map(InjectedMemory::from_item)
        .collect::<Vec<_>>();

    Ok(collect_core_memories(&global_items, latest_user_query)
        .into_iter()
        .map(|memory| memory.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .collect())
}

async fn load_selected_knowledge_manifest_items(
    ctx: &LocalWorkflowContext,
    selected_ids: &[String],
) -> Vec<SelectedKnowledgeManifestItem> {
    let mut items = Vec::new();
    for file_id in selected_ids {
        let document = match ctx
            .app_state
            .knowledge
            .store
            .get_local_user_document(file_id)
            .await
        {
            Ok(value) => value,
            Err(err) => {
                log::warn!(
                    "context_manifest: failed to load selected knowledge document session={} file_id={} err={}",
                    ctx.session_id,
                    file_id,
                    err
                );
                continue;
            }
        };
        items.push(SelectedKnowledgeManifestItem {
            file_id: document.id,
            file_name: document.name,
            status: document.status,
            chunk_count: document.chunks,
            folder_id: document.folder_id,
            updated_at: Some(document.updated_at),
        });
    }
    items
}

fn collect_core_memories(items: &[InjectedMemory], query_text: &str) -> Vec<InjectedMemory> {
    let mut items = items
        .iter()
        .filter(|item| {
            if item.is_boot {
                return true;
            }
            if !(item.is_core || item.memory_tier.as_deref() == Some("core")) {
                return false;
            }
            matches_recall_when(query_text, item.recall_when.as_deref())
        })
        .cloned()
        .collect::<Vec<_>>();
    items.sort_by_key(|item| {
        (
            if item.is_boot { 0 } else { 1 },
            if item.is_core || item.memory_tier.as_deref() == Some("core") {
                0
            } else {
                1
            },
        )
    });
    items
}

#[cfg(test)]
pub(super) fn build_selected_knowledge_fallback_hits(
    document_contexts: &[SelectedKnowledgeDocumentContext],
    limit: usize,
) -> Vec<LocalKnowledgeSearchHit> {
    let mut hits = Vec::new();
    for context in document_contexts {
        for chunk in &context.leading_chunks {
            hits.push(LocalKnowledgeSearchHit {
                chunk_id: chunk.id.clone(),
                file_id: context.file_id.clone(),
                file_name: context.file_name.clone(),
                index: chunk.index,
                content: chunk.content.clone(),
                token_count: chunk.token_count,
                chunk_type: chunk.chunk_type.clone(),
                section_path: chunk.section_path.clone(),
                page_hint: chunk.page_hint,
                char_start: chunk.char_start,
                char_end: chunk.char_end,
                char_count: chunk.char_count,
                content_hash: chunk.content_hash.clone(),
                quality_flags: chunk.quality_flags.clone(),
                lexical_score: None,
                match_reasons: vec!["fallback:leading_chunk".to_string()],
                score_breakdown: Some(json!({
                    "lexical_score": null,
                    "fallback_used": true,
                })),
                score: 0.0,
            });
            if hits.len() >= limit {
                return hits;
            }
        }
    }
    hits
}

/// Reciprocal rank fusion of lexical (FTS5) and semantic (LanceDB) hits.
///
/// RRF is intentionally scale-invariant: FTS5's unbounded `bm25()` score
/// and LanceDB's [0,1] similarity fuse via rank alone, so we deliberately
/// skip per-source normalization before calling `reciprocal_rank_fusion`.
#[cfg(test)]
pub(super) fn fuse_selected_knowledge_hits(
    lexical_hits: Vec<LocalKnowledgeSearchHit>,
    semantic_hits: Vec<LocalKnowledgeSearchHit>,
    limit: usize,
) -> Vec<LocalKnowledgeSearchHit> {
    let mut combined_hits = HashMap::<String, LocalKnowledgeSearchHit>::new();
    let mut lexical_scores = HashMap::<String, f64>::new();
    let mut semantic_scores = HashMap::<String, f64>::new();

    for hit in lexical_hits {
        let key = hit.chunk_id.trim().to_string();
        if key.is_empty() {
            continue;
        }
        lexical_scores.insert(key.clone(), hit.score.max(0.0));
        combined_hits.entry(key).or_insert(hit);
    }

    for hit in semantic_hits {
        let key = hit.chunk_id.trim().to_string();
        if key.is_empty() {
            continue;
        }
        semantic_scores.insert(key.clone(), hit.score.max(0.0));
        combined_hits.entry(key).or_insert(hit);
    }

    if combined_hits.is_empty() {
        return Vec::new();
    }

    let fused_scores = reciprocal_rank_fusion(&[&lexical_scores, &semantic_scores]);
    let mut results = combined_hits
        .into_iter()
        .filter_map(|(key, mut hit)| {
            let score = fused_scores
                .get(&key)
                .copied()
                .or_else(|| lexical_scores.get(&key).copied())
                .or_else(|| semantic_scores.get(&key).copied())?;
            if score <= 0.0 {
                return None;
            }
            hit.score = score;
            Some(hit)
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.token_count.cmp(&left.token_count))
            .then_with(|| left.file_name.cmp(&right.file_name))
            .then_with(|| left.index.cmp(&right.index))
    });
    if results.len() > limit {
        results.truncate(limit);
    }
    results
}

#[cfg(test)]
pub(super) fn build_selected_document_overview(chunks: &[LocalKnowledgeChunk]) -> Option<String> {
    let section_hint = chunks.iter().find_map(|chunk| {
        let path = chunk
            .section_path
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        if path.is_empty() {
            None
        } else {
            Some(path.join(" > "))
        }
    });
    let preview = chunks
        .iter()
        .take(2)
        .map(|chunk| chunk.content.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let normalized = compact_knowledge_snippet(&preview, 220);
    if normalized.is_empty() {
        None
    } else if let Some(section_hint) = section_hint {
        Some(format!("{section_hint}: {normalized}"))
    } else {
        Some(normalized)
    }
}

fn normalize_selected_knowledge_file_ids(raw_values: &[String]) -> Vec<String> {
    let mut selected_ids = Vec::new();
    let mut selected_id_set = HashSet::new();
    for value in raw_values {
        let normalized = value.trim().to_string();
        if normalized.is_empty() || !selected_id_set.insert(normalized.clone()) {
            continue;
        }
        selected_ids.push(normalized);
    }
    selected_ids
}

#[cfg(test)]
fn compact_knowledge_snippet(content: &str, max_chars: usize) -> String {
    let normalized = content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if normalized.chars().count() <= max_chars {
        return normalized;
    }

    let compact = normalized.chars().take(max_chars).collect::<String>();
    format!("{}...", compact)
}
