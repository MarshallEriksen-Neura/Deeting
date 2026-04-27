use std::collections::{BTreeSet, HashSet};

use serde_json::{json, Map, Value};

use super::search_feedback::{
    compute_feedback_boost, historical_affinity_from_rows, query_affinity_from_rows,
    SearchFeedbackContext,
};
use super::should_run_semantic_recall;
use crate::modules::mcp::commands::runtime::capability_catalog::{
    build_capability_registry, CapabilityRegistryEntry, RegistryAvailability, ToolContractSource,
};
use crate::modules::retrieval_kernel::ranking::{
    asset_score_key, bm25_asset_match_scores, normalize_score_map, reciprocal_rank_fusion,
};

const MAX_LIMIT: usize = 20;
const RETRIEVAL_FUSION_WEIGHT: f64 = 48.0;
const SEMANTIC_SCORE_FLOOR: f64 = 0.30;
const MIN_RANK_SCORE: f64 = 8.0;
const SEARCH_RESULT_FORMAT_VERSION: &str = "sdk_control_plane.v1";

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum SearchSdkDetailLevel {
    Summary,
    Full,
}

impl SearchSdkDetailLevel {
    pub(crate) fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "full" => Self::Full,
            _ => Self::Summary,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::Summary => "summary",
            Self::Full => "full",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CapabilitySearchResultBundle {
    pub(crate) summary_payload: Value,
    pub(crate) full_payload: Value,
}

#[derive(Clone)]
struct QueryProfile {
    normalized: String,
    tokens: Vec<String>,
    intent: &'static str,
    domain: &'static str,
    wants_recipes: bool,
    requires_network: bool,
}

struct RankedCapability {
    value: Value,
    score: f64,
}

#[derive(Clone, Debug)]
struct RankComputation {
    lexical_score: Option<f64>,
    structured_score: Option<f64>,
    semantic_score: Option<f64>,
    fused_retrieval_score: Option<f64>,
    domain_hit: bool,
    intent_hit: bool,
    feature_score: f64,
    feature_reasons: Vec<String>,
    feedback_score: f64,
    feedback_reasons: Vec<String>,
}

#[derive(Default)]
struct RetrievalScoreMaps {
    bm25: std::collections::HashMap<String, f64>,
    structured: std::collections::HashMap<String, f64>,
    semantic: std::collections::HashMap<String, f64>,
    fused: std::collections::HashMap<String, f64>,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum SemanticGroup {
    Capability,
    Recipe,
    OrchestrationPrimitive,
}

#[derive(Clone)]
struct ParameterDoc {
    name: String,
    type_name: String,
    python_type: String,
    required: bool,
    description: String,
    default: Option<Value>,
    enum_values: Option<Vec<Value>>,
    example: Option<Value>,
}

pub(crate) async fn build_capability_search_result(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
    query_vector: Option<Vec<f32>>,
    limit: usize,
    detail_level: SearchSdkDetailLevel,
) -> Value {
    let bundle = build_capability_search_result_bundle_with_feedback(
        mcp_store,
        embedding_service,
        memory_store,
        query,
        query_vector,
        limit,
        &SearchFeedbackContext::default(),
    )
    .await;
    match detail_level {
        SearchSdkDetailLevel::Summary => bundle.summary_payload,
        SearchSdkDetailLevel::Full => bundle.full_payload,
    }
}

pub(crate) async fn build_capability_search_result_bundle_with_feedback(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
    query_vector: Option<Vec<f32>>,
    limit: usize,
    feedback_context: &SearchFeedbackContext,
) -> CapabilitySearchResultBundle {
    let mut feedback_context = feedback_context.clone();
    if feedback_context.historical_affinity.is_empty() {
        if let Ok(rows) = mcp_store.list_tool_execution_affinity_rows(32).await {
            let now_unix_ms = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
            feedback_context.historical_affinity =
                historical_affinity_from_rows(&rows, now_unix_ms as i64);
        }
    }
    if feedback_context.query_affinity.is_empty() {
        if let Ok(rows) = mcp_store.list_tool_query_affinity_rows(64).await {
            let now_unix_ms = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
            feedback_context.query_affinity =
                query_affinity_from_rows(query, &rows, now_unix_ms as i64);
        }
    }
    let registry = build_capability_registry(mcp_store).await;
    let mut registry_entries = registry.entries.clone();
    registry_entries.extend(
        build_memory_fallback_registry_entries(
            mcp_store,
            memory_store,
            registry.read_path_mode,
            &registry_entries,
        )
        .await,
    );
    let profile = QueryProfile::from_query(query);
    let limit = limit.clamp(1, MAX_LIMIT);
    let retrieval_scores = build_retrieval_score_maps(
        &registry_entries,
        &profile,
        embedding_service,
        memory_store,
        query_vector,
    )
    .await;
    let mut ranked = registry_entries
        .into_iter()
        .filter_map(|entry| {
            rank_registry_entry_with_feedback(entry, &profile, &feedback_context, &retrieval_scores)
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut ranked = dedupe_ranked_capabilities(ranked);
    if ranked.len() > limit {
        ranked.truncate(limit);
    }

    let mut capabilities = Vec::new();
    let mut recipes = Vec::new();
    let mut orchestration_primitives = Vec::new();
    for ranked_item in ranked {
        push_semantic_group(
            ranked_item.value,
            &mut capabilities,
            &mut recipes,
            &mut orchestration_primitives,
        );
    }

    let direct_callable_capability_count = capabilities
        .iter()
        .filter(|item| {
            item.get("status")
                .and_then(|value| value.get("callable"))
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
                && item.get("asset_namespace").and_then(Value::as_str) != Some("core")
        })
        .count();

    let summary_payload = build_search_result_payload(
        query,
        &profile,
        registry.enabled_assistant_count,
        registry.read_path_mode.as_str(),
        &capabilities,
        &recipes,
        &orchestration_primitives,
        direct_callable_capability_count,
        SearchSdkDetailLevel::Summary,
    );
    let full_payload = build_search_result_payload(
        query,
        &profile,
        registry.enabled_assistant_count,
        registry.read_path_mode.as_str(),
        &capabilities,
        &recipes,
        &orchestration_primitives,
        direct_callable_capability_count,
        SearchSdkDetailLevel::Full,
    );

    CapabilitySearchResultBundle {
        summary_payload,
        full_payload,
    }
}

async fn build_memory_fallback_registry_entries(
    mcp_store: &crate::modules::mcp::store::McpStore,
    memory_store: &crate::modules::memory::service::MemoryService,
    _read_path_mode: mcp_registry::assets::CapabilityRegistryReadMode,
    existing_entries: &[CapabilityRegistryEntry],
) -> Vec<CapabilityRegistryEntry> {
    let Ok(memory_assets) = memory_store.list_assets_catalog().await else {
        return Vec::new();
    };
    if memory_assets.is_empty() {
        return Vec::new();
    }

    let existing_keys = existing_entries
        .iter()
        .filter_map(|entry| asset_score_key(&entry.asset))
        .collect::<HashSet<_>>();
    let enabled_assistant_ids = mcp_store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let enabled_skill_ids = mcp_store
        .list_enabled_local_skill_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let tool_availability_catalog =
        crate::modules::mcp::commands::runtime::build_db_tool_availability_catalog(mcp_store)
            .await
            .unwrap_or_default();

    memory_assets
        .into_iter()
        .filter_map(|asset| {
            let asset_type = asset
                .get("asset_type")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            if !matches!(asset_type, "tool" | "skill_tool") {
                return None;
            }
            let key = asset_score_key(&asset)?;
            if existing_keys.contains(&key) {
                return None;
            }
            let source_type = asset
                .get("source_type")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let asset_id = asset.get("id").and_then(Value::as_str).unwrap_or("");
            let tool_name = asset.get("name").and_then(Value::as_str).unwrap_or("");
            let pkg_name = asset.get("pkg_name").and_then(Value::as_str);
            let asset_metadata = asset.get("metadata");

            Some(CapabilityRegistryEntry {
                availability: RegistryAvailability::from_asset(
                    asset_type,
                    source_type,
                    asset_id,
                    tool_name,
                    pkg_name,
                    asset_metadata,
                    mcp_registry::assets::CapabilityRegistryReadMode::LegacyOnly,
                    &enabled_assistant_ids,
                    &enabled_skill_ids,
                    &tool_availability_catalog,
                ),
                tool_contract_source: None,
                asset,
            })
        })
        .collect()
}

pub(crate) async fn build_tool_schema_lookup_result(
    mcp_store: &crate::modules::mcp::store::McpStore,
    tool_name: &str,
) -> Result<Value, String> {
    let normalized_tool_name = tool_name.trim();
    if normalized_tool_name.is_empty() {
        return Err("tool_name is required".to_string());
    }

    let registry = build_capability_registry(mcp_store).await;
    let Some(entry) = registry.entries.into_iter().find(|entry| {
        entry
            .asset
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| name.trim() == normalized_tool_name)
    }) else {
        return Err(format!(
            "tool schema not found for '{normalized_tool_name}'"
        ));
    };

    let CapabilityRegistryEntry {
        asset,
        tool_contract_source,
        ..
    } = entry;
    let description = asset
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let source_type = asset
        .get("source_type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let contract = build_tool_contract(
        normalized_tool_name,
        description,
        source_type,
        asset.get("metadata"),
        tool_contract_source.as_ref(),
    )
    .ok_or_else(|| format!("tool schema unavailable for '{normalized_tool_name}'"))?;

    let mut result = json!({
        "tool_name": normalized_tool_name,
        "capability_id": asset.get("id").cloned().unwrap_or_else(|| json!(normalized_tool_name)),
        "description": description,
    });
    merge_object(&mut result, contract);
    Ok(result)
}

fn build_search_result_payload(
    query: &str,
    profile: &QueryProfile,
    enabled_assistant_count: usize,
    read_path_mode: &str,
    capabilities: &[Value],
    recipes: &[Value],
    orchestration_primitives: &[Value],
    direct_callable_capability_count: usize,
    detail_level: SearchSdkDetailLevel,
) -> Value {
    let visible_capabilities = filter_model_visible_capabilities(capabilities, detail_level);
    let serialized_capabilities = serialize_search_items(&visible_capabilities, detail_level);
    let serialized_recipes = serialize_search_items(recipes, detail_level);
    let serialized_orchestration_primitives =
        serialize_search_items(orchestration_primitives, detail_level);
    let capability_groups = build_capability_groups(&visible_capabilities, detail_level);
    let recipe_groups = build_recipe_groups(recipes, detail_level);

    let mut payload = json!({
        "format_version": SEARCH_RESULT_FORMAT_VERSION,
        "mode": "desktop_runtime",
        "detail_level": detail_level.as_str(),
        "query": query,
        "count": serialized_capabilities.len() + serialized_recipes.len() + serialized_orchestration_primitives.len(),
        "capabilities": serialized_capabilities,
        "recipes": serialized_recipes,
        "capability_groups": capability_groups,
        "recipe_groups": recipe_groups,
        "orchestration_primitives": serialized_orchestration_primitives,
    });

    if detail_level == SearchSdkDetailLevel::Full {
        merge_object(
            &mut payload,
            json!({
                "runtime_protocol_version": crate::modules::code_mode::contract::RUNTIME_PROTOCOL_VERSION,
                "normalized_query": profile.to_value(),
                "routing_hint": {
                    "default_path": "direct_capability_call",
                    "programmatic_path": "execute_code_plan",
                    "direct_callable_capability_count": direct_callable_capability_count,
                },
                "usage_hint": "Prefer direct host capabilities from capability_groups.skill_tools, capability_groups.user_mcp_tools, and capability_groups.core_tools. When the task is a bounded subtask better handled by a specialist local agent, prefer delegate_task instead of manually chaining generic tools. For recipe_groups.skills, call activate_skill with the stable skill_id before relying on package-specific procedures, then use read_skill_resource for package-local references when needed. Use shell_execute only for actual host command execution. Use execute_code_plan only for multi-step program logic, loops, branching, or result aggregation.",
                "availability": {
                    "enabled_assistant_count": enabled_assistant_count,
                    "read_path_mode": read_path_mode,
                    "legacy_control_plane_reads_enabled": false,
                }
            }),
        );
    }

    payload
}

fn filter_model_visible_capabilities(
    capabilities: &[Value],
    detail_level: SearchSdkDetailLevel,
) -> Vec<Value> {
    match detail_level {
        SearchSdkDetailLevel::Summary => capabilities
            .iter()
            .filter(|item| capability_is_model_visible_in_summary(item))
            .cloned()
            .collect(),
        SearchSdkDetailLevel::Full => capabilities.to_vec(),
    }
}

fn capability_is_model_visible_in_summary(item: &Value) -> bool {
    let asset_namespace = item.get("asset_namespace").and_then(Value::as_str);
    let callable = item
        .get("status")
        .and_then(|status| status.get("callable"))
        .and_then(Value::as_bool);

    !matches!((asset_namespace, callable), (Some("user_mcp"), Some(false)))
}

fn serialize_search_items(items: &[Value], detail_level: SearchSdkDetailLevel) -> Vec<Value> {
    items
        .iter()
        .map(|item| match detail_level {
            SearchSdkDetailLevel::Summary => summarize_search_item(item),
            SearchSdkDetailLevel::Full => item.clone(),
        })
        .collect()
}

fn summarize_search_item(item: &Value) -> Value {
    let Some(object) = item.as_object() else {
        return item.clone();
    };

    let mut summary = Map::new();
    for key in [
        "capability_id",
        "name",
        "description",
        "semantic_kind",
        "asset_namespace",
        "invocation_mode",
        "read_only",
        "mutating",
        "risk_level",
        "recipe_kind",
        "skill_id",
        "recommended_path",
        "recommended_next_tool",
        "activation_available",
        "primitive_kind",
        "docs_excerpt",
    ] {
        copy_non_null_field(&mut summary, object, key);
    }

    let schema_available = object
        .get("schema_available")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || object
            .get("input_schema")
            .map(Value::is_object)
            .unwrap_or(false);
    if schema_available {
        summary.insert("schema_available".to_string(), Value::Bool(true));
    }

    if let Some(status) = object.get("status").and_then(Value::as_object) {
        let mut status_summary = Map::new();
        for key in ["callable", "recommended_action", "reason"] {
            copy_non_null_field(&mut status_summary, status, key);
        }
        if !status_summary.is_empty() {
            summary.insert("status".to_string(), Value::Object(status_summary));
        }
    }

    Value::Object(summary)
}

fn build_capability_groups(items: &[Value], detail_level: SearchSdkDetailLevel) -> Value {
    json!({
        "skill_tools": collect_group_items(items, detail_level, |item| item.get("asset_namespace").and_then(Value::as_str) == Some("skill")),
        "user_mcp_tools": collect_group_items(items, detail_level, |item| item.get("asset_namespace").and_then(Value::as_str) == Some("user_mcp")),
        "core_tools": collect_group_items(items, detail_level, |item| item.get("asset_namespace").and_then(Value::as_str) == Some("core")),
    })
}

fn build_recipe_groups(items: &[Value], detail_level: SearchSdkDetailLevel) -> Value {
    json!({
        "skills": collect_recipe_group_items(items, detail_level, |item| item.get("asset_namespace").and_then(Value::as_str) == Some("skill")),
        "assistants": collect_recipe_group_items(items, detail_level, |item| item.get("asset_type").and_then(Value::as_str) == Some("assistant")),
    })
}

fn collect_recipe_group_items<F>(
    items: &[Value],
    detail_level: SearchSdkDetailLevel,
    predicate: F,
) -> Vec<Value>
where
    F: Fn(&Value) -> bool,
{
    items
        .iter()
        .filter(|item| predicate(item))
        .map(|item| match detail_level {
            SearchSdkDetailLevel::Summary => summarize_recipe_group_item(item),
            SearchSdkDetailLevel::Full => item.clone(),
        })
        .collect()
}

fn summarize_recipe_group_item(item: &Value) -> Value {
    let Some(object) = item.as_object() else {
        return item.clone();
    };

    let mut summary = Map::new();
    for key in [
        "name",
        "description",
        "skill_id",
        "recipe_kind",
        "recommended_path",
        "recommended_next_tool",
        "activation_available",
    ] {
        copy_non_null_field(&mut summary, object, key);
    }
    Value::Object(summary)
}

fn collect_group_items<F>(
    items: &[Value],
    detail_level: SearchSdkDetailLevel,
    predicate: F,
) -> Vec<Value>
where
    F: Fn(&Value) -> bool,
{
    items
        .iter()
        .filter(|item| predicate(item))
        .map(|item| match detail_level {
            SearchSdkDetailLevel::Summary => {
                item.get("name").cloned().unwrap_or_else(|| Value::Null)
            }
            SearchSdkDetailLevel::Full => item.clone(),
        })
        .collect()
}

fn dedupe_ranked_capabilities(ranked: Vec<RankedCapability>) -> Vec<RankedCapability> {
    let mut seen = HashSet::new();
    ranked
        .into_iter()
        .filter(|item| {
            capability_dedupe_key(&item.value)
                .map(|key| seen.insert(key))
                .unwrap_or(true)
        })
        .collect()
}

fn capability_dedupe_key(value: &Value) -> Option<String> {
    value
        .get("name")
        .and_then(|item| item.as_str())
        .or_else(|| value.get("capability_id").and_then(|item| item.as_str()))
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.to_lowercase())
}

fn rank_registry_entry_with_feedback(
    entry: CapabilityRegistryEntry,
    profile: &QueryProfile,
    feedback_context: &SearchFeedbackContext,
    retrieval_scores: &RetrievalScoreMaps,
) -> Option<RankedCapability> {
    let CapabilityRegistryEntry {
        asset,
        availability,
        tool_contract_source,
    } = entry;
    let id = asset.get("id")?.as_str()?.trim().to_string();
    let name = asset
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let description = asset
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let asset_type = asset
        .get("asset_type")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let source_type = asset
        .get("source_type")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let pkg_name = asset
        .get("pkg_name")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let asset_metadata = asset.get("metadata").cloned();
    let assistant_id = if asset_type == "assistant" {
        Some(id.clone())
    } else {
        None
    };
    let rank = compute_rank_computation(
        profile,
        asset_score_key(&asset)
            .as_deref()
            .and_then(|key| retrieval_scores.bm25.get(key))
            .copied(),
        asset_score_key(&asset)
            .as_deref()
            .and_then(|key| retrieval_scores.structured.get(key))
            .copied(),
        asset_score_key(&asset)
            .as_deref()
            .and_then(|key| retrieval_scores.semantic.get(key))
            .copied(),
        asset_score_key(&asset)
            .as_deref()
            .and_then(|key| retrieval_scores.fused.get(key))
            .copied(),
        name,
        description,
        asset_type,
        source_type,
        &availability,
        asset_metadata.as_ref(),
        tool_contract_source.as_ref(),
        feedback_context,
    );
    let has_signal = rank.lexical_score.is_some()
        || rank.structured_score.is_some()
        || rank.semantic_score.is_some()
        || rank.fused_retrieval_score.is_some()
        || rank.domain_hit
        || rank.intent_hit
        || rank.feature_score != 0.0
        || rank.feedback_score != 0.0;
    if !has_signal {
        return None;
    }

    let mut rank_score = 0.0;
    let mut match_reason = Vec::new();
    if let Some(score) = rank.lexical_score {
        match_reason.push(format!("bm25:{score:.2}"));
    }
    if let Some(score) = rank.structured_score {
        match_reason.push(format!("structured_match:{score:.2}"));
    }
    if let Some(score) = rank.semantic_score {
        match_reason.push(format!("semantic:{score:.2}"));
    }
    if let Some(score) = rank.fused_retrieval_score {
        rank_score += score * RETRIEVAL_FUSION_WEIGHT;
        match_reason.push(format!("rrf:{score:.2}"));
    }
    if rank.domain_hit {
        rank_score += 14.0;
        match_reason.push(format!("domain:{}", profile.domain));
    }
    if rank.intent_hit {
        rank_score += 10.0;
        match_reason.push(format!("intent:{}", profile.intent));
    }
    rank_score += rank.feature_score;
    match_reason.extend(rank.feature_reasons);
    rank_score += rank.feedback_score;
    match_reason.extend(rank.feedback_reasons);
    if availability.is_direct_callable() {
        rank_score += 12.0;
        match_reason.push("direct_callable".to_string());
    } else if availability.needs_setup() {
        rank_score += if profile.wants_recipes { 12.0 } else { 2.0 };
        match_reason.push(availability.status_reason.to_string());
    } else {
        rank_score += 1.0;
        match_reason.push(availability.status_reason.to_string());
    }
    if asset_type == "assistant" {
        rank_score -= 4.0;
    }
    if rank_score < MIN_RANK_SCORE {
        return None;
    }

    let has_tool_contract = availability.is_direct_callable()
        && matches!(asset_type, "tool" | "skill_tool")
        && build_tool_contract(
            name,
            description,
            source_type,
            asset_metadata.as_ref(),
            tool_contract_source.as_ref(),
        )
        .is_some();
    let mut value = materialize_ranked_entry(
        &id,
        name,
        description,
        asset_type,
        source_type,
        pkg_name,
        assistant_id,
        asset_metadata.as_ref(),
        &availability,
        match_reason,
        rank.structured_score,
        rank.lexical_score,
        rank_score,
        has_tool_contract,
    );
    if has_tool_contract {
        if let Some(contract) = build_tool_contract(
            name,
            description,
            source_type,
            asset_metadata.as_ref(),
            tool_contract_source.as_ref(),
        ) {
            merge_object(&mut value, contract);
        }
    }

    Some(RankedCapability {
        score: rank_score,
        value,
    })
}

fn compute_rank_computation(
    profile: &QueryProfile,
    bm25_score: Option<f64>,
    structured_score: Option<f64>,
    semantic_score: Option<f64>,
    fused_retrieval_score: Option<f64>,
    name: &str,
    description: &str,
    asset_type: &str,
    source_type: &str,
    availability: &RegistryAvailability,
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
    feedback_context: &SearchFeedbackContext,
) -> RankComputation {
    let combined_text = format!("{}\n{}", name.to_lowercase(), description.to_lowercase());
    let domain_hit = matches_domain(profile.domain, &combined_text);
    let intent_hit = matches_intent(profile.intent, &combined_text, asset_type, source_type);
    let (feature_score, feature_reasons) = capability_profile_feature_score(
        profile,
        asset_type,
        source_type,
        availability,
        asset_metadata,
        tool_source,
    );
    let feedback_boost = compute_feedback_boost(name, feedback_context);

    RankComputation {
        lexical_score: bm25_score,
        structured_score,
        semantic_score,
        fused_retrieval_score,
        domain_hit,
        intent_hit,
        feature_score,
        feature_reasons,
        feedback_score: feedback_boost.score,
        feedback_reasons: feedback_boost.reasons,
    }
}

async fn build_retrieval_score_maps(
    entries: &[CapabilityRegistryEntry],
    profile: &QueryProfile,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query_vector: Option<Vec<f32>>,
) -> RetrievalScoreMaps {
    let assets = entries
        .iter()
        .map(|entry| entry.asset.clone())
        .collect::<Vec<_>>();
    let bm25 = bm25_asset_match_scores(&profile.normalized, &assets);

    let structured = entries
        .iter()
        .filter_map(|entry| {
            let key = asset_score_key(&entry.asset)?;
            let score = capability_structured_match_score(
                profile,
                entry
                    .asset
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                entry
                    .asset
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                entry
                    .asset
                    .get("asset_type")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown"),
                entry
                    .asset
                    .get("source_type")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown"),
                entry.asset.get("metadata"),
                entry.tool_contract_source.as_ref(),
            )?;
            (score >= SEMANTIC_SCORE_FLOOR).then_some((key, score))
        })
        .collect::<std::collections::HashMap<_, _>>();

    let semantic_vector = if let Some(vector) = query_vector {
        Some(vector)
    } else if should_run_semantic_recall(&profile.normalized) {
        embedding_service.embed_text(&profile.normalized).await.ok()
    } else {
        None
    };
    let semantic = if let Some(query_vector) = semantic_vector {
        if let Ok(rows) = memory_store
            .search_assets(query_vector, entries.len().max(8), None)
            .await
        {
            normalize_score_map(
                rows.into_iter()
                    .enumerate()
                    .filter_map(|(index, row)| {
                        let key = asset_score_key(&row)?;
                        Some((key, 1.0 / (index as f64 + 1.0)))
                    })
                    .collect::<std::collections::HashMap<_, _>>(),
            )
        } else {
            std::collections::HashMap::new()
        }
    } else {
        std::collections::HashMap::new()
    };

    let fused = reciprocal_rank_fusion(&[&bm25, &structured, &semantic]);

    RetrievalScoreMaps {
        bm25,
        structured,
        semantic,
        fused,
    }
}

fn capability_structured_match_score(
    profile: &QueryProfile,
    name: &str,
    description: &str,
    asset_type: &str,
    source_type: &str,
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
) -> Option<f64> {
    let mut text = vec![
        name.to_lowercase(),
        description.to_lowercase(),
        asset_type.to_lowercase(),
        source_type.to_lowercase(),
    ];

    if let Some(metadata) = asset_metadata {
        for field in [
            "binding_kind",
            "callable_name",
            "tool_name",
            "execution_lane",
            "execution_surface",
            "runtime_state",
            "adapter_kind",
        ] {
            if let Some(value) = metadata.get(field).and_then(Value::as_str) {
                let normalized = value.trim().to_lowercase();
                if !normalized.is_empty() {
                    text.push(normalized);
                }
            }
        }
        if let Some(compatibility) = metadata.get("compatibility") {
            for field in [
                "normalized_execution_surface",
                "execution_mode",
                "adapter_kind",
            ] {
                if let Some(value) = compatibility.get(field).and_then(Value::as_str) {
                    let normalized = value.trim().to_lowercase();
                    if !normalized.is_empty() {
                        text.push(normalized);
                    }
                }
            }
        }
        if let Some(schema) = metadata.get("input_schema") {
            append_schema_terms(&mut text, schema);
        }
        if let Some(scope) = metadata.get("permission_scope") {
            append_value_terms(&mut text, scope);
        }
    }

    if let Some(source) = tool_source {
        text.extend(
            source
                .capabilities
                .iter()
                .map(|value| value.trim().to_lowercase()),
        );
        if let Some(command) = source.command.as_ref() {
            let normalized = command.trim().to_lowercase();
            if !normalized.is_empty() {
                text.push(normalized);
            }
        }
        append_schema_terms(&mut text, &source.config);
    }

    let haystack = text
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    lexical_text_match_score(&profile.normalized, &haystack)
}

fn capability_profile_feature_score(
    profile: &QueryProfile,
    asset_type: &str,
    source_type: &str,
    availability: &RegistryAvailability,
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
) -> (f64, Vec<String>) {
    let mut score = 0.0;
    let mut reasons = Vec::new();
    let signals = capability_signals(asset_type, source_type, asset_metadata, tool_source);

    match profile.intent {
        "local_inspection" => {
            if signals.shell_like {
                score += 36.0;
                reasons.push("feature:host_shell".to_string());
            }
            if signals.filesystem_like {
                score += 12.0;
                reasons.push("feature:filesystem".to_string());
            }
            if signals.memory_like {
                score -= 18.0;
                reasons.push("penalty:memory_domain".to_string());
            }
            if signals.web_like {
                score -= 18.0;
                reasons.push("penalty:web_domain".to_string());
            }
            if signals.monitor_like {
                score -= 18.0;
                reasons.push("penalty:monitor_domain".to_string());
            }
            if !availability.is_direct_callable() {
                score -= 10.0;
                reasons.push("penalty:not_direct_callable".to_string());
            }
        }
        "web_fetch" => {
            if signals.web_like {
                score += 28.0;
                reasons.push("feature:web_fetch".to_string());
            }
            if signals.shell_like {
                score -= 8.0;
                reasons.push("penalty:not_web_shell".to_string());
            }
        }
        "memory_lookup" => {
            if signals.memory_like {
                score += 24.0;
                reasons.push("feature:memory_lookup".to_string());
            }
        }
        "delegation" => {
            if signals.delegation_like {
                score += 34.0;
                reasons.push("feature:delegation".to_string());
            }
            if signals.shell_like || signals.web_like || signals.memory_like {
                score -= 6.0;
                reasons.push("penalty:delegate_not_specialized".to_string());
            }
        }
        _ => {}
    }

    if profile.domain == "memory" {
        if signals.memory_like {
            score += 28.0;
            reasons.push("feature:memory_domain".to_string());
        }
        if signals.web_like {
            score -= 14.0;
            reasons.push("penalty:not_memory_web".to_string());
        }
        if signals.shell_like {
            score -= 14.0;
            reasons.push("penalty:not_memory_shell".to_string());
        }
        if signals.monitor_like {
            score -= 10.0;
            reasons.push("penalty:not_memory_monitor".to_string());
        }
    }

    (score, reasons)
}

#[derive(Default)]
struct CapabilitySignals {
    shell_like: bool,
    filesystem_like: bool,
    web_like: bool,
    memory_like: bool,
    monitor_like: bool,
    delegation_like: bool,
}

fn capability_signals(
    asset_type: &str,
    source_type: &str,
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
) -> CapabilitySignals {
    let mut text = String::new();
    text.push_str(asset_type);
    text.push('\n');
    text.push_str(source_type);
    if let Some(metadata) = asset_metadata {
        text.push('\n');
        text.push_str(&metadata.to_string().to_lowercase());
    }
    if let Some(source) = tool_source {
        text.push('\n');
        text.push_str(&source.config.to_string().to_lowercase());
        text.push('\n');
        text.push_str(&source.capabilities.join(" ").to_lowercase());
        if let Some(command) = source.command.as_ref() {
            text.push('\n');
            text.push_str(&command.to_lowercase());
        }
    }

    CapabilitySignals {
        shell_like: contains_any(
            &text,
            &[
                "shell",
                "terminal",
                "command",
                "powershell",
                "cmd",
                "host_access",
                "shell_execution",
                "local_command",
                "working_dir",
                "working directory",
            ],
        ),
        filesystem_like: contains_any(
            &text,
            &["filesystem", "file", "directory", "path", "entry_path"],
        ),
        web_like: contains_any(
            &text,
            &[
                "web",
                "url",
                "html",
                "crawl",
                "fetch",
                "http",
                "network_read",
                "browser",
            ],
        ),
        memory_like: contains_any(
            &text,
            &["memory", "knowledge", "remember", "memo", "knowledge base"],
        ),
        monitor_like: contains_any(&text, &["monitor", "cron", "watch", "alert"]),
        delegation_like: contains_any(
            &text,
            &[
                "delegate",
                "delegation",
                "delegated",
                "subtask",
                "specialist",
                "custom task agent",
                "agent_delegation",
                "delegated_result",
                "worker",
                "委派",
                "子任务",
                "智能体",
                "代理",
            ],
        ),
    }
}

fn lexical_text_match_score(normalized_query: &str, haystack: &str) -> Option<f64> {
    if normalized_query.trim().is_empty() || haystack.trim().is_empty() {
        return None;
    }
    if haystack.contains(normalized_query) {
        return Some(1.0);
    }
    let overlap = tokenize(normalized_query)
        .into_iter()
        .filter(|token| !token.is_empty() && haystack.contains(token))
        .count();
    if overlap == 0 {
        return None;
    }
    let denom = tokenize(normalized_query).len().max(1) as f64;
    Some((overlap as f64 / denom).min(1.0))
}

fn append_value_terms(target: &mut Vec<String>, value: &Value) {
    match value {
        Value::String(text) => {
            let normalized = text.trim().to_lowercase();
            if !normalized.is_empty() {
                target.push(normalized);
            }
        }
        Value::Array(items) => {
            for item in items {
                append_value_terms(target, item);
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                target.push(key.trim().to_lowercase());
                append_value_terms(target, item);
            }
        }
        _ => {}
    }
}

fn append_schema_terms(target: &mut Vec<String>, schema: &Value) {
    append_value_terms(target, schema);
}

fn materialize_ranked_entry(
    id: &str,
    name: &str,
    description: &str,
    asset_type: &str,
    source_type: &str,
    pkg_name: Option<String>,
    assistant_id: Option<String>,
    asset_metadata: Option<&Value>,
    availability: &RegistryAvailability,
    match_reason: Vec<String>,
    semantic_score: Option<f64>,
    lexical_score: Option<f64>,
    rank_score: f64,
    has_tool_contract: bool,
) -> Value {
    let asset_namespace =
        resolve_asset_namespace(asset_type, source_type, pkg_name.as_deref(), asset_metadata);
    let skill_backed_tool =
        asset_namespace == "skill" && matches!(asset_type, "tool" | "skill_tool");
    let group = classify_semantic_group(
        name,
        asset_type,
        pkg_name.as_deref(),
        availability,
        has_tool_contract,
    );
    let mut value = json!({
        "capability_id": id,
        "name": name,
        "description": description,
        "asset_type": asset_type,
        "asset_namespace": asset_namespace,
        "source": format!("local_{}", source_type),
        "pkg_name": pkg_name,
        "assistant_id": assistant_id,
        "status": {
            "class": availability.class,
            "callable": availability.is_direct_callable(),
            "install_required": availability.install_required,
            "activation_required": availability.activation_required,
            "recommended_action": availability.recommended_action,
            "reason": availability.status_reason,
        },
        "match_reason": match_reason,
        "semantic_score": semantic_score,
        "lexical_score": lexical_score,
        "rank_score": rank_score,
    });

    if let Some(object) = value.as_object_mut() {
        if let Some(metadata) = asset_metadata {
            for field in [
                "activation_state",
                "runtime_state",
                "search_index_state",
                "generation",
                "execution_surface",
            ] {
                if let Some(value) = metadata.get(field) {
                    object.insert(field.to_string(), value.clone());
                }
            }
            if let Some(binding_id) = metadata.get("binding_id") {
                object.insert("binding_id".to_string(), binding_id.clone());
            }
            if let Some(execution_lane) = metadata.get("execution_lane") {
                object.insert("execution_lane".to_string(), execution_lane.clone());
            }
            if let Some(compatibility) = metadata.get("compatibility") {
                if let Some(adapter_kind) = compatibility.get("adapter_kind") {
                    object.insert("adapter_kind".to_string(), adapter_kind.clone());
                }
                if let Some(normalized_execution_surface) =
                    compatibility.get("normalized_execution_surface")
                {
                    object.insert(
                        "normalized_execution_surface".to_string(),
                        normalized_execution_surface.clone(),
                    );
                }
                if let Some(runnable_now) = compatibility
                    .get("eligibility")
                    .and_then(|value| value.get("runnable_now"))
                {
                    object.insert("runnable_now".to_string(), runnable_now.clone());
                }
                if let Some(missing_env) = compatibility
                    .get("eligibility")
                    .and_then(|value| value.get("missing_env"))
                {
                    object.insert("missing_env".to_string(), missing_env.clone());
                }
                if let Some(missing_config) = compatibility
                    .get("eligibility")
                    .and_then(|value| value.get("missing_config"))
                {
                    object.insert("missing_config".to_string(), missing_config.clone());
                }
                let blocking_reason = if compatibility
                    .get("eligibility")
                    .and_then(|value| value.get("runnable_now"))
                    .and_then(Value::as_bool)
                    == Some(false)
                {
                    Some(json!(compatibility
                        .get("normalized_execution_surface")
                        .or_else(|| compatibility.get("execution_mode"))
                        .and_then(Value::as_str)
                        .unwrap_or("not_runnable")))
                } else {
                    None
                };
                if let Some(blocking_reason) = blocking_reason {
                    object.insert("blocking_reason".to_string(), blocking_reason);
                }
            }
            if let Some(status) = object.get_mut("status").and_then(Value::as_object_mut) {
                for field in [
                    "activation_state",
                    "runtime_state",
                    "search_index_state",
                    "generation",
                ] {
                    if let Some(value) = metadata.get(field) {
                        status.insert(field.to_string(), value.clone());
                    }
                }
            }
        }
        match group {
            SemanticGroup::Capability => {
                object.insert("semantic_kind".to_string(), json!("capability"));
                object.insert("invocation_mode".to_string(), json!("direct"));
                object.insert(
                    "execution_plane".to_string(),
                    json!(asset_metadata
                        .and_then(|metadata| metadata.get("execution_lane"))
                        .and_then(Value::as_str)
                        .unwrap_or("host")),
                );
            }
            SemanticGroup::Recipe => {
                object.insert("semantic_kind".to_string(), json!("recipe"));
                object.insert("recipe_kind".to_string(), json!(asset_type));
                object.insert("recommended_path".to_string(), json!("activate_skill"));
                object.insert(
                    "activation_available".to_string(),
                    json!(asset_type == "skill" || skill_backed_tool),
                );
                object.insert("recommended_next_tool".to_string(), json!("activate_skill"));
                if asset_type == "skill" || skill_backed_tool {
                    if let Some(skill_id) = object
                        .get("id")
                        .or_else(|| object.get("pkg_name"))
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                    {
                        object.insert("skill_id".to_string(), json!(skill_id));
                    }
                    if let Some(metadata) = asset_metadata {
                        if let Some(compatibility) = metadata.get("compatibility") {
                            object.insert("compatibility".to_string(), compatibility.clone());
                        }
                        if let Some(source_metadata) = metadata.get("source_metadata") {
                            if let Some(doc_excerpt) = source_metadata
                                .get("doc_excerpt")
                                .and_then(|value| value.as_str())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                            {
                                object.insert("docs_excerpt".to_string(), json!(doc_excerpt));
                            }
                            if let Some(doc_paths) = source_metadata.get("doc_paths") {
                                object.insert("docs_paths".to_string(), doc_paths.clone());
                            }
                            if let Some(assets) = source_metadata.get("assets") {
                                object.insert("bundle_assets".to_string(), assets.clone());
                            }
                        }
                        if let Some(entry) = metadata.get("entry") {
                            object.insert("entry".to_string(), entry.clone());
                        }
                    }
                }
            }
            SemanticGroup::OrchestrationPrimitive => {
                object.insert(
                    "semantic_kind".to_string(),
                    json!("orchestration_primitive"),
                );
                object.insert("primitive_kind".to_string(), json!("discovery"));
                object.insert("invocation_mode".to_string(), json!("direct"));
                object.insert("execution_plane".to_string(), json!("host"));
            }
        }
    }

    value
}

fn classify_semantic_group(
    name: &str,
    asset_type: &str,
    pkg_name: Option<&str>,
    availability: &RegistryAvailability,
    has_tool_contract: bool,
) -> SemanticGroup {
    if matches!(name.trim(), "search_sdk") {
        return SemanticGroup::OrchestrationPrimitive;
    }
    if asset_type == "skill_tool"
        || (asset_type == "tool" && pkg_name.is_some_and(|value| value.starts_with("skill.")))
    {
        return if availability.is_direct_callable() && has_tool_contract {
            SemanticGroup::Capability
        } else {
            SemanticGroup::Recipe
        };
    }
    match asset_type {
        "skill" | "assistant" => SemanticGroup::Recipe,
        _ => SemanticGroup::Capability,
    }
}

fn push_semantic_group(
    item: Value,
    capabilities: &mut Vec<Value>,
    recipes: &mut Vec<Value>,
    orchestration_primitives: &mut Vec<Value>,
) {
    match item
        .get("semantic_kind")
        .and_then(|value| value.as_str())
        .unwrap_or("capability")
    {
        "recipe" => recipes.push(item),
        "orchestration_primitive" => orchestration_primitives.push(item),
        _ => capabilities.push(item),
    }
}

fn resolve_asset_namespace(
    asset_type: &str,
    source_type: &str,
    pkg_name: Option<&str>,
    asset_metadata: Option<&Value>,
) -> &'static str {
    if matches!(asset_type, "skill" | "skill_tool") {
        return "skill";
    }
    if matches!(asset_type, "assistant") {
        return "assistant";
    }
    if matches!(source_type, "desktop_runtime_core") {
        return "core";
    }
    if asset_metadata
        .and_then(|metadata| metadata.get("asset_namespace"))
        .and_then(Value::as_str)
        == Some("skill")
    {
        return "skill";
    }
    if source_type == "mcp" || pkg_name.is_some_and(|value| value.starts_with("mcp.")) {
        return "user_mcp";
    }
    "local"
}

fn build_tool_contract(
    tool_name: &str,
    description: &str,
    asset_source_type: &str,
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
) -> Option<Value> {
    let input_schema = resolve_tool_input_schema(asset_metadata, tool_source)?;
    let output_schema = resolve_tool_output_schema(asset_metadata, tool_source)
        .unwrap_or_else(default_output_schema);
    let parameter_docs = build_parameter_docs(&input_schema);
    let required_parameters = parameter_docs
        .iter()
        .filter(|param| param.required)
        .map(|param| Value::String(param.name.clone()))
        .collect::<Vec<_>>();
    let parameters = parameter_docs
        .iter()
        .map(parameter_doc_to_value)
        .collect::<Vec<_>>();
    let permission_scope = build_permission_scope(asset_source_type, asset_metadata, tool_source);
    let read_only = resolve_read_only(asset_metadata, tool_source);
    let mutating = resolve_mutating(asset_metadata, tool_source, &permission_scope, read_only);
    let risk_level = resolve_risk_level(asset_metadata, tool_source, &permission_scope, mutating);
    Some(json!({
        "input_schema": input_schema,
        "output_schema": output_schema,
        "parameters": parameters,
        "required_parameters": required_parameters,
        "signature": build_signature(tool_name, &parameter_docs),
        "python_stub": build_python_stub(tool_name, description, &parameter_docs),
        "example_arguments": build_example_arguments(&parameter_docs),
        "permission_scope": permission_scope,
        "read_only": read_only,
        "mutating": mutating,
        "risk_level": risk_level,
    }))
}

fn resolve_tool_input_schema(
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
) -> Option<Value> {
    [tool_source.map(|source| &source.config), asset_metadata]
        .into_iter()
        .flatten()
        .find_map(extract_input_schema)
}

fn resolve_tool_output_schema(
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
) -> Option<Value> {
    [tool_source.map(|source| &source.config), asset_metadata]
        .into_iter()
        .flatten()
        .find_map(extract_output_schema)
}

fn extract_input_schema(source: &Value) -> Option<Value> {
    if let Some(schema) = source.get("input_schema") {
        return normalize_input_schema(schema);
    }
    if let Some(schema) = source.get("parameters") {
        return normalize_input_schema(schema);
    }
    source
        .get("function")
        .and_then(|value| value.get("parameters"))
        .and_then(normalize_input_schema)
}

fn extract_output_schema(source: &Value) -> Option<Value> {
    for key in ["output_schema", "result_schema", "returns"] {
        if let Some(schema) = source.get(key) {
            return normalize_schema_object(schema);
        }
    }
    source
        .get("function")
        .and_then(|value| value.get("output_schema"))
        .and_then(normalize_schema_object)
}

fn normalize_input_schema(raw: &Value) -> Option<Value> {
    normalize_schema_object(raw).map(|schema| ensure_object_schema(schema, true))
}

fn normalize_schema_object(raw: &Value) -> Option<Value> {
    let object = raw.as_object()?;
    Some(Value::Object(object.clone()))
}

fn ensure_object_schema(schema: Value, force_object: bool) -> Value {
    let mut normalized = schema.as_object().cloned().unwrap_or_default();
    let schema_type = normalized
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or(if force_object { "object" } else { "object" })
        .to_string();
    if !normalized.contains_key("type") {
        normalized.insert("type".to_string(), Value::String("object".to_string()));
    }
    if force_object && schema_type != "object" {
        normalized.insert("type".to_string(), Value::String("object".to_string()));
    }
    if normalized.get("type").and_then(|value| value.as_str()) == Some("object")
        && !normalized.contains_key("properties")
    {
        normalized.insert("properties".to_string(), Value::Object(Map::new()));
    }
    Value::Object(normalized)
}

fn default_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": true
    })
}

fn build_permission_scope(
    asset_source_type: &str,
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
) -> Vec<String> {
    let mut scope = BTreeSet::new();
    if !asset_source_type.trim().is_empty() {
        scope.insert(format!(
            "source:{}",
            asset_source_type.trim().to_lowercase()
        ));
    }
    if let Some(metadata) = asset_metadata {
        extend_string_set_from_value(&mut scope, metadata.get("permission_scope"));
        extend_string_set_from_value(&mut scope, metadata.get("permissions"));
        extend_string_set_from_value(&mut scope, metadata.get("granted_permissions"));
        extend_string_set_from_value(&mut scope, metadata.get("capabilities"));
    }
    if let Some(source) = tool_source {
        for capability in &source.capabilities {
            let normalized = capability.trim().to_lowercase();
            if !normalized.is_empty() {
                scope.insert(normalized);
            }
        }
        if source.is_read_only {
            scope.insert("read_only".to_string());
        }
        if source
            .command
            .as_ref()
            .map(|cmd| !cmd.trim().is_empty())
            .unwrap_or(false)
        {
            scope.insert("local_command".to_string());
        }
        if !source.source_type.trim().is_empty() {
            scope.insert(format!(
                "source:{}",
                source.source_type.trim().to_lowercase()
            ));
        }
    }
    scope.into_iter().collect()
}

fn extend_string_set_from_value(target: &mut BTreeSet<String>, value: Option<&Value>) {
    let Some(value) = value else {
        return;
    };
    match value {
        Value::Array(items) => {
            for item in items {
                if let Some(text) = item.as_str() {
                    let normalized = text.trim().to_lowercase();
                    if !normalized.is_empty() {
                        target.insert(normalized);
                    }
                }
            }
        }
        Value::String(text) => {
            let normalized = text.trim().to_lowercase();
            if !normalized.is_empty() {
                target.insert(normalized);
            }
        }
        _ => {}
    }
}

fn resolve_read_only(
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
) -> bool {
    asset_metadata
        .and_then(|metadata| metadata.get("read_only"))
        .and_then(|value| value.as_bool())
        .or_else(|| tool_source.map(|source| source.is_read_only))
        .unwrap_or(false)
}

fn resolve_mutating(
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
    permission_scope: &[String],
    read_only: bool,
) -> bool {
    if let Some(value) = asset_metadata
        .and_then(|metadata| metadata.get("mutating"))
        .and_then(|value| value.as_bool())
    {
        return value;
    }
    if read_only {
        return false;
    }
    if tool_source
        .and_then(|source| source.command.as_ref())
        .map(|cmd| !cmd.trim().is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    permission_scope.iter().any(|value| {
        value.contains("write")
            || value.contains("delete")
            || value.contains("update")
            || value.contains("install")
            || value.contains("filesystem")
            || value.contains("shell")
            || value.contains("terminal")
    })
}

fn resolve_risk_level(
    asset_metadata: Option<&Value>,
    tool_source: Option<&ToolContractSource>,
    permission_scope: &[String],
    mutating: bool,
) -> String {
    if let Some(value) = asset_metadata
        .and_then(|metadata| metadata.get("risk_level"))
        .and_then(|value| value.as_str())
    {
        return value.to_string();
    }
    let has_command = tool_source
        .and_then(|source| source.command.as_ref())
        .map(|cmd| !cmd.trim().is_empty())
        .unwrap_or(false);
    if has_command
        || permission_scope.iter().any(|value| {
            value.contains("shell")
                || value.contains("terminal")
                || value.contains("install")
                || value.contains("filesystem")
                || value.contains("write")
        })
    {
        return "HIGH".to_string();
    }
    if mutating
        || permission_scope
            .iter()
            .any(|value| value.contains("network") || value.contains("assistant"))
    {
        return "MEDIUM".to_string();
    }
    "LOW".to_string()
}

fn build_parameter_docs(input_schema: &Value) -> Vec<ParameterDoc> {
    let properties = input_schema
        .get("properties")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    let required = input_schema
        .get("required")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(|item| item.to_string()))
        .collect::<HashSet<_>>();
    let mut docs = properties
        .into_iter()
        .map(|(name, prop)| {
            let prop_schema = prop.as_object().cloned().unwrap_or_default();
            ParameterDoc {
                name: name.clone(),
                type_name: json_schema_type_name(&prop_schema),
                python_type: json_schema_to_python_type(&prop_schema),
                required: required.contains(&name),
                description: prop_schema
                    .get("description")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                default: prop_schema.get("default").cloned(),
                enum_values: prop_schema
                    .get("enum")
                    .and_then(|value| value.as_array())
                    .cloned(),
                example: prop_schema.get("example").cloned(),
            }
        })
        .collect::<Vec<_>>();
    docs.sort_by(|left, right| {
        right
            .required
            .cmp(&left.required)
            .then_with(|| left.name.cmp(&right.name))
    });
    docs
}

fn parameter_doc_to_value(param: &ParameterDoc) -> Value {
    let mut value = json!({
        "name": param.name,
        "type": param.type_name,
        "python_type": param.python_type,
        "required": param.required,
        "description": param.description,
    });
    if let Some(object) = value.as_object_mut() {
        if let Some(default) = &param.default {
            object.insert("default".to_string(), default.clone());
        }
        if let Some(enum_values) = &param.enum_values {
            object.insert("enum".to_string(), Value::Array(enum_values.clone()));
        }
        if let Some(example) = &param.example {
            object.insert("example".to_string(), example.clone());
        }
    }
    value
}

fn build_signature(tool_name: &str, parameter_docs: &[ParameterDoc]) -> String {
    let parts = parameter_docs
        .iter()
        .map(|param| {
            let mut fragment = format!(
                "{}{}:{}",
                param.name,
                if param.required { "" } else { "?" },
                param.type_name
            );
            if !param.required {
                if let Some(default) = &param.default {
                    fragment.push('=');
                    fragment.push_str(&format_literal(default));
                }
            }
            fragment
        })
        .collect::<Vec<_>>();
    format!("{}({}) -> dict[str, Any]", tool_name, parts.join(", "))
}

fn build_python_stub(
    tool_name: &str,
    description: &str,
    parameter_docs: &[ParameterDoc],
) -> String {
    let params = parameter_docs
        .iter()
        .map(|param| {
            if param.required {
                format!(
                    "{}: {}",
                    safe_python_identifier(&param.name),
                    param.python_type
                )
            } else if let Some(default) = &param.default {
                format!(
                    "{}: {} = {}",
                    safe_python_identifier(&param.name),
                    param.python_type,
                    format_literal(default)
                )
            } else {
                format!(
                    "{}: {} | None = None",
                    safe_python_identifier(&param.name),
                    param.python_type
                )
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "def {}({}) -> dict[str, Any]:\n    \"\"\"{}\"\"\"\n    ...",
        safe_python_identifier(tool_name),
        params,
        description.replace('"', "\\\"")
    )
}

fn build_example_arguments(parameter_docs: &[ParameterDoc]) -> Value {
    let mut example = serde_json::Map::new();
    for param in parameter_docs {
        let include = param.required
            || param.default.is_some()
            || param.example.is_some()
            || param
                .enum_values
                .as_ref()
                .map(|items| !items.is_empty())
                .unwrap_or(false);
        if !include {
            continue;
        }
        example.insert(param.name.clone(), example_value_for_parameter(param));
    }
    Value::Object(example)
}

fn example_value_for_parameter(param: &ParameterDoc) -> Value {
    if let Some(example) = &param.example {
        return example.clone();
    }
    if let Some(default) = &param.default {
        return default.clone();
    }
    if let Some(enum_values) = &param.enum_values {
        if let Some(first) = enum_values.first() {
            return first.clone();
        }
    }
    match param.type_name.as_str() {
        "string" => Value::String("<string>".to_string()),
        "integer" => Value::Number(0.into()),
        "number" => json!(0.0),
        "boolean" => Value::Bool(false),
        "array" => Value::Array(Vec::new()),
        "object" => Value::Object(serde_json::Map::new()),
        _ => Value::Null,
    }
}

fn json_schema_type_name(schema: &serde_json::Map<String, Value>) -> String {
    match schema.get("type") {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_str())
            .next()
            .unwrap_or("any")
            .to_string(),
        _ => "any".to_string(),
    }
}

fn json_schema_to_python_type(schema: &serde_json::Map<String, Value>) -> String {
    match schema.get("type") {
        Some(Value::String(value)) if value == "string" => "str".to_string(),
        Some(Value::String(value)) if value == "integer" => "int".to_string(),
        Some(Value::String(value)) if value == "number" => "float".to_string(),
        Some(Value::String(value)) if value == "boolean" => "bool".to_string(),
        Some(Value::String(value)) if value == "array" => {
            if let Some(items) = schema.get("items").and_then(|value| value.as_object()) {
                format!("list[{}]", json_schema_to_python_type(items))
            } else {
                "list[Any]".to_string()
            }
        }
        Some(Value::String(value)) if value == "object" => "dict[str, Any]".to_string(),
        Some(Value::Array(items)) => {
            let joined = items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| match item {
                    "string" => "str".to_string(),
                    "integer" => "int".to_string(),
                    "number" => "float".to_string(),
                    "boolean" => "bool".to_string(),
                    "object" => "dict[str, Any]".to_string(),
                    "array" => "list[Any]".to_string(),
                    _ => "Any".to_string(),
                })
                .collect::<Vec<_>>()
                .join(" | ");
            if joined.is_empty() {
                "Any".to_string()
            } else {
                joined
            }
        }
        _ => "Any".to_string(),
    }
}

fn format_literal(value: &Value) -> String {
    match value {
        Value::String(text) => format!("\"{}\"", text.replace('"', "\\\"")),
        Value::Null => "None".to_string(),
        _ => value.to_string(),
    }
}

fn safe_python_identifier(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "tool".to_string()
    } else if trimmed
        .chars()
        .next()
        .map(|first| first.is_ascii_digit())
        .unwrap_or(false)
    {
        format!("tool_{}", trimmed)
    } else {
        trimmed.to_string()
    }
}

fn merge_object(target: &mut Value, extra: Value) {
    let Some(target_object) = target.as_object_mut() else {
        return;
    };
    let Some(extra_object) = extra.as_object() else {
        return;
    };
    for (key, value) in extra_object {
        target_object.insert(key.clone(), value.clone());
    }
}

fn copy_non_null_field(target: &mut Map<String, Value>, source: &Map<String, Value>, key: &str) {
    if let Some(value) = source.get(key).filter(|value| !value.is_null()) {
        target.insert(key.to_string(), value.clone());
    }
}

impl QueryProfile {
    fn from_query(query: &str) -> Self {
        let normalized = query.trim().to_lowercase();
        let tokens = tokenize(&normalized);
        let wants_local_inspection =
            contains_any(
                &normalized,
                &[
                    "本机",
                    "本地",
                    "机器",
                    "系统",
                    "已安装",
                    "安装状态",
                    "软件列表",
                    "应用程序",
                    "程序和功能",
                    "注册表",
                    "终端",
                    "命令",
                    "命令行",
                    "powershell",
                    "shell",
                    "cmd",
                    "path",
                    "版本",
                    "version",
                    "环境变量",
                    "文件系统",
                    "目录",
                    "working dir",
                ],
            ) || (contains_any(
                &normalized,
                &[
                    "是否安装",
                    "安装了",
                    "有没有安装",
                    "是否已安装",
                    "命令能不能用",
                    "能不能用",
                    "版本号",
                ],
            ) && !contains_any(&normalized, &["skill", "assistant", "插件", "能力", "仓库"]));
        let wants_recipes = contains_any(
            &normalized,
            &["安装", "install", "skill", "assistant", "启用", "开通"],
        ) && !wants_local_inspection;
        let domain = if wants_local_inspection {
            "system"
        } else if contains_any(&normalized, &["天气", "weather", "降雨", "forecast"]) {
            "weather"
        } else if contains_any(
            &normalized,
            &[
                "网页",
                "网站",
                "url",
                "html",
                "web",
                "抓取",
                "页面",
                "标题",
                "浏览器",
            ],
        ) {
            "web"
        } else if contains_any(&normalized, &["股票", "stock", "quote", "行情"]) {
            "finance"
        } else if contains_any(&normalized, &["记忆", "记住", "memory", "remember", "memo"]) {
            "memory"
        } else if contains_any(
            &normalized,
            &[
                "delegate",
                "delegation",
                "subtask",
                "specialist agent",
                "worker",
                "custom task agent",
                "委派",
                "子任务",
                "智能体",
                "代理",
                "交给",
            ],
        ) {
            "delegation"
        } else {
            "general"
        };
        let intent = if wants_local_inspection {
            "local_inspection"
        } else if wants_recipes {
            "install_or_enable"
        } else if domain == "delegation" {
            "delegation"
        } else if domain == "web" {
            "web_fetch"
        } else if contains_any(&normalized, &["今天", "今日", "实时", "now", "latest"]) {
            "realtime_lookup"
        } else {
            "general_lookup"
        };
        let requires_network = matches!(domain, "weather" | "web" | "finance");
        Self {
            normalized,
            tokens,
            intent,
            domain,
            wants_recipes,
            requires_network,
        }
    }

    fn to_value(&self) -> Value {
        json!({
            "text": self.normalized,
            "tokens": self.tokens,
            "intent": self.intent,
            "domain": self.domain,
            "wants_recipes": self.wants_recipes,
            "requires_network": self.requires_network,
        })
    }
}

fn tokenize(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut ascii_buffer = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            ascii_buffer.push(ch);
            continue;
        }
        if !ascii_buffer.is_empty() {
            tokens.push(ascii_buffer.clone());
            ascii_buffer.clear();
        }
        if !ch.is_whitespace() {
            tokens.push(ch.to_string());
        }
    }
    if !ascii_buffer.is_empty() {
        tokens.push(ascii_buffer);
    }
    tokens
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn matches_domain(domain: &str, text: &str) -> bool {
    match domain {
        "system" => contains_any(
            text,
            &[
                "machine",
                "local machine",
                "shell",
                "terminal",
                "command",
                "powershell",
                "cmd",
                "filesystem",
                "working directory",
                "directory",
                "installed software",
                "registry",
                "host_access",
                "shell_execution",
            ],
        ),
        "weather" => contains_any(text, &["天气", "weather", "forecast", "降雨", "预报"]),
        "web" => contains_any(
            text,
            &["网页", "网站", "url", "html", "web", "抓取", "页面", "标题"],
        ),
        "finance" => contains_any(text, &["股票", "stock", "quote", "行情"]),
        "memory" => contains_any(
            text,
            &["记忆", "记住", "memory", "remember", "memo", "knowledge"],
        ),
        "delegation" => contains_any(
            text,
            &[
                "delegate",
                "delegation",
                "subtask",
                "specialist",
                "custom task agent",
                "worker",
                "委派",
                "子任务",
                "智能体",
                "代理",
            ],
        ),
        _ => false,
    }
}

fn matches_intent(intent: &str, text: &str, asset_type: &str, _source_type: &str) -> bool {
    match intent {
        "local_inspection" => {
            (asset_type == "tool" || asset_type == "skill_tool")
                && contains_any(
                    text,
                    &[
                        "machine",
                        "local machine",
                        "shell",
                        "terminal",
                        "command",
                        "powershell",
                        "cmd",
                        "filesystem",
                        "file system",
                        "directory",
                        "working directory",
                        "installed software",
                        "registry",
                    ],
                )
        }
        "install_or_enable" => {
            matches!(asset_type, "skill" | "skill_tool" | "tool")
        }
        "web_fetch" => contains_any(text, &["网页", "web", "html", "抓取", "url", "标题"]),
        "delegation" => {
            contains_any(
                text,
                &[
                    "delegate",
                    "delegation",
                    "subtask",
                    "specialist",
                    "custom task agent",
                    "agent_delegation",
                    "worker",
                    "delegated_result",
                    "委派",
                    "子任务",
                    "智能体",
                    "代理",
                ],
            ) || (asset_type == "tool" && text.contains("delegate_task"))
        }
        "realtime_lookup" => {
            contains_any(text, &["实时", "today", "今日", "天气", "stock", "行情"])
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcp::commands::runtime::tool_resolution::ToolAvailabilityClass;

    #[test]
    fn dedupe_ranked_capabilities_keeps_highest_ranked_entry_per_name() {
        let deduped = dedupe_ranked_capabilities(vec![
            RankedCapability {
                score: 12.0,
                value: json!({"name": "find_skills", "capability_id": "tool.find_skills.latest"}),
            },
            RankedCapability {
                score: 11.0,
                value: json!({"name": "find_skills", "capability_id": "tool.find_skills.stale"}),
            },
            RankedCapability {
                score: 9.0,
                value: json!({"name": "search_web", "capability_id": "tool.search_web"}),
            },
            RankedCapability {
                score: 8.0,
                value: json!({"capability_id": "assistant.unique"}),
            },
            RankedCapability {
                score: 7.0,
                value: json!({"capability_id": "assistant.unique"}),
            },
        ]);

        assert_eq!(deduped.len(), 3);
        assert_eq!(
            deduped[0].value["capability_id"],
            json!("tool.find_skills.latest")
        );
        assert_eq!(deduped[1].value["capability_id"], json!("tool.search_web"));
        assert_eq!(deduped[2].value["capability_id"], json!("assistant.unique"));
    }

    #[test]
    fn build_tool_contract_uses_input_schema_to_generate_typed_fields() {
        let contract = build_tool_contract(
            "search_web",
            "抓取网页并提取标题",
            "mcp",
            Some(&json!({
                "read_only": true,
                "permission_scope": ["network_read"],
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "Page URL", "example": "https://example.com"},
                        "timeout": {"type": "integer", "default": 30}
                    },
                    "required": ["url"]
                }
            })),
            None,
        )
        .expect("contract");
        assert_eq!(contract["required_parameters"], json!(["url"]));
        assert_eq!(contract["parameters"][0]["name"], json!("url"));
        assert!(contract["signature"]
            .as_str()
            .expect("signature")
            .contains("url:string"));
        assert!(contract["python_stub"]
            .as_str()
            .expect("python stub")
            .contains("def search_web(url: str, timeout: int = 30)"));
        assert_eq!(
            contract["example_arguments"]["url"],
            json!("https://example.com")
        );
        assert_eq!(contract["read_only"], json!(true));
        assert_eq!(contract["mutating"], json!(false));
        assert_eq!(contract["risk_level"], json!("MEDIUM"));
        assert_eq!(contract["output_schema"]["type"], json!("object"));
    }

    #[test]
    fn summarize_search_item_keeps_selection_fields_but_omits_internal_contract_and_ranking_data() {
        let summary = summarize_search_item(&json!({
            "capability_id": "core.browser_open_tab",
            "name": "browser_open_tab",
            "description": "Open a browser tab",
            "semantic_kind": "capability",
            "asset_namespace": "core",
            "source": "local_desktop_runtime_core",
            "pkg_name": "desktop_runtime.core",
            "assistant_id": null,
            "status": {
                "class": "callable_direct",
                "callable": true,
                "install_required": false,
                "activation_required": false,
                "recommended_action": "execute",
                "reason": "core_runtime_tool"
            },
            "input_schema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"}
                },
                "required": ["url"]
            },
            "output_schema": {"type": "object"},
            "parameters": [{"name": "url"}],
            "required_parameters": ["url"],
            "signature": "browser_open_tab(url:string) -> dict[str, Any]",
            "python_stub": "def browser_open_tab(url: str) -> dict[str, Any]: ...",
            "example_arguments": {"url": "https://example.com"},
            "permission_scope": ["network_read"],
            "match_reason": ["bm25:1.00", "direct_callable"],
            "semantic_score": 0.5,
            "lexical_score": 1.0,
            "rank_score": 88.0,
            "runtime_state": "ready",
            "search_index_state": "not_required",
            "mutating": true,
            "risk_level": "LOW"
        }));

        assert_eq!(summary["capability_id"], json!("core.browser_open_tab"));
        assert_eq!(summary["semantic_kind"], json!("capability"));
        assert_eq!(summary["asset_namespace"], json!("core"));
        assert_eq!(summary["schema_available"], json!(true));
        assert_eq!(summary["mutating"], json!(true));
        assert_eq!(summary["risk_level"], json!("LOW"));
        assert_eq!(summary["status"]["callable"], json!(true));
        assert_eq!(summary["status"]["recommended_action"], json!("execute"));
        assert_eq!(summary["status"]["reason"], json!("core_runtime_tool"));
        assert!(summary.get("skill_id").is_none());
        assert!(summary.get("input_schema").is_none());
        assert!(summary.get("required_parameters").is_none());
        assert!(summary.get("python_stub").is_none());
        assert!(summary.get("source").is_none());
        assert!(summary.get("pkg_name").is_none());
        assert!(summary.get("match_reason").is_none());
        assert!(summary.get("runtime_state").is_none());
        assert!(summary["status"].get("class").is_none());
    }

    #[test]
    fn search_result_summary_omits_internal_top_level_metadata() {
        let profile = QueryProfile::from_query("search web tools");
        let summary = build_search_result_payload(
            "search web tools",
            &profile,
            0,
            "registry_first",
            &[json!({
                "capability_id": "tool.search_web",
                "name": "search_web",
                "description": "Search the web",
                "semantic_kind": "capability",
                "asset_namespace": "user_mcp",
                "status": {"callable": true, "recommended_action": "execute", "reason": "ready"},
                "input_schema": {"type": "object"},
                "mutating": false,
                "risk_level": "LOW"
            })],
            &[],
            &[json!({
                "name": "execute_code_plan",
                "description": "Programmatic executor",
                "semantic_kind": "orchestration_primitive",
                "invocation_mode": "direct"
            })],
            1,
            SearchSdkDetailLevel::Summary,
        );

        assert_eq!(summary["detail_level"], json!("summary"));
        assert!(summary.get("normalized_query").is_none());
        assert!(summary.get("routing_hint").is_none());
        assert!(summary.get("usage_hint").is_none());
        assert!(summary.get("availability").is_none());
        assert!(summary.get("runtime_protocol_version").is_none());
    }

    #[test]
    fn search_result_summary_hides_non_callable_user_mcp_capabilities_only() {
        let profile = QueryProfile::from_query("search web tools");
        let summary = build_search_result_payload(
            "search web tools",
            &profile,
            0,
            "registry_first",
            &[
                json!({
                    "capability_id": "tool.search_web",
                    "name": "search_web",
                    "description": "Search the web",
                    "semantic_kind": "capability",
                    "asset_namespace": "user_mcp",
                    "status": {"callable": true, "recommended_action": "execute", "reason": "ready"},
                }),
                json!({
                    "capability_id": "tool.sdk_search",
                    "name": "sdk_search",
                    "description": "Search the SDK",
                    "semantic_kind": "capability",
                    "asset_namespace": "user_mcp",
                    "status": {"callable": false, "recommended_action": "review", "reason": "tool_runtime_paused"},
                }),
                json!({
                    "capability_id": "skill.weather.fetch",
                    "name": "skill.weather.fetch",
                    "description": "Fetch weather via skill",
                    "semantic_kind": "capability",
                    "asset_namespace": "skill",
                    "status": {"callable": false, "recommended_action": "enable_skill", "reason": "skill_installed_but_disabled"},
                }),
            ],
            &[],
            &[],
            1,
            SearchSdkDetailLevel::Summary,
        );

        assert_eq!(summary["count"], json!(2));
        assert_eq!(summary["capabilities"].as_array().map(Vec::len), Some(2));
        assert_eq!(summary["capabilities"][0]["name"], json!("search_web"));
        assert_eq!(
            summary["capabilities"][1]["name"],
            json!("skill.weather.fetch")
        );
        assert_eq!(
            summary["capability_groups"]["user_mcp_tools"],
            json!(["search_web"])
        );
        assert_eq!(
            summary["capability_groups"]["skill_tools"],
            json!(["skill.weather.fetch"])
        );
    }

    #[test]
    fn search_result_full_keeps_internal_top_level_metadata() {
        let profile = QueryProfile::from_query("search web tools");
        let full = build_search_result_payload(
            "search web tools",
            &profile,
            2,
            "registry_first",
            &[],
            &[],
            &[json!({
                "name": "execute_code_plan",
                "description": "Programmatic executor",
                "semantic_kind": "orchestration_primitive",
                "invocation_mode": "direct"
            })],
            1,
            SearchSdkDetailLevel::Full,
        );

        assert_eq!(full["detail_level"], json!("full"));
        assert_eq!(full["normalized_query"]["intent"], json!("web_fetch"));
        assert_eq!(
            full["routing_hint"]["programmatic_path"],
            json!("execute_code_plan")
        );
        assert_eq!(
            full["availability"]["read_path_mode"],
            json!("registry_first")
        );
        assert_eq!(full["runtime_protocol_version"], json!("v1"));
    }

    #[test]
    fn summary_groups_use_name_refs_instead_of_cloned_objects() {
        let groups = build_capability_groups(
            &[json!({
                "name": "skill.openclaw_weather.fetch_weather",
                "asset_namespace": "skill",
                "input_schema": {"type": "object"}
            })],
            SearchSdkDetailLevel::Summary,
        );

        assert_eq!(
            groups["skill_tools"],
            json!(["skill.openclaw_weather.fetch_weather"])
        );
    }

    #[test]
    fn search_summary_keeps_skill_activation_fields_for_recipes() {
        let summary = summarize_search_item(&json!({
            "name": "Planner",
            "description": "Planning workflow skill",
            "semantic_kind": "recipe",
            "asset_namespace": "skill",
            "recipe_kind": "skill",
            "skill_id": "official.skills.planner",
            "recommended_path": "activate_skill",
            "recommended_next_tool": "activate_skill",
            "activation_available": true,
            "docs_excerpt": "Read SKILL.md first.",
            "install_root": "C:/Users/example/.agents/skills/planner",
            "manifest": {"name": "planner"},
            "runtime_state": "ready"
        }));

        assert_eq!(summary["skill_id"], json!("official.skills.planner"));
        assert_eq!(summary["recommended_path"], json!("activate_skill"));
        assert_eq!(summary["recommended_next_tool"], json!("activate_skill"));
        assert_eq!(summary["activation_available"], json!(true));
        assert_eq!(summary["docs_excerpt"], json!("Read SKILL.md first."));
        assert!(summary.get("install_root").is_none());
        assert!(summary.get("manifest").is_none());
        assert!(summary.get("runtime_state").is_none());
    }

    #[test]
    fn recipe_groups_summary_keeps_activation_handle() {
        let groups = build_recipe_groups(
            &[json!({
                "name": "Planner",
                "description": "Planning workflow skill",
                "asset_namespace": "skill",
                "asset_type": "skill",
                "recipe_kind": "skill",
                "skill_id": "official.skills.planner",
                "recommended_path": "activate_skill",
                "recommended_next_tool": "activate_skill",
                "activation_available": true,
                "install_root": "C:/Users/example/.agents/skills/planner"
            })],
            SearchSdkDetailLevel::Summary,
        );

        assert_eq!(
            groups["skills"],
            json!([{
                "name": "Planner",
                "description": "Planning workflow skill",
                "skill_id": "official.skills.planner",
                "recipe_kind": "skill",
                "recommended_path": "activate_skill",
                "recommended_next_tool": "activate_skill",
                "activation_available": true
            }])
        );
    }

    #[test]
    fn normalize_input_schema_adds_empty_properties_for_object_tools() {
        let normalized = normalize_input_schema(&json!({
            "type": "object"
        }))
        .expect("normalized schema");

        assert_eq!(normalized["type"], json!("object"));
        assert_eq!(normalized["properties"], json!({}));
    }

    #[test]
    fn query_profile_prefers_local_inspection_over_install_recipe_for_machine_queries() {
        let profile = QueryProfile::from_query(
            "检查当前机器是否安装某个软件，读取本机已安装程序、注册表和终端信息",
        );

        assert_eq!(profile.domain, "system");
        assert_eq!(profile.intent, "local_inspection");
        assert!(!profile.wants_recipes);
        assert!(!profile.requires_network);
    }

    #[test]
    fn query_profile_detects_delegation_queries() {
        let profile = QueryProfile::from_query("帮我委派一个子任务给智能体处理");

        assert_eq!(profile.domain, "delegation");
        assert_eq!(profile.intent, "delegation");
        assert!(!profile.requires_network);
    }

    #[test]
    fn rank_registry_entry_prefers_delegate_task_for_delegation_queries() {
        let profile = QueryProfile::from_query("帮我委派一个子任务给专门智能体处理");

        let delegate_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "core.delegate_task",
                "name": "delegate_task",
                "description": "Delegate one bounded subtask to an enabled local custom task agent and return a canonical delegated_result object.",
                "asset_type": "tool",
                "source_type": "desktop_runtime_core",
                "metadata": {
                    "permission_scope": ["local_runtime", "agent_delegation"],
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "task": {"type": "string", "description": "Subtask to delegate"},
                            "agent_id": {"type": "string", "description": "Optional explicit task agent id"}
                        }
                    }
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "core_runtime_tool",
            },
            tool_contract_source: None,
        };

        let web_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "tool.firecrawl_search",
                "name": "firecrawl_search",
                "description": "Search the web and optionally extract content from search results.",
                "asset_type": "tool",
                "source_type": "mcp",
                "metadata": {
                    "permission_scope": ["network_read"],
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"}
                        }
                    }
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "ready_via_registry_runtime",
            },
            tool_contract_source: None,
        };

        let bm25 = bm25_asset_match_scores(
            &profile.normalized,
            &[delegate_entry.asset.clone(), web_entry.asset.clone()],
        );
        let structured = std::collections::HashMap::new();
        let retrieval_scores = RetrievalScoreMaps {
            bm25: bm25.clone(),
            structured: structured.clone(),
            semantic: std::collections::HashMap::new(),
            fused: reciprocal_rank_fusion(&[&bm25, &structured]),
        };

        let delegate_rank = rank_registry_entry_with_feedback(
            delegate_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .expect("delegate rank")
        .score;
        let web_rank = rank_registry_entry_with_feedback(
            web_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .expect("web rank")
        .score;

        assert!(
            delegate_rank > web_rank,
            "delegate={delegate_rank}, web={web_rank}"
        );
    }

    #[test]
    fn matches_local_inspection_rewards_host_tools_not_web_tools() {
        let shell_text =
            "execute shell commands on the user's machine with security checks and user approval";
        let web_text = "a powerful web search tool that provides comprehensive real-time results";

        assert!(matches_domain("system", shell_text));
        assert!(matches_intent(
            "local_inspection",
            shell_text,
            "tool",
            "desktop_runtime_core"
        ));
        assert!(!matches_intent("local_inspection", web_text, "tool", "mcp"));
    }

    #[test]
    fn rank_registry_entry_prefers_shell_execute_for_local_cli_checks() {
        let profile = QueryProfile::from_query("检查本机是否安装某个 CLI 命令 行工具");

        let shell_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "core.shell_execute",
                "name": "shell_execute",
                "description": "Execute shell commands on the user's machine with security checks and user approval.",
                "asset_type": "tool",
                "source_type": "desktop_runtime_core",
                "metadata": {
                    "permission_scope": ["shell_execution", "host_access"],
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "mode": {"type": "string"},
                            "shell": {"type": "string"},
                            "command": {"type": "string", "description": "Command text"},
                            "program": {"type": "string", "description": "Program name"},
                            "script": {"type": "string", "description": "Script body"},
                            "working_dir": {"type": "string", "description": "Working directory"}
                        }
                    }
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "core_runtime_tool",
            },
            tool_contract_source: None,
        };

        let memory_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "skill_tool::official.skills.memory::search_knowledge",
                "name": "skill.official.skills.memory.search_knowledge",
                "description": "Search personal and system knowledge base.",
                "asset_type": "skill_tool",
                "source_type": "builtin",
                "metadata": {
                    "skill_id": "official.skills.memory",
                    "tool_name": "search_knowledge",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"}
                        }
                    }
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "ready_in_local_runtime",
            },
            tool_contract_source: None,
        };

        let web_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "tool.tavily_extract",
                "name": "tavily-extract",
                "description": "A powerful web content extraction tool that retrieves and processes raw content from specified URLs.",
                "asset_type": "tool",
                "source_type": "mcp",
                "metadata": {
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "urls": {"type": "array", "description": "List of URLs to extract content from"}
                        }
                    }
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "ready_via_registry_runtime",
            },
            tool_contract_source: None,
        };

        let bm25 = bm25_asset_match_scores(
            &profile.normalized,
            &[
                shell_entry.asset.clone(),
                memory_entry.asset.clone(),
                web_entry.asset.clone(),
            ],
        );
        let structured = std::collections::HashMap::new();
        let retrieval_scores = RetrievalScoreMaps {
            bm25: bm25.clone(),
            structured: structured.clone(),
            semantic: std::collections::HashMap::new(),
            fused: reciprocal_rank_fusion(&[&bm25, &structured]),
        };

        let shell_rank = rank_registry_entry_with_feedback(
            shell_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .map(|item| item.score)
        .unwrap_or_default();
        let memory_rank = rank_registry_entry_with_feedback(
            memory_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .map(|item| item.score)
        .unwrap_or_default();
        let web_rank = rank_registry_entry_with_feedback(
            web_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .map(|item| item.score)
        .unwrap_or_default();

        assert!(
            shell_rank > memory_rank,
            "shell={shell_rank}, memory={memory_rank}"
        );
        assert!(shell_rank > web_rank, "shell={shell_rank}, web={web_rank}");
    }

    #[test]
    fn rank_registry_entry_prefers_web_tools_for_web_fetch_queries() {
        let profile = QueryProfile::from_query("帮我抓取网页并提取标题");

        let web_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "tool.fetch_page",
                "name": "fetch_page",
                "description": "Fetch one web page and extract readable content from a URL.",
                "asset_type": "tool",
                "source_type": "mcp",
                "metadata": {
                    "permission_scope": ["network_read"],
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "Page URL"}
                        }
                    }
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "ready_via_registry_runtime",
            },
            tool_contract_source: None,
        };

        let shell_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "core.shell_execute",
                "name": "shell_execute",
                "description": "Execute shell commands on the user's machine with security checks and user approval.",
                "asset_type": "tool",
                "source_type": "desktop_runtime_core",
                "metadata": {
                    "permission_scope": ["shell_execution", "host_access"]
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "core_runtime_tool",
            },
            tool_contract_source: None,
        };

        let memory_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "skill_tool::official.skills.memory::search_knowledge",
                "name": "skill.official.skills.memory.search_knowledge",
                "description": "Search personal and system knowledge base.",
                "asset_type": "skill_tool",
                "source_type": "builtin",
                "metadata": {
                    "skill_id": "official.skills.memory",
                    "tool_name": "search_knowledge"
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "ready_in_local_runtime",
            },
            tool_contract_source: None,
        };

        let bm25 = bm25_asset_match_scores(
            &profile.normalized,
            &[
                web_entry.asset.clone(),
                shell_entry.asset.clone(),
                memory_entry.asset.clone(),
            ],
        );
        let structured = std::collections::HashMap::new();
        let retrieval_scores = RetrievalScoreMaps {
            bm25: bm25.clone(),
            structured: structured.clone(),
            semantic: std::collections::HashMap::new(),
            fused: reciprocal_rank_fusion(&[&bm25, &structured]),
        };

        let web_rank = rank_registry_entry_with_feedback(
            web_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .expect("web rank")
        .score;
        let shell_rank = rank_registry_entry_with_feedback(
            shell_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .map(|item| item.score)
        .unwrap_or_default();
        let memory_rank = rank_registry_entry_with_feedback(
            memory_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .map(|item| item.score)
        .unwrap_or_default();

        assert!(web_rank > shell_rank, "web={web_rank}, shell={shell_rank}");
        assert!(
            web_rank > memory_rank,
            "web={web_rank}, memory={memory_rank}"
        );
    }

    #[test]
    fn rank_registry_entry_prefers_memory_tools_for_memory_queries() {
        let profile = QueryProfile::from_query("帮我查一下 memory 里我之前记住的内容");

        let memory_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "skill_tool::official.skills.memory::search_knowledge",
                "name": "skill.official.skills.memory.search_knowledge",
                "description": "Search personal and system knowledge base.",
                "asset_type": "skill_tool",
                "source_type": "builtin",
                "metadata": {
                    "skill_id": "official.skills.memory",
                    "tool_name": "search_knowledge",
                    "permission_scope": ["memory_read"],
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"}
                        }
                    }
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "ready_in_local_runtime",
            },
            tool_contract_source: None,
        };

        let shell_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "core.shell_execute",
                "name": "shell_execute",
                "description": "Execute shell commands on the user's machine with security checks and user approval.",
                "asset_type": "tool",
                "source_type": "desktop_runtime_core",
                "metadata": {
                    "permission_scope": ["shell_execution", "host_access"]
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "core_runtime_tool",
            },
            tool_contract_source: None,
        };

        let web_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "tool.fetch_page",
                "name": "fetch_page",
                "description": "Fetch one web page and extract readable content from a URL.",
                "asset_type": "tool",
                "source_type": "mcp",
                "metadata": {
                    "permission_scope": ["network_read"]
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "ready_via_registry_runtime",
            },
            tool_contract_source: None,
        };

        let bm25 = bm25_asset_match_scores(
            &profile.normalized,
            &[
                memory_entry.asset.clone(),
                shell_entry.asset.clone(),
                web_entry.asset.clone(),
            ],
        );
        let structured = std::collections::HashMap::new();
        let retrieval_scores = RetrievalScoreMaps {
            bm25: bm25.clone(),
            structured: structured.clone(),
            semantic: std::collections::HashMap::new(),
            fused: reciprocal_rank_fusion(&[&bm25, &structured]),
        };

        let memory_rank = rank_registry_entry_with_feedback(
            memory_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .expect("memory rank")
        .score;
        let shell_rank = rank_registry_entry_with_feedback(
            shell_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .map(|item| item.score)
        .unwrap_or_default();
        let web_rank = rank_registry_entry_with_feedback(
            web_entry,
            &profile,
            &SearchFeedbackContext::default(),
            &retrieval_scores,
        )
        .map(|item| item.score)
        .unwrap_or_default();

        assert!(
            memory_rank > shell_rank,
            "memory={memory_rank}, shell={shell_rank}"
        );
        assert!(
            memory_rank > web_rank,
            "memory={memory_rank}, web={web_rank}"
        );
    }

    #[test]
    fn rank_registry_entry_with_feedback_boosts_recent_tool_over_similar_peer() {
        let profile = QueryProfile::from_query("browser tool for page work");
        let recent_context = SearchFeedbackContext {
            recent_targets: vec!["browser_wait_for_element".to_string()],
            historical_affinity: Vec::new(),
            query_affinity: Vec::new(),
        };

        let open_tab_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "core.browser_open_tab",
                "name": "browser_open_tab",
                "description": "Ask the browser agent to work with the current page.",
                "asset_type": "tool",
                "source_type": "desktop_runtime_core",
                "pkg_name": "desktop_runtime.core",
                "metadata": {
                    "execution_surface": "host",
                    "runtime_state": "ready",
                    "activation_state": "enabled",
                    "search_index_state": "not_required"
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "core_runtime_tool",
            },
            tool_contract_source: None,
        };

        let wait_entry = CapabilityRegistryEntry {
            asset: json!({
                "id": "core.browser_wait_for_element",
                "name": "browser_wait_for_element",
                "description": "Ask the browser agent to work with the current page.",
                "asset_type": "tool",
                "source_type": "desktop_runtime_core",
                "pkg_name": "desktop_runtime.core",
                "metadata": {
                    "execution_surface": "host",
                    "runtime_state": "ready",
                    "activation_state": "enabled",
                    "search_index_state": "not_required"
                }
            }),
            availability: RegistryAvailability {
                class: ToolAvailabilityClass::CallableDirect,
                install_required: false,
                activation_required: false,
                recommended_action: "execute",
                status_reason: "core_runtime_tool",
            },
            tool_contract_source: None,
        };

        let open_rank = rank_registry_entry_with_feedback(
            open_tab_entry,
            &profile,
            &recent_context,
            &RetrievalScoreMaps::default(),
        )
        .expect("open tab rank");
        let wait_rank = rank_registry_entry_with_feedback(
            wait_entry,
            &profile,
            &recent_context,
            &RetrievalScoreMaps::default(),
        )
        .expect("wait rank");

        assert!(wait_rank.score > open_rank.score);
        assert!(wait_rank.value["match_reason"]
            .as_array()
            .expect("match reason")
            .iter()
            .any(|reason| reason == "session:exact_tool"));
    }
}
