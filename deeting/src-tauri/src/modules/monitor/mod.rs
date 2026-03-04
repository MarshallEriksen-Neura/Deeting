pub mod commands;
pub mod types;

use std::cmp::Ordering;
use std::sync::Arc;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::modules::monitor::types::{
    MonitorLocalPullResponse, MonitorLocalTaskPayload, MonitorWorkerStartRequest,
    MonitorWorkerStatus,
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
    cloud_base_url: Arc<RwLock<String>>,
    worker_task: Mutex<Option<JoinHandle<()>>>,
    config: RwLock<WorkerConfig>,
    runtime: RwLock<WorkerRuntime>,
}

#[derive(Debug, Clone)]
struct WorkerConfig {
    access_token: String,
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

#[derive(Debug, Clone)]
struct LocalExecutionResult {
    is_significant_change: bool,
    change_summary: String,
    new_snapshot: Value,
    tokens_used: i64,
    model_id: String,
}

impl MonitorState {
    pub fn new(cloud_base_url: Arc<RwLock<String>>, provider_store: Arc<ProviderStore>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let config = WorkerConfig {
            access_token: String::new(),
            agent_id: make_default_agent_id(),
            poll_interval_seconds: DEFAULT_MONITOR_POLL_INTERVAL_SECONDS,
            pull_limit: DEFAULT_MONITOR_PULL_LIMIT,
        };
        Self {
            shared: Arc::new(MonitorWorkerShared {
                client,
                provider_store,
                cloud_base_url,
                worker_task: Mutex::new(None),
                config: RwLock::new(config),
                runtime: RwLock::new(WorkerRuntime::default()),
            }),
        }
    }

    pub async fn start_worker(
        &self,
        payload: MonitorWorkerStartRequest,
    ) -> Result<MonitorWorkerStatus, String> {
        let token = payload.access_token.trim().to_string();
        if token.is_empty() {
            return Err("access_token 不能为空".to_string());
        }

        {
            let mut config = self.shared.config.write().await;
            config.access_token = token;
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
        {
            let mut config = self.shared.config.write().await;
            config.access_token.clear();
        }
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
        let config = self.shared.config.read().await.clone();
        if config.access_token.trim().is_empty() {
            return Err("monitor worker 缺少 access_token".to_string());
        }

        let base_url = {
            let raw = self.shared.cloud_base_url.read().await;
            raw.trim().trim_end_matches('/').to_string()
        };
        if base_url.is_empty() {
            return Err("monitor worker 缺少 cloud base url".to_string());
        }

        let heartbeat_url = build_cloud_url(&base_url, "/api/v1/monitors/local/heartbeat");
        let heartbeat_body = json!({ "agent_id": config.agent_id });
        let _: Value = self
            .post_json(&heartbeat_url, &config.access_token, heartbeat_body)
            .await?;

        let pull_url = build_cloud_url(&base_url, "/api/v1/monitors/local/pull");
        let pull_body = json!({
            "agent_id": config.agent_id,
            "limit": config.pull_limit,
        });
        let pull_resp: MonitorLocalPullResponse = self
            .post_json(&pull_url, &config.access_token, pull_body)
            .await?;

        let mut task_errors = Vec::new();
        for task in &pull_resp.items {
            if let Err(err) = self.process_single_task(&base_url, &config, task).await {
                task_errors.push(format!("task={} err={}", task.task_id, err));
            }
        }

        {
            let mut runtime = self.shared.runtime.write().await;
            runtime.last_tick_at = Some(now_rfc3339());
            runtime.last_claimed = pull_resp.claimed.max(0);
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

    async fn process_single_task(
        &self,
        base_url: &str,
        config: &WorkerConfig,
        task: &MonitorLocalTaskPayload,
    ) -> Result<(), String> {
        match self.execute_task_local(task).await {
            Ok(result) => self
                .report_success(base_url, config, task, result)
                .await
                .map_err(|err| format!("report_success_failed: {}", err)),
            Err(err) => self
                .report_failure(base_url, config, task, &err)
                .await
                .map_err(|report_err| {
                    format!("report_failure_failed: {} (origin: {})", report_err, err)
                }),
        }
    }

    async fn execute_task_local(
        &self,
        task: &MonitorLocalTaskPayload,
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
        task: &MonitorLocalTaskPayload,
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
            .get_instance_connection(&selected.instance_id)
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

    async fn report_success(
        &self,
        base_url: &str,
        config: &WorkerConfig,
        task: &MonitorLocalTaskPayload,
        result: LocalExecutionResult,
    ) -> Result<(), String> {
        let url = build_cloud_url(
            base_url,
            &format!("/api/v1/monitors/local/{}/report", task.task_id),
        );
        let body = json!({
            "agent_id": config.agent_id,
            "status": "success",
            "is_significant_change": result.is_significant_change,
            "change_summary": result.change_summary,
            "new_snapshot": result.new_snapshot,
            "tokens_used": result.tokens_used,
            "force_notify": false,
            "model_id": result.model_id,
            "strategy": "desktop_local_worker",
        });
        let _: Value = self.post_json(&url, &config.access_token, body).await?;
        Ok(())
    }

    async fn report_failure(
        &self,
        base_url: &str,
        config: &WorkerConfig,
        task: &MonitorLocalTaskPayload,
        error_message: &str,
    ) -> Result<(), String> {
        let url = build_cloud_url(
            base_url,
            &format!("/api/v1/monitors/local/{}/report", task.task_id),
        );
        let body = json!({
            "agent_id": config.agent_id,
            "status": "failure",
            "is_significant_change": false,
            "change_summary": "",
            "new_snapshot": {},
            "tokens_used": 0,
            "error_message": truncate(error_message, 1900),
            "force_notify": false,
            "model_id": task.model_id.clone().unwrap_or_default(),
            "strategy": "desktop_local_worker",
        });
        let _: Value = self.post_json(&url, &config.access_token, body).await?;
        Ok(())
    }

    async fn post_json<T: DeserializeOwned>(
        &self,
        url: &str,
        access_token: &str,
        body: Value,
    ) -> Result<T, String> {
        let response = self
            .shared
            .client
            .post(url)
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await
            .map_err(|err| format!("请求失败: {}", err))?;

        let status = response.status();
        let raw_text = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("failed to read response body"));
        if !status.is_success() {
            let detail = truncate(&raw_text, 400);
            return Err(format!("http {}: {}", status.as_u16(), detail));
        }
        serde_json::from_str::<T>(&raw_text)
            .map_err(|err| format!("解析响应失败: {} body={}", err, truncate(&raw_text, 300)))
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

fn build_cloud_url(base_url: &str, path: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let route = path.trim().trim_start_matches('/');
    format!("{base}/{route}")
}

fn build_upstream_endpoint(base_url: &str, upstream_path: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let path = upstream_path.trim().trim_start_matches('/').to_string();
    if path.is_empty() {
        if base.ends_with("/v1") {
            return format!("{base}/chat/completions");
        }
        return format!("{base}/v1/chat/completions");
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

fn build_monitor_prompt(task: &MonitorLocalTaskPayload) -> String {
    let snapshot = if task.last_snapshot.is_object() {
        task.last_snapshot.to_string()
    } else {
        "{}".to_string()
    };
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
