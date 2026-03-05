pub mod commands;
pub mod store;
pub mod types;

use std::cmp::Ordering;
use std::sync::Arc;
use std::time::Duration;

use log::warn;
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::modules::monitor::store::MonitorStore;
use crate::modules::monitor::types::{
    LocalExecutionResult, LocalMonitorActionResponse, LocalMonitorCreateResponse,
    LocalMonitorExecutionLogListResponse, LocalMonitorListQuery, LocalMonitorLogsQuery,
    LocalMonitorStatsResponse, LocalMonitorTask, LocalMonitorTaskCreateRequest,
    LocalMonitorTaskIdRequest, LocalMonitorTaskListResponse, LocalMonitorTaskUpdateRequest,
    LocalMonitorTriggerResponse, LocalNotificationChannel, LocalNotificationChannelCreateRequest,
    LocalNotificationChannelCreateResponse, LocalNotificationChannelDeleteResponse,
    LocalNotificationChannelListResponse, LocalNotificationChannelTestRequest,
    LocalNotificationChannelTestResponse, LocalNotificationChannelUpdateRequest,
    LocalNotificationChannelUpdateResponse, MonitorWorkerStartRequest, MonitorWorkerStatus,
};
use crate::modules::providers::store::{ProviderConnection, ProviderStore};
use crate::modules::providers::types::ProviderModel;

const DEFAULT_MONITOR_POLL_INTERVAL_SECONDS: u64 = 20;
const MIN_MONITOR_POLL_INTERVAL_SECONDS: u64 = 5;
const MAX_MONITOR_POLL_INTERVAL_SECONDS: u64 = 300;
const DEFAULT_MONITOR_PULL_LIMIT: u32 = 5;
const MAX_MONITOR_PULL_LIMIT: u32 = 20;
const MODEL_RESPONSE_MAX_CHARS: usize = 40_000;
const SUMMARY_MAX_CHARS: usize = 4_000;

#[derive(Clone)]
pub struct MonitorState {
    shared: Arc<MonitorWorkerShared>,
}

struct MonitorWorkerShared {
    client: reqwest::Client,
    provider_store: Arc<ProviderStore>,
    store: Arc<MonitorStore>,
    worker_task: Mutex<Option<JoinHandle<()>>>,
    tick_lock: Mutex<()>,
    config: RwLock<WorkerConfig>,
    runtime: RwLock<WorkerRuntime>,
}

#[derive(Debug, Clone)]
struct WorkerConfig {
    agent_id: String,
    poll_interval_seconds: u64,
    pull_limit: u32,
}

#[derive(Debug, Clone, Default)]
struct WorkerRuntime {
    last_tick_at: Option<String>,
    last_error: Option<String>,
    last_claimed: i64,
}

impl MonitorState {
    pub async fn new(
        database_url: &str,
        provider_store: Arc<ProviderStore>,
    ) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let config = WorkerConfig {
            agent_id: make_default_agent_id(),
            poll_interval_seconds: DEFAULT_MONITOR_POLL_INTERVAL_SECONDS,
            pull_limit: DEFAULT_MONITOR_PULL_LIMIT,
        };
        let store = Arc::new(MonitorStore::new(database_url).await?);
        Ok(Self {
            shared: Arc::new(MonitorWorkerShared {
                client,
                provider_store,
                store,
                worker_task: Mutex::new(None),
                tick_lock: Mutex::new(()),
                config: RwLock::new(config),
                runtime: RwLock::new(WorkerRuntime::default()),
            }),
        })
    }

    pub async fn start_worker(
        &self,
        payload: MonitorWorkerStartRequest,
    ) -> Result<MonitorWorkerStatus, String> {
        {
            let mut config = self.shared.config.write().await;
            config.poll_interval_seconds = normalize_poll_interval(
                payload
                    .poll_interval_seconds
                    .unwrap_or(config.poll_interval_seconds),
            );
            config.pull_limit =
                normalize_pull_limit(payload.pull_limit.unwrap_or(config.pull_limit));
            if let Some(agent_id) = payload
                .agent_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                config.agent_id = agent_id;
            }
            let _ = payload.access_token;
        }

        let mut worker_task_guard = self.shared.worker_task.lock().await;
        if worker_task_guard.is_none() {
            let state = self.clone();
            let handle = tokio::spawn(async move {
                state.worker_loop().await;
            });
            *worker_task_guard = Some(handle);
        }
        drop(worker_task_guard);
        self.get_status().await
    }

    pub async fn stop_worker(&self) -> Result<MonitorWorkerStatus, String> {
        let mut worker_task_guard = self.shared.worker_task.lock().await;
        if let Some(handle) = worker_task_guard.take() {
            handle.abort();
            let _ = handle.await;
        }
        drop(worker_task_guard);
        self.get_status().await
    }

    pub async fn run_once(&self) -> Result<MonitorWorkerStatus, String> {
        self.process_tick().await?;
        self.get_status().await
    }

    pub async fn get_status(&self) -> Result<MonitorWorkerStatus, String> {
        let running = self.shared.worker_task.lock().await.is_some();
        let config = self.shared.config.read().await.clone();
        let runtime = self.shared.runtime.read().await.clone();
        Ok(MonitorWorkerStatus {
            running,
            agent_id: Some(config.agent_id),
            poll_interval_seconds: config.poll_interval_seconds,
            pull_limit: config.pull_limit,
            last_tick_at: runtime.last_tick_at,
            last_error: runtime.last_error,
            last_claimed: runtime.last_claimed,
        })
    }

    pub async fn list_tasks(
        &self,
        query: LocalMonitorListQuery,
    ) -> Result<LocalMonitorTaskListResponse, String> {
        self.shared
            .store
            .list_tasks(
                query.skip.unwrap_or(0),
                query.limit.unwrap_or(100),
                query.status.as_deref(),
            )
            .await
    }

    pub async fn get_task(&self, task_id: String) -> Result<LocalMonitorTask, String> {
        self.shared
            .store
            .get_task(task_id.as_str())
            .await?
            .ok_or_else(|| "任务不存在".to_string())
    }

    pub async fn create_task(
        &self,
        payload: LocalMonitorTaskCreateRequest,
    ) -> Result<LocalMonitorCreateResponse, String> {
        let task = self.shared.store.create_task(payload).await?;
        Ok(LocalMonitorCreateResponse {
            id: task.id,
            title: task.title,
            status: task.status,
            message: "任务创建成功（本地执行）".to_string(),
            assistant_id: task.assistant_id,
            execution_target: task.execution_target,
        })
    }

    pub async fn update_task(
        &self,
        task_id: String,
        payload: LocalMonitorTaskUpdateRequest,
    ) -> Result<LocalMonitorTask, String> {
        self.shared
            .store
            .update_task(task_id.as_str(), payload)
            .await
    }

    pub async fn pause_task(
        &self,
        payload: LocalMonitorTaskIdRequest,
    ) -> Result<LocalMonitorActionResponse, String> {
        let task = self
            .shared
            .store
            .pause_task(payload.task_id.as_str())
            .await?;
        let Some(task) = task else {
            return Err("任务不存在".to_string());
        };
        Ok(LocalMonitorActionResponse {
            id: task.id,
            status: Some("paused".to_string()),
            message: "任务已暂停".to_string(),
        })
    }

    pub async fn resume_task(
        &self,
        payload: LocalMonitorTaskIdRequest,
    ) -> Result<LocalMonitorActionResponse, String> {
        let task = self
            .shared
            .store
            .resume_task(payload.task_id.as_str())
            .await?;
        let Some(task) = task else {
            return Err("任务不存在".to_string());
        };
        Ok(LocalMonitorActionResponse {
            id: task.id,
            status: Some("active".to_string()),
            message: "任务已恢复".to_string(),
        })
    }

    pub async fn trigger_task(
        &self,
        payload: LocalMonitorTaskIdRequest,
    ) -> Result<LocalMonitorTriggerResponse, String> {
        let task = self
            .shared
            .store
            .trigger_task(payload.task_id.as_str())
            .await?;
        let Some(task) = task else {
            return Err("仅 active 任务可触发".to_string());
        };
        let state = self.clone();
        tokio::spawn(async move {
            let _ = state.process_tick().await;
        });
        Ok(LocalMonitorTriggerResponse {
            task_id: task.id,
            message: "已提交本地执行".to_string(),
        })
    }

    pub async fn delete_task(
        &self,
        payload: LocalMonitorTaskIdRequest,
    ) -> Result<LocalMonitorActionResponse, String> {
        let deleted = self
            .shared
            .store
            .delete_task(payload.task_id.as_str())
            .await?;
        if !deleted {
            return Err("任务不存在".to_string());
        }
        Ok(LocalMonitorActionResponse {
            id: payload.task_id,
            status: None,
            message: "任务已删除".to_string(),
        })
    }

    pub async fn get_stats(&self) -> Result<LocalMonitorStatsResponse, String> {
        self.shared.store.get_stats().await
    }

    pub async fn list_logs(
        &self,
        query: LocalMonitorLogsQuery,
    ) -> Result<LocalMonitorExecutionLogListResponse, String> {
        self.shared
            .store
            .list_logs(
                query.task_id.as_str(),
                query.skip.unwrap_or(0),
                query.limit.unwrap_or(50),
            )
            .await
    }

    pub async fn submit_feedback(
        &self,
        task_id: String,
        log_id: String,
        score: f64,
    ) -> Result<(), String> {
        self.shared
            .store
            .submit_feedback(task_id.as_str(), log_id.as_str(), score)
            .await
    }

    pub async fn list_notification_channels(
        &self,
    ) -> Result<LocalNotificationChannelListResponse, String> {
        self.shared.store.list_notification_channels().await
    }

    pub async fn get_notification_channel(
        &self,
        channel_id: String,
    ) -> Result<LocalNotificationChannel, String> {
        self.shared
            .store
            .get_notification_channel(channel_id.as_str())
            .await?
            .ok_or_else(|| "通知渠道不存在".to_string())
    }

    pub async fn create_notification_channel(
        &self,
        payload: LocalNotificationChannelCreateRequest,
    ) -> Result<LocalNotificationChannelCreateResponse, String> {
        let channel = self
            .shared
            .store
            .create_notification_channel(payload)
            .await?;
        Ok(LocalNotificationChannelCreateResponse {
            id: channel.id,
            channel: channel.channel,
            message: "通知渠道创建成功".to_string(),
        })
    }

    pub async fn update_notification_channel(
        &self,
        channel_id: String,
        payload: LocalNotificationChannelUpdateRequest,
    ) -> Result<LocalNotificationChannelUpdateResponse, String> {
        let updated = self
            .shared
            .store
            .update_notification_channel(channel_id.as_str(), payload)
            .await?;
        if updated.is_none() {
            return Err("通知渠道不存在".to_string());
        }
        Ok(LocalNotificationChannelUpdateResponse {
            id: channel_id,
            message: "通知渠道更新成功".to_string(),
        })
    }

    pub async fn delete_notification_channel(
        &self,
        channel_id: String,
    ) -> Result<LocalNotificationChannelDeleteResponse, String> {
        let deleted = self
            .shared
            .store
            .delete_notification_channel(channel_id.as_str())
            .await?;
        if !deleted {
            return Err("通知渠道不存在".to_string());
        }
        Ok(LocalNotificationChannelDeleteResponse {
            message: "通知渠道已删除".to_string(),
        })
    }

    pub async fn test_notification_channel(
        &self,
        payload: LocalNotificationChannelTestRequest,
    ) -> Result<LocalNotificationChannelTestResponse, String> {
        let channel = payload.channel.trim().to_lowercase();
        if !is_supported_notification_channel(channel.as_str()) {
            return Err("不支持的通知渠道类型".to_string());
        }
        if !payload.config.is_object() {
            return Err("config 必须是 object".to_string());
        }

        let test_channel = LocalNotificationChannel {
            id: "local-test".to_string(),
            user_id: "local".to_string(),
            channel: channel.clone(),
            config: payload.config,
            display_name: Some("本地测试渠道".to_string()),
            is_active: true,
            priority: 0,
            last_used_at: None,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };
        let title = "🧪 Deeting 本地通知测试";
        let content = "如果你收到此消息，说明桌面端本地通知链路可用。";
        let payload = json!({
            "type": "monitor_channel_test",
            "source": "desktop_local",
            "sent_at": now_rfc3339(),
        });

        match self
            .send_notification_to_channel(&test_channel, title, content, &payload)
            .await
        {
            Ok(message) => Ok(LocalNotificationChannelTestResponse {
                success: true,
                channel,
                message: Some(message),
            }),
            Err(err) => Ok(LocalNotificationChannelTestResponse {
                success: false,
                channel,
                message: Some(err),
            }),
        }
    }

    async fn worker_loop(&self) {
        loop {
            let delay_seconds = {
                let config = self.shared.config.read().await;
                config.poll_interval_seconds
            };
            if let Err(err) = self.process_tick().await {
                let mut runtime = self.shared.runtime.write().await;
                runtime.last_error = Some(err);
            }
            tokio::time::sleep(Duration::from_secs(delay_seconds)).await;
        }
    }

    async fn process_tick(&self) -> Result<(), String> {
        let _tick_guard = self.shared.tick_lock.lock().await;
        let config = self.shared.config.read().await.clone();
        let tasks = self
            .shared
            .store
            .list_due_tasks(config.pull_limit as i64)
            .await?;
        let mut task_errors = Vec::new();
        for task in &tasks {
            if let Err(err) = self.process_single_task(task).await {
                task_errors.push(format!("task={} err={}", task.id, err));
            }
        }

        {
            let mut runtime = self.shared.runtime.write().await;
            runtime.last_tick_at = Some(now_rfc3339());
            runtime.last_claimed = tasks.len() as i64;
            if task_errors.is_empty() {
                runtime.last_error = None;
            } else {
                runtime.last_error = Some(task_errors.join("; "));
            }
        }

        if task_errors.is_empty() {
            return Ok(());
        }
        Err(task_errors.join("; "))
    }

    async fn process_single_task(&self, task: &LocalMonitorTask) -> Result<(), String> {
        match self.execute_task_local(task).await {
            Ok(result) => {
                self.shared
                    .store
                    .record_execution_success(task, &result)
                    .await
                    .map_err(|err| format!("record_success_failed: {}", err))?;

                let force_notify = task
                    .notify_config
                    .get("force_notify")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if result.is_significant_change || force_notify {
                    if let Err(err) = self.dispatch_change_notification(task, &result).await {
                        warn!(
                            "monitor_local_notification_failed task_id={} err={}",
                            task.id, err
                        );
                    }
                }
                Ok(())
            }
            Err(err) => {
                self.shared
                    .store
                    .record_execution_failure(task, &err)
                    .await
                    .map_err(|report_err| {
                        format!("record_failure_failed: {} (origin: {})", report_err, err)
                    })?;

                if let Some(updated) =
                    self.shared
                        .store
                        .get_task(task.id.as_str())
                        .await
                        .map_err(|query_err| {
                            format!("query_task_after_failure_failed: {}", query_err)
                        })?
                {
                    if updated.status == "failed_suspended" {
                        if let Err(notify_err) = self
                            .dispatch_suspended_notification(&updated, err.as_str())
                            .await
                        {
                            warn!(
                                "monitor_local_suspend_notification_failed task_id={} err={}",
                                updated.id, notify_err
                            );
                        }
                    }
                }
                Ok(())
            }
        }
    }

    async fn execute_task_local(
        &self,
        task: &LocalMonitorTask,
    ) -> Result<LocalExecutionResult, String> {
        let (model, connection) = self.resolve_execution_model(task).await?;
        let prompt = build_monitor_prompt(task);
        let (content, tokens) = self.invoke_model_chat(&connection, &model, &prompt).await?;
        let (is_significant_change, change_summary, new_snapshot) =
            parse_monitor_analysis(&content);

        Ok(LocalExecutionResult {
            is_significant_change,
            change_summary,
            new_snapshot,
            tokens_used: tokens.max(0),
            model_id: model.model_id.clone(),
        })
    }

    async fn resolve_execution_model(
        &self,
        task: &LocalMonitorTask,
    ) -> Result<(ProviderModel, ProviderConnection), String> {
        let mut active_models = self
            .shared
            .provider_store
            .list_active_models()
            .await
            .map_err(|err| format!("读取本地模型失败: {}", err))?;
        if active_models.is_empty() {
            return Err("未找到本地可用模型，请先在桌面端配置 Provider Model".to_string());
        }

        let task_model_hint = task
            .model_id
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let secretary_model_hint = self
            .shared
            .provider_store
            .get_or_create_user_secretary()
            .await
            .ok()
            .and_then(|value| value.model_name)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let selected = task_model_hint
            .as_deref()
            .and_then(|hint| find_model_by_reference(&active_models, hint))
            .or_else(|| {
                secretary_model_hint
                    .as_deref()
                    .and_then(|hint| find_model_by_reference(&active_models, hint))
            })
            .unwrap_or_else(|| {
                active_models.sort_by(compare_model_priority);
                active_models[0].clone()
            });

        let connection = self
            .shared
            .provider_store
            .get_instance_connection(&selected.instance_id.to_string())
            .await
            .map_err(|err| format!("读取模型连接失败: {}", err))?
            .ok_or_else(|| "模型实例不存在或连接信息缺失".to_string())?;

        Ok((selected, connection))
    }

    async fn invoke_model_chat(
        &self,
        connection: &ProviderConnection,
        model: &ProviderModel,
        prompt: &str,
    ) -> Result<(String, i64), String> {
        let endpoint = build_upstream_endpoint(&connection.base_url, &model.upstream_path);
        let body = json!({
            "model": model.model_id,
            "messages": [{ "role": "user", "content": prompt }],
            "stream": false
        });
        let mut request = self.shared.client.post(&endpoint).json(&body);
        if let Some(secret_key) = connection.secret_key.as_deref() {
            if !secret_key.trim().is_empty() {
                request = request.bearer_auth(secret_key.trim());
            }
        }

        let response = request
            .send()
            .await
            .map_err(|err| format!("调用本地模型失败: {}", err))?;
        let status = response.status();
        let body_json: Value = response
            .json()
            .await
            .unwrap_or_else(|_| json!({ "raw": "failed to parse json response" }));

        if !status.is_success() {
            let detail = extract_error_message(&body_json)
                .unwrap_or_else(|| format!("upstream status {}", status.as_u16()));
            return Err(detail);
        }

        let content = extract_model_content(&body_json);
        if content.trim().is_empty() {
            return Err("模型返回内容为空".to_string());
        }
        let tokens = extract_total_tokens(&body_json);
        Ok((content, tokens))
    }

    async fn dispatch_change_notification(
        &self,
        task: &LocalMonitorTask,
        result: &LocalExecutionResult,
    ) -> Result<(), String> {
        let title = format!("🔔 监控提醒: {}", task.title.trim());
        let summary = if result.change_summary.trim().is_empty() {
            "### 研判结论\n检测到显著变化。".to_string()
        } else {
            truncate(result.change_summary.as_str(), SUMMARY_MAX_CHARS)
        };
        let payload = json!({
            "type": "monitor_change",
            "task_id": task.id,
            "task_title": task.title,
            "status": "success",
            "is_significant_change": result.is_significant_change,
            "summary": summary,
            "snapshot": result.new_snapshot,
            "tokens_used": result.tokens_used,
            "model_id": result.model_id,
            "sent_at": now_rfc3339(),
        });
        self.dispatch_notification(task, title.as_str(), summary.as_str(), &payload)
            .await
    }

    async fn dispatch_suspended_notification(
        &self,
        task: &LocalMonitorTask,
        error_message: &str,
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
            "error_message": truncate(error_message, 1200),
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
                        warn!(
                            "touch_local_notification_channel_failed channel_id={} err={}",
                            channel.id, err
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

    async fn send_notification_to_channel(
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
        let webhook_url = config_string(&channel.config, "webhook_url")
            .ok_or_else(|| "缺少 webhook_url".to_string())?;
        let text = format!("{}\n\n{}", title, content);
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
        Ok("发送成功".to_string())
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
        let text = format!("{}\n\n{}\n\n{}", title, content, payload);
        let response = self
            .shared
            .client
            .post(endpoint.as_str())
            .json(&json!({
                "chat_id": chat_id,
                "text": truncate(text.as_str(), 4000),
                "disable_web_page_preview": true,
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
        Ok("发送成功".to_string())
    }
}

fn normalize_poll_interval(value: u64) -> u64 {
    value
        .max(MIN_MONITOR_POLL_INTERVAL_SECONDS)
        .min(MAX_MONITOR_POLL_INTERVAL_SECONDS)
}

fn normalize_pull_limit(value: u32) -> u32 {
    value.max(1).min(MAX_MONITOR_PULL_LIMIT)
}

fn make_default_agent_id() -> String {
    format!("desktop-{}", Uuid::new_v4().simple())
}

fn build_upstream_endpoint(base_url: &str, upstream_path: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let mut path = upstream_path.trim().trim_start_matches('/').to_string();
    if path.is_empty() {
        if base.ends_with("/v1") {
            return format!("{base}/chat/completions");
        }
        return format!("{base}/v1/chat/completions");
    }

    if base.ends_with("/v1") {
        if let Some((head, tail)) = path.split_once('/') {
            if head.eq_ignore_ascii_case("v1") {
                path = tail.to_string();
            }
        } else if path.eq_ignore_ascii_case("v1") {
            path.clear();
        }
    }

    if path.is_empty() {
        return base.to_string();
    }

    format!("{base}/{path}")
}

fn compare_model_priority(a: &ProviderModel, b: &ProviderModel) -> Ordering {
    b.priority
        .cmp(&a.priority)
        .then_with(|| b.weight.cmp(&a.weight))
        .then_with(|| a.model_id.cmp(&b.model_id))
}

fn find_model_by_reference(models: &[ProviderModel], reference: &str) -> Option<ProviderModel> {
    let normalized = reference.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    models
        .iter()
        .find(|model| matches_model_reference(model, &normalized))
        .cloned()
}

fn matches_model_reference(model: &ProviderModel, normalized_reference: &str) -> bool {
    if model
        .model_id
        .trim()
        .eq_ignore_ascii_case(normalized_reference)
    {
        return true;
    }
    if model
        .id
        .to_string()
        .eq_ignore_ascii_case(normalized_reference)
    {
        return true;
    }
    if let Some(unified_model_id) = model.unified_model_id.as_ref() {
        if unified_model_id
            .trim()
            .eq_ignore_ascii_case(normalized_reference)
        {
            return true;
        }
    }
    if let Some(display_name) = model.display_name.as_ref() {
        if display_name
            .trim()
            .eq_ignore_ascii_case(normalized_reference)
        {
            return true;
        }
    }
    false
}

fn build_monitor_prompt(task: &LocalMonitorTask) -> String {
    let snapshot = task
        .last_snapshot
        .as_ref()
        .filter(|value| value.is_object())
        .map(Value::to_string)
        .unwrap_or_else(|| "{}".to_string());
    let tools = if task.allowed_tools.is_empty() {
        "未限制".to_string()
    } else {
        task.allowed_tools.join(", ")
    };
    format!(
        "你是高级情报研判官。\n任务标题: {}\n监控目标: {}\nCron: {}\n允许工具: {}\n历史快照: {}\n\n请输出 JSON:\n{{\"is_significant_change\": boolean, \"change_summary\": \"markdown\", \"new_snapshot\": {{}}}}",
        task.title, task.objective, task.cron_expr, tools, snapshot
    )
}

fn parse_monitor_analysis(content: &str) -> (bool, String, Value) {
    let mut text = content.trim().to_string();
    if text.len() > MODEL_RESPONSE_MAX_CHARS {
        text = text.chars().take(MODEL_RESPONSE_MAX_CHARS).collect();
    }

    if let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) {
        if end > start {
            if let Ok(value) = serde_json::from_str::<Value>(&text[start..=end]) {
                let is_change = value
                    .get("is_significant_change")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let summary = value
                    .get("change_summary")
                    .and_then(Value::as_str)
                    .map(|v| truncate(v, SUMMARY_MAX_CHARS))
                    .unwrap_or_default();
                let snapshot = value
                    .get("new_snapshot")
                    .cloned()
                    .filter(Value::is_object)
                    .unwrap_or_else(|| json!({}));
                let final_summary = if summary.trim().is_empty() {
                    build_snapshot_summary(&snapshot, is_change)
                } else {
                    summary
                };
                return (is_change, final_summary, snapshot);
            }
        }
    }

    let fallback = truncate(&text, SUMMARY_MAX_CHARS);
    (
        false,
        if fallback.trim().is_empty() {
            "### 例行简报\n本次本地执行未返回可解析结果。".to_string()
        } else {
            fallback
        },
        json!({}),
    )
}

fn build_snapshot_summary(snapshot: &Value, is_significant_change: bool) -> String {
    if !snapshot.is_object() {
        return if is_significant_change {
            "### 研判结论\n检测到显著变化。".to_string()
        } else {
            "### 例行简报\n当前未检测到显著变化。".to_string()
        };
    }
    let title = if is_significant_change {
        "### 研判结论"
    } else {
        "### 例行简报"
    };
    format!(
        "{}\n{}",
        title,
        truncate(&snapshot.to_string(), SUMMARY_MAX_CHARS)
    )
}

fn extract_model_content(value: &Value) -> String {
    if let Some(text) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|first| first.get("message"))
        .and_then(|message| message.get("content"))
    {
        if let Some(content) = text.as_str() {
            return content.to_string();
        }
        if let Some(parts) = text.as_array() {
            let mut merged = Vec::new();
            for part in parts {
                if let Some(part_text) = part.get("text").and_then(Value::as_str) {
                    merged.push(part_text.to_string());
                }
            }
            if !merged.is_empty() {
                return merged.join("\n");
            }
        }
    }

    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return text.to_string();
    }
    String::new()
}

fn extract_total_tokens(value: &Value) -> i64 {
    value
        .get("usage")
        .and_then(|usage| {
            usage
                .get("total_tokens")
                .and_then(Value::as_i64)
                .or_else(|| {
                    usage
                        .get("total_tokens")
                        .and_then(Value::as_u64)
                        .map(|v| v as i64)
                })
                .or_else(|| {
                    let input = usage
                        .get("prompt_tokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    let output = usage
                        .get("completion_tokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    if input > 0 || output > 0 {
                        Some(input + output)
                    } else {
                        None
                    }
                })
        })
        .unwrap_or(0)
}

fn extract_error_message(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(|item| item.get("message"))
        .and_then(Value::as_str)
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
        .or_else(|| {
            value
                .get("message")
                .and_then(Value::as_str)
                .map(|message| message.trim().to_string())
                .filter(|message| !message.is_empty())
        })
}

fn extract_notify_channel_ids(notify_config: &Value) -> Vec<String> {
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

fn is_supported_notification_channel(value: &str) -> bool {
    matches!(
        value,
        "feishu" | "dingtalk" | "telegram" | "email" | "webhook"
    )
}

fn truncate(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    input.chars().take(max_chars).collect()
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
