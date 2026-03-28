use serde_json::{json, Value};

use super::truncate;
use super::types::{
    LocalExecutionResult, MonitorDeliveryPolicy, MonitorRunEvent, MonitorRunEventKind,
};

pub(super) fn build_run_event(
    execution_id: &str,
    task_id: &str,
    seq: u32,
    kind: MonitorRunEventKind,
    stage: Option<String>,
    step: Option<String>,
    state: Option<String>,
    summary: Option<String>,
    meta: Option<Value>,
) -> Value {
    let mut event = MonitorRunEvent::new(
        execution_id.trim().to_string(),
        task_id.trim().to_string(),
        seq,
        kind,
    )
    .with_stage(stage.as_deref(), step.as_deref(), state.as_deref())
    .with_meta(meta);
    if let Some(summary) = summary.filter(|value| !value.trim().is_empty()) {
        event = event.with_summary(summary);
    }
    serde_json::to_value(event).unwrap_or_else(|_| json!({}))
}

pub(super) fn build_run_terminal_event(
    execution_id: &str,
    task_id: &str,
    seq: u32,
    kind: MonitorRunEventKind,
    summary: Option<String>,
    meta: Option<Value>,
) -> Value {
    let terminal_state = match kind {
        MonitorRunEventKind::RunFailed | MonitorRunEventKind::DeliveryFailed => "failed",
        _ => "success",
    };
    build_run_event(
        execution_id,
        task_id,
        seq,
        kind,
        Some("delivery".to_string()),
        None,
        Some(terminal_state.to_string()),
        summary,
        meta,
    )
}

pub(super) fn build_delivery_failed_event(
    execution_id: &str,
    task_id: &str,
    seq: u32,
    error_message: &str,
) -> Value {
    build_run_terminal_event(
        execution_id,
        task_id,
        seq,
        MonitorRunEventKind::DeliveryFailed,
        Some("monitor delivery failed".to_string()),
        Some(json!({
            "error": truncate(error_message, 600),
        })),
    )
}

pub(super) fn project_tool_trace_run_events(
    events: &mut Vec<Value>,
    execution_id: &str,
    task_id: &str,
    starting_seq: u32,
    tool_trace: &[Value],
) -> u32 {
    let mut seq = starting_seq;
    for item in tool_trace {
        let tool_name = item
            .get("name")
            .or_else(|| item.get("tool_name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("tool");
        let call_id = item
            .get("id")
            .or_else(|| item.get("call_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default();

        events.push(build_run_event(
            execution_id,
            task_id,
            seq,
            MonitorRunEventKind::ToolCalled,
            Some("execute".to_string()),
            Some(tool_name.to_string()),
            Some("running".to_string()),
            Some(format!("调用工具 {}", tool_name)),
            Some(json!({
                "tool_name": tool_name,
                "call_id": call_id,
            })),
        ));
        seq += 1;

        let status = item
            .get("status")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_ascii_lowercase();
        let terminal_kind = match status.as_str() {
            "success" | "succeeded" | "ok" | "completed" => {
                Some(MonitorRunEventKind::ToolSucceeded)
            }
            "error" | "failed" | "failure" => Some(MonitorRunEventKind::ToolFailed),
            _ => None,
        };

        if let Some(kind) = terminal_kind {
            let terminal_state = if matches!(&kind, MonitorRunEventKind::ToolFailed) {
                "failed".to_string()
            } else {
                "success".to_string()
            };
            let summary = match &kind {
                MonitorRunEventKind::ToolSucceeded => format!("工具 {} 执行成功", tool_name),
                MonitorRunEventKind::ToolFailed => format!("工具 {} 执行失败", tool_name),
                _ => tool_name.to_string(),
            };
            let error_message = item
                .get("error")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            events.push(build_run_event(
                execution_id,
                task_id,
                seq,
                kind,
                Some("execute".to_string()),
                Some(tool_name.to_string()),
                Some(terminal_state),
                Some(summary),
                Some(json!({
                    "tool_name": tool_name,
                    "call_id": call_id,
                    "error": error_message,
                })),
            ));
            seq += 1;
        }
    }
    seq
}

pub(super) fn should_notify_run(
    policy: &MonitorDeliveryPolicy,
    result: Option<&LocalExecutionResult>,
    failure_message: Option<&str>,
    force_notify: bool,
) -> bool {
    if force_notify {
        return true;
    }
    if failure_message.is_some() {
        return policy.notify_on_failure;
    }
    let Some(result) = result else {
        return false;
    };
    result.is_significant_change && policy.notify_on_change
}
