pub mod agent_runtime;
pub mod commands;
pub mod output_contract;
pub mod store;
pub mod types;

use std::sync::Arc;
use std::time::Duration;

use futures_util::future::BoxFuture;
use log::warn;
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::modules::custom_task_agents::store::get_custom_task_agent as get_custom_task_agent_profile;
use crate::modules::custom_task_agents::types::CustomTaskAgentProfile;
use crate::modules::desktop_runtime::local_orchestrator::{
    LocalOrchestrationEngine, LocalWorkflowStep,
};
use crate::modules::im::feishu::{FeishuClient, FeishuConfig};
use crate::modules::im::{ImClient, MessageContent, SendMessageRequest};
use crate::modules::monitor::agent_runtime::{
    build_monitor_task_agent_message, execute_monitor_task_agent,
    validate_monitor_task_agent_profile,
};
use crate::modules::monitor::output_contract::normalize_monitor_output;
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
use crate::modules::providers::store::ProviderStore;
#[cfg(test)]
use crate::modules::providers::store::LOCAL_DESKTOP_USER_ID;
#[cfg(test)]
use crate::modules::providers::types::{ProviderInstance, ProviderModel};

const DEFAULT_MONITOR_POLL_INTERVAL_SECONDS: u64 = 20;
const MIN_MONITOR_POLL_INTERVAL_SECONDS: u64 = 5;
const MAX_MONITOR_POLL_INTERVAL_SECONDS: u64 = 300;
const DEFAULT_MONITOR_PULL_LIMIT: u32 = 5;
const MAX_MONITOR_PULL_LIMIT: u32 = 20;
const SUMMARY_MAX_CHARS: usize = 4_000;

#[derive(Clone)]
pub struct MonitorState {
    shared: Arc<MonitorWorkerShared>,
}

struct MonitorWorkerShared {
    client: reqwest::Client,
    store: Arc<MonitorStore>,
    mcp_store: Option<Arc<crate::modules::mcp::store::McpStore>>,
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

struct MonitorWorkflowContext {
    state: MonitorState,
    task: LocalMonitorTask,
    execution_id: String,
    events: Vec<Value>,
    agent_profile: Option<CustomTaskAgentProfile>,
    executed_model_id: Option<String>,
    prompt: Option<String>,
    content: Option<String>,
    tokens_used: i64,
    is_significant_change: bool,
    change_summary: String,
    new_snapshot: Value,
    strategy_tag: Option<String>,
    observations: Option<Value>,
}

impl MonitorWorkflowContext {
    fn new(state: MonitorState, task: LocalMonitorTask) -> Self {
        Self {
            state,
            task,
            execution_id: Uuid::new_v4().to_string(),
            events: Vec::new(),
            agent_profile: None,
            executed_model_id: None,
            prompt: None,
            content: None,
            tokens_used: 0,
            is_significant_change: false,
            change_summary: String::new(),
            new_snapshot: json!({}),
            strategy_tag: None,
            observations: None,
        }
    }

    fn emit_status(
        &mut self,
        stage: &str,
        step: &str,
        state: &str,
        code: &str,
        meta: Option<Value>,
    ) {
        let payload = json!({
            "type": "status",
            "scope": "monitor",
            "execution_id": self.execution_id,
            "task_id": self.task.id,
            "stage": stage,
            "step": step,
            "state": state,
            "code": code,
            "meta": meta,
        });
        self.events.push(payload.clone());
        log::info!("monitor_status {}", payload.to_string());
    }
}

impl MonitorState {
    pub async fn new(
        database_url: &str,
        _provider_store: Arc<ProviderStore>,
        mcp_store: Option<Arc<crate::modules::mcp::store::McpStore>>,
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
                store,
                mcp_store,
                worker_task: Mutex::new(None),
                tick_lock: Mutex::new(()),
                config: RwLock::new(config),
                runtime: RwLock::new(WorkerRuntime::default()),
            }),
        })
    }

    pub async fn with_pool(
        pool: sqlx::sqlite::SqlitePool,
        _provider_store: Arc<ProviderStore>,
        mcp_store: Option<Arc<crate::modules::mcp::store::McpStore>>,
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
        let store = Arc::new(MonitorStore::with_pool(pool).await?);
        Ok(Self {
            shared: Arc::new(MonitorWorkerShared {
                client,
                store,
                mcp_store,
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
        let mut response = self
            .shared
            .store
            .list_tasks(
                query.skip.unwrap_or(0),
                query.limit.unwrap_or(100),
                query.status.as_deref(),
            )
            .await?;
        let mut items = Vec::with_capacity(response.items.len());
        for task in response.items {
            items.push(self.decorate_task_binding_state(task).await);
        }
        response.items = items;
        Ok(response)
    }

    pub async fn get_task(&self, task_id: String) -> Result<LocalMonitorTask, String> {
        let task = self
            .shared
            .store
            .get_task(task_id.as_str())
            .await?
            .ok_or_else(|| "任务不存在".to_string())?;
        Ok(self.decorate_task_binding_state(task).await)
    }

    pub async fn create_task(
        &self,
        payload: LocalMonitorTaskCreateRequest,
    ) -> Result<LocalMonitorCreateResponse, String> {
        self.ensure_bindable_task_agent(payload.assistant_id.as_str())
            .await?;
        let task = self.shared.store.create_task(payload).await?;
        Ok(LocalMonitorCreateResponse {
            id: task.id,
            title: task.title,
            status: task.status,
            message: "任务创建成功（本地执行）".to_string(),
            analysis_mode: task.analysis_mode,
            assistant_id: task.assistant_id,
            execution_target: task.execution_target,
        })
    }

    pub async fn update_task(
        &self,
        task_id: String,
        payload: LocalMonitorTaskUpdateRequest,
    ) -> Result<LocalMonitorTask, String> {
        if let Some(assistant_id) = payload.assistant_id.as_deref() {
            self.ensure_bindable_task_agent(assistant_id).await?;
        }
        let task = self
            .shared
            .store
            .update_task(task_id.as_str(), payload)
            .await?;
        Ok(self.decorate_task_binding_state(task).await)
    }

    async fn ensure_bindable_task_agent(
        &self,
        assistant_id: &str,
    ) -> Result<CustomTaskAgentProfile, String> {
        let store = self
            .shared
            .mcp_store
            .as_ref()
            .ok_or_else(|| "monitor task agent binding is unavailable".to_string())?;
        let profile = get_custom_task_agent_profile(store.as_ref(), assistant_id)
            .await
            .map_err(|err| err.to_string())?
            .ok_or_else(|| "绑定的任务智能体不存在".to_string())?;
        validate_monitor_task_agent_profile(&profile)?;
        Ok(profile)
    }

    async fn decorate_task_binding_state(&self, mut task: LocalMonitorTask) -> LocalMonitorTask {
        let (binding_state, binding_error, assistant_name) =
            self.evaluate_task_binding_state(&task).await;
        task.display_status =
            derive_monitor_display_status(task.status.as_str(), binding_state.as_str());
        task.binding_state = binding_state;
        task.binding_error = binding_error;
        task.assistant_name = assistant_name;
        task
    }

    async fn evaluate_task_binding_state(
        &self,
        task: &LocalMonitorTask,
    ) -> (String, Option<String>, Option<String>) {
        let Some(assistant_id) = task
            .assistant_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return (
                "binding_required".to_string(),
                Some("请先绑定一个聊天任务智能体".to_string()),
                None,
            );
        };

        match self.ensure_bindable_task_agent(assistant_id).await {
            Ok(profile) => ("ok".to_string(), None, Some(profile.name)),
            Err(err) => ("binding_invalid".to_string(), Some(err), None),
        }
    }

    async fn require_task_binding_ready(&self, task: &LocalMonitorTask) -> Result<(), String> {
        let (binding_state, binding_error, _) = self.evaluate_task_binding_state(task).await;
        if binding_state == "ok" {
            return Ok(());
        }

        let _ = self.shared.store.pause_task(task.id.as_str()).await;
        Err(binding_error.unwrap_or_else(|| "任务绑定状态异常".to_string()))
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
        let current = self
            .shared
            .store
            .get_task(payload.task_id.as_str())
            .await?
            .ok_or_else(|| "任务不存在".to_string())?;
        self.require_task_binding_ready(&current).await?;
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
        let current = self
            .shared
            .store
            .get_task(payload.task_id.as_str())
            .await?
            .ok_or_else(|| "任务不存在".to_string())?;
        self.require_task_binding_ready(&current).await?;
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
        self.require_task_binding_ready(task).await?;
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
        let ctx_task = task.clone();
        let mut ctx = MonitorWorkflowContext::new(self.clone(), ctx_task);
        let engine = build_monitor_engine();
        engine.execute(&mut ctx).await?;

        Ok(LocalExecutionResult {
            is_significant_change: ctx.is_significant_change,
            change_summary: ctx.change_summary,
            new_snapshot: ctx.new_snapshot,
            strategy_tag: ctx.strategy_tag,
            observations: ctx.observations,
            tokens_used: ctx.tokens_used.max(0),
            model_id: ctx.executed_model_id.unwrap_or_default(),
            events: ctx.events,
        })
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
            "wechat" => Err("桌面端微信渠道仅支持聊天式接入，请先完成连接。".to_string()),
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
        let text = format!("{}\n\n{}", title, content);
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
        let text = truncate(
            format!("{}\n\n{}\n\n{}", title, content, payload).as_str(),
            4000,
        );
        for chat_id in &chat_ids {
            client
                .send_message(SendMessageRequest {
                    chat_id: chat_id.clone(),
                    content: MessageContent::Text { text: text.clone() },
                    reply_to: None,
                })
                .await
                .map_err(|err| err.to_string())?;
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

fn derive_monitor_display_status(status: &str, binding_state: &str) -> String {
    match binding_state {
        "binding_required" => "binding_required".to_string(),
        "binding_invalid" => "binding_invalid".to_string(),
        _ => status.to_string(),
    }
}

fn make_default_agent_id() -> String {
    format!("desktop-{}", Uuid::new_v4().simple())
}

fn global_app_state_required() -> Result<crate::state::AppState, String> {
    crate::state::global_app_state().ok_or_else(|| "global app state is unavailable".to_string())
}

fn global_app_handle_required() -> Result<tauri::AppHandle, String> {
    crate::state::global_app_handle().ok_or_else(|| "global app handle is unavailable".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn build_monitor_gateway_log_entry_includes_local_dimensions_and_metrics() {
        let model = crate::modules::providers::types::ProviderModel {
            id: Uuid::parse_str("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").expect("uuid"),
            instance_id: Uuid::parse_str("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").expect("uuid"),
            model_id: "gpt-4o".to_string(),
            unified_model_id: None,
            display_name: None,
            capabilities: vec!["chat".to_string()],
            upstream_path: "v1/chat/completions".to_string(),
            pricing_config: json!({
                "input_per_1k": 0.1,
                "output_per_1k": 0.2
            }),
            limit_config: json!({}),
            tokenizer_config: json!({}),
            routing_config: json!({}),
            config_override: json!({}),
            source: "local".to_string(),
            extra_meta: json!({}),
            weight: 0,
            priority: 0,
            is_active: true,
            synced_at: None,
            created_at: None,
            updated_at: None,
        };
        let instance = crate::modules::providers::types::ProviderInstance {
            id: model.instance_id,
            preset_slug: "openai".to_string(),
            name: "OpenAI".to_string(),
            base_url: "https://example.com".to_string(),
            description: None,
            icon: None,
            priority: 0,
            meta: json!({}),
            is_enabled: true,
            is_local: true,
            credential_source: "local".to_string(),
            credentials_ref: "cred-monitor-1".to_string(),
            updated_at: "2026-03-12T00:00:00Z".to_string(),
            created_at: "2026-03-12T00:00:00Z".to_string(),
        };
        let headers =
            std::collections::BTreeMap::from([("x-cache".to_string(), "HIT".to_string())]);
        let response = json!({
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 34,
                "total_tokens": 46
            },
            "metrics": {
                "ttft_ms": 78
            },
            "billing": {
                "amount": 0.0099
            }
        });

        let entry = build_monitor_gateway_log_entry(
            &model,
            &instance,
            "https://example.com/v1/chat/completions",
            reqwest::StatusCode::OK,
            345,
            &headers,
            &response,
        );

        assert_eq!(entry.api_key_id.as_deref(), Some("cred-monitor-1"));
        assert_eq!(entry.preset_id.as_deref(), Some("openai"));
        assert_eq!(entry.input_tokens, 12);
        assert_eq!(entry.output_tokens, 34);
        assert_eq!(entry.total_tokens, 46);
        assert_eq!(entry.ttft_ms, Some(78));
        assert!(entry.is_cached);
        assert_eq!(entry.cost_upstream, 0.008);
        assert_eq!(entry.cost_user, 0.0099);
        assert!(entry.error_code.is_none());
    }

    #[test]
    fn supported_notification_channels_include_wechat() {
        assert!(is_supported_notification_channel("wechat"));
    }

    #[tokio::test]
    async fn test_notification_channel_rejects_wechat_until_connection_exists() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory sqlite pool");
        let provider_store = Arc::new(
            ProviderStore::new("sqlite::memory:")
                .await
                .expect("provider store"),
        );
        let state = MonitorState::with_pool(pool, provider_store, None)
            .await
            .expect("monitor state");

        let response = state
            .test_notification_channel(LocalNotificationChannelTestRequest {
                channel: "wechat".to_string(),
                config: json!({
                    "im_enabled": true
                }),
            })
            .await
            .expect("wechat test should return structured failure");

        assert!(!response.success);
        assert_eq!(response.channel, "wechat");
        assert_eq!(
            response.message.as_deref(),
            Some("桌面端微信渠道仅支持聊天式接入，请先完成连接。")
        );
    }
}

struct MonitorResolveTaskAgentStep;

impl LocalWorkflowStep<MonitorWorkflowContext> for MonitorResolveTaskAgentStep {
    fn name(&self) -> &'static str {
        "monitor_resolve_task_agent"
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut MonitorWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            ctx.emit_status(
                "remember",
                "monitor_resolve_task_agent",
                "running",
                "monitor.agent.resolving",
                None,
            );
            let assistant_id = ctx
                .task
                .assistant_id
                .as_deref()
                .ok_or_else(|| "monitor task agent binding is required".to_string())?;
            let profile = ctx.state.ensure_bindable_task_agent(assistant_id).await?;
            ctx.agent_profile = Some(profile.clone());
            ctx.emit_status(
                "remember",
                "monitor_resolve_task_agent",
                "success",
                "monitor.agent.resolved",
                Some(json!({
                    "assistant_id": profile.id,
                    "assistant_name": profile.name,
                })),
            );
            Ok(())
        })
    }
}

struct MonitorBuildPromptStep;

impl LocalWorkflowStep<MonitorWorkflowContext> for MonitorBuildPromptStep {
    fn name(&self) -> &'static str {
        "monitor_build_prompt"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["monitor_resolve_task_agent"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut MonitorWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            ctx.emit_status(
                "evolve",
                "monitor_build_prompt",
                "running",
                "monitor.prompt.building",
                None,
            );
            let prompt = build_monitor_task_agent_message(&ctx.task);
            ctx.prompt = Some(prompt);
            ctx.emit_status(
                "evolve",
                "monitor_build_prompt",
                "success",
                "monitor.prompt.built",
                None,
            );
            Ok(())
        })
    }
}

struct MonitorInvokeTaskAgentStep;

impl LocalWorkflowStep<MonitorWorkflowContext> for MonitorInvokeTaskAgentStep {
    fn name(&self) -> &'static str {
        "monitor_execute_task_agent"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["monitor_build_prompt"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut MonitorWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let app_handle = global_app_handle_required()?;
            let profile = ctx
                .agent_profile
                .clone()
                .ok_or_else(|| "monitor task agent missing".to_string())?;
            let app_state = global_app_state_required()?;
            let prompt = ctx
                .prompt
                .clone()
                .ok_or_else(|| "monitor prompt missing".to_string())?;

            ctx.emit_status(
                "evolve",
                "monitor_execute_task_agent",
                "running",
                "monitor.agent.executing",
                Some(json!({
                    "assistant_id": profile.id.clone(),
                    "assistant_name": profile.name.clone(),
                })),
            );

            let response = execute_monitor_task_agent(&app_handle, &app_state, &profile, &prompt)
                .await
                .map_err(|err| {
                    let error_message = err.clone();
                    ctx.emit_status(
                        "evolve",
                        "monitor_execute_task_agent",
                        "failed",
                        "monitor.agent.error",
                        Some(json!({
                            "message": error_message,
                        })),
                    );
                    err.to_string()
                })?;

            let content = response.content;
            if content.trim().is_empty() {
                ctx.emit_status(
                    "render",
                    "monitor_execute_task_agent",
                    "failed",
                    "monitor.response.empty",
                    None,
                );
                return Err("模型返回内容为空".to_string());
            }
            let tokens = response.tokens_used;
            ctx.content = Some(content);
            ctx.tokens_used = tokens;
            ctx.executed_model_id = Some(response.model_id.clone());
            ctx.emit_status(
                "render",
                "monitor_execute_task_agent",
                "success",
                "monitor.response.received",
                Some(json!({
                    "assistant_id": profile.id,
                    "model_id": response.model_id.clone(),
                    "tokens_used": tokens,
                    "tool_trace_len": response.tool_trace.len(),
                })),
            );
            Ok(())
        })
    }
}

struct MonitorParseResultStep;

impl LocalWorkflowStep<MonitorWorkflowContext> for MonitorParseResultStep {
    fn name(&self) -> &'static str {
        "monitor_parse_result"
    }

    fn depends_on(&self) -> &'static [&'static str] {
        &["monitor_execute_task_agent"]
    }

    fn execute<'a>(
        &'a self,
        ctx: &'a mut MonitorWorkflowContext,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let content = ctx
                .content
                .as_ref()
                .ok_or_else(|| "monitor content missing".to_string())?;
            let result = normalize_monitor_output(content);
            ctx.is_significant_change = result.is_significant_change;
            ctx.change_summary = result.change_summary;
            ctx.new_snapshot = result.new_snapshot;
            ctx.strategy_tag = result.strategy_tag.clone();
            ctx.observations = result.observations.clone();
            ctx.emit_status(
                "render",
                "monitor_parse_result",
                "success",
                "monitor.analysis.done",
                Some(json!({
                    "is_significant_change": ctx.is_significant_change,
                    "strategy_tag": result.strategy_tag,
                })),
            );
            ctx.events.push(json!({
                "type": "monitor.policy.result",
                "strategy_tag": result.strategy_tag,
                "observations": result.observations,
            }));
            Ok(())
        })
    }
}

fn build_monitor_engine() -> LocalOrchestrationEngine<MonitorWorkflowContext> {
    LocalOrchestrationEngine::new(vec![
        Box::new(MonitorResolveTaskAgentStep),
        Box::new(MonitorBuildPromptStep),
        Box::new(MonitorInvokeTaskAgentStep),
        Box::new(MonitorParseResultStep),
    ])
    .expect("monitor engine dag should be valid")
}

#[cfg(test)]
fn build_monitor_gateway_log_entry(
    model: &ProviderModel,
    instance: &ProviderInstance,
    endpoint: &str,
    status: reqwest::StatusCode,
    duration_ms: i64,
    response_headers: &std::collections::BTreeMap<String, String>,
    body_json: &Value,
) -> crate::modules::ai_upstream::gateway_log_recorder::GatewayLogEntry {
    let (input_tokens, output_tokens, total_tokens) =
        crate::modules::ai_upstream::gateway_log_recorder::extract_usage_from_response(body_json);
    let cost_upstream = crate::modules::ai_upstream::gateway_log_recorder::calculate_token_cost(
        &model.pricing_config,
        input_tokens,
        output_tokens,
    )
    .unwrap_or(0.0);
    let cost_user =
        crate::modules::ai_upstream::gateway_log_recorder::extract_billing_amount_from_response(
            body_json,
        )
        .unwrap_or(cost_upstream);
    let error_code =
        crate::modules::ai_upstream::gateway_log_recorder::extract_error_code_from_response(Some(
            body_json,
        ))
        .or_else(|| (!status.is_success()).then_some(format!("UPSTREAM_{}", status.as_u16())));

    crate::modules::ai_upstream::gateway_log_recorder::GatewayLogEntry {
        user_id: Some(LOCAL_DESKTOP_USER_ID.to_string()),
        api_key_id: Some(instance.credentials_ref.trim().to_string())
            .filter(|value| !value.is_empty()),
        preset_id: Some(instance.preset_slug.trim().to_string()).filter(|value| !value.is_empty()),
        model: model.model_id.clone(),
        status_code: status.as_u16() as i64,
        duration_ms: duration_ms.max(0),
        ttft_ms: crate::modules::ai_upstream::gateway_log_recorder::extract_ttft_ms_from_response(
            body_json,
        ),
        upstream_url: Some(endpoint.to_string()),
        retry_count: 0,
        input_tokens,
        output_tokens,
        total_tokens,
        cost_upstream,
        cost_user,
        is_cached:
            crate::modules::ai_upstream::gateway_log_recorder::extract_cache_hit_from_response(
                response_headers,
                Some(body_json),
            ),
        error_code,
        ..Default::default()
    }
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

fn is_supported_notification_channel(value: &str) -> bool {
    matches!(
        value,
        "feishu" | "wechat" | "dingtalk" | "telegram" | "email" | "webhook"
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
