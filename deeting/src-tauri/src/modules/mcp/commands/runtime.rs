mod activation;
mod chat_completion;
mod consult;
mod config;
mod onboarding;
mod search_ranking;
mod summary_format;
mod summary_generation;
mod text_utils;
mod tool_execution;
mod tool_feedback;
mod tool_result_blocks;
mod tool_schemas;
mod tool_trace;

pub(crate) use activation::{
    resolve_local_assistant_activation_state, LocalAssistantActivationState,
};
pub(crate) use chat_completion::{
    request_provider_chat_completion, resolve_local_model_connection,
};
pub(crate) use consult::{
    build_local_consult_expert_network_result, LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
};
pub(crate) use config::{apply_config_payload, now_rfc3339, read_local_mcp_config};
pub(crate) use onboarding::install_local_skill_from_onboarding_request;
pub(crate) use search_ranking::lexical_rank_asset_hits;
pub(crate) use summary_format::build_local_summary_from_window;
pub(crate) use summary_generation::{
    generate_local_conversation_summary_with_model, generate_local_conversation_title_with_model,
    request_local_auxiliary_text, LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
};
pub(crate) use tool_execution::{
    approve_mcp_tool_inner_with_context, execute_or_queue_mcp_tool_call_with_context,
    reject_mcp_tool_inner,
};
pub(crate) use tool_feedback::{
    build_auto_code_mode_tool_feedback, build_local_tool_call_install_gate_error_meta,
    extract_chat_tool_calls, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
};
pub(crate) use tool_schemas::merge_wrapped_tool_payload;
pub(crate) use tool_trace::{
    append_streamable_local_tool_result_blocks, build_local_tool_trace_blocks,
};

#[cfg(test)]
pub(crate) use config::hash_config;
#[cfg(test)]
pub(crate) use consult::build_local_consult_expert_network_result_with_runtime;
#[cfg(test)]
pub(crate) use chat_completion::normalize_chat_completion_response;
#[cfg(test)]
pub(crate) use onboarding::{derive_skill_name_from_repo_url, parse_skill_onboarding_payload};
#[cfg(test)]
pub(crate) use tool_execution::{
    approve_mcp_tool_inner, execute_or_queue_mcp_tool_call, resolve_skill_env,
};

