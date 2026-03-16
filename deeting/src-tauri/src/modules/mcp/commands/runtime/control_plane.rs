use super::prompt_assets::PromptAssets;
use super::prompt_plan::{build_local_prompt_plan, PromptPlan};
use super::route_selector::RouteEvidence;
use super::{
    build_local_route_status_meta, build_local_sdk_search_result_with_runtime, LocalRouteDecision,
    LocalRouteKind,
};
use crate::modules::custom_task_agents::store::list_custom_task_agents;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
};
use crate::modules::mcp::store::McpStore;
use crate::modules::mcp::types::LocalChatInputMessage;
use crate::modules::memory::service::MemoryService;
use crate::modules::providers::embedding::EmbeddingService;
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};

pub(crate) const SEARCH_SDK_TOOL_NAME: &str = "search_sdk";
pub(crate) const EXECUTE_CODE_PLAN_TOOL_NAME: &str = "execute_code_plan";
pub(crate) const CONSULT_EXPERT_NETWORK_TOOL_NAME: &str = "consult_expert_network";
pub(crate) const ATTACH_CAPABILITY_TOOL_NAME: &str = "attach_capability";
pub(crate) const DETACH_CAPABILITY_TOOL_NAME: &str = "detach_capability";
pub(crate) const SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME: &str = "sys_submit_onboarding_request";
pub(crate) const REFRESH_SKILL_INDEX_TOOL_NAME: &str = "refresh_skill_index";

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct RuntimeDiscoveryBundle {
    raw_search_result: Value,
    pub(crate) capabilities: Vec<Value>,
    pub(crate) recipes: Vec<Value>,
    pub(crate) orchestration_primitives: Vec<Value>,
    pub(crate) route_evidence: RouteEvidence,
}

impl RuntimeDiscoveryBundle {
    pub(crate) fn from_search_result(search_result: Value) -> Self {
        Self {
            capabilities: extract_array_items(&search_result, "capabilities"),
            recipes: extract_array_items(&search_result, "recipes"),
            orchestration_primitives: extract_array_items(
                &search_result,
                "orchestration_primitives",
            ),
            route_evidence: RouteEvidence::from_search_result(&search_result),
            raw_search_result: search_result,
        }
    }

    #[allow(dead_code)]
    pub(crate) fn raw_search_result(&self) -> &Value {
        &self.raw_search_result
    }

    pub(crate) fn skill_recipes(&self) -> Vec<Value> {
        self.recipes
            .iter()
            .filter(|item| item.get("asset_type").and_then(Value::as_str) == Some("skill"))
            .take(3)
            .cloned()
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum LocalExecutionPlane {
    ResponseOnly,
    WorkerReasoning,
    CodeModeOrchestration,
}

impl LocalExecutionPlane {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::ResponseOnly => "response_only",
            Self::WorkerReasoning => "worker_reasoning",
            Self::CodeModeOrchestration => "code_mode_orchestration",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct LocalExecutionPolicy {
    pub(crate) route: LocalRouteKind,
    pub(crate) plane: LocalExecutionPlane,
    pub(crate) allowed_tool_names: Vec<String>,
    pub(crate) inject_code_mode_protocol: bool,
    pub(crate) allow_worker_delegation: bool,
    pub(crate) capability_snapshot: Option<Value>,
}

#[derive(Debug, Clone)]
pub(crate) struct WorkerTargetSelection {
    pub(crate) profile: CustomTaskAgentProfile,
    pub(crate) score: i32,
    pub(crate) reason: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct LocalControlPlaneResult {
    pub(crate) runtime_discovery: Option<RuntimeDiscoveryBundle>,
    pub(crate) route_decision: Option<LocalRouteDecision>,
    pub(crate) execution_policy: LocalExecutionPolicy,
    pub(crate) prompt_assets: PromptAssets,
    pub(crate) prompt_plan: PromptPlan,
    pub(crate) status_meta: Value,
}

impl LocalExecutionPolicy {
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn allows_tool(&self, tool_name: &str) -> bool {
        let normalized = tool_name.trim().to_lowercase();
        if normalized.is_empty() {
            return false;
        }
        self.allowed_tool_names
            .iter()
            .any(|item| item == &normalized)
    }

    pub(crate) fn effective_allowed_tool_names(
        &self,
        capability_snapshot: Option<&Value>,
    ) -> Vec<String> {
        let mut names = self.allowed_tool_names.clone();
        if let Some(snapshot) = capability_snapshot {
            if let Ok(direct_names) =
                crate::modules::capability_control_plane::extract_direct_callable_capability_names(
                    snapshot,
                )
            {
                names.extend(direct_names);
            }
        }
        normalize_tool_names(names)
    }

    pub(crate) fn prompt_tool_names(&self) -> Vec<String> {
        if !self.inject_code_mode_protocol {
            return Vec::new();
        }

        self.allowed_tool_names
            .iter()
            .filter(|name| name.as_str() != SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME)
            .cloned()
            .collect()
    }
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

pub(crate) fn build_default_local_execution_policy() -> LocalExecutionPolicy {
    LocalExecutionPolicy {
        route: LocalRouteKind::Direct,
        plane: LocalExecutionPlane::ResponseOnly,
        allowed_tool_names: Vec::new(),
        inject_code_mode_protocol: false,
        allow_worker_delegation: false,
        capability_snapshot: None,
    }
}

pub(crate) fn build_local_execution_policy(decision: &LocalRouteDecision) -> LocalExecutionPolicy {
    match decision.route {
        LocalRouteKind::Direct => LocalExecutionPolicy {
            route: LocalRouteKind::Direct,
            plane: LocalExecutionPlane::ResponseOnly,
            allowed_tool_names: vec![SEARCH_SDK_TOOL_NAME.to_string()],
            inject_code_mode_protocol: false,
            allow_worker_delegation: false,
            capability_snapshot: None,
        },
        LocalRouteKind::Worker => LocalExecutionPolicy {
            route: LocalRouteKind::Worker,
            plane: LocalExecutionPlane::WorkerReasoning,
            allowed_tool_names: vec![SEARCH_SDK_TOOL_NAME.to_string()],
            inject_code_mode_protocol: false,
            allow_worker_delegation: true,
            capability_snapshot: None,
        },
        LocalRouteKind::CodeMode => LocalExecutionPolicy {
            route: LocalRouteKind::CodeMode,
            plane: LocalExecutionPlane::CodeModeOrchestration,
            allowed_tool_names: full_code_mode_tool_names(),
            inject_code_mode_protocol: true,
            allow_worker_delegation: false,
            capability_snapshot: None,
        },
    }
}

pub(crate) fn build_local_execution_policy_status_meta(policy: &LocalExecutionPolicy) -> Value {
    json!({
        "route": policy.route.as_str(),
        "plane": policy.plane.as_str(),
        "allowed_tool_names": policy.allowed_tool_names,
        "inject_code_mode_protocol": policy.inject_code_mode_protocol,
        "allow_worker_delegation": policy.allow_worker_delegation,
        "has_capability_snapshot": policy.capability_snapshot.is_some(),
    })
}

pub(crate) fn build_local_control_plane_status_meta(
    decision: &LocalRouteDecision,
    policy: &LocalExecutionPolicy,
) -> Value {
    let mut meta = build_local_route_status_meta(decision);
    if let Some(object) = meta.as_object_mut() {
        object.insert(
            "execution_policy".to_string(),
            build_local_execution_policy_status_meta(policy),
        );
    }
    meta
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

fn enrich_execution_policy_with_runtime_discovery(
    mut policy: LocalExecutionPolicy,
    runtime_discovery: Option<&RuntimeDiscoveryBundle>,
) -> LocalExecutionPolicy {
    let mut allowed = policy.allowed_tool_names.clone();
    if !allowed.iter().any(|name| name == SEARCH_SDK_TOOL_NAME) {
        allowed.push(SEARCH_SDK_TOOL_NAME.to_string());
    }
    if let Some(discovery) = runtime_discovery {
        policy.capability_snapshot = Some(discovery.raw_search_result().clone());
        if let Ok(direct_names) =
            crate::modules::capability_control_plane::extract_direct_callable_capability_names(
                discovery.raw_search_result(),
            )
        {
            allowed.extend(direct_names);
        }
    } else {
        policy.capability_snapshot = None;
    }

    policy.allowed_tool_names = normalize_tool_names(allowed);
    policy
}

pub(crate) fn full_code_mode_tool_names() -> Vec<String> {
    [
        SEARCH_SDK_TOOL_NAME,
        EXECUTE_CODE_PLAN_TOOL_NAME,
        CONSULT_EXPERT_NETWORK_TOOL_NAME,
        ATTACH_CAPABILITY_TOOL_NAME,
        DETACH_CAPABILITY_TOOL_NAME,
        SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME,
        REFRESH_SKILL_INDEX_TOOL_NAME,
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

pub(crate) async fn maybe_override_route_with_custom_task_agent(
    app_state: &AppState,
    query: &str,
    mut decision: LocalRouteDecision,
) -> Result<LocalRouteDecision, String> {
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

    let Some(selection) = select_worker_custom_task_agent(app_state, query).await? else {
        return Ok(decision);
    };
    if selection.profile.invocation_kind != CustomTaskAgentInvocationKind::ImageGeneration {
        return Ok(decision);
    }

    decision.route = LocalRouteKind::Worker;
    decision.reasons = vec![
        "custom_task_agent_override".to_string(),
        "image_agent".to_string(),
    ];
    Ok(decision)
}

pub(crate) async fn select_worker_custom_task_agent(
    app_state: &AppState,
    query: &str,
) -> Result<Option<WorkerTargetSelection>, String> {
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

fn extract_array_items(search_result: &Value, field: &str) -> Vec<Value> {
    search_result
        .get(field)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn normalize_tool_names<I>(names: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    names
        .into_iter()
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcp::commands::runtime::route_selector::TaskProfile;

    #[test]
    fn build_local_execution_policy_matches_worker_lane() {
        let decision = LocalRouteDecision {
            route: LocalRouteKind::Worker,
            reasons: vec!["analysis_request".to_string()],
            profile: TaskProfile {
                explicit_route: None,
                has_batch_scope: false,
                wants_programmatic_logic: false,
                wants_analysis: true,
                wants_single_action: false,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 0,
                has_code_mode_executor: false,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: Vec::new(),
            },
        };

        let policy = build_local_execution_policy(&decision);
        assert_eq!(policy.route, LocalRouteKind::Worker);
        assert_eq!(policy.plane, LocalExecutionPlane::WorkerReasoning);
        assert!(policy.allows_tool(SEARCH_SDK_TOOL_NAME));
        assert!(policy.allow_worker_delegation);
        assert!(!policy.inject_code_mode_protocol);
    }

    #[test]
    fn build_local_execution_policy_exposes_direct_search_sdk_lane() {
        let decision = LocalRouteDecision {
            route: LocalRouteKind::Direct,
            reasons: vec!["single_direct_callable".to_string()],
            profile: TaskProfile {
                explicit_route: None,
                has_batch_scope: false,
                wants_programmatic_logic: false,
                wants_analysis: false,
                wants_single_action: true,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: vec!["weather".to_string()],
            },
        };

        let policy = build_local_execution_policy(&decision);
        assert_eq!(policy.route, LocalRouteKind::Direct);
        assert_eq!(policy.plane, LocalExecutionPlane::ResponseOnly);
        assert!(policy.allows_tool(SEARCH_SDK_TOOL_NAME));
        assert!(!policy.inject_code_mode_protocol);
        assert!(!policy.allow_worker_delegation);
        assert!(policy.capability_snapshot.is_none());
    }

    #[test]
    fn build_local_execution_policy_exposes_full_code_mode_lane() {
        let decision = LocalRouteDecision {
            route: LocalRouteKind::CodeMode,
            reasons: vec!["programmatic_logic".to_string()],
            profile: TaskProfile {
                explicit_route: Some(LocalRouteKind::CodeMode),
                has_batch_scope: true,
                wants_programmatic_logic: true,
                wants_analysis: false,
                wants_single_action: false,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 0,
                has_code_mode_executor: true,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: Vec::new(),
            },
        };

        let policy = build_local_execution_policy(&decision);
        assert_eq!(policy.route, LocalRouteKind::CodeMode);
        assert_eq!(policy.plane, LocalExecutionPlane::CodeModeOrchestration);
        assert!(policy.inject_code_mode_protocol);
        assert!(policy.allows_tool(SEARCH_SDK_TOOL_NAME));
        assert!(policy.allows_tool(SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME));
        assert!(policy.allows_tool(REFRESH_SKILL_INDEX_TOOL_NAME));
        assert!(!policy.allow_worker_delegation);
    }

    #[test]
    fn build_local_control_plane_result_enriches_worker_policy_with_direct_capabilities() {
        let decision = LocalRouteDecision {
            route: LocalRouteKind::Worker,
            reasons: vec!["multiple_direct_candidates".to_string()],
            profile: TaskProfile {
                explicit_route: None,
                has_batch_scope: false,
                wants_programmatic_logic: false,
                wants_analysis: false,
                wants_single_action: true,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 2,
                has_code_mode_executor: true,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: vec![
                    "weather_lookup".to_string(),
                    "tavily_search".to_string(),
                ],
            },
        };
        let runtime_discovery = RuntimeDiscoveryBundle::from_search_result(serde_json::json!({
            "capabilities": [
                {
                    "name": "weather_lookup",
                    "invocation_mode": "direct",
                    "status": { "callable": true }
                },
                {
                    "name": "tavily_search",
                    "invocation_mode": "direct",
                    "status": { "callable": true }
                }
            ]
        }));
        let result = build_local_control_plane_result(
            &[],
            Some(runtime_discovery),
            Some(decision.clone()),
            Some(build_local_execution_policy(&decision)),
        );
        let policy = result.execution_policy;
        assert_eq!(policy.route, LocalRouteKind::Worker);
        assert!(policy.allows_tool(SEARCH_SDK_TOOL_NAME));
        assert!(policy.allows_tool("weather_lookup"));
        assert!(policy.allows_tool("tavily_search"));
        assert!(policy.capability_snapshot.is_some());
    }

    #[test]
    fn build_local_control_plane_result_enriches_code_mode_policy_with_direct_capabilities() {
        let decision = LocalRouteDecision {
            route: LocalRouteKind::CodeMode,
            reasons: vec!["programmatic_logic".to_string()],
            profile: TaskProfile {
                explicit_route: Some(LocalRouteKind::CodeMode),
                has_batch_scope: false,
                wants_programmatic_logic: true,
                wants_analysis: false,
                wants_single_action: true,
                destructive_intent: false,
                approval_sensitive: false,
            },
            evidence: RouteEvidence {
                direct_callable_capability_count: 1,
                has_code_mode_executor: true,
                any_mutating_capability: false,
                any_high_risk_capability: false,
                direct_capability_names: vec!["weather_lookup".to_string()],
            },
        };
        let runtime_discovery = RuntimeDiscoveryBundle::from_search_result(serde_json::json!({
            "capabilities": [
                {
                    "name": "weather_lookup",
                    "invocation_mode": "direct",
                    "status": { "callable": true }
                }
            ]
        }));
        let result = build_local_control_plane_result(
            &[],
            Some(runtime_discovery),
            Some(decision.clone()),
            Some(build_local_execution_policy(&decision)),
        );
        let policy = result.execution_policy;
        assert_eq!(policy.route, LocalRouteKind::CodeMode);
        assert!(policy.allows_tool(SEARCH_SDK_TOOL_NAME));
        assert!(policy.allows_tool("weather_lookup"));
        assert!(policy.capability_snapshot.is_some());
    }
}
