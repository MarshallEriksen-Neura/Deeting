use super::*;
use crate::modules::custom_task_agents::types::{
    CustomTaskAgentInvocationKind, CustomTaskAgentProfile,
};
use crate::modules::desktop_runtime::runtime::chat_tool_runtime::inflight::mark_delegated_wait_event_consumed;
use crate::modules::desktop_runtime::runtime::execution_plane::{
    build_workflow_delegated_execution_session, DelegatedExecutionSession,
};
use sqlx::Row;

async fn resume_delegated_runtime_with_session(
    app: &AppHandle,
    app_state: &AppState,
    execution_graph_execution_id: &str,
    delegated_run_id: &str,
    event_id: &str,
    delegated_execution: DelegatedExecutionSession,
) -> Result<Option<serde_json::Value>, String> {
    let normalized_execution_id = execution_graph_execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Err("execution_graph_execution_id is required".to_string());
    }

    let context_value =
        load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), normalized_execution_id)
            .await
            .map_err(|err| err.to_string())?
            .ok_or_else(|| {
                format!(
                    "delegated runtime context not found for execution_id {}",
                    normalized_execution_id
                )
            })?;
    let mut persisted = persistable_inflight_context_from_value(&context_value)
        .ok_or_else(|| "delegated runtime context could not be parsed".to_string())?;

    let consumed = mark_delegated_wait_event_consumed(&mut persisted, delegated_run_id, event_id)?;
    let chat_runtime = persisted
        .chat_runtime
        .clone()
        .ok_or_else(|| "delegated runtime context is missing chat_runtime".to_string())?;

    if !consumed {
        return Ok(None);
    }

    persist_execution_graph_runtime_context(
        app_state.mcp.store.as_ref(),
        normalized_execution_id,
        &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
    )
    .await
    .map_err(|err| err.to_string())?;

    let mut state = runtime_state_from_persisted_context(chat_runtime);
    state
        .orchestrated_messages
        .extend(delegated_execution.feedback_messages.clone());

    let session_id = state.session_id.clone();
    let model_connection = state.model_connection.clone();
    let execution_policy = state.execution_policy.clone();
    match continue_local_chat_complete_with_tools(app, app_state, state).await {
        Ok(mut output) => {
            attach_execution_graph_to_response(
                &mut output.response,
                &session_id,
                &execution_policy,
                Some(normalized_execution_id),
                true,
            );
            if let Err(err) = persist_resumed_local_chat_assistant_message(
                app_state,
                &session_id,
                &model_connection,
                &output.response,
            )
            .await
            {
                log::warn!("{err}");
            }
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                Some(normalized_execution_id),
            )
            .await;
            Ok(Some(output.response))
        }
        Err(err) => {
            persisted.last_error = Some(err.clone());
            if let Some(delegation) = persisted.delegation.as_mut() {
                delegation.last_status = Some("failed".to_string());
            }
            persist_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                normalized_execution_id,
                &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
            )
            .await
            .map_err(|persist_err| persist_err.to_string())?;
            Err(err)
        }
    }
}

pub(crate) async fn resume_delegated_runtime_after_workflow_event(
    app: &AppHandle,
    app_state: &AppState,
    execution_graph_execution_id: &str,
    workflow_run_id: &str,
    event_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    let detail =
        crate::modules::workflow::service::get_workflow_run_status(app_state, workflow_run_id)
            .await?;
    let delegated_execution = build_workflow_delegated_execution_session(
        execution_graph_execution_id.trim().to_string(),
        CustomTaskAgentProfile {
            id: "workflow".to_string(),
            name: "Workflow".to_string(),
            description: None,
            task_prompt: "delegated workflow wake resume".to_string(),
            invocation_kind: CustomTaskAgentInvocationKind::Chat,
            preferred_for_image_generation: false,
            model_config: None,
            callable_mcp_tool_ids: Vec::new(),
            guidance_skill_ids: Vec::new(),
            callable_skill_action_refs: Vec::new(),
            bound_asset_id: None,
            tags: Vec::new(),
            discoverable: false,
            is_enabled: true,
            is_deleted: false,
            source_kind: Some("delegated_workflow_runtime".to_string()),
            source_path: None,
            source_repo: None,
            source_ref: None,
            source_hash: None,
            created_at: "1970-01-01T00:00:00Z".to_string(),
            updated_at: "1970-01-01T00:00:00Z".to_string(),
        },
        DelegatedExecutionSelection {
            explicit: false,
            score: None,
            reason_codes: Vec::new(),
            reason_text: Some("delegated workflow wake resume".to_string()),
            candidate_count: 0,
            selected_from_top_k: 0,
            callable_coverage_score: None,
            modality_fit_score: None,
            profile_prior_score: None,
        },
        None,
        "workflow".to_string(),
        Ok(crate::modules::workflow::types::QuickWorkflowResult {
            run: detail.run.clone(),
            steps: detail.steps.clone(),
            content: crate::modules::workflow::service::extract_primary_content(&detail),
            succeeded: detail.run.status
                == crate::modules::workflow::types::WorkflowRunStatus::Completed,
        }),
    );

    resume_delegated_runtime_with_session(
        app,
        app_state,
        execution_graph_execution_id,
        workflow_run_id,
        event_id,
        delegated_execution,
    )
    .await
}

pub(crate) async fn wake_delegated_runtime_for_workflow_run(
    app: &AppHandle,
    app_state: &AppState,
    workflow_run_id: &str,
    event_id: &str,
) -> Result<bool, String> {
    let normalized_workflow_run_id = workflow_run_id.trim();
    if normalized_workflow_run_id.is_empty() {
        return Err("workflow_run_id is required".to_string());
    }

    let rows = list_execution_graph_runtime_contexts(app_state.mcp.store.as_ref())
        .await
        .map_err(|err| err.to_string())?;
    for row in rows {
        let Some(context) = persistable_inflight_context_from_value(&row.context) else {
            continue;
        };
        let Some(delegation) = context.delegation.as_ref() else {
            continue;
        };
        if delegation.delegated_run_id.trim() != normalized_workflow_run_id {
            continue;
        }
        return Ok(resume_delegated_runtime_after_workflow_event(
            app,
            app_state,
            row.execution_id.as_str(),
            normalized_workflow_run_id,
            event_id,
        )
        .await?
        .is_some());
    }

    Ok(false)
}

pub(crate) async fn resume_delegated_runtime_after_custom_task_agent_run(
    app: &AppHandle,
    app_state: &AppState,
    execution_graph_execution_id: &str,
    child_run_id: &str,
    event_id: &str,
    delegated_execution: DelegatedExecutionSession,
) -> Result<Option<serde_json::Value>, String> {
    resume_delegated_runtime_with_session(
        app,
        app_state,
        execution_graph_execution_id,
        child_run_id,
        event_id,
        delegated_execution,
    )
    .await
}

fn apply_approved_tool_result_to_suspended_round(
    suspended: &mut SuspendedChatToolExecution,
    approval_token: &str,
    call_id: Option<&str>,
    tool_result: &serde_json::Value,
) {
    apply_approved_tool_result_to_execution_graph(
        suspended,
        Some(approval_token),
        call_id,
        tool_result,
    );
}

pub(super) fn build_local_chat_resume_continuation_blocks(
    resumed_response: &serde_json::Value,
    continuation_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let mut blocks = if continuation_meta.is_empty() {
        resumed_response
            .get("execution_graph")
            .map(project_execution_graph_blocks_from_value)
            .unwrap_or_default()
    } else {
        build_local_tool_trace_blocks(continuation_meta)
    };
    let response_text = extract_resume_response_text(
        resumed_response
            .get("content")
            .unwrap_or(&serde_json::Value::Null),
    );
    if !response_text.trim().is_empty() {
        blocks.push(serde_json::json!({
            "type": "text",
            "content": response_text,
        }));
    }
    blocks
}

pub(super) fn extract_resume_response_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(items) => {
            let mut out = Vec::new();
            for item in items {
                let Some(object) = item.as_object() else {
                    continue;
                };
                let text = object
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| object.get("content").and_then(serde_json::Value::as_str))
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(text) = text {
                    out.push(text.to_string());
                }
            }
            out.join("\n")
        }
        serde_json::Value::Object(object) => object
            .get("text")
            .and_then(serde_json::Value::as_str)
            .or_else(|| object.get("content").and_then(serde_json::Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| {
                serde_json::to_string(&serde_json::Value::Object(object.clone()))
                    .unwrap_or_default()
            }),
        serde_json::Value::Null => String::new(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

pub(super) fn build_persisted_resume_assistant_blocks(
    resumed_response: &serde_json::Value,
) -> Vec<serde_json::Value> {
    let mut blocks = resumed_response
        .get("tool_trace_blocks")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            resumed_response
                .get("execution_graph")
                .map(project_execution_graph_blocks_from_value)
                .unwrap_or_default()
        });

    let response_text = extract_resume_response_text(
        resumed_response
            .get("content")
            .unwrap_or(&serde_json::Value::Null),
    );
    if !response_text.trim().is_empty() {
        blocks.push(serde_json::json!({
            "type": "text",
            "content": response_text,
        }));
    }

    blocks
}

pub(super) fn build_persisted_resume_assistant_meta(
    resumed_response: &serde_json::Value,
    model_connection: &LocalModelConnection,
) -> serde_json::Value {
    let mut meta = serde_json::Map::new();
    let blocks = build_persisted_resume_assistant_blocks(resumed_response);
    if !blocks.is_empty() {
        meta.insert("blocks".to_string(), serde_json::Value::Array(blocks));
    }
    meta.insert(
        "model_id".to_string(),
        serde_json::Value::String(model_connection.model_id.clone()),
    );
    meta.insert(
        "provider_model_id".to_string(),
        serde_json::Value::String(model_connection.provider_model_id.clone()),
    );
    if let Some(runtime_metrics) = resumed_response.get("runtime_metrics").cloned() {
        meta.insert("runtime_metrics".to_string(), runtime_metrics);
    }
    if let Some(execution_graph) = resumed_response.get("execution_graph").cloned() {
        meta.insert("execution_graph".to_string(), execution_graph);
    }
    serde_json::Value::Object(meta)
}

pub(super) fn attach_execution_graph_to_response(
    response: &mut serde_json::Value,
    session_id: &str,
    execution_policy: &LocalExecutionPolicy,
    root_execution_id: Option<&str>,
    force_rebuild: bool,
) {
    if !force_rebuild && response.get("execution_graph").is_some() {
        return;
    }
    if force_rebuild {
        if let Some(object) = response.as_object_mut() {
            object.remove("execution_graph");
        }
    }
    let tool_trace_blocks = response
        .get("tool_trace_blocks")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let execution_graph = project_execution_graph_snapshot(GraphProjectionInput {
        session_id: session_id.to_string(),
        route: execution_policy.route.as_str().to_string(),
        plane: execution_policy.plane.as_str().to_string(),
        trace_id: None,
        request_id: None,
        root_execution_id: root_execution_id.map(str::to_string),
        response_content: response.get("content").cloned(),
        tool_trace_blocks,
        delegated_execution_tree: None,
    })
    .to_value();
    if let Some(object) = response.as_object_mut() {
        object.insert("execution_graph".to_string(), execution_graph);
    }
}

pub(super) async fn persist_resumed_local_chat_assistant_message(
    app_state: &AppState,
    session_id: &str,
    model_connection: &LocalModelConnection,
    resumed_response: &serde_json::Value,
) -> Result<(), String> {
    if resumed_response
        .get("execution_graph")
        .is_some_and(|execution_graph| {
            !pending_approval_gate_ids_from_graph(execution_graph).is_empty()
        })
    {
        return Err(format!(
            "chat step=append_resumed_assistant_message blocked because execution_graph still has pending approval gates session={} ",
            session_id
        ));
    }

    let assistant_meta = build_persisted_resume_assistant_meta(resumed_response, model_connection);

    app_state
        .mcp
        .store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.to_string(),
            role: "assistant".to_string(),
            content: String::new(),
            name: None,
            meta_info: Some(assistant_meta),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map(|_| ())
        .map_err(|err| {
            format!(
                "chat step=append_resumed_assistant_message session={} err={}",
                session_id, err
            )
        })?;

    let latest_turn_index = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COALESCE(MAX(turn_index), 0)
        FROM conversation_message
        WHERE session_id = ? AND is_deleted = 0;
        "#,
    )
    .bind(session_id)
    .fetch_one(&app_state.mcp.store.pool)
    .await
    .map_err(|err| {
        format!(
            "chat step=read_latest_turn_after_resumed_assistant_message session={} err={}",
            session_id, err
        )
    })?;

    if latest_turn_index > 0 {
        if let Err(err) = app_state
            .mcp
            .store
            .soft_delete_stale_pending_approval_assistant_messages_before_turn(
                session_id,
                latest_turn_index,
            )
            .await
        {
            log::warn!(
                "soft_delete_stale_pending_approval_assistant_messages_before_turn failed session={} turn={} err={}",
                session_id,
                latest_turn_index,
                err
            );
        }
    }

    if let Some(execution_graph) = resumed_response.get("execution_graph") {
        if let Err(err) = persist_execution_graph_snapshot(
            app_state.mcp.store.as_ref(),
            execution_graph,
            session_id,
            "desktop_local_chat_resume",
            None,
            Some("completed"),
        )
        .await
        {
            log::warn!(
                "persist_execution_graph_snapshot failed session={} err={}",
                session_id,
                err
            );
        }
    }

    Ok(())
}

fn pending_approval_call_ids_from_graph(execution_graph: &serde_json::Value) -> Vec<String> {
    build_tool_call_meta_from_execution_graph(execution_graph)
        .into_iter()
        .filter(|item| {
            item.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| status.eq_ignore_ascii_case("requires_approval"))
        })
        .filter_map(|item| {
            item.get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn pending_approval_gate_ids_from_graph(execution_graph: &serde_json::Value) -> Vec<String> {
    execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|node| {
            node.get("node_type")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|node_type| node_type == "approval_gate")
        })
        .filter(|node| {
            node.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| {
                    matches!(status, "waiting_approval" | "approving" | "approval_failed")
                })
        })
        .filter_map(|node| {
            node.get("node_id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn next_pending_approval_tokens_from_graph(execution_graph: &serde_json::Value) -> Vec<String> {
    execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|node| {
            node.get("node_type")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|node_type| node_type == "approval_gate")
        })
        .filter(|node| {
            node.get("status")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|status| {
                    matches!(status, "waiting_approval" | "approving" | "approval_failed")
                })
        })
        .filter_map(|node| {
            node.get("metadata")
                .and_then(|value| value.get("approval_token"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn validate_waiting_approval_payload_consistency(
    consumed_approval_token: Option<&str>,
    resolved_gate_node_id: &str,
    execution_graph: &serde_json::Value,
) -> Result<(), String> {
    let pending_tokens = next_pending_approval_tokens_from_graph(execution_graph);
    let gate_still_waiting = execution_graph
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .find(|node| {
            node.get("node_id").and_then(serde_json::Value::as_str) == Some(resolved_gate_node_id)
        })
        .and_then(|node| node.get("status").and_then(serde_json::Value::as_str))
        .is_some_and(|status| status.eq_ignore_ascii_case("waiting_approval"));

    if gate_still_waiting {
        return Err(format!(
            "resolved approval gate '{}' is still waiting_approval in the returned graph",
            resolved_gate_node_id
        ));
    }

    if let Some(consumed_token) = consumed_approval_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if pending_tokens.iter().any(|token| token == consumed_token) {
            return Err(format!(
                "consumed approval token '{}' still appears in next_pending_approval_tokens",
                consumed_token
            ));
        }
    }

    Ok(())
}

fn build_local_chat_waiting_approval_payload(
    approval_token: &str,
    resolved_gate_node_id: &str,
    resolved_call_id: &str,
    execution_graph: &serde_json::Value,
    approved_tool_result: &serde_json::Value,
    continuation_blocks: Vec<serde_json::Value>,
    execution_graph_execution_id: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "status": "LOCAL_CHAT_WAITING_APPROVAL",
        "approval_token": approval_token,
        "resolved_gate_node_id": resolved_gate_node_id,
        "resolved_call_id": resolved_call_id,
        "approved_tool_result": approved_tool_result,
        "continuation_blocks": continuation_blocks,
        "execution_graph": execution_graph,
        "execution_graph_execution_id": execution_graph_execution_id,
        "pending_approval_gate_ids": pending_approval_gate_ids_from_graph(execution_graph),
        "next_pending_approval_tokens": next_pending_approval_tokens_from_graph(execution_graph),
    })
}

fn build_local_chat_resumed_payload(
    approval_token: &str,
    resolved_gate_node_id: &str,
    resolved_call_id: &str,
    approved_tool_result: &serde_json::Value,
    resumed_response: &serde_json::Value,
    continuation_meta: &[serde_json::Value],
) -> serde_json::Value {
    let execution_graph = resumed_response.get("execution_graph").cloned();
    serde_json::json!({
        "status": "LOCAL_CHAT_RESUMED",
        "approval_token": approval_token,
        "resolved_gate_node_id": resolved_gate_node_id,
        "resolved_call_id": resolved_call_id,
        "approved_tool_result": approved_tool_result,
        "continuation_blocks": build_local_chat_resume_continuation_blocks(
            resumed_response,
            continuation_meta,
        ),
        "execution_graph": execution_graph,
        "execution_graph_execution_id": resumed_response
            .get("execution_graph")
            .and_then(|value| value.get("execution_id"))
            .cloned(),
        "pending_approval_gate_ids": execution_graph
            .as_ref()
            .map(pending_approval_gate_ids_from_graph)
            .unwrap_or_default(),
        "next_pending_approval_tokens": execution_graph
            .as_ref()
            .map(next_pending_approval_tokens_from_graph)
            .unwrap_or_default(),
        "response": resumed_response,
    })
}

fn build_local_chat_resume_failed_payload(
    approval_token: &str,
    resolved_gate_node_id: Option<&str>,
    resolved_call_id: Option<&str>,
    approved_tool_result: &serde_json::Value,
    execution_graph: &serde_json::Value,
    execution_graph_execution_id: Option<&str>,
    error_code: &str,
    error: &str,
    retryable: bool,
) -> serde_json::Value {
    serde_json::json!({
        "status": "LOCAL_CHAT_RESUME_FAILED",
        "approval_token": approval_token,
        "resolved_gate_node_id": resolved_gate_node_id,
        "resolved_call_id": resolved_call_id,
        "approved_tool_result": approved_tool_result,
        "continuation_blocks": [],
        "execution_graph": execution_graph,
        "execution_graph_execution_id": execution_graph_execution_id,
        "pending_approval_gate_ids": pending_approval_gate_ids_from_graph(execution_graph),
        "next_pending_approval_tokens": next_pending_approval_tokens_from_graph(execution_graph),
        "error_code": error_code,
        "error": error,
        "retryable": retryable,
    })
}

async fn advance_local_chat_execution_from_graph_state(
    app: &AppHandle,
    app_state: &AppState,
    mut suspended: SuspendedChatToolExecution,
    consumed_approval_token: Option<&str>,
    resolved_call_id: Option<&str>,
    approved_tool_result: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let pending_response = suspended
        .last_response
        .clone()
        .unwrap_or_else(|| serde_json::json!({ "content": "" }));
    let pending_response = strip_stale_resume_response_metadata(pending_response);
    let graph_pending_tool_call_meta = suspended.pending_tool_call_meta();
    let pending_results = summarize_tool_call_meta_results(&graph_pending_tool_call_meta);
    let root_execution_id = suspended
        .execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let resolved_call_id = resolved_call_id
        .unwrap_or(suspended.pending_call_id())
        .trim()
        .to_string();
    let resolved_gate_node_id = suspended
        .approval_gate_node_id_for_call_id(resolved_call_id.as_str())
        .unwrap_or_else(|| suspended.pending_gate_node_id().to_string());
    let post_approval_graph = suspended.execution_graph.clone();
    let remaining_pending_call_ids = if let Some(approval_token) = consumed_approval_token {
        suspended.sync_remaining_pending_approvals(approval_token)
    } else {
        suspended.pending_requires_approval_call_ids()
    };

    if !remaining_pending_call_ids.is_empty() {
        // Graph-authoritative: use the graph projection instead of the in-memory list.
        // `sync_remaining_pending_approvals` already trimmed consumed entries above, but
        // this second filter guarantees nothing that has drifted past `waiting_approval`
        // (e.g. a gate the graph already marked "approving" out-of-band) can sneak back
        // into the persisted snapshot.
        let persisted_pending_approvals = derive_pending_approvals_from_graph(&suspended);
        if let Err(err) = persist_suspended_execution_graph_runtime(
            app_state.mcp.store.as_ref(),
            &suspended,
            &persisted_pending_approvals,
            "desktop_local_chat_approval_applied",
            "waiting_approval",
            InFlightExecutionStage::WaitingApproval,
            None,
        )
        .await
        {
            log::warn!(
                "persist approved execution graph failed approval_token={} err={}",
                consumed_approval_token.unwrap_or("resume"),
                err
            );
        }

        if let Err(err) = validate_waiting_approval_payload_consistency(
            consumed_approval_token,
            resolved_gate_node_id.as_str(),
            suspended.execution_graph(),
        ) {
            log::error!(
                "approval_waiting_payload_invariant_failed approval_token={} resolved_gate={} err={}",
                consumed_approval_token.unwrap_or_default(),
                resolved_gate_node_id,
                err
            );
            return Ok(build_local_chat_resume_failed_payload(
                consumed_approval_token.unwrap_or_default(),
                Some(resolved_gate_node_id.as_str()),
                Some(resolved_call_id.as_str()),
                approved_tool_result,
                suspended.execution_graph(),
                root_execution_id.as_deref(),
                "LOCAL_CHAT_WAITING_PAYLOAD_INVARIANT_FAILED",
                err.as_str(),
                false,
            ));
        }

        return Ok(build_local_chat_waiting_approval_payload(
            consumed_approval_token.unwrap_or_default(),
            resolved_gate_node_id.as_str(),
            resolved_call_id.as_str(),
            suspended.execution_graph(),
            approved_tool_result,
            build_local_chat_resume_continuation_blocks(
                &serde_json::json!({
                    "execution_graph": suspended.execution_graph().clone(),
                    "content": "",
                }),
                &suspended.pending_tool_call_meta(),
            ),
            root_execution_id.as_deref(),
        ));
    }

    if let Err(err) = persist_suspended_execution_graph_runtime(
        app_state.mcp.store.as_ref(),
        &suspended,
        &[],
        "desktop_local_chat_approval_resuming",
        "active",
        InFlightExecutionStage::ResumingAfterApproval,
        None,
    )
    .await
    {
        log::warn!(
            "persist approved execution graph failed approval_token={} err={}",
            consumed_approval_token.unwrap_or("resume"),
            err
        );
    }

    let resume_gate_node_id = suspended.pending_gate_node_id().to_string();
    let resume_call_id = suspended.pending_call_id().to_string();
    let mut state = suspended.into_runtime_state();
    let session_id = state.session_id.clone();
    let model_connection = state.model_connection.clone();
    let execution_policy = state.execution_policy.clone();
    finalize_tool_round(
        &mut state.orchestrated_messages,
        &mut state.active_capability,
        &state.model_connection.protocol_family,
        state.round,
        &pending_response,
        &graph_pending_tool_call_meta,
        &pending_results,
    );
    state.last_response = Some(enrich_response_with_tool_trace(
        pending_response,
        &graph_pending_tool_call_meta,
        false,
        &state.runtime_metrics,
    ));
    rewind_round_for_post_approval_continuation(&mut state);
    let failed_chat_runtime = super::inflight::PersistedChatToolRuntimeContext {
        max_rounds: state.max_rounds,
        round: state.round,
        trace_id: state.trace_id.clone(),
        request_id: state.request_id.clone(),
        execution_policy: state.execution_policy.clone(),
        model_connection: state.model_connection.clone(),
        orchestrated_messages: state.orchestrated_messages.clone(),
        task_query: state.task_query.clone(),
        session_id: state.session_id.clone(),
        temperature: state.temperature,
        max_tokens: state.max_tokens,
        reasoning_enabled: state.reasoning_enabled,
        reasoning_effort: state.reasoning_effort.clone(),
        active_capability: state.active_capability.clone(),
        active_skill_context: state.active_skill_context.clone(),
        runtime_metrics: state.runtime_metrics.clone(),
        last_capability_snapshot: state.last_capability_snapshot.clone(),
        last_response: state.last_response.clone(),
    };
    let failed_trace_id = state.trace_id.clone();
    let failed_request_id = state.request_id.clone();

    match continue_local_chat_complete_with_tools(app, app_state, state).await {
        Ok(mut output) => {
            attach_execution_graph_to_response(
                &mut output.response,
                &session_id,
                &execution_policy,
                root_execution_id.as_deref(),
                true,
            );
            let pending_gate_ids_after_resume = output
                .response
                .get("execution_graph")
                .map(pending_approval_gate_ids_from_graph)
                .unwrap_or_default();
            if !pending_gate_ids_after_resume.is_empty() {
                if let Some(execution_graph) = output.response.get("execution_graph") {
                    if let Err(err) = persist_execution_graph_snapshot(
                        app_state.mcp.store.as_ref(),
                        execution_graph,
                        &session_id,
                        "desktop_local_chat_resume_waiting_approval",
                        None,
                        Some("waiting_approval"),
                    )
                    .await
                    {
                        log::warn!(
                            "persist post-resume waiting execution graph failed session={} err={}",
                            session_id,
                            err
                        );
                    }
                }
                let continuation_meta = build_effective_tool_call_meta(&output.response, &[]);
                let waiting_graph = output
                    .response
                    .get("execution_graph")
                    .unwrap_or(&serde_json::Value::Null);
                if let Err(err) = validate_waiting_approval_payload_consistency(
                    consumed_approval_token,
                    resolved_gate_node_id.as_str(),
                    waiting_graph,
                ) {
                    log::error!(
                        "approval_waiting_payload_invariant_failed approval_token={} resolved_gate={} err={}",
                        consumed_approval_token.unwrap_or_default(),
                        resolved_gate_node_id,
                        err
                    );
                    return Ok(build_local_chat_resume_failed_payload(
                        consumed_approval_token.unwrap_or_default(),
                        Some(resolved_gate_node_id.as_str()),
                        Some(resolved_call_id.as_str()),
                        approved_tool_result,
                        waiting_graph,
                        output
                            .response
                            .get("execution_graph")
                            .and_then(|value| value.get("execution_id"))
                            .and_then(serde_json::Value::as_str),
                        "LOCAL_CHAT_WAITING_PAYLOAD_INVARIANT_FAILED",
                        err.as_str(),
                        false,
                    ));
                }

                return Ok(build_local_chat_waiting_approval_payload(
                    consumed_approval_token.unwrap_or_default(),
                    resolved_gate_node_id.as_str(),
                    resolved_call_id.as_str(),
                    output
                        .response
                        .get("execution_graph")
                        .unwrap_or(&serde_json::Value::Null),
                    approved_tool_result,
                    build_local_chat_resume_continuation_blocks(
                        &output.response,
                        &continuation_meta,
                    ),
                    output
                        .response
                        .get("execution_graph")
                        .and_then(|value| value.get("execution_id"))
                        .and_then(serde_json::Value::as_str),
                ));
            }
            if let Err(err) = persist_resumed_local_chat_assistant_message(
                app_state,
                &session_id,
                &model_connection,
                &output.response,
            )
            .await
            {
                log::warn!("{err}");
            }
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                root_execution_id.as_deref(),
            )
            .await;
            let continuation_meta = build_effective_tool_call_meta(&output.response, &[]);
            Ok(build_local_chat_resumed_payload(
                consumed_approval_token.unwrap_or_default(),
                resolved_gate_node_id.as_str(),
                resolved_call_id.as_str(),
                approved_tool_result,
                &output.response,
                &continuation_meta,
            ))
        }
        Err(err) => {
            if let Err(persist_err) = persist_execution_graph_snapshot(
                app_state.mcp.store.as_ref(),
                &post_approval_graph,
                &session_id,
                "desktop_local_chat_resume_failed",
                None,
                Some("failed"),
            )
            .await
            {
                log::warn!(
                    "persist_execution_graph_snapshot failed session={} err={}",
                    session_id,
                    persist_err
                );
            }
            if let Some(execution_id) = root_execution_id.as_deref() {
                let failed_context = serialize_inflight_runtime_context(
                    InFlightExecutionStage::ResumeFailed,
                    Some(resume_gate_node_id.clone()),
                    Some(resume_call_id.clone()),
                    true,
                    Vec::new(),
                    Some(failed_chat_runtime.clone()),
                    session_id.as_str(),
                    failed_trace_id.as_str(),
                    failed_request_id.as_deref(),
                    Some(execution_id),
                    Some(err.as_str()),
                );
                if let Err(persist_err) = persist_execution_graph_runtime_context(
                    app_state.mcp.store.as_ref(),
                    execution_id,
                    &failed_context,
                )
                .await
                {
                    log::warn!(
                        "persist_execution_graph_runtime_context failed execution_id={} err={}",
                        execution_id,
                        persist_err
                    );
                }
            }

            Ok(build_local_chat_resume_failed_payload(
                consumed_approval_token.unwrap_or_default(),
                Some(resolved_gate_node_id.as_str()),
                Some(resolved_call_id.as_str()),
                approved_tool_result,
                &post_approval_graph,
                root_execution_id.as_deref(),
                "LOCAL_CHAT_RESUME_FAILED",
                err.as_str(),
                true,
            ))
        }
    }
}

pub(crate) async fn project_local_chat_approval_state_payload(
    app_state: &AppState,
    execution_graph_execution_id: &str,
    fallback_error: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let normalized_execution_id = execution_graph_execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Ok(None);
    }

    let Some(execution_graph) =
        load_execution_graph_snapshot(app_state.mcp.store.as_ref(), normalized_execution_id)
            .await
            .map_err(|err| err.to_string())?
    else {
        return Ok(None);
    };

    let persisted =
        load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), normalized_execution_id)
            .await
            .map_err(|err| err.to_string())?
            .and_then(|value| persistable_inflight_context_from_value(&value));
    let continuation_blocks = build_local_chat_resume_continuation_blocks(
        &serde_json::json!({
            "execution_graph": execution_graph.clone(),
            "content": "",
        }),
        &build_tool_call_meta_from_execution_graph(&execution_graph),
    );
    let pending_call_ids = pending_approval_call_ids_from_graph(&execution_graph);

    if !pending_call_ids.is_empty() {
        return Ok(Some(build_local_chat_resume_failed_payload(
            normalized_execution_id,
            None,
            None,
            &serde_json::Value::Null,
            &execution_graph,
            Some(normalized_execution_id),
            "LOCAL_CHAT_APPROVAL_FALLBACK_STALE",
            fallback_error.unwrap_or(
                "approval continuation fell back to a stale waiting graph; resolved gate identity was unavailable",
            ),
            true,
        )));
    }

    if persisted
        .as_ref()
        .is_some_and(|context| context.stage == InFlightExecutionStage::ResumeFailed)
    {
        let error = persisted
            .as_ref()
            .and_then(|context| context.last_error.clone())
            .or_else(|| fallback_error.map(str::to_string));
        let mut payload = build_local_chat_resume_failed_payload(
            normalized_execution_id,
            None,
            None,
            &serde_json::Value::Null,
            &execution_graph,
            Some(normalized_execution_id),
            "LOCAL_CHAT_RESUME_FAILED",
            error.as_deref().unwrap_or_default(),
            true,
        );
        if let Some(object) = payload.as_object_mut() {
            object.insert(
                "continuation_blocks".to_string(),
                serde_json::Value::Array(continuation_blocks),
            );
        }
        return Ok(Some(payload));
    }

    Ok(Some(build_local_chat_resume_failed_payload(
        normalized_execution_id,
        None,
        None,
        &serde_json::Value::Null,
        &execution_graph,
        Some(normalized_execution_id),
        "LOCAL_CHAT_RESUME_FALLBACK_NO_IDENTITY",
        fallback_error.unwrap_or(
            "approval continuation returned a terminal fallback snapshot without resolved gate identity",
        ),
        true,
    )))
}

pub(crate) async fn resume_suspended_chat_tool_execution_after_approval(
    app: &AppHandle,
    app_state: &AppState,
    approval_token: &str,
    tool_result: &serde_json::Value,
    call_id: Option<&str>,
    execution_graph_execution_id: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let mut suspended = if let Some(suspended) = load_suspended_chat_tool_execution_for_resume(
        app_state,
        approval_token,
        execution_graph_execution_id,
    )
    .await?
    {
        suspended
    } else {
        return Ok(None);
    };

    apply_approved_tool_result_to_suspended_round(
        &mut suspended,
        approval_token,
        call_id,
        tool_result,
    );
    if let Some(pending) = suspended
        .pending_approvals
        .iter_mut()
        .find(|pending| pending.approval_token.trim() == approval_token.trim())
    {
        pending.approval_status = Some("approved".to_string());
    }
    Ok(Some(
        advance_local_chat_execution_from_graph_state(
            app,
            app_state,
            suspended,
            Some(approval_token),
            call_id,
            tool_result,
        )
        .await?,
    ))
}

fn recovery_assistant_meta(
    execution_graph: &serde_json::Value,
    execution_id: &str,
    stage: &str,
    available_actions: &[&str],
) -> Option<serde_json::Value> {
    crate::modules::desktop_runtime::runtime::assistant_persistence::with_assistant_persistence_state(
        Some(serde_json::json!({
            "execution_graph": execution_graph,
            "recovery": {
                "execution_id": execution_id,
                "stage": stage,
                "available_actions": available_actions,
            }
        })),
        crate::modules::desktop_runtime::runtime::assistant_persistence::AssistantPersistenceState {
            assistant_message_persisted: true,
            execution_graph_persisted: true,
            postprocess_completed: true,
        },
    )
}

async fn recovery_message_exists(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_id: &str,
) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM conversation_message
        WHERE session_id = ?
          AND role = 'assistant'
          AND is_deleted = 0
          AND (
            json_extract(meta_info, '$.recovery.execution_id') = ?
            OR json_extract(meta_info, '$.execution_graph.execution_id') = ?
          )
        "#,
    )
    .bind(session_id)
    .bind(execution_id)
    .bind(execution_id)
    .fetch_one(&store.pool)
    .await
    .map_err(|err| err.to_string())?;
    Ok(count > 0)
}

async fn find_recovery_message_turn_and_meta(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_id: &str,
) -> Result<Option<(i64, serde_json::Value)>, String> {
    let row = sqlx::query(
        r#"
        SELECT turn_index, meta_info
        FROM conversation_message
        WHERE session_id = ?
          AND role = 'assistant'
          AND is_deleted = 0
          AND json_extract(meta_info, '$.recovery.execution_id') = ?
        ORDER BY turn_index DESC
        LIMIT 1
        "#,
    )
    .bind(session_id)
    .bind(execution_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|err| err.to_string())?;

    let Some(row) = row else {
        return Ok(None);
    };
    let turn_index: i64 = row.try_get("turn_index").map_err(|err| err.to_string())?;
    let meta_info_text: Option<String> = row.try_get("meta_info").map_err(|err| err.to_string())?;
    let Some(meta_info_text) = meta_info_text else {
        return Ok(None);
    };
    let meta_info = serde_json::from_str::<serde_json::Value>(&meta_info_text)
        .map_err(|err| err.to_string())?;
    Ok(Some((turn_index, meta_info)))
}

async fn resolve_recovery_prompt_message(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_id: &str,
    action: &str,
) -> Result<(), String> {
    let Some((turn_index, mut meta_info)) =
        find_recovery_message_turn_and_meta(store, session_id, execution_id).await?
    else {
        return Ok(());
    };

    let Some(recovery) = meta_info
        .get_mut("recovery")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return Ok(());
    };

    recovery.insert(
        "available_actions".to_string(),
        serde_json::Value::Array(Vec::new()),
    );
    recovery.insert(
        "resolved_action".to_string(),
        serde_json::Value::String(action.to_string()),
    );
    recovery.insert(
        "resolved_at_unix_ms".to_string(),
        serde_json::json!(now_unix_ms_i64()),
    );

    store
        .update_local_conversation_assistant_meta_info(session_id, turn_index, Some(meta_info))
        .await
        .map_err(|err| err.to_string())
}

async fn append_recovery_assistant_message_if_missing(
    store: &crate::modules::mcp::store::McpStore,
    session_id: &str,
    execution_graph: &serde_json::Value,
    execution_id: &str,
    stage: &str,
    content: &str,
    available_actions: &[&str],
) -> Result<(), String> {
    if recovery_message_exists(store, session_id, execution_id).await? {
        return Ok(());
    }
    store
        .append_local_conversation_message(CreateConversationMessageRequest {
            session_id: session_id.to_string(),
            role: "assistant".to_string(),
            content: content.to_string(),
            name: None,
            meta_info: recovery_assistant_meta(
                execution_graph,
                execution_id,
                stage,
                available_actions,
            ),
            is_truncated: Some(false),
            parent_message_id: None,
        })
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(super) fn mark_inflight_execution_interrupted(
    execution_graph: &mut serde_json::Value,
    current_call_id: Option<&str>,
    message: &str,
) {
    let execution_id = execution_graph
        .get("execution_id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    apply_rejected_tool_result_to_execution_graph_value(
        execution_graph,
        execution_id.as_deref(),
        current_call_id,
        message,
    );
    if let Some(metadata) = execution_graph
        .get_mut("metadata")
        .and_then(serde_json::Value::as_object_mut)
    {
        metadata.insert("status".to_string(), serde_json::json!("interrupted"));
        metadata.insert("interrupted_reason".to_string(), serde_json::json!(message));
    }
}

pub(crate) async fn recover_inflight_local_execution_state(
    _app: &AppHandle,
    app_state: &AppState,
) -> Result<(), String> {
    let store = app_state.mcp.store.as_ref();
    let rows = list_execution_graph_runtime_contexts(store)
        .await
        .map_err(|err| err.to_string())?;

    for row in rows {
        let Some(mut persisted) = persistable_inflight_context_from_value(&row.context) else {
            continue;
        };
        let Some(execution_id) = persisted
            .execution_graph_execution_id
            .clone()
            .or_else(|| Some(row.execution_id.clone()))
        else {
            continue;
        };

        match persisted.stage {
            InFlightExecutionStage::WaitingApproval => {
                // Graph is authoritative. Load it first and compute which tokens are
                // STILL waiting; only those are safe to resurrect into the in-memory
                // map. Anything else in `persisted.pending_approvals` is a zombie left
                // behind by a prior approve/reject that crashed before the runtime
                // context could be cleared. Fixes Vector D (cold-start replay).
                let graph_snapshot = load_execution_graph_snapshot(store, execution_id.as_str())
                    .await
                    .map_err(|err| err.to_string())?;
                let waiting_tokens = graph_snapshot
                    .as_ref()
                    .map(collect_waiting_approval_tokens_from_graph)
                    .unwrap_or_default();

                let skipped_stale = persisted
                    .pending_approvals
                    .iter()
                    .filter(|pending| !waiting_tokens.contains(pending.approval_token.trim()))
                    .count();
                if skipped_stale > 0 {
                    log::warn!(
                        "recovery_skipped_stale_pending_approvals execution_id={} skipped={} total_persisted={}",
                        execution_id,
                        skipped_stale,
                        persisted.pending_approvals.len(),
                    );
                }
                if let Some(execution_graph) = graph_snapshot {
                    append_recovery_assistant_message_if_missing(
                        store,
                        persisted.session_id.as_str(),
                        &execution_graph,
                        execution_id.as_str(),
                        "waiting_approval",
                        "The previous run stopped at a tool approval gate. Approval state has been restored.",
                        &["approve", "reject"],
                    )
                    .await?;
                }
            }
            InFlightExecutionStage::ResumingAfterApproval => {
                if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
                    continue;
                }
                let Some(mut execution_graph) =
                    load_execution_graph_snapshot(store, execution_id.as_str())
                        .await
                        .map_err(|err| err.to_string())?
                else {
                    continue;
                };
                let message = "The previous run was interrupted while continuing after approval. Confirm the restored state before retrying or continuing.";
                mark_inflight_execution_interrupted(
                    &mut execution_graph,
                    persisted.current_call_id.as_deref(),
                    message,
                );
                persist_execution_graph_snapshot(
                    store,
                    &execution_graph,
                    persisted.session_id.as_str(),
                    "desktop_local_chat_resuming_after_approval_interrupted",
                    persisted.request_id.as_deref(),
                    Some("interrupted"),
                )
                .await
                .map_err(|err| err.to_string())?;
                append_recovery_assistant_message_if_missing(
                    store,
                    persisted.session_id.as_str(),
                    &execution_graph,
                    execution_id.as_str(),
                    "resuming_after_approval",
                    message,
                    &["continue", "retry", "abandon"],
                )
                .await?;
                persisted.last_error = Some(message.to_string());
                persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
                persist_execution_graph_runtime_context(
                    store,
                    execution_id.as_str(),
                    &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
                )
                .await
                .map_err(|err| err.to_string())?;
            }
            InFlightExecutionStage::ResumeFailed => {
                if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
                    continue;
                }
                let Some(execution_graph) =
                    load_execution_graph_snapshot(store, execution_id.as_str())
                        .await
                        .map_err(|err| err.to_string())?
                else {
                    continue;
                };
                let message = persisted.last_error.clone().unwrap_or_else(|| {
                    "The previous run failed while continuing after approval.".to_string()
                });
                append_recovery_assistant_message_if_missing(
                    store,
                    persisted.session_id.as_str(),
                    &execution_graph,
                    execution_id.as_str(),
                    "resume_failed",
                    message.as_str(),
                    &["retry", "abandon"],
                )
                .await?;
                persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
                persist_execution_graph_runtime_context(
                    store,
                    execution_id.as_str(),
                    &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
                )
                .await
                .map_err(|err| err.to_string())?;
            }
            InFlightExecutionStage::ToolRunning => {
                if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
                    continue;
                }
                let Some(mut execution_graph) =
                    load_execution_graph_snapshot(store, execution_id.as_str())
                        .await
                        .map_err(|err| err.to_string())?
                else {
                    continue;
                };
                let message = "The previous run was interrupted while a tool was running. The system did not auto-replay it, so confirm the tool state before continuing, retrying, or abandoning.";
                mark_inflight_execution_interrupted(
                    &mut execution_graph,
                    persisted.current_call_id.as_deref(),
                    message,
                );
                persist_execution_graph_snapshot(
                    store,
                    &execution_graph,
                    persisted.session_id.as_str(),
                    "desktop_local_chat_recovered_interrupt",
                    persisted.request_id.as_deref(),
                    Some("interrupted"),
                )
                .await
                .map_err(|err| err.to_string())?;
                append_recovery_assistant_message_if_missing(
                    store,
                    persisted.session_id.as_str(),
                    &execution_graph,
                    execution_id.as_str(),
                    "tool_running_interrupted",
                    message,
                    &["continue", "retry", "abandon"],
                )
                .await?;
                persisted.stage = InFlightExecutionStage::Interrupted;
                persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
                persist_execution_graph_runtime_context(
                    store,
                    execution_id.as_str(),
                    &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
                )
                .await
                .map_err(|err| err.to_string())?;
            }
            InFlightExecutionStage::DelegatedWorkflowRunning => {
                if persisted.recovery_notice_emitted_at_unix_ms.is_some() {
                    continue;
                }
                let workflow_run_id = persisted
                    .delegation
                    .as_ref()
                    .map(|delegation| delegation.delegated_run_id.as_str())
                    .filter(|value| !value.trim().is_empty())
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let Some(workflow_run_id) = workflow_run_id else {
                    persisted.stage = InFlightExecutionStage::Interrupted;
                    persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
                    persist_execution_graph_runtime_context(
                        store,
                        execution_id.as_str(),
                        &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
                    )
                    .await
                    .map_err(|err| err.to_string())?;
                    continue;
                };
                let detail = crate::modules::workflow::service::get_workflow_run_status(
                    app_state,
                    workflow_run_id,
                )
                .await?;
                let workflow_text = match detail.run.status {
                    crate::modules::workflow::types::WorkflowRunStatus::Completed => {
                        if let Ok(Some(_)) = resume_delegated_runtime_after_workflow_event(
                            _app,
                            app_state,
                            execution_id.as_str(),
                            workflow_run_id,
                            &format!(
                                "workflow:{}:completed:{}",
                                workflow_run_id, detail.run.updated_at
                            ),
                        )
                        .await
                        {
                            continue;
                        }
                        crate::modules::workflow::service::extract_primary_content(&detail)
                            .unwrap_or_else(|| {
                                format!(
                                    "The delegated workflow `{}` completed and its result has been restored to the conversation.",
                                    workflow_run_id
                                )
                            })
                    }
                    crate::modules::workflow::types::WorkflowRunStatus::WaitingApproval => {
                        format!(
                            "The delegated workflow `{}` is waiting for approval and its state has been restored.",
                            workflow_run_id
                        )
                    }
                    crate::modules::workflow::types::WorkflowRunStatus::Running => {
                        format!(
                            "The delegated workflow `{}` was still running before the app was interrupted. The system did not auto-replay it, so confirm the state before retrying or abandoning.",
                            workflow_run_id
                        )
                    }
                    _ => format!(
                        "The delegated workflow `{}` is currently in status `{}`.",
                        workflow_run_id,
                        detail.run.status.as_str()
                    ),
                };
                append_recovery_assistant_message_if_missing(
                    store,
                    persisted.session_id.as_str(),
                    &serde_json::json!({
                        "execution_id": execution_id,
                        "metadata": {
                            "status": detail.run.status.as_str(),
                            "workflow_run_id": workflow_run_id,
                        },
                        "nodes": [],
                        "events": [],
                    }),
                    execution_id.as_str(),
                    "delegated_workflow_running",
                    workflow_text.as_str(),
                    &["retry", "abandon"],
                )
                .await?;
                persisted.recovery_notice_emitted_at_unix_ms = Some(now_unix_ms_i64());
                if detail.run.status == crate::modules::workflow::types::WorkflowRunStatus::Running
                {
                    persisted.stage = InFlightExecutionStage::Interrupted;
                    persist_execution_graph_runtime_context(
                        store,
                        execution_id.as_str(),
                        &serde_json::to_value(&persisted).unwrap_or_else(|_| serde_json::json!({})),
                    )
                    .await
                    .map_err(|err| err.to_string())?;
                } else {
                    clear_execution_graph_runtime_context(store, Some(execution_id.as_str())).await;
                }
            }
            InFlightExecutionStage::Interrupted => {}
        }
    }

    Ok(())
}

pub(crate) async fn recover_local_chat_execution_from_action(
    app: &AppHandle,
    app_state: &AppState,
    execution_graph_execution_id: &str,
    action: &str,
) -> Result<serde_json::Value, String> {
    let normalized_execution_id = execution_graph_execution_id.trim();
    if normalized_execution_id.is_empty() {
        return Err("execution_graph_execution_id is required".to_string());
    }

    let normalized_action = action.trim().to_ascii_lowercase();
    if normalized_action.is_empty() {
        return Err("action is required".to_string());
    }

    let Some(runtime_context_value) =
        load_execution_graph_runtime_context(app_state.mcp.store.as_ref(), normalized_execution_id)
            .await
            .map_err(|err| err.to_string())?
    else {
        return Err("local chat recovery context not found".to_string());
    };
    let Some(persisted) = persistable_inflight_context_from_value(&runtime_context_value) else {
        return Err("local chat recovery context is invalid".to_string());
    };

    match normalized_action.as_str() {
        "abandon" => {
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                Some(normalized_execution_id),
            )
            .await;
            resolve_recovery_prompt_message(
                app_state.mcp.store.as_ref(),
                persisted.session_id.as_str(),
                normalized_execution_id,
                "abandon",
            )
            .await?;
            let execution_graph = load_execution_graph_snapshot(
                app_state.mcp.store.as_ref(),
                normalized_execution_id,
            )
            .await
            .map_err(|err| err.to_string())?;
            return Ok(serde_json::json!({
                "status": "LOCAL_CHAT_RECOVERY_ABANDONED",
                "execution_graph_execution_id": normalized_execution_id,
                "execution_graph": execution_graph,
            }));
        }
        "continue" | "retry" => {}
        _ => {
            return Err(format!(
                "unsupported local chat recovery action: {normalized_action}"
            ))
        }
    }

    if persisted.stage != InFlightExecutionStage::ResumingAfterApproval
        && persisted.stage != InFlightExecutionStage::ResumeFailed
    {
        return Err(format!(
            "local chat recovery action '{}' is not supported for stage '{}'",
            normalized_action,
            serde_json::to_string(&persisted.stage).unwrap_or_else(|_| "\"unknown\"".to_string())
        ));
    }

    let Some(suspended) =
        load_suspended_chat_tool_execution_for_resume(app_state, "", Some(normalized_execution_id))
            .await?
    else {
        return Err("local chat suspended execution not found".to_string());
    };

    let payload = advance_local_chat_execution_from_graph_state(
        app,
        app_state,
        suspended,
        None,
        None,
        &serde_json::Value::Null,
    )
    .await?;

    let is_terminal_success = payload
        .get("status")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|status| status == "LOCAL_CHAT_RESUMED");
    if is_terminal_success {
        resolve_recovery_prompt_message(
            app_state.mcp.store.as_ref(),
            persisted.session_id.as_str(),
            normalized_execution_id,
            normalized_action.as_str(),
        )
        .await?;
    }

    Ok(payload)
}
