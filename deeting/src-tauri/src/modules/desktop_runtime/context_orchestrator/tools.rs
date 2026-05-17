use futures_util::future::join_all;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::modules::desktop_runtime::context_orchestrator::adapters::knowledge::KnowledgeContextAdapter;
use crate::modules::desktop_runtime::context_orchestrator::adapters::llm_wiki::LlmWikiContextAdapter;
use crate::modules::desktop_runtime::context_orchestrator::adapters::memory::MemoryContextAdapter;
use crate::modules::desktop_runtime::context_orchestrator::adapters::ContextSourceAdapter;
use crate::modules::desktop_runtime::context_orchestrator::envelope::{
    ContextConfidence, ContextCoverageSignals, ContextEvidenceEnvelope, ContextEvidenceItem,
    ContextNextAction, ContextSourceRef, ContextSourceType,
};
use crate::modules::desktop_runtime::context_orchestrator::fsm::CONTEXT_TOOL_NAMES;
use crate::modules::desktop_runtime::context_orchestrator::fusion::{rrf_fuse, DEFAULT_RRF_K};
use crate::modules::desktop_runtime::context_orchestrator::trace::ContextTrace;
use crate::modules::knowledge::types::{
    LocalKnowledgeChunk, LocalKnowledgeFile, LocalKnowledgeSearchHit,
    LocalUserDocumentChunkListQuery,
};
use crate::modules::llm_wiki::service::{
    open_local_llm_wiki_corpus_chunks, search_local_llm_wiki_corpus,
};
use crate::modules::llm_wiki::types::{
    LocalLlmWikiCorpusSearchHit, SearchLocalLlmWikiCorpusRequest,
};
use crate::modules::memory::types::{
    LocalMemoryItem, LocalMemorySearchItem, LocalMemorySearchQuery,
};
use crate::state::AppState;

pub fn is_context_tool(tool_name: &str) -> bool {
    CONTEXT_TOOL_NAMES
        .iter()
        .any(|candidate| *candidate == tool_name)
}

pub async fn execute_context_tool(
    app_state: &AppState,
    tool_name: &str,
    arguments: &Value,
    context_selected_file_ids: &[String],
) -> Result<Value, String> {
    match tool_name {
        "context_search" => {
            execute_context_search(app_state, arguments, context_selected_file_ids).await
        }
        "context_search_multi" => {
            execute_context_search_multi(app_state, arguments, context_selected_file_ids).await
        }
        "context_open" => execute_context_open(app_state, arguments).await,
        "context_expand" => execute_context_expand(app_state, arguments).await,
        "context_summarize_evidence" => execute_context_summarize_evidence(arguments),
        _ => Err(format!("unsupported context tool '{tool_name}'")),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContextSourceRequest {
    Auto,
    Source(ContextSourceType),
}

#[derive(Debug, Deserialize)]
struct ContextSearchArgs {
    #[serde(default)]
    source: Option<String>,
    query: String,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    include_neighbors: Option<bool>,
    #[serde(default)]
    filters: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ContextSearchMultiArgs {
    /// Required: which single source to fan out across. `auto` is rejected
    /// because RRF fusion is intra-source only — mixing memory/wiki/knowledge
    /// scores would violate the No Double Lifecycle Rule.
    source: String,
    /// 2-5 semantically distinct rewrites of the same intent.
    queries: Vec<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    filters: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ContextOpenArgs {
    #[serde(default)]
    source_type: Option<String>,
    #[serde(default)]
    source: Option<String>,
    id: String,
    #[serde(default)]
    window: Option<i64>,
    #[serde(default)]
    file_id: Option<String>,
    #[serde(default)]
    doc_id: Option<String>,
    #[serde(default)]
    chunk_index: Option<i64>,
}

#[derive(Debug, Clone, Default)]
struct MemoryContextSearchFilters {
    session_id: Option<String>,
    capability_id: Option<String>,
    category: Option<String>,
    source: Option<String>,
    tags: Option<Vec<String>>,
}

impl MemoryContextSearchFilters {
    fn as_trace_value(&self) -> Value {
        json!({
            "session_id": self.session_id,
            "capability_id": self.capability_id,
            "category": self.category,
            "source": self.source,
            "tags": self.tags,
        })
    }
}

#[derive(Debug, Clone, Default)]
struct LlmWikiContextSearchFilters {
    scope: Option<String>,
    doc_id: Option<String>,
    relative_path: Option<String>,
    relative_path_prefix: Option<String>,
}

impl LlmWikiContextSearchFilters {
    fn as_trace_value(&self) -> Value {
        json!({
            "scope": self.scope,
            "doc_id": self.doc_id,
            "relative_path": self.relative_path,
            "relative_path_prefix": self.relative_path_prefix,
        })
    }
}

async fn execute_context_search(
    app_state: &AppState,
    arguments: &Value,
    context_selected_file_ids: &[String],
) -> Result<Value, String> {
    let args: ContextSearchArgs =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;
    let query = args.query.trim().to_string();
    if query.is_empty() {
        return Err("context_search requires a non-empty query".to_string());
    }
    let limit = args.limit.unwrap_or(6).clamp(1, 12);
    let source_request = parse_source_request(args.source.as_deref())?;
    let scope = args.scope.as_deref().unwrap_or("all");
    let include_neighbors = args.include_neighbors.unwrap_or(false);

    match source_request {
        ContextSourceRequest::Source(source_type) => {
            let envelope = search_source(
                app_state,
                source_type,
                &query,
                scope,
                limit,
                args.filters.as_ref(),
                context_selected_file_ids,
            )
            .await?;
            let value = envelope_value(envelope)?;
            Ok(json!({
                "format_version": "context_evidence.v1",
                "tool": "context_search",
                "source": source_type.as_str(),
                "query": query,
                "include_neighbors": include_neighbors,
                "envelope": value,
            }))
        }
        ContextSourceRequest::Auto => {
            let mut errors = Vec::new();
            let (memory, llm_wiki, knowledge) = tokio::join!(
                search_source(
                    app_state,
                    ContextSourceType::Memory,
                    &query,
                    scope,
                    limit,
                    args.filters.as_ref(),
                    context_selected_file_ids,
                ),
                search_source(
                    app_state,
                    ContextSourceType::LlmWiki,
                    &query,
                    scope,
                    limit,
                    args.filters.as_ref(),
                    context_selected_file_ids,
                ),
                search_source(
                    app_state,
                    ContextSourceType::Knowledge,
                    &query,
                    scope,
                    limit,
                    args.filters.as_ref(),
                    context_selected_file_ids,
                ),
            );
            let mut envelopes = Vec::new();
            for (source_type, result) in [
                (ContextSourceType::Memory, memory),
                (ContextSourceType::LlmWiki, llm_wiki),
                (ContextSourceType::Knowledge, knowledge),
            ] {
                match result {
                    Ok(envelope) => envelopes.push(envelope_value(envelope)?),
                    Err(error) => errors.push(json!({
                        "source_type": source_type.as_str(),
                        "error": error,
                    })),
                }
            }
            Ok(json!({
                "format_version": "context_evidence.v1",
                "tool": "context_search",
                "source": "auto",
                "query": query,
                "include_neighbors": include_neighbors,
                "envelopes": envelopes,
                "errors": errors,
            }))
        }
    }
}

async fn search_source(
    app_state: &AppState,
    source_type: ContextSourceType,
    query: &str,
    scope: &str,
    limit: usize,
    filters: Option<&Value>,
    context_selected_file_ids: &[String],
) -> Result<ContextEvidenceEnvelope, String> {
    match source_type {
        ContextSourceType::Memory => search_memory(app_state, query, limit, filters).await,
        ContextSourceType::LlmWiki => search_llm_wiki(app_state, query, limit, filters).await,
        ContextSourceType::Knowledge => {
            search_knowledge(
                app_state,
                query,
                scope,
                limit,
                filters,
                context_selected_file_ids,
            )
            .await
        }
    }
}

async fn execute_context_search_multi(
    app_state: &AppState,
    arguments: &Value,
    context_selected_file_ids: &[String],
) -> Result<Value, String> {
    let args: ContextSearchMultiArgs =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;

    let source_str = args.source.trim();
    if source_str.is_empty() || source_str.eq_ignore_ascii_case("auto") {
        return Err("context_search_multi requires an explicit source (memory|llm_wiki|knowledge); auto is rejected because RRF fusion is intra-source only".to_string());
    }
    let source_type = parse_source_type(source_str)?;

    let queries: Vec<String> = args
        .queries
        .iter()
        .map(|q| q.trim().to_string())
        .filter(|q| !q.is_empty())
        .collect();
    if queries.len() < 2 {
        return Err("context_search_multi requires at least 2 non-empty queries; for a single query call context_search instead".to_string());
    }
    if queries.len() > 5 {
        return Err("context_search_multi accepts at most 5 queries".to_string());
    }

    let limit = args.limit.unwrap_or(6).clamp(1, 12);
    let scope = args.scope.as_deref().unwrap_or("all");
    let per_query_limit = limit.saturating_mul(2).min(20);

    let futures = queries.iter().map(|query| {
        search_source(
            app_state,
            source_type,
            query,
            scope,
            per_query_limit,
            args.filters.as_ref(),
            context_selected_file_ids,
        )
    });
    let results: Vec<Result<ContextEvidenceEnvelope, String>> = join_all(futures).await;

    let mut envelopes: Vec<ContextEvidenceEnvelope> = Vec::with_capacity(results.len());
    let mut errors: Vec<Value> = Vec::new();
    for (index, result) in results.into_iter().enumerate() {
        match result {
            Ok(env) => envelopes.push(env),
            Err(error) => errors.push(json!({
                "query_index": index,
                "query": queries.get(index),
                "error": error,
            })),
        }
    }
    if envelopes.is_empty() {
        return Err(format!(
            "context_search_multi: all {} queries against {} failed",
            queries.len(),
            source_type.as_str()
        ));
    }

    let per_query_counts: Vec<usize> = envelopes.iter().map(|env| env.items.len()).collect();
    let base_score_semantics = envelopes[0].score_semantics.clone();

    let fused = rrf_fuse(&envelopes, DEFAULT_RRF_K, limit);
    let fused_count = fused.len();

    let items: Vec<ContextEvidenceItem> = fused
        .into_iter()
        .map(|fitem| {
            let mut item = fitem.item;
            let appearances = fitem
                .appearances
                .iter()
                .map(|appearance| {
                    json!({
                        "query_index": appearance.query_index,
                        "query": queries.get(appearance.query_index),
                        "rank": appearance.rank,
                        "source_score": appearance.source_score,
                    })
                })
                .collect::<Vec<_>>();
            if let Some(obj) = item.score_breakdown.as_object_mut() {
                obj.insert("fused_rrf_score".to_string(), json!(fitem.fused_rrf_score));
                obj.insert("rrf_appearances".to_string(), json!(appearances));
            }
            item
        })
        .collect();

    let signals = ContextCoverageSignals::from_items(&items);
    let next_action = next_action_for_items(&items);

    let trace = ContextTrace::default().record(
        "retrieve_multi",
        json!({
            "source_type": source_type.as_str(),
            "queries": queries,
            "per_query_envelope_counts": per_query_counts,
            "per_query_limit": per_query_limit,
            "fused_count": fused_count,
            "fusion_method": "rrf",
            "rrf_k": DEFAULT_RRF_K,
            "errors": errors,
            "confidence": signals.confidence,
            "top_score": signals.top_score,
            "score_gap_ratio": signals.score_gap_ratio,
        }),
    );

    let envelope = ContextEvidenceEnvelope::new(
        source_type,
        queries.join(" | "),
        items,
        format!(
            "{} (RRF-fused across {} queries; item.score remains source-native, fused_rrf_score lives in score_breakdown)",
            base_score_semantics,
            queries.len()
        ),
        next_action,
        trace,
    );

    Ok(json!({
        "format_version": "context_evidence.v1",
        "tool": "context_search_multi",
        "source": source_type.as_str(),
        "queries": queries,
        "envelope": envelope_value(envelope)?,
        "errors": errors,
        "fusion": {
            "method": "rrf",
            "k_constant": DEFAULT_RRF_K,
            "per_query_envelope_counts": per_query_counts,
            "per_query_limit": per_query_limit,
        }
    }))
}

async fn execute_context_open(app_state: &AppState, arguments: &Value) -> Result<Value, String> {
    let args: ContextOpenArgs =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;
    let source_type = parse_required_source_type(
        args.source_type.as_deref().or(args.source.as_deref()),
        "context_open",
    )?;
    let id = args.id.trim().to_string();
    if id.is_empty() {
        return Err("context_open requires a non-empty id".to_string());
    }
    let window = args.window.unwrap_or(1).clamp(0, 10);
    let envelope = match source_type {
        ContextSourceType::Memory => open_memory(app_state, &id).await?,
        ContextSourceType::LlmWiki => {
            open_llm_wiki(
                app_state,
                &id,
                args.doc_id.as_deref(),
                args.chunk_index,
                window,
            )
            .await?
        }
        ContextSourceType::Knowledge => {
            open_knowledge(
                app_state,
                &id,
                args.file_id.as_deref(),
                args.chunk_index,
                window,
            )
            .await?
        }
    };
    Ok(json!({
        "format_version": "context_evidence.v1",
        "tool": "context_open",
        "source": source_type.as_str(),
        "id": id,
        "window": window,
        "envelope": envelope_value(envelope)?,
    }))
}

async fn execute_context_expand(app_state: &AppState, arguments: &Value) -> Result<Value, String> {
    let args: ContextOpenArgs =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;
    let source_type = parse_required_source_type(
        args.source_type.as_deref().or(args.source.as_deref()),
        "context_expand",
    )?;
    let id = args.id.trim().to_string();
    if id.is_empty() {
        return Err("context_expand requires a non-empty id".to_string());
    }
    let window = args.window.unwrap_or(2).clamp(1, 10);
    let envelope = match source_type {
        ContextSourceType::Knowledge => {
            open_knowledge(
                app_state,
                &id,
                args.file_id.as_deref(),
                args.chunk_index,
                window,
            )
            .await?
        }
        ContextSourceType::Memory => open_memory(app_state, &id).await?,
        ContextSourceType::LlmWiki => {
            open_llm_wiki(
                app_state,
                &id,
                args.doc_id.as_deref(),
                args.chunk_index,
                window,
            )
            .await?
        }
    };
    Ok(json!({
        "format_version": "context_evidence.v1",
        "tool": "context_expand",
        "source": source_type.as_str(),
        "id": id,
        "window": window,
        "envelope": envelope_value(envelope)?,
    }))
}

fn execute_context_summarize_evidence(arguments: &Value) -> Result<Value, String> {
    let max_items = arguments
        .get("max_items")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 20) as usize)
        .unwrap_or(8);
    let max_chars = arguments
        .get("max_chars_per_item")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(120, 2_000) as usize)
        .unwrap_or(500);

    let mut summary_items = Vec::new();
    collect_summary_items(
        arguments.get("envelope"),
        max_items,
        max_chars,
        &mut summary_items,
    );
    collect_summary_items(
        arguments.get("envelopes"),
        max_items,
        max_chars,
        &mut summary_items,
    );
    if summary_items.len() > max_items {
        summary_items.truncate(max_items);
    }

    Ok(json!({
        "format_version": "context_evidence_summary.v1",
        "tool": "context_summarize_evidence",
        "item_count": summary_items.len(),
        "items": summary_items,
        "note": "Deterministic compression only; source refs and source-native scores are preserved.",
    }))
}

async fn search_memory(
    app_state: &AppState,
    query: &str,
    limit: usize,
    filters: Option<&Value>,
) -> Result<ContextEvidenceEnvelope, String> {
    let adapter = MemoryContextAdapter;
    let applied_filters = memory_search_filters(filters);
    let result = app_state
        .memory
        .service
        .search(LocalMemorySearchQuery {
            query: query.to_string(),
            limit: Some(limit),
            session_id: applied_filters.session_id.clone(),
            capability_id: applied_filters.capability_id.clone(),
            category: applied_filters.category.clone(),
            source: applied_filters.source.clone(),
            tags: applied_filters.tags.clone(),
        })
        .await
        .map_err(|err| err.to_string())?;
    let explore_item_id = result.explore_item_id.clone();
    let explore_arm_id = result.explore_arm_id.clone();
    let items: Vec<ContextEvidenceItem> =
        result.items.into_iter().map(memory_search_item).collect();
    let count = items.len();
    let signals = ContextCoverageSignals::from_items(&items);
    let next_action = next_action_for_items(&items);
    let trace = ContextTrace::default().record(
        "retrieve",
        json!({
            "source_type": adapter.source_type().as_str(),
            "query": query,
            "returned": count,
            "score_owner": "MemoryService",
            "applied_filters": applied_filters.as_trace_value(),
            "explore_item_id": explore_item_id,
            "explore_arm_id": explore_arm_id,
            "confidence": signals.confidence,
            "top_score": signals.top_score,
            "score_gap_ratio": signals.score_gap_ratio,
            "flatness": signals.flatness,
        }),
    );
    Ok(ContextEvidenceEnvelope::new(
        ContextSourceType::Memory,
        query,
        items,
        adapter.score_semantics(),
        next_action,
        trace,
    ))
}

async fn open_memory(app_state: &AppState, id: &str) -> Result<ContextEvidenceEnvelope, String> {
    let adapter = MemoryContextAdapter;
    let item = app_state
        .memory
        .store
        .get(id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("memory '{id}' was not found"))?;
    let trace = ContextTrace::default().record(
        "open_source",
        json!({
            "source_type": adapter.source_type().as_str(),
            "id": id,
            "score_owner": "MemoryStore",
        }),
    );
    Ok(ContextEvidenceEnvelope::new(
        ContextSourceType::Memory,
        id,
        vec![memory_item(item)],
        adapter.score_semantics(),
        ContextNextAction::AnswerWithEvidence,
        trace,
    ))
}

async fn search_llm_wiki(
    app_state: &AppState,
    query: &str,
    limit: usize,
    filters: Option<&Value>,
) -> Result<ContextEvidenceEnvelope, String> {
    let adapter = LlmWikiContextAdapter;
    let applied_filters = llm_wiki_search_filters(filters);
    let result = search_local_llm_wiki_corpus(
        app_state,
        SearchLocalLlmWikiCorpusRequest {
            query: query.to_string(),
            limit: Some(limit),
            scope: applied_filters.scope.clone(),
            doc_id: applied_filters.doc_id.clone(),
            relative_path: applied_filters.relative_path.clone(),
            relative_path_prefix: applied_filters.relative_path_prefix.clone(),
        },
    )
    .await?;
    let items: Vec<ContextEvidenceItem> = result.hits.into_iter().map(llm_wiki_hit).collect();
    let count = items.len();
    let signals = ContextCoverageSignals::from_items(&items);
    let next_action = next_action_for_items(&items);
    let trace = ContextTrace::default().record(
        "retrieve",
        json!({
            "source_type": adapter.source_type().as_str(),
            "query": query,
            "returned": count,
            "score_owner": "llm_wiki",
            "applied_filters": applied_filters.as_trace_value(),
            "confidence": signals.confidence,
            "top_score": signals.top_score,
            "score_gap_ratio": signals.score_gap_ratio,
            "flatness": signals.flatness,
        }),
    );
    Ok(ContextEvidenceEnvelope::new(
        ContextSourceType::LlmWiki,
        query,
        items,
        adapter.score_semantics(),
        next_action,
        trace,
    ))
}

async fn open_llm_wiki(
    app_state: &AppState,
    id: &str,
    doc_id_arg: Option<&str>,
    chunk_index_arg: Option<i64>,
    window: i64,
) -> Result<ContextEvidenceEnvelope, String> {
    let adapter = LlmWikiContextAdapter;
    let (doc_id, chunk_index) = resolve_llm_wiki_locator(id, doc_id_arg, chunk_index_arg)?;
    let result = open_local_llm_wiki_corpus_chunks(app_state, &doc_id, chunk_index, window).await?;
    let count = result.hits.len();
    let trace = ContextTrace::default().record(
        "open_source",
        json!({
            "source_type": adapter.source_type().as_str(),
            "id": id,
            "doc_id": doc_id,
            "chunk_index": chunk_index,
            "window": window,
            "returned": count,
            "score_owner": "llm_wiki",
        }),
    );
    Ok(ContextEvidenceEnvelope::new(
        ContextSourceType::LlmWiki,
        id,
        result.hits.into_iter().map(llm_wiki_hit).collect(),
        adapter.score_semantics(),
        next_action_for_count(count),
        trace,
    ))
}

async fn search_knowledge(
    app_state: &AppState,
    query: &str,
    scope: &str,
    limit: usize,
    filters: Option<&Value>,
    context_selected_file_ids: &[String],
) -> Result<ContextEvidenceEnvelope, String> {
    let adapter = KnowledgeContextAdapter;
    let filter_file_ids = filter_selected_knowledge_file_ids(filters);
    let filter_provided = !filter_file_ids.is_empty();
    let want_selected_scope = scope == "selected";
    let resolved_file_ids = resolve_selected_file_ids(
        filter_file_ids,
        context_selected_file_ids,
        want_selected_scope,
    );
    let used_context_fallback =
        !filter_provided && want_selected_scope && !resolved_file_ids.is_empty();
    let hits = if !resolved_file_ids.is_empty() {
        app_state
            .knowledge
            .store
            .search_local_knowledge_chunks_in_documents(
                query,
                &resolved_file_ids,
                Some(limit as i64),
            )
            .await
    } else {
        app_state
            .knowledge
            .store
            .search_local_knowledge_chunks(query, Some(limit as i64))
            .await
    }
    .map_err(|err| err.to_string())?;
    let items: Vec<ContextEvidenceItem> = hits.into_iter().map(knowledge_hit).collect();
    let count = items.len();
    let signals = ContextCoverageSignals::from_items(&items);
    let next_action = next_action_for_items(&items);
    let trace = ContextTrace::default().record(
        "retrieve",
        json!({
            "source_type": adapter.source_type().as_str(),
            "query": query,
            "scope": scope,
            "selected_file_count": resolved_file_ids.len(),
            "returned": count,
            "score_owner": "KnowledgeStore",
            "used_context_fallback": used_context_fallback,
            "confidence": signals.confidence,
            "top_score": signals.top_score,
            "score_gap_ratio": signals.score_gap_ratio,
            "flatness": signals.flatness,
        }),
    );
    Ok(ContextEvidenceEnvelope::new(
        ContextSourceType::Knowledge,
        query,
        items,
        adapter.score_semantics(),
        next_action,
        trace,
    ))
}

async fn open_knowledge(
    app_state: &AppState,
    id: &str,
    file_id_arg: Option<&str>,
    chunk_index_arg: Option<i64>,
    window: i64,
) -> Result<ContextEvidenceEnvelope, String> {
    let adapter = KnowledgeContextAdapter;
    let (file_id, chunk_index) = resolve_knowledge_locator(id, file_id_arg, chunk_index_arg)?;
    let document = app_state
        .knowledge
        .store
        .get_local_user_document(&file_id)
        .await
        .map_err(|err| err.to_string())?;
    let offset = chunk_index.map(|index| index.saturating_sub(window).max(0));
    let limit = chunk_index
        .map(|_| window.saturating_mul(2).saturating_add(1))
        .unwrap_or_else(|| window.max(1));
    let response = app_state
        .knowledge
        .store
        .list_local_user_document_chunks(
            &file_id,
            LocalUserDocumentChunkListQuery {
                offset,
                limit: Some(limit.clamp(1, 100)),
            },
        )
        .await
        .map_err(|err| err.to_string())?;
    let count = response.items.len();
    let trace = ContextTrace::default().record(
        "open_source",
        json!({
            "source_type": adapter.source_type().as_str(),
            "id": id,
            "file_id": file_id,
            "chunk_index": chunk_index,
            "window": window,
            "returned": count,
            "score_owner": "KnowledgeStore",
        }),
    );
    Ok(ContextEvidenceEnvelope::new(
        ContextSourceType::Knowledge,
        id,
        response
            .items
            .into_iter()
            .map(|chunk| knowledge_chunk(&document, chunk, chunk_index))
            .collect(),
        adapter.score_semantics(),
        next_action_for_count(count),
        trace,
    ))
}

fn memory_search_item(item: LocalMemorySearchItem) -> ContextEvidenceItem {
    let id = item.id.clone();
    let session_id = item.session_id.clone();
    let capability_id = item.capability_id.clone();
    let category = item.category.clone();
    let source = item.source.clone();
    let tags = item.tags.clone();
    let vitality = item.vitality;
    let last_accessed_at = item.last_accessed_at.clone();
    let created_at = item.created_at.clone();
    let updated_at = item.updated_at.clone();
    let meta_info = item.meta_info.clone();
    let lifecycle = json!({
        "vitality": vitality,
        "last_accessed_at": last_accessed_at,
        "meta_info": meta_info,
    });
    ContextEvidenceItem {
        id: id.clone(),
        source_id: session_id.clone(),
        title: category.clone().or(source.clone()),
        content: item.content,
        score: item.score as f64,
        score_breakdown: json!({
            "source_score": item.score,
            "category": category,
            "source": source,
            "tags": tags,
            "vitality": vitality,
            "last_accessed_at": last_accessed_at,
        }),
        source_refs: vec![ContextSourceRef {
            source_type: ContextSourceType::Memory,
            id,
            label: Some("local memory".to_string()),
            locator: Some(json!({
                "session_id": session_id,
                "capability_id": capability_id,
                "created_at": created_at,
                "updated_at": updated_at,
            })),
        }],
        quality_flags: Vec::new(),
        lifecycle: Some(lifecycle),
    }
}

fn memory_item(item: LocalMemoryItem) -> ContextEvidenceItem {
    let id = item.id.clone();
    let session_id = item.session_id.clone();
    let capability_id = item.capability_id.clone();
    let category = item.category.clone();
    let source = item.source.clone();
    let tags = item.tags.clone();
    let vitality = item.vitality;
    let last_accessed_at = item.last_accessed_at.clone();
    let created_at = item.created_at.clone();
    let updated_at = item.updated_at.clone();
    let meta_info = item.meta_info.clone();
    let lifecycle = json!({
        "vitality": vitality,
        "last_accessed_at": last_accessed_at,
        "meta_info": meta_info,
    });
    ContextEvidenceItem {
        id: id.clone(),
        source_id: session_id.clone(),
        title: category.clone().or(source.clone()),
        content: item.content,
        score: 1.0,
        score_breakdown: json!({
            "source_score": 1.0,
            "open_mode": true,
            "category": category,
            "source": source,
            "tags": tags,
            "vitality": vitality,
            "last_accessed_at": last_accessed_at,
        }),
        source_refs: vec![ContextSourceRef {
            source_type: ContextSourceType::Memory,
            id,
            label: Some("local memory".to_string()),
            locator: Some(json!({
                "session_id": session_id,
                "capability_id": capability_id,
                "created_at": created_at,
                "updated_at": updated_at,
            })),
        }],
        quality_flags: Vec::new(),
        lifecycle: Some(lifecycle),
    }
}

fn llm_wiki_hit(hit: LocalLlmWikiCorpusSearchHit) -> ContextEvidenceItem {
    let id = format!("{}:{}", hit.doc_id, hit.chunk_index);
    let asset_id = hit.asset_id.clone();
    let doc_id = hit.doc_id.clone();
    let title = hit.title.clone();
    let scope = hit.scope.clone();
    let relative_path = hit.relative_path.clone();
    ContextEvidenceItem {
        id: id.clone(),
        source_id: Some(doc_id.clone()),
        title: Some(title.clone()),
        content: hit.summary,
        score: hit.score,
        score_breakdown: json!({
            "asset_id": asset_id,
            "lexical_score": hit.lexical_score,
            "semantic_score": hit.semantic_score,
            "final_score": hit.score,
            "scope": scope,
        }),
        source_refs: vec![ContextSourceRef {
            source_type: ContextSourceType::LlmWiki,
            id,
            label: Some(title),
            locator: Some(json!({
                "asset_id": asset_id,
                "doc_id": doc_id,
                "chunk_index": hit.chunk_index,
                "relative_path": relative_path,
                "scope": scope,
            })),
        }],
        quality_flags: Vec::new(),
        lifecycle: None,
    }
}

fn knowledge_hit(hit: LocalKnowledgeSearchHit) -> ContextEvidenceItem {
    let id = knowledge_locator_id(&hit.file_id, hit.index);
    let chunk_id = hit.chunk_id.clone();
    let file_id = hit.file_id.clone();
    let file_name = hit.file_name.clone();
    let section_path = hit.section_path.clone();
    let quality_flags = hit.quality_flags.clone();
    let match_reasons = hit.match_reasons.clone();
    let score_breakdown = hit.score_breakdown.clone();
    let content_hash = hit.content_hash.clone();
    ContextEvidenceItem {
        id: id.clone(),
        source_id: Some(file_id.clone()),
        title: Some(file_name.clone()),
        content: hit.content,
        score: hit.score,
        score_breakdown: json!({
            "chunk_id": chunk_id,
            "file_id": file_id,
            "file_name": file_name,
            "chunk_index": hit.index,
            "lexical_score": hit.lexical_score,
            "match_reasons": match_reasons,
            "score_breakdown": score_breakdown,
            "section_path": section_path,
            "chunk_type": hit.chunk_type,
            "page_hint": hit.page_hint,
            "char_start": hit.char_start,
            "char_end": hit.char_end,
            "content_hash": content_hash,
        }),
        source_refs: vec![ContextSourceRef {
            source_type: ContextSourceType::Knowledge,
            id,
            label: Some(file_name),
            locator: Some(json!({
                "chunk_id": chunk_id,
                "file_id": file_id,
                "chunk_index": hit.index,
                "page_hint": hit.page_hint,
                "section_path": section_path,
            })),
        }],
        quality_flags,
        lifecycle: None,
    }
}

fn knowledge_chunk(
    document: &LocalKnowledgeFile,
    chunk: LocalKnowledgeChunk,
    focus_index: Option<i64>,
) -> ContextEvidenceItem {
    let chunk_id = chunk.id.clone();
    let file_id = chunk.file_id.clone();
    let file_name = document.name.clone();
    let section_path = chunk.section_path.clone();
    let quality_flags = chunk.quality_flags.clone();
    let content_hash = chunk.content_hash.clone();
    let distance = focus_index
        .map(|focus| (chunk.index - focus).abs())
        .unwrap_or(0);
    let score = if distance == 0 {
        1.0
    } else {
        1.0 / (distance as f64 + 1.0)
    };
    let id = knowledge_locator_id(&chunk.file_id, chunk.index);
    ContextEvidenceItem {
        id: id.clone(),
        source_id: Some(file_id.clone()),
        title: Some(file_name.clone()),
        content: chunk.content,
        score,
        score_breakdown: json!({
            "open_score": score,
            "distance_from_focus_chunk": distance,
            "file_id": file_id,
            "file_name": file_name,
            "chunk_id": chunk_id,
            "chunk_index": chunk.index,
            "section_path": section_path,
            "chunk_type": chunk.chunk_type,
            "page_hint": chunk.page_hint,
            "char_start": chunk.char_start,
            "char_end": chunk.char_end,
            "content_hash": content_hash,
        }),
        source_refs: vec![ContextSourceRef {
            source_type: ContextSourceType::Knowledge,
            id,
            label: Some(file_name),
            locator: Some(json!({
                "chunk_id": chunk_id,
                "file_id": file_id,
                "chunk_index": chunk.index,
                "page_hint": chunk.page_hint,
                "section_path": section_path,
            })),
        }],
        quality_flags,
        lifecycle: None,
    }
}

fn parse_source_request(source: Option<&str>) -> Result<ContextSourceRequest, String> {
    match source.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some("auto") => Ok(ContextSourceRequest::Auto),
        Some(value) => parse_source_type(value).map(ContextSourceRequest::Source),
    }
}

fn parse_required_source_type(
    source: Option<&str>,
    tool_name: &str,
) -> Result<ContextSourceType, String> {
    let source = source
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{tool_name} requires source_type"))?;
    parse_source_type(source)
}

fn parse_source_type(source: &str) -> Result<ContextSourceType, String> {
    match source.trim().to_ascii_lowercase().as_str() {
        "memory" => Ok(ContextSourceType::Memory),
        "llm_wiki" | "llm-wiki" | "wiki" => Ok(ContextSourceType::LlmWiki),
        "knowledge" | "local_knowledge" | "local-knowledge" => Ok(ContextSourceType::Knowledge),
        other => Err(format!(
            "unsupported context source '{other}'; expected memory, llm_wiki, knowledge, or auto"
        )),
    }
}

fn memory_search_filters(filters: Option<&Value>) -> MemoryContextSearchFilters {
    MemoryContextSearchFilters {
        session_id: filter_string(filters, &["session_id", "sessionId"]),
        capability_id: filter_string(filters, &["capability_id", "capabilityId"]),
        category: filter_string(filters, &["category"]),
        source: filter_string(filters, &["source"]),
        tags: filter_string_array(filters, &["tags", "tag"]),
    }
}

fn llm_wiki_search_filters(filters: Option<&Value>) -> LlmWikiContextSearchFilters {
    LlmWikiContextSearchFilters {
        scope: filter_string(filters, &["scope", "wiki_scope", "wikiScope"]),
        doc_id: filter_string(filters, &["doc_id", "docId", "document_id", "documentId"]),
        relative_path: filter_string(filters, &["relative_path", "relativePath", "path"]),
        relative_path_prefix: filter_string(
            filters,
            &[
                "relative_path_prefix",
                "relativePathPrefix",
                "path_prefix",
                "pathPrefix",
                "folder",
            ],
        ),
    }
}

fn filter_string(filters: Option<&Value>, keys: &[&str]) -> Option<String> {
    let filters = filters?;
    keys.iter()
        .find_map(|key| filters.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn filter_string_array(filters: Option<&Value>, keys: &[&str]) -> Option<Vec<String>> {
    let filters = filters?;
    let values = keys.iter().find_map(|key| filters.get(*key))?;
    let items = if let Some(array) = values.as_array() {
        array
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>()
    } else if let Some(value) = values.as_str() {
        value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    if items.is_empty() {
        None
    } else {
        Some(items)
    }
}

fn resolve_llm_wiki_locator(
    id: &str,
    doc_id_arg: Option<&str>,
    chunk_index_arg: Option<i64>,
) -> Result<(String, Option<i64>), String> {
    let doc_id = doc_id_arg
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if let Some(doc_id) = doc_id {
        return Ok((doc_id, chunk_index_arg));
    }

    if let Some((doc_id, index)) = parse_llm_wiki_locator_id(id) {
        return Ok((doc_id, Some(index)));
    }

    Ok((id.trim().to_string(), chunk_index_arg))
}

pub(super) fn parse_llm_wiki_locator_id(id: &str) -> Option<(String, i64)> {
    let (doc_id, index) = id.rsplit_once(':')?;
    let doc_id = doc_id.trim();
    if doc_id.is_empty() {
        return None;
    }
    let index = index.trim().parse::<i64>().ok()?;
    Some((doc_id.to_string(), index.max(0)))
}

fn filter_selected_knowledge_file_ids(filters: Option<&Value>) -> Vec<String> {
    let Some(filters) = filters else {
        return Vec::new();
    };
    [
        "selected_file_ids",
        "selectedFileIds",
        "file_ids",
        "fileIds",
        "knowledge_file_ids",
        "knowledgeFileIds",
    ]
    .into_iter()
    .find_map(|key| filters.get(key).and_then(Value::as_array))
    .map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

/// Pick the file ids to scope a knowledge search by.
///
/// Caller-supplied `filter_file_ids` (parsed from `filters.selected_file_ids`)
/// always wins. When the caller asked for `scope: "selected"` but supplied no
/// file ids, fall back to the workflow-supplied `context_selected_file_ids`
/// so the model does not have to thread file ids through tool arguments.
pub(super) fn resolve_selected_file_ids(
    filter_file_ids: Vec<String>,
    context_selected_file_ids: &[String],
    want_selected_scope: bool,
) -> Vec<String> {
    if !filter_file_ids.is_empty() {
        return filter_file_ids;
    }
    if !want_selected_scope {
        return Vec::new();
    }
    context_selected_file_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect()
}

fn resolve_knowledge_locator(
    id: &str,
    file_id_arg: Option<&str>,
    chunk_index_arg: Option<i64>,
) -> Result<(String, Option<i64>), String> {
    let file_id = file_id_arg
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if let Some(file_id) = file_id {
        return Ok((file_id, chunk_index_arg));
    }

    if let Some((file_id, index)) = parse_knowledge_locator_id(id) {
        return Ok((file_id, Some(index)));
    }

    Ok((id.trim().to_string(), chunk_index_arg))
}

fn parse_knowledge_locator_id(id: &str) -> Option<(String, i64)> {
    let (file_id, index) = id.rsplit_once(':')?;
    let file_id = file_id.trim();
    if file_id.is_empty() {
        return None;
    }
    let index = index.trim().parse::<i64>().ok()?;
    Some((file_id.to_string(), index.max(0)))
}

fn knowledge_locator_id(file_id: &str, index: i64) -> String {
    format!("{}:{}", file_id.trim(), index.max(0))
}

fn next_action_for_count(count: usize) -> ContextNextAction {
    if count == 0 {
        ContextNextAction::SearchAgain
    } else if count <= 2 {
        ContextNextAction::OpenSource
    } else {
        ContextNextAction::AnswerWithEvidence
    }
}

/// Choose the recommended next action for a *search* result by inspecting
/// the shared score-distribution baseline, not just the item count.
///
/// - Empty hits → search again.
/// - Flat distribution (`ContextConfidence::Ambiguous`) → search again with
///   a refined query, because every hit looks equally relevant which usually
///   means the query was too generic.
/// - Sparse hits (<= 2) → ask the model to open the source for more context.
/// - Otherwise → answer with the evidence.
///
/// This helper does **not** rescore items and is deliberately source-agnostic
/// for now. It reads the descriptive signals already computed by
/// `ContextCoverageSignals::from_items` and maps them to an action
/// recommendation. Source-specific coverage confidence can be added later on
/// top of this baseline; it should not be folded into this helper.
fn next_action_for_items(items: &[ContextEvidenceItem]) -> ContextNextAction {
    let signals = ContextCoverageSignals::from_items(items);
    if signals.item_count == 0 {
        return ContextNextAction::SearchAgain;
    }
    if matches!(signals.confidence, ContextConfidence::Ambiguous) {
        return ContextNextAction::SearchAgain;
    }
    if signals.item_count <= 2 {
        return ContextNextAction::OpenSource;
    }
    ContextNextAction::AnswerWithEvidence
}

fn envelope_value(envelope: ContextEvidenceEnvelope) -> Result<Value, String> {
    serde_json::to_value(envelope).map_err(|err| err.to_string())
}

fn collect_summary_items(
    value: Option<&Value>,
    max_items: usize,
    max_chars: usize,
    summary_items: &mut Vec<Value>,
) {
    if summary_items.len() >= max_items {
        return;
    }
    let Some(value) = value else {
        return;
    };
    if let Some(items) = value.as_array() {
        for item in items {
            collect_summary_items(Some(item), max_items, max_chars, summary_items);
            if summary_items.len() >= max_items {
                return;
            }
        }
        return;
    }
    if let Some(envelope) = value.as_object() {
        let source_type = envelope.get("source_type").cloned().unwrap_or(Value::Null);
        let score_semantics = envelope
            .get("score_semantics")
            .cloned()
            .unwrap_or(Value::Null);
        let Some(items) = envelope.get("items").and_then(Value::as_array) else {
            return;
        };
        for item in items {
            if summary_items.len() >= max_items {
                return;
            }
            let content = item
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            summary_items.push(json!({
                "source_type": source_type,
                "id": item.get("id").cloned().unwrap_or(Value::Null),
                "title": item.get("title").cloned().unwrap_or(Value::Null),
                "score": item.get("score").cloned().unwrap_or(Value::Null),
                "score_semantics": score_semantics,
                "content": truncate_chars(content, max_chars),
                "source_refs": item.get("source_refs").cloned().unwrap_or_else(|| json!([])),
            }));
        }
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    value.chars().take(max_chars).collect::<String>()
}
