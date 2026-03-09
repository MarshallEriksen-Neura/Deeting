use super::super::support::*;
use super::search_ranking::lexical_rank_asset_hits;

pub(crate) const LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION: &str = "assistant_activation.v1";

pub(crate) async fn build_local_consult_expert_network_result(
    app_state: &AppState,
    intent_query: &str,
    limit: usize,
    current_assistant_id: Option<&str>,
) -> serde_json::Value {
    build_local_consult_expert_network_result_with_runtime(
        app_state.mcp.store.as_ref(),
        &app_state.providers.embedding,
        app_state.memory.service.as_ref(),
        intent_query,
        limit,
        current_assistant_id,
    )
    .await
}

fn build_local_consult_response(
    candidates: Vec<serde_json::Value>,
    reason: &str,
    search_mode: &str,
) -> serde_json::Value {
    let recommended_assistant_id = candidates
        .first()
        .and_then(|value| value.get("assistant_id"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    serde_json::json!({
        "action": "consulted",
        "scope": "request",
        "format_version": LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
        "candidates": candidates,
        "recommended_assistant_id": recommended_assistant_id,
        "reason": reason,
        "search_mode": search_mode,
    })
}

fn build_local_consult_candidates_from_assets(
    assets: Vec<serde_json::Value>,
    enabled_assistant_ids: &HashSet<String>,
    current_assistant_id: &str,
    limit: usize,
) -> Vec<serde_json::Value> {
    let mut candidates = Vec::new();
    for hit in assets {
        let assistant_id = hit
            .get("id")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(assistant_id) = assistant_id else {
            continue;
        };
        if assistant_id == current_assistant_id
            || !enabled_assistant_ids.contains(assistant_id.as_str())
        {
            continue;
        }
        let name = hit
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Assistant".to_string());
        candidates.push(serde_json::json!({
            "assistant_id": assistant_id,
            "name": name,
            "summary": hit.get("description").cloned().unwrap_or(serde_json::Value::Null),
            "score": hit.get("_distance").cloned().unwrap_or(serde_json::Value::Null),
        }));
        if candidates.len() >= limit {
            break;
        }
    }
    candidates
}

pub(crate) async fn build_local_consult_expert_network_result_with_runtime(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    intent_query: &str,
    limit: usize,
    current_assistant_id: Option<&str>,
) -> serde_json::Value {
    let normalized_query = intent_query.trim();
    if normalized_query.is_empty() {
        return serde_json::json!({
            "error": "intent_query is required",
            "error_code": "ASSISTANT_CONSULT_EMPTY_QUERY",
        });
    }

    let enabled_assistant_ids = mcp_store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let max_hits = limit.clamp(1, 8);
    if enabled_assistant_ids.is_empty() {
        return build_local_consult_response(
            Vec::new(),
            "No installed local assistants are enabled for expert consultation.",
            "catalog_empty",
        );
    }

    let current_assistant = current_assistant_id.unwrap_or("").trim();
    let assistants = match mcp_store.list_local_assistants().await {
        Ok(value) => value,
        Err(err) => {
            log::warn!(
                "local assistant catalog unavailable for consult_expert_network: {}",
                err
            );
            return build_local_consult_response(
                Vec::new(),
                "Local assistant catalog is unavailable, so expert consultation was skipped.",
                "catalog_unavailable",
            );
        }
    };
    let assistant_assets = assistants
        .into_iter()
        .filter(|assistant| enabled_assistant_ids.contains(assistant.id.as_str()))
        .filter(|assistant| assistant.id != current_assistant)
        .map(|assistant| {
            serde_json::json!({
                "id": assistant.id,
                "name": assistant.name,
                "description": assistant.description.unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    if assistant_assets.is_empty() {
        return build_local_consult_response(
            Vec::new(),
            "No alternative local assistants are available for expert consultation.",
            "catalog_empty",
        );
    }

    let fallback_reason = if let Ok(vector) = embedding_service.embed_text(normalized_query).await {
        match memory_store
            .search_assets(vector, max_hits, Some("assistant"))
            .await
        {
            Ok(hits) => {
                let candidates = build_local_consult_candidates_from_assets(
                    hits,
                    &enabled_assistant_ids,
                    current_assistant,
                    max_hits,
                );
                if !candidates.is_empty() {
                    return build_local_consult_response(
                        candidates,
                        "Search expert assistants by intent and activate explicitly if needed.",
                        "vector",
                    );
                }
                "No vector-ranked assistant matched, so the local assistant catalog fallback was used."
                    .to_string()
            }
            Err(err) => {
                log::warn!(
                    "local assistant vector search failed for consult_expert_network: {}",
                    err
                );
                "Vector search was unavailable, so the local assistant catalog fallback was used."
                    .to_string()
            }
        }
    } else {
        "Embedding lookup was unavailable, so the local assistant catalog fallback was used."
            .to_string()
    };

    let lexical_hits =
        lexical_rank_asset_hits(&normalized_query.to_lowercase(), assistant_assets, max_hits);
    let candidates = build_local_consult_candidates_from_assets(
        lexical_hits,
        &enabled_assistant_ids,
        current_assistant,
        max_hits,
    );
    if candidates.is_empty() {
        return build_local_consult_response(
            Vec::new(),
            "No matching local assistants were found for this request.",
            "lexical",
        );
    }

    build_local_consult_response(candidates, &fallback_reason, "lexical")
}
