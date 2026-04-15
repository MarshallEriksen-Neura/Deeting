use serde_json::Value;
use tauri::AppHandle;

use crate::modules::custom_task_agents::runtime::preview_custom_task_agent;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentPreviewRequest, CustomTaskAgentProfile,
};
use crate::modules::desktop_config::{parse_max_agentic_rounds, MAX_AGENTIC_ROUNDS_CONFIG_KEY};
use crate::modules::monitor::types::LocalMonitorTask;
use crate::state::AppState;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MonitorTaskAgentExecution {
    pub(crate) content: String,
    pub(crate) model_id: String,
    pub(crate) tokens_used: i64,
    pub(crate) tool_trace: Vec<Value>,
}

pub(crate) fn validate_monitor_task_agent_profile(
    profile: &CustomTaskAgentProfile,
) -> Result<(), String> {
    if profile.is_deleted {
        return Err("绑定的任务智能体已删除".to_string());
    }
    if !profile.is_enabled {
        return Err("绑定的任务智能体已停用".to_string());
    }
    if profile.invocation_kind != CustomTaskAgentInvocationKind::Chat {
        return Err("主动寻猎仅支持绑定聊天任务智能体".to_string());
    }
    Ok(())
}

pub(crate) fn build_monitor_task_agent_message(task: &LocalMonitorTask) -> String {
    let snapshot = task
        .last_snapshot
        .as_ref()
        .filter(|value| value.is_object())
        .map(Value::to_string)
        .unwrap_or_else(|| "{}".to_string());
    let tools = if task.allowed_tools.is_empty() {
        "未限制".to_string()
    } else {
        task.allowed_tools.join(", ")
    };
    let policy_state = if task.policy_state.is_object()
        && task
            .policy_state
            .as_object()
            .is_some_and(|items| !items.is_empty())
    {
        task.policy_state.to_string()
    } else {
        "{}".to_string()
    };
    format!(
        "你正在作为已绑定的主动寻猎任务智能体执行研判。\n任务标题: {}\n监控目标: {}\n执行频率: {}\n研判模式: {}\n允许工具: {}\n策略状态: {}\n历史快照: {}\n\n请输出 JSON:\n{{\"is_significant_change\": boolean, \"change_summary\": \"markdown\", \"new_snapshot\": {{}}, \"strategy_tag\": \"string\", \"observations\": {{}}}}",
        task.title,
        task.objective,
        task.cron_expr,
        task.analysis_mode,
        tools,
        policy_state,
        snapshot
    )
}

async fn resolve_monitor_task_agent_max_rounds(app_state: &AppState) -> u32 {
    let configured_max_rounds = app_state
        .mcp
        .store
        .get_desktop_config(MAX_AGENTIC_ROUNDS_CONFIG_KEY)
        .await
        .ok()
        .flatten();
    parse_max_agentic_rounds(configured_max_rounds.as_deref()).min(u32::MAX as usize) as u32
}

pub(crate) async fn execute_monitor_task_agent(
    app_handle: &AppHandle,
    app_state: &AppState,
    profile: &CustomTaskAgentProfile,
    message: &str,
) -> Result<MonitorTaskAgentExecution, String> {
    validate_monitor_task_agent_profile(profile)?;
    let max_rounds = resolve_monitor_task_agent_max_rounds(app_state).await;

    let response = preview_custom_task_agent(
        app_handle,
        app_state,
        profile,
        CustomTaskAgentPreviewRequest {
            message: message.to_string(),
            image_urls: Vec::new(),
            temperature: None,
            max_tokens: None,
            max_rounds: Some(max_rounds),
            worker_task_packet: None,
        },
    )
    .await
    .map_err(|err| err.to_string())?;

    let content = response.content.trim().to_string();
    if content.is_empty() {
        return Err("模型返回内容为空".to_string());
    }

    Ok(MonitorTaskAgentExecution {
        content,
        model_id: response.model_id,
        tokens_used: response.raw.as_ref().map(extract_total_tokens).unwrap_or(0),
        tool_trace: response.tool_trace,
    })
}

fn extract_total_tokens(value: &Value) -> i64 {
    value
        .get("usage")
        .and_then(|usage| {
            usage
                .get("total_tokens")
                .and_then(Value::as_i64)
                .or_else(|| {
                    usage
                        .get("total_tokens")
                        .and_then(Value::as_u64)
                        .map(|v| v as i64)
                })
                .or_else(|| {
                    let input = usage
                        .get("prompt_tokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    let output = usage
                        .get("completion_tokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    if input > 0 || output > 0 {
                        Some(input + output)
                    } else {
                        None
                    }
                })
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn build_task_agent_profile(
        invocation_kind: CustomTaskAgentInvocationKind,
        is_enabled: bool,
        is_deleted: bool,
    ) -> CustomTaskAgentProfile {
        CustomTaskAgentProfile {
            id: "agent-1".to_string(),
            name: "Agent One".to_string(),
            description: Some("monitor agent".to_string()),
            task_prompt: "watch the world".to_string(),
            invocation_kind,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: Vec::new(),
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: Vec::new(),
            bound_asset_id: None,
            tags: Vec::new(),
            discoverable: true,
            is_enabled,
            is_deleted,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
        }
    }

    fn build_monitor_task() -> LocalMonitorTask {
        LocalMonitorTask {
            id: "task-1".to_string(),
            user_id: "user-1".to_string(),
            title: "Iran watch".to_string(),
            objective: "Monitor developments".to_string(),
            cron_expr: "0 */6 * * *".to_string(),
            status: "active".to_string(),
            last_snapshot: Some(json!({"foo": "bar"})),
            last_executed_at: None,
            next_run_at: None,
            current_interval_minutes: Some(360),
            display_status: "active".to_string(),
            strategy_variants: None,
            analysis_mode: "alert_first".to_string(),
            policy_state: json!({"score": 0.9}),
            binding_state: "ok".to_string(),
            binding_error: None,
            assistant_id: Some("agent-1".to_string()),
            assistant_name: Some("Agent One".to_string()),
            model_id: None,
            error_count: 0,
            notify_config: json!({}),
            allowed_tools: vec!["search_sdk".to_string()],
            execution_target: "desktop".to_string(),
            total_tokens: 0,
            is_active: true,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn monitor_task_agent_profile_must_be_enabled() {
        let error = validate_monitor_task_agent_profile(&build_task_agent_profile(
            CustomTaskAgentInvocationKind::Chat,
            false,
            false,
        ))
        .expect_err("disabled agent should fail");

        assert_eq!(error, "绑定的任务智能体已停用");
    }

    #[test]
    fn monitor_task_agent_profile_must_not_be_deleted() {
        let error = validate_monitor_task_agent_profile(&build_task_agent_profile(
            CustomTaskAgentInvocationKind::Chat,
            true,
            true,
        ))
        .expect_err("deleted agent should fail");

        assert_eq!(error, "绑定的任务智能体已删除");
    }

    #[test]
    fn monitor_task_agent_profile_must_be_chat_kind() {
        let error = validate_monitor_task_agent_profile(&build_task_agent_profile(
            CustomTaskAgentInvocationKind::ImageGeneration,
            true,
            false,
        ))
        .expect_err("non-chat agent should fail");

        assert_eq!(error, "主动寻猎仅支持绑定聊天任务智能体");
    }

    #[test]
    fn build_monitor_task_agent_message_includes_analysis_mode_and_snapshot() {
        let message = build_monitor_task_agent_message(&build_monitor_task());

        assert!(message.contains("研判模式: alert_first"));
        assert!(message.contains("历史快照: {\"foo\":\"bar\"}"));
        assert!(message.contains("策略状态: {\"score\":0.9}"));
    }
}
