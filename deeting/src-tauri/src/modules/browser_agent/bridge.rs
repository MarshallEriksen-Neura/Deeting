use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tokio::time::timeout;
use tokio_tungstenite::{accept_async, tungstenite::Message as WsMessage};
use uuid::Uuid;

use crate::modules::browser_agent::types::{
    BrowserAgentAction, BrowserAgentCommandMessage, BrowserAgentEventMessage,
    BrowserAgentHelloMessage, BrowserAgentLookupHit, BrowserAgentLookupPageContext,
    BrowserAgentLookupPayload, BrowserAgentPageContext, BrowserAgentQueryMessage,
    BrowserAgentQueryResultMessage, BrowserAgentResultError, BrowserAgentResultMessage,
};

#[derive(Debug, Clone)]
pub struct BrowserBridgeSnapshot {
    pub running: bool,
    pub connected_sessions: usize,
    pub active_session_id: Option<String>,
    pub active_page: Option<BrowserAgentPageContext>,
}

#[derive(Clone)]
pub struct BrowserAgentBridgeState {
    inner: Arc<Mutex<Option<BrowserBridgeHandle>>>,
}

#[derive(Clone)]
struct BrowserBridgeHandle {
    base_url: String,
    state: Arc<BrowserBridgeServerState>,
}

#[derive(Default)]
struct BrowserBridgeStore {
    sessions: HashMap<String, BrowserBridgeSession>,
    pending: HashMap<String, oneshot::Sender<BrowserAgentResultMessage>>,
}

struct BrowserBridgeSession {
    hello: BrowserAgentHelloMessage,
    sender: mpsc::UnboundedSender<String>,
    connected_at_unix_ms: i128,
    active_page: Option<BrowserAgentPageContext>,
}

struct BrowserBridgeServerState {
    store: Arc<RwLock<BrowserBridgeStore>>,
}

impl BrowserAgentBridgeState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn ensure_started(&self, base_url: &str) -> Result<String, String> {
        let mut guard = self.inner.lock().await;
        if let Some(handle) = guard.as_ref() {
            return Ok(handle.base_url.clone());
        }

        let (host, port) = super::service::bridge_socket_target(base_url)?;
        let listener = tokio::net::TcpListener::bind((host.as_str(), port))
            .await
            .map_err(|err| format!("failed to bind browser agent bridge: {err}"))?;

        let state = Arc::new(BrowserBridgeServerState {
            store: Arc::new(RwLock::new(BrowserBridgeStore::default())),
        });
        let state_for_task = state.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((stream, _addr)) = listener.accept().await else {
                    break;
                };
                let state = state_for_task.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = handle_browser_bridge_connection(stream, state).await {
                        log::warn!("browser_agent bridge connection closed: {}", err);
                    }
                });
            }
        });

        *guard = Some(BrowserBridgeHandle {
            base_url: base_url.to_string(),
            state,
        });
        Ok(base_url.to_string())
    }

    pub async fn snapshot(&self) -> BrowserBridgeSnapshot {
        let handle = { self.inner.lock().await.clone() };
        let Some(handle) = handle else {
            return BrowserBridgeSnapshot {
                running: false,
                connected_sessions: 0,
                active_session_id: None,
                active_page: None,
            };
        };

        let store = handle.state.store.read().await;
        let active_session = store
            .sessions
            .values()
            .max_by_key(|session| session.connected_at_unix_ms);

        BrowserBridgeSnapshot {
            running: true,
            connected_sessions: store.sessions.len(),
            active_session_id: active_session.map(|session| session.hello.session_id.clone()),
            active_page: active_session.and_then(|session| session.active_page.clone()),
        }
    }

    pub async fn dispatch_action(
        &self,
        base_url: &str,
        action: BrowserAgentAction,
    ) -> Result<Value, String> {
        self.ensure_started(base_url).await?;
        let handle = self
            .inner
            .lock()
            .await
            .clone()
            .ok_or_else(|| "browser agent bridge is unavailable".to_string())?;

        let (request_id, sender) = {
            let store = handle.state.store.read().await;
            let session = store
                .sessions
                .values()
                .max_by_key(|session| session.connected_at_unix_ms)
                .ok_or_else(|| "no browser agent extension session is connected".to_string())?;
            (Uuid::new_v4().to_string(), session.sender.clone())
        };

        let (tx, rx) = oneshot::channel::<BrowserAgentResultMessage>();
        {
            let mut store = handle.state.store.write().await;
            store.pending.insert(request_id.clone(), tx);
        }

        let payload = serde_json::to_string(&BrowserAgentCommandMessage {
            message_type: "command".to_string(),
            request_id: request_id.clone(),
            action,
        })
        .map_err(|err| err.to_string())?;

        if sender.send(payload).is_err() {
            let mut store = handle.state.store.write().await;
            store.pending.remove(&request_id);
            return Err("browser agent session is no longer writable".to_string());
        }

        let result = match timeout(Duration::from_secs(10), rx).await {
            Ok(Ok(message)) => message,
            Ok(Err(_closed)) => {
                let mut store = handle.state.store.write().await;
                store.pending.remove(&request_id);
                return Err("browser agent request channel closed".to_string());
            }
            Err(_elapsed) => {
                let mut store = handle.state.store.write().await;
                store.pending.remove(&request_id);
                return Err("browser agent request timed out".to_string());
            }
        };

        if result.ok {
            Ok(result.data.unwrap_or(Value::Null))
        } else {
            Err(result
                .error
                .map(|error| error.message)
                .unwrap_or_else(|| "browser agent action failed".to_string()))
        }
    }
}

async fn handle_browser_bridge_connection(
    stream: tokio::net::TcpStream,
    state: Arc<BrowserBridgeServerState>,
) -> Result<(), String> {
    let ws_stream = accept_async(stream)
        .await
        .map_err(|err| format!("browser agent handshake failed: {err}"))?;
    let (mut writer, mut reader) = ws_stream.split();

    let hello = match reader.next().await {
        Some(Ok(WsMessage::Text(text))) => serde_json::from_str::<BrowserAgentHelloMessage>(&text)
            .map_err(|err| format!("browser agent hello parse failed: {err}"))?,
        Some(Ok(other)) => {
            return Err(format!(
                "browser agent expected hello text frame, got {other:?}"
            ));
        }
        Some(Err(err)) => return Err(format!("browser agent hello read failed: {err}")),
        None => return Err("browser agent connection closed before hello".to_string()),
    };

    if hello.message_type != "hello" || hello.role.trim() != "extension" {
        return Err("browser agent hello frame is invalid".to_string());
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let session_id = hello.session_id.clone();

    {
        let mut store = state.store.write().await;
        store.sessions.insert(
            session_id.clone(),
            BrowserBridgeSession {
                hello,
                sender: tx,
                connected_at_unix_ms: time::OffsetDateTime::now_utc().unix_timestamp_nanos()
                    / 1_000_000,
                active_page: None,
            },
        );
    }

    let writer_task = tauri::async_runtime::spawn(async move {
        while let Some(payload) = rx.recv().await {
            if writer.send(WsMessage::Text(payload.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(message) = reader.next().await {
        match message {
            Ok(WsMessage::Text(text)) => {
                if let Ok(result) = serde_json::from_str::<BrowserAgentResultMessage>(&text) {
                    if result.message_type == "result" {
                        let sender = {
                            let mut store = state.store.write().await;
                            store.pending.remove(&result.request_id)
                        };
                        if let Some(sender) = sender {
                            let _ = sender.send(result);
                        }
                        continue;
                    }
                }
                if let Ok(event) = serde_json::from_str::<BrowserAgentEventMessage>(&text) {
                    if event.message_type == "event" {
                        let mut store = state.store.write().await;
                        apply_browser_event_message(&mut store, &session_id, event);
                        continue;
                    }
                }
                if let Ok(query) = serde_json::from_str::<BrowserAgentQueryMessage>(&text) {
                    if query.message_type == "query" {
                        let response = handle_browser_query_message(query).await;
                        let payload = serde_json::to_string(&response).map_err(|err| {
                            format!("browser agent query result serialize failed: {err}")
                        })?;
                        let sender = {
                            let store = state.store.read().await;
                            store
                                .sessions
                                .get(&session_id)
                                .map(|session| session.sender.clone())
                        };
                        if let Some(sender) = sender {
                            let _ = sender.send(payload);
                        }
                    }
                }
            }
            Ok(WsMessage::Close(_)) => break,
            Ok(_) => {}
            Err(err) => return Err(format!("browser agent websocket read failed: {err}")),
        }
    }

    writer_task.abort();
    let mut store = state.store.write().await;
    store.sessions.remove(&session_id);
    Ok(())
}

async fn handle_browser_query_message(
    query: BrowserAgentQueryMessage,
) -> BrowserAgentQueryResultMessage {
    match handle_browser_query_message_inner(&query).await {
        Ok(data) => BrowserAgentQueryResultMessage {
            message_type: "query_result".to_string(),
            query_id: query.query_id,
            ok: true,
            data: Some(data),
            error: None,
        },
        Err(error) => BrowserAgentQueryResultMessage {
            message_type: "query_result".to_string(),
            query_id: query.query_id,
            ok: false,
            data: None,
            error: Some(BrowserAgentResultError {
                code: "QUERY_FAILED".to_string(),
                message: error,
            }),
        },
    }
}

async fn handle_browser_query_message_inner(
    query: &BrowserAgentQueryMessage,
) -> Result<Value, String> {
    let app_state = crate::state::global_app_state()
        .ok_or_else(|| "global app state is unavailable".to_string())?;
    let app_handle = crate::state::global_app_handle()
        .ok_or_else(|| "global app handle is unavailable".to_string())?;

    let lookup_id = Uuid::new_v4().to_string();
    let query_text = build_browser_lookup_query_text(&query.params.page_context);
    let hits = match query.method.as_str() {
        "search_wiki" => search_browser_lookup_wiki(&app_state, &query_text).await?,
        "search_memory" => search_browser_lookup_memory(&app_state, &query_text).await?,
        "ask_current_page" => Vec::new(),
        other => return Err(format!("unsupported browser lookup method: {other}")),
    };

    let payload = BrowserAgentLookupPayload {
        lookup_id: lookup_id.clone(),
        kind: query.method.clone(),
        query_text,
        page_context: query.params.page_context.clone(),
        hits: hits.clone(),
        created_at: time::OffsetDateTime::now_utc().unix_timestamp(),
    };

    let _ = app_handle.emit("browser-agent-lookup", &payload);
    if let Some(island_window) = app_handle.get_webview_window("island") {
        let _ = island_window.show();
    }

    Ok(serde_json::json!({
        "lookupId": lookup_id,
        "resultCount": hits.len(),
        "kind": query.method,
    }))
}

fn build_browser_lookup_query_text(page: &BrowserAgentLookupPageContext) -> String {
    let mut parts = Vec::new();
    if !page.title.trim().is_empty() {
        parts.push(page.title.trim().to_string());
    }
    if !page.headings_summary.is_empty() {
        parts.push(page.headings_summary.join(" "));
    }
    if !page.main_text_snippet.trim().is_empty() {
        parts.push(page.main_text_snippet.trim().to_string());
    } else if !page.visible_text_snippet.trim().is_empty() {
        parts.push(page.visible_text_snippet.trim().to_string());
    }
    parts.join("\n")
}

async fn search_browser_lookup_wiki(
    app_state: &crate::state::AppState,
    query_text: &str,
) -> Result<Vec<BrowserAgentLookupHit>, String> {
    let result = crate::modules::llm_wiki::service::search_local_llm_wiki_corpus(
        app_state,
        crate::modules::llm_wiki::types::SearchLocalLlmWikiCorpusRequest {
            query: query_text.to_string(),
            limit: Some(5),
        },
    )
    .await?;

    Ok(result
        .hits
        .into_iter()
        .map(|hit| BrowserAgentLookupHit {
            id: hit.asset_id,
            source: "wiki".to_string(),
            title: hit.title,
            summary: hit.summary,
            subtitle: Some(hit.relative_path),
            score: hit.score,
        })
        .collect())
}

async fn search_browser_lookup_memory(
    app_state: &crate::state::AppState,
    query_text: &str,
) -> Result<Vec<BrowserAgentLookupHit>, String> {
    let result = app_state
        .memory
        .service
        .search(crate::modules::memory::types::LocalMemorySearchQuery {
            query: query_text.to_string(),
            limit: Some(5),
            session_id: None,
            capability_id: None,
            category: None,
            source: None,
            tags: None,
        })
        .await
        .map_err(|err| err.to_string())?;

    Ok(result
        .items
        .into_iter()
        .map(|item| {
            let content = item.content.trim().to_string();
            let title = content
                .lines()
                .find(|line| !line.trim().is_empty())
                .map(|line| line.trim().chars().take(72).collect::<String>())
                .filter(|line| !line.is_empty())
                .unwrap_or_else(|| "Memory match".to_string());
            let subtitle = item
                .source
                .clone()
                .or(item.category.clone())
                .filter(|value| !value.trim().is_empty());
            BrowserAgentLookupHit {
                id: item.id,
                source: "memory".to_string(),
                title,
                summary: content.chars().take(220).collect(),
                subtitle,
                score: f64::from(item.score),
            }
        })
        .collect())
}

fn apply_browser_event_message(
    store: &mut BrowserBridgeStore,
    session_id: &str,
    event: BrowserAgentEventMessage,
) {
    let Some(session) = store.sessions.get_mut(session_id) else {
        return;
    };

    match event.event.as_str() {
        "tab_updated" => {
            let Some(data) = event.data else {
                return;
            };
            if let Ok(page) = serde_json::from_value::<BrowserAgentPageContext>(data) {
                session.active_page = Some(page);
            }
        }
        "tab_closed" => {
            let Some(data) = event.data else {
                return;
            };
            let closed_tab_id = data.get("tabId").and_then(|value| value.as_i64());
            if closed_tab_id.is_none()
                || session
                    .active_page
                    .as_ref()
                    .map(|page| Some(page.tab_id) == closed_tab_id)
                    .unwrap_or(false)
            {
                session.active_page = None;
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_browser_event_message, BrowserBridgeSession, BrowserBridgeStore};
    use crate::modules::browser_agent::types::{
        BrowserAgentEventMessage, BrowserAgentHelloMessage,
    };
    use serde_json::json;
    use tokio::sync::mpsc;

    fn build_store() -> BrowserBridgeStore {
        let (tx, _rx) = mpsc::unbounded_channel::<String>();
        let mut store = BrowserBridgeStore::default();
        store.sessions.insert(
            "session-1".to_string(),
            BrowserBridgeSession {
                hello: BrowserAgentHelloMessage {
                    message_type: "hello".to_string(),
                    role: "extension".to_string(),
                    session_id: "session-1".to_string(),
                    extension_version: Some("0.1.0".to_string()),
                    schema_version: Some("1".to_string()),
                    supported_actions: Some(vec!["get_page_snapshot".to_string()]),
                },
                sender: tx,
                connected_at_unix_ms: 1,
                active_page: None,
            },
        );
        store
    }

    #[test]
    fn browser_bridge_event_updates_active_page() {
        let mut store = build_store();
        apply_browser_event_message(
            &mut store,
            "session-1",
            BrowserAgentEventMessage {
                message_type: "event".to_string(),
                event: "tab_updated".to_string(),
                data: Some(json!({
                    "tabId": 42,
                    "title": "Example Docs",
                    "url": "https://example.com/docs",
                    "host": "example.com"
                })),
            },
        );

        let session = store.sessions.get("session-1").expect("session exists");
        let page = session.active_page.as_ref().expect("page context");
        assert_eq!(page.tab_id, 42);
        assert_eq!(page.title, "Example Docs");
    }

    #[test]
    fn browser_bridge_event_clears_matching_closed_tab() {
        let mut store = build_store();
        apply_browser_event_message(
            &mut store,
            "session-1",
            BrowserAgentEventMessage {
                message_type: "event".to_string(),
                event: "tab_updated".to_string(),
                data: Some(json!({
                    "tabId": 42,
                    "title": "Example Docs",
                    "url": "https://example.com/docs",
                    "host": "example.com"
                })),
            },
        );

        apply_browser_event_message(
            &mut store,
            "session-1",
            BrowserAgentEventMessage {
                message_type: "event".to_string(),
                event: "tab_closed".to_string(),
                data: Some(json!({ "tabId": 42 })),
            },
        );

        let session = store.sessions.get("session-1").expect("session exists");
        assert!(session.active_page.is_none());
    }
}
