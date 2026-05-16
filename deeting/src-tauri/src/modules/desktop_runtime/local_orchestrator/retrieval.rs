use std::collections::{HashMap, HashSet};

use futures_util::future::BoxFuture;
use serde_json::{json, Value};

use super::workflow::{
    status_patch, ContextPatch, LocalStepResult, LocalWorkflowContext, LocalWorkflowStep,
    StepResult,
};
use crate::modules::desktop_runtime::runtime::{
    build_runtime_discovery_bundle_with_runtime_query_vector, should_run_semantic_recall,
};
use crate::modules::knowledge::types::{
    LocalKnowledgeChunk, LocalKnowledgeSearchHit, LocalUserDocumentChunkListQuery,
};
use crate::modules::memory::types::{
    KnowledgeSearchResult, LocalMemoryItem, LocalMemoryListQuery, LocalMemorySearchItem,
    LocalMemorySearchQuery,
};
use crate::modules::retrieval_kernel::ranking::reciprocal_rank_fusion;

pub(super) struct ContextRetrievalPrefetchStep;
pub(super) struct SemanticMemoryInjectionStep;
pub(super) struct SelectedKnowledgeInjectionStep;

#[derive(Debug, Clone, Default)]
pub(super) struct PrefetchedRetrievals {
    pub(super) semantic_memory: Option<SemanticMemoryPrefetchResult>,
    pub(super) selected_knowledge: Option<SelectedKnowledgePrefetchResult>,
}

#[derive(Debug, Clone)]
pub(super) struct SemanticMemoryPrefetchResult {
    sections: Vec<String>,
    total_count: usize,
    pub(super) explore_arm_id: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct SelectedKnowledgePrefetchResult {
    system_message: Option<String>,
    status_meta: Value,
}

#[derive(Debug, Clone)]
pub(super) struct InjectedMemory {
    pub(super) id: String,
    pub(super) content: String,
    pub(super) recall_when: Option<String>,
    pub(super) memory_tier: Option<String>,
    pub(super) is_core: bool,
    pub(super) is_boot: bool,
}

#[derive(Debug, Clone)]
pub(super) struct SelectedKnowledgeDocumentContext {
    pub(super) file_id: String,
    pub(super) file_name: String,
    pub(super) overview: Option<String>,
    pub(super) leading_chunks: Vec<LocalKnowledgeChunk>,
}

pub(super) const CORE_MEMORY_LIST_LIMIT: i64 = 20;
const FALLBACK_MEMORY_GLOBAL_PREFETCH_LIMIT: i64 = CORE_MEMORY_LIST_LIMIT;
const FALLBACK_MEMORY_LIST_LIMIT: usize = 5;
pub(super) const SEMANTIC_MEMORY_SEARCH_LIMIT: usize = 5;
const SELECTED_KNOWLEDGE_CANDIDATE_LIMIT: usize = 8;
const SELECTED_KNOWLEDGE_RESULT_LIMIT: usize = 4;

impl LocalWorkflowStep<LocalWorkflowContext> for ContextRetrievalPrefetchStep {
    fn name(&self) -> &'static str {
        "context_retrieval_prefetch"
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
            let knowledge_query = normalize_knowledge_search_query(&latest_user_query);
            let semantic_enabled = should_run_semantic_recall(&latest_user_query);
            let (query_vector, request_query_patch) = if semantic_enabled {
                ctx.resolve_request_query_embedding().await
            } else {
                (None, None)
            };

            let semantic_memory_fut =
                prefetch_semantic_memory(ctx, &latest_user_query, query_vector.clone());
            let selected_knowledge_fut = prefetch_selected_knowledge(
                ctx,
                &selected_ids,
                knowledge_query.as_deref(),
                query_vector.clone(),
            );
            let runtime_discovery_fut =
                prefetch_runtime_discovery(ctx, &latest_user_query, query_vector);

            let (semantic_memory, selected_knowledge, runtime_discovery) = tokio::join!(
                semantic_memory_fut,
                selected_knowledge_fut,
                runtime_discovery_fut,
            );

            let mut result = StepResult::success();
            if let Some(patch) = request_query_patch {
                result = result.with_patch(patch);
            }
            result = result.with_patch(ContextPatch::SetPrefetchedRetrievals(
                PrefetchedRetrievals {
                    semantic_memory: Some(semantic_memory?),
                    selected_knowledge,
                },
            ));
            if let Some(bundle) = runtime_discovery {
                result = result.with_patch(ContextPatch::SetRuntimeDiscovery(Some(bundle)));
            }
            Ok(result)
        })
    }
}

impl LocalWorkflowStep<LocalWorkflowContext> for SemanticMemoryInjectionStep {
    fn name(&self) -> &'static str {
        "semantic_memory_injection"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["context_retrieval_prefetch"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let Some(result) = ctx.prefetched_retrievals.semantic_memory.clone() else {
                return Ok(StepResult::skipped());
            };

            let mut step_result = StepResult::success();
            for section in result.sections {
                step_result = step_result.with_system_message(section);
            }
            Ok(step_result.with_patch(status_patch(
                "remember",
                Some("semantic_memory_injection"),
                "success",
                "semantic.memory.loaded",
                Some(json!({ "count": result.total_count })),
            )))
        })
    }
}

impl LocalWorkflowStep<LocalWorkflowContext> for SelectedKnowledgeInjectionStep {
    fn name(&self) -> &'static str {
        "selected_knowledge_injection"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["context_retrieval_prefetch"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut LocalWorkflowContext,
    ) -> BoxFuture<'a, Result<LocalStepResult, String>> {
        Box::pin(async move {
            let Some(result) = ctx.prefetched_retrievals.selected_knowledge.clone() else {
                return Ok(StepResult::skipped());
            };

            let mut step_result = StepResult::success();
            if let Some(system_message) = result.system_message {
                step_result = step_result.with_system_message(system_message);
            }
            Ok(step_result.with_patch(status_patch(
                "remember",
                Some("selected_knowledge_injection"),
                "success",
                "knowledge.context.loaded",
                Some(result.status_meta),
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
            id: item.id,
            content: item.content,
            recall_when,
            memory_tier,
            is_core,
            is_boot,
        }
    }

    fn from_search_item(item: LocalMemorySearchItem) -> Self {
        let recall_when = memory_meta_string(&item.meta_info, "recall_when");
        let memory_tier = memory_meta_string(&item.meta_info, "memory_tier");
        let is_boot = memory_meta_bool(&item.meta_info, "is_boot");
        let is_core =
            memory_meta_bool(&item.meta_info, "is_core") || memory_tier.as_deref() == Some("core");
        Self {
            id: item.id,
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

async fn prefetch_semantic_memory(
    ctx: &LocalWorkflowContext,
    latest_user_query: &str,
    query_vector: Option<Vec<f32>>,
) -> Result<SemanticMemoryPrefetchResult, String> {
    let global_memories = ctx
        .app_state
        .memory
        .service
        .list(build_global_memory_list_query(
            FALLBACK_MEMORY_GLOBAL_PREFETCH_LIMIT,
        ))
        .await
        .map_err(|e| e.to_string())?;
    let global_items = global_memories
        .items
        .into_iter()
        .map(InjectedMemory::from_item)
        .collect::<Vec<_>>();
    let core_memories = collect_core_memories(&global_items, latest_user_query);
    let mut explore_arm_id: Option<String> = None;
    let semantic_memories = match query_vector {
        Some(vector) => {
            let search_query = build_global_semantic_memory_search_query(latest_user_query);
            match ctx
                .app_state
                .memory
                .service
                .search_with_query_vector(search_query, vector)
                .await
            {
                Ok(result) if !result.items.is_empty() => {
                    explore_arm_id = result.explore_arm_id.clone();
                    result
                        .items
                        .into_iter()
                        .map(InjectedMemory::from_search_item)
                        .collect()
                }
                Ok(_) | Err(_) => fallback_list(ctx, &global_items).await?,
            }
        }
        None => fallback_list(ctx, &global_items).await?,
    };

    let mut seen = HashSet::new();
    let mut sections = Vec::new();
    let mut core_lines = Vec::new();
    let mut semantic_lines = Vec::new();

    for memory in core_memories {
        if !seen.insert(memory.id.clone()) {
            continue;
        }
        let text = memory.content.trim();
        if text.is_empty() {
            continue;
        }
        core_lines.push(format!("- {}", text));
    }

    for memory in semantic_memories {
        if !seen.insert(memory.id.clone()) {
            continue;
        }
        let text = memory.content.trim();
        if text.is_empty() {
            continue;
        }
        semantic_lines.push(format!("- {}", text));
    }

    if !core_lines.is_empty() {
        sections.push(format!("## Core Memories\n{}", core_lines.join("\n")));
    }
    if !semantic_lines.is_empty() {
        sections.push(format!(
            "## Semantic Memories\n{}",
            semantic_lines.join("\n")
        ));
    }

    Ok(SemanticMemoryPrefetchResult {
        total_count: core_lines.len() + semantic_lines.len(),
        sections,
        explore_arm_id,
    })
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

async fn fallback_list(
    ctx: &LocalWorkflowContext,
    global_items: &[InjectedMemory],
) -> Result<Vec<InjectedMemory>, String> {
    let scoped_query = build_scoped_memory_list_query(
        &ctx.session_id,
        ctx.capability_id.as_deref(),
        FALLBACK_MEMORY_LIST_LIMIT as i64,
    );
    let scoped_memories = ctx
        .app_state
        .memory
        .service
        .list(scoped_query)
        .await
        .map_err(|e| e.to_string())?;
    let scoped_items = scoped_memories
        .items
        .into_iter()
        .map(InjectedMemory::from_item)
        .collect::<Vec<_>>();
    if !scoped_items.is_empty() {
        return Ok(scoped_items);
    }

    Ok(global_items
        .iter()
        .take(FALLBACK_MEMORY_LIST_LIMIT)
        .cloned()
        .collect())
}

async fn prefetch_selected_knowledge(
    ctx: &LocalWorkflowContext,
    selected_ids: &[String],
    knowledge_query: Option<&str>,
    query_vector: Option<Vec<f32>>,
) -> Option<SelectedKnowledgePrefetchResult> {
    if selected_ids.is_empty() {
        return None;
    }

    let query = knowledge_query.unwrap_or_default();
    if query.is_empty() {
        return Some(SelectedKnowledgePrefetchResult {
            system_message: None,
            status_meta: json!({
                "selected_files": selected_ids.len(),
                "count": 0,
                "query_empty": true,
            }),
        });
    }

    let document_contexts = load_selected_knowledge_document_contexts(ctx, selected_ids, 3).await;
    let mut lexical_search_failed = false;
    let mut semantic_search_failed = false;
    let lexical_hits_fut = ctx
        .app_state
        .knowledge
        .store
        .search_local_knowledge_chunks_in_documents(
            query,
            selected_ids,
            Some(SELECTED_KNOWLEDGE_CANDIDATE_LIMIT as i64),
        );
    let semantic_hits_fut = async {
        let Some(vector) = query_vector else {
            return Ok(Vec::new());
        };
        ctx.app_state
            .memory
            .service
            .search_knowledge_with_query_vector_in_documents(
                vector,
                selected_ids,
                SELECTED_KNOWLEDGE_CANDIDATE_LIMIT,
            )
            .await
    };
    let (lexical_hits, semantic_hits) = tokio::join!(lexical_hits_fut, semantic_hits_fut);
    let lexical_hits = match lexical_hits {
        Ok(value) => value
            .into_iter()
            .filter(|hit| !looks_like_docx_field_artifact(&hit.content))
            .collect::<Vec<_>>(),
        Err(err) => {
            lexical_search_failed = true;
            log::warn!(
                "selected_knowledge_injection: lexical search failed session={} err={}",
                ctx.session_id,
                err
            );
            Vec::new()
        }
    };
    let semantic_hits = match semantic_hits {
        Ok(value) => value
            .into_iter()
            .filter_map(local_knowledge_search_hit_from_semantic_result)
            .filter(|hit| !looks_like_docx_field_artifact(&hit.content))
            .collect::<Vec<_>>(),
        Err(err) => {
            semantic_search_failed = true;
            log::warn!(
                "selected_knowledge_injection: semantic search failed session={} err={}",
                ctx.session_id,
                err
            );
            Vec::new()
        }
    };
    let mut selected_hits =
        fuse_selected_knowledge_hits(lexical_hits, semantic_hits, SELECTED_KNOWLEDGE_RESULT_LIMIT);

    let mut fallback_used = false;
    if selected_hits.is_empty() {
        fallback_used = true;
        selected_hits = build_selected_knowledge_fallback_hits(
            &document_contexts,
            SELECTED_KNOWLEDGE_RESULT_LIMIT,
        );
    }
    selected_hits = expand_selected_knowledge_hit_windows(ctx, &selected_hits, 1).await;
    let window_expanded_count = selected_hits
        .iter()
        .filter(|hit| hit.match_reasons.iter().any(|reason| reason == "window:+1"))
        .count();

    let overview_lines = document_contexts
        .iter()
        .filter_map(|context| {
            context
                .overview
                .as_ref()
                .map(|overview| format!("- [{}] {}", context.file_name, overview))
        })
        .collect::<Vec<_>>();
    let excerpt_lines = selected_hits
        .iter()
        .map(|hit| {
            let snippet = compact_knowledge_snippet(&hit.content, 260);
            let section_suffix = format_selected_hit_section_path(&hit.section_path);
            let explain_suffix = format_selected_hit_explain(hit);
            format!(
                "- [{}{} #{}{}] {}",
                hit.file_name,
                section_suffix,
                hit.index + 1,
                explain_suffix,
                snippet
            )
        })
        .collect::<Vec<_>>();
    let explain_items = selected_hits
        .iter()
        .map(|hit| {
            json!({
                "chunk_id": hit.chunk_id,
                "file_id": hit.file_id,
                "file_name": hit.file_name,
                "index": hit.index,
                "score": hit.score,
                "lexical_score": hit.lexical_score,
                "match_reasons": hit.match_reasons,
                "score_breakdown": hit.score_breakdown,
                "section_path": hit.section_path,
                "chunk_type": hit.chunk_type,
                "quality_flags": hit.quality_flags,
            })
        })
        .collect::<Vec<_>>();

    let system_message = if overview_lines.is_empty() && excerpt_lines.is_empty() {
        None
    } else {
        let mut sections = Vec::new();
        if !overview_lines.is_empty() {
            sections.push(format!(
                "## Selected Document Overviews\nThese are the user-selected local documents for this turn:\n{}",
                overview_lines.join("\n")
            ));
        }
        if !excerpt_lines.is_empty() {
            sections.push(format!(
                "## Selected Document Excerpts\nUse the following excerpts from the user-selected local documents when they are relevant:\n{}",
                excerpt_lines.join("\n")
            ));
        }
        Some(sections.join("\n\n"))
    };

    Some(SelectedKnowledgePrefetchResult {
        system_message,
        status_meta: json!({
            "selected_files": selected_ids.len(),
            "count": excerpt_lines.len(),
            "overview_count": overview_lines.len(),
            "fallback_used": fallback_used,
            "window_expanded_count": window_expanded_count,
            "search_error": lexical_search_failed || semantic_search_failed,
            "lexical_error": lexical_search_failed,
            "semantic_error": semantic_search_failed,
            "explain": explain_items,
        }),
    })
}

async fn load_selected_knowledge_document_contexts(
    ctx: &LocalWorkflowContext,
    selected_ids: &[String],
    leading_chunk_limit: usize,
) -> Vec<SelectedKnowledgeDocumentContext> {
    let mut contexts = Vec::new();
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
                    "selected_knowledge_injection: failed to load document session={} file_id={} err={}",
                    ctx.session_id,
                    file_id,
                    err
                );
                continue;
            }
        };
        let chunk_list = match ctx
            .app_state
            .knowledge
            .store
            .list_local_user_document_chunks(
                file_id,
                LocalUserDocumentChunkListQuery {
                    offset: Some(0),
                    limit: Some(leading_chunk_limit as i64),
                },
            )
            .await
        {
            Ok(value) => value,
            Err(err) => {
                log::warn!(
                    "selected_knowledge_injection: chunk fallback failed session={} file_id={} err={}",
                    ctx.session_id,
                    file_id,
                    err
                );
                continue;
            }
        };
        let leading_chunks = chunk_list
            .items
            .into_iter()
            .filter(|chunk| !looks_like_docx_field_artifact(&chunk.content))
            .collect::<Vec<_>>();
        contexts.push(SelectedKnowledgeDocumentContext {
            file_id: document.id,
            file_name: document.name,
            overview: build_selected_document_overview(&leading_chunks),
            leading_chunks,
        });
    }
    contexts
}

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

fn local_knowledge_search_hit_from_semantic_result(
    result: KnowledgeSearchResult,
) -> Option<LocalKnowledgeSearchHit> {
    let file_id = result
        .document_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let file_name = result
        .document_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| file_id.clone());
    let chunk_id = result.chunk_id.trim().to_string();
    let content = result.content.trim().to_string();
    if chunk_id.is_empty() || content.is_empty() {
        return None;
    }

    let token_count = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("token_count"))
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let chunk_type = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("chunk_type"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "paragraph".to_string());
    let section_path = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("section_path"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let page_hint = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("page_hint"))
        .and_then(Value::as_i64);
    let char_start = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("char_start"))
        .and_then(Value::as_i64);
    let char_end = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("char_end"))
        .and_then(Value::as_i64);
    let char_count = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("char_count"))
        .and_then(Value::as_i64)
        .unwrap_or(content.chars().count() as i64)
        .max(0);
    let content_hash = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("content_hash"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let quality_flags = result
        .metadata
        .as_ref()
        .and_then(|value| value.get("quality_flags"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Some(LocalKnowledgeSearchHit {
        chunk_id,
        file_id,
        file_name,
        index: result.chunk_index.unwrap_or(0).max(0),
        content,
        token_count,
        chunk_type,
        section_path,
        page_hint,
        char_start,
        char_end,
        char_count,
        content_hash,
        quality_flags,
        lexical_score: None,
        match_reasons: vec!["semantic:topk".to_string()],
        score_breakdown: Some(json!({
            "semantic_score": (result.score as f64).max(0.0),
        })),
        score: (result.score as f64).max(0.0),
    })
}

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

fn format_selected_hit_section_path(section_path: &[String]) -> String {
    let normalized = section_path
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        String::new()
    } else {
        format!(" :: {}", normalized.join(" > "))
    }
}

fn format_selected_hit_explain(hit: &LocalKnowledgeSearchHit) -> String {
    let reasons = hit
        .match_reasons
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if reasons.is_empty() {
        String::new()
    } else {
        format!(" | {}", reasons.join(","))
    }
}

async fn expand_selected_knowledge_hit_windows(
    ctx: &LocalWorkflowContext,
    hits: &[LocalKnowledgeSearchHit],
    radius: i64,
) -> Vec<LocalKnowledgeSearchHit> {
    let mut expanded_hits = Vec::with_capacity(hits.len());
    for hit in hits {
        let offset = hit.index.saturating_sub(radius).max(0);
        let limit = radius.saturating_mul(2).saturating_add(1).max(1);
        let response = ctx
            .app_state
            .knowledge
            .store
            .list_local_user_document_chunks(
                &hit.file_id,
                LocalUserDocumentChunkListQuery {
                    offset: Some(offset),
                    limit: Some(limit),
                },
            )
            .await;
        let Ok(response) = response else {
            expanded_hits.push(hit.clone());
            continue;
        };
        let window_chunks = response
            .items
            .into_iter()
            .filter(|chunk| !looks_like_docx_field_artifact(&chunk.content))
            .collect::<Vec<_>>();
        if window_chunks.is_empty() {
            expanded_hits.push(hit.clone());
            continue;
        }

        let expanded_content = window_chunks
            .iter()
            .map(|chunk| chunk.content.trim())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        if expanded_content.is_empty() || expanded_content == hit.content {
            expanded_hits.push(hit.clone());
            continue;
        }

        let mut expanded_hit = hit.clone();
        expanded_hit.content = expanded_content;
        if !expanded_hit
            .match_reasons
            .iter()
            .any(|reason| reason == "window:+1")
        {
            expanded_hit.match_reasons.push("window:+1".to_string());
        }
        expanded_hits.push(expanded_hit);
    }
    expanded_hits
}

fn looks_like_docx_field_artifact(content: &str) -> bool {
    let normalized = content.replace('\r', "").replace('\n', " ");
    let compact = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = compact.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.eq_ignore_ascii_case("\\h") {
        return true;
    }
    if trimmed.starts_with("\\h ") {
        return true;
    }
    if trimmed.starts_with("HYPERLINK \\l ") {
        return true;
    }
    if trimmed.contains("PAGEREF _Toc") {
        return true;
    }
    if trimmed.starts_with("TOC \\") {
        return true;
    }
    false
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

fn normalize_knowledge_search_query(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.starts_with('[') {
        return Some(trimmed.to_string());
    }

    let parsed = serde_json::from_str::<Value>(trimmed).ok()?;
    let blocks = parsed.as_array()?;
    let mut text_parts = Vec::new();
    for block in blocks {
        let Some(block_type) = block.get("type").and_then(Value::as_str) else {
            continue;
        };
        if block_type != "text" {
            continue;
        }
        let text = block
            .get("text")
            .and_then(Value::as_str)
            .or_else(|| block.get("content").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(value) = text {
            text_parts.push(value.to_string());
        }
    }
    if text_parts.is_empty() {
        return Some(trimmed.to_string());
    }
    Some(text_parts.join("\n"))
}

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
