use super::super::tool_meta::build_tool_call_meta_from_execution_graph;
use super::SuspendedChatToolExecution;

impl SuspendedChatToolExecution {
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
        self.node_id_for_call_id_and_type(call_id, "tool_call")
    }

    pub(crate) fn pending_gate_node_id(&self) -> &str {
        self.pending_node_id_for_type("approval_gate", "approval_gate:unknown")
    }

    pub(crate) fn approval_gate_node_id_for_call_id(&self, call_id: &str) -> Option<String> {
        self.node_id_for_call_id_and_type(call_id, "approval_gate")
    }

    fn node_id_for_call_id_and_type(&self, call_id: &str, node_type: &str) -> Option<String> {
        let normalized_call_id = call_id.trim();
        if normalized_call_id.is_empty() {
            return None;
        }
        self.execution_graph
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .and_then(|nodes| {
                nodes.iter().find(|node| {
                    node.get("node_type").and_then(serde_json::Value::as_str) == Some(node_type)
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

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn pending_call_id(
        &self,
    ) -> &str {
        self.pending_tool_node_id()
            .strip_prefix("tool_call:")
            .unwrap_or(self.pending_tool_node_id())
    }

    pub(crate) fn execution_graph(&self) -> &serde_json::Value {
        &self.execution_graph
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn pending_tool_call_meta(
        &self,
    ) -> Vec<serde_json::Value> {
        build_tool_call_meta_from_execution_graph(&self.execution_graph)
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
