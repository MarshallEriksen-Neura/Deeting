use super::*;

#[derive(Clone)]
pub(crate) struct SuspendedChatToolExecution {
    pub(super) max_rounds: usize,
    pub(super) round: usize,
    pub(super) trace_id: String,
    pub(super) request_id: Option<String>,
    pub(super) execution_policy: LocalExecutionPolicy,
    pub(super) model_connection: LocalModelConnection,
    pub(super) orchestrated_messages: Vec<LocalChatInputMessage>,
    pub(super) session_id: String,
    pub(super) temperature: Option<f32>,
    pub(super) max_tokens: Option<u32>,
    pub(super) active_capability: Option<LocalCapabilityActivationState>,
    pub(super) runtime_metrics: RuntimeMetricsAccumulator,
    pub(super) last_capability_snapshot: Option<serde_json::Value>,
    pub(super) last_response: Option<serde_json::Value>,
    pub(super) pending_approvals: Vec<super::inflight::PersistedPendingApproval>,
    pub(super) execution_graph: serde_json::Value,
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
            pending_approvals: Vec::new(),
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
        self.pending_node_id_for_type("tool_call", "tool_call:unknown")
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
        self.pending_node_id_for_type("approval_gate", "approval_gate:unknown")
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

    pub(super) fn sync_remaining_pending_approvals(&mut self, approved_token: &str) -> Vec<String> {
        let normalized_approved_token = approved_token.trim();
        let remaining_call_ids = self.pending_requires_approval_call_ids();
        if remaining_call_ids.is_empty() {
            self.pending_approvals.clear();
            return remaining_call_ids;
        }

        self.pending_approvals.retain(|pending| {
            if pending.approval_token.trim() == normalized_approved_token {
                return false;
            }

            let Some(call_id) = pending
                .call_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                return true;
            };

            remaining_call_ids
                .iter()
                .any(|candidate| candidate == call_id)
        });

        remaining_call_ids
    }

    pub(crate) fn set_pending_approval_status(
        &mut self,
        approval_token: &str,
        status: &str,
    ) -> bool {
        let normalized_token = approval_token.trim();
        if normalized_token.is_empty() {
            return false;
        }
        let Some(pending) = self
            .pending_approvals
            .iter_mut()
            .find(|pending| pending.approval_token.trim() == normalized_token)
        else {
            return false;
        };
        pending.approval_status = Some(status.to_string());
        true
    }

    pub(crate) fn pending_approvals(&self) -> &[super::inflight::PersistedPendingApproval] {
        &self.pending_approvals
    }

    fn pending_node_id_for_type<'a>(&'a self, node_type: &str, fallback: &'a str) -> &'a str {
        let Some(nodes) = self
            .execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
        else {
            return fallback;
        };

        let preferred = nodes.iter().find(|node| {
            node.get("node_type").and_then(serde_json::Value::as_str) == Some(node_type)
                && node
                    .get("status")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|status| status.eq_ignore_ascii_case("waiting_approval"))
        });

        preferred
            .or_else(|| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str) == Some(node_type)
                })
            })
            .and_then(|node| node.get("node_id"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or(fallback)
    }
}
