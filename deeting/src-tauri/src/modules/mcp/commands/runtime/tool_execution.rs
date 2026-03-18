use super::super::support::*;
use super::remote_transport::{call_local_stdio_tool, call_remote_sse_tool};
use super::tool_resolution::resolve_callable_mcp_tool_by_ref;
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
    require_approval: bool,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        None,
        store,
        pending_tool_calls,
        tool_name,
        arguments,
        require_approval,
    )
    .await
}

pub(crate) async fn execute_or_queue_mcp_tool_call_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    risk_assessment: Option<&crate::modules::mcp::ToolRiskAssessment>,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_tool_ref(
        approval_context,
        risk_assessment,
        runtime_state,
        store,
        pending_tool_calls,
        None,
        Some(tool_name),
        arguments,
        require_approval,
    )
    .await
}

pub(crate) async fn execute_or_queue_mcp_tool_call_with_tool_ref(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    risk_assessment: Option<&crate::modules::mcp::ToolRiskAssessment>,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_id: Option<String>,
    tool_name: Option<String>,
    arguments: Value,
    require_approval: bool,
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
        let tool_fingerprint = skill_binding_fingerprint(&binding);
        let approval_grant_key =
            risk_assessment.and_then(|risk| risk.session_grant_key(&tool_fingerprint));
        let approved_by_grant = if require_approval {
            if let (Some(runtime), Some(key)) = (runtime_state, approval_grant_key.as_ref()) {
                runtime
                    .approvals
                    .session_approval_grants
                    .read()
                    .await
                    .contains_key(key)
            } else {
                false
            }
        } else {
            false
        };

        if require_approval && !approved_by_grant {
            log_skill_binding_stage(
                &binding,
                "approval.required",
                serde_json::json!({
                    "require_approval": require_approval,
                    "approved_by_grant": approved_by_grant,
                    "has_runtime_state": runtime_state.is_some(),
                    "has_risk_assessment": risk_assessment.is_some(),
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
                risk_level: Some(
                    risk_assessment
                        .map(|risk| risk.risk_level.to_string())
                        .unwrap_or_else(|| "MEDIUM".to_string()),
                ),
                risk_reasons: risk_assessment
                    .map(|risk| risk.reasons.clone())
                    .unwrap_or_default(),
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
                "risk_level": risk_assessment.map(|risk| risk.risk_level).unwrap_or("MEDIUM"),
                "risk_reasons": risk_assessment.map(|risk| risk.reasons.clone()).unwrap_or_default(),
                "risk_profile": risk_assessment.map(|risk| risk.metadata_json()),
                "expires_in_ms": 5 * 60 * 1000,
            }));
        }
        log_skill_binding_stage(
            &binding,
            "execute_via_skill_binding.dispatch",
            serde_json::json!({
                "require_approval": require_approval,
                "approved_by_grant": approved_by_grant,
            }),
        );
        return execute_skill_binding(store, &binding, &arguments).await;
    }
    log_skill_binding_lookup_miss(tool_id.as_deref(), tool_name.as_deref());

    let tool = resolve_callable_mcp_tool_by_ref(store, tool_id.as_deref(), tool_name.as_deref())
        .await
        .map_err(|err| err.to_string())?;
    let tool_fingerprint = runtime_state
        .map(|runtime| runtime.tool_fingerprint(&tool))
        .unwrap_or_else(|| tool.config_hash.clone());
    let approval_grant_key =
        risk_assessment.and_then(|risk| risk.session_grant_key(&tool_fingerprint));
    let approved_by_grant = if require_approval {
        if let (Some(runtime), Some(key)) = (runtime_state, approval_grant_key.as_ref()) {
            runtime
                .approvals
                .session_approval_grants
                .read()
                .await
                .contains_key(key)
        } else {
            false
        }
    } else {
        false
    };

    if require_approval && !approved_by_grant {
        let approval_token = Uuid::new_v4().to_string();
        let pending = if let Some(runtime) = runtime_state {
            runtime.build_pending_tool_call(
                Some(tool.id.clone()),
                tool.name.clone(),
                arguments.clone(),
                Some(tool.description.clone()),
                Some(
                    risk_assessment
                        .map(|risk| risk.risk_level.to_string())
                        .unwrap_or_else(|| "HIGH".to_string()),
                ),
                risk_assessment
                    .map(|risk| risk.reasons.clone())
                    .unwrap_or_default(),
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
                risk_level: Some(
                    risk_assessment
                        .map(|risk| risk.risk_level.to_string())
                        .unwrap_or_else(|| "HIGH".to_string()),
                ),
                risk_reasons: risk_assessment
                    .map(|risk| risk.reasons.clone())
                    .unwrap_or_default(),
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
            "arguments": arguments, "description": tool.description, "risk_level": risk_assessment.map(|risk| risk.risk_level).unwrap_or("HIGH"),
            "risk_reasons": risk_assessment.map(|risk| risk.reasons.clone()).unwrap_or_default(), "risk_profile": risk_assessment.map(|risk| risk.metadata_json()), "expires_in_ms": expires_in_ms,
        }));
    }
    execute_mcp_tool(store, &tool, &arguments).await
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
    fn official_skill_host_tool_route_preserves_desktop_capability_dispatch() {
        assert_eq!(
            resolve_official_skill_host_tool_route("monitor.list"),
            OfficialSkillHostToolRoute::DesktopCapability
        );
    }
}
