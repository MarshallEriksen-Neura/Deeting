use base64::Engine;
use rand::Rng;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde_json::json;

use super::types::{
    WechatBaseInfo, WechatGetUpdatesRequest, WechatGetUpdatesResponse, WechatOutboundMessage,
    WechatQrCodeResponse, WechatQrStatusResponse, WechatSendMessageRequest, WECHAT_CHANNEL_VERSION,
};

fn base_info() -> WechatBaseInfo {
    WechatBaseInfo {
        channel_version: WECHAT_CHANNEL_VERSION.to_string(),
    }
}

fn random_uin() -> String {
    let bytes: [u8; 4] = rand::thread_rng().gen();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn build_headers(token: Option<&str>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "X-WECHAT-UIN",
        HeaderValue::from_str(random_uin().as_str()).map_err(|err| err.to_string())?,
    );
    if let Some(token) = token.map(str::trim).filter(|value| !value.is_empty()) {
        headers.insert(
            "AuthorizationType",
            HeaderValue::from_static("ilink_bot_token"),
        );
        headers.insert(
            "Authorization",
            HeaderValue::from_str(format!("Bearer {token}").as_str())
                .map_err(|err| err.to_string())?,
        );
    }
    Ok(headers)
}

pub async fn fetch_login_qr(
    client: &reqwest::Client,
    base_url: &str,
) -> Result<WechatQrCodeResponse, String> {
    let url = format!(
        "{}/ilink/bot/get_bot_qrcode?bot_type=3",
        base_url.trim_end_matches('/')
    );
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("wechat_qr_http_{}", response.status().as_u16()));
    }
    response
        .json::<WechatQrCodeResponse>()
        .await
        .map_err(|err| err.to_string())
}

pub async fn fetch_qr_status(
    client: &reqwest::Client,
    base_url: &str,
    qrcode_id: &str,
) -> Result<WechatQrStatusResponse, String> {
    let response = client
        .get(format!(
            "{}/ilink/bot/get_qrcode_status",
            base_url.trim_end_matches('/')
        ))
        .query(&[("qrcode", qrcode_id.trim())])
        .header("iLink-App-ClientVersion", "1")
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "wechat_qr_status_http_{}",
            response.status().as_u16()
        ));
    }
    response
        .json::<WechatQrStatusResponse>()
        .await
        .map_err(|err| err.to_string())
}

pub async fn get_updates(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    cursor: &str,
) -> Result<WechatGetUpdatesResponse, String> {
    let url = format!("{}/ilink/bot/getupdates", base_url.trim_end_matches('/'));
    let response = client
        .post(url)
        .headers(build_headers(Some(token))?)
        .json(&WechatGetUpdatesRequest {
            get_updates_buf: cursor.trim().to_string(),
            base_info: base_info(),
        })
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "wechat_getupdates_http_{}",
            response.status().as_u16()
        ));
    }

    response
        .json::<WechatGetUpdatesResponse>()
        .await
        .map_err(|err| err.to_string())
}

pub async fn send_text_message(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    message: WechatOutboundMessage,
) -> Result<(), String> {
    send_message(client, base_url, token, message).await
}

pub async fn send_message(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    message: WechatOutboundMessage,
) -> Result<(), String> {
    let url = format!("{}/ilink/bot/sendmessage", base_url.trim_end_matches('/'));
    let response = client
        .post(url)
        .headers(build_headers(Some(token))?)
        .json(&WechatSendMessageRequest {
            msg: message,
            base_info: base_info(),
        })
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("wechat_send_http_{}", response.status().as_u16()));
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .unwrap_or_else(|_| json!({}));
    let ret = payload
        .get("ret")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    if ret != 0 {
        return Err(payload
            .get("errmsg")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("wechat_send_failed")
            .to_string());
    }

    Ok(())
}

pub async fn send_typing(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    contact_id: &str,
    context_token: &str,
    status: i64,
) -> Result<(), String> {
    let config = get_config(client, base_url, token, contact_id, Some(context_token)).await?;
    let typing_ticket = config
        .get("typing_ticket")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "wechat_typing_ticket_missing".to_string())?;
    let url = format!("{}/ilink/bot/sendtyping", base_url.trim_end_matches('/'));
    let response = client
        .post(url)
        .headers(build_headers(Some(token))?)
        .json(&json!({
            "ilink_user_id": contact_id.trim(),
            "typing_ticket": typing_ticket,
            "status": status,
            "base_info": base_info(),
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "wechat_sendtyping_http_{}",
            response.status().as_u16()
        ));
    }

    Ok(())
}

pub async fn get_upload_url(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    file_name: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/ilink/bot/getuploadurl", base_url.trim_end_matches('/'));
    let response = client
        .post(url)
        .headers(build_headers(Some(token))?)
        .json(&json!({
            "file_name": file_name.trim(),
            "base_info": base_info(),
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "wechat_getuploadurl_http_{}",
            response.status().as_u16()
        ));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|err| err.to_string())
}

pub async fn get_config(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    contact_id: &str,
    context_token: Option<&str>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/ilink/bot/getconfig", base_url.trim_end_matches('/'));
    let response = client
        .post(url)
        .headers(build_headers(Some(token))?)
        .json(&json!({
            "ilink_user_id": contact_id.trim(),
            "context_token": context_token.map(str::trim).filter(|value| !value.is_empty()),
            "base_info": base_info(),
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "wechat_getconfig_http_{}",
            response.status().as_u16()
        ));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|err| err.to_string())
}
