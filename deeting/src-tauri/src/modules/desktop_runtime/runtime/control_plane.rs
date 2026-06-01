use super::prompt_assets::PromptAssets;
use super::prompt_plan::{build_local_prompt_plan_for_pipeline, PromptPipeline};
use crate::modules::mcp::store::McpStore;
use crate::modules::memory::service::MemoryService;
use crate::modules::providers::embedding::EmbeddingService;
use mcp_core::types::LocalChatInputMessage;
use serde_json::json;

pub(crate) use mcp_runtime::policy::{
    build_default_local_execution_policy, build_local_execution_policy_status_meta,
    enrich_execution_policy_with_runtime_discovery, LocalControlPlaneResult, LocalExecutionPolicy,
    RuntimeDiscoveryBundle,
};

pub(crate) const WORKFLOW_DELEGATED_PHASE_THROUGH_WORKFLOW_KEY: &str =
    "workflow.delegated_phase_through_workflow";

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
    execution_policy: Option<LocalExecutionPolicy>,
    locale: Option<&str>,
) -> LocalControlPlaneResult {
    let execution_policy = enrich_execution_policy_with_runtime_discovery(
        execution_policy.unwrap_or_else(build_default_local_execution_policy),
        runtime_discovery.as_ref(),
    );
    let prompt_assets = PromptAssets::from_system_messages(system_messages);
    let prompt_plan = build_local_prompt_plan_for_pipeline(
        PromptPipeline::Chat,
        &prompt_assets,
        Some(&execution_policy),
        locale,
    );
    let status_meta = json!({
        "runtime_owner": "world_model_runtime_owner",
        "execution_policy": build_local_execution_policy_status_meta(&execution_policy),
    });
    LocalControlPlaneResult {
        runtime_discovery,
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
        .get_desktop_config(WORKFLOW_DELEGATED_PHASE_THROUGH_WORKFLOW_KEY)
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
