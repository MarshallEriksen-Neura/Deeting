use super::prompt_assets::PromptAssets;
use super::prompt_plan::build_local_prompt_plan;
use super::{build_local_sdk_search_result_with_runtime, LocalRouteDecision, LocalRouteKind};
use crate::modules::custom_task_agents::store::{get_custom_task_agent, list_custom_task_agents};
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
};
use crate::modules::mcp::store::McpStore;
use crate::modules::memory::service::MemoryService;
use crate::modules::providers::embedding::EmbeddingService;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(crate) use mcp_runtime::policy::{
    build_default_local_execution_policy, build_local_control_plane_status_meta,
    build_local_execution_policy, build_local_execution_policy_status_meta,
    enrich_execution_policy_with_runtime_discovery, LocalControlPlaneResult, LocalExecutionPlane,
    LocalExecutionPolicy, RuntimeDiscoveryBundle,
};

pub(crate) const WORKFLOW_ROUTE_WORKER_THROUGH_WORKFLOW_KEY: &str =
    "workflow.route_worker_through_workflow";

#[derive(Debug, Clone)]
pub(crate) struct WorkerTargetSelection {
    pub(crate) profile: CustomTaskAgentProfile,
    pub(crate) score: i32,
    pub(crate) reason: String,
}

pub(crate) async fn build_runtime_discovery_bundle_with_runtime(
    mcp_store: &McpStore,
    embedding_service: &EmbeddingService,
    memory_store: &MemoryService,
    query: &str,
    limit: usize,
) -> RuntimeDiscoveryBundle {
    RuntimeDiscoveryBundle::from_search_result(
        build_local_sdk_search_result_with_runtime(
            mcp_store,
            embedding_service,
            memory_store,
            query,
            limit,
        )
        .await,
    )
}

pub(crate) fn build_local_control_plane_result(
    system_messages: &[LocalChatInputMessage],
    runtime_discovery: Option<RuntimeDiscoveryBundle>,
    route_decision: Option<LocalRouteDecision>,
    execution_policy: Option<LocalExecutionPolicy>,
) -> LocalControlPlaneResult {
    let execution_policy = enrich_execution_policy_with_runtime_discovery(
        execution_policy.unwrap_or_else(build_default_local_execution_policy),
        runtime_discovery.as_ref(),
    );
    let prompt_assets = PromptAssets::from_system_messages(system_messages);
    let prompt_plan = build_local_prompt_plan(&prompt_assets, Some(&execution_policy));
    let status_meta = route_decision
        .as_ref()
        .map(|decision| build_local_control_plane_status_meta(decision, &execution_policy))
        .unwrap_or_else(|| {
            json!({
                "execution_policy": build_local_execution_policy_status_meta(&execution_policy),
            })
        });
    LocalControlPlaneResult {
        runtime_discovery,
        route_decision,
        execution_policy,
        prompt_assets,
        prompt_plan,
        status_meta,
    }
}

pub(crate) async fn apply_desktop_execution_policy_overrides(
    store: &McpStore,
    mut policy: LocalExecutionPolicy,
) -> LocalExecutionPolicy {
    if !policy.allow_worker_delegation {
        policy.prefer_workflow_runtime = false;
        return policy;
    }

    let config_value = store
        .get_desktop_config(WORKFLOW_ROUTE_WORKER_THROUGH_WORKFLOW_KEY)
        .await
        .ok()
        .flatten();
    policy.prefer_workflow_runtime = parse_desktop_config_bool(config_value.as_deref());
    policy
}

fn parse_desktop_config_bool(raw: Option<&str>) -> bool {
    matches!(
        raw.map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase()),
        Some(value)
            if matches!(
                value.as_str(),
                "1" | "true" | "yes" | "on" | "enabled"
            )
    )
}

pub(crate) async fn maybe_override_route_with_custom_task_agent(
    app_state: &AppState,
    explicit_task_agent_id: Option<&str>,
    query: &str,
    mut decision: LocalRouteDecision,
) -> Result<LocalRouteDecision, String> {
    if explicit_task_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        let Some(selection) =
            select_worker_custom_task_agent(app_state, explicit_task_agent_id, query).await?
        else {
            return Ok(decision);
        };

        decision.route = LocalRouteKind::Worker;
        decision.reasons = vec![
            "explicit_task_agent".to_string(),
            selection.profile.invocation_kind.as_str().to_string(),
        ];
        return Ok(decision);
    }

    if decision.route != LocalRouteKind::Direct {
        return Ok(decision);
    }
    if decision.profile.explicit_route.is_some() {
        return Ok(decision);
    }
    if !decision
        .reasons
        .iter()
        .any(|reason| reason == "single_direct_callable")
    {
        return Ok(decision);
    }

    let Some(selection) = select_worker_custom_task_agent(
        app_state,
        explicit_task_agent_id,
        query,
    )
    .await?
    else {
        return Ok(decision);
    };

    decision.route = LocalRouteKind::Worker;
    decision.reasons = if explicit_task_agent_id.is_some() {
        vec!["explicit_task_agent".to_string()]
    } else if selection.profile.invocation_kind == CustomTaskAgentInvocationKind::ImageGeneration {
        vec![
            "custom_task_agent_override".to_string(),
            "image_agent".to_string(),
        ]
    } else {
        vec!["custom_task_agent_override".to_string()]
    };
    Ok(decision)
}

pub(crate) async fn select_worker_custom_task_agent(
    app_state: &AppState,
    explicit_task_agent_id: Option<&str>,
    query: &str,
) -> Result<Option<WorkerTargetSelection>, String> {
    if let Some(selection) =
        select_explicit_worker_custom_task_agent(app_state, explicit_task_agent_id).await?
    {
        return Ok(Some(selection));
    }

    let profiles = list_custom_task_agents(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?;
    let active_profiles = profiles
        .into_iter()
        .filter(|profile| profile.discoverable && profile.is_enabled && !profile.is_deleted)
        .collect::<Vec<_>>();
    if active_profiles.is_empty() {
        return Ok(None);
    }

    let mut semantic_ranks = HashMap::new();
    let embedded = app_state.providers.embedding.embed_text(query).await;
    if let Ok(vector) = embedded {
        if let Ok(hits) = app_state
            .memory
            .service
            .search_assets(vector, 5, Some("custom_task_agent"))
            .await
        {
            for (idx, hit) in hits.into_iter().enumerate() {
                if let Some(id) = hit.get("id").and_then(Value::as_str) {
                    semantic_ranks.insert(id.to_string(), idx);
                }
            }
        }
    }

    Ok(select_custom_task_agent_candidate(
        query,
        &active_profiles,
        &semantic_ranks,
    ))
}

pub(crate) async fn select_explicit_worker_custom_task_agent(
    app_state: &AppState,
    explicit_task_agent_id: Option<&str>,
) -> Result<Option<WorkerTargetSelection>, String> {
    let Some(agent_id) = explicit_task_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    let Some(profile) = get_custom_task_agent(app_state.mcp.store.as_ref(), agent_id)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Err(format!("explicit task agent '{}' not found", agent_id));
    };

    if !profile.is_enabled || profile.is_deleted {
        return Err(format!("explicit task agent '{}' is unavailable", profile.name));
    }

    Ok(Some(WorkerTargetSelection {
        profile,
        score: 10_000,
        reason: "explicit_task_agent".to_string(),
    }))
}

pub(crate) fn select_custom_task_agent_candidate(
    query: &str,
    profiles: &[CustomTaskAgentProfile],
    semantic_ranks: &HashMap<String, usize>,
) -> Option<WorkerTargetSelection> {
    let normalized_query = query.trim().to_lowercase();
    let query_terms = split_match_terms(&normalized_query);
    let mut best: Option<WorkerTargetSelection> = None;

    for profile in profiles {
        let mut score = 0i32;
        let mut reasons = Vec::new();
        let normalized_name = profile.name.trim().to_lowercase();
        let normalized_id = profile.id.trim().to_lowercase();

        if !normalized_name.is_empty() && normalized_query.contains(normalized_name.as_str()) {
            score += 90;
            reasons.push("name_match");
        }
        if !normalized_id.is_empty() && normalized_query.contains(normalized_id.as_str()) {
            score += 100;
            reasons.push("id_match");
        }
        for tag in &profile.tags {
            let tag = tag.trim().to_lowercase();
            if tag.is_empty() {
                continue;
            }
            if normalized_query.contains(tag.as_str()) {
                score += 35;
                reasons.push("tag_match");
            }
        }

        let profile_terms = split_match_terms(&format!(
            "{} {} {}",
            profile.name,
            profile.description.as_deref().unwrap_or_default(),
            profile.tags.join(" ")
        ));
        let overlap = query_terms
            .iter()
            .filter(|term| profile_terms.contains(term.as_str()))
            .count();
        if overlap > 0 {
            score += (overlap.min(4) as i32) * 5;
            reasons.push("term_overlap");
        }
        if let Some(rank) = semantic_ranks.get(&profile.id) {
            let bonus = match rank {
                0 => 30,
                1 => 20,
                2 => 10,
                _ => 5,
            };
            score += bonus;
            reasons.push("semantic_rank");
        }
        if profile.invocation_kind == CustomTaskAgentInvocationKind::ImageGeneration
            && query_contains_any(
                normalized_query.as_str(),
                &[
                    "image",
                    "images",
                    "picture",
                    "draw",
                    "drawing",
                    "illustration",
                    "render",
                    "生成图片",
                    "画图",
                    "出图",
                    "图像",
                    "插画",
                ],
            )
        {
            score += 20;
            reasons.push("image_intent");
        }
        if profile.preferred_for_image_generation
            && profile.invocation_kind == CustomTaskAgentInvocationKind::ImageGeneration
            && query_contains_any(
                normalized_query.as_str(),
                &[
                    "image",
                    "images",
                    "picture",
                    "draw",
                    "drawing",
                    "illustration",
                    "render",
                    "生成图片",
                    "画图",
                    "出图",
                    "图像",
                    "插画",
                ],
            )
        {
            score += 200;
            reasons.push("preferred_for_image_generation");
        }

        if score < 35 {
            continue;
        }
        let candidate = WorkerTargetSelection {
            profile: profile.clone(),
            score,
            reason: reasons.join(","),
        };
        let replace = match &best {
            Some(current) => candidate.score > current.score,
            None => true,
        };
        if replace {
            best = Some(candidate);
        }
    }

    best
}

#[cfg(test)]
mod tests {
    use super::parse_desktop_config_bool;

    #[test]
    fn parse_desktop_config_bool_accepts_common_truthy_values() {
        assert!(parse_desktop_config_bool(Some("true")));
        assert!(parse_desktop_config_bool(Some(" YES ")));
        assert!(parse_desktop_config_bool(Some("1")));
        assert!(parse_desktop_config_bool(Some("enabled")));
    }

    #[test]
    fn parse_desktop_config_bool_rejects_missing_and_falsey_values() {
        assert!(!parse_desktop_config_bool(None));
        assert!(!parse_desktop_config_bool(Some("")));
        assert!(!parse_desktop_config_bool(Some("false")));
        assert!(!parse_desktop_config_bool(Some("0")));
        assert!(!parse_desktop_config_bool(Some("disabled")));
    }
}

fn split_match_terms(input: &str) -> HashSet<String> {
    input
        .split(|ch: char| !ch.is_alphanumeric())
        .map(str::trim)
        .filter(|value| value.len() >= 2)
        .map(|value| value.to_lowercase())
        .collect()
}

fn query_contains_any(query: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| query.contains(needle))
}
