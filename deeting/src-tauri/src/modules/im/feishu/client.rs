use super::message::*;
use super::protocol::*;
use crate::modules::im::types::*;
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use prost::Message;
use reqwest::Client;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::{interval, sleep};
use tokio_tungstenite::{
    connect_async, tungstenite::Message as WsMessage, MaybeTlsStream, WebSocketStream,
};

/// 飞书 WebSocket 客户端配置
#[derive(Debug, Clone)]
pub struct FeishuConfig {
    pub app_id: String,
    pub app_secret: String,
    /// 心跳间隔（秒）
    pub heartbeat_interval: u64,
    /// 重连延迟（秒）
    pub reconnect_delay: u64,
    /// 消息处理超时（秒）
    pub message_timeout: u64,
}

impl Default for FeishuConfig {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            app_secret: String::new(),
            heartbeat_interval: 25,
            reconnect_delay: 5,
            message_timeout: 30,
        }
    }
}

/// 飞书 WebSocket 客户端
#[derive(Clone)]
pub struct FeishuClient {
    config: FeishuConfig,
    http: Client,
    status: Arc<RwLock<ConnectionStatus>>,
    access_token: Arc<RwLock<Option<String>>>,
    token_expire: Arc<AtomicI64>,
    frame_cache: Arc<Mutex<HashMap<String, PartialProtoFrame>>>,
    running: Arc<AtomicBool>,
    stop_signal: Arc<tokio::sync::Notify>,
}

#[derive(Debug, Clone)]
struct PartialProtoFrame {
    total_parts: usize,
    trace_id: Option<String>,
    parts: BTreeMap<usize, Vec<u8>>,
}

type FeishuWriteHalf =
    futures_util::stream::SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, WsMessage>;

impl FeishuClient {
    pub fn new(config: FeishuConfig) -> Self {
        Self {
            config,
            http: Client::new(),
            status: Arc::new(RwLock::new(ConnectionStatus::Disconnected)),
            access_token: Arc::new(RwLock::new(None)),
            token_expire: Arc::new(AtomicI64::new(0)),
            frame_cache: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            stop_signal: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// 从配置 map 创建客户端
    pub fn from_config(
        platform_config: &HashMap<String, serde_json::Value>,
    ) -> Result<Self, ImError> {
        let app_id = config_string(platform_config, "app_id")
            .ok_or_else(|| ImError::ConfigError("缺少 app_id".to_string()))?
            .to_string();
        let app_secret = config_string(platform_config, "app_secret")
            .ok_or_else(|| ImError::ConfigError("缺少 app_secret".to_string()))?
            .to_string();

        Ok(Self::new(FeishuConfig {
            app_id,
            app_secret,
            ..Default::default()
        }))
    }

    /// 获取租户访问令牌
    async fn get_tenant_access_token(&self) -> Result<String, ImError> {
        // 检查缓存的 token 是否有效
        {
            let token = self.access_token.read().await;
            if let Some(t) = token.as_ref() {
                let expire = self.token_expire.load(Ordering::SeqCst);
                if expire > chrono::Utc::now().timestamp() {
                    return Ok(t.clone());
                }
            }
        }

        // 请求新的 token
        let url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
        let body = serde_json::json!({
            "app_id": self.config.app_id,
            "app_secret": self.config.app_secret,
        });

        let resp = self
            .http
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|e| ImError::ConnectionError(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(ImError::AuthError(format!("HTTP {}", resp.status())));
        }

        let result: TenantAccessTokenResponse = resp
            .json()
            .await
            .map_err(|e| ImError::ParseError(e.to_string()))?;

        if result.code != 0 {
            return Err(ImError::AuthError(format!(
                "code {}: {}",
                result.code, result.msg
            )));
        }
        if result.tenant_access_token.trim().is_empty() {
            return Err(ImError::AuthError("tenant_access_token 为空".to_string()));
        }

        // 缓存 token，提前 5 分钟过期
        let expire_time = chrono::Utc::now().timestamp() + result.expire as i64 - 300;
        self.token_expire.store(expire_time, Ordering::SeqCst);

        let mut token = self.access_token.write().await;
        *token = Some(result.tenant_access_token.clone());

        Ok(result.tenant_access_token)
    }

    /// 获取 WebSocket 连接地址
    async fn get_ws_url(&self) -> Result<String, ImError> {
        let url = "https://open.feishu.cn/callback/ws/endpoint";
        let body = serde_json::json!({
            "AppID": self.config.app_id,
            "AppSecret": self.config.app_secret,
        });

        let resp = self
            .http
            .post(url)
            .header("locale", "zh")
            .json(&body)
            .send()
            .await
            .map_err(|e| ImError::ConnectionError(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(ImError::ConnectionError(format!("HTTP {}", resp.status())));
        }

        let result: WsConnectConfigResponse = resp
            .json()
            .await
            .map_err(|e| ImError::ParseError(e.to_string()))?;

        if result.code != 0 {
            return Err(ImError::ConnectionError(format!(
                "code {}: {}",
                result.code, result.msg
            )));
        }

        let data = result
            .data
            .ok_or_else(|| ImError::ConnectionError("响应数据为空".to_string()))?;
        if data.url.trim().is_empty() {
            return Err(ImError::ConnectionError("WebSocket URL 为空".to_string()));
        }
        Ok(data.url)
    }

    /// 处理 WebSocket 消息
    async fn handle_ws_text_message(
        &self,
        text: &str,
        event_tx: &mpsc::Sender<ImEvent>,
    ) -> Result<(), ImError> {
        debug!("收到飞书 WebSocket 消息: {}", text);

        // 解析消息帧
        let frame: WsFrame =
            serde_json::from_str(text).map_err(|e| ImError::ParseError(e.to_string()))?;

        match frame.frame_type.as_str() {
            // Pong 响应
            "pong" => {
                debug!("收到 pong 响应");
                return Ok(());
            }

            // 心跳消息
            "heartbeat" => {
                debug!("收到心跳消息");
                return Ok(());
            }

            // 事件消息
            "event" => {
                let header = frame.header.as_ref();
                let event_data = frame.event.as_ref();

                if header.is_none() || event_data.is_none() {
                    warn!("事件消息格式不完整");
                    return Ok(());
                }

                let header = header.unwrap();
                let event_data = event_data.unwrap();

                match header.event_type.as_str() {
                    // 消息接收事件
                    "im.message.receive_v1" => {
                        let event: FeishuMessageEvent = serde_json::from_value(event_data.clone())
                            .map_err(|e| ImError::ParseError(e.to_string()))?;

                        // 忽略非文本消息和非用户消息
                        if event.message.message_type != "text" {
                            return Ok(());
                        }
                        if event.sender.sender_type.to_lowercase() != "user" {
                            return Ok(());
                        }

                        let im_event = convert_message_event(
                            &event,
                            header,
                            frame.data.clone().unwrap_or(event_data.clone()),
                        );

                        event_tx
                            .send(im_event)
                            .await
                            .map_err(|e| ImError::SendError(e.to_string()))?;
                    }

                    // 卡片回调事件
                    "card.action.trigger" | "card.action.trigger_v1" => {
                        let event: FeishuCardEvent = serde_json::from_value(event_data.clone())
                            .map_err(|e| ImError::ParseError(e.to_string()))?;

                        let im_event = convert_card_event(
                            &event,
                            header,
                            frame.data.clone().unwrap_or(event_data.clone()),
                        );

                        event_tx
                            .send(im_event)
                            .await
                            .map_err(|e| ImError::SendError(e.to_string()))?;
                    }

                    // URL 验证
                    "url_verification" => {
                        info!("收到 URL 验证请求");
                        // WebSocket 模式下一般不需要处理
                    }

                    other => {
                        debug!("忽略事件类型: {}", other);
                    }
                }
            }

            other => {
                debug!("未知消息类型: {}", other);
            }
        }

        Ok(())
    }

    async fn handle_event_payload(
        &self,
        payload: &Value,
        event_tx: &mpsc::Sender<ImEvent>,
    ) -> Result<(), ImError> {
        let header = payload.get("header").cloned().unwrap_or(Value::Null);
        let event = payload.get("event").cloned().unwrap_or(Value::Null);
        let event_type = header
            .get("event_type")
            .and_then(Value::as_str)
            .or_else(|| event.get("type").and_then(Value::as_str))
            .unwrap_or("")
            .trim()
            .to_string();

        match event_type.as_str() {
            "im.message.receive_v1" => {
                let event_data: FeishuMessageEvent = serde_json::from_value(event.clone())
                    .map_err(|err| ImError::ParseError(err.to_string()))?;
                if event_data.message.message_type != "text" {
                    return Ok(());
                }
                if event_data.sender.sender_type.to_lowercase() != "user" {
                    return Ok(());
                }
                info!(
                    "收到飞书消息事件 chat_id={} message_id={}",
                    event_data.message.chat_id, event_data.message.message_id
                );
                let header_data: WsHeader = serde_json::from_value(header)
                    .map_err(|err| ImError::ParseError(err.to_string()))?;
                let im_event = convert_message_event(&event_data, &header_data, payload.clone());
                if let Err(e) = event_tx.send(im_event).await {
                    let msg = e.to_string();
                    if msg.contains("closed") || msg.contains("dropped") {
                        warn!(
                            "事件接收端已关闭，无法投递消息事件 chat_id={} message_id={}",
                            event_data.message.chat_id, event_data.message.message_id
                        );
                    } else {
                        return Err(ImError::SendError(msg));
                    }
                }
            }
            "card.action.trigger" | "card.action.trigger_v1" => {
                let event_data: FeishuCardEvent = serde_json::from_value(event.clone())
                    .map_err(|err| ImError::ParseError(err.to_string()))?;
                let header_data: WsHeader = serde_json::from_value(header)
                    .map_err(|err| ImError::ParseError(err.to_string()))?;
                let im_event = convert_card_event(&event_data, &header_data, payload.clone());
                if let Err(e) = event_tx.send(im_event).await {
                    let msg = e.to_string();
                    if msg.contains("closed") || msg.contains("dropped") {
                        warn!("事件接收端已关闭，无法投递卡片事件");
                    } else {
                        return Err(ImError::SendError(msg));
                    }
                }
            }
            "url_verification" => {
                info!("收到飞书 URL 验证事件");
            }
            other => {
                debug!("忽略飞书事件类型: {}", other);
            }
        }

        Ok(())
    }

    fn frame_header<'a>(headers: &'a [ProtoHeader], key: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|header| header.key == key)
            .map(|header| header.value.as_str())
    }

    async fn merge_event_payload(&self, frame: &ProtoFrame) -> Option<Vec<u8>> {
        let message_id = Self::frame_header(&frame.headers, FEISHU_HEADER_MESSAGE_ID)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("seq:{}:log:{}", frame.seq_id, frame.log_id));
        let total_parts = Self::frame_header(&frame.headers, FEISHU_HEADER_SUM)
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(1);
        let part_index = Self::frame_header(&frame.headers, FEISHU_HEADER_SEQ)
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let trace_id =
            Self::frame_header(&frame.headers, FEISHU_HEADER_TRACE_ID).map(str::to_string);

        if total_parts <= 1 {
            return Some(frame.payload.clone());
        }

        let mut cache = self.frame_cache.lock().await;
        let entry = cache
            .entry(message_id.clone())
            .or_insert_with(|| PartialProtoFrame {
                total_parts,
                trace_id: trace_id.clone(),
                parts: BTreeMap::new(),
            });
        entry.total_parts = total_parts;
        if entry.trace_id.is_none() {
            entry.trace_id = trace_id;
        }
        entry.parts.insert(part_index, frame.payload.clone());

        if entry.parts.len() < entry.total_parts {
            return None;
        }

        let mut merged = Vec::new();
        for index in 0..entry.total_parts {
            let part = entry.parts.get(&index)?;
            merged.extend_from_slice(part);
        }
        cache.remove(&message_id);
        Some(merged)
    }

    async fn send_frame_response(
        &self,
        write: &Arc<Mutex<FeishuWriteHalf>>,
        frame: &ProtoFrame,
        payload: &[u8],
        biz_rt_ms: u128,
    ) -> Result<(), ImError> {
        let mut headers = frame.headers.clone();
        headers.push(ProtoHeader {
            key: FEISHU_HEADER_BIZ_RT.to_string(),
            value: biz_rt_ms.to_string(),
        });
        let response = ProtoFrame {
            seq_id: frame.seq_id,
            log_id: frame.log_id,
            service: frame.service,
            method: frame.method,
            headers,
            payload_encoding: frame.payload_encoding.clone(),
            payload_type: frame.payload_type.clone(),
            payload: payload.to_vec(),
            log_id_new: frame.log_id_new.clone(),
        };
        let encoded = response.encode_to_vec();
        let mut writer = write.lock().await;
        writer
            .send(WsMessage::Binary(encoded))
            .await
            .map_err(|err| ImError::SendError(err.to_string()))
    }

    async fn handle_ws_binary_message(
        &self,
        binary: &[u8],
        event_tx: &mpsc::Sender<ImEvent>,
        write: &Arc<Mutex<FeishuWriteHalf>>,
    ) -> Result<(), ImError> {
        let frame =
            ProtoFrame::decode(binary).map_err(|err| ImError::ParseError(err.to_string()))?;
        let frame_type = Self::frame_header(&frame.headers, FEISHU_HEADER_TYPE).unwrap_or("");

        match frame.method {
            FEISHU_FRAME_TYPE_CONTROL => {
                if frame_type == FEISHU_MESSAGE_TYPE_PONG && !frame.payload.is_empty() {
                    debug!(
                        "收到飞书二进制 pong: {}",
                        String::from_utf8_lossy(&frame.payload)
                    );
                }
                Ok(())
            }
            FEISHU_FRAME_TYPE_DATA => {
                if frame_type != FEISHU_MESSAGE_TYPE_EVENT {
                    return Ok(());
                }
                let Some(payload) = self.merge_event_payload(&frame).await else {
                    debug!("飞书事件分片未收齐，等待更多分片");
                    return Ok(());
                };
                let start = std::time::Instant::now();
                let payload_str = String::from_utf8(payload)
                    .map_err(|err| ImError::ParseError(err.to_string()))?;
                let payload_json: Value = serde_json::from_str(&payload_str)
                    .map_err(|err| ImError::ParseError(err.to_string()))?;
                let result = self.handle_event_payload(&payload_json, event_tx).await;
                let ack_payload = match &result {
                    Ok(_) => serde_json::to_vec(&serde_json::json!({ "code": 200 }))
                        .map_err(|err| ImError::ParseError(err.to_string()))?,
                    Err(err) => serde_json::to_vec(&serde_json::json!({
                        "code": 500,
                        "msg": err.to_string(),
                    }))
                    .map_err(|encode_err| ImError::ParseError(encode_err.to_string()))?,
                };
                self.send_frame_response(write, &frame, &ack_payload, start.elapsed().as_millis())
                    .await?;
                result
            }
            other => {
                debug!("未知飞书二进制 frame method: {}", other);
                Ok(())
            }
        }
    }

    /// 运行 WebSocket 连接循环
    async fn run_ws_loop(&self, event_tx: mpsc::Sender<ImEvent>) {
        let mut reconnect_delay = self.config.reconnect_delay;

        while self.running.load(Ordering::SeqCst) {
            // 更新状态
            {
                let mut status = self.status.write().await;
                *status = ConnectionStatus::Connecting;
            }
            let _ = event_tx
                .send(ImEvent::ConnectionStatus {
                    platform: ImPlatform::Feishu,
                    status: ConnectionStatus::Connecting,
                })
                .await;

            // 获取 WebSocket URL
            let ws_url = match self.get_ws_url().await {
                Ok(url) => url,
                Err(e) => {
                    error!("获取 WebSocket URL 失败: {}", e);
                    {
                        let mut status = self.status.write().await;
                        *status = ConnectionStatus::Error;
                    }
                    sleep(Duration::from_secs(reconnect_delay)).await;
                    reconnect_delay = (reconnect_delay * 2).min(60);
                    continue;
                }
            };

            info!("连接飞书 WebSocket: {}", ws_url);

            // 建立 WebSocket 连接
            let ws_result = connect_async(&ws_url).await;

            let (ws_stream, _) = match ws_result {
                Ok(stream) => stream,
                Err(e) => {
                    error!("WebSocket 连接失败: {}", e);
                    {
                        let mut status = self.status.write().await;
                        *status = ConnectionStatus::Error;
                    }
                    sleep(Duration::from_secs(reconnect_delay)).await;
                    reconnect_delay = (reconnect_delay * 2).min(60);
                    continue;
                }
            };

            // 连接成功，重置重连延迟
            reconnect_delay = self.config.reconnect_delay;

            {
                let mut status = self.status.write().await;
                *status = ConnectionStatus::Connected;
            }
            let _ = event_tx
                .send(ImEvent::ConnectionStatus {
                    platform: ImPlatform::Feishu,
                    status: ConnectionStatus::Connected,
                })
                .await;

            info!("飞书 WebSocket 已连接");

            let (write, mut read) = ws_stream.split();
            let write = Arc::new(Mutex::new(write));

            // 心跳任务
            let heartbeat_running = self.running.clone();
            let heartbeat_notify = self.stop_signal.clone();
            let heartbeat_writer = write.clone();
            let heartbeat_interval_secs = self.config.heartbeat_interval.max(1);
            let heartbeat_handle = tokio::spawn(async move {
                let mut interval = interval(Duration::from_secs(heartbeat_interval_secs));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            if !heartbeat_running.load(Ordering::SeqCst) {
                                break;
                            }
                            let ping = serde_json::json!({
                                "type": "ping",
                                "ts": chrono::Utc::now().timestamp_millis(),
                            });
                            if let Ok(ping_str) = serde_json::to_string(&ping) {
                                let mut writer = heartbeat_writer.lock().await;
                                if writer.send(WsMessage::Text(ping_str)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        _ = heartbeat_notify.notified() => {
                            break;
                        }
                    }
                }
            });

            // 读取消息
            while self.running.load(Ordering::SeqCst) {
                tokio::select! {
                    msg = read.next() => {
                        match msg {
                            Some(Ok(WsMessage::Text(text))) => {
                                if let Err(e) = self.handle_ws_text_message(&text, &event_tx).await {
                                    warn!("处理消息失败: {}", e);
                                }
                            }
                            Some(Ok(WsMessage::Binary(binary))) => {
                                if let Err(e) = self.handle_ws_binary_message(&binary, &event_tx, &write).await {
                                    warn!("处理飞书二进制消息失败: {}", e);
                                }
                            }
                            Some(Ok(WsMessage::Ping(data))) => {
                                let mut writer = write.lock().await;
                                let _ = writer.send(WsMessage::Pong(data)).await;
                            }
                            Some(Ok(WsMessage::Close(_))) => {
                                info!("WebSocket 连接关闭");
                                break;
                            }
                            Some(Ok(_)) => {}
                            Some(Err(e)) => {
                                error!("WebSocket 错误: {}", e);
                                break;
                            }
                            None => {
                                info!("WebSocket 流结束");
                                break;
                            }
                        }
                    }
                    _ = self.stop_signal.notified() => {
                        break;
                    }
                }
            }

            // 停止心跳
            heartbeat_handle.abort();

            // 更新状态
            if self.running.load(Ordering::SeqCst) {
                let mut status = self.status.write().await;
                *status = ConnectionStatus::Reconnecting;
                let _ = event_tx
                    .send(ImEvent::ConnectionStatus {
                        platform: ImPlatform::Feishu,
                        status: ConnectionStatus::Reconnecting,
                    })
                    .await;
            } else {
                let mut status = self.status.write().await;
                *status = ConnectionStatus::Disconnected;
            }
        }
    }

    /// 发送消息 API
    /// 若指定 root_id，回复会挂在对应消息下（飞书展示为「x 条回复」）
    async fn send_message_api(
        &self,
        chat_id: &str,
        content: &str,
        msg_type: &str,
        root_id: Option<&str>,
    ) -> Result<String, ImError> {
        let token = self.get_tenant_access_token().await?;

        let url =
            format!("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id");

        let mut body = serde_json::json!({
            "receive_id": chat_id,
            "msg_type": msg_type,
            "content": content,
        });
        if let Some(rid) = root_id.filter(|s| !s.trim().is_empty()) {
            body["root_id"] = serde_json::Value::String(rid.to_string());
        }

        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
            .await
            .map_err(|e| ImError::SendError(e.to_string()))?;

        let result: FeishuApiResponse<SendMessageResp> = resp
            .json()
            .await
            .map_err(|e| ImError::ParseError(e.to_string()))?;

        if result.code != 0 {
            return Err(ImError::PlatformError {
                code: result.code,
                message: result.msg,
            });
        }

        result
            .data
            .map(|d| d.message_id)
            .ok_or_else(|| ImError::SendError("响应数据为空".to_string()))
    }

    /// 回复卡片动作 API
    async fn reply_card_action_api(&self, token: &str, response: &Value) -> Result<(), ImError> {
        let access_token = self.get_tenant_access_token().await?;

        let url = "https://open.feishu.cn/open-apis/interactive/v2/card/callback";

        let body = serde_json::json!({
            "token": token,
            "response": response,
        });

        let resp = self
            .http
            .post(url)
            .header("Authorization", format!("Bearer {}", access_token))
            .json(&body)
            .send()
            .await
            .map_err(|e| ImError::SendError(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(ImError::SendError(format!("HTTP {}", resp.status())));
        }

        Ok(())
    }
}

#[async_trait]
impl ImClient for FeishuClient {
    fn platform(&self) -> ImPlatform {
        ImPlatform::Feishu
    }

    fn status(&self) -> ConnectionStatus {
        // 同步获取状态（简化处理）
        match self.status.try_read() {
            Ok(guard) => *guard,
            Err(_) => ConnectionStatus::Disconnected,
        }
    }

    async fn start(&self, event_tx: mpsc::Sender<ImEvent>) -> Result<(), ImError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(ImError::Other("客户端已在运行".to_string()));
        }

        // 验证配置
        if self.config.app_id.is_empty() || self.config.app_secret.is_empty() {
            return Err(ImError::ConfigError(
                "app_id 或 app_secret 未配置".to_string(),
            ));
        }

        info!("启动飞书 WebSocket 客户端");

        // 在后台运行连接循环
        let client = self.clone();

        tokio::spawn(async move {
            client.run_ws_loop(event_tx).await;
        });

        Ok(())
    }

    async fn stop(&self) -> Result<(), ImError> {
        if !self.running.swap(false, Ordering::SeqCst) {
            return Ok(());
        }

        info!("停止飞书 WebSocket 客户端");

        self.stop_signal.notify_waiters();

        let mut status = self.status.write().await;
        *status = ConnectionStatus::Disconnected;

        Ok(())
    }

    async fn send_message(
        &self,
        request: SendMessageRequest,
    ) -> Result<SendMessageResponse, ImError> {
        let msg_type = message_type_for_content(&request.content);
        let content = build_message_content(&request.content)?;
        let root_id = request.reply_to.as_deref();
        let message_id = self
            .send_message_api(&request.chat_id, &content, msg_type, root_id)
            .await?;

        Ok(SendMessageResponse {
            message_id,
            timestamp: chrono::Utc::now().timestamp(),
        })
    }

    async fn reply_card_action(
        &self,
        message_id: &str,
        response: CardActionResponse,
    ) -> Result<(), ImError> {
        // 对于飞书，需要使用卡片回调 token
        // 这里 message_id 实际上是 callback_token
        let response_json = build_card_response(&response);
        self.reply_card_action_api(message_id, &response_json).await
    }
}
