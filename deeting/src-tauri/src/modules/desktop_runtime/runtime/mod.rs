pub mod activation;
pub mod capability_discovery;
pub mod chat_completion;
pub mod code_mode_catalog;
pub mod code_mode_orchestration;
pub mod consult;
pub mod control_plane;
pub mod execution_plane;
pub mod prompt_assets;
pub mod prompt_plan;
pub mod route_selector;
pub mod search_ranking;
pub mod tool_feedback;
pub mod tool_result_blocks;
pub mod tool_trace;

pub(crate) use activation::{resolve_local_capability_activation_state, LocalCapabilityActivationState};
pub(crate) use chat_completion::{request_provider_chat_completion, resolve_local_model_connection};
#[cfg(test)]
pub(crate) use chat_completion::normalize_chat_completion_response;
pub(crate) use code_mode_catalog::{
    build_local_code_mode_entry_tools_with_allowlist, build_local_sdk_search_result_with_runtime,
    dynamic_capability_alias, resolve_dynamic_direct_capability_tool_name,
};
#[cfg(test)]
pub(crate) use code_mode_catalog::build_local_code_mode_entry_tools;
pub(crate) use code_mode_orchestration::{
    resume_suspended_local_chat_after_approval, run_local_chat_complete_with_auto_code_mode,
    SuspendedLocalChatExecution,
};
pub(crate) use consult::{
    build_local_consult_expert_network_result, build_local_consult_expert_network_result_with_runtime,
    LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
};
pub(crate) use control_plane::{
    build_default_local_execution_policy, build_local_control_plane_result,
    build_local_control_plane_status_meta, build_local_execution_policy,
    build_runtime_discovery_bundle_with_runtime, maybe_override_route_with_custom_task_agent,
    select_custom_task_agent_candidate, select_worker_custom_task_agent, LocalControlPlaneResult,
    LocalExecutionPlane, LocalExecutionPolicy, RuntimeDiscoveryBundle, ATTACH_CAPABILITY_TOOL_NAME,
    CONSULT_EXPERT_NETWORK_TOOL_NAME, DETACH_CAPABILITY_TOOL_NAME, EXECUTE_CODE_PLAN_TOOL_NAME,
    REFRESH_SKILL_INDEX_TOOL_NAME, SEARCH_SDK_TOOL_NAME, SYS_SUBMIT_ONBOARDING_REQUEST_TOOL_NAME,
};
pub(crate) use execution_plane::{run_local_execution_plane, LocalExecutionRequest};
pub(crate) use prompt_assets::PromptAssets;
pub(crate) use prompt_plan::{
    build_local_prelude_messages, parse_router_prompt_local_context, render_local_base_system_prompt,
    render_local_router_base_prompt, router_prompt_default_local_context,
    router_prompt_response_language_for_locale_pref,
};
pub(crate) use route_selector::{
    build_local_route_status_meta, render_local_route_prompt, select_local_route,
    select_local_route_with_evidence, LocalRouteDecision, LocalRouteKind, RouteEvidence,
    TaskProfile,
};
pub(crate) use tool_feedback::{
    build_auto_code_mode_tool_feedback, build_local_tool_call_install_gate_error_meta,
    extract_chat_tool_calls, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};
pub(crate) use tool_trace::{append_streamable_local_tool_result_blocks, build_local_tool_trace_blocks};
pub(crate) use crate::modules::mcp::commands::runtime::{
    execute_or_queue_mcp_tool_call_with_tool_ref, resolve_callable_mcp_tool_by_ref,
};
pub(crate) use crate::modules::skill_runtime::resolve_skill_binding_by_ref;
pub(crate) use crate::modules::skills::onboarding::install_local_skill_from_onboarding_request;
