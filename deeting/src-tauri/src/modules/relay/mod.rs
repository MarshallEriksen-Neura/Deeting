use std::sync::Arc;

use log::warn;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::{sleep, Duration};

use crate::state::AppState;

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
    pub text: String,
    #[serde(default)]
    pub raw: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct PullEventsResponse {
    events: Vec<RelayEvent>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReplyEventRequest {
    #[serde(rename = "reply_text")]
    reply_text: String,
    #[serde(rename = "chat_id")]
    chat_id: String,
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
            return Err(format!("relay_pull_http_{}", resp.status().as_u16()));
        }
        let body: PullEventsResponse = resp
            .json()
            .await
            .map_err(|err| format!("relay_pull_decode_failed: {}", err))?;
        Ok(body.events)
    }

    pub async fn reply_event(
        &self,
        event_id: &str,
        chat_id: &str,
        reply_text: &str,
    ) -> Result<(), String> {
        let agent_id = self.ensure_registered().await?;
        let url = format!(
            "{}/agents/{}/events/{}/reply",
            self.base(),
            agent_id,
            event_id
        );
        let mut req = self.http.post(url).json(&ReplyEventRequest {
            reply_text: reply_text.to_string(),
            chat_id: chat_id.to_string(),
        });
        if let Some((key, value)) = self.auth_header() {
            req = req.header(key, value);
        }
        let resp = req
            .send()
            .await
            .map_err(|err| format!("relay_reply_failed: {}", err))?;
        if !resp.status().is_success() {
            return Err(format!("relay_reply_http_{}", resp.status().as_u16()));
        }
        Ok(())
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
                    if event.source == "feishu" && event.kind == "chat" {
                        if let Err(err) =
                            handle_feishu_chat_event(&app_state, &app_handle, &client, &event).await
                        {
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

    let model_name = secretary
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("gpt-4o-mini");

    let input = LocalOrchestratorInput {
        model: model_name.to_string(),
        provider_model_id: None,
        session_id,
        assistant_id: None,
        regenerate: false,
        user_content: Some(text.to_string()),
        temperature: Some(0.2),
        max_tokens: Some(512),
        request_id: None,
        stream: false,
        status_stream: false,
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
