use super::super::support::*;
use super::remote_transport::{call_local_stdio_tool, call_remote_sse_tool};
use super::tool_resolution::resolve_callable_mcp_tool_by_ref;
use crate::modules::mcp::policy::{
    assess_policy_risk, resolve_approval_decision, ApprovalDecision, PolicyTargetRef,
};
use crate::modules::shell_executor::core_tool::ShellExecuteCoreTool;
use crate::modules::skill_runtime::{
    execute_local_mcp_tool, execute_skill_binding, resolve_local_tool_env,
    resolve_skill_binding_by_ref, skill_binding_fingerprint,
};
use mcp_storage::types::LocalSkillToolBindingSnapshot;

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
    if let Err(err) = store.record_tool_execution(session_id, tool_name, true).await {
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

fn should_record_tool_execution_result(result: &Value) -> bool {
    match result.get("status").and_then(Value::as_str) {
        Some(status)
            if matches!(
                status,
                "REQUIRES_APPROVAL"
                    | "RECOVERED_REQUIRES_APPROVAL"
                    | "DENIED"
                    | "error"
                    | "ERROR"
            ) =>
        {
            false
        }
        _ => true,
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
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: &str,
    tool_name: &str,
    arguments: &Value,
    description: &str,
    risk: &crate::modules::mcp::ToolRiskAssessment,
    tool_fingerprint: String,
) -> Result<Option<Value>, String> {
    let approval_grant_key = risk.session_grant_key(&tool_fingerprint);
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

    match resolve_approval_decision(risk, approved_by_grant) {
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
                    approval_grant_key,
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
            let command = arguments
                .get("command")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "shell_execute requires a non-empty command".to_string())?;

            if !skip_approval_gate {
                let risk = shell_tool.assess_risk(command, &arguments);
                if let Some(queued) = maybe_queue_core_tool_approval(
                    approval_context,
                    runtime_state,
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

            let result = shell_tool.execute(arguments).await?;
            Ok(Some(result))
        }
        _ => Ok(None),
    }
}

pub(crate) async fn execute_or_queue_core_tool_call_with_tool_ref(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: Option<&str>,
    tool_name: Option<&str>,
    arguments: Value,
) -> Result<Option<Value>, String> {
    execute_core_tool_call_with_tool_ref_internal(
        approval_context,
        runtime_state,
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
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
) -> Result<Value, String> {
    if tool.is_remote_sse() {
        let sse_url = tool
            .remote_sse_url()
            .ok_or_else(|| format!("remote tool {} is missing sse url", tool.name))?;
        let remote_tool_name = tool
            .remote_tool_name()
            .ok_or_else(|| format!("remote tool {} is missing remote tool name", tool.name))?;
        return call_remote_sse_tool(&sse_url, &remote_tool_name, arguments).await;
    }

    if tool.is_stdio_mcp_tool() {
        let command = tool
            .command
            .as_deref()
            .ok_or_else(|| format!("stdio MCP tool {} has no executable command", tool.name))?;
        let tool_name = tool
            .stdio_mcp_tool_name()
            .ok_or_else(|| format!("stdio MCP tool {} is missing tool metadata", tool.name))?;
        let env = resolve_local_tool_env(store, tool).await?;
        let args = tool.args.clone().unwrap_or_default();
        return call_local_stdio_tool(command, &args, env.as_ref(), &tool_name, arguments).await;
    }

    execute_local_mcp_tool(store, tool, arguments).await
}

#[cfg_attr(not(test), allow(dead_code))]
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
        let approval_grant_key = risk_assessment.session_grant_key(&tool_fingerprint);
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

        match resolve_approval_decision(&risk_assessment, approved_by_grant) {
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
                        "approved_by_grant": approved_by_grant,
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
                    approval_grant_key,
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
                "approved_by_grant": approved_by_grant,
            }),
        );
        let result = execute_skill_binding(store, &binding, &arguments).await?;
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

    if let Some(result) = execute_or_queue_core_tool_call_with_tool_ref(
        approval_context,
        runtime_state,
        pending_tool_calls,
        tool_id.as_deref(),
        tool_name.as_deref(),
        arguments.clone(),
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
    let approval_grant_key = risk_assessment.session_grant_key(&tool_fingerprint);
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

    match resolve_approval_decision(&risk_assessment, approved_by_grant) {
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
                    approval_grant_key,
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
    let result = execute_mcp_tool(store, &tool, &arguments).await?;
    record_successful_tool_execution(
        store,
        approval_context.session_id.as_deref(),
        &tool.name,
        &result,
    )
    .await;
    Ok(result)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn approve_mcp_tool_inner(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    approve_mcp_tool_inner_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        store,
        pending_tool_calls,
        approval_token,
    )
    .await
}

pub(crate) async fn approve_mcp_tool_inner_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
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
    if let Some(binding) = resolve_skill_binding_by_ref(
        store,
        pending.tool_id.as_deref(),
        Some(pending.tool_name.as_str()),
    )
    .await?
    {
        if skill_binding_fingerprint(&binding) != pending.tool_fingerprint {
            pending_tool_calls.write().await.remove(approval_token);
            return Err(
                "skill binding changed after approval prompt; request was cancelled".to_string(),
            );
        }
        if pending_tool_calls
            .write()
            .await
            .remove(approval_token)
            .is_none()
        {
            return Err("pending tool call already consumed".to_string());
        }
        let result = execute_skill_binding(store, &binding, &pending.arguments).await?;
        record_successful_tool_execution(
            store,
            pending.session_id.as_deref(),
            &binding.callable_name,
            &result,
        )
        .await;
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
        return Ok(result);
    }

    if let Some(result) = execute_core_tool_call_with_tool_ref_internal(
        approval_context,
        runtime_state,
        pending_tool_calls,
        pending.tool_id.as_deref(),
        Some(pending.tool_name.as_str()),
        pending.arguments.clone(),
        true,
    )
    .await?
    {
        if pending_tool_calls
            .write()
            .await
            .remove(approval_token)
            .is_none()
        {
            return Err("pending tool call already consumed".to_string());
        }
        record_successful_tool_execution(
            store,
            pending.session_id.as_deref(),
            &pending.tool_name,
            &result,
        )
        .await;
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
            pending_tool_calls.write().await.remove(approval_token);
            return Err(
                "tool configuration changed after approval prompt; request was cancelled"
                    .to_string(),
            );
        }
    }
    if pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_none()
    {
        return Err("pending tool call already consumed".to_string());
    }
    let result = execute_mcp_tool(store, &tool, &pending.arguments).await?;
    record_successful_tool_execution(
        store,
        pending.session_id.as_deref(),
        &tool.name,
        &result,
    )
    .await;
    if let (Some(runtime), Some(key)) = (runtime_state, pending.approval_grant_key.as_deref()) {
        if let Some(grant) = crate::modules::mcp::SessionApprovalGrant::from_key(key, now as i128) {
            runtime
                .approvals
                .session_approval_grants
                .write()
                .await
                .insert(grant.key.clone(), grant);
        }
    }
    Ok(result)
}

pub(crate) async fn reject_mcp_tool_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> bool {
    pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::{extract_browser_retry_recovered_approval_request, resolve_core_tool_name};
    use crate::modules::capability_control_plane::{
        resolve_official_skill_host_tool_route, OfficialSkillHostToolRoute,
    };

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
}
