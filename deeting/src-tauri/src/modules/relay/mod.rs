use std::sync::Arc;

use log::warn;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{sleep, Duration};

use crate::modules::im::handlers::{build_card_action_response, generate_local_chat_reply};
use crate::modules::im::ImConnectionProfile;
use crate::state::AppState;

#[tauri::command]
pub fn restart_relay_event_worker(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    crate::modules::im::runtime::restart_im_runtime_worker(state, app_handle)?;
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

pub async fn start_relay_profile_worker(
    app_state: AppState,
    app_handle: tauri::AppHandle,
    profile: ImConnectionProfile,
) -> Result<(), String> {
    let relay_url = profile.relay_config.base_url.trim().to_string();
    if relay_url.is_empty() {
        return Err(format!(
            "relay profile {} is missing base_url",
            profile.id
        ));
    }

    let shared_secret = Some(profile.relay_config.shared_secret.trim().to_string())
        .filter(|value| !value.is_empty());
    let agent_name = format!(
        "{}-{}",
        std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "deeting-desktop".to_string()),
        profile.id
    );

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
                                handle_feishu_chat_event(
                                    &app_state,
                                    &app_handle,
                                    &client,
                                    &profile,
                                    &event,
                                )
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
    profile: &ImConnectionProfile,
    event: &RelayEvent,
) -> Result<(), String> {
    let session_id = format!("im:{}:chat:{}", profile.id, event.chat_id);
    let Some(reply_text) = generate_local_chat_reply(
        app_state,
        app_handle,
        event.text.as_str(),
        session_id.as_str(),
    )
    .await?
    else {
        return Ok(());
    };

    client
        .reply_event(&event.id, &event.chat_id, &reply_text)
        .await
}

async fn handle_feishu_card_action_event(
    app_state: &AppState,
    client: &RelayClient,
    event: &RelayEvent,
) -> Result<(), String> {
    let response =
        build_card_action_response(app_state, event.action_event.as_str(), &event.action_value)
            .await?;
    let callback_response = serde_json::to_value(&response).map_err(|err| err.to_string())?;
    client.reply_card_action(&event.id, callback_response).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
        assert_eq!(event.action_value["monitor_task_id"], "task-1");
    }
}
