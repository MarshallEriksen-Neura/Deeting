use super::frame_tools::DitingThinkExtract;
use super::lifecycle::extract_resume_response_text;
use super::runtime_metrics::RuntimeMetricsAccumulator;
use super::streaming::LocalRealtimeToolTraceEmitter;
use super::tool_execution::LocalCapabilityTransition;
use crate::modules::desktop_runtime::runtime::{
    ActiveSkillContextState, LocalCapabilityActivationState, LocalExecutionPolicy,
};
use crate::modules::mcp::commands::common_impl::LocalModelConnection;
use crate::modules::mcp::commands::support::LocalChatInputMessage;
use desktop_runtime_core::WorldModelFrame;

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) enum LocalToolCallProcessingOutcome
{
    Completed {
        synthesized: bool,
        tool_call_meta: Vec<serde_json::Value>,
        results: Vec<String>,
        skill_context_update: Option<ActiveSkillContextState>,
        captured_frame_extract: Option<DitingThinkExtract>,
        runtime_transition_blocks: Vec<serde_json::Value>,
    },
    Interrupted {
        approval_tokens: Vec<String>,
        tool_call_meta: Vec<serde_json::Value>,
        results: Vec<String>,
        capability_update: Option<LocalCapabilityTransition>,
        skill_context_update: Option<ActiveSkillContextState>,
        captured_frame_extract: Option<DitingThinkExtract>,
        runtime_transition_blocks: Vec<serde_json::Value>,
    },
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct LocalChatToolRuntimeState
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) max_rounds: usize,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) round: usize,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) trace_id: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) request_id: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) execution_policy:
        LocalExecutionPolicy,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) model_connection:
        LocalModelConnection,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) orchestrated_messages:
        Vec<LocalChatInputMessage>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) world_model_frame:
        Option<WorldModelFrame>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) task_query: Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) session_id: String,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) temperature: Option<f32>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) max_tokens: Option<u32>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) reasoning_enabled:
        Option<bool>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) reasoning_effort:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) active_capability:
        Option<LocalCapabilityActivationState>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) active_skill_context:
        Option<ActiveSkillContextState>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) diting_think_consumed: bool,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) captured_reasoning:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) captured_frame_extract:
        Option<DitingThinkExtract>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) runtime_metrics:
        RuntimeMetricsAccumulator,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_capability_snapshot:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) terminal_context:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) workflow_context:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) last_response:
        Option<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) runtime_transition_blocks:
        Vec<serde_json::Value>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) realtime_emitter:
        LocalRealtimeToolTraceEmitter,
    // Selected knowledge file IDs supplied by the workflow context manifest,
    // used as a fallback when the model calls `context_search` with
    // `scope: "selected"` but omits `filters.selected_file_ids`.
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) selected_knowledge_file_ids:
        Vec<String>,
}

pub(crate) struct LocalChatCompleteWithToolsOutput {
    pub(crate) response_json: serde_json::Value,
    pub(crate) world_model_frame: Option<WorldModelFrame>,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct LocalChatToolRuntimeOutput
{
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) response: serde_json::Value,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) captured_reasoning:
        Option<String>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) captured_frame_extract:
        Option<DitingThinkExtract>,
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) world_model_frame:
        Option<WorldModelFrame>,
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn clone_runtime_state_for_tool_execution(
    state: &LocalChatToolRuntimeState,
    realtime_emitter: Option<LocalRealtimeToolTraceEmitter>,
) -> LocalChatToolRuntimeState {
    LocalChatToolRuntimeState {
        max_rounds: state.max_rounds,
        round: state.round,
        trace_id: state.trace_id.clone(),
        request_id: state.request_id.clone(),
        execution_policy: state.execution_policy.clone(),
        model_connection: state.model_connection.clone(),
        orchestrated_messages: state.orchestrated_messages.clone(),
        world_model_frame: state.world_model_frame.clone(),
        task_query: state.task_query.clone(),
        session_id: state.session_id.clone(),
        temperature: state.temperature,
        max_tokens: state.max_tokens,
        reasoning_enabled: state.reasoning_enabled,
        reasoning_effort: state.reasoning_effort.clone(),
        active_capability: state.active_capability.clone(),
        active_skill_context: state.active_skill_context.clone(),
        diting_think_consumed: state.diting_think_consumed,
        captured_reasoning: state.captured_reasoning.clone(),
        captured_frame_extract: state.captured_frame_extract.clone(),
        runtime_metrics: state.runtime_metrics.clone(),
        last_capability_snapshot: state.last_capability_snapshot.clone(),
        terminal_context: state.terminal_context.clone(),
        workflow_context: state.workflow_context.clone(),
        last_response: state.last_response.clone(),
        runtime_transition_blocks: state.runtime_transition_blocks.clone(),
        realtime_emitter: realtime_emitter.unwrap_or_else(|| {
            LocalRealtimeToolTraceEmitter::new(
                None,
                Some(state.trace_id.as_str()),
                state.request_id.as_deref(),
            )
        }),
        selected_knowledge_file_ids: state.selected_knowledge_file_ids.clone(),
    }
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn backfill_captured_reasoning(
    response: &mut serde_json::Value,
    captured_reasoning: Option<&str>,
) {
    let reasoning = match captured_reasoning.map(str::trim).filter(|v| !v.is_empty()) {
        Some(r) => r,
        None => return,
    };
    let has_native = response
        .get("reasoning_content")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some();
    if !has_native {
        if let Some(obj) = response.as_object_mut() {
            obj.insert(
                "reasoning_content".to_string(),
                serde_json::Value::String(reasoning.to_string()),
            );
        }
    }
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn extract_initial_task_query(
    messages: &[LocalChatInputMessage],
) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role.eq_ignore_ascii_case("user"))
        .map(|message| message.content.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn build_max_rounds_exceeded_response(
    state: &LocalChatToolRuntimeState,
) -> serde_json::Value {
    let notice = format!(
        "本次任务已用完 {0}/{0} 轮 Agent 执行预算。当前进度已保留；如需更长的搜索、验证、委托或审批流程，请在设置中提高 `max_agentic_rounds` 后继续本任务。",
        state.max_rounds
    );
    let mut fallback = state
        .last_response
        .clone()
        .unwrap_or_else(|| serde_json::json!({ "content": "" }));
    let existing_content =
        extract_resume_response_text(fallback.get("content").unwrap_or(&serde_json::Value::Null));
    let next_content = if existing_content.trim().is_empty() {
        notice.clone()
    } else if existing_content.contains(&notice) {
        existing_content
    } else {
        format!("{existing_content}\n\n{notice}")
    };
    if let Some(object) = fallback.as_object_mut() {
        object.insert(
            "content".to_string(),
            serde_json::Value::String(next_content),
        );
        object.insert(
            "error_code".to_string(),
            serde_json::Value::String("LOCAL_CHAT_MAX_ROUNDS_EXCEEDED".to_string()),
        );
        object.insert(
            "stop_reason".to_string(),
            serde_json::Value::String("max_agentic_rounds_exceeded".to_string()),
        );
    }
    fallback
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn rewind_round_for_post_approval_continuation(
    state: &mut LocalChatToolRuntimeState,
) {
    state.round = state.round.saturating_sub(1);
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn resolve_child_agent_max_rounds(
    arguments: &serde_json::Value,
    runtime_max_rounds: usize,
) -> u32 {
    let runtime_cap = runtime_max_rounds.max(1).min(u32::MAX as usize);
    arguments
        .get("max_rounds")
        .and_then(serde_json::Value::as_u64)
        .map(|value| value.min(u32::MAX as u64) as usize)
        .map(|value| value.max(1).min(runtime_cap))
        .unwrap_or(runtime_cap) as u32
}

pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn classify_local_tool_execution_error_code(
    error: &str,
) -> &'static str {
    let normalized = error.trim();
    if normalized.starts_with("MCP tool '") && normalized.contains(" timed out after ") {
        "MCP_TOOL_TIMEOUT"
    } else {
        "LOCAL_TOOL_EXECUTION_FAILED"
    }
}
