use serde_json::Value;

use crate::modules::im::{CardActionResponse, ToastResponse, ToastType};
use crate::state::AppState;

fn action_string(value: &Value, key: &str) -> Option<String> {
    value.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn toast_response(message: &str, toast_type: ToastType) -> CardActionResponse {
    CardActionResponse {
        toast: Some(ToastResponse {
            toast_type,
            content: message.to_string(),
        }),
        update_card: None,
    }
}

pub(crate) async fn generate_local_chat_reply(
    app_state: &AppState,
    app_handle: &tauri::AppHandle,
    text: &str,
    session_id: &str,
) -> Result<Option<String>, String> {
    use crate::modules::mcp::local_orchestrator::{
        execute_local_orchestrated_chat, LocalOrchestratorInput,
    };

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let secretary = app_state
        .providers
        .store
        .get_or_create_user_secretary()
        .await
        .map_err(|err| err.to_string())?;

    let model_reference = secretary
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("gpt-4o-mini")
        .to_string();
    let provider_model_id = secretary
        .provider_model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let input = LocalOrchestratorInput {
        model: model_reference,
        provider_model_id,
        session_id: session_id.trim().to_string(),
        capability_id: None,
        regenerate: false,
        compare_only: false,
        user_content: Some(trimmed.to_string()),
        temperature: Some(0.2),
        max_tokens: Some(512),
        request_id: None,
        stream: false,
        status_stream: false,
        selected_knowledge_file_ids: Vec::new(),
    };

    let response = execute_local_orchestrated_chat(
        app_handle,
        app_state,
        input,
        uuid::Uuid::new_v4().to_string(),
        None,
    )
    .await?;

    let reply_text = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    Ok(reply_text)
}

pub(crate) async fn build_card_action_response(
    app_state: &AppState,
    action_event: &str,
    action_value: &Value,
) -> Result<CardActionResponse, String> {
    use crate::modules::mcp::types::LocalTraceFeedbackRequest;
    use crate::modules::monitor::types::LocalMonitorTaskIdRequest;

    let normalized_action = {
        let trimmed = action_event.trim();
        if trimmed.is_empty() {
            action_string(action_value, "event").unwrap_or_default()
        } else {
            trimmed.to_string()
        }
    };

    let response = match normalized_action.as_str() {
        "useful" | "useless" => {
            let score = if normalized_action == "useful" { 1.0 } else { 0.0 };
            if let Some(trace_id) = action_string(action_value, "trace_id") {
                app_state
                    .mcp
                    .store
                    .create_local_trace_feedback(LocalTraceFeedbackRequest {
                        trace_id,
                        score,
                        comment: None,
                        tags: Some(vec!["feishu".to_string(), normalized_action.clone()]),
                    })
                    .await
                    .map_err(|err| err.to_string())?;
                toast_response("感谢反馈，已记录本地 trace 反馈。", ToastType::Success)
            } else if let (Some(task_id), Some(log_id)) = (
                action_string(action_value, "monitor_task_id"),
                action_string(action_value, "log_id"),
            ) {
                app_state.monitor.submit_feedback(task_id, log_id, score).await?;
                toast_response("感谢反馈，监控结果已更新。", ToastType::Success)
            } else {
                toast_response("缺少反馈标识，无法记录本地反馈。", ToastType::Error)
            }
        }
        "pause" => {
            if let Some(task_id) = action_string(action_value, "monitor_task_id") {
                let result = app_state
                    .monitor
                    .pause_task(LocalMonitorTaskIdRequest { task_id })
                    .await?;
                toast_response(result.message.as_str(), ToastType::Success)
            } else {
                toast_response("缺少监控任务 ID，无法暂停任务。", ToastType::Error)
            }
        }
        "dialogue" => {
            if let Some(dialogue_url) = action_string(action_value, "dialogue_url") {
                toast_response(
                    format!("请在桌面端打开对话入口：{}", dialogue_url).as_str(),
                    ToastType::Success,
                )
            } else if let Some(assistant_id) = action_string(action_value, "assistant_id") {
                toast_response(
                    format!("请在桌面端打开助手对话（assistant_id={}）。", assistant_id).as_str(),
                    ToastType::Success,
                )
            } else {
                toast_response("未找到可用的桌面对话入口。", ToastType::Error)
            }
        }
        "" => toast_response("缺少卡片动作标识。", ToastType::Error),
        other => toast_response(
            format!("暂不支持的卡片动作：{}", other).as_str(),
            ToastType::Error,
        ),
    };

    Ok(response)
}
