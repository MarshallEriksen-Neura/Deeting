pub mod agent_runtime;
pub mod commands;
mod delivery;
pub mod output_contract;
mod run_events;
pub mod store;
pub mod types;
mod workflow;

use std::sync::Arc;
use std::time::Duration;

use log::warn;
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::modules::custom_task_agents::store::get_custom_task_agent as get_custom_task_agent_profile;
use crate::modules::custom_task_agents::types::CustomTaskAgentProfile;
use crate::modules::monitor::agent_runtime::{
    effective_monitor_tool_names, validate_monitor_task_agent_profile,
};
use crate::modules::monitor::store::MonitorStore;
use crate::modules::monitor::types::{
    monitor_delivery_policy_from_notify_config, LocalMonitorActionResponse,
    LocalMonitorCreateResponse, LocalMonitorExecutionLogListResponse, LocalMonitorListQuery,
    LocalMonitorLogsQuery, LocalMonitorStatsResponse, LocalMonitorTask,
    LocalMonitorTaskCreateRequest, LocalMonitorTaskIdRequest, LocalMonitorTaskListResponse,
    LocalMonitorTaskUpdateRequest, LocalMonitorTriggerResponse, LocalNotificationChannel,
    LocalNotificationChannelCreateRequest, LocalNotificationChannelCreateResponse,
    LocalNotificationChannelDeleteResponse, LocalNotificationChannelListResponse,
    LocalNotificationChannelTestRequest, LocalNotificationChannelTestResponse,
    LocalNotificationChannelUpdateRequest, LocalNotificationChannelUpdateResponse,
    MonitorWorkerStartRequest, MonitorWorkerStatus,
};
use crate::modules::providers::store::ProviderStore;
#[cfg(test)]
use crate::modules::providers::store::LOCAL_DESKTOP_USER_ID;
#[cfg(test)]
use crate::modules::providers::types::{ProviderInstance, ProviderModel};
use delivery::is_supported_notification_channel;
#[cfg(test)]
use delivery::render_channel_notification_text;
use run_events::{build_delivery_failed_event, should_notify_run};
#[cfg(test)]
use run_events::{build_run_terminal_event, project_tool_trace_run_events};
#[cfg(test)]
use workflow::MonitorWorkflowContext;

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
    wechat_state: RwLock<Option<Arc<crate::modules::im::wechat::WechatState>>>,
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
                wechat_state: RwLock::new(None),
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
                wechat_state: RwLock::new(None),
                worker_task: Mutex::new(None),
                tick_lock: Mutex::new(()),
                config: RwLock::new(config),
                runtime: RwLock::new(WorkerRuntime::default()),
            }),
        })
    }

    pub async fn with_pools(
        pool: sqlx::sqlite::SqlitePool,
        write_pool: sqlx::sqlite::SqlitePool,
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
        let store = Arc::new(MonitorStore::with_pools(pool, write_pool).await?);
        Ok(Self {
            shared: Arc::new(MonitorWorkerShared {
                client,
                store,
                mcp_store,
                wechat_state: RwLock::new(None),
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

    pub async fn attach_wechat_state(
        &self,
        wechat_state: Arc<crate::modules::im::wechat::WechatState>,
    ) {
        *self.shared.wechat_state.write().await = Some(wechat_state);
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
        mut payload: LocalMonitorTaskCreateRequest,
    ) -> Result<LocalMonitorCreateResponse, String> {
        let profile = self
            .ensure_bindable_task_agent(payload.assistant_id.as_str())
            .await?;
        payload.allowed_tools = Some(materialize_monitor_allowed_tools(
            &profile,
            payload.allowed_tools.take(),
        ));
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
        mut payload: LocalMonitorTaskUpdateRequest,
    ) -> Result<LocalMonitorTask, String> {
        let current = self
            .shared
            .store
            .get_task(task_id.as_str())
            .await?
            .ok_or_else(|| "任务不存在".to_string())?;
        if let Some(assistant_id) = payload.assistant_id.as_deref() {
            let profile = self.ensure_bindable_task_agent(assistant_id).await?;
            if payload.allowed_tools.is_none() {
                payload.allowed_tools = Some(materialize_monitor_allowed_tools(&profile, None));
            }
        } else if payload.allowed_tools.is_none() && current.allowed_tools.is_empty() {
            if let Some(assistant_id) = current.assistant_id.as_deref() {
                let profile = self.ensure_bindable_task_agent(assistant_id).await?;
                payload.allowed_tools = Some(materialize_monitor_allowed_tools(&profile, None));
            }
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

    pub async fn list_delivery_states(
        &self,
        task_id: String,
    ) -> Result<crate::modules::monitor::types::LocalMonitorDeliveryStateListResponse, String> {
        self.shared
            .store
            .list_delivery_states(task_id.as_str())
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
            .await?;
        // Slice 2 evolution-signal emission. Additive — failures here never
        // affect the monitor feedback row stored above. classification is a
        // placeholder heuristic (>0.5 accepted, <0 rejected, else neutral);
        // calibration is deferred to Slice 4. Monitor signals MUST NOT
        // influence task_policy_priors — this row only lands in
        // evolution_signals for inspection.
        if let Some(mcp_store) = self.shared.mcp_store.as_ref() {
            use crate::modules::desktop_runtime::runtime::evolution::{
                submit_evolution_signal, EvolutionSignalClassification, EvolutionSignalDraft,
                EvolutionSignalSource,
            };
            let classification = if score > 0.5 {
                EvolutionSignalClassification::Accepted
            } else if score < 0.0 {
                EvolutionSignalClassification::Rejected
            } else {
                EvolutionSignalClassification::Neutral
            };
            let draft = EvolutionSignalDraft {
                source: EvolutionSignalSource::MonitorFeedback,
                classification,
                session_id: None,
                trace_id: None,
                run_id: None,
                monitor_task_id: Some(task_id.clone()),
                monitor_log_id: Some(log_id.clone()),
                fingerprint_key: None,
                confidence: score.abs().clamp(0.0, 1.0),
                payload_json: serde_json::json!({
                    "score": score,
                    "monitor_task_id": task_id,
                    "monitor_log_id": log_id,
                }),
                note: None,
            };
            if let Err(err) = submit_evolution_signal(mcp_store.as_ref(), draft).await {
                log::warn!(
                    "monitor feedback evolution signal submission failed task_id={} log_id={} err={}",
                    task_id,
                    log_id,
                    err
                );
            }
        }
        Ok(())
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
            Ok(mut result) => {
                let delivery_policy =
                    monitor_delivery_policy_from_notify_config(&task.notify_config);
                if should_notify_run(&delivery_policy, Some(&result), None, false) {
                    if let Err(err) = self
                        .dispatch_run_notification(task, &result, &delivery_policy)
                        .await
                    {
                        let next_seq = (result.events.len() as u32) + 1;
                        result.events.push(build_delivery_failed_event(
                            result
                                .events
                                .first()
                                .and_then(|event| event.get("execution_id"))
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                            task.id.as_str(),
                            next_seq,
                            err.as_str(),
                        ));
                        warn!(
                            "monitor_local_notification_failed task_id={} err={}",
                            task.id, err
                        );
                    }
                }

                self.shared
                    .store
                    .record_execution_success(task, &result)
                    .await
                    .map_err(|err| format!("record_success_failed: {}", err))?;
                Ok(())
            }
            Err(err) => {
                self.shared
                    .store
                    .record_execution_failure(task, &err.message, Some(err.events.clone()))
                    .await
                    .map_err(|report_err| {
                        format!(
                            "record_failure_failed: {} (origin: {})",
                            report_err, err.message
                        )
                    })?;

                let delivery_policy =
                    monitor_delivery_policy_from_notify_config(&task.notify_config);
                if let Some(updated) =
                    self.shared
                        .store
                        .get_task(task.id.as_str())
                        .await
                        .map_err(|query_err| {
                            format!("query_task_after_failure_failed: {}", query_err)
                        })?
                {
                    if should_notify_run(&delivery_policy, None, Some(err.message.as_str()), false)
                    {
                        let notify_result = if updated.status == "failed_suspended" {
                            self.dispatch_suspended_notification(
                                &updated,
                                err.message.as_str(),
                                &err.events,
                                &delivery_policy,
                            )
                            .await
                        } else {
                            self.dispatch_failed_notification(
                                &updated,
                                err.message.as_str(),
                                &err.events,
                                &delivery_policy,
                            )
                            .await
                        };
                        if let Err(notify_err) = notify_result {
                            warn!(
                                "monitor_local_failure_notification_failed task_id={} err={}",
                                updated.id, notify_err
                            );
                        }
                    }
                }
                Ok(())
            }
        }
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

fn materialize_monitor_allowed_tools(
    profile: &CustomTaskAgentProfile,
    requested_allowed_tools: Option<Vec<String>>,
) -> Vec<String> {
    match requested_allowed_tools {
        Some(values) if values.iter().any(|value| !value.trim().is_empty()) => values,
        _ => effective_monitor_tool_names(profile, &[]),
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
    use crate::modules::monitor::types::{
        monitor_delivery_policy_from_notify_config, LocalExecutionResult,
        MonitorDeliveryDetailLevel, MonitorRunEventKind,
    };
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

    #[test]
    fn materialize_monitor_allowed_tools_defaults_to_explicit_profile_snapshot() {
        let profile = CustomTaskAgentProfile {
            id: "agent-1".to_string(),
            name: "Agent".to_string(),
            description: None,
            task_prompt: "watch".to_string(),
            invocation_kind:
                crate::modules::custom_task_agents::types::CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: vec!["tool.search".to_string()],
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: vec![
                crate::modules::custom_task_agents::types::CustomTaskAgentSkillActionRef {
                    skill_id: "system/monitor".to_string(),
                    action_id: "sys_create_monitor".to_string(),
                },
            ],
            bound_asset_id: None,
            tags: Vec::new(),
            discoverable: true,
            is_enabled: true,
            is_deleted: false,
            source_kind: None,
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "2026-03-28T00:00:00Z".to_string(),
            updated_at: "2026-03-28T00:00:00Z".to_string(),
        };

        let materialized = materialize_monitor_allowed_tools(&profile, None);
        assert_eq!(
            materialized,
            vec![
                "skill_action__system-monitor__sys_create_monitor".to_string(),
                "tool.search".to_string(),
            ]
        );
    }

    #[test]
    fn emit_status_should_project_canonical_stage_event_shape() {
        let state =
            MonitorState {
                shared: Arc::new(MonitorWorkerShared {
                    client: reqwest::Client::new(),
                    store: Arc::new(tokio::runtime::Runtime::new().expect("runtime").block_on(
                        async {
                            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                                .max_connections(1)
                                .connect("sqlite::memory:")
                                .await
                                .expect("memory sqlite pool");
                            MonitorStore::with_pool(pool).await.expect("monitor store")
                        },
                    )),
                    mcp_store: None,
                    wechat_state: RwLock::new(None),
                    worker_task: Mutex::new(None),
                    tick_lock: Mutex::new(()),
                    config: RwLock::new(WorkerConfig {
                        agent_id: "agent".to_string(),
                        poll_interval_seconds: DEFAULT_MONITOR_POLL_INTERVAL_SECONDS,
                        pull_limit: DEFAULT_MONITOR_PULL_LIMIT,
                    }),
                    runtime: RwLock::new(WorkerRuntime::default()),
                }),
            };
        let task = LocalMonitorTask {
            id: "task-1".to_string(),
            user_id: "user-1".to_string(),
            title: "Monitor".to_string(),
            objective: "Watch".to_string(),
            cron_expr: "0 */6 * * *".to_string(),
            status: "active".to_string(),
            last_snapshot: None,
            last_executed_at: None,
            next_run_at: None,
            current_interval_minutes: Some(360),
            display_status: "active".to_string(),
            strategy_variants: None,
            analysis_mode: "concise".to_string(),
            policy_state: json!({}),
            binding_state: "ok".to_string(),
            binding_error: None,
            assistant_id: Some("agent-1".to_string()),
            assistant_name: Some("Agent".to_string()),
            model_id: None,
            error_count: 0,
            notify_config: json!({}),
            allowed_tools: Vec::new(),
            execution_target: "desktop".to_string(),
            total_tokens: 0,
            is_active: true,
            created_at: "2026-03-28T00:00:00Z".to_string(),
            updated_at: "2026-03-28T00:00:00Z".to_string(),
        };
        let mut ctx = MonitorWorkflowContext::new(state, task);

        ctx.emit_status(
            "remember",
            "monitor_resolve_task_agent",
            "running",
            "monitor.agent.resolving",
            None,
        );

        let first = ctx.events.first().expect("event");
        assert_eq!(
            first.get("kind").and_then(Value::as_str),
            Some("stage_changed")
        );
        assert_eq!(first.get("seq").and_then(Value::as_u64), Some(1));
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
            Some("桌面端微信渠道尚未初始化。")
        );
    }

    #[tokio::test]
    async fn test_notification_channel_rejects_wechat_without_notify_targets() {
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
        let monitor = MonitorState::with_pool(pool.clone(), provider_store, None)
            .await
            .expect("monitor state");
        let wechat_state =
            crate::modules::im::wechat::WechatState::with_pool(pool, "sqlite::memory:")
                .await
                .expect("wechat state");
        monitor
            .attach_wechat_state(Arc::new(wechat_state.clone()))
            .await;
        wechat_state
            .save_account(&crate::modules::im::wechat::types::StoredWechatAccount {
                token: "token-1".to_string(),
                base_url: "https://ilinkai.weixin.qq.com".to_string(),
                user_id: Some("wx-user-1".to_string()),
                account_id: Some("bot-1".to_string()),
                cursor: String::new(),
                saved_at: "2026-03-26T00:00:00Z".to_string(),
                context_tokens_by_contact: std::collections::HashMap::new(),
            })
            .await
            .expect("save account");

        let response = monitor
            .test_notification_channel(LocalNotificationChannelTestRequest {
                channel: "wechat".to_string(),
                config: json!({
                    "im_enabled": true
                }),
            })
            .await
            .expect("wechat test should return structured failure");

        assert!(!response.success);
        assert_eq!(
            response.message.as_deref(),
            Some("请先配置微信主动通知目标联系人。")
        );
    }

    #[test]
    fn project_tool_trace_events_emits_called_and_terminal_events() {
        let mut events = Vec::new();
        let next_seq = project_tool_trace_run_events(
            &mut events,
            "execution-1",
            "task-1",
            3,
            &[
                json!({
                    "id": "call-1",
                    "name": "search_sdk",
                    "status": "success",
                    "result": {"items": 2}
                }),
                json!({
                    "id": "call-2",
                    "name": "fetch_url",
                    "status": "error",
                    "error": "timeout"
                }),
            ],
        );

        assert_eq!(next_seq, 7);
        assert_eq!(events.len(), 4);
        assert_eq!(
            events[0].get("kind").and_then(Value::as_str),
            Some("tool_called")
        );
        assert_eq!(
            events[1].get("kind").and_then(Value::as_str),
            Some("tool_succeeded")
        );
        assert_eq!(
            events[2].get("kind").and_then(Value::as_str),
            Some("tool_called")
        );
        assert_eq!(
            events[3].get("kind").and_then(Value::as_str),
            Some("tool_failed")
        );
    }

    #[test]
    fn should_notify_run_defaults_to_change_or_failure_only() {
        let default_policy = monitor_delivery_policy_from_notify_config(&json!({}));

        let changed = LocalExecutionResult {
            execution_id: "exec-changed".to_string(),
            is_significant_change: true,
            change_summary: "changed".to_string(),
            new_snapshot: json!({}),
            strategy_tag: None,
            observations: None,
            tokens_used: 0,
            model_id: "gpt-4o".to_string(),
            events: vec![],
        };
        let unchanged = LocalExecutionResult {
            execution_id: "exec-unchanged".to_string(),
            is_significant_change: false,
            change_summary: "same".to_string(),
            new_snapshot: json!({}),
            strategy_tag: None,
            observations: None,
            tokens_used: 0,
            model_id: "gpt-4o".to_string(),
            events: vec![],
        };

        assert!(should_notify_run(
            &default_policy,
            Some(&changed),
            None,
            false
        ));
        assert!(!should_notify_run(
            &default_policy,
            Some(&unchanged),
            None,
            false
        ));
        assert!(should_notify_run(
            &default_policy,
            None,
            Some("failure"),
            false
        ));
    }

    #[test]
    fn build_run_terminal_event_uses_canonical_kind_names() {
        let event = build_run_terminal_event(
            "execution-1",
            "task-1",
            4,
            MonitorRunEventKind::RunCompleted,
            Some("done".to_string()),
            Some(json!({"detail_level": MonitorDeliveryDetailLevel::Stage})),
        );

        assert_eq!(
            event.get("kind").and_then(Value::as_str),
            Some("run_completed")
        );
        assert_eq!(event.get("summary").and_then(Value::as_str), Some("done"));
    }

    #[test]
    fn render_feishu_notification_text_includes_stage_lines_and_metrics() {
        let rendered = render_channel_notification_text(
            "feishu",
            "🔔 寻猎运行: 任务一",
            "### 研判结论\n发现显著变化。",
            &json!({
                "tokens_used": 88,
                "model_id": "gpt-4o",
                "delivery_policy": {
                    "detail_level": "stage"
                },
                "events": [
                    {
                        "kind": "run_started",
                        "summary": "monitor run started"
                    },
                    {
                        "kind": "stage_changed",
                        "summary": "monitor analysis done"
                    },
                    {
                        "kind": "run_completed",
                        "summary": "monitor run completed"
                    }
                ]
            }),
        );

        assert!(rendered.contains("阶段记录"));
        assert!(rendered.contains("monitor analysis done"));
        assert!(rendered.contains("模型: gpt-4o"));
        assert!(rendered.contains("Tokens: 88"));
    }

    #[test]
    fn render_wechat_notification_text_stays_compact_without_tool_noise() {
        let rendered = render_channel_notification_text(
            "wechat",
            "🔔 寻猎运行: 任务一",
            "### 研判结论\n发现显著变化。",
            &json!({
                "delivery_policy": {
                    "detail_level": "detailed"
                },
                "events": [
                    {
                        "kind": "tool_called",
                        "summary": "调用工具 search_sdk"
                    },
                    {
                        "kind": "tool_succeeded",
                        "summary": "工具 search_sdk 执行成功"
                    },
                    {
                        "kind": "run_completed",
                        "summary": "monitor run completed"
                    }
                ]
            }),
        );

        assert!(rendered.contains("monitor run completed"));
        assert!(!rendered.contains("search_sdk"));
    }
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
