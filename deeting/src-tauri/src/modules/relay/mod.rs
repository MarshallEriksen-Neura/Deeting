use std::collections::HashMap;
use std::sync::Arc;

use log::warn;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{sleep, Duration};

use crate::modules::im::handlers::{
    build_direct_card_action_outcome, build_text_approval_prompt, generate_local_chat_reply_outcome,
};
use crate::modules::im::{ImConnectionProfile, MessageContent};
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
/// The relay service exposes a platform-neutral long-polling API:
/// desktop workers pull canonical events and push canonical message /
/// interaction responses back. Feishu is the only fully implemented adapter
/// today, but the relay protocol is no longer hard-wired to Feishu field names.
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

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct RelayConversationRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct RelaySenderRef {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub secondary_id: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct RelayMessageRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub reply_to: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct RelayInteractionRef {
    #[serde(default)]
    pub callback_id: String,
    #[serde(default)]
    pub action_id: String,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub form_value: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct RelayEvent {
    pub id: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub conversation: RelayConversationRef,
    #[serde(default)]
    pub sender: RelaySenderRef,
    #[serde(default)]
    pub message: Option<RelayMessageRef>,
    #[serde(default)]
    pub interaction: Option<RelayInteractionRef>,
    #[serde(default)]
    pub mentions: Vec<RelayMention>,
    #[serde(default)]
    pub platform_meta: Value,
    #[serde(default)]
    pub raw: Value,
}

impl RelayEvent {
    fn platform_key(&self) -> &str {
        self.platform.trim()
    }

    fn kind_key(&self) -> &str {
        self.kind.trim()
    }

    fn conversation_id(&self) -> Option<&str> {
        let trimmed = self.conversation.id.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }

    fn message_id(&self) -> Option<&str> {
        self.message
            .as_ref()
            .map(|message| message.id.trim())
            .filter(|value| !value.is_empty())
    }

    fn message_text(&self) -> Option<&str> {
        self.message
            .as_ref()
            .map(|message| message.text.trim())
            .filter(|value| !value.is_empty())
    }

    fn interaction_callback_id(&self) -> Option<&str> {
        self.interaction
            .as_ref()
            .map(|interaction| interaction.callback_id.trim())
            .filter(|value| !value.is_empty())
    }

    fn interaction_action_id(&self) -> Option<&str> {
        self.interaction
            .as_ref()
            .map(|interaction| interaction.action_id.trim())
            .filter(|value| !value.is_empty())
    }

    fn interaction_value(&self) -> Value {
        self.interaction
            .as_ref()
            .map(|interaction| interaction.value.clone())
            .unwrap_or(Value::Null)
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct PullEventsResponse {
    events: Vec<RelayEvent>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
struct RelayOutboundMessage {
    platform: String,
    conversation: RelayConversationRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<String>,
    content: MessageContent,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
struct RelayInteractionResponse {
    platform: String,
    callback_id: String,
    payload: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReplyEventRequest {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    messages: Vec<RelayOutboundMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    interaction_response: Option<RelayInteractionResponse>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingRelayTextApproval {
    approval_token: String,
    call_id: Option<String>,
    tool_name: String,
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

    async fn reply_result(
        &self,
        event_id: &str,
        messages: Vec<RelayOutboundMessage>,
        interaction_response: Option<RelayInteractionResponse>,
    ) -> Result<(), String> {
        self.submit_event_result(
            event_id,
            ReplyEventRequest {
                messages,
                interaction_response,
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
        return Err(format!("relay profile {} is missing base_url", profile.id));
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
    let mut pending_text_approvals = HashMap::<String, PendingRelayTextApproval>::new();

    loop {
        match client.pull_events(8).await {
            Ok(events) if !events.is_empty() => {
                for event in events {
                    let result = match (event.platform_key(), event.kind_key()) {
                        (platform, "message") if !platform.is_empty() => {
                            handle_relay_message_event(
                                &app_state,
                                &app_handle,
                                &client,
                                &profile,
                                &event,
                                &mut pending_text_approvals,
                            )
                            .await
                        }
                        ("feishu", "interaction") => {
                            handle_feishu_interaction_event(
                                &app_state,
                                &app_handle,
                                &client,
                                &event,
                            )
                            .await
                        }
                        (platform, kind) => {
                            warn!(
                                "relay_event_ignored platform={} kind={} reason=unsupported",
                                platform, kind
                            );
                            Ok(())
                        }
                    };
                    if let Err(err) = result {
                        warn!("relay_event_failed id={} err={}", event.id, err);
                    }
                }
            }
            Ok(_) => {
                sleep(Duration::from_secs(3)).await;
            }
            Err(err) => {
                warn!("relay_pull_error: {}", err);
                sleep(Duration::from_secs(10)).await;
            }
        }
    }
}

fn platform_supports_interaction_cards(platform: &str) -> bool {
    platform.eq_ignore_ascii_case("feishu")
}

fn text_approval_key(platform: &str, conversation_id: &str) -> String {
    format!(
        "{}:{}",
        platform.trim().to_ascii_lowercase(),
        conversation_id.trim()
    )
}

fn parse_text_approval_command(text: &str) -> Option<bool> {
    match text.trim() {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

fn build_outbound_message(
    event: &RelayEvent,
    content: MessageContent,
) -> Result<RelayOutboundMessage, String> {
    let conversation_id = event
        .conversation_id()
        .ok_or_else(|| "relay event missing conversation id".to_string())?;

    Ok(RelayOutboundMessage {
        platform: event.platform_key().to_string(),
        conversation: RelayConversationRef {
            id: conversation_id.to_string(),
            kind: event.conversation.kind.clone(),
        },
        reply_to: event.message_id().map(str::to_string),
        content,
    })
}

async fn resolve_pending_text_approval(
    app_state: &AppState,
    app_handle: &tauri::AppHandle,
    client: &RelayClient,
    event: &RelayEvent,
    pending: PendingRelayTextApproval,
    approved: bool,
) -> Result<(), String> {
    let outcome = build_direct_card_action_outcome(
        app_handle,
        app_state,
        if approved {
            "approve_tool"
        } else {
            "reject_tool"
        },
        &serde_json::json!({
            "approval_token": pending.approval_token,
            "call_id": pending.call_id,
            "tool_name": pending.tool_name,
        }),
    )
    .await?;
    let messages = outcome
        .follow_up_messages
        .into_iter()
        .map(|message| build_outbound_message(event, message))
        .collect::<Result<Vec<_>, _>>()?;

    client.reply_result(&event.id, messages, None).await
}

async fn handle_relay_message_event(
    app_state: &AppState,
    app_handle: &tauri::AppHandle,
    client: &RelayClient,
    profile: &ImConnectionProfile,
    event: &RelayEvent,
    pending_text_approvals: &mut HashMap<String, PendingRelayTextApproval>,
) -> Result<(), String> {
    let platform = event.platform_key();
    let conversation_id = event
        .conversation_id()
        .ok_or_else(|| "relay event missing conversation id".to_string())?;
    let text = event
        .message_text()
        .ok_or_else(|| "relay message event missing text".to_string())?;
    let approval_key = text_approval_key(platform, conversation_id);

    if let Some(pending) = pending_text_approvals.get(&approval_key).cloned() {
        if let Some(approved) = parse_text_approval_command(text) {
            pending_text_approvals.remove(&approval_key);
            return resolve_pending_text_approval(
                app_state, app_handle, client, event, pending, approved,
            )
            .await;
        }

        let reminder = build_outbound_message(
            event,
            MessageContent::Text {
                text: "当前有待审批操作，请先回复 `1` 确认执行，或回复 `0` 拒绝执行。".to_string(),
            },
        )?;
        return client.reply_result(&event.id, vec![reminder], None).await;
    }

    let session_id = format!("im:{}:chat:{}", profile.id, conversation_id);
    let Some(reply_outcome) =
        generate_local_chat_reply_outcome(app_state, app_handle, text, session_id.as_str()).await?
    else {
        return Ok(());
    };

    if !platform_supports_interaction_cards(platform) {
        if let Some(approval_request) = reply_outcome.approval_request {
            pending_text_approvals.insert(
                approval_key,
                PendingRelayTextApproval {
                    approval_token: approval_request.approval_token.clone(),
                    call_id: approval_request.call_id.clone(),
                    tool_name: approval_request.tool_name.clone(),
                },
            );
            let outbound = build_outbound_message(
                event,
                MessageContent::Text {
                    text: build_text_approval_prompt(&approval_request),
                },
            )?;
            return client.reply_result(&event.id, vec![outbound], None).await;
        }
    }

    let outbound = build_outbound_message(event, reply_outcome.content)?;
    client.reply_result(&event.id, vec![outbound], None).await
}

async fn handle_feishu_interaction_event(
    app_state: &AppState,
    app_handle: &tauri::AppHandle,
    client: &RelayClient,
    event: &RelayEvent,
) -> Result<(), String> {
    let action_id = event.interaction_action_id().unwrap_or_default();
    let outcome = build_direct_card_action_outcome(
        app_handle,
        app_state,
        action_id,
        &event.interaction_value(),
    )
    .await?;
    let callback_id = event
        .interaction_callback_id()
        .ok_or_else(|| "relay interaction event missing callback id".to_string())?;
    let interaction_response = RelayInteractionResponse {
        platform: event.platform_key().to_string(),
        callback_id: callback_id.to_string(),
        payload: serde_json::to_value(&outcome.callback_response).map_err(|err| err.to_string())?,
    };
    let messages = outcome
        .follow_up_messages
        .into_iter()
        .map(|message| build_outbound_message(event, message))
        .collect::<Result<Vec<_>, _>>()?;

    client
        .reply_result(&event.id, messages, Some(interaction_response))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn relay_event_deserializes_canonical_interaction_payload() {
        let event: RelayEvent = serde_json::from_value(json!({
            "id": "evt-1",
            "platform": "feishu",
            "kind": "interaction",
            "conversation": {
                "id": "oc_123",
                "kind": "group"
            },
            "sender": {
                "kind": "user",
                "id": "ou_123"
            },
            "message": {
                "id": "om_123",
                "reply_to": "om_123"
            },
            "interaction": {
                "callback_id": "cb_123",
                "action_id": "pause",
                "value": {
                    "event": "pause",
                    "monitor_task_id": "task-1"
                }
            }
        }))
        .expect("event should deserialize");

        assert_eq!(event.platform, "feishu");
        assert_eq!(event.kind, "interaction");
        assert_eq!(event.conversation.id, "oc_123");
        assert_eq!(
            event
                .interaction
                .as_ref()
                .and_then(|interaction| interaction.value.get("monitor_task_id"))
                .and_then(Value::as_str),
            Some("task-1")
        );
    }

    #[test]
    fn reply_request_serializes_canonical_messages_and_interaction_response() {
        let payload = ReplyEventRequest {
            messages: vec![RelayOutboundMessage {
                platform: "feishu".to_string(),
                conversation: RelayConversationRef {
                    id: "oc_123".to_string(),
                    kind: "group".to_string(),
                },
                reply_to: Some("om_123".to_string()),
                content: MessageContent::Text {
                    text: "hello".to_string(),
                },
            }],
            interaction_response: Some(RelayInteractionResponse {
                platform: "feishu".to_string(),
                callback_id: "cb_123".to_string(),
                payload: json!({
                    "toast": {
                        "type": "success",
                        "content": "ok"
                    }
                }),
            }),
        };

        let serialized = serde_json::to_value(&payload).expect("payload should serialize");
        assert!(serialized.get("messages").is_some());
        assert!(serialized.get("interaction_response").is_some());
        assert!(serialized.get("reply_text").is_none());
    }

    #[test]
    fn parse_text_approval_command_accepts_numeric_choices() {
        assert_eq!(parse_text_approval_command("1"), Some(true));
        assert_eq!(parse_text_approval_command("0"), Some(false));
        assert_eq!(parse_text_approval_command(" 1 "), Some(true));
        assert_eq!(parse_text_approval_command("yes"), None);
    }

    #[test]
    fn non_feishu_platforms_do_not_claim_card_support() {
        assert!(platform_supports_interaction_cards("feishu"));
        assert!(!platform_supports_interaction_cards("telegram"));
        assert!(!platform_supports_interaction_cards("dingtalk"));
        assert!(!platform_supports_interaction_cards("wechat"));
    }
}
