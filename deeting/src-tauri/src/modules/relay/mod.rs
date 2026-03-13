use std::sync::{Arc, Mutex, OnceLock};

use log::warn;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::{sleep, Duration};

use crate::state::AppState;

type RelayWorkerHandle = tauri::async_runtime::JoinHandle<()>;

fn relay_worker_slot() -> &'static Mutex<Option<RelayWorkerHandle>> {
    static RELAY_WORKER_HANDLE: OnceLock<Mutex<Option<RelayWorkerHandle>>> = OnceLock::new();
    RELAY_WORKER_HANDLE.get_or_init(|| Mutex::new(None))
}

pub fn spawn_relay_event_worker(app_state: AppState, app_handle: tauri::AppHandle) {
    let mut slot = relay_worker_slot()
        .lock()
        .expect("relay worker mutex should not be poisoned");
    if let Some(handle) = slot.take() {
        handle.abort();
    }
    let handle = tauri::async_runtime::spawn(async move {
        start_relay_event_worker(app_state, app_handle).await;
    });
    *slot = Some(handle);
}

#[tauri::command]
pub fn restart_relay_event_worker(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    spawn_relay_event_worker(state.inner().clone(), app_handle);
    Ok(())
}

/// Lightweight integration client for the external `deeting-relay` service.
///
/// The relay service is a user-hosted HTTP gateway that accepts Feishu
/// callbacks (and other chat/webhook events in the future) and exposes a
/// simple long-polling API for desktop agents to pull events and send
/// replies.
#[derive(Clone, Debug)]
pub struct RelayConfig {
    pub base_url: String,
    pub shared_secret: Option<String>,
    pub agent_name: String,
}

#[derive(Clone, Debug)]
pub struct RelayClient {
    http: Client,
    config: RelayConfig,
    agent_id: Arc<tokio::sync::RwLock<Option<String>>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegisterAgentRequest {
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegisterAgentResponse {
    #[serde(rename = "agent_id")]
    agent_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RelayEvent {
    pub id: String,
    pub source: String,
    pub kind: String,
    #[serde(default)]
    pub chat_id: String,
    #[serde(default)]
    pub chat_type: String,
    #[serde(default)]
    pub message_id: String,
    #[serde(default)]
    pub open_message_id: String,
    #[serde(default)]
    pub tenant_key: String,
    #[serde(default)]
    pub sender_type: String,
    #[serde(default)]
    pub sender_open_id: String,
    #[serde(default)]
    pub sender_user_id: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub callback_token: String,
    #[serde(default)]
    pub action_event: String,
    #[serde(default)]
    pub action_tag: String,
    #[serde(default)]
    pub action_name: String,
    #[serde(default)]
    pub action_value: Value,
    #[serde(default)]
    pub form_value: Value,
    #[serde(default)]
    pub mentions: Vec<RelayMention>,
    #[serde(default)]
    pub raw: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct RelayMention {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub open_id: String,
    #[serde(default)]
    pub user_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PullEventsResponse {
    events: Vec<RelayEvent>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReplyEventRequest {
    #[serde(rename = "reply_text", skip_serializing_if = "Option::is_none")]
    reply_text: Option<String>,
    #[serde(rename = "chat_id", skip_serializing_if = "Option::is_none")]
    chat_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    callback_response: Option<Value>,
}

impl RelayClient {
    pub fn new(config: RelayConfig) -> Self {
        Self {
            http: Client::new(),
            config,
            agent_id: Arc::new(tokio::sync::RwLock::new(None)),
        }
    }

    fn base(&self) -> &str {
        self.config.base_url.trim_end_matches('/')
    }

    fn auth_header(&self) -> Option<(String, String)> {
        self.config
            .shared_secret
            .as_ref()
            .map(|value| ("X-Relay-Secret".to_string(), value.clone()))
    }

    async fn invalidate_registration(&self) {
        let mut guard = self.agent_id.write().await;
        *guard = None;
    }

    async fn pull_events_once(&self, max: usize) -> Result<Vec<RelayEvent>, String> {
        let agent_id = self.ensure_registered().await?;
        let url = format!(
            "{}/agents/{}/pull?max={}",
            self.base(),
            agent_id,
            max.max(1)
        );
        let mut req = self.http.get(url);
        if let Some((key, value)) = self.auth_header() {
            req = req.header(key, value);
        }

        let resp = req
            .send()
            .await
            .map_err(|err| format!("relay_pull_failed: {}", err))?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("relay_pull_http_{}:{}", status, body.trim()));
        }
        let body: PullEventsResponse = resp
            .json()
            .await
            .map_err(|err| format!("relay_pull_decode_failed: {}", err))?;
        Ok(body.events)
    }

    pub async fn ensure_registered(&self) -> Result<String, String> {
        {
            let guard = self.agent_id.read().await;
            if let Some(id) = guard.as_ref() {
                return Ok(id.clone());
            }
        }

        let payload = RegisterAgentRequest {
            name: self.config.agent_name.clone(),
        };
        let url = format!("{}/agents/register", self.base());
        let mut req = self.http.post(url).json(&payload);
        if let Some((key, value)) = self.auth_header() {
            req = req.header(key, value);
        }

        let resp = req
            .send()
            .await
            .map_err(|err| format!("relay_register_failed: {}", err))?;
        if !resp.status().is_success() {
            return Err(format!("relay_register_http_{}", resp.status().as_u16()));
        }
        let body: RegisterAgentResponse = resp
            .json()
            .await
            .map_err(|err| format!("relay_register_decode_failed: {}", err))?;

        let mut guard = self.agent_id.write().await;
        *guard = Some(body.agent_id.clone());
        Ok(body.agent_id)
    }

    pub async fn pull_events(&self, max: usize) -> Result<Vec<RelayEvent>, String> {
        match self.pull_events_once(max).await {
            Ok(events) => Ok(events),
            Err(err) if err.contains("agent_not_found") => {
                self.invalidate_registration().await;
                self.pull_events_once(max).await
            }
            Err(err) => Err(err),
        }
    }

    async fn submit_event_result(
        &self,
        event_id: &str,
        payload: ReplyEventRequest,
    ) -> Result<(), String> {
        let mut should_retry = true;
        loop {
            let agent_id = self.ensure_registered().await?;
            let url = format!(
                "{}/agents/{}/events/{}/reply",
                self.base(),
                agent_id,
                event_id
            );
            let mut req = self.http.post(url).json(&payload);
            if let Some((key, value)) = self.auth_header() {
                req = req.header(key, value);
            }
            let resp = req
                .send()
                .await
                .map_err(|err| format!("relay_reply_failed: {}", err))?;
            if resp.status().is_success() {
                return Ok(());
            }

            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            let err = format!("relay_reply_http_{}:{}", status, body.trim());
            if should_retry && err.contains("agent_not_found") {
                should_retry = false;
                self.invalidate_registration().await;
                continue;
            }
            return Err(err);
        }
    }

    pub async fn reply_event(
        &self,
        event_id: &str,
        chat_id: &str,
        reply_text: &str,
    ) -> Result<(), String> {
        self.submit_event_result(
            event_id,
            ReplyEventRequest {
                reply_text: Some(reply_text.to_string()),
                chat_id: Some(chat_id.to_string()),
                callback_response: None,
            },
        )
        .await
    }

    pub async fn reply_card_action(
        &self,
        event_id: &str,
        callback_response: Value,
    ) -> Result<(), String> {
        self.submit_event_result(
            event_id,
            ReplyEventRequest {
                reply_text: None,
                chat_id: None,
                callback_response: Some(callback_response),
            },
        )
        .await
    }
}

/// Background worker that continuously pulls events from the relay and
/// handles simple Feishu chat events by piping them through the local
/// orchestrator.
pub async fn start_relay_event_worker(app_state: AppState, app_handle: tauri::AppHandle) {
    // Prefer persisted desktop_config, fall back to environment variables for
    // backwards compatibility or power users.
    let stored_base_url = app_state
        .mcp
        .store
        .get_desktop_config("relay.base_url")
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let mut relay_url = stored_base_url.trim().to_string();
    if relay_url.is_empty() {
        relay_url = std::env::var("DEETING_RELAY_BASE_URL")
            .unwrap_or_else(|_| String::new())
            .trim()
            .to_string();
    }
    if relay_url.is_empty() {
        warn!("relay integration disabled: no base URL configured");
        return;
    }

    let stored_secret = app_state
        .mcp
        .store
        .get_desktop_config("relay.shared_secret")
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let shared_secret = if !stored_secret.trim().is_empty() {
        Some(stored_secret.trim().to_string())
    } else {
        std::env::var("DEETING_RELAY_SHARED_SECRET")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };

    let agent_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "deeting-desktop".to_string());

    let client = RelayClient::new(RelayConfig {
        base_url: relay_url,
        shared_secret,
        agent_name,
    });

    loop {
        match client.pull_events(8).await {
            Ok(events) if !events.is_empty() => {
                for event in events {
                    if event.source == "feishu" {
                        let result = match event.kind.as_str() {
                            "chat" => {
                                handle_feishu_chat_event(&app_state, &app_handle, &client, &event)
                                    .await
                            }
                            "card_action" => {
                                handle_feishu_card_action_event(&app_state, &client, &event).await
                            }
                            _ => Ok(()),
                        };
                        if let Err(err) = result {
                            warn!("relay_feishu_event_failed: {}", err);
                        }
                    }
                }
            }
            Ok(_) => {
                // No events, back off a bit.
                sleep(Duration::from_secs(3)).await;
            }
            Err(err) => {
                warn!("relay_pull_error: {}", err);
                sleep(Duration::from_secs(10)).await;
            }
        }
    }
}

async fn handle_feishu_chat_event(
    app_state: &AppState,
    app_handle: &tauri::AppHandle,
    client: &RelayClient,
    event: &RelayEvent,
) -> Result<(), String> {
    use crate::modules::mcp::local_orchestrator::{
        execute_local_orchestrated_chat, LocalOrchestratorInput,
    };

    let text = event.text.trim();
    if text.is_empty() {
        return Ok(());
    }

    let session_id = format!("feishu_chat_{}", event.chat_id);

    // For now we reuse the secretary model configured locally.
    let secretary = app_state
        .providers
        .store
        .get_or_create_user_secretary()
        .await
        .map_err(|err| err.to_string())?;

    let (model_name, provider_model_id) = resolve_secretary_model_selection(&secretary);

    let input = LocalOrchestratorInput {
        model: model_name,
        provider_model_id,
        session_id,
        capability_id: None,
        regenerate: false,
        compare_only: false,
        user_content: Some(text.to_string()),
        temperature: Some(0.2),
        max_tokens: Some(512),
        request_id: None,
        stream: false,
        status_stream: false,
        selected_knowledge_file_ids: Vec::new(),
    };

    // Execute local orchestrated chat without streaming back to UI.
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
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if reply_text.is_empty() {
        return Ok(());
    }

    client
        .reply_event(&event.id, &event.chat_id, &reply_text)
        .await
}

fn resolve_secretary_model_selection(
    secretary: &crate::modules::providers::types::UserSecretary,
) -> (String, Option<String>) {
    // `model_name` is kept only as a legacy fallback for stored secretary selections.
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
    (model_reference, provider_model_id)
}

fn relay_action_string(event: &RelayEvent, key: &str) -> Option<String> {
    event
        .action_value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn build_card_toast_response(message: &str, toast_type: &str) -> Value {
    json!({
        "toast": {
            "type": toast_type,
            "content": message,
        }
    })
}

async fn handle_feishu_card_action_event(
    app_state: &AppState,
    client: &RelayClient,
    event: &RelayEvent,
) -> Result<(), String> {
    use crate::modules::mcp::types::LocalTraceFeedbackRequest;
    use crate::modules::monitor::types::LocalMonitorTaskIdRequest;

    let action_event = if !event.action_event.trim().is_empty() {
        event.action_event.trim().to_string()
    } else {
        relay_action_string(event, "event").unwrap_or_default()
    };

    let callback_response = match action_event.as_str() {
        "useful" | "useless" => {
            let score = if action_event == "useful" { 1.0 } else { 0.0 };
            if let Some(trace_id) = relay_action_string(event, "trace_id") {
                app_state
                    .mcp
                    .store
                    .create_local_trace_feedback(LocalTraceFeedbackRequest {
                        trace_id,
                        score,
                        comment: None,
                        tags: Some(vec!["feishu".to_string(), action_event.clone()]),
                    })
                    .await
                    .map_err(|err| err.to_string())?;
                build_card_toast_response("感谢反馈，已记录本地 trace 反馈。", "success")
            } else if let (Some(task_id), Some(log_id)) = (
                relay_action_string(event, "monitor_task_id"),
                relay_action_string(event, "log_id"),
            ) {
                app_state
                    .monitor
                    .submit_feedback(task_id, log_id, score)
                    .await?;
                build_card_toast_response("感谢反馈，监控结果已更新。", "success")
            } else {
                build_card_toast_response("缺少反馈标识，无法记录本地反馈。", "error")
            }
        }
        "pause" => {
            if let Some(task_id) = relay_action_string(event, "monitor_task_id") {
                let response = app_state
                    .monitor
                    .pause_task(LocalMonitorTaskIdRequest { task_id })
                    .await?;
                build_card_toast_response(response.message.as_str(), "success")
            } else {
                build_card_toast_response("缺少监控任务 ID，无法暂停任务。", "error")
            }
        }
        "dialogue" => {
            if let Some(dialogue_url) = relay_action_string(event, "dialogue_url") {
                build_card_toast_response(
                    format!("请在桌面端打开对话入口：{}", dialogue_url).as_str(),
                    "success",
                )
            } else if let Some(assistant_id) = relay_action_string(event, "assistant_id") {
                build_card_toast_response(
                    format!("请在桌面端打开助手对话（assistant_id={}）。", assistant_id).as_str(),
                    "success",
                )
            } else {
                build_card_toast_response("未找到可用的桌面对话入口。", "error")
            }
        }
        "" => build_card_toast_response("缺少卡片动作标识。", "error"),
        other => {
            build_card_toast_response(format!("暂不支持的卡片动作：{}", other).as_str(), "error")
        }
    };

    client.reply_card_action(&event.id, callback_response).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_event_deserializes_card_action_payload() {
        let event: RelayEvent = serde_json::from_value(json!({
            "id": "evt-1",
            "source": "feishu",
            "kind": "card_action",
            "chat_id": "oc_123",
            "open_message_id": "om_123",
            "action_event": "pause",
            "action_value": {
                "event": "pause",
                "monitor_task_id": "task-1"
            }
        }))
        .expect("event should deserialize");

        assert_eq!(event.kind, "card_action");
        assert_eq!(event.action_event, "pause");
        assert_eq!(
            relay_action_string(&event, "monitor_task_id").as_deref(),
            Some("task-1")
        );
    }

    #[test]
    fn build_card_toast_response_returns_expected_shape() {
        let response = build_card_toast_response("ok", "success");
        assert_eq!(response["toast"]["type"], "success");
        assert_eq!(response["toast"]["content"], "ok");
    }

    #[test]
    fn resolve_secretary_model_selection_prefers_provider_model_id() {
        let secretary = crate::modules::providers::types::UserSecretary {
            id: "11111111-1111-4111-8111-111111111111".to_string(),
            user_id: "00000000-0000-0000-0000-000000000000".to_string(),
            name: "deeting".to_string(),
            model_name: Some("gpt-4o-mini".to_string()),
            provider_model_id: Some("22222222-2222-4222-8222-222222222222".to_string()),
            created_at: "2026-03-10T00:00:00Z".to_string(),
            updated_at: "2026-03-10T00:00:01Z".to_string(),
        };

        let (model_name, provider_model_id) = resolve_secretary_model_selection(&secretary);

        assert_eq!(model_name, "gpt-4o-mini");
        assert_eq!(
            provider_model_id.as_deref(),
            Some("22222222-2222-4222-8222-222222222222")
        );
    }

    #[test]
    fn resolve_secretary_model_selection_uses_default_when_secretary_empty() {
        let secretary = crate::modules::providers::types::UserSecretary {
            id: "11111111-1111-4111-8111-111111111111".to_string(),
            user_id: "00000000-0000-0000-0000-000000000000".to_string(),
            name: "deeting".to_string(),
            model_name: None,
            provider_model_id: Some("  ".to_string()),
            created_at: "2026-03-10T00:00:00Z".to_string(),
            updated_at: "2026-03-10T00:00:01Z".to_string(),
        };

        let (model_name, provider_model_id) = resolve_secretary_model_selection(&secretary);

        assert_eq!(model_name, "gpt-4o-mini");
        assert_eq!(provider_model_id, None);
    }
}
