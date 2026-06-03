pub mod activation;
pub mod assistant_persistence;
pub mod capability_contract;
pub mod capability_discovery;
pub mod capability_toolset;
pub mod chat_completion;
pub mod chat_tool_runtime;
pub mod consult;
pub mod control_plane;
pub(crate) mod e3_readiness;
pub mod evolution;
pub mod execution_graph;
pub mod execution_graph_store;
pub mod execution_plane;
pub mod posterior_signal;
pub mod prompt_assets;
pub mod prompt_definitions;
pub mod prompt_plan;
pub mod runtime_event_projection;
pub mod search_feedback;
pub mod semantic_recall;
pub mod skill_context;
pub mod sovereign;
pub mod task_learning;
pub mod tool_catalog;
pub mod tool_feedback;
pub mod tool_result_blocks;
pub mod tool_trace;
pub mod worker_dispatch;

pub(crate) use crate::modules::skills::onboarding::install_local_skill_from_onboarding_request;
pub(crate) use activation::LocalCapabilityActivationState;
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
    dispatch_local_chat_execution_run_command, list_canonical_pending_local_approval_snapshots,
    recover_inflight_local_execution_state, run_local_chat_complete_with_tools,
    ExecutionRunCommand,
};
#[cfg(test)]
pub(crate) use chat_tool_runtime::{serialize_inflight_runtime_context, InFlightExecutionStage};
pub(crate) use control_plane::{
    apply_desktop_execution_policy_overrides, build_default_local_execution_policy,
    build_local_control_plane_result, build_runtime_discovery_bundle_with_runtime_query_vector,
    LocalControlPlaneResult, LocalExecutionPolicy, RuntimeDiscoveryBundle,
};
pub(crate) use execution_graph::{
    project_execution_graph_blocks_from_value, project_execution_graph_snapshot,
    GraphProjectionInput,
};
pub(crate) use execution_graph_store::{
    delete_execution_graph_runtime_context, ensure_execution_graph_run_row,
    list_execution_graph_runtime_contexts, list_execution_graph_snapshots_for_session,
    load_execution_graph_runtime_context, load_execution_graph_snapshot,
    migrate_execution_graph_runtime_bootstrap, persist_execution_graph_runtime_context,
    persist_execution_graph_snapshot,
};
pub(crate) use execution_plane::{
    run_local_runtime_composition_entrypoint, DelegatedExecutionSelection, LocalExecutionRequest,
};
#[cfg(test)]
pub(crate) use execution_plane::{
    DelegatedExecutionKind, DelegatedExecutionRecord, DelegatedExecutionStatus,
    DelegatedExecutionTarget,
};
pub(crate) use posterior_signal::{
    resolve_posterior_signal, resolve_posterior_signal_ingress, should_apply_posterior_signal,
    PosteriorSignalInput,
};
pub(crate) use semantic_recall::should_run_semantic_recall;
pub(crate) use skill_context::{
    activate_skill_from_args, read_skill_resource_from_args, ActiveSkillContextState,
};
pub(crate) use task_learning::{
    apply_policy_delta, apply_task_learning_revision, build_task_fingerprint,
    evaluate_task_learning_with_runtime, list_task_learning_runs_for_query,
    list_task_policy_priors_for_query, load_task_learning_run_detail, query_task_policy_hint,
    replay_task_learning_run, TaskFingerprint, TaskLearningDelegatedExecution,
};
#[cfg(test)]
pub(crate) use tool_catalog::{
    build_local_runtime_tools, build_local_sdk_search_result_with_runtime,
    build_local_sdk_search_result_with_runtime_full,
};
pub(crate) use tool_catalog::{
    build_local_runtime_tools_with_allowlist,
    build_local_sdk_search_result_bundle_with_feedback_runtime,
    resolve_local_runtime_tool_availability, resolve_provider_tool_name_for_execution,
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
pub(crate) use worker_dispatch::select_worker_custom_task_agent;
