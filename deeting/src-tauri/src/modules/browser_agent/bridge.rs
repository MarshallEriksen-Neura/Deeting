use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use tokio::time::timeout;
use tokio_tungstenite::{accept_async, tungstenite::Message as WsMessage};
use uuid::Uuid;

use crate::modules::browser_agent::types::{
    BrowserAgentAction, BrowserAgentCommandMessage, BrowserAgentHelloMessage,
    BrowserAgentResultMessage,
};

#[derive(Debug, Clone)]
pub struct BrowserBridgeSnapshot {
    pub running: bool,
    pub connected_sessions: usize,
    pub active_session_id: Option<String>,
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
            };
        };

        let store = handle.state.store.read().await;
        let active_session_id = store
            .sessions
            .values()
            .max_by_key(|session| session.connected_at_unix_ms)
            .map(|session| session.hello.session_id.clone());

        BrowserBridgeSnapshot {
            running: true,
            connected_sessions: store.sessions.len(),
            active_session_id,
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
