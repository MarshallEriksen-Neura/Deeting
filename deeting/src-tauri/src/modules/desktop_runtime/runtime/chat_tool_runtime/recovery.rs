use super::*;

fn apply_approved_tool_result_to_suspended_round(
    suspended: &mut SuspendedChatToolExecution,
    call_id: Option<&str>,
    tool_result: &serde_json::Value,
) {
    apply_approved_tool_result_to_execution_graph(suspended, call_id, tool_result);
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

    apply_approved_tool_result_to_suspended_round(&mut suspended, call_id, tool_result);

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
    let post_approval_graph = suspended.execution_graph.clone();

    if let Err(err) = persist_suspended_execution_graph_runtime(
        app_state.mcp.store.as_ref(),
        &suspended,
        &[],
        "desktop_local_chat_approval_applied",
        "active",
    )
    .await
    {
        log::warn!(
            "persist approved execution graph failed approval_token={} err={}",
            approval_token,
            err
        );
    }

    let remaining_pending_call_ids = suspended.pending_requires_approval_call_ids();
    if !remaining_pending_call_ids.is_empty() {
        return Ok(Some(serde_json::json!({
            "status": "LOCAL_CHAT_WAITING_APPROVAL",
            "approved_tool_result": tool_result,
            "continuation_blocks": build_local_chat_resume_continuation_blocks(
                &serde_json::json!({
                    "execution_graph": suspended.execution_graph().clone(),
                    "content": "",
                }),
                &suspended.pending_tool_call_meta(),
            ),
            "execution_graph": suspended.execution_graph().clone(),
            "execution_graph_execution_id": root_execution_id,
            "pending_call_ids": remaining_pending_call_ids,
        })));
    }

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

    match continue_local_chat_complete_with_tools(app, app_state, state).await {
        Ok(mut output) => {
            attach_execution_graph_to_response(
                &mut output.response,
                &session_id,
                &execution_policy,
                root_execution_id.as_deref(),
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
                root_execution_id.as_deref(),
            )
            .await;
            let continuation_meta = build_effective_tool_call_meta(&output.response, &[]);
            Ok(Some(serde_json::json!({
                "status": "LOCAL_CHAT_RESUMED",
                "approved_tool_result": tool_result,
                "continuation_blocks": build_local_chat_resume_continuation_blocks(&output.response, &continuation_meta),
                "execution_graph": output.response.get("execution_graph").cloned(),
                "execution_graph_execution_id": output
                    .response
                    .get("execution_graph")
                    .and_then(|value| value.get("execution_id"))
                    .cloned(),
                "response": output.response,
            })))
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
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                root_execution_id.as_deref(),
            )
            .await;
            Ok(Some(serde_json::json!({
                "status": "LOCAL_CHAT_RESUME_FAILED",
                "approved_tool_result": tool_result,
                "continuation_blocks": [],
                "execution_graph": post_approval_graph,
                "execution_graph_execution_id": root_execution_id,
                "error": err,
            })))
        }
    }
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
                let extended_expiry =
                    now_unix_ms_i64() as i128 + app_state.mcp.pending_tool_call_ttl_ms();
                let mut pending_tool_calls =
                    app_state.mcp.approvals.pending_tool_calls.write().await;
                for pending in &persisted.pending_approvals {
                    pending_tool_calls
                        .entry(pending.approval_token.clone())
                        .or_insert_with(|| {
                            pending_tool_call_from_persisted_approval(
                                pending,
                                Some(execution_id.as_str()),
                                extended_expiry,
                            )
                        });
                }
                drop(pending_tool_calls);
                if let Some(execution_graph) =
                    load_execution_graph_snapshot(store, execution_id.as_str())
                        .await
                        .map_err(|err| err.to_string())?
                {
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
                let Some(workflow_run_id) = persisted.workflow_run_id.as_deref() else {
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
