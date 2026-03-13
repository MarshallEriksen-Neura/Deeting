mod activation;
pub(crate) mod asset_indexing;
mod background_workers;
pub(crate) mod capability_discovery;
mod capability_registry;
mod chat_completion;
mod code_mode_catalog;
mod code_mode_orchestration;
mod config;
mod consult;
mod control_plane;
mod core_tool_contracts;
mod execution_plane;
mod onboarding;
mod prompt_assets;
mod prompt_plan;
mod remote_transport;
mod route_selector;
mod search_ranking;
mod summary_format;
mod summary_generation;
mod text_utils;
mod tool_execution;
mod tool_feedback;
mod tool_resolution;
mod tool_result_blocks;
mod tool_trace;

pub(crate) use activation::{
    resolve_local_capability_activation_state, LocalCapabilityActivationState,
};
pub(crate) use asset_indexing::rebuild_local_knowledge_vector_index;
pub(crate) use background_workers::{
    start_local_conversation_summary_worker, start_local_periodic_worker, sync_source_inner,
};
pub(crate) use chat_completion::{
    request_provider_chat_completion, resolve_local_model_connection,
};
#[cfg(test)]
pub(crate) use code_mode_catalog::build_local_code_mode_entry_tools;
#[cfg(test)]
pub(crate) use code_mode_catalog::dynamic_capability_alias;
pub(crate) use code_mode_catalog::{
    build_local_code_mode_entry_tools_with_allowlist, build_local_sdk_search_result_with_runtime,
    resolve_dynamic_direct_capability_tool_name,
};
pub(crate) use code_mode_orchestration::{
    resume_suspended_local_chat_after_approval, run_local_chat_complete_with_auto_code_mode,
    SuspendedLocalChatExecution,
};
#[cfg(test)]
pub(crate) use config::apply_config_payload_to_store;
pub(crate) use config::{apply_config_payload, now_rfc3339, read_local_mcp_config};
pub(crate) use consult::{
    build_local_consult_expert_network_result, LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
};
#[cfg(test)]
pub(crate) use control_plane::select_custom_task_agent_candidate;
pub(crate) use control_plane::{
    build_default_local_execution_policy, build_local_control_plane_result,
    build_local_control_plane_status_meta, build_local_execution_policy,
    build_runtime_discovery_bundle_with_runtime, maybe_override_route_with_custom_task_agent,
    select_worker_custom_task_agent, LocalControlPlaneResult, LocalExecutionPolicy,
    RuntimeDiscoveryBundle,
};
pub(crate) use execution_plane::{run_local_execution_plane, LocalExecutionRequest};
pub(crate) use onboarding::install_local_skill_from_onboarding_request;
#[cfg(test)]
pub(crate) use prompt_assets::PromptAssets;
#[cfg(test)]
pub(crate) use prompt_plan::{
    build_local_prelude_messages, render_local_base_system_prompt, render_local_router_base_prompt,
};
#[cfg(test)]
pub(crate) use prompt_plan::{
    parse_router_prompt_local_context, router_prompt_default_local_context,
    router_prompt_response_language_for_locale_pref,
};
#[cfg(test)]
pub(crate) use route_selector::select_local_route;
pub(crate) use route_selector::{
    build_local_route_status_meta, render_local_route_prompt, select_local_route_with_evidence,
    LocalRouteDecision, LocalRouteKind,
};
pub(crate) use summary_format::build_local_summary_from_window;
pub(crate) use summary_generation::{
    generate_local_conversation_summary_with_model, generate_local_conversation_title_with_model,
    request_local_auxiliary_text, LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
};
pub(crate) use tool_execution::{
    approve_mcp_tool_inner_with_context, execute_local_mcp_tool, execute_mcp_tool,
    execute_or_queue_mcp_tool_call_with_tool_ref, reject_mcp_tool_inner,
    resolve_skill_binding_by_ref,
};
pub(crate) use tool_resolution::{
    build_db_tool_availability_catalog, build_desktop_mcp_tool_views,
    fallback_local_tool_availability, resolve_callable_mcp_tool_by_name,
    resolve_callable_mcp_tool_by_ref, DesktopMcpToolView, ToolAvailability,
    ToolAvailabilityCatalog, ToolResolutionError,
};

pub(crate) use tool_feedback::{
    build_auto_code_mode_tool_feedback, build_local_tool_call_install_gate_error_meta,
    extract_chat_tool_calls, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};
#[cfg(test)]
pub(crate) use tool_resolution::{
    build_desktop_mcp_tool_view, DesktopMcpToolIndexStatus, ToolAvailabilityClass,
};
pub(crate) use tool_trace::{
    append_streamable_local_tool_result_blocks, build_local_tool_trace_blocks,
};

#[cfg(test)]
pub(crate) use background_workers::process_next_local_conversation_summary_job_with_store;
#[cfg(test)]
pub(crate) use chat_completion::normalize_chat_completion_response;
#[cfg(test)]
pub(crate) use config::hash_config;
#[cfg(test)]
pub(crate) use consult::build_local_consult_expert_network_result_with_runtime;
#[cfg(test)]
pub(crate) use onboarding::{derive_skill_name_from_repo_url, parse_skill_onboarding_payload};
#[cfg(test)]
pub(crate) use remote_transport::list_local_stdio_tools;
#[cfg(test)]
pub(crate) use tool_execution::{
    approve_mcp_tool_inner, execute_or_queue_mcp_tool_call,
    execute_or_queue_mcp_tool_call_with_context, resolve_skill_env,
};
