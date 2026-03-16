use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::{json, Value};

use super::capability_registry::{
    build_capability_registry, CapabilityRegistryEntry, RegistryAvailability, ToolContractSource,
};
use super::search_ranking::lexical_asset_match_score;

const MAX_LIMIT: usize = 20;
const SEMANTIC_SCORE_FLOOR: f64 = 0.30;
const MIN_RANK_SCORE: f64 = 8.0;
const SEARCH_RESULT_FORMAT_VERSION: &str = "sdk_control_plane.v1";

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
    limit: usize,
) -> Value {
    let registry = build_capability_registry(mcp_store, memory_store).await;
    let profile = QueryProfile::from_query(query);
    let limit = limit.clamp(1, MAX_LIMIT);
    let semantic_scores = collect_semantic_scores(memory_store, embedding_service, &profile).await;
    let mut ranked = registry
        .entries
        .into_iter()
        .filter_map(|entry| rank_registry_entry(entry, &profile, &semantic_scores))
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
        })
        .count();

    let capability_groups = json!({
        "skill_tools": capabilities
            .iter()
            .filter(|item| item.get("asset_namespace").and_then(Value::as_str) == Some("skill"))
            .cloned()
            .collect::<Vec<_>>(),
        "user_mcp_tools": capabilities
            .iter()
            .filter(|item| item.get("asset_namespace").and_then(Value::as_str) == Some("user_mcp"))
            .cloned()
            .collect::<Vec<_>>(),
        "core_tools": capabilities
            .iter()
            .filter(|item| item.get("asset_namespace").and_then(Value::as_str) == Some("core"))
            .cloned()
            .collect::<Vec<_>>(),
    });
    let recipe_groups = json!({
        "skills": recipes
            .iter()
            .filter(|item| item.get("asset_namespace").and_then(Value::as_str) == Some("skill"))
            .cloned()
            .collect::<Vec<_>>(),
        "assistants": recipes
            .iter()
            .filter(|item| item.get("asset_type").and_then(Value::as_str) == Some("assistant"))
            .cloned()
            .collect::<Vec<_>>(),
    });

    json!({
        "format_version": SEARCH_RESULT_FORMAT_VERSION,
        "runtime_protocol_version": crate::modules::code_mode::contract::RUNTIME_PROTOCOL_VERSION,
        "mode": "code_mode",
        "query": query,
        "normalized_query": profile.to_value(),
        "count": capabilities.len() + recipes.len() + orchestration_primitives.len(),
        "capabilities": capabilities,
        "recipes": recipes,
        "capability_groups": capability_groups,
        "recipe_groups": recipe_groups,
        "orchestration_primitives": orchestration_primitives,
        "routing_hint": {
            "default_path": "direct_capability_call",
            "programmatic_path": "execute_code_plan",
            "direct_callable_capability_count": direct_callable_capability_count,
        },
        "usage_hint": "优先从 capability_groups.skill_tools 与 capability_groups.user_mcp_tools 中选择 direct host 能力直接调用；recipe_groups.skills 表示 skill bundle 的指导性入口，本身不是可直接执行的 tool。只有在需要多步程序逻辑、循环、条件分支或结果聚合时，才进入 orchestration_primitives 里的 execute_code_plan。",
        "availability": {
            "enabled_assistant_count": registry.enabled_assistant_count,
            "read_path_mode": registry.read_path_mode.as_str(),
            "legacy_control_plane_reads_enabled": false,
        }
    })
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

async fn collect_semantic_scores(
    memory_store: &crate::modules::memory::service::MemoryService,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    profile: &QueryProfile,
) -> HashMap<String, f64> {
    if profile.normalized.is_empty() {
        return HashMap::new();
    }
    let Ok(vector) = embedding_service.embed_text(&profile.normalized).await else {
        return HashMap::new();
    };
    let Ok(hits) = memory_store.search_assets(vector, MAX_LIMIT, None).await else {
        return HashMap::new();
    };
    hits.into_iter()
        .filter_map(|hit| {
            let id = hit
                .get("id")
                .and_then(|value| value.as_str())?
                .trim()
                .to_string();
            let score = hit.get("_distance").and_then(|value| value.as_f64())?;
            Some((id, score))
        })
        .collect()
}

fn rank_registry_entry(
    entry: CapabilityRegistryEntry,
    profile: &QueryProfile,
    semantic_scores: &HashMap<String, f64>,
) -> Option<RankedCapability> {
    let asset = entry.asset;
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
    let semantic_score = semantic_scores.get(&id).copied();
    let lexical_score = lexical_asset_match_score(&profile.normalized, &asset);
    let availability = entry.availability;
    let combined_text = format!("{}\n{}", name.to_lowercase(), description.to_lowercase());
    let domain_hit = matches_domain(profile.domain, &combined_text);
    let intent_hit = matches_intent(profile.intent, &combined_text, asset_type, source_type);
    let has_signal =
        lexical_score.is_some() || semantic_score.is_some() || domain_hit || intent_hit;
    if !has_signal {
        return None;
    }

    let mut rank_score = 0.0;
    let mut match_reason = Vec::new();
    if let Some(score) = semantic_score {
        if score >= SEMANTIC_SCORE_FLOOR {
            rank_score += score * 25.0;
            match_reason.push(format!("semantic_match:{score:.2}"));
        }
    }
    if let Some(score) = lexical_score {
        let mapped_score = remap_lexical_score(score);
        rank_score += mapped_score;
        match_reason.push(lexical_reason(score));
    }
    if domain_hit {
        rank_score += 14.0;
        match_reason.push(format!("domain:{}", profile.domain));
    }
    if intent_hit {
        rank_score += 10.0;
        match_reason.push(format!("intent:{}", profile.intent));
    }
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
        semantic_score,
        lexical_score,
        rank_score,
    );
    if availability.is_direct_callable() && matches!(asset_type, "tool" | "skill_tool") {
        if let Some(contract) = build_tool_contract(
            name,
            description,
            source_type,
            asset_metadata.as_ref(),
            entry.tool_contract_source.as_ref(),
        ) {
            merge_object(&mut value, contract);
        }
    }

    Some(RankedCapability {
        score: rank_score,
        value,
    })
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
) -> Value {
    let asset_namespace =
        resolve_asset_namespace(asset_type, source_type, pkg_name.as_deref(), asset_metadata);
    let skill_backed_tool =
        asset_namespace == "skill" && matches!(asset_type, "tool" | "skill_tool");
    let group = classify_semantic_group(name, asset_type, pkg_name.as_deref(), availability);
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
                object.insert("recommended_path".to_string(), json!("install_or_activate"));
                if asset_type == "skill" || skill_backed_tool {
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
                let primitive_kind = match name {
                    "execute_code_plan" => "orchestration",
                    _ => "discovery",
                };
                let invocation_mode = match name {
                    "execute_code_plan" => "code_mode",
                    _ => "direct",
                };
                let execution_plane = match name {
                    "execute_code_plan" => "sandbox",
                    _ => "host",
                };
                object.insert(
                    "semantic_kind".to_string(),
                    json!("orchestration_primitive"),
                );
                object.insert("primitive_kind".to_string(), json!(primitive_kind));
                object.insert("invocation_mode".to_string(), json!(invocation_mode));
                object.insert("execution_plane".to_string(), json!(execution_plane));
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
) -> SemanticGroup {
    if matches!(name.trim(), "search_sdk" | "execute_code_plan") {
        return SemanticGroup::OrchestrationPrimitive;
    }
    if asset_type == "skill_tool"
        || (asset_type == "tool" && pkg_name.is_some_and(|value| value.starts_with("skill.")))
    {
        return if availability.is_direct_callable() {
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
    if matches!(source_type, "code_mode_core") {
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

impl QueryProfile {
    fn from_query(query: &str) -> Self {
        let normalized = query.trim().to_lowercase();
        let tokens = tokenize(&normalized);
        let wants_recipes = contains_any(
            &normalized,
            &["安装", "install", "skill", "assistant", "启用", "开通"],
        );
        let domain = if contains_any(&normalized, &["天气", "weather", "降雨", "forecast"]) {
            "weather"
        } else if contains_any(
            &normalized,
            &["网页", "网站", "url", "html", "web", "抓取", "页面", "标题"],
        ) {
            "web"
        } else if contains_any(&normalized, &["股票", "stock", "quote", "行情"]) {
            "finance"
        } else if contains_any(&normalized, &["记忆", "memory", "remember", "memo"]) {
            "memory"
        } else {
            "general"
        };
        let intent = if wants_recipes {
            "install_or_enable"
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
        "weather" => contains_any(text, &["天气", "weather", "forecast", "降雨", "预报"]),
        "web" => contains_any(
            text,
            &["网页", "网站", "url", "html", "web", "抓取", "页面", "标题"],
        ),
        "finance" => contains_any(text, &["股票", "stock", "quote", "行情"]),
        "memory" => contains_any(text, &["记忆", "memory", "remember", "memo"]),
        _ => false,
    }
}

fn matches_intent(intent: &str, text: &str, asset_type: &str, source_type: &str) -> bool {
    match intent {
        "install_or_enable" => {
            source_type == "cloud_mirror" || asset_type == "assistant" || asset_type == "tool"
        }
        "web_fetch" => contains_any(text, &["网页", "web", "html", "抓取", "url", "标题"]),
        "realtime_lookup" => {
            contains_any(text, &["实时", "today", "今日", "天气", "stock", "行情"])
        }
        _ => true,
    }
}

fn remap_lexical_score(score: f64) -> f64 {
    if score >= 1000.0 {
        40.0
    } else if score >= 900.0 {
        32.0
    } else if score >= 100.0 {
        20.0
    } else {
        score.min(10.0) * 2.0
    }
}

fn lexical_reason(score: f64) -> String {
    if score >= 1000.0 {
        "lexical_name_exact".to_string()
    } else if score >= 900.0 {
        "lexical_description_exact".to_string()
    } else if score >= 100.0 {
        "lexical_prefix_match".to_string()
    } else {
        format!("lexical_overlap:{score:.0}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
