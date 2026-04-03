pub mod activation;
pub mod capability_contract;
pub mod capability_discovery;
pub mod capability_toolset;
pub mod chat_completion;
pub mod code_mode_catalog;
pub mod code_mode_orchestration;
pub mod consult;
pub mod control_plane;
pub mod execution_plane;
pub mod prompt_assets;
pub mod prompt_plan;
pub mod route_selector;
pub mod search_feedback;
pub mod search_ranking;
pub mod tool_feedback;
pub mod tool_result_blocks;
pub mod tool_trace;

pub(crate) use crate::modules::mcp::commands::runtime::execute_or_queue_mcp_tool_call_with_tool_ref;
pub(crate) use crate::modules::skills::onboarding::install_local_skill_from_onboarding_request;
pub(crate) use activation::{
    resolve_local_capability_activation_state, LocalCapabilityActivationState,
};
pub(crate) use capability_contract::CapabilityExecutionContract;
#[cfg(test)]
pub(crate) use chat_completion::normalize_chat_completion_response;
pub(crate) use chat_completion::{
    request_provider_chat_completion, resolve_local_model_connection,
    resolve_local_model_pool_connection, resolve_provider_model_connection,
};
#[cfg(test)]
pub(crate) use code_mode_catalog::{
    build_local_code_mode_entry_tools, build_local_sdk_search_result_with_runtime,
};
pub(crate) use code_mode_catalog::{
    build_local_code_mode_entry_tools_with_allowlist,
    build_local_sdk_search_result_bundle_with_feedback_runtime,
    build_local_sdk_search_result_with_runtime_full, resolve_dynamic_direct_capability_tool_name,
};
pub(crate) use code_mode_orchestration::{
    resume_suspended_local_chat_after_approval, run_local_chat_complete_with_auto_code_mode,
    SuspendedLocalChatExecution,
};
pub(crate) use consult::{
    build_local_consult_expert_network_result, LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
};
pub(crate) use control_plane::{
    apply_desktop_execution_policy_overrides, build_default_local_execution_policy,
    build_local_control_plane_result, build_local_control_plane_status_meta,
    build_local_execution_policy, build_runtime_discovery_bundle_with_runtime,
    maybe_override_route_with_custom_task_agent, select_worker_custom_task_agent,
    LocalControlPlaneResult, LocalExecutionPolicy, RuntimeDiscoveryBundle,
};
pub(crate) use execution_plane::{run_local_execution_plane, LocalExecutionRequest};
pub(crate) use route_selector::{
    render_local_route_prompt, select_local_route_with_evidence, LocalRouteDecision, LocalRouteKind,
};
pub(crate) use tool_feedback::{
    build_auto_code_mode_tool_feedback, build_local_tool_call_install_gate_error_meta,
    extract_chat_tool_calls, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};
pub(crate) use tool_trace::{
    append_streamable_local_tool_result_blocks, build_local_tool_trace_blocks,
};
