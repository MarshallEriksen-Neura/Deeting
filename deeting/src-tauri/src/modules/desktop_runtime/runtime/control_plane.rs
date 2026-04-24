use super::prompt_assets::PromptAssets;
use super::prompt_plan::build_local_prompt_plan;
use super::worker_dispatch::select_worker_custom_task_agent_with_query_vector;
use super::{LocalRouteDecision, LocalRouteKind};
use crate::modules::custom_task_agents::types::CustomTaskAgentInvocationKind;
use crate::modules::mcp::store::McpStore;
use crate::modules::memory::service::MemoryService;
use crate::modules::providers::embedding::EmbeddingService;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use serde_json::json;

pub(crate) use mcp_runtime::policy::{
    build_default_local_execution_policy, build_local_control_plane_status_meta,
    build_local_execution_policy, build_local_execution_policy_status_meta,
    enrich_execution_policy_with_runtime_discovery, LocalControlPlaneResult, LocalExecutionPlane,
    LocalExecutionPolicy, RuntimeDiscoveryBundle,
};

pub(crate) const WORKFLOW_ROUTE_WORKER_THROUGH_WORKFLOW_KEY: &str =
    "workflow.route_worker_through_workflow";

#[allow(dead_code)]
pub(crate) async fn build_runtime_discovery_bundle_with_runtime(
    mcp_store: &McpStore,
    embedding_service: &EmbeddingService,
    memory_store: &MemoryService,
    query: &str,
    limit: usize,
) -> RuntimeDiscoveryBundle {
    build_runtime_discovery_bundle_with_runtime_query_vector(
        mcp_store,
        embedding_service,
        memory_store,
        query,
        None,
        limit,
    )
    .await
}

pub(crate) async fn build_runtime_discovery_bundle_with_runtime_query_vector(
    mcp_store: &McpStore,
    embedding_service: &EmbeddingService,
    memory_store: &MemoryService,
    query: &str,
    query_vector: Option<Vec<f32>>,
    limit: usize,
) -> RuntimeDiscoveryBundle {
    RuntimeDiscoveryBundle::from_search_result(
        crate::modules::capability_control_plane::build_search_sdk_result_with_query_vector(
            mcp_store,
            embedding_service,
            memory_store,
            query,
            query_vector,
            limit,
            super::capability_discovery::SearchSdkDetailLevel::Full,
        )
        .await,
    )
}

pub(crate) fn build_local_control_plane_result(
    system_messages: &[LocalChatInputMessage],
    runtime_discovery: Option<RuntimeDiscoveryBundle>,
    route_decision: Option<LocalRouteDecision>,
    execution_policy: Option<LocalExecutionPolicy>,
    locale: Option<&str>,
) -> LocalControlPlaneResult {
    let execution_policy = enrich_execution_policy_with_runtime_discovery(
        execution_policy.unwrap_or_else(build_default_local_execution_policy),
        runtime_discovery.as_ref(),
    );
    let prompt_assets = PromptAssets::from_system_messages(system_messages);
    let prompt_plan = build_local_prompt_plan(&prompt_assets, Some(&execution_policy), locale);
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

#[allow(dead_code)]
pub(crate) async fn maybe_override_route_with_custom_task_agent(
    app_state: &AppState,
    explicit_task_agent_id: Option<&str>,
    query: &str,
    decision: LocalRouteDecision,
) -> Result<LocalRouteDecision, String> {
    maybe_override_route_with_custom_task_agent_query_vector(
        app_state,
        explicit_task_agent_id,
        query,
        None,
        decision,
    )
    .await
}

pub(crate) async fn maybe_override_route_with_custom_task_agent_query_vector(
    app_state: &AppState,
    explicit_task_agent_id: Option<&str>,
    query: &str,
    query_vector: Option<Vec<f32>>,
    mut decision: LocalRouteDecision,
) -> Result<LocalRouteDecision, String> {
    if explicit_task_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        let Some(selection) = select_worker_custom_task_agent_with_query_vector(
            app_state,
            explicit_task_agent_id,
            query,
            query_vector.clone(),
        )
        .await?
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

    let Some(selection) = select_worker_custom_task_agent_with_query_vector(
        app_state,
        explicit_task_agent_id,
        query,
        query_vector,
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
