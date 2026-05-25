use super::inflight_context_value::serialize_inflight_runtime_context_with_delegation;
use super::inflight_delegation_context::build_persisted_delegation_wait;
use super::{InFlightExecutionStage, PersistedChatToolRuntimeContext};
use serde_json::Value;

#[allow(clippy::too_many_arguments)]
pub(crate) fn serialize_delegated_runtime_context(
    current_node: Option<String>,
    current_call_id: Option<String>,
    delegated_kind: &str,
    delegated_run_id: String,
    target_id: Option<&str>,
    target_name: Option<&str>,
    last_status: Option<&str>,
    recoverable: bool,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
) -> serde_json::Value {
    serialize_delegated_runtime_context_with_task_input_source(
        current_node,
        current_call_id,
        delegated_kind,
        delegated_run_id,
        target_id,
        target_name,
        last_status,
        recoverable,
        chat_runtime,
        session_id,
        trace_id,
        request_id,
        execution_graph_execution_id,
        last_error,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn serialize_delegated_runtime_context_with_task_input_source(
    current_node: Option<String>,
    current_call_id: Option<String>,
    delegated_kind: &str,
    delegated_run_id: String,
    target_id: Option<&str>,
    target_name: Option<&str>,
    last_status: Option<&str>,
    recoverable: bool,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
    task_input_source: Option<Value>,
) -> serde_json::Value {
    let delegation = build_persisted_delegation_wait(
        delegated_kind,
        delegated_run_id,
        target_id,
        target_name,
        last_status,
    );

    serialize_inflight_runtime_context_with_delegation(
        InFlightExecutionStage::DelegatedWorkflowRunning,
        current_node,
        current_call_id,
        delegation,
        task_input_source,
        recoverable,
        Vec::new(),
        chat_runtime,
        session_id,
        trace_id,
        request_id,
        execution_graph_execution_id,
        last_error,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn serialize_delegated_workflow_runtime_context(
    current_node: Option<String>,
    current_call_id: Option<String>,
    workflow_run_id: String,
    target_id: Option<&str>,
    target_name: Option<&str>,
    last_status: Option<&str>,
    recoverable: bool,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
) -> serde_json::Value {
    serialize_delegated_workflow_runtime_context_with_task_input_source(
        current_node,
        current_call_id,
        workflow_run_id,
        target_id,
        target_name,
        last_status,
        recoverable,
        chat_runtime,
        session_id,
        trace_id,
        request_id,
        execution_graph_execution_id,
        last_error,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn serialize_delegated_workflow_runtime_context_with_task_input_source(
    current_node: Option<String>,
    current_call_id: Option<String>,
    workflow_run_id: String,
    target_id: Option<&str>,
    target_name: Option<&str>,
    last_status: Option<&str>,
    recoverable: bool,
    chat_runtime: Option<PersistedChatToolRuntimeContext>,
    session_id: &str,
    trace_id: &str,
    request_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
    last_error: Option<&str>,
    task_input_source: Option<Value>,
) -> serde_json::Value {
    serialize_delegated_runtime_context_with_task_input_source(
        current_node,
        current_call_id,
        "workflow",
        workflow_run_id,
        target_id,
        target_name,
        last_status,
        recoverable,
        chat_runtime,
        session_id,
        trace_id,
        request_id,
        execution_graph_execution_id,
        last_error,
        task_input_source,
    )
}
