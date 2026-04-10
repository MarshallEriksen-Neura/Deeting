use super::*;

#[derive(Clone)]
pub(crate) struct SuspendedChatToolExecution {
    max_rounds: usize,
    round: usize,
    trace_id: String,
    request_id: Option<String>,
    execution_policy: LocalExecutionPolicy,
    model_connection: LocalModelConnection,
    orchestrated_messages: Vec<LocalChatInputMessage>,
    session_id: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    active_capability: Option<LocalCapabilityActivationState>,
    runtime_metrics: RuntimeMetricsAccumulator,
    last_capability_snapshot: Option<serde_json::Value>,
    last_response: Option<serde_json::Value>,
    execution_graph: serde_json::Value,
}

impl SuspendedChatToolExecution {
    pub(super) fn from_state(
        state: &LocalChatToolRuntimeState,
        pending_tool_call_meta: &[serde_json::Value],
        _pending_results: &[String],
        _pending_capability_update: Option<LocalCapabilityTransition>,
        _pending_call_id: String,
        _pending_tool_name: String,
    ) -> Self {
        let tool_trace_blocks = build_local_tool_trace_blocks(pending_tool_call_meta);
        let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
            session_id: state.session_id.clone(),
            route: state.execution_policy.route.as_str().to_string(),
            plane: state.execution_policy.plane.as_str().to_string(),
            trace_id: Some(state.trace_id.clone()),
            request_id: state.request_id.clone(),
            root_execution_id: None,
            response_content: state
                .last_response
                .as_ref()
                .and_then(|response| response.get("content").cloned()),
            tool_trace_blocks,
            delegated_execution_tree: None,
        })
        .to_value();
        Self {
            max_rounds: state.max_rounds,
            round: state.round,
            trace_id: state.trace_id.clone(),
            request_id: state.request_id.clone(),
            execution_policy: state.execution_policy.clone(),
            model_connection: state.model_connection.clone(),
            orchestrated_messages: state.orchestrated_messages.clone(),
            session_id: state.session_id.clone(),
            temperature: state.temperature,
            max_tokens: state.max_tokens,
            active_capability: state.active_capability.clone(),
            runtime_metrics: state.runtime_metrics.clone(),
            last_capability_snapshot: state.last_capability_snapshot.clone(),
            last_response: state.last_response.clone(),
            execution_graph,
        }
    }

    pub(super) fn into_runtime_state(self) -> LocalChatToolRuntimeState {
        LocalChatToolRuntimeState {
            max_rounds: self.max_rounds,
            round: self.round,
            trace_id: self.trace_id.clone(),
            request_id: self.request_id.clone(),
            execution_policy: self.execution_policy,
            model_connection: self.model_connection,
            orchestrated_messages: self.orchestrated_messages,
            session_id: self.session_id,
            temperature: self.temperature,
            max_tokens: self.max_tokens,
            active_capability: self.active_capability,
            runtime_metrics: self.runtime_metrics,
            last_capability_snapshot: self.last_capability_snapshot,
            last_response: self.last_response,
            realtime_emitter: LocalRealtimeToolTraceEmitter::new(
                None,
                Some(self.trace_id.as_str()),
                self.request_id.as_deref(),
            ),
        }
    }

    pub(crate) fn graph_execution_id(&self) -> Option<&str> {
        self.execution_graph
            .get("execution_id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    pub(crate) fn pending_tool_node_id(&self) -> &str {
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str) == Some("tool_call")
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("tool_call:unknown")
    }

    pub(crate) fn tool_node_id_for_call_id(&self, call_id: &str) -> Option<String> {
        let normalized_call_id = call_id.trim();
        if normalized_call_id.is_empty() {
            return None;
        }
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str) == Some("tool_call")
                        && node
                            .get("metadata")
                            .and_then(|value| value.get("call_id"))
                            .and_then(serde_json::Value::as_str)
                            .map(str::trim)
                            == Some(normalized_call_id)
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    }

    pub(crate) fn pending_gate_node_id(&self) -> &str {
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str)
                        == Some("approval_gate")
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("approval_gate:unknown")
    }

    pub(crate) fn approval_gate_node_id_for_call_id(&self, call_id: &str) -> Option<String> {
        let normalized_call_id = call_id.trim();
        if normalized_call_id.is_empty() {
            return None;
        }
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str)
                        == Some("approval_gate")
                        && node
                            .get("metadata")
                            .and_then(|value| value.get("call_id"))
                            .and_then(serde_json::Value::as_str)
                            .map(str::trim)
                            == Some(normalized_call_id)
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    }

    pub(super) fn pending_call_id(&self) -> &str {
        self.pending_tool_node_id()
            .strip_prefix("tool_call:")
            .unwrap_or(self.pending_tool_node_id())
    }

    pub(crate) fn execution_graph(&self) -> &serde_json::Value {
        &self.execution_graph
    }

    pub(super) fn pending_tool_call_meta(&self) -> Vec<serde_json::Value> {
        build_tool_call_meta_from_execution_graph(&self.execution_graph)
    }

    pub(super) fn pending_requires_approval_call_ids(&self) -> Vec<String> {
        self.pending_tool_call_meta()
            .into_iter()
            .filter(|item| {
                item.get("status")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|status| status.eq_ignore_ascii_case("requires_approval"))
            })
            .filter_map(|item| {
                item.get("id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .collect()
    }
}
