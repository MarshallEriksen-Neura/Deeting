use serde_json::{json, Value};

use crate::modules::im::feishu::{FeishuClient, FeishuConfig};
use crate::modules::im::{ImClient, MessageContent, SendMessageRequest};

use super::store::MonitorDeliveryState;
use super::types::{
    LocalExecutionResult, LocalMonitorTask, LocalNotificationChannel, MonitorDeliveryPolicy,
};
use super::{now_rfc3339, truncate, MonitorState, SUMMARY_MAX_CHARS};

impl MonitorState {
    pub(super) async fn dispatch_run_notification(
        &self,
        task: &LocalMonitorTask,
        result: &LocalExecutionResult,
        delivery_policy: &MonitorDeliveryPolicy,
    ) -> Result<(), String> {
        let title = format!("🔔 寻猎运行: {}", task.title.trim());
        let summary = if result.change_summary.trim().is_empty() {
            if result.is_significant_change {
                "### 研判结论\n检测到显著变化。".to_string()
            } else {
                "### 研判结论\n本次运行未发现显著变化。".to_string()
            }
        } else {
            truncate(result.change_summary.as_str(), SUMMARY_MAX_CHARS)
        };
        let payload = json!({
            "type": "monitor_run",
            "task_id": task.id,
            "task_title": task.title,
            "status": "success",
            "is_significant_change": result.is_significant_change,
            "reason": if result.is_significant_change { "change" } else { "routine" },
            "summary": summary,
            "snapshot": result.new_snapshot,
            "tokens_used": result.tokens_used,
            "model_id": result.model_id,
            "events": result.events,
            "delivery_policy": delivery_policy,
            "sent_at": now_rfc3339(),
        });
        self.dispatch_notification(task, title.as_str(), summary.as_str(), &payload)
            .await
    }

    pub(super) async fn dispatch_failed_notification(
        &self,
        task: &LocalMonitorTask,
        error_message: &str,
        events: &[Value],
        delivery_policy: &MonitorDeliveryPolicy,
    ) -> Result<(), String> {
        let title = format!("⚠️ 寻猎失败: {}", task.title.trim());
        let summary = format!(
            "### 本次运行失败\n{}\n\n请查看任务记录了解完整上下文。",
            truncate(error_message, 600)
        );
        let payload = json!({
            "type": "monitor_failed",
            "task_id": task.id,
            "task_title": task.title,
            "status": "failure",
            "reason": "failure",
            "error_message": truncate(error_message, 1200),
            "events": events,
            "delivery_policy": delivery_policy,
            "sent_at": now_rfc3339(),
        });
        self.dispatch_notification(task, title.as_str(), summary.as_str(), &payload)
            .await
    }

    pub(super) async fn dispatch_suspended_notification(
        &self,
        task: &LocalMonitorTask,
        error_message: &str,
        events: &[Value],
        delivery_policy: &MonitorDeliveryPolicy,
    ) -> Result<(), String> {
        let title = format!("⚠️ 任务熔断: {}", task.title.trim());
        let summary = format!(
            "### 任务已自动挂起\n连续失败次数已超阈值，请检查任务配置。\n\n最近错误：{}",
            truncate(error_message, 600)
        );
        let payload = json!({
            "type": "monitor_suspended",
            "task_id": task.id,
            "task_title": task.title,
            "status": "failed_suspended",
            "reason": "suspended",
            "error_message": truncate(error_message, 1200),
            "events": events,
            "delivery_policy": delivery_policy,
            "sent_at": now_rfc3339(),
        });
        self.dispatch_notification(task, title.as_str(), summary.as_str(), &payload)
            .await
    }

    async fn dispatch_notification(
        &self,
        task: &LocalMonitorTask,
        title: &str,
        content: &str,
        payload: &Value,
    ) -> Result<(), String> {
        let channel_ids = extract_notify_channel_ids(&task.notify_config);
        let (channels, stop_on_success) = if channel_ids.is_empty() {
            (
                self.shared
                    .store
                    .list_active_notification_channels()
                    .await?,
                true,
            )
        } else {
            (
                self.shared
                    .store
                    .list_active_notification_channels_by_ids(&channel_ids)
                    .await?,
                false,
            )
        };
        if channels.is_empty() {
            return Ok(());
        }

        let mut sent = 0_i64;
        let mut failures = Vec::new();
        for channel in channels {
            match self
                .send_notification_to_channel(&channel, title, content, payload)
                .await
            {
                Ok(_) => {
                    sent += 1;
                    if let Err(err) = self
                        .shared
                        .store
                        .touch_notification_channel(&channel.id)
                        .await
                    {
                        log::warn!(
                            "touch_local_notification_channel_failed channel_id={} err={}",
                            channel.id,
                            err
                        );
                    }
                    if stop_on_success {
                        break;
                    }
                }
                Err(err) => failures.push(format!("{}:{} -> {}", channel.channel, channel.id, err)),
            }
        }

        if sent > 0 {
            return Ok(());
        }
        if failures.is_empty() {
            return Err("无可用通知渠道".to_string());
        }
        Err(failures.join("; "))
    }

    pub(super) async fn send_notification_to_channel(
        &self,
        channel: &LocalNotificationChannel,
        title: &str,
        content: &str,
        payload: &Value,
    ) -> Result<String, String> {
        let channel_kind = channel.channel.trim().to_lowercase();
        if !is_supported_notification_channel(channel_kind.as_str()) {
            return Err("不支持的通知渠道类型".to_string());
        }

        match channel_kind.as_str() {
            "feishu" => {
                self.send_feishu_notification(channel, title, content, payload)
                    .await
            }
            "wechat" => {
                self.send_wechat_notification(channel, title, content, payload)
                    .await
            }
            "dingtalk" => {
                self.send_dingtalk_notification(channel, title, content, payload)
                    .await
            }
            "webhook" => {
                self.send_webhook_notification(channel, title, content, payload)
                    .await
            }
            "telegram" => {
                self.send_telegram_notification(channel, title, content, payload)
                    .await
            }
            "email" => Err("桌面端暂不支持 email 通知渠道".to_string()),
            _ => Err("不支持的通知渠道类型".to_string()),
        }
    }

    async fn send_feishu_notification(
        &self,
        channel: &LocalNotificationChannel,
        title: &str,
        content: &str,
        payload: &Value,
    ) -> Result<String, String> {
        let text = render_channel_notification_text("feishu", title, content, payload);
        let task_id = payload_task_id(payload);
        if let Some(webhook_url) = config_string(&channel.config, "webhook_url") {
            let body = json!({
                "msg_type": "text",
                "content": { "text": truncate(text.as_str(), 4000) },
                "meta": payload,
            });
            let response = self
                .shared
                .client
                .post(webhook_url.as_str())
                .json(&body)
                .send()
                .await
                .map_err(|err| format!("请求失败: {}", err))?;
            let status = response.status();
            let body_json: Value = response.json().await.unwrap_or_else(|_| json!({}));
            if !status.is_success() {
                return Err(format!("HTTP {}", status.as_u16()));
            }
            if body_json.get("code").and_then(Value::as_i64).unwrap_or(0) != 0 {
                let msg = body_json
                    .get("msg")
                    .or_else(|| body_json.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("feishu error");
                return Err(msg.to_string());
            }
            return Ok("发送成功".to_string());
        }

        let app_id = config_string(&channel.config, "bot_app_id")
            .ok_or_else(|| "缺少 webhook_url 或 bot_app_id".to_string())?;
        let app_secret = config_string(&channel.config, "bot_app_secret")
            .ok_or_else(|| "缺少 bot_app_secret".to_string())?;
        let chat_ids = config_string_list(&channel.config, "chat_ids");
        if chat_ids.is_empty() {
            return Err("缺少 chat_ids".to_string());
        }
        let client = FeishuClient::new(FeishuConfig {
            app_id,
            app_secret,
            ..Default::default()
        });
        let text = truncate(text.as_str(), 4000);
        for chat_id in &chat_ids {
            let target_key = delivery_target_key("feishu", chat_id);
            let reply_to = self
                .load_anchor_message_id(task_id, channel.id.as_str(), target_key.as_str())
                .await?;
            let response = client
                .send_message(SendMessageRequest {
                    chat_id: chat_id.clone(),
                    content: MessageContent::Text { text: text.clone() },
                    reply_to: reply_to.clone(),
                })
                .await
                .map_err(|err| err.to_string())?;
            self.persist_delivery_anchor(
                task_id,
                channel.id.as_str(),
                target_key.as_str(),
                reply_to.as_deref().or(Some(response.message_id.as_str())),
                Some(&json!({
                    "chat_id": chat_id,
                    "platform": "feishu",
                })),
            )
            .await?;
        }
        Ok("发送成功".to_string())
    }

    async fn send_wechat_notification(
        &self,
        channel: &LocalNotificationChannel,
        title: &str,
        content: &str,
        payload: &Value,
    ) -> Result<String, String> {
        let wechat_state = self
            .shared
            .wechat_state
            .read()
            .await
            .clone()
            .ok_or_else(|| "桌面端微信渠道尚未初始化。".to_string())?;
        let account = wechat_state
            .load_account()
            .await?
            .ok_or_else(|| "桌面端微信渠道仅支持聊天式接入，请先完成连接。".to_string())?;
        let notify_contact_ids = config_string_list(&channel.config, "notify_contact_ids");
        if notify_contact_ids.is_empty() {
            return Err("请先配置微信主动通知目标联系人。".to_string());
        }

        let mut sent = 0_i64;
        let mut failures = Vec::new();
        let rendered = render_channel_notification_text("wechat", title, content, payload);
        let text = truncate(rendered.as_str(), 4000);
        let task_id = payload_task_id(payload);

        for contact_id in notify_contact_ids {
            let target_key = delivery_target_key("wechat", contact_id.as_str());
            let persisted = self
                .load_delivery_state(task_id, channel.id.as_str(), target_key.as_str())
                .await?;
            let runtime_context = wechat_state
                .context_token_for_contact(contact_id.as_str())
                .await?;
            let Some(context_token) =
                resolve_wechat_delivery_context(runtime_context, persisted.as_ref())
            else {
                failures.push(format!(
                    "{} -> 缺少历史会话上下文，请先让该联系人发送一条消息。",
                    contact_id
                ));
                continue;
            };
            match wechat_state
                .send_text(
                    account.base_url.as_str(),
                    account.token.as_str(),
                    contact_id.as_str(),
                    text.as_str(),
                    context_token.as_str(),
                )
                .await
            {
                Ok(()) => {
                    sent += 1;
                    self.persist_delivery_anchor(
                        task_id,
                        channel.id.as_str(),
                        target_key.as_str(),
                        None,
                        Some(&json!({
                            "contact_id": contact_id,
                            "context_token": context_token,
                            "platform": "wechat",
                        })),
                    )
                    .await?;
                }
                Err(err) => failures.push(format!("{} -> {}", contact_id, err)),
            }
        }

        if sent > 0 {
            return Ok("发送成功".to_string());
        }
        Err(failures.join("; "))
    }

    async fn send_dingtalk_notification(
        &self,
        channel: &LocalNotificationChannel,
        title: &str,
        content: &str,
        payload: &Value,
    ) -> Result<String, String> {
        let webhook_url = config_string(&channel.config, "webhook_url")
            .ok_or_else(|| "缺少 webhook_url".to_string())?;
        let text = format!("{}\n\n{}\n\n{}", title, content, payload);
        let body = json!({
            "msgtype": "text",
            "text": { "content": truncate(text.as_str(), 4000) },
        });
        let response = self
            .shared
            .client
            .post(webhook_url.as_str())
            .json(&body)
            .send()
            .await
            .map_err(|err| format!("请求失败: {}", err))?;
        let status = response.status();
        let body_json: Value = response.json().await.unwrap_or_else(|_| json!({}));
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        if body_json
            .get("errcode")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            != 0
        {
            let msg = body_json
                .get("errmsg")
                .or_else(|| body_json.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("dingtalk error");
            return Err(msg.to_string());
        }
        Ok("发送成功".to_string())
    }

    async fn send_webhook_notification(
        &self,
        channel: &LocalNotificationChannel,
        title: &str,
        content: &str,
        payload: &Value,
    ) -> Result<String, String> {
        let webhook_url = config_string(&channel.config, "webhook_url")
            .ok_or_else(|| "缺少 webhook_url".to_string())?;
        let method = config_string(&channel.config, "method")
            .unwrap_or_else(|| "POST".to_string())
            .to_uppercase();
        let parsed_method = method
            .parse::<reqwest::Method>()
            .map_err(|_| "method 非法".to_string())?;
        let body = json!({
            "title": title,
            "content": content,
            "payload": payload,
            "sent_at": now_rfc3339(),
        });
        let response = self
            .shared
            .client
            .request(parsed_method, webhook_url.as_str())
            .json(&body)
            .send()
            .await
            .map_err(|err| format!("请求失败: {}", err))?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status().as_u16()));
        }
        Ok("发送成功".to_string())
    }

    async fn send_telegram_notification(
        &self,
        channel: &LocalNotificationChannel,
        title: &str,
        content: &str,
        payload: &Value,
    ) -> Result<String, String> {
        let bot_token = config_string(&channel.config, "bot_token")
            .ok_or_else(|| "缺少 bot_token".to_string())?;
        let chat_id =
            config_string(&channel.config, "chat_id").ok_or_else(|| "缺少 chat_id".to_string())?;
        let endpoint = format!(
            "https://api.telegram.org/bot{}/sendMessage",
            bot_token.trim()
        );
        let text = render_channel_notification_text("telegram", title, content, payload);
        let task_id = payload_task_id(payload);
        let target_key = delivery_target_key("telegram", chat_id.as_str());
        let reply_to = self
            .load_anchor_message_id(task_id, channel.id.as_str(), target_key.as_str())
            .await?;
        let response = self
            .shared
            .client
            .post(endpoint.as_str())
            .json(&json!({
                "chat_id": chat_id,
                "text": truncate(text.as_str(), 4000),
                "disable_web_page_preview": true,
                "reply_to_message_id": reply_to.as_deref().and_then(|value| value.parse::<i64>().ok()),
            }))
            .send()
            .await
            .map_err(|err| format!("请求失败: {}", err))?;
        let status = response.status();
        let body_json: Value = response.json().await.unwrap_or_else(|_| json!({}));
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        if !body_json
            .get("ok")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let msg = body_json
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("telegram error");
            return Err(msg.to_string());
        }
        let anchor_message_id = reply_to.or_else(|| {
            body_json
                .get("result")
                .and_then(|value| value.get("message_id"))
                .and_then(Value::as_i64)
                .map(|value| value.to_string())
        });
        self.persist_delivery_anchor(
            task_id,
            channel.id.as_str(),
            target_key.as_str(),
            anchor_message_id.as_deref(),
            Some(&json!({
                "chat_id": chat_id,
                "platform": "telegram",
            })),
        )
        .await?;
        Ok("发送成功".to_string())
    }
}

impl MonitorState {
    async fn load_delivery_state(
        &self,
        task_id: Option<&str>,
        channel_id: &str,
        target_key: &str,
    ) -> Result<Option<MonitorDeliveryState>, String> {
        let Some(task_id) = task_id.filter(|value| !value.trim().is_empty()) else {
            return Ok(None);
        };
        self.shared
            .store
            .get_delivery_state(task_id, channel_id, target_key)
            .await
    }

    async fn load_anchor_message_id(
        &self,
        task_id: Option<&str>,
        channel_id: &str,
        target_key: &str,
    ) -> Result<Option<String>, String> {
        Ok(resolve_anchor_message_id(
            self.load_delivery_state(task_id, channel_id, target_key)
                .await?
                .as_ref(),
        ))
    }

    async fn persist_delivery_anchor(
        &self,
        task_id: Option<&str>,
        channel_id: &str,
        target_key: &str,
        anchor_message_id: Option<&str>,
        anchor_context: Option<&Value>,
    ) -> Result<(), String> {
        let Some(task_id) = task_id.filter(|value| !value.trim().is_empty()) else {
            return Ok(());
        };
        self.shared
            .store
            .upsert_delivery_state(
                task_id,
                channel_id,
                target_key,
                anchor_message_id,
                anchor_context,
            )
            .await
    }
}

pub(super) fn extract_notify_channel_ids(notify_config: &Value) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let Some(items) = notify_config.get("channel_ids").and_then(Value::as_array) else {
        return result;
    };
    for raw in items {
        let Some(id) = raw.as_str() else {
            continue;
        };
        let normalized = id.trim().to_string();
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.clone()) {
            result.push(normalized);
        }
    }
    result
}

fn config_string(config: &Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn config_string_list(config: &Value, key: &str) -> Vec<String> {
    let Some(value) = config.get(key) else {
        return Vec::new();
    };
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        Value::String(text) => text
            .split(|ch| ch == '\n' || ch == ',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

pub(super) fn is_supported_notification_channel(value: &str) -> bool {
    matches!(
        value,
        "feishu" | "wechat" | "dingtalk" | "telegram" | "email" | "webhook"
    )
}

pub(super) fn render_channel_notification_text(
    channel_kind: &str,
    title: &str,
    content: &str,
    payload: &Value,
) -> String {
    match channel_kind {
        "wechat" => render_wechat_notification_text(title, content, payload),
        "telegram" => render_telegram_notification_text(title, content, payload),
        _ => render_feishu_notification_text(title, content, payload),
    }
}

fn render_feishu_notification_text(title: &str, content: &str, payload: &Value) -> String {
    let mut sections = vec![title.to_string(), content.to_string()];
    let event_lines = build_delivery_event_lines(payload, 5, false);
    if !event_lines.is_empty() {
        sections.push(format!("阶段记录\n{}", event_lines.join("\n")));
    }
    if let Some(metrics) = build_delivery_metrics_line(payload) {
        sections.push(metrics);
    }
    sections.join("\n\n")
}

fn render_telegram_notification_text(title: &str, content: &str, payload: &Value) -> String {
    let mut sections = vec![title.to_string(), content.to_string()];
    let event_lines = build_delivery_event_lines(payload, 4, false);
    if !event_lines.is_empty() {
        sections.push(event_lines.join("\n"));
    }
    sections.join("\n\n")
}

fn render_wechat_notification_text(title: &str, content: &str, payload: &Value) -> String {
    let mut sections = vec![title.to_string(), content.to_string()];
    let event_lines = build_delivery_event_lines(payload, 2, true);
    if !event_lines.is_empty() {
        sections.push(event_lines.join("\n"));
    }
    sections.join("\n\n")
}

fn build_delivery_event_lines(
    payload: &Value,
    max_items: usize,
    summary_only: bool,
) -> Vec<String> {
    let Some(events) = payload.get("events").and_then(Value::as_array) else {
        return Vec::new();
    };
    let detail_level = payload
        .get("delivery_policy")
        .and_then(|value| value.get("detail_level"))
        .and_then(Value::as_str)
        .unwrap_or("stage");
    let include_tools = !summary_only && detail_level == "detailed";

    events
        .iter()
        .filter_map(|event| {
            let kind = event
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if summary_only {
                return matches!(kind, "run_completed" | "run_failed" | "delivery_failed")
                    .then(|| delivery_event_line(event));
            }
            if !include_tools && matches!(kind, "tool_called" | "tool_succeeded") {
                return None;
            }
            if detail_level == "stage" && kind == "tool_called" {
                return None;
            }
            Some(delivery_event_line(event))
        })
        .filter(|line| !line.trim().is_empty())
        .take(max_items)
        .collect()
}

fn delivery_event_line(event: &Value) -> String {
    if let Some(summary) = event
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.trim().is_empty())
    {
        return format!("- {}", summary);
    }

    let kind = event.get("kind").and_then(Value::as_str).unwrap_or("event");
    let step = event.get("step").and_then(Value::as_str).unwrap_or(kind);
    format!("- {}", step)
}

fn build_delivery_metrics_line(payload: &Value) -> Option<String> {
    let tokens_used = payload
        .get("tokens_used")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let model_id = payload
        .get("model_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if tokens_used <= 0 && model_id.is_none() {
        return None;
    }

    let mut parts = Vec::new();
    if let Some(model_id) = model_id {
        parts.push(format!("模型: {}", model_id));
    }
    if tokens_used > 0 {
        parts.push(format!("Tokens: {}", tokens_used));
    }
    Some(parts.join(" | "))
}

fn payload_task_id(payload: &Value) -> Option<&str> {
    payload
        .get("task_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn delivery_target_key(channel_kind: &str, target_id: &str) -> String {
    format!("{}:{}", channel_kind.trim(), target_id.trim())
}

fn resolve_anchor_message_id(persisted_state: Option<&MonitorDeliveryState>) -> Option<String> {
    persisted_state
        .and_then(|state| state.anchor_message_id.clone())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg_attr(not(test), allow(dead_code))]
fn next_anchor_message_id(
    existing_anchor: Option<String>,
    latest_message_id: Option<String>,
) -> Option<String> {
    existing_anchor.or_else(|| {
        latest_message_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn resolve_wechat_delivery_context(
    runtime_context: Option<String>,
    persisted_state: Option<&MonitorDeliveryState>,
) -> Option<String> {
    runtime_context
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            persisted_state
                .and_then(|state| state.anchor_context.get("context_token"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivery_target_key_prefixes_channel_kind() {
        assert_eq!(delivery_target_key("telegram", "123"), "telegram:123");
        assert_eq!(delivery_target_key("wechat", "user-1"), "wechat:user-1");
    }

    #[test]
    fn resolve_wechat_delivery_context_prefers_runtime_then_persisted() {
        let persisted = MonitorDeliveryState {
            anchor_message_id: None,
            anchor_context: json!({
                "context_token": "persisted-token"
            }),
            updated_at: "2026-03-28T00:00:00Z".to_string(),
        };

        assert_eq!(
            resolve_wechat_delivery_context(Some("runtime-token".to_string()), Some(&persisted)),
            Some("runtime-token".to_string())
        );
        assert_eq!(
            resolve_wechat_delivery_context(None, Some(&persisted)),
            Some("persisted-token".to_string())
        );
    }

    #[test]
    fn resolve_anchor_message_id_trims_persisted_value() {
        let persisted = MonitorDeliveryState {
            anchor_message_id: Some("  msg-1  ".to_string()),
            anchor_context: json!({}),
            updated_at: "2026-03-28T00:00:00Z".to_string(),
        };

        assert_eq!(
            resolve_anchor_message_id(Some(&persisted)),
            Some("msg-1".to_string())
        );
    }

    #[test]
    fn next_anchor_message_id_prefers_existing_anchor_before_new_message_id() {
        assert_eq!(
            next_anchor_message_id(Some("anchor-1".to_string()), Some("msg-2".to_string())),
            Some("anchor-1".to_string())
        );
        assert_eq!(
            next_anchor_message_id(None, Some("  msg-2  ".to_string())),
            Some("msg-2".to_string())
        );
    }

    #[test]
    fn payload_task_id_rejects_blank_values() {
        assert_eq!(payload_task_id(&json!({"task_id": ""})), None);
        assert_eq!(
            payload_task_id(&json!({"task_id": "task-1"})),
            Some("task-1")
        );
    }
}
