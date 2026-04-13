pub mod activation;
pub mod assistant_persistence;
pub mod capability_contract;
pub mod capability_discovery;
pub mod capability_toolset;
pub mod chat_completion;
pub mod chat_tool_runtime;
pub mod consult;
pub mod control_plane;
pub mod execution_graph;
pub mod execution_graph_store;
pub mod execution_plane;
pub mod prompt_assets;
pub mod prompt_plan;
pub mod route_selector;
pub mod search_feedback;
pub mod search_ranking;
pub mod semantic_recall;
pub mod tool_catalog;
pub mod tool_feedback;
pub mod tool_result_blocks;
pub mod tool_trace;

pub(crate) use crate::modules::mcp::commands::runtime::execute_or_queue_mcp_tool_call_with_tool_ref;
pub(crate) use crate::modules::skills::onboarding::install_local_skill_from_onboarding_request;
pub(crate) use activation::{
    resolve_local_capability_activation_state, LocalCapabilityActivationState,
};
pub(crate) use assistant_persistence::{
    mark_local_assistant_postprocess_completed, persist_local_assistant_turn,
};
pub(crate) use capability_contract::CapabilityExecutionContract;
#[cfg(test)]
pub(crate) use chat_completion::normalize_chat_completion_response;
pub(crate) use chat_completion::{
    request_provider_chat_completion, resolve_local_model_connection,
    resolve_local_model_pool_connection, resolve_provider_model_connection,
};
pub(crate) use chat_tool_runtime::{
    apply_rejected_tool_result_to_execution_graph_value,
    list_canonical_pending_local_approval_snapshots, load_suspended_chat_tool_execution_for_resume,
    mark_approval_gate_approving, materialize_pending_local_approval_from_runtime_context,
    persist_suspended_execution_graph_runtime, project_local_chat_approval_state_payload,
    recover_inflight_local_execution_state, recover_local_chat_execution_from_action,
    resume_suspended_chat_tool_execution_after_approval, run_local_chat_complete_with_tools,
    serialize_inflight_runtime_context, InFlightExecutionStage, SuspendedChatToolExecution,
};
pub(crate) use consult::LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION;
pub(crate) use control_plane::{
    apply_desktop_execution_policy_overrides, build_default_local_execution_policy,
    build_local_control_plane_result, build_local_control_plane_status_meta,
    build_local_execution_policy, build_runtime_discovery_bundle_with_runtime_query_vector,
    maybe_override_route_with_custom_task_agent_query_vector, select_worker_custom_task_agent,
    LocalControlPlaneResult, LocalExecutionPolicy, RuntimeDiscoveryBundle,
};
pub(crate) use execution_graph::{
    project_execution_graph_blocks_from_value, project_execution_graph_snapshot,
    GraphProjectionInput,
};
pub(crate) use execution_graph_store::{
    delete_execution_graph_runtime_context, list_execution_graph_runtime_contexts,
    load_execution_graph_runtime_context, load_execution_graph_snapshot,
    migrate_execution_graph_runtime_bootstrap, persist_execution_graph_runtime_context,
    persist_execution_graph_snapshot,
};
pub(crate) use execution_plane::{run_local_execution_plane, LocalExecutionRequest};
pub(crate) use route_selector::{
    render_local_route_prompt, select_local_route_with_evidence, LocalRouteDecision, LocalRouteKind,
};
pub(crate) use semantic_recall::should_run_semantic_recall;
#[cfg(test)]
pub(crate) use tool_catalog::{
    build_local_runtime_tools, build_local_sdk_search_result_with_runtime,
    build_local_sdk_search_result_with_runtime_full,
};
pub(crate) use tool_catalog::{
    build_local_runtime_tools_with_allowlist,
    build_local_sdk_search_result_bundle_with_feedback_runtime,
    resolve_provider_tool_name_for_execution,
};
#[cfg(test)]
pub(crate) use tool_feedback::{
    build_local_tool_call_install_gate_error_meta, build_tool_loop_feedback,
    extract_chat_tool_calls, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};
#[cfg(not(test))]
pub(crate) use tool_feedback::{build_tool_loop_feedback, extract_chat_tool_calls};
pub(crate) use tool_trace::{
    append_streamable_local_tool_result_blocks, build_local_tool_trace_blocks,
    resolve_tool_trace_call_id,
};
