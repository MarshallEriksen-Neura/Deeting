use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::Arc;

use base64::Engine;
use log::warn;
use qrcodegen::{QrCode, QrCodeEcc};
use sqlx::sqlite::SqlitePool;
use tokio::sync::{Mutex, RwLock};

use super::account_store::WechatAccountStore;
use super::bridge_client::WechatBridgeClient;
use super::types::{
    StoredWechatAccount, WechatCancelPairingResponse, WechatConnectionStateResponse,
    WechatDisconnectResponse, WechatGetUpdatesResponse, WechatPairingDecisionResponse,
    WechatPairingResponse, WechatQrStatusResponse, WECHAT_DEFAULT_BASE_URL,
};
use crate::utils::now_rfc3339;

#[derive(Clone)]
pub struct WechatState {
    shared: Arc<WechatShared>,
}

struct WechatShared {
    bridge: WechatBridgeClient,
    store: WechatAccountStore,
    qr_sessions: Mutex<HashMap<String, PairingSession>>,
    last_error: RwLock<Option<String>>,
}

#[derive(Debug, Clone)]
struct PairingSession {
    pairing_id: String,
    qrcode_id: String,
    qr_image_url: Option<String>,
    qr_image_data: Option<String>,
    expires_at: Option<String>,
    state: String,
    account_label: Option<String>,
    error: Option<String>,
}

impl WechatState {
    pub async fn with_pool(pool: SqlitePool, database_url: &str) -> Result<Self, String> {
        let store = WechatAccountStore::new(pool, database_url)?;
        store.init().await?;
        Ok(Self {
            shared: Arc::new(WechatShared {
                bridge: WechatBridgeClient::new(),
                store,
                qr_sessions: Mutex::new(HashMap::new()),
                last_error: RwLock::new(None),
            }),
        })
    }

    pub async fn with_pools(
        pool: SqlitePool,
        write_pool: SqlitePool,
        database_url: &str,
    ) -> Result<Self, String> {
        let store = WechatAccountStore::with_pools(pool, write_pool, database_url)?;
        store.init().await?;
        Ok(Self {
            shared: Arc::new(WechatShared {
                bridge: WechatBridgeClient::new(),
                store,
                qr_sessions: Mutex::new(HashMap::new()),
                last_error: RwLock::new(None),
            }),
        })
    }

    pub async fn start_pairing(&self) -> Result<WechatPairingResponse, String> {
        let qr = self
            .shared
            .bridge
            .fetch_login_qr(WECHAT_DEFAULT_BASE_URL)
            .await?;
        let pairing_id = uuid::Uuid::new_v4().to_string();
        let qrcode_id = qr
            .qrcode
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "wechat qrcode missing".to_string())?
            .to_string();
        let expires_at = (time::OffsetDateTime::now_utc() + time::Duration::minutes(10))
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|err| err.to_string())?;
        let session = PairingSession {
            pairing_id: pairing_id.clone(),
            qrcode_id,
            qr_image_url: qr.qrcode_img_content.clone(),
            qr_image_data: qr
                .qrcode_img_content
                .as_deref()
                .and_then(qr_data_uri_from_content)
                .or_else(|| qr.qrcode.as_deref().and_then(qr_data_uri_from_content)),
            expires_at: Some(expires_at.clone()),
            state: "qr_ready".to_string(),
            account_label: None,
            error: None,
        };
        self.shared
            .qr_sessions
            .lock()
            .await
            .insert(pairing_id.clone(), session.clone());

        Ok(pairing_to_response(session))
    }

    pub async fn get_pairing_status(
        &self,
        pairing_id: &str,
    ) -> Result<WechatPairingResponse, String> {
        let current = {
            self.shared
                .qr_sessions
                .lock()
                .await
                .get(pairing_id.trim())
                .cloned()
        }
        .ok_or_else(|| "wechat pairing not found".to_string())?;

        if matches!(
            current.state.as_str(),
            "connected" | "cancelled" | "expired" | "error"
        ) {
            return Ok(pairing_to_response(current));
        }

        let status = self
            .shared
            .bridge
            .fetch_qr_status(WECHAT_DEFAULT_BASE_URL, current.qrcode_id.as_str())
            .await?;
        let updated = self.apply_qr_status(current, status).await?;
        Ok(pairing_to_response(updated))
    }

    pub async fn cancel_pairing(
        &self,
        pairing_id: &str,
    ) -> Result<WechatCancelPairingResponse, String> {
        let mut sessions = self.shared.qr_sessions.lock().await;
        let Some(session) = sessions.get_mut(pairing_id.trim()) else {
            return Err("wechat pairing not found".to_string());
        };
        session.state = "cancelled".to_string();
        session.error = None;
        Ok(WechatCancelPairingResponse {
            state: "cancelled".to_string(),
        })
    }

    pub async fn get_connection_state(&self) -> Result<WechatConnectionStateResponse, String> {
        let pending_pairings = self.shared.store.count_pending_pairings().await?;
        let allowlist_size = self.shared.store.count_allowlist().await?;
        let allowlist_contacts = self.shared.store.list_allowlist_contacts().await?;
        let context_contacts = self.shared.store.list_context_contacts().await?;
        let last_error = self.shared.last_error.read().await.clone();
        let active_qr = self
            .shared
            .qr_sessions
            .lock()
            .await
            .values()
            .find(|session| matches!(session.state.as_str(), "qr_ready" | "connecting"))
            .cloned();

        if let Some((account_label, connected_at, _)) = self.shared.store.load_account().await? {
            return Ok(WechatConnectionStateResponse {
                state: "connected".to_string(),
                account_label: Some(account_label),
                last_error,
                connected_at: Some(connected_at),
                pending_pairings,
                allowlist_size,
                allowlist_contacts,
                context_contacts,
            });
        }

        if let Some(pairing) = active_qr {
            return Ok(WechatConnectionStateResponse {
                state: if pairing.state == "qr_ready" {
                    "connecting".to_string()
                } else {
                    pairing.state
                },
                account_label: pairing.account_label,
                last_error: pairing.error.or(last_error),
                connected_at: None,
                pending_pairings,
                allowlist_size,
                allowlist_contacts,
                context_contacts,
            });
        }

        Ok(WechatConnectionStateResponse {
            state: if last_error.is_some() {
                "error".to_string()
            } else {
                "disconnected".to_string()
            },
            account_label: None,
            last_error,
            connected_at: None,
            pending_pairings,
            allowlist_size,
            allowlist_contacts,
            context_contacts,
        })
    }

    pub async fn disconnect(&self) -> Result<WechatDisconnectResponse, String> {
        self.shared.store.clear_account().await?;
        self.set_last_error(None).await;
        Ok(WechatDisconnectResponse {
            success: true,
            message: "微信连接已断开".to_string(),
        })
    }

    pub async fn approve_pairing(
        &self,
        pairing_code: &str,
    ) -> Result<WechatPairingDecisionResponse, String> {
        let contact_id = self.shared.store.approve_pairing_code(pairing_code).await?;
        Ok(WechatPairingDecisionResponse {
            success: contact_id.is_some(),
            contact_id,
        })
    }

    pub async fn reject_pairing(
        &self,
        pairing_code: &str,
    ) -> Result<WechatPairingDecisionResponse, String> {
        self.shared.store.reject_pairing_code(pairing_code).await?;
        Ok(WechatPairingDecisionResponse {
            success: true,
            contact_id: None,
        })
    }

    pub async fn load_account(&self) -> Result<Option<StoredWechatAccount>, String> {
        Ok(self
            .shared
            .store
            .load_account()
            .await?
            .map(|(_, _, account)| account))
    }

    pub async fn save_account(&self, account: &StoredWechatAccount) -> Result<String, String> {
        self.shared.store.save_account(account).await
    }

    pub async fn update_cursor(&self, cursor: &str) -> Result<(), String> {
        self.shared.store.update_cursor(cursor).await
    }

    pub async fn get_updates(
        &self,
        base_url: &str,
        token: &str,
        cursor: &str,
    ) -> Result<WechatGetUpdatesResponse, String> {
        self.shared
            .bridge
            .get_updates(base_url, token, cursor)
            .await
    }

    pub async fn send_text(
        &self,
        base_url: &str,
        token: &str,
        contact_id: &str,
        text: &str,
        context_token: &str,
    ) -> Result<(), String> {
        self.shared
            .bridge
            .send_text(base_url, token, contact_id, text, context_token)
            .await
    }

    pub async fn send_message(
        &self,
        base_url: &str,
        token: &str,
        message: super::types::WechatOutboundMessage,
    ) -> Result<(), String> {
        self.shared
            .bridge
            .send_message(base_url, token, message)
            .await
    }

    pub async fn send_typing(
        &self,
        base_url: &str,
        token: &str,
        contact_id: &str,
        context_token: &str,
        status: i64,
    ) -> Result<(), String> {
        self.shared
            .bridge
            .send_typing(base_url, token, contact_id, context_token, status)
            .await
    }

    pub async fn get_upload_url(
        &self,
        base_url: &str,
        token: &str,
        file_name: &str,
    ) -> Result<serde_json::Value, String> {
        self.shared
            .bridge
            .get_upload_url(base_url, token, file_name)
            .await
    }

    pub async fn get_config(
        &self,
        base_url: &str,
        token: &str,
        contact_id: &str,
        context_token: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        self.shared
            .bridge
            .get_config(base_url, token, contact_id, context_token)
            .await
    }

    pub async fn update_context_token(
        &self,
        contact_id: &str,
        context_token: &str,
    ) -> Result<(), String> {
        self.shared
            .store
            .update_context_token(contact_id, context_token)
            .await
    }

    pub async fn context_token_for_contact(
        &self,
        contact_id: &str,
    ) -> Result<Option<String>, String> {
        self.shared
            .store
            .context_token_for_contact(contact_id)
            .await
    }

    pub async fn ensure_allowed_or_create_pairing(
        &self,
        contact_id: &str,
    ) -> Result<Result<(), String>, String> {
        if self.shared.store.is_allowed_contact(contact_id).await? {
            return Ok(Ok(()));
        }
        let code = self
            .shared
            .store
            .create_or_reuse_pending_pairing(contact_id)
            .await?;
        Ok(Err(code))
    }

    pub async fn set_last_error(&self, value: Option<String>) {
        *self.shared.last_error.write().await = value;
    }

    pub async fn clear_last_error(&self) {
        self.set_last_error(None).await;
    }

    async fn apply_qr_status(
        &self,
        mut session: PairingSession,
        status: WechatQrStatusResponse,
    ) -> Result<PairingSession, String> {
        match status
            .status
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "confirmed" => {
                let token = status
                    .bot_token
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "wechat bot token missing".to_string())?
                    .to_string();
                let base_url = status
                    .baseurl
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(WECHAT_DEFAULT_BASE_URL)
                    .to_string();
                let saved_at = now_rfc3339();
                let account = StoredWechatAccount {
                    token,
                    base_url,
                    user_id: status.ilink_user_id.clone(),
                    account_id: status.ilink_bot_id.clone(),
                    cursor: String::new(),
                    saved_at: saved_at.clone(),
                    context_tokens_by_contact: std::collections::HashMap::new(),
                };
                let label = self.shared.store.save_account(&account).await?;
                session.state = "connected".to_string();
                session.account_label = Some(label);
                session.error = None;
                self.clear_last_error().await;
            }
            "scaned" => {
                session.state = "connecting".to_string();
                session.error = None;
            }
            "expired" => {
                session.state = "expired".to_string();
                session.error = Some("二维码已过期，请重新发起连接。".to_string());
                self.set_last_error(session.error.clone()).await;
            }
            "wait" | "" => {
                session.state = "qr_ready".to_string();
            }
            other => {
                warn!("wechat_qr_unknown_status={}", other);
                session.state = "error".to_string();
                session.error = Some(format!("未知扫码状态：{}", other));
                self.set_last_error(session.error.clone()).await;
            }
        }

        self.shared
            .qr_sessions
            .lock()
            .await
            .insert(session.pairing_id.clone(), session.clone());
        Ok(session)
    }
}

fn pairing_to_response(session: PairingSession) -> WechatPairingResponse {
    WechatPairingResponse {
        pairing_id: session.pairing_id,
        state: session.state,
        qr_image_url: session.qr_image_url,
        qr_image_data: session.qr_image_data,
        expires_at: session.expires_at,
        account_label: session.account_label,
        error: session.error,
    }
}

fn qr_data_uri_from_content(content: &str) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("data:image/") {
        return Some(trimmed.to_string());
    }

    let qr = QrCode::encode_text(trimmed, QrCodeEcc::Medium).ok()?;
    let svg = qr_to_svg_string(&qr, 4);
    let encoded = base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());
    Some(format!("data:image/svg+xml;base64,{}", encoded))
}

fn qr_to_svg_string(qr: &QrCode, border: i32) -> String {
    let border = border.max(0);
    let size = qr.size();
    let dimension = size + border * 2;
    let mut path = String::new();
    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x, y) {
                let _ = write!(&mut path, "M{},{}h1v1h-1z", x + border, y + border);
            }
        }
    }

    format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {0} {0}' shape-rendering='crispEdges'><rect width='100%' height='100%' fill='#fff'/><path d='{1}' fill='#000'/></svg>",
        dimension, path
    )
}

#[cfg(test)]
mod tests {
    use super::qr_data_uri_from_content;

    #[test]
    fn qr_data_uri_from_content_generates_svg_data_uri_for_url() {
        let data = qr_data_uri_from_content("https://liteapp.weixin.qq.com/q/test?qrcode=abc")
            .expect("svg data uri");
        assert!(data.starts_with("data:image/svg+xml;base64,"));
    }
}
