use super::super::runtime_metrics::RuntimeMetricsAccumulator;
use super::PersistedChatToolRuntimeContext;
use crate::modules::desktop_runtime::runtime::build_default_local_execution_policy;
use crate::modules::mcp::commands::common_impl::LocalModelConnection;

pub(super) fn fallback_chat_runtime_context_for_execution_graph(
    execution_id: &str,
    execution_graph: &serde_json::Value,
) -> PersistedChatToolRuntimeContext {
    PersistedChatToolRuntimeContext {
        max_rounds: 4,
        round: 0,
        trace_id: execution_id.to_string(),
        request_id: None,
        execution_policy: build_default_local_execution_policy(),
        model_connection: LocalModelConnection {
            model_id: "deeting-os".to_string(),
            provider_model_id: "deeting-os".to_string(),
            logical_model_key: None,
            protocol_family: "openai_chat".to_string(),
        },
        orchestrated_messages: Vec::new(),
        world_model_frame: None,
        task_query: None,
        session_id: execution_graph
            .get("session_id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        temperature: None,
        max_tokens: None,
        reasoning_enabled: None,
        reasoning_effort: None,
        active_capability: None,
        active_skill_context: None,
        captured_frame_extract: None,
        runtime_metrics: RuntimeMetricsAccumulator::default(),
        last_capability_snapshot: None,
        terminal_context: None,
        workflow_context: None,
        last_response: None,
        selected_knowledge_file_ids: Vec::new(),
    }
}
