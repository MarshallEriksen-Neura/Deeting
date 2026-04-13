use super::super::support::*;
use super::remote_transport::{call_local_stdio_tool, call_remote_sse_tool};
use super::tool_resolution::resolve_callable_mcp_tool_by_ref;
use crate::modules::asset_registry::service::save_local_asset;
use crate::modules::asset_registry::types::SaveLocalAssetRequest;
use crate::modules::desktop_config::{
    parse_approval_policy_level, DesktopApprovalPolicyLevel, APPROVAL_POLICY_LEVEL_CONFIG_KEY,
};
use crate::modules::execution::core_tool::ShellExecuteCoreTool;
use crate::modules::execution::ExecutionRequest;
use crate::modules::mcp::policy::{
    assess_policy_risk, calculate_medium_rule_confidence, resolve_approval_decision,
    should_auto_promote_medium_rule, ApprovalDecision, ApprovalPolicyLevel,
    PersistedApprovalAction, PolicyTargetRef,
};
use crate::modules::skill_runtime::{
    execute_local_mcp_tool, execute_skill_binding, resolve_local_tool_env,
    resolve_skill_binding_by_ref, skill_binding_fingerprint,
};
use futures_util::FutureExt;
use mcp_storage::types::LocalSkillToolBindingSnapshot;
use std::{any::Any, future::Future, panic::AssertUnwindSafe, time::Duration};

const DEFAULT_MCP_TOOL_TIMEOUT_SECS: u64 = 180;

fn normalized_approval_status(value: Option<&str>) -> &str {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("waiting_approval")
}

async fn update_pending_approval_status(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
    status: &str,
) -> Result<crate::modules::mcp::PendingToolCall, String> {
    let mut pending_tool_calls = pending_tool_calls.write().await;
    let Some(pending) = pending_tool_calls.get_mut(approval_token) else {
        return Err("pending tool call not found".to_string());
    };
    pending.approval_status = Some(status.to_string());
    Ok(pending.clone())
}

async fn remove_pending_approval_entry(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<crate::modules::mcp::PendingToolCall, String> {
    pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .ok_or_else(|| "pending tool call already consumed".to_string())
}

fn is_stdio_invocation_error(error: &str) -> bool {
    let normalized = error.trim().to_ascii_lowercase();
    normalized.contains("-32602")
        || normalized.contains("invalid params")
        || normalized.contains("invalid parameter")
        || normalized.contains("parameter validation failed")
        || normalized.contains("schema validation failed")
}

fn stdio_status_for_execution_error(error: &str) -> mcp_core::types::McpToolStatus {
    if is_stdio_invocation_error(error) {
        mcp_core::types::McpToolStatus::Healthy
    } else {
        mcp_core::types::McpToolStatus::Error
    }
}

fn resolve_mcp_tool_execution_timeout(tool: &McpTool) -> Duration {
    let seconds = serde_json::from_str::<Value>(&tool.config_json)
        .ok()
        .and_then(|value| {
            value
                .get("execution")
                .and_then(|execution| execution.get("timeout_seconds"))
                .and_then(Value::as_u64)
        })
        .unwrap_or(DEFAULT_MCP_TOOL_TIMEOUT_SECS)
        .max(1);
    Duration::from_secs(seconds)
}

fn format_mcp_tool_timeout(timeout: Duration) -> String {
    if timeout.subsec_nanos() == 0 {
        format!("{}s", timeout.as_secs())
    } else {
        format!("{}ms", timeout.as_millis())
    }
}

async fn run_mcp_tool_future_with_timeout<T, F>(
    tool_name: &str,
    timeout: Duration,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    match tokio::time::timeout(timeout, future).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "MCP tool '{}' timed out after {}",
            tool_name,
            format_mcp_tool_timeout(timeout)
        )),
    }
}

fn summarize_tool_arguments(arguments: &Value) -> Value {
    match arguments {
        Value::Object(map) => {
            let mut keys = map.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            serde_json::json!({
                "kind": "object",
                "keys": keys,
            })
        }
        Value::Array(items) => serde_json::json!({
            "kind": "array",
            "len": items.len(),
        }),
        Value::Null => serde_json::json!({ "kind": "null" }),
        other => serde_json::json!({
            "kind": "scalar",
            "value": other,
        }),
    }
}

async fn record_successful_tool_execution(
    store: &crate::modules::mcp::store::McpStore,
    session_id: Option<&str>,
    tool_name: &str,
    result: &Value,
) {
    if !should_record_tool_execution_result(result) {
        return;
    }
    if let Err(err) = store
        .record_tool_execution(session_id, tool_name, true)
        .await
    {
        log::warn!(
            "tool_execution_history_record_failed {}",
            serde_json::json!({
                "tool_name": tool_name,
                "session_id": session_id,
                "error": err.to_string(),
            })
        );
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ApprovePersistMode {
    AllowOnce,
    AllowAlways,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RejectPersistMode {
    RejectOnce,
    DenyAlways,
}

async fn resolve_approval_policy_level(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<ApprovalPolicyLevel, String> {
    let configured = store
        .get_desktop_config(APPROVAL_POLICY_LEVEL_CONFIG_KEY)
        .await
        .map_err(|err| err.to_string())?;
    Ok(match parse_approval_policy_level(configured.as_deref()) {
        DesktopApprovalPolicyLevel::High => ApprovalPolicyLevel::High,
        DesktopApprovalPolicyLevel::Medium => ApprovalPolicyLevel::Medium,
        DesktopApprovalPolicyLevel::Low => ApprovalPolicyLevel::Low,
    })
}

async fn resolve_tool_policy_inputs(
    store: &crate::modules::mcp::store::McpStore,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    risk: &crate::modules::mcp::ToolRiskAssessment,
    tool_fingerprint: &str,
) -> Result<(ApprovalDecision, Option<String>, Option<String>), String> {
    const MEDIUM_ALLOW_CONFIDENCE_THRESHOLD: f32 = 0.6;
    const MEDIUM_AUTO_PROMOTE_TTL_DAYS: i64 = 14;
    let policy_rule_key = risk.policy_rule_key(tool_fingerprint);
    let approval_grant_key = risk.session_grant_key(tool_fingerprint);
    let approved_by_grant =
        if let (Some(runtime), Some(key)) = (runtime_state, approval_grant_key.as_ref()) {
            runtime
                .approvals
                .session_approval_grants
                .read()
                .await
                .contains_key(key)
        } else {
            false
        };
    let policy_level = resolve_approval_policy_level(store).await?;
    let now_unix_ms = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let persisted_action = match (policy_rule_key.as_deref(), policy_level) {
        (Some(key), ApprovalPolicyLevel::Medium) => {
            let rule = store
                .get_tool_approval_rule(key)
                .await
                .map_err(|err| err.to_string())?;
            if let Some(rule) = rule {
                if rule.action == PersistedApprovalAction::DenyAlways {
                    Some(PersistedApprovalAction::DenyAlways)
                } else if rule.action == PersistedApprovalAction::AllowAlways {
                    let confidence = calculate_medium_rule_confidence(
                        rule.last_approved_at_unix_ms,
                        rule.half_life_days,
                        now_unix_ms as i64,
                    );
                    if confidence >= MEDIUM_ALLOW_CONFIDENCE_THRESHOLD {
                        Some(PersistedApprovalAction::AllowAlways)
                    } else {
                        None
                    }
                } else if should_auto_promote_medium_rule(
                    rule.approve_count,
                    rule.reject_count,
                    rule.created_at_unix_ms,
                    rule.last_rejected_at_unix_ms,
                    now_unix_ms as i64,
                ) {
                    store
                        .promote_tool_approval_rule_to_allow_always(
                            key,
                            MEDIUM_AUTO_PROMOTE_TTL_DAYS,
                        )
                        .await
                        .map_err(|err| err.to_string())?;
                    Some(PersistedApprovalAction::AllowAlways)
                } else {
                    None
                }
            } else {
                None
            }
        }
        (Some(key), _) => store
            .get_tool_approval_rule(key)
            .await
            .map_err(|err| err.to_string())?
            .map(|rule| rule.action)
            .filter(|action| *action != PersistedApprovalAction::AllowOnce),
        (None, _) => None,
    };
    let decision =
        resolve_approval_decision(risk, approved_by_grant, policy_level, persisted_action);
    Ok((decision, policy_rule_key, approval_grant_key))
}

fn should_record_tool_execution_result(result: &Value) -> bool {
    match result.get("status").and_then(Value::as_str) {
        Some(status)
            if matches!(
                status,
                "REQUIRES_APPROVAL" | "RECOVERED_REQUIRES_APPROVAL" | "DENIED" | "error" | "ERROR"
            ) =>
        {
            false
        }
        _ => true,
    }
}

fn format_tool_execution_panic(payload: Box<dyn Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic payload".to_string()
}

async fn guard_tool_execution_future<T, F>(
    tool_name: &str,
    stage: &str,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    match AssertUnwindSafe(future).catch_unwind().await {
        Ok(result) => result,
        Err(payload) => {
            let panic_message = format_tool_execution_panic(payload);
            log::error!(
                "tool_execution_panic {}",
                serde_json::json!({
                    "tool_name": tool_name,
                    "stage": stage,
                    "panic": panic_message,
                })
            );
            Err(format!(
                "{} for '{}' panicked: {}",
                stage, tool_name, panic_message
            ))
        }
    }
}

fn log_skill_binding_lookup_start(
    tool_id: Option<&str>,
    tool_name: Option<&str>,
    arguments: &Value,
) {
    log::info!(
        "skill_binding_lookup_start {}",
        serde_json::json!({
            "tool_id": tool_id,
            "tool_name": tool_name,
            "arguments": summarize_tool_arguments(arguments),
        })
    );
}

fn log_skill_binding_lookup_hit(
    tool_id: Option<&str>,
    tool_name: Option<&str>,
    binding: &LocalSkillToolBindingSnapshot,
) {
    log::info!(
        "skill_binding_lookup_hit {}",
        serde_json::json!({
            "tool_id": tool_id,
            "tool_name": tool_name,
            "skill_id": binding.skill_id,
            "binding_id": binding.binding_id,
            "callable_name": binding.callable_name,
            "entry_path": binding.entry_path,
            "runtime": binding.runtime,
            "binding_kind": binding.binding_kind,
        })
    );
}

fn log_skill_binding_lookup_miss(tool_id: Option<&str>, tool_name: Option<&str>) {
    log::info!(
        "skill_binding_lookup_miss {}",
        serde_json::json!({
            "tool_id": tool_id,
            "tool_name": tool_name,
        })
    );
}

fn log_skill_binding_lookup_failure(tool_id: Option<&str>, tool_name: Option<&str>, error: &str) {
    log::warn!(
        "skill_binding_lookup_failure {}",
        serde_json::json!({
            "tool_id": tool_id,
            "tool_name": tool_name,
            "error": error,
        })
    );
}

fn resolve_core_tool_name(tool_id: Option<&str>, tool_name: Option<&str>) -> Option<&'static str> {
    let normalized_tool_name = tool_name.map(str::trim).unwrap_or_default();
    let normalized_tool_id = tool_id.map(str::trim).unwrap_or_default();
    match (normalized_tool_name, normalized_tool_id) {
        ("browser_agent_status", _) | (_, "core.browser_agent_status") => {
            Some("browser_agent_status")
        }
        ("browser_open_tab", _) | (_, "core.browser_open_tab") => Some("browser_open_tab"),
        ("browser_get_page_snapshot", _) | (_, "core.browser_get_page_snapshot") => {
            Some("browser_get_page_snapshot")
        }
        ("browser_wait_for_element", _) | (_, "core.browser_wait_for_element") => {
            Some("browser_wait_for_element")
        }
        ("browser_wait_for_navigation", _) | (_, "core.browser_wait_for_navigation") => {
            Some("browser_wait_for_navigation")
        }
        ("browser_scroll_into_view", _) | (_, "core.browser_scroll_into_view") => {
            Some("browser_scroll_into_view")
        }
        ("browser_retry_with_relocate", _) | (_, "core.browser_retry_with_relocate") => {
            Some("browser_retry_with_relocate")
        }
        ("browser_click", _) | (_, "core.browser_click") => Some("browser_click"),
        ("browser_type", _) | (_, "core.browser_type") => Some("browser_type"),
        ("save_asset", _) | (_, "core.save_asset") => Some("save_asset"),
        ("shell_execute", _) | (_, "core.shell_execute") => Some("shell_execute"),
        _ => None,
    }
}

fn core_tool_fingerprint(tool_id: &str, arguments: &Value) -> String {
    format!("{tool_id}:{}", arguments)
}

fn build_policy_denied_payload(
    tool_id: &str,
    tool_name: &str,
    arguments: &Value,
    description: &str,
    risk: &crate::modules::mcp::ToolRiskAssessment,
) -> Value {
    serde_json::json!({
        "status": "DENIED",
        "code": "POLICY_DENY",
        "tool_id": tool_id,
        "tool_name": tool_name,
        "arguments": arguments,
        "description": description,
        "risk_level": risk.risk_level,
        "risk_reasons": risk.reasons.clone(),
        "risk_profile": risk.metadata_json(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BrowserRetryRecoveredApprovalRequest {
    action_kind: String,
    attempts: i64,
    recovery_reason: String,
}

fn extract_browser_retry_recovered_approval_request(
    payload: &Value,
) -> Option<BrowserRetryRecoveredApprovalRequest> {
    let object = payload.as_object()?;
    let status = object.get("status")?.as_str()?.trim();
    if status != "RECOVERED_REQUIRES_APPROVAL" {
        return None;
    }

    Some(BrowserRetryRecoveredApprovalRequest {
        action_kind: object
            .get("action_kind")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())?
            .to_string(),
        attempts: object.get("attempts").and_then(Value::as_i64).unwrap_or(1),
        recovery_reason: object
            .get("recovery_reason")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Recovered target after re-locating browser action")
            .to_string(),
    })
}

async fn maybe_queue_core_tool_approval(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: &str,
    tool_name: &str,
    arguments: &Value,
    description: &str,
    risk: &crate::modules::mcp::ToolRiskAssessment,
    tool_fingerprint: String,
) -> Result<Option<Value>, String> {
    let (decision, policy_rule_key, approval_grant_key) =
        resolve_tool_policy_inputs(store, runtime_state, risk, &tool_fingerprint).await?;

    match decision {
        ApprovalDecision::Allow => {}
        ApprovalDecision::Deny => {
            return Ok(Some(build_policy_denied_payload(
                tool_id,
                tool_name,
                arguments,
                description,
                risk,
            )));
        }
        ApprovalDecision::RequireApproval => {
            let approval_token = uuid::Uuid::new_v4().to_string();
            let pending = if let Some(runtime) = runtime_state {
                runtime.build_pending_tool_call(
                    Some(tool_id.to_string()),
                    tool_name.to_string(),
                    arguments.clone(),
                    Some(description.to_string()),
                    Some(risk.risk_level.to_string()),
                    risk.reasons.clone(),
                    tool_fingerprint,
                    policy_rule_key,
                    approval_grant_key,
                    approval_context.clone(),
                )
            } else {
                let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
                crate::modules::mcp::PendingToolCall {
                    tool_id: Some(tool_id.to_string()),
                    tool_name: tool_name.to_string(),
                    arguments: arguments.clone(),
                    call_id: approval_context.call_id.clone(),
                    execution_token: approval_context.execution_token.clone(),
                    session_id: approval_context.session_id.clone(),
                    description: Some(description.to_string()),
                    risk_level: Some(risk.risk_level.to_string()),
                    risk_reasons: risk.reasons.clone(),
                    tool_fingerprint,
                    policy_rule_key,
                    approval_grant_key,
                    execution_graph_execution_id: None,
                    execution_graph_gate_node_id: None,
                    execution_graph_tool_node_id: None,
                    approval_status: Some("waiting_approval".to_string()),
                    created_at_unix_ms: now as i128,
                    expires_at_unix_ms: now as i128 + 5 * 60 * 1000,
                }
            };
            let expires_in_ms = runtime_state
                .map(|runtime| runtime.pending_tool_call_ttl_ms())
                .unwrap_or(5 * 60 * 1000);
            pending_tool_calls
                .write()
                .await
                .insert(approval_token.clone(), pending);
            return Ok(Some(serde_json::json!({
                "status": "REQUIRES_APPROVAL",
                "approval_token": approval_token,
                "tool_id": tool_id,
                "tool_name": tool_name,
                "arguments": arguments,
                "description": description,
                "risk_level": risk.risk_level,
                "risk_reasons": risk.reasons.clone(),
                "risk_profile": risk.metadata_json(),
                "expires_in_ms": expires_in_ms,
            })));
        }
    }

    Ok(None)
}

async fn execute_core_tool_call_with_tool_ref_internal(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: Option<&str>,
    tool_name: Option<&str>,
    arguments: Value,
    skip_approval_gate: bool,
) -> Result<Option<Value>, String> {
    let Some(core_tool_name) = resolve_core_tool_name(tool_id, tool_name) else {
        return Ok(None);
    };

    match core_tool_name {
        "browser_agent_status" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let result = app_state
                .browser_agent
                .service
                .status_report(app_state.mcp.store.as_ref())
                .await?;
            Ok(Some(
                serde_json::to_value(result).map_err(|err| err.to_string())?,
            ))
        }
        "browser_open_tab" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let url = arguments
                .get("url")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "browser_open_tab requires a non-empty url".to_string())?;

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.browser_open_tab",
                    "browser_open_tab",
                    &arguments,
                    "Open a browser tab through the local browser agent bridge.",
                    &risk,
                    core_tool_fingerprint("core.browser_open_tab", &arguments),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = app_state
                .browser_agent
                .service
                .open_tab(app_state.mcp.store.as_ref(), url)
                .await?;
            Ok(Some(result))
        }
        "browser_get_page_snapshot" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let tab_id = arguments
                .get("tab_id")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_get_page_snapshot requires a positive tab_id".to_string()
                })?;

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.browser_get_page_snapshot",
                    "browser_get_page_snapshot",
                    &arguments,
                    "Read a browser page snapshot through the local browser agent bridge.",
                    &risk,
                    core_tool_fingerprint("core.browser_get_page_snapshot", &arguments),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = app_state
                .browser_agent
                .service
                .get_page_snapshot(app_state.mcp.store.as_ref(), tab_id)
                .await?;
            Ok(Some(result))
        }
        "browser_wait_for_element" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let tab_id = arguments
                .get("tab_id")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| "browser_wait_for_element requires a positive tab_id".to_string())?;
            let target =
                serde_json::from_value::<
                    crate::modules::browser_agent::types::BrowserAgentElementLocator,
                >(arguments.get("target").cloned().ok_or_else(|| {
                    "browser_wait_for_element requires a target locator".to_string()
                })?)
                .map_err(|err| err.to_string())?;
            let timeout_ms = arguments
                .get("timeout_ms")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_wait_for_element requires a positive timeout_ms".to_string()
                })?;
            let poll_interval_ms = arguments
                .get("poll_interval_ms")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_wait_for_element requires a positive poll_interval_ms".to_string()
                })?;

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.browser_wait_for_element",
                    "browser_wait_for_element",
                    &arguments,
                    "Wait for a browser element to appear through the local browser agent bridge.",
                    &risk,
                    core_tool_fingerprint("core.browser_wait_for_element", &arguments),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = app_state
                .browser_agent
                .service
                .wait_for_element(
                    app_state.mcp.store.as_ref(),
                    tab_id,
                    target,
                    timeout_ms,
                    poll_interval_ms,
                )
                .await?;

            Ok(Some(result))
        }
        "browser_wait_for_navigation" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let tab_id = arguments
                .get("tab_id")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_wait_for_navigation requires a positive tab_id".to_string()
                })?;
            let timeout_ms = arguments
                .get("timeout_ms")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_wait_for_navigation requires a positive timeout_ms".to_string()
                })?;
            let expected_url_contains = arguments
                .get("expected_url_contains")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let expected_title_contains = arguments
                .get("expected_title_contains")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let wait_for_ready_state = arguments
                .get("wait_for_ready_state")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.browser_wait_for_navigation",
                    "browser_wait_for_navigation",
                    &arguments,
                    "Wait for browser navigation through the local browser agent bridge.",
                    &risk,
                    core_tool_fingerprint("core.browser_wait_for_navigation", &arguments),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = app_state
                .browser_agent
                .service
                .wait_for_navigation(
                    app_state.mcp.store.as_ref(),
                    tab_id,
                    timeout_ms,
                    expected_url_contains,
                    expected_title_contains,
                    wait_for_ready_state,
                )
                .await?;
            Ok(Some(result))
        }
        "browser_scroll_into_view" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let tab_id = arguments
                .get("tab_id")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| "browser_scroll_into_view requires a positive tab_id".to_string())?;
            let target =
                serde_json::from_value::<
                    crate::modules::browser_agent::types::BrowserAgentElementLocator,
                >(arguments.get("target").cloned().ok_or_else(|| {
                    "browser_scroll_into_view requires a target locator".to_string()
                })?)
                .map_err(|err| err.to_string())?;
            let align = arguments
                .get("align")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.browser_scroll_into_view",
                    "browser_scroll_into_view",
                    &arguments,
                    "Scroll a browser element into view through the local browser agent bridge.",
                    &risk,
                    core_tool_fingerprint("core.browser_scroll_into_view", &arguments),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = app_state
                .browser_agent
                .service
                .scroll_into_view(app_state.mcp.store.as_ref(), tab_id, target, align)
                .await?;
            Ok(Some(result))
        }
        "browser_retry_with_relocate" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let tab_id = arguments
                .get("tab_id")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_retry_with_relocate requires a positive tab_id".to_string()
                })?;
            let action_kind = arguments
                .get("action_kind")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "browser_retry_with_relocate requires action_kind".to_string())?;
            let target = serde_json::from_value::<
                crate::modules::browser_agent::types::BrowserAgentElementLocator,
            >(arguments.get("target").cloned().ok_or_else(|| {
                "browser_retry_with_relocate requires a target locator".to_string()
            })?)
            .map_err(|err| err.to_string())?;
            let text = arguments
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let max_attempts = arguments
                .get("max_attempts")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_retry_with_relocate requires a positive max_attempts".to_string()
                })?;
            let timeout_ms = arguments
                .get("timeout_ms")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_retry_with_relocate requires a positive timeout_ms".to_string()
                })?;
            let poll_interval_ms = arguments
                .get("poll_interval_ms")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| {
                    "browser_retry_with_relocate requires a positive poll_interval_ms".to_string()
                })?;

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.browser_retry_with_relocate",
                    "browser_retry_with_relocate",
                    &arguments,
                    "Retry a browser action after re-locating the target through the local browser agent bridge.",
                    &risk,
                    core_tool_fingerprint("core.browser_retry_with_relocate", &arguments),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = app_state
                .browser_agent
                .service
                .retry_with_relocate(
                    app_state.mcp.store.as_ref(),
                    tab_id,
                    action_kind,
                    target,
                    text,
                    max_attempts,
                    timeout_ms,
                    poll_interval_ms,
                )
                .await?;
            if let Some(recovery) = extract_browser_retry_recovered_approval_request(&result) {
                let (reapproval_tool_id, reapproval_tool_name, reapproval_arguments, description) =
                    match recovery.action_kind.as_str() {
                        "click" => (
                            "core.browser_click",
                            "browser_click",
                            serde_json::json!({
                                "tab_id": tab_id,
                                "target": arguments.get("target").cloned().unwrap_or(Value::Null),
                            }),
                            format!(
                                "Recovered the browser target after failure. Fresh approval is required before clicking again. {}",
                                recovery.recovery_reason
                            ),
                        ),
                        "type" => (
                            "core.browser_type",
                            "browser_type",
                            serde_json::json!({
                                "tab_id": tab_id,
                                "target": arguments.get("target").cloned().unwrap_or(Value::Null),
                                "text": text.unwrap_or_default(),
                            }),
                            format!(
                                "Recovered the browser target after failure. Fresh approval is required before typing again. {}",
                                recovery.recovery_reason
                            ),
                        ),
                        _ => return Ok(Some(result)),
                    };

                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: reapproval_tool_name,
                    arguments: &reapproval_arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    reapproval_tool_id,
                    reapproval_tool_name,
                    &reapproval_arguments,
                    &description,
                    &risk,
                    core_tool_fingerprint(reapproval_tool_id, &reapproval_arguments),
                )
                .await?
                {
                    let mut merged = queued;
                    if let Some(object) = merged.as_object_mut() {
                        object.insert("recovered".to_string(), Value::Bool(true));
                        object.insert(
                            "recovery_reason".to_string(),
                            Value::String(recovery.recovery_reason),
                        );
                        object.insert("attempts".to_string(), Value::from(recovery.attempts));
                        if let Some(snapshot_summary) = result.get("last_snapshot_summary").cloned()
                        {
                            object.insert("last_snapshot_summary".to_string(), snapshot_summary);
                        }
                    }
                    return Ok(Some(merged));
                }
            }

            Ok(Some(result))
        }
        "browser_click" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let tab_id = arguments
                .get("tab_id")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| "browser_click requires a positive tab_id".to_string())?;
            let target = serde_json::from_value::<
                crate::modules::browser_agent::types::BrowserAgentElementLocator,
            >(
                arguments
                    .get("target")
                    .cloned()
                    .ok_or_else(|| "browser_click requires a target locator".to_string())?,
            )
            .map_err(|err| err.to_string())?;

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.browser_click",
                    "browser_click",
                    &arguments,
                    "Click an element through the local browser agent bridge.",
                    &risk,
                    core_tool_fingerprint("core.browser_click", &arguments),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = app_state
                .browser_agent
                .service
                .click_element(app_state.mcp.store.as_ref(), tab_id, target)
                .await?;
            Ok(Some(result))
        }
        "browser_type" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let tab_id = arguments
                .get("tab_id")
                .and_then(Value::as_i64)
                .filter(|value| *value > 0)
                .ok_or_else(|| "browser_type requires a positive tab_id".to_string())?;
            let target = serde_json::from_value::<
                crate::modules::browser_agent::types::BrowserAgentElementLocator,
            >(
                arguments
                    .get("target")
                    .cloned()
                    .ok_or_else(|| "browser_type requires a target locator".to_string())?,
            )
            .map_err(|err| err.to_string())?;
            let text = arguments
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "browser_type requires non-empty text".to_string())?;

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.browser_type",
                    "browser_type",
                    &arguments,
                    "Type into a browser element through the local browser agent bridge.",
                    &risk,
                    core_tool_fingerprint("core.browser_type", &arguments),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = app_state
                .browser_agent
                .service
                .type_element(app_state.mcp.store.as_ref(), tab_id, target, text)
                .await?;
            Ok(Some(result))
        }
        "shell_execute" => {
            let home_dir =
                dirs::home_dir().ok_or_else(|| "home directory is unavailable".to_string())?;
            let shell_tool = ShellExecuteCoreTool::new(home_dir);
            let request: ExecutionRequest = serde_json::from_value(arguments.clone())
                .map_err(|err| format!("Invalid arguments: {err}"))?;
            let command = request.command_label();
            if command.is_empty() {
                return Err(
                    "shell_execute requires a non-empty command, program, or script".to_string(),
                );
            }

            if !skip_approval_gate {
                let risk = shell_tool.assess_risk(&request);
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.shell_execute",
                    "shell_execute",
                    &arguments,
                    "Execute shell commands on the user's machine.",
                    &risk,
                    format!("core.shell_execute:{command}"),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let result = shell_tool.execute_request(request).await?;
            Ok(Some(result))
        }
        "save_asset" => {
            let app_state = crate::state::global_app_state()
                .ok_or_else(|| "global app state is unavailable".to_string())?;
            let app_handle = crate::state::global_app_handle()
                .ok_or_else(|| "global app handle is unavailable".to_string())?;
            let request: SaveLocalAssetRequest = serde_json::from_value(arguments.clone())
                .map_err(|err| format!("Invalid arguments: {err}"))?;
            let asset_id = request.asset_id.trim().to_string();
            if asset_id.is_empty() {
                return Err("save_asset requires a non-empty asset_id".to_string());
            }

            if !skip_approval_gate {
                let risk = assess_policy_risk(PolicyTargetRef::CoreTool {
                    tool_name: core_tool_name,
                    arguments: &arguments,
                });
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
                    store,
                    pending_tool_calls,
                    "core.save_asset",
                    "save_asset",
                    &arguments,
                    "Save a reusable local HTML asset on the user's machine.",
                    &risk,
                    format!("core.save_asset:{asset_id}"),
                )
                .await?
                {
                    return Ok(Some(queued));
                }
            }

            let record = save_local_asset(
                &app_handle,
                &app_state,
                app_state.mcp.store.as_ref(),
                request,
            )
            .await
            .map_err(|err| err.to_string())?;
            Ok(Some(
                serde_json::to_value(record).map_err(|err| err.to_string())?,
            ))
        }
        _ => Ok(None),
    }
}

pub(crate) async fn execute_or_queue_core_tool_call_with_tool_ref(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: Option<&str>,
    tool_name: Option<&str>,
    arguments: Value,
) -> Result<Option<Value>, String> {
    execute_core_tool_call_with_tool_ref_internal(
        approval_context,
        runtime_state,
        store,
        pending_tool_calls,
        tool_id,
        tool_name,
        arguments,
        false,
    )
    .await
}

fn log_skill_binding_stage(binding: &LocalSkillToolBindingSnapshot, stage: &str, details: Value) {
    log::info!(
        "skill_binding_stage {}",
        serde_json::json!({
            "skill_id": binding.skill_id,
            "binding_id": binding.binding_id,
            "callable_name": binding.callable_name,
            "tool_name": binding.tool_name,
            "entry_path": binding.entry_path,
            "runtime": binding.runtime,
            "binding_kind": binding.binding_kind,
            "stage": stage,
            "details": details,
        })
    );
}

pub(crate) async fn execute_mcp_tool(
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
) -> Result<Value, String> {
    let timeout = resolve_mcp_tool_execution_timeout(tool);

    if tool.is_remote_sse() {
        let sse_url = tool
            .remote_sse_url()
            .ok_or_else(|| format!("remote tool {} is missing sse url", tool.name))?;
        let remote_tool_name = tool
            .remote_tool_name()
            .ok_or_else(|| format!("remote tool {} is missing remote tool name", tool.name))?;
        return run_mcp_tool_future_with_timeout(
            &tool.name,
            timeout,
            call_remote_sse_tool(&sse_url, &remote_tool_name, arguments),
        )
        .await;
    }

    if tool.is_stdio_mcp_tool() {
        let env = resolve_local_tool_env(store, tool).await?;
        if let Some(runtime) = runtime_state {
            let result = run_mcp_tool_future_with_timeout(
                &tool.name,
                timeout,
                runtime
                    .stdio_mcp_sessions
                    .call_tool(tool, env.as_ref(), arguments),
            )
            .await;
            match result {
                Ok(value) => {
                    let _ = crate::modules::mcp::update_stdio_mcp_server_statuses(
                        store,
                        tool,
                        mcp_core::types::McpToolStatus::Healthy,
                        None,
                    )
                    .await;
                    return Ok(value);
                }
                Err(err) => {
                    let next_status = stdio_status_for_execution_error(&err);
                    let _ = crate::modules::mcp::update_stdio_mcp_server_statuses(
                        store,
                        tool,
                        next_status,
                        Some(err.clone()),
                    )
                    .await;
                    return Err(err);
                }
            }
        }

        let command = tool
            .command
            .as_deref()
            .ok_or_else(|| format!("stdio MCP tool {} has no executable command", tool.name))?;
        let tool_name = tool
            .stdio_mcp_tool_name()
            .ok_or_else(|| format!("stdio MCP tool {} is missing tool metadata", tool.name))?;
        let args = tool.args.clone().unwrap_or_default();
        return run_mcp_tool_future_with_timeout(
            &tool.name,
            timeout,
            call_local_stdio_tool(command, &args, env.as_ref(), &tool_name, arguments),
        )
        .await;
    }

    run_mcp_tool_future_with_timeout(
        &tool.name,
        timeout,
        execute_local_mcp_tool(store, tool, arguments),
    )
    .await
}

#[cfg_attr(any(not(test), target_os = "windows"), allow(dead_code))]
pub(crate) async fn execute_or_queue_mcp_tool_call(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        store,
        pending_tool_calls,
        tool_name,
        arguments,
    )
    .await
}

#[cfg_attr(any(not(test), target_os = "windows"), allow(dead_code))]
pub(crate) async fn execute_or_queue_mcp_tool_call_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_tool_ref(
        approval_context,
        runtime_state,
        store,
        pending_tool_calls,
        None,
        Some(tool_name),
        arguments,
    )
    .await
}

pub(crate) async fn execute_or_queue_mcp_tool_call_with_tool_ref(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: Option<String>,
    tool_name: Option<String>,
    arguments: Value,
) -> Result<Value, String> {
    log_skill_binding_lookup_start(tool_id.as_deref(), tool_name.as_deref(), &arguments);
    let resolved_binding =
        resolve_skill_binding_by_ref(store, tool_id.as_deref(), tool_name.as_deref())
            .await
            .map_err(|err| {
                log_skill_binding_lookup_failure(tool_id.as_deref(), tool_name.as_deref(), &err);
                err
            })?;
    if let Some(binding) = resolved_binding {
        log_skill_binding_lookup_hit(tool_id.as_deref(), tool_name.as_deref(), &binding);
        let risk_assessment = assess_policy_risk(PolicyTargetRef::SkillBinding {
            binding: &binding,
            arguments: &arguments,
        });
        let tool_fingerprint = skill_binding_fingerprint(&binding);
        let (decision, policy_rule_key, approval_grant_key) =
            resolve_tool_policy_inputs(store, runtime_state, &risk_assessment, &tool_fingerprint)
                .await?;

        match decision {
            ApprovalDecision::Allow => {}
            ApprovalDecision::Deny => {
                return Ok(build_policy_denied_payload(
                    &binding.binding_id,
                    &binding.callable_name,
                    &arguments,
                    &binding.description,
                    &risk_assessment,
                ));
            }
            ApprovalDecision::RequireApproval => {
                log_skill_binding_stage(
                    &binding,
                    "approval.required",
                    serde_json::json!({
                        "approved_by_grant": approval_grant_key.is_some(),
                        "has_runtime_state": runtime_state.is_some(),
                        "risk_level": risk_assessment.risk_level,
                    }),
                );
                let approval_token = Uuid::new_v4().to_string();
                let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
                let pending = crate::modules::mcp::PendingToolCall {
                    tool_id: Some(binding.binding_id.clone()),
                    tool_name: binding.callable_name.clone(),
                    arguments: arguments.clone(),
                    call_id: approval_context.call_id.clone(),
                    execution_token: approval_context.execution_token.clone(),
                    session_id: approval_context.session_id.clone(),
                    description: Some(binding.description.clone()),
                    risk_level: Some(risk_assessment.risk_level.to_string()),
                    risk_reasons: risk_assessment.reasons.clone(),
                    tool_fingerprint,
                    policy_rule_key,
                    approval_grant_key,
                    execution_graph_execution_id: None,
                    execution_graph_gate_node_id: None,
                    execution_graph_tool_node_id: None,
                    approval_status: Some("waiting_approval".to_string()),
                    created_at_unix_ms: now as i128,
                    expires_at_unix_ms: now as i128 + 5 * 60 * 1000,
                };
                pending_tool_calls
                    .write()
                    .await
                    .insert(approval_token.clone(), pending);
                return Ok(serde_json::json!({
                    "status": "REQUIRES_APPROVAL",
                    "approval_token": approval_token,
                    "tool_id": binding.binding_id,
                    "tool_name": binding.callable_name,
                    "arguments": arguments,
                    "description": binding.description,
                    "risk_level": risk_assessment.risk_level,
                    "risk_reasons": risk_assessment.reasons,
                    "risk_profile": risk_assessment.metadata_json(),
                    "expires_in_ms": 5 * 60 * 1000,
                }));
            }
        }
        log_skill_binding_stage(
            &binding,
            "execute_via_skill_binding.dispatch",
            serde_json::json!({
                "approved_by_grant": approval_grant_key.is_some(),
            }),
        );
        let result = guard_tool_execution_future(
            &binding.callable_name,
            "skill binding execution",
            execute_skill_binding(store, &binding, &arguments),
        )
        .await?;
        record_successful_tool_execution(
            store,
            approval_context.session_id.as_deref(),
            &binding.callable_name,
            &result,
        )
        .await;
        return Ok(result);
    }
    log_skill_binding_lookup_miss(tool_id.as_deref(), tool_name.as_deref());

    if let Some(result) = guard_tool_execution_future(
        tool_name.as_deref().unwrap_or("<unnamed_tool>"),
        "core tool execution",
        execute_or_queue_core_tool_call_with_tool_ref(
            approval_context,
            runtime_state,
            store,
            pending_tool_calls,
            tool_id.as_deref(),
            tool_name.as_deref(),
            arguments.clone(),
        ),
    )
    .await?
    {
        let resolved_tool_name = resolve_core_tool_name(tool_id.as_deref(), tool_name.as_deref())
            .unwrap_or_else(|| tool_name.as_deref().unwrap_or_default());
        record_successful_tool_execution(
            store,
            approval_context.session_id.as_deref(),
            resolved_tool_name,
            &result,
        )
        .await;
        return Ok(result);
    }

    let tool = resolve_callable_mcp_tool_by_ref(store, tool_id.as_deref(), tool_name.as_deref())
        .await
        .map_err(|err| err.to_string())?;
    let tool_fingerprint = runtime_state
        .map(|runtime| runtime.tool_fingerprint(&tool))
        .unwrap_or_else(|| tool.config_hash.clone());
    let risk_assessment = assess_policy_risk(PolicyTargetRef::McpTool {
        tool: &tool,
        arguments: &arguments,
    });
    let (decision, policy_rule_key, approval_grant_key) =
        resolve_tool_policy_inputs(store, runtime_state, &risk_assessment, &tool_fingerprint)
            .await?;

    match decision {
        ApprovalDecision::Allow => {}
        ApprovalDecision::Deny => {
            return Ok(build_policy_denied_payload(
                &tool.id,
                &tool.name,
                &arguments,
                &tool.description,
                &risk_assessment,
            ));
        }
        ApprovalDecision::RequireApproval => {
            let approval_token = Uuid::new_v4().to_string();
            let pending = if let Some(runtime) = runtime_state {
                runtime.build_pending_tool_call(
                    Some(tool.id.clone()),
                    tool.name.clone(),
                    arguments.clone(),
                    Some(tool.description.clone()),
                    Some(risk_assessment.risk_level.to_string()),
                    risk_assessment.reasons.clone(),
                    tool_fingerprint,
                    policy_rule_key,
                    approval_grant_key,
                    approval_context.clone(),
                )
            } else {
                let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
                crate::modules::mcp::PendingToolCall {
                    tool_id: Some(tool.id.clone()),
                    tool_name: tool.name.clone(),
                    arguments: arguments.clone(),
                    call_id: approval_context.call_id.clone(),
                    execution_token: approval_context.execution_token.clone(),
                    session_id: approval_context.session_id.clone(),
                    description: Some(tool.description.clone()),
                    risk_level: Some(risk_assessment.risk_level.to_string()),
                    risk_reasons: risk_assessment.reasons.clone(),
                    tool_fingerprint,
                    policy_rule_key,
                    approval_grant_key,
                    execution_graph_execution_id: None,
                    execution_graph_gate_node_id: None,
                    execution_graph_tool_node_id: None,
                    approval_status: Some("waiting_approval".to_string()),
                    created_at_unix_ms: now as i128,
                    expires_at_unix_ms: now as i128 + 5 * 60 * 1000,
                }
            };
            let expires_in_ms = runtime_state
                .map(|runtime| runtime.pending_tool_call_ttl_ms())
                .unwrap_or(5 * 60 * 1000);
            pending_tool_calls
                .write()
                .await
                .insert(approval_token.clone(), pending);
            return Ok(serde_json::json!({
                "status": "REQUIRES_APPROVAL", "approval_token": approval_token,
                "tool_id": tool.id, "tool_name": tool.name,
                "arguments": arguments, "description": tool.description, "risk_level": risk_assessment.risk_level,
                "risk_reasons": risk_assessment.reasons, "risk_profile": risk_assessment.metadata_json(), "expires_in_ms": expires_in_ms,
            }));
        }
    }
    let result = guard_tool_execution_future(
        &tool.name,
        "MCP tool execution",
        execute_mcp_tool(runtime_state, store, &tool, &arguments),
    )
    .await?;
    record_successful_tool_execution(
        store,
        approval_context.session_id.as_deref(),
        &tool.name,
        &result,
    )
    .await;
    Ok(result)
}

#[cfg_attr(any(not(test), target_os = "windows"), allow(dead_code))]
pub(crate) async fn approve_mcp_tool_inner(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    approve_mcp_tool_inner_with_context_and_mode(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        store,
        pending_tool_calls,
        approval_token,
        ApprovePersistMode::AllowOnce,
    )
    .await
}

pub(crate) async fn approve_mcp_tool_inner_with_context_and_mode(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
    persist_mode: ApprovePersistMode,
) -> Result<Value, String> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let pending = pending_tool_calls.read().await.get(approval_token).cloned();
    let Some(pending) = pending else {
        return Err("pending tool call not found".to_string());
    };
    if pending.expires_at_unix_ms <= now as i128 {
        pending_tool_calls.write().await.remove(approval_token);
        return Err("approval token expired; please retry the action".to_string());
    }
    match normalized_approval_status(pending.approval_status.as_deref()) {
        "approved" => {
            return Err("pending tool call already consumed".to_string());
        }
        "approving" => {
            return Err("approval already in progress".to_string());
        }
        "rejected" => {
            return Err("approval already rejected".to_string());
        }
        "approval_failed" | "waiting_approval" => {}
        _ => {
            return Err("approval gate is in an invalid state".to_string());
        }
    }
    if let Some(expected_call_id) = pending.call_id.as_deref() {
        if approval_context.call_id.as_deref() != Some(expected_call_id) {
            return Err("approval context mismatch (call_id)".to_string());
        }
    }
    if let Some(expected_execution_token) = pending.execution_token.as_deref() {
        if approval_context.execution_token.as_deref() != Some(expected_execution_token) {
            return Err("approval context mismatch (execution_token)".to_string());
        }
    }
    let pending = update_pending_approval_status(
        pending_tool_calls,
        approval_token,
        "approving",
    )
    .await?;

    if let Some(binding) = resolve_skill_binding_by_ref(
        store,
        pending.tool_id.as_deref(),
        Some(pending.tool_name.as_str()),
    )
    .await?
    {
        if skill_binding_fingerprint(&binding) != pending.tool_fingerprint {
            if let Ok(mut failed_pending) = update_pending_approval_status(
                pending_tool_calls,
                approval_token,
                "approval_failed",
            )
            .await
            {
                failed_pending.approval_status = Some("approval_failed".to_string());
            }
            return Err(
                "skill binding changed after approval prompt; request was cancelled".to_string(),
            );
        }
        let result = match guard_tool_execution_future(
            &binding.callable_name,
            "skill binding approval execution",
            execute_skill_binding(store, &binding, &pending.arguments),
        )
        .await
        {
            Ok(result) => result,
            Err(err) => {
                let _ = update_pending_approval_status(
                    pending_tool_calls,
                    approval_token,
                    "approval_failed",
                )
                .await;
                return Err(err);
            }
        };
        let pending = remove_pending_approval_entry(pending_tool_calls, approval_token).await?;
        record_successful_tool_execution(
            store,
            pending.session_id.as_deref(),
            &binding.callable_name,
            &result,
        )
        .await;
        if matches!(
            persist_mode,
            ApprovePersistMode::AllowOnce | ApprovePersistMode::AllowAlways
        ) {
            if let Some(key) = pending.policy_rule_key.as_deref() {
                store
                    .upsert_tool_approval_rule(
                        key,
                        match persist_mode {
                            ApprovePersistMode::AllowOnce => PersistedApprovalAction::AllowOnce,
                            ApprovePersistMode::AllowAlways => PersistedApprovalAction::AllowAlways,
                        },
                        &binding.callable_name,
                        &pending.tool_fingerprint,
                        pending.risk_level.as_deref(),
                    )
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }
        if matches!(persist_mode, ApprovePersistMode::AllowAlways) {
            if let (Some(runtime), Some(key)) =
                (runtime_state, pending.approval_grant_key.as_deref())
            {
                if let Some(grant) =
                    crate::modules::mcp::SessionApprovalGrant::from_key(key, now as i128)
                {
                    runtime
                        .approvals
                        .session_approval_grants
                        .write()
                        .await
                        .insert(grant.key.clone(), grant);
                }
            }
        }
        return Ok(result);
    }

    if let Some(result) = match guard_tool_execution_future(
        pending.tool_name.as_str(),
        "core tool approval execution",
        execute_core_tool_call_with_tool_ref_internal(
            approval_context,
            runtime_state,
            store,
            pending_tool_calls,
            pending.tool_id.as_deref(),
            Some(pending.tool_name.as_str()),
            pending.arguments.clone(),
            true,
        ),
    )
    .await
    {
        Ok(result) => Ok(result),
        Err(err) => {
            let _ = update_pending_approval_status(
                pending_tool_calls,
                approval_token,
                "approval_failed",
            )
            .await;
            Err(err)
        }
    }?
    {
        let pending = remove_pending_approval_entry(pending_tool_calls, approval_token).await?;
        record_successful_tool_execution(
            store,
            pending.session_id.as_deref(),
            &pending.tool_name,
            &result,
        )
        .await;
        if matches!(
            persist_mode,
            ApprovePersistMode::AllowOnce | ApprovePersistMode::AllowAlways
        ) {
            if let Some(key) = pending.policy_rule_key.as_deref() {
                store
                    .upsert_tool_approval_rule(
                        key,
                        match persist_mode {
                            ApprovePersistMode::AllowOnce => PersistedApprovalAction::AllowOnce,
                            ApprovePersistMode::AllowAlways => PersistedApprovalAction::AllowAlways,
                        },
                        &pending.tool_name,
                        &pending.tool_fingerprint,
                        pending.risk_level.as_deref(),
                    )
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }
        return Ok(result);
    }

    let tool = resolve_callable_mcp_tool_by_ref(
        store,
        pending.tool_id.as_deref(),
        Some(pending.tool_name.as_str()),
    )
    .await
    .map_err(|err| err.to_string())?;
    if let Some(runtime) = runtime_state {
        let current_fingerprint = runtime.tool_fingerprint(&tool);
        if current_fingerprint != pending.tool_fingerprint {
            let _ = update_pending_approval_status(
                pending_tool_calls,
                approval_token,
                "approval_failed",
            )
            .await;
            return Err(
                "tool configuration changed after approval prompt; request was cancelled"
                    .to_string(),
            );
        }
    }
    let result = match guard_tool_execution_future(
        &tool.name,
        "MCP tool approval execution",
        execute_mcp_tool(runtime_state, store, &tool, &pending.arguments),
    )
    .await
    {
        Ok(result) => result,
        Err(err) => {
            let _ = update_pending_approval_status(
                pending_tool_calls,
                approval_token,
                "approval_failed",
            )
            .await;
            return Err(err);
        }
    };
    let pending = remove_pending_approval_entry(pending_tool_calls, approval_token).await?;
    record_successful_tool_execution(store, pending.session_id.as_deref(), &tool.name, &result)
        .await;
    if matches!(
        persist_mode,
        ApprovePersistMode::AllowOnce | ApprovePersistMode::AllowAlways
    ) {
        if let Some(key) = pending.policy_rule_key.as_deref() {
            store
                .upsert_tool_approval_rule(
                    key,
                    match persist_mode {
                        ApprovePersistMode::AllowOnce => PersistedApprovalAction::AllowOnce,
                        ApprovePersistMode::AllowAlways => PersistedApprovalAction::AllowAlways,
                    },
                    &tool.name,
                    &pending.tool_fingerprint,
                    pending.risk_level.as_deref(),
                )
                .await
                .map_err(|err| err.to_string())?;
        }
    }
    if matches!(persist_mode, ApprovePersistMode::AllowAlways) {
        if let (Some(runtime), Some(key)) = (runtime_state, pending.approval_grant_key.as_deref()) {
            if let Some(grant) =
                crate::modules::mcp::SessionApprovalGrant::from_key(key, now as i128)
            {
                runtime
                    .approvals
                    .session_approval_grants
                    .write()
                    .await
                    .insert(grant.key.clone(), grant);
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub(crate) async fn reject_mcp_tool_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> bool {
    reject_mcp_tool_inner_with_mode(
        None,
        pending_tool_calls,
        approval_token,
        RejectPersistMode::RejectOnce,
    )
    .await
    .unwrap_or(false)
}

pub(crate) async fn reject_mcp_tool_inner_with_mode(
    store: Option<&crate::modules::mcp::store::McpStore>,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
    reject_mode: RejectPersistMode,
) -> Result<bool, String> {
    let pending = pending_tool_calls.read().await.get(approval_token).cloned();
    if matches!(reject_mode, RejectPersistMode::DenyAlways) {
        if let (Some(store), Some(pending)) = (store, pending.as_ref()) {
            if let Some(key) = pending.policy_rule_key.as_deref() {
                store
                    .upsert_tool_approval_rule(
                        key,
                        PersistedApprovalAction::DenyAlways,
                        &pending.tool_name,
                        &pending.tool_fingerprint,
                        pending.risk_level.as_deref(),
                    )
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }
    }
    Ok(pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_some())
}

#[cfg(test)]
mod tests {
    use super::{
        extract_browser_retry_recovered_approval_request, format_mcp_tool_timeout,
        format_tool_execution_panic, guard_tool_execution_future, is_stdio_invocation_error,
        resolve_core_tool_name, resolve_mcp_tool_execution_timeout,
        run_mcp_tool_future_with_timeout, stdio_status_for_execution_error,
    };
    use crate::modules::capability_control_plane::{
        resolve_official_skill_host_tool_route, OfficialSkillHostToolRoute,
    };
    use mcp_core::types::{McpConflictStatus, McpSourceType, McpTool, McpToolStatus};
    use std::collections::HashMap;
    use std::time::Duration;

    fn mock_mcp_tool(config_json: &str) -> McpTool {
        McpTool {
            id: "tool-1".to_string(),
            identifier: None,
            name: "mock_tool".to_string(),
            service_key: None,
            service_display_name: None,
            service_description: None,
            source_type: McpSourceType::Local,
            source_id: None,
            status: McpToolStatus::Healthy,
            ping_ms: None,
            capabilities: Vec::new(),
            description: "Mock tool".to_string(),
            error: None,
            command: None,
            args: None,
            env: Some(HashMap::new()),
            config_json: config_json.to_string(),
            pending_config_json: None,
            config_hash: "hash-1".to_string(),
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: false,
            is_new: false,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn capability_bridge_registry_exposes_desktop_official_skill_capabilities() {
        let specs = [
            "skill_registry.refresh",
            "memory.append",
            "memory.search",
            "monitor.create",
            "monitor.list",
            "provider_preset.list",
            "provider_preset.upsert",
            "provider.verify",
            "provider.template.verify",
            "cloud.provider_preset.list",
            "cloud.provider_preset.upsert",
        ];

        for capability_id in specs {
            let spec = crate::modules::capability_control_plane::find_official_skill_capability(
                capability_id,
            )
            .unwrap_or_else(|| {
                panic!("missing desktop official-skill capability: {capability_id}")
            });
            assert_eq!(spec.id, capability_id);
            assert!(spec.callable_from_official_skill);
            if capability_id.starts_with("cloud.") {
                assert!(spec.admin_only);
            }
        }
    }

    #[test]
    fn capability_bridge_registry_does_not_treat_legacy_host_tool_names_as_contract() {
        assert!(
            crate::modules::capability_control_plane::find_official_skill_capability(
                "register_local_skills",
            )
            .is_none()
        );
        assert!(
            crate::modules::capability_control_plane::find_official_skill_capability(
                "list_user_memories",
            )
            .is_none()
        );
        assert!(
            crate::modules::capability_control_plane::find_official_skill_capability(
                "create_monitor",
            )
            .is_none()
        );
    }

    #[test]
    fn official_skill_host_tool_route_allows_search_sdk_for_official_skills() {
        assert_eq!(
            resolve_official_skill_host_tool_route("search_sdk"),
            OfficialSkillHostToolRoute::SearchSdk
        );
    }

    #[test]
    fn official_skill_host_tool_route_rejects_shell_execute() {
        assert_eq!(
            resolve_official_skill_host_tool_route("shell_execute"),
            OfficialSkillHostToolRoute::Unsupported
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_agent_status() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_agent_status")),
            Some("browser_agent_status")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_agent_status"), None),
            Some("browser_agent_status")
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_open_tab() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_open_tab")),
            Some("browser_open_tab")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_open_tab"), None),
            Some("browser_open_tab")
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_get_page_snapshot() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_get_page_snapshot")),
            Some("browser_get_page_snapshot")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_get_page_snapshot"), None),
            Some("browser_get_page_snapshot")
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_click() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_click")),
            Some("browser_click")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_click"), None),
            Some("browser_click")
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_type() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_type")),
            Some("browser_type")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_type"), None),
            Some("browser_type")
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_wait_for_element() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_wait_for_element")),
            Some("browser_wait_for_element")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_wait_for_element"), None),
            Some("browser_wait_for_element")
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_wait_for_navigation() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_wait_for_navigation")),
            Some("browser_wait_for_navigation")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_wait_for_navigation"), None),
            Some("browser_wait_for_navigation")
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_scroll_into_view() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_scroll_into_view")),
            Some("browser_scroll_into_view")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_scroll_into_view"), None),
            Some("browser_scroll_into_view")
        );
    }

    #[test]
    fn core_tool_resolution_recognizes_browser_retry_with_relocate() {
        assert_eq!(
            resolve_core_tool_name(None, Some("browser_retry_with_relocate")),
            Some("browser_retry_with_relocate")
        );
        assert_eq!(
            resolve_core_tool_name(Some("core.browser_retry_with_relocate"), None),
            Some("browser_retry_with_relocate")
        );
    }

    #[test]
    fn extract_browser_retry_recovered_approval_request_reads_expected_payload() {
        let payload = serde_json::json!({
            "status": "RECOVERED_REQUIRES_APPROVAL",
            "action_kind": "click",
            "attempts": 2,
            "recovery_reason": "Target changed after refresh"
        });

        let parsed = extract_browser_retry_recovered_approval_request(&payload)
            .expect("recovered approval request");

        assert_eq!(parsed.action_kind, "click");
        assert_eq!(parsed.attempts, 2);
        assert_eq!(parsed.recovery_reason, "Target changed after refresh");
    }

    #[test]
    fn official_skill_host_tool_route_preserves_desktop_capability_dispatch() {
        assert_eq!(
            resolve_official_skill_host_tool_route("monitor.list"),
            OfficialSkillHostToolRoute::DesktopCapability
        );
    }

    #[test]
    fn format_tool_execution_panic_extracts_string_payloads() {
        assert_eq!(
            format_tool_execution_panic(Box::new("stdio bridge exploded")),
            "stdio bridge exploded"
        );
        assert_eq!(
            format_tool_execution_panic(Box::new(String::from("rmcp call failed"))),
            "rmcp call failed"
        );
    }

    #[test]
    fn stdio_invocation_errors_are_detected_from_invalid_params_shapes() {
        assert!(is_stdio_invocation_error(
            "Mcp error: -32602: Tool 'firecrawl_agent' parameter validation failed: prompt: Invalid input: expected string, received undefined."
        ));
        assert!(is_stdio_invocation_error(
            "invalid params: missing required property 'prompt'"
        ));
        assert!(!is_stdio_invocation_error(
            "stdio client transport closed before response was received"
        ));
    }

    #[test]
    fn stdio_invalid_params_errors_do_not_mark_runtime_unavailable() {
        assert_eq!(
            stdio_status_for_execution_error("Mcp error -32602: parameter validation failed"),
            McpToolStatus::Healthy
        );
        assert_eq!(
            stdio_status_for_execution_error("stdio client transport closed"),
            McpToolStatus::Error
        );
    }

    #[test]
    fn resolve_mcp_tool_execution_timeout_prefers_configured_seconds() {
        let configured = mock_mcp_tool(r#"{"execution":{"timeout_seconds":17}}"#);
        assert_eq!(
            resolve_mcp_tool_execution_timeout(&configured),
            Duration::from_secs(17)
        );

        let defaulted = mock_mcp_tool("{}");
        assert_eq!(
            resolve_mcp_tool_execution_timeout(&defaulted),
            Duration::from_secs(180)
        );
    }

    #[test]
    fn format_mcp_tool_timeout_prefers_readable_units() {
        assert_eq!(format_mcp_tool_timeout(Duration::from_secs(9)), "9s");
        assert_eq!(format_mcp_tool_timeout(Duration::from_millis(250)), "250ms");
    }

    #[tokio::test]
    async fn run_mcp_tool_future_with_timeout_returns_timeout_error() {
        let err = run_mcp_tool_future_with_timeout::<serde_json::Value, _>(
            "mock_stdio",
            Duration::from_millis(10),
            async {
                tokio::time::sleep(Duration::from_millis(50)).await;
                Ok(serde_json::json!({"ok": true}))
            },
        )
        .await
        .expect_err("slow MCP tool should time out");

        assert!(
            err.contains("MCP tool 'mock_stdio' timed out after 10ms"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn guard_tool_execution_future_converts_panics_into_errors() {
        let err = guard_tool_execution_future::<serde_json::Value, _>(
            "mock_stdio",
            "MCP tool execution",
            async { panic!("mock MCP panic") },
        )
        .await
        .expect_err("panic should become ordinary error");

        assert!(
            err.contains("MCP tool execution for 'mock_stdio' panicked"),
            "{err}"
        );
        assert!(err.contains("mock MCP panic"), "{err}");
    }
}
