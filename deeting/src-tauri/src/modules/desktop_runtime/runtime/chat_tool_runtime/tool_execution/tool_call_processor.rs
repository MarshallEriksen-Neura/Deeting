use super::super::context_tools::{is_terminal_context_tool, is_workflow_plan_tool};
use super::super::frame_tools::WorldModelUpdate;
use super::super::lifecycle::{
    clear_execution_graph_runtime_context, persist_running_tool_execution_runtime,
};
use super::super::runtime_state::{
    classify_local_tool_execution_error_code, clone_runtime_state_for_tool_execution,
    LocalChatToolRuntimeState, LocalToolCallProcessingOutcome,
};
use super::super::tool_meta::{
    canonicalize_tool_name_for_allowed_list, push_local_tool_call_error_meta,
    resolve_local_tool_call_id,
};
use super::{
    build_policy_blocked_tool_result, execute_activate_skill_tool, execute_code_plan_tool,
    execute_context_runtime_tool, execute_delegations_status_tool, execute_generic_mcp_tool_call,
    execute_local_code_snippet_tool, execute_query_task_policy_tool,
    execute_read_skill_resource_tool, execute_refresh_skill_index_tool, execute_search_sdk_tool,
    execute_start_delegate_agent_tool, execute_start_delegate_many_tool,
    execute_stop_delegations_tool, execute_sys_submit_onboarding_request_tool,
    execute_terminal_context_runtime_tool, execute_wait_delegations_tool,
    execute_workflow_plan_runtime_tool,
};
use crate::modules::desktop_runtime::context_orchestrator::is_context_tool;
use crate::modules::desktop_runtime::runtime::{
    extract_chat_tool_calls, resolve_provider_tool_name_for_execution,
    LocalCapabilityActivationState,
};
use crate::state::AppState;
use tauri::AppHandle;

pub(crate) async fn process_chat_tool_calls(
    app: &AppHandle,
    app_state: &AppState,
    state: &mut LocalChatToolRuntimeState,
    chat_response: &serde_json::Value,
    _prior_tool_call_meta: &[serde_json::Value],
    session_id: &str,
    effective_allowed_tool_names: &[String],
    _active_capability: Option<&LocalCapabilityActivationState>,
) -> LocalToolCallProcessingOutcome {
    let tool_calls = extract_chat_tool_calls(chat_response);
    if tool_calls.is_empty() {
        return LocalToolCallProcessingOutcome::Completed {
            synthesized: false,
            tool_call_meta: Vec::new(),
            results: Vec::new(),
            skill_context_update: None,
            captured_world_model_update: None,
            runtime_transition_blocks: Vec::new(),
        };
    }
    let mut tool_call_meta = Vec::new();
    let mut results = Vec::new();
    let mut synthesized = false;
    let mut skill_context_update = None;
    let mut approval_tokens = Vec::new();
    let captured_world_model_update: Option<WorldModelUpdate> =
        state.captured_world_model_update.clone();
    let mut runtime_transition_blocks = Vec::new();

    for (call_index, call) in tool_calls.into_iter().enumerate() {
        let requested_tool_name = call.name.trim().to_lowercase();
        let tool_name = resolve_provider_tool_name_for_execution(
            &requested_tool_name,
            effective_allowed_tool_names,
            state.last_capability_snapshot.as_ref(),
        )
        .unwrap_or(requested_tool_name);
        let tool_name =
            canonicalize_tool_name_for_allowed_list(&tool_name, effective_allowed_tool_names)
                .unwrap_or(tool_name);
        let call_id =
            resolve_local_tool_call_id(call.id.as_deref(), &tool_name, state.round, call_index);
        let meta_len_before = tool_call_meta.len();
        let approval_count_before = approval_tokens.len();

        if !effective_allowed_tool_names
            .iter()
            .any(|item| item == &tool_name)
            && !state.session_discovered_tools.contains(&tool_name)
        {
            synthesized = true;
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            let blocked = build_policy_blocked_tool_result(call_id.as_str(), tool_name.as_str());
            state.realtime_emitter.emit_tool_result_meta(&blocked.meta);
            tool_call_meta.push(blocked.meta);
            results.push(blocked.result_message);
            continue;
        }

        let running_execution_id = persist_running_tool_execution_runtime(
            app_state.mcp.store.as_ref(),
            &clone_runtime_state_for_tool_execution(state, None),
            call_id.as_str(),
            &tool_name,
            &call.arguments,
        )
        .await
        .ok()
        .flatten();

        // Meta-protocol tool: world_model_update
        if tool_name == "world_model_update" {
            // Apply world model update directly to state without returning a tool result
            if let Ok(update) = serde_json::from_value::<WorldModelUpdate>(call.arguments.clone()) {
                state.captured_world_model_update = Some(update);
            }
            // Meta-protocol tools do not emit tool results or enter the tool execution loop
            continue;
        }

        if is_terminal_context_tool(&tool_name) {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_terminal_context_runtime_tool(
                app,
                state.terminal_context.as_ref(),
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            ) {
                Ok(result) => {
                    synthesized = true;
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "TERMINAL_CONTEXT_FAILED",
                        err,
                    );
                }
            }
        } else if is_workflow_plan_tool(&tool_name) {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_workflow_plan_runtime_tool(
                app,
                app_state,
                state.workflow_context.as_ref(),
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "WORKFLOW_PLAN_FAILED",
                        err,
                    );
                }
            }
        } else if is_context_tool(&tool_name) {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_context_runtime_tool(
                app_state,
                &state.selected_knowledge_file_ids,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "CONTEXT_TOOL_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "execute_code_plan" {
            state
                .realtime_emitter
                .emit_execution_section_once("Code Execution");
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            let code_result = execute_code_plan_tool(
                app_state,
                state,
                state.last_capability_snapshot.as_ref(),
                &state.realtime_emitter,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await;
            if let Some(block) = code_result.runtime_transition_block {
                runtime_transition_blocks.push(block);
            }
            synthesized = true;
            state
                .realtime_emitter
                .emit_tool_result_meta(&code_result.meta);
            tool_call_meta.push(code_result.meta);
            results.push(code_result.result_message);
        } else if tool_name == "run_local_code_snippet" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            let snippet_result = execute_local_code_snippet_tool(
                app_state,
                session_id,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await;
            synthesized = true;
            state
                .realtime_emitter
                .emit_tool_result_meta(&snippet_result.meta);
            tool_call_meta.push(snippet_result.meta);
            results.push(snippet_result.result_message);
        } else if tool_name == "search_sdk" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            let search = execute_search_sdk_tool(
                app_state,
                state,
                &tool_call_meta,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await;
            state.last_capability_snapshot = Some(search.full_payload);
            synthesized = true;
            state.realtime_emitter.emit_tool_result_meta(&search.meta);
            tool_call_meta.push(search.meta);
            results.push(search.result_message);
        } else if tool_name == "activate_skill" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_activate_skill_tool(
                app_state,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    skill_context_update = Some(result.active_skill);
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "SKILL_ACTIVATION_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "read_skill_resource" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_read_skill_resource_tool(
                app_state,
                state.active_skill_context.as_ref(),
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    skill_context_update = Some(result.active_skill);
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "SKILL_RESOURCE_READ_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "start_delegate_agent" {
            state
                .realtime_emitter
                .emit_execution_section_once("Delegate Agents");
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_start_delegate_agent_tool(
                app,
                app_state,
                state,
                session_id,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
                effective_allowed_tool_names,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "START_DELEGATE_AGENT_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "start_delegate_many" {
            state
                .realtime_emitter
                .emit_execution_section_once("Delegate Agents");
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_start_delegate_many_tool(
                app,
                app_state,
                state,
                session_id,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
                effective_allowed_tool_names,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "START_DELEGATE_MANY_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "delegations_status" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_delegations_status_tool(
                app,
                app_state,
                state,
                session_id,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "DELEGATIONS_STATUS_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "wait_delegations" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_wait_delegations_tool(
                app,
                app_state,
                state,
                session_id,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "WAIT_DELEGATIONS_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "stop_delegations" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_stop_delegations_tool(
                app,
                app_state,
                state,
                session_id,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await
            {
                Ok(result) => {
                    synthesized = true;
                    state.realtime_emitter.emit_tool_result_meta(&result.meta);
                    tool_call_meta.push(result.meta);
                    results.push(result.result_message);
                }
                Err(err) => {
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        "STOP_DELEGATIONS_FAILED",
                        err,
                    );
                }
            }
        } else if tool_name == "query_task_policy" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            let policy_result = execute_query_task_policy_tool(
                app_state,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await;
            synthesized = true;
            state
                .realtime_emitter
                .emit_tool_result_meta(&policy_result.meta);
            tool_call_meta.push(policy_result.meta);
            results.push(policy_result.result_message);
        } else if tool_name == "sys_submit_onboarding_request" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            let onboarding_result = execute_sys_submit_onboarding_request_tool(
                app,
                app_state,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await;
            synthesized = true;
            state
                .realtime_emitter
                .emit_tool_result_meta(&onboarding_result.meta);
            tool_call_meta.push(onboarding_result.meta);
            results.push(onboarding_result.result_message);
        } else if tool_name == "refresh_skill_index" {
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            let refresh_result = execute_refresh_skill_index_tool(
                app.clone(),
                app_state,
                call_id.as_str(),
                tool_name.as_str(),
            )
            .await;
            synthesized = true;
            state
                .realtime_emitter
                .emit_tool_result_meta(&refresh_result.meta);
            tool_call_meta.push(refresh_result.meta);
            results.push(refresh_result.result_message);
        } else {
            synthesized = true;
            state
                .realtime_emitter
                .emit_tool_call_running(call_id.as_str(), tool_name.as_str());
            match execute_generic_mcp_tool_call(
                &app_state.mcp,
                session_id,
                call_id.as_str(),
                tool_name.as_str(),
                &call.arguments,
            )
            .await
            {
                Ok(dispatch) => {
                    state.realtime_emitter.emit_tool_result_meta(&dispatch.meta);
                    tool_call_meta.push(dispatch.meta);
                    results.push(dispatch.result_message);
                    if let Some(approval_token) = dispatch.approval_token {
                        approval_tokens.push(approval_token);
                    }
                }
                Err(err) => {
                    let error = err.to_string();
                    synthesized = true;
                    push_local_tool_call_error_meta(
                        &mut tool_call_meta,
                        &mut results,
                        &mut state.realtime_emitter,
                        Some(call_id.as_str()),
                        &tool_name,
                        classify_local_tool_execution_error_code(&error),
                        error,
                    );
                }
            }
        }

        if tool_call_meta.len() == meta_len_before {
            synthesized = true;
            let error = format!(
                "tool call '{}' completed without recording a result; synthesized a fallback error output to keep replay stable",
                tool_name
            );
            log::warn!(
                "local chat tool call missing output meta: tool_name={} call_id={}",
                tool_name,
                call_id
            );
            push_local_tool_call_error_meta(
                &mut tool_call_meta,
                &mut results,
                &mut state.realtime_emitter,
                Some(call_id.as_str()),
                &tool_name,
                "LOCAL_TOOL_RESULT_MISSING",
                error,
            );
        }
        if approval_tokens.len() == approval_count_before {
            clear_execution_graph_runtime_context(
                app_state.mcp.store.as_ref(),
                running_execution_id.as_deref(),
            )
            .await;
        }
    }
    if approval_tokens.is_empty() {
        LocalToolCallProcessingOutcome::Completed {
            synthesized,
            tool_call_meta,
            results,
            skill_context_update,
            captured_world_model_update,
            runtime_transition_blocks,
        }
    } else {
        LocalToolCallProcessingOutcome::Interrupted {
            approval_tokens,
            tool_call_meta,
            results,
            skill_context_update,
            captured_world_model_update,
            runtime_transition_blocks,
        }
    }
}
