use std::time::Duration;

use mcp_storage::helpers::{now_rfc3339, parse_rfc3339_to_unix_epoch};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::modules::conversations::summary_format::build_local_summary_from_window;
use crate::modules::custom_task_agents::store::list_custom_task_agents as list_custom_task_agents_inner;
use crate::modules::memory::types::CreateLocalMemoryRequest;
use crate::modules::retrieval_kernel::write_guard::WriteGuardProfile;
use crate::modules::workflow::types::QuickWorkflowRequest;
use crate::state::{global_app_handle, AppState};

use super::config::{
    load_automation_state, load_binding, normalize_vault_root, resolve_workspace_path,
    save_automation_state, PersistedLlmWikiBinding,
};
use super::corpus::reconcile_corpus;
use super::service::{create_or_update_local_llm_wiki_maintainer_agent, get_local_llm_wiki_state};
use super::types::{
    LocalLlmWikiAutomationAuditEntry, LocalLlmWikiAutomationExecutionResult,
    LocalLlmWikiAutomationSettings, LocalLlmWikiAutomationState, LocalLlmWikiAutomationSuggestion,
    UpdateLocalLlmWikiAutomationSettingsRequest,
};

const LLM_WIKI_MAINTAINER_SOURCE_KIND: &str = "llm_wiki_maintainer";

const TRIGGER_VAULT_BOUND: &str = "on_vault_bound";
const TRIGGER_WORKSPACE_BOOTSTRAPPED: &str = "on_workspace_bootstrapped";
const TRIGGER_CORPUS_RECONCILE_COMPLETED: &str = "on_corpus_reconcile_completed";
const TRIGGER_SESSION_END: &str = "on_session_end";
const TRIGGER_VALUABLE_ANSWER: &str = "on_valuable_answer";
const TRIGGER_MAINTENANCE_SCHEDULE: &str = "on_maintenance_schedule";
const TRIGGER_NEW_SOURCE: &str = "on_new_source";
const TRIGGER_REPEATED_STABLE_CONCLUSION: &str = "on_repeated_stable_conclusion";

const ACTION_RECONCILE_CORPUS: &str = "reconcile_corpus";
const ACTION_CREATE_MAINTAINER_AGENT: &str = "create_maintainer_agent";
const ACTION_INSPECT_CORPUS: &str = "inspect_corpus";
const ACTION_RUN_MAINTENANCE_REVIEW: &str = "run_maintenance_review";
const ACTION_CRYSTALLIZE_SESSION_SUMMARY: &str = "crystallize_session_summary";
const ACTION_PROMOTE_TO_MEMORY: &str = "promote_to_memory";

const STATUS_PENDING: &str = "pending";
const STATUS_COMPLETED: &str = "completed";
const STATUS_DISMISSED: &str = "dismissed";
#[allow(dead_code)]
const STATUS_FAILED: &str = "failed";
#[allow(dead_code)]
#[allow(dead_code)]
const STATUS_STALE: &str = "stale";
#[allow(dead_code)]
const STATUS_SUPERSEDED: &str = "superseded";
const STATUS_PROMOTED: &str = "promoted";
#[allow(dead_code)]
const STATUS_EXPIRED: &str = "expired";

const MAX_AUDIT_ENTRIES: usize = 32;
const MAX_SUGGESTIONS: usize = 16;
const VALUABLE_ANSWER_MIN_CHARS: usize = 220;
const MEMORY_PROMOTION_REPEAT_THRESHOLD: i64 = 2;
const MEMORY_PROMOTION_STRONG_REPEAT_THRESHOLD: i64 = 3;
const MEMORY_PROMOTION_MIN_CONFIDENCE: f64 = 0.72;
const MEMORY_PROMOTION_MIN_DISTINCT_SESSION_SOURCES: usize = 2;
const MAINTENANCE_SCHEDULE_INTERVAL_SECS: i64 = 6 * 60 * 60;

#[derive(Debug, Clone)]
struct WorkspaceLifecycleContext {
    workspace_id: String,
    workspace_relative_path: String,
    memory_source_scope: String,
}

pub(crate) async fn update_automation_settings(
    store: &crate::modules::mcp::store::McpStore,
    payload: UpdateLocalLlmWikiAutomationSettingsRequest,
) -> Result<LocalLlmWikiAutomationState, String> {
    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;

    apply_settings_patch(&mut state.settings, payload);
    let now = now_rfc3339().map_err(|err| err.to_string())?;
    push_audit(
        &mut state,
        TRIGGER_MAINTENANCE_SCHEDULE,
        "info",
        "settings_updated",
        "LLM Wiki automation settings updated.",
        now.as_str(),
        None,
    );
    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(state)
}

pub(crate) async fn dismiss_suggestion(
    store: &crate::modules::mcp::store::McpStore,
    suggestion_id: &str,
) -> Result<LocalLlmWikiAutomationState, String> {
    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    let normalized_id = suggestion_id.trim();
    if normalized_id.is_empty() {
        return Err("suggestion_id is required".to_string());
    }

    let now = now_rfc3339().map_err(|err| err.to_string())?;
    if let Some(index) = state
        .suggestions
        .iter()
        .position(|item| item.id == normalized_id)
    {
        let title = state.suggestions[index].title.clone();
        let trigger = state.suggestions[index].trigger.clone();
        let action_kind = state.suggestions[index].action_kind.clone();
        state.suggestions[index].status = STATUS_DISMISSED.to_string();
        state.suggestions[index].updated_at = now.clone();
        push_audit(
            &mut state,
            trigger.as_str(),
            "info",
            "suggestion_dismissed",
            format!("Dismissed automation suggestion: {}", title),
            now.as_str(),
            Some(json!({
                "suggestionId": normalized_id,
                "actionKind": action_kind,
            })),
        );
    } else {
        return Err("llm wiki automation suggestion not found".to_string());
    }

    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(state)
}

pub(crate) async fn execute_suggestion(
    app_state: &AppState,
    suggestion_id: &str,
) -> Result<LocalLlmWikiAutomationExecutionResult, String> {
    let store = app_state.mcp.store.as_ref();
    let mut automation = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    let normalized_id = suggestion_id.trim();
    if normalized_id.is_empty() {
        return Err("suggestion_id is required".to_string());
    }

    let index = automation
        .suggestions
        .iter()
        .position(|item| item.id == normalized_id)
        .ok_or_else(|| "llm wiki automation suggestion not found".to_string())?;
    let suggestion = automation.suggestions[index].clone();
    let binding = load_binding(store).await.map_err(|err| err.to_string())?;
    let now = now_rfc3339().map_err(|err| err.to_string())?;
    let lifecycle_context = suggestion
        .metadata
        .as_ref()
        .and_then(Value::as_object)
        .and_then(workspace_lifecycle_context_from_metadata)
        .or_else(|| build_workspace_lifecycle_context(binding.as_ref()));

    let mut workflow_run_id = None;
    let mut memory_action = None;
    let execution_result: Result<Option<String>, String> = match suggestion.action_kind.as_str() {
        ACTION_RECONCILE_CORPUS => {
            let binding = binding
                .ok_or_else(|| "llm wiki binding has not been configured yet".to_string())?;
            let vault_root = normalize_vault_root(&binding.vault_root)?;
            let workspace_path =
                resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
            let (indexed_files, removed_files, _) =
                reconcile_corpus(app_state, &vault_root, &workspace_path).await?;
            push_audit(
                &mut automation,
                suggestion.trigger.as_str(),
                "info",
                "executed",
                format!(
                    "Executed corpus reconcile suggestion. Indexed {} files and removed {} stale entries.",
                    indexed_files, removed_files
                ),
                now.as_str(),
                Some(json!({
                    "suggestionId": suggestion.id,
                    "indexedFiles": indexed_files,
                    "removedFiles": removed_files,
                })),
            );
            Ok(Some(format!(
                "Corpus reconciled. Indexed {} files and removed {} stale entries.",
                indexed_files, removed_files
            )))
        }
        ACTION_CREATE_MAINTAINER_AGENT => {
            let result = create_or_update_local_llm_wiki_maintainer_agent(app_state).await?;
            let name = result
                .state
                .maintainer_agent
                .as_ref()
                .map(|item| item.name.clone())
                .unwrap_or_else(|| "Maintainer".to_string());
            push_audit(
                &mut automation,
                suggestion.trigger.as_str(),
                "info",
                "executed",
                format!("Maintainer agent synchronized through automation: {}", name),
                now.as_str(),
                Some(json!({
                    "suggestionId": suggestion.id,
                    "agentName": name,
                })),
            );
            Ok(Some(format!("Maintainer agent is ready: {}", name)))
        }
        ACTION_RUN_MAINTENANCE_REVIEW | ACTION_CRYSTALLIZE_SESSION_SUMMARY => {
            let metadata = suggestion.metadata.as_ref().and_then(Value::as_object);
            let goal = metadata
                .and_then(|value| value.get("goal"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "automation suggestion is missing a workflow goal".to_string())?;
            let worker_ref = resolve_maintainer_worker_ref(store).await?;
            let app_handle = global_app_handle()
                .ok_or_else(|| "global app handle is not available".to_string())?;
            let result = crate::modules::workflow::service::quick_workflow_run(
                &app_handle,
                app_state,
                QuickWorkflowRequest {
                    goal: goal.to_string(),
                    worker_ref: Some(worker_ref),
                    inject_into_chat: false,
                    user_notes: None,
                    execution_model_id: None,
                    execution_provider_model_id: None,
                    worker_task_packet: None,
                },
            )
            .await?;
            workflow_run_id = Some(result.run.id.clone());
            push_audit(
                &mut automation,
                suggestion.trigger.as_str(),
                "info",
                "executed",
                format!(
                    "Started maintainer workflow from automation suggestion: {}",
                    suggestion.title
                ),
                now.as_str(),
                Some(json!({
                    "suggestionId": suggestion.id,
                    "workflowRunId": result.run.id,
                    "succeeded": result.succeeded,
                })),
            );
            Ok(Some("Maintainer workflow started.".to_string()))
        }
        ACTION_PROMOTE_TO_MEMORY => {
            let metadata = suggestion.metadata.as_ref().and_then(Value::as_object);
            let memory_content = metadata
                .and_then(|value| value.get("memoryContent"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "automation suggestion is missing memory content".to_string())?;
            let session_id = metadata
                .and_then(|value| value.get("sessionId"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let repeat_count = metadata
                .and_then(|value| value.get("repeatCount"))
                .and_then(Value::as_i64)
                .unwrap_or(MEMORY_PROMOTION_REPEAT_THRESHOLD);

            let result = app_state
                .memory
                .service
                .append_guarded_with_profile(
                    build_memory_promotion_request(
                        lifecycle_context.as_ref(),
                        memory_content,
                        session_id.as_deref(),
                        suggestion.fingerprint.as_str(),
                        metadata,
                        Some(suggestion.id.as_str()),
                        repeat_count,
                        now.as_str(),
                    ),
                    WriteGuardProfile::WikiPromotion,
                )
                .await
                .map_err(|err| err.to_string())?;
            let action = format!("{:?}", result.action).to_ascii_lowercase();
            memory_action = Some(action.clone());
            update_memory_promotion_metadata(
                &mut automation.suggestions[index].metadata,
                now.as_str(),
                action.as_str(),
                result
                    .item
                    .as_ref()
                    .map(|item| item.id.as_str())
                    .or(result.updated_memory_id.as_deref()),
                repeat_count,
            );
            push_audit(
                &mut automation,
                suggestion.trigger.as_str(),
                "info",
                "executed",
                "Promoted a repeated stable conclusion into local memory.",
                now.as_str(),
                Some(json!({
                    "suggestionId": suggestion.id,
                    "memoryAction": memory_action,
                    "workspaceId": lifecycle_context
                        .as_ref()
                        .map(|value| value.workspace_id.as_str()),
                })),
            );
            Ok(Some(
                "Repeated stable conclusion promoted to memory.".to_string(),
            ))
        }
        ACTION_INSPECT_CORPUS => {
            push_audit(
                &mut automation,
                suggestion.trigger.as_str(),
                "info",
                "acknowledged",
                format!("Inspector suggestion acknowledged: {}", suggestion.title),
                now.as_str(),
                Some(json!({
                    "suggestionId": suggestion.id,
                })),
            );
            Ok(Some("Inspector suggestion acknowledged.".to_string()))
        }
        other => Err(format!("unsupported llm wiki automation action: {}", other)),
    };

    let message = match execution_result {
        Ok(message) => message,
        Err(error) => {
            automation.suggestions[index].status = STATUS_FAILED.to_string();
            automation.suggestions[index].updated_at = now.clone();
            push_audit(
                &mut automation,
                suggestion.trigger.as_str(),
                "error",
                "execution_failed",
                format!("Automation suggestion execution failed: {}", error),
                now.as_str(),
                Some(json!({
                    "suggestionId": suggestion.id,
                    "actionKind": suggestion.action_kind,
                })),
            );
            save_automation_state(store, &automation)
                .await
                .map_err(|err| err.to_string())?;
            return Err(error);
        }
    };

    automation.suggestions[index].status = if suggestion.action_kind == ACTION_PROMOTE_TO_MEMORY {
        STATUS_PROMOTED.to_string()
    } else {
        STATUS_COMPLETED.to_string()
    };
    automation.suggestions[index].updated_at = now.clone();
    save_automation_state(store, &automation)
        .await
        .map_err(|err| err.to_string())?;

    let state = get_local_llm_wiki_state(store).await?;
    Ok(LocalLlmWikiAutomationExecutionResult {
        state,
        workflow_run_id,
        memory_action,
        message,
    })
}

pub(crate) async fn handle_vault_bound(app_state: &AppState) -> Result<(), String> {
    let store = app_state.mcp.store.as_ref();
    let Some(binding) = load_binding(store).await.map_err(|err| err.to_string())? else {
        return Ok(());
    };
    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    let now = now_rfc3339().map_err(|err| err.to_string())?;

    if state.settings.auto_sync_on_vault_bound {
        let vault_root = normalize_vault_root(&binding.vault_root)?;
        let workspace_path = resolve_workspace_path(&vault_root, &binding.workspace_relative_path);
        match reconcile_corpus(app_state, &vault_root, &workspace_path).await {
            Ok((indexed_files, removed_files, _)) => {
                transition_suggestion_status_by_fingerprint(
                    &mut state,
                    suggestion_fingerprint(TRIGGER_VAULT_BOUND, "initial-corpus-sync").as_str(),
                    STATUS_EXPIRED,
                    now.as_str(),
                    None,
                );
                push_audit(
                    &mut state,
                    TRIGGER_VAULT_BOUND,
                    "info",
                    "auto_executed",
                    format!(
                        "Auto-reconciled the dedicated corpus after vault binding. Indexed {} files and removed {} stale entries.",
                        indexed_files, removed_files
                    ),
                    now.as_str(),
                    Some(json!({
                        "indexedFiles": indexed_files,
                        "removedFiles": removed_files,
                    })),
                );
                handle_corpus_sync_followups(
                    app_state,
                    &binding,
                    &mut state,
                    indexed_files,
                    removed_files,
                )
                .await?;
            }
            Err(error) => {
                push_audit(
                    &mut state,
                    TRIGGER_VAULT_BOUND,
                    "error",
                    "auto_failed",
                    format!("Auto-sync after vault binding failed: {}", error),
                    now.as_str(),
                    None,
                );
            }
        }
    } else {
        upsert_suggestion(
            &mut state,
            TRIGGER_VAULT_BOUND,
            ACTION_RECONCILE_CORPUS,
            suggestion_fingerprint(TRIGGER_VAULT_BOUND, "initial-corpus-sync"),
            "Run the first corpus reconcile",
            "The vault is bound. Reconcile the dedicated LLM Wiki corpus so maintainer-only retrieval is ready.",
            now.as_str(),
            None,
        );
    }

    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn handle_workspace_bootstrapped(app_state: &AppState) -> Result<(), String> {
    let store = app_state.mcp.store.as_ref();
    let Some(_binding) = load_binding(store).await.map_err(|err| err.to_string())? else {
        return Ok(());
    };
    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    let now = now_rfc3339().map_err(|err| err.to_string())?;

    if state.settings.suggest_maintainer_on_workspace_bootstrap {
        if resolve_existing_maintainer_agent(store).await?.is_none() {
            upsert_suggestion(
                &mut state,
                TRIGGER_WORKSPACE_BOOTSTRAPPED,
                ACTION_CREATE_MAINTAINER_AGENT,
                suggestion_fingerprint(TRIGGER_WORKSPACE_BOOTSTRAPPED, "maintainer-agent"),
                "Create the maintainer agent",
                "The workspace scaffold is ready. Create or reconcile the dedicated maintainer agent before delegating wiki upkeep.",
                now.as_str(),
                None,
            );
        } else {
            transition_suggestion_status_by_fingerprint(
                &mut state,
                suggestion_fingerprint(TRIGGER_WORKSPACE_BOOTSTRAPPED, "maintainer-agent").as_str(),
                STATUS_EXPIRED,
                now.as_str(),
                None,
            );
            push_audit(
                &mut state,
                TRIGGER_WORKSPACE_BOOTSTRAPPED,
                "info",
                "noop",
                "Workspace bootstrap completed, and a maintainer agent already exists.",
                now.as_str(),
                None,
            );
        }
    }

    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn handle_corpus_reconcile_completed(
    app_state: &AppState,
    indexed_files: i64,
    removed_files: i64,
) -> Result<(), String> {
    let store = app_state.mcp.store.as_ref();
    let Some(binding) = load_binding(store).await.map_err(|err| err.to_string())? else {
        return Ok(());
    };
    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    handle_corpus_sync_followups(
        app_state,
        &binding,
        &mut state,
        indexed_files,
        removed_files,
    )
    .await?;
    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn handle_session_end(
    app_state: &AppState,
    session_id: &str,
    next_status: &str,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Ok(());
    }
    let store = app_state.mcp.store.as_ref();
    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    let now = now_rfc3339().map_err(|err| err.to_string())?;
    let binding = load_binding(store).await.map_err(|err| err.to_string())?;
    let lifecycle_context = build_workspace_lifecycle_context(binding.as_ref());
    if !state
        .settings
        .create_crystallization_candidates_on_session_end
    {
        push_audit(
            &mut state,
            TRIGGER_SESSION_END,
            "info",
            "disabled",
            format!(
                "Skipped session-end crystallization for session {} because the hook is disabled.",
                normalized_session_id
            ),
            now.as_str(),
            Some(json!({ "sessionId": normalized_session_id, "status": next_status })),
        );
        save_automation_state(store, &state)
            .await
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let summary = load_conversation_summary_excerpt(app_state, normalized_session_id).await?;
    let Some(summary) = summary else {
        push_audit(
            &mut state,
            TRIGGER_SESSION_END,
            "warning",
            "skipped",
            format!(
                "Session {} ended without summary text available for crystallization.",
                normalized_session_id
            ),
            now.as_str(),
            Some(json!({ "sessionId": normalized_session_id, "status": next_status })),
        );
        save_automation_state(store, &state)
            .await
            .map_err(|err| err.to_string())?;
        return Ok(());
    };

    record_session_end_candidate(
        &mut state,
        lifecycle_context.as_ref(),
        normalized_session_id,
        next_status,
        summary.as_str(),
        now.as_str(),
    );
    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn handle_valuable_answer(
    app_state: &AppState,
    session_id: &str,
    content: &str,
    meta_info: Option<&Value>,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim();
    let normalized_content = content.trim();
    if normalized_session_id.is_empty() || normalized_content.len() < VALUABLE_ANSWER_MIN_CHARS {
        return Ok(());
    }

    if !looks_like_valuable_answer(normalized_content, meta_info) {
        return Ok(());
    }

    let store = app_state.mcp.store.as_ref();
    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    let now = now_rfc3339().map_err(|err| err.to_string())?;
    let binding = load_binding(store).await.map_err(|err| err.to_string())?;
    let lifecycle_context = build_workspace_lifecycle_context(binding.as_ref());

    if !state.settings.suggest_on_valuable_answer {
        push_audit(
            &mut state,
            TRIGGER_VALUABLE_ANSWER,
            "info",
            "disabled",
            "Skipped valuable-answer candidate creation because the hook is disabled.",
            now.as_str(),
            Some(json!({ "sessionId": normalized_session_id })),
        );
        save_automation_state(store, &state)
            .await
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let summary = trim_preview_text(normalized_content, 600);
    let repeat_count = record_valuable_answer_candidate(
        &mut state,
        lifecycle_context.as_ref(),
        normalized_session_id,
        summary.as_str(),
        now.as_str(),
    );

    if state.settings.promote_repeated_stable_conclusions_to_memory
        && repeat_count >= MEMORY_PROMOTION_REPEAT_THRESHOLD
    {
        let fingerprint = suggestion_fingerprint(TRIGGER_VALUABLE_ANSWER, summary.as_str());
        maybe_promote_repeated_conclusion_to_memory(
            app_state,
            &mut state,
            lifecycle_context.as_ref(),
            normalized_session_id,
            fingerprint.as_str(),
            summary.as_str(),
            now.as_str(),
        )
        .await?;
    }

    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn handle_summary_generated(
    app_state: &AppState,
    session_id: &str,
    summary_text: &str,
    session_status: &str,
    trigger_source: &str,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim();
    let normalized_summary = summary_text.trim();
    if normalized_session_id.is_empty() || normalized_summary.is_empty() {
        return Ok(());
    }

    let store = app_state.mcp.store.as_ref();
    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    let now = now_rfc3339().map_err(|err| err.to_string())?;
    let binding = load_binding(store).await.map_err(|err| err.to_string())?;
    let lifecycle_context = build_workspace_lifecycle_context(binding.as_ref());

    if !session_status.eq_ignore_ascii_case("active")
        && state
            .settings
            .create_crystallization_candidates_on_session_end
    {
        record_session_end_candidate(
            &mut state,
            lifecycle_context.as_ref(),
            normalized_session_id,
            session_status,
            normalized_summary,
            now.as_str(),
        );
        push_audit(
            &mut state,
            TRIGGER_SESSION_END,
            "info",
            "observed",
            "Summary worker refreshed a non-active session and reinforced the session-end crystallization candidate.",
            now.as_str(),
            Some(json!({
                "sessionId": normalized_session_id,
                "status": session_status,
                "triggerSource": trigger_source,
            })),
        );
    }

    if state.settings.suggest_on_valuable_answer && looks_like_summary_candidate(normalized_summary)
    {
        let repeat_count = record_valuable_answer_candidate(
            &mut state,
            lifecycle_context.as_ref(),
            normalized_session_id,
            normalized_summary,
            now.as_str(),
        );

        if state.settings.promote_repeated_stable_conclusions_to_memory
            && repeat_count >= MEMORY_PROMOTION_REPEAT_THRESHOLD
        {
            let fingerprint = suggestion_fingerprint(TRIGGER_VALUABLE_ANSWER, normalized_summary);
            maybe_promote_repeated_conclusion_to_memory(
                app_state,
                &mut state,
                lifecycle_context.as_ref(),
                normalized_session_id,
                fingerprint.as_str(),
                normalized_summary,
                now.as_str(),
            )
            .await?;
        }
    }

    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn run_schedule_tick(
    app_state: &AppState,
    trigger_source: &str,
) -> Result<(), String> {
    let store = app_state.mcp.store.as_ref();
    let Some(binding) = load_binding(store).await.map_err(|err| err.to_string())? else {
        return Ok(());
    };

    let mut state = load_automation_state(store)
        .await
        .map_err(|err| err.to_string())?;
    if !state.settings.enable_schedule_suggestions {
        return Ok(());
    }

    let now = now_rfc3339().map_err(|err| err.to_string())?;
    if let Some(last_run_at) = state.last_schedule_run_at.as_deref() {
        let now_epoch = parse_rfc3339_to_unix_epoch(&now)
            .ok_or_else(|| "could not parse current schedule timestamp".to_string())?;
        let previous_epoch = parse_rfc3339_to_unix_epoch(last_run_at)
            .ok_or_else(|| "could not parse last schedule timestamp".to_string())?;
        if now_epoch.saturating_sub(previous_epoch) < MAINTENANCE_SCHEDULE_INTERVAL_SECS {
            return Ok(());
        }
    }

    let workspace_path = {
        let vault_root = normalize_vault_root(&binding.vault_root)?;
        resolve_workspace_path(&vault_root, &binding.workspace_relative_path)
            .to_string_lossy()
            .to_string()
    };
    let maintainer = resolve_existing_maintainer_agent(store).await?;
    let state_snapshot = get_local_llm_wiki_state(store).await?;
    let corpus_status = state_snapshot.corpus_status;

    if let Some(corpus) = corpus_status.as_ref() {
        let last_synced_at = corpus.last_synced_at.as_deref().unwrap_or_default();
        let has_backlog = corpus.queued_change_count > 0 || corpus.pending_note_count > 0;
        let has_failures = corpus.failed_note_count > 0;
        let stale = if last_synced_at.is_empty() {
            true
        } else {
            let now_epoch = parse_rfc3339_to_unix_epoch(&now)
                .ok_or_else(|| "could not parse current reconcile timestamp".to_string())?;
            let sync_epoch = parse_rfc3339_to_unix_epoch(last_synced_at)
                .ok_or_else(|| "could not parse corpus reconcile timestamp".to_string())?;
            now_epoch.saturating_sub(sync_epoch) > MAINTENANCE_SCHEDULE_INTERVAL_SECS
        };
        if stale || has_backlog || has_failures {
            upsert_suggestion(
                &mut state,
                TRIGGER_MAINTENANCE_SCHEDULE,
                ACTION_RECONCILE_CORPUS,
                suggestion_fingerprint(TRIGGER_MAINTENANCE_SCHEDULE, "stale-corpus-sync"),
                "Refresh the dedicated corpus",
                "The dedicated LLM Wiki corpus has pending changes, failures, or stale reconcile state. Run a reconcile before the next wiki maintenance pass.",
                now.as_str(),
                Some(json!({
                    "queuedChangeCount": corpus.queued_change_count,
                    "pendingNoteCount": corpus.pending_note_count,
                    "failedNoteCount": corpus.failed_note_count,
                })),
            );
        } else {
            expire_suggestion_by_fingerprint(
                &mut state,
                suggestion_fingerprint(TRIGGER_MAINTENANCE_SCHEDULE, "stale-corpus-sync").as_str(),
                now.as_str(),
            );
        }
    }

    let review_goal = format!(
        "Run a maintenance review for the Deeting-managed LLM Wiki workspace at {}. Check for stale pages, lint-worthy inconsistencies, supersession candidates, and missing source summaries. Keep writes inside the managed workspace and record notable findings in log.md.",
        workspace_path
    );

    if maintainer.is_some() {
        if state.settings.auto_delegate_maintenance_schedule {
            let worker_ref = resolve_maintainer_worker_ref(store).await?;
            let app_handle = global_app_handle()
                .ok_or_else(|| "global app handle is not available".to_string())?;
            match crate::modules::workflow::service::quick_workflow_run(
                &app_handle,
                app_state,
                QuickWorkflowRequest {
                    goal: review_goal.clone(),
                    worker_ref: Some(worker_ref),
                    inject_into_chat: false,
                    user_notes: None,
                    execution_model_id: None,
                    execution_provider_model_id: None,
                    worker_task_packet: None,
                },
            )
            .await
            {
                Ok(result) => {
                    transition_suggestion_status_by_fingerprint(
                        &mut state,
                        suggestion_fingerprint(TRIGGER_MAINTENANCE_SCHEDULE, "maintenance-review")
                            .as_str(),
                        STATUS_EXPIRED,
                        now.as_str(),
                        None,
                    );
                    push_audit(
                        &mut state,
                        TRIGGER_MAINTENANCE_SCHEDULE,
                        "info",
                        "auto_executed",
                        "Started an automated maintenance review workflow for the LLM Wiki.",
                        now.as_str(),
                        Some(json!({
                            "workflowRunId": result.run.id,
                            "triggerSource": trigger_source,
                        })),
                    );
                }
                Err(error) => {
                    push_audit(
                        &mut state,
                        TRIGGER_MAINTENANCE_SCHEDULE,
                        "error",
                        "auto_failed",
                        format!("Automatic maintenance review failed: {}", error),
                        now.as_str(),
                        Some(json!({ "triggerSource": trigger_source })),
                    );
                }
            }
        } else {
            upsert_suggestion(
                &mut state,
                TRIGGER_MAINTENANCE_SCHEDULE,
                ACTION_RUN_MAINTENANCE_REVIEW,
                suggestion_fingerprint(TRIGGER_MAINTENANCE_SCHEDULE, "maintenance-review"),
                "Run a maintenance review",
                "Schedule a bounded maintainer pass for lint, stale checks, and supersession review.",
                now.as_str(),
                Some(json!({
                    "goal": review_goal,
                    "workspacePath": workspace_path,
                })),
            );
        }
    } else {
        transition_suggestion_status_by_fingerprint(
            &mut state,
            suggestion_fingerprint(TRIGGER_MAINTENANCE_SCHEDULE, "maintenance-review").as_str(),
            STATUS_EXPIRED,
            now.as_str(),
            None,
        );
    }

    state.last_schedule_run_at = Some(now.clone());
    push_audit(
        &mut state,
        TRIGGER_MAINTENANCE_SCHEDULE,
        "info",
        "scheduled",
        "Evaluated the periodic LLM Wiki maintenance schedule.",
        now.as_str(),
        Some(json!({ "triggerSource": trigger_source })),
    );
    save_automation_state(store, &state)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn start_local_llm_wiki_automation_worker(app_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(err) = run_schedule_tick(&app_state, "periodic_worker").await {
            log::warn!("llm wiki automation worker error: {}", err);
        }
    }
}

fn apply_settings_patch(
    settings: &mut LocalLlmWikiAutomationSettings,
    payload: UpdateLocalLlmWikiAutomationSettingsRequest,
) {
    if let Some(value) = payload.auto_sync_on_vault_bound {
        settings.auto_sync_on_vault_bound = value;
    }
    if let Some(value) = payload.suggest_maintainer_on_workspace_bootstrap {
        settings.suggest_maintainer_on_workspace_bootstrap = value;
    }
    if let Some(value) = payload.auto_refresh_inspector_on_corpus_sync {
        settings.auto_refresh_inspector_on_corpus_sync = value;
    }
    if let Some(value) = payload.create_crystallization_candidates_on_session_end {
        settings.create_crystallization_candidates_on_session_end = value;
    }
    if let Some(value) = payload.enable_schedule_suggestions {
        settings.enable_schedule_suggestions = value;
    }
    if let Some(value) = payload.suggest_on_valuable_answer {
        settings.suggest_on_valuable_answer = value;
    }
    if let Some(value) = payload.auto_delegate_new_sources {
        settings.auto_delegate_new_sources = value;
    }
    if let Some(value) = payload.auto_delegate_maintenance_schedule {
        settings.auto_delegate_maintenance_schedule = value;
    }
    if let Some(value) = payload.promote_repeated_stable_conclusions_to_memory {
        settings.promote_repeated_stable_conclusions_to_memory = value;
    }
}

fn record_session_end_candidate(
    state: &mut LocalLlmWikiAutomationState,
    lifecycle_context: Option<&WorkspaceLifecycleContext>,
    session_id: &str,
    next_status: &str,
    summary: &str,
    now: &str,
) {
    let claim_id = suggestion_fingerprint(TRIGGER_SESSION_END, session_id);
    let goal = format!(
        "Review the closed conversation summary below and crystallize any durable wiki-worthy conclusions into the Deeting-managed LLM Wiki workspace. Keep writes inside the managed workspace only.\n\nSession summary:\n{}",
        summary
    );

    upsert_suggestion(
        state,
        TRIGGER_SESSION_END,
        ACTION_CRYSTALLIZE_SESSION_SUMMARY,
        claim_id.clone(),
        "Crystallize the closed session",
        "A conversation just ended. Review its summary and decide whether it should become a maintained wiki page or analysis note.",
        now,
        Some(json!({
            "sessionId": session_id,
            "status": next_status,
            "summary": summary,
            "goal": goal,
            "lifecycle": build_lifecycle_metadata(
                lifecycle_context,
                claim_id.as_str(),
                Some(session_id),
                "session_summary",
                now,
                1,
                "candidate",
            ),
        })),
    );
    push_audit(
        state,
        TRIGGER_SESSION_END,
        "info",
        "suggested",
        format!(
            "Created a crystallization candidate after session {} moved to {}.",
            session_id, next_status
        ),
        now,
        Some(json!({ "sessionId": session_id, "status": next_status })),
    );
}

fn record_valuable_answer_candidate(
    state: &mut LocalLlmWikiAutomationState,
    lifecycle_context: Option<&WorkspaceLifecycleContext>,
    session_id: &str,
    summary: &str,
    now: &str,
) -> i64 {
    let claim_id = suggestion_fingerprint(TRIGGER_VALUABLE_ANSWER, summary);
    let repeat_count = upsert_suggestion(
        state,
        TRIGGER_VALUABLE_ANSWER,
        ACTION_CRYSTALLIZE_SESSION_SUMMARY,
        claim_id.clone(),
        "Capture a valuable answer",
        "A recent assistant answer looks durable enough to review for the managed wiki.",
        now,
        Some(json!({
            "sessionId": session_id,
            "summary": summary,
            "goal": format!(
                "Review the valuable answer below and capture any durable wiki-worthy conclusions inside the Deeting-managed LLM Wiki workspace.\n\nAnswer:\n{}",
                summary
            ),
            "lifecycle": build_lifecycle_metadata(
                lifecycle_context,
                claim_id.as_str(),
                Some(session_id),
                "valuable_answer",
                now,
                1,
                "candidate",
            ),
        })),
    );

    push_audit(
        state,
        TRIGGER_VALUABLE_ANSWER,
        "info",
        "suggested",
        "Created or refreshed a valuable-answer wiki candidate.",
        now,
        Some(json!({
            "sessionId": session_id,
            "repeatCount": repeat_count,
        })),
    );
    repeat_count
}

async fn handle_corpus_sync_followups(
    app_state: &AppState,
    binding: &PersistedLlmWikiBinding,
    state: &mut LocalLlmWikiAutomationState,
    indexed_files: i64,
    removed_files: i64,
) -> Result<(), String> {
    let now = now_rfc3339().map_err(|err| err.to_string())?;
    push_audit(
        state,
        TRIGGER_CORPUS_RECONCILE_COMPLETED,
        "info",
        "observed",
        format!(
            "Corpus reconcile completed. Indexed {} files and removed {} stale entries.",
            indexed_files, removed_files
        ),
        now.as_str(),
        Some(json!({
            "indexedFiles": indexed_files,
            "removedFiles": removed_files,
        })),
    );

    if state.settings.auto_refresh_inspector_on_corpus_sync {
        upsert_suggestion(
            state,
            TRIGGER_CORPUS_RECONCILE_COMPLETED,
            ACTION_INSPECT_CORPUS,
            suggestion_fingerprint(TRIGGER_CORPUS_RECONCILE_COMPLETED, "inspect-after-sync"),
            "Inspect the refreshed corpus",
            "The dedicated corpus changed. Review a few hits in the inspector before you hand off to the maintainer.",
            now.as_str(),
            Some(json!({ "query": "workspace" })),
        );
    } else {
        transition_suggestion_status_by_fingerprint(
            state,
            suggestion_fingerprint(TRIGGER_CORPUS_RECONCILE_COMPLETED, "inspect-after-sync")
                .as_str(),
            STATUS_EXPIRED,
            now.as_str(),
            None,
        );
    }

    if indexed_files > 0 {
        let workspace_path = {
            let vault_root = normalize_vault_root(&binding.vault_root)?;
            resolve_workspace_path(&vault_root, &binding.workspace_relative_path)
                .to_string_lossy()
                .to_string()
        };

        if state.settings.auto_delegate_new_sources
            && resolve_existing_maintainer_agent(app_state.mcp.store.as_ref())
                .await?
                .is_some()
        {
            let worker_ref = resolve_maintainer_worker_ref(app_state.mcp.store.as_ref()).await?;
            let app_handle = global_app_handle()
                .ok_or_else(|| "global app handle is not available".to_string())?;
            let goal = format!(
                "New source material appears to have entered the dedicated LLM Wiki corpus. Review the freshest corpus changes, then update the managed workspace at {} if the new source deserves durable wiki coverage. Keep writes inside the managed workspace only.",
                workspace_path
            );
            match crate::modules::workflow::service::quick_workflow_run(
                &app_handle,
                app_state,
                QuickWorkflowRequest {
                    goal,
                    worker_ref: Some(worker_ref),
                    inject_into_chat: false,
                    user_notes: None,
                    execution_model_id: None,
                    execution_provider_model_id: None,
                    worker_task_packet: None,
                },
            )
            .await
            {
                Ok(result) => {
                    transition_suggestion_status_by_fingerprint(
                        state,
                        suggestion_fingerprint(TRIGGER_NEW_SOURCE, "review-new-sources").as_str(),
                        STATUS_EXPIRED,
                        now.as_str(),
                        None,
                    );
                    push_audit(
                        state,
                        TRIGGER_NEW_SOURCE,
                        "info",
                        "auto_executed",
                        "Started an automatic new-source maintainer review workflow.",
                        now.as_str(),
                        Some(json!({
                            "workflowRunId": result.run.id,
                            "indexedFiles": indexed_files,
                        })),
                    )
                }
                Err(error) => push_audit(
                    state,
                    TRIGGER_NEW_SOURCE,
                    "error",
                    "auto_failed",
                    format!("Automatic new-source review failed: {}", error),
                    now.as_str(),
                    Some(json!({ "indexedFiles": indexed_files })),
                ),
            }
        } else {
            upsert_suggestion(
                state,
                TRIGGER_NEW_SOURCE,
                ACTION_RUN_MAINTENANCE_REVIEW,
                suggestion_fingerprint(TRIGGER_NEW_SOURCE, "review-new-sources"),
                "Review newly indexed sources",
                "The corpus gained new material. Ask the maintainer to inspect the fresh sources and decide whether the managed workspace needs updates.",
                now.as_str(),
                Some(json!({
                    "goal": "Review the newly indexed source material in the dedicated LLM Wiki corpus and update the managed workspace if the new material deserves durable coverage.",
                    "indexedFiles": indexed_files,
                })),
            );
        }
    } else {
        transition_suggestion_status_by_fingerprint(
            state,
            suggestion_fingerprint(TRIGGER_NEW_SOURCE, "review-new-sources").as_str(),
            STATUS_STALE,
            now.as_str(),
            None,
        );
    }

    Ok(())
}

async fn maybe_promote_repeated_conclusion_to_memory(
    app_state: &AppState,
    state: &mut LocalLlmWikiAutomationState,
    lifecycle_context: Option<&WorkspaceLifecycleContext>,
    session_id: &str,
    fingerprint: &str,
    summary: &str,
    now: &str,
) -> Result<(), String> {
    let suggestion = state
        .suggestions
        .iter()
        .find(|item| item.fingerprint == fingerprint)
        .cloned();
    let Some(suggestion) = suggestion else {
        return Ok(());
    };

    let metadata = suggestion.metadata.as_ref().and_then(Value::as_object);
    let repeat_count = metadata
        .and_then(|value| value.get("repeatCount"))
        .and_then(Value::as_i64)
        .unwrap_or(1);
    if !should_promote_repeated_conclusion(metadata, repeat_count) {
        return Ok(());
    }

    let already_promoted = metadata
        .and_then(|value| value.get("memoryPromoted"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if already_promoted {
        return Ok(());
    }

    let result = app_state
        .memory
        .service
        .append_guarded_with_profile(
            build_memory_promotion_request(
                lifecycle_context,
                summary,
                Some(session_id),
                fingerprint,
                metadata,
                None,
                repeat_count,
                now,
            ),
            WriteGuardProfile::WikiPromotion,
        )
        .await
        .map_err(|err| err.to_string())?;

    if let Some(item) = state
        .suggestions
        .iter_mut()
        .find(|item| item.fingerprint == fingerprint)
    {
        let action = format!("{:?}", result.action).to_ascii_lowercase();
        update_memory_promotion_metadata(
            &mut item.metadata,
            now,
            action.as_str(),
            result
                .item
                .as_ref()
                .map(|memory| memory.id.as_str())
                .or(result.updated_memory_id.as_deref()),
            repeat_count,
        );
        item.updated_at = now.to_string();
    }

    push_audit(
        state,
        TRIGGER_REPEATED_STABLE_CONCLUSION,
        "info",
        "auto_executed",
        "Promoted a repeated stable conclusion into local memory.",
        now,
        Some(json!({
            "fingerprint": fingerprint,
            "sessionId": session_id,
            "memoryAction": format!("{:?}", result.action).to_ascii_lowercase(),
            "workspaceId": lifecycle_context
                .as_ref()
                .map(|value| value.workspace_id.as_str()),
        })),
    );

    if format!("{:?}", result.action).to_ascii_lowercase() != "noop" {
        upsert_suggestion(
            state,
            TRIGGER_REPEATED_STABLE_CONCLUSION,
            ACTION_PROMOTE_TO_MEMORY,
            suggestion_fingerprint(TRIGGER_REPEATED_STABLE_CONCLUSION, fingerprint),
            "Review the promoted conclusion",
            "A repeated stable conclusion was strong enough to enter local memory. Review the memory promotion outcome if needed.",
            now,
            Some(json!({
                "sessionId": session_id,
                "memoryContent": summary,
                "lifecycle": build_lifecycle_metadata(
                    lifecycle_context,
                    fingerprint,
                    Some(session_id),
                    "valuable_answer",
                    now,
                    repeat_count,
                    "promoted",
                ),
            })),
        );
    }

    Ok(())
}

async fn resolve_existing_maintainer_agent(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<Option<crate::modules::custom_task_agents::types::CustomTaskAgentProfile>, String> {
    let profiles = list_custom_task_agents_inner(store)
        .await
        .map_err(|err| err.to_string())?;
    Ok(profiles.into_iter().find(|profile| {
        profile.source_kind.as_deref() == Some(LLM_WIKI_MAINTAINER_SOURCE_KIND)
            && profile.is_enabled
    }))
}

async fn resolve_maintainer_worker_ref(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<String, String> {
    let profile = resolve_existing_maintainer_agent(store)
        .await?
        .ok_or_else(|| "llm wiki maintainer agent is not available".to_string())?;
    Ok(format!("user_worker_profile:{}", profile.id))
}

async fn load_conversation_summary_excerpt(
    app_state: &AppState,
    session_id: &str,
) -> Result<Option<String>, String> {
    if let Some(summary) = app_state
        .mcp
        .store
        .get_latest_local_conversation_summary(session_id)
        .await
        .map_err(|err| err.to_string())?
    {
        return Ok(Some(trim_preview_text(summary.as_str(), 900)));
    }

    let window = app_state
        .mcp
        .store
        .load_local_conversation_runtime_window(session_id)
        .await
        .map_err(|err| err.to_string())?;
    if window.messages.is_empty() {
        return Ok(None);
    }
    let summary = build_local_summary_from_window(&window.messages);
    let trimmed = summary.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trim_preview_text(trimmed, 900)))
    }
}

fn looks_like_valuable_answer(content: &str, meta_info: Option<&Value>) -> bool {
    if content.len() >= 480 {
        return true;
    }

    let has_structure = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
        >= 5
        && (content.contains("## ")
            || content.contains("# ")
            || content.contains("- ")
            || content.contains("1. "));
    if has_structure && content.len() >= 180 {
        return true;
    }

    meta_info
        .and_then(|value| value.get("execution_tree"))
        .and_then(Value::as_object)
        .and_then(|value| value.get("terminal_status"))
        .and_then(Value::as_str)
        .map(|value| value.eq_ignore_ascii_case("succeeded"))
        .unwrap_or(false)
}

fn looks_like_summary_candidate(summary: &str) -> bool {
    let lines = summary
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    summary.len() >= 200 || (summary.len() >= 140 && lines >= 4)
}

fn upsert_suggestion(
    state: &mut LocalLlmWikiAutomationState,
    trigger: &str,
    action_kind: &str,
    fingerprint: String,
    title: &str,
    description: &str,
    now: &str,
    metadata: Option<Value>,
) -> i64 {
    supersede_related_pending_suggestions(
        state,
        trigger,
        action_kind,
        &fingerprint,
        metadata.as_ref(),
        now,
    );
    if let Some(existing) = state
        .suggestions
        .iter_mut()
        .find(|item| item.fingerprint == fingerprint)
    {
        let next_repeat_count = existing
            .metadata
            .as_ref()
            .and_then(Value::as_object)
            .and_then(|value| value.get("repeatCount"))
            .and_then(Value::as_i64)
            .unwrap_or(1)
            + 1;
        existing.trigger = trigger.to_string();
        existing.action_kind = action_kind.to_string();
        existing.title = title.to_string();
        existing.description = description.to_string();
        existing.status = STATUS_PENDING.to_string();
        existing.updated_at = now.to_string();
        existing.metadata = Some(merge_metadata(
            existing.metadata.as_ref(),
            metadata.as_ref(),
            next_repeat_count,
            now,
        ));
        return next_repeat_count;
    }

    let suggestion = LocalLlmWikiAutomationSuggestion {
        id: uuid::Uuid::new_v4().to_string(),
        fingerprint,
        trigger: trigger.to_string(),
        action_kind: action_kind.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        status: STATUS_PENDING.to_string(),
        created_at: now.to_string(),
        updated_at: now.to_string(),
        metadata: Some(merge_metadata(None, metadata.as_ref(), 1, now)),
    };
    state.suggestions.insert(0, suggestion);
    if state.suggestions.len() > MAX_SUGGESTIONS {
        state.suggestions.truncate(MAX_SUGGESTIONS);
    }
    1
}

fn supersede_related_pending_suggestions(
    state: &mut LocalLlmWikiAutomationState,
    trigger: &str,
    action_kind: &str,
    fingerprint: &str,
    metadata: Option<&Value>,
    now: &str,
) {
    let session_id = metadata
        .and_then(Value::as_object)
        .and_then(|value| value.get("sessionId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let Some(session_id) = session_id else {
        return;
    };

    for suggestion in &mut state.suggestions {
        if suggestion.fingerprint == fingerprint
            || suggestion.trigger != trigger
            || suggestion.action_kind != action_kind
            || suggestion.status != STATUS_PENDING
        {
            continue;
        }

        let same_session = suggestion
            .metadata
            .as_ref()
            .and_then(Value::as_object)
            .and_then(|value| value.get("sessionId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .map(|value| value.eq_ignore_ascii_case(session_id.as_str()))
            .unwrap_or(false);
        if !same_session {
            continue;
        }

        suggestion.status = STATUS_SUPERSEDED.to_string();
        suggestion.updated_at = now.to_string();
        if let Some(metadata) = suggestion
            .metadata
            .as_mut()
            .and_then(Value::as_object_mut)
            .and_then(|value| ensure_object_field(value, "lifecycle"))
        {
            metadata.insert("supersededBy".to_string(), json!(fingerprint));
            metadata.insert("lastValidatedAt".to_string(), json!(now));
        }
    }
}

fn expire_suggestion_by_fingerprint(
    state: &mut LocalLlmWikiAutomationState,
    fingerprint: &str,
    now: &str,
) {
    transition_suggestion_status_by_fingerprint(state, fingerprint, STATUS_EXPIRED, now, None);
}

fn transition_suggestion_status_by_fingerprint(
    state: &mut LocalLlmWikiAutomationState,
    fingerprint: &str,
    status: &str,
    now: &str,
    superseded_by: Option<&str>,
) {
    let Some(suggestion) = state
        .suggestions
        .iter_mut()
        .find(|item| item.fingerprint == fingerprint && item.status == STATUS_PENDING)
    else {
        return;
    };

    suggestion.status = status.to_string();
    suggestion.updated_at = now.to_string();
    if let Some(lifecycle) = suggestion
        .metadata
        .as_mut()
        .and_then(Value::as_object_mut)
        .and_then(|value| ensure_object_field(value, "lifecycle"))
    {
        lifecycle.insert("lastValidatedAt".to_string(), json!(now));
        if let Some(superseded_by) = superseded_by {
            lifecycle.insert("supersededBy".to_string(), json!(superseded_by));
        }
    }
}

fn merge_metadata(
    existing: Option<&Value>,
    incoming: Option<&Value>,
    repeat_count: i64,
    now: &str,
) -> Value {
    let existing = existing.and_then(Value::as_object);
    let incoming = incoming.and_then(Value::as_object);
    let mut object = existing.cloned().unwrap_or_default();
    if let Some(incoming) = incoming {
        for (key, value) in incoming {
            if key == "lifecycle" {
                continue;
            }
            object.insert(key.clone(), value.clone());
        }
    }
    object.insert("repeatCount".to_string(), json!(repeat_count));
    let lifecycle = merge_lifecycle_object(
        existing
            .and_then(|value| value.get("lifecycle"))
            .and_then(Value::as_object),
        incoming
            .and_then(|value| value.get("lifecycle"))
            .and_then(Value::as_object),
        repeat_count,
        now,
    );
    if !lifecycle.is_empty() {
        object.insert("lifecycle".to_string(), Value::Object(lifecycle));
    }
    Value::Object(object)
}

fn build_workspace_lifecycle_context(
    binding: Option<&PersistedLlmWikiBinding>,
) -> Option<WorkspaceLifecycleContext> {
    let binding = binding?;
    let workspace_relative_path = binding.workspace_relative_path.replace('\\', "/");
    let workspace_seed = format!("{}::{}", binding.vault_root.trim(), workspace_relative_path);
    let workspace_id = suggestion_fingerprint("llm_wiki_workspace", workspace_seed.as_str());
    Some(WorkspaceLifecycleContext {
        memory_source_scope: format!("llm_wiki_automation::{}", workspace_id),
        workspace_id,
        workspace_relative_path,
    })
}

fn workspace_lifecycle_context_from_metadata(
    metadata: &serde_json::Map<String, Value>,
) -> Option<WorkspaceLifecycleContext> {
    let lifecycle = metadata.get("lifecycle")?.as_object()?;
    let workspace_id = lifecycle
        .get("workspaceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let memory_source_scope = lifecycle
        .get("memorySourceScope")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("llm_wiki_automation")
        .to_string();
    let workspace_relative_path = lifecycle
        .get("workspaceRelativePath")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    Some(WorkspaceLifecycleContext {
        workspace_id,
        workspace_relative_path,
        memory_source_scope,
    })
}

fn build_lifecycle_metadata_object(
    lifecycle_context: Option<&WorkspaceLifecycleContext>,
    claim_id: &str,
    session_id: Option<&str>,
    source_kind: &str,
    now: &str,
    repeat_count: i64,
    promotion_state: &str,
) -> serde_json::Map<String, Value> {
    let mut source_refs = Vec::new();
    let has_session_ref = session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if let Some(session_id) = session_id.map(str::trim).filter(|value| !value.is_empty()) {
        source_refs.push(json!({
            "kind": "session",
            "id": session_id,
            "source": source_kind,
        }));
    }
    if let Some(context) = lifecycle_context {
        source_refs.push(json!({
            "kind": "workspace",
            "id": context.workspace_id,
            "relativePath": context.workspace_relative_path,
        }));
    }

    let mut lifecycle = serde_json::Map::new();
    lifecycle.insert(
        "workspaceId".to_string(),
        json!(lifecycle_context.map(|value| value.workspace_id.as_str())),
    );
    lifecycle.insert(
        "workspaceRelativePath".to_string(),
        json!(lifecycle_context.map(|value| value.workspace_relative_path.as_str())),
    );
    lifecycle.insert(
        "memorySourceScope".to_string(),
        json!(lifecycle_context.map(|value| value.memory_source_scope.as_str())),
    );
    lifecycle.insert("pageId".to_string(), Value::Null);
    lifecycle.insert("claimId".to_string(), json!(claim_id));
    lifecycle.insert("sourceRefs".to_string(), Value::Array(source_refs));
    lifecycle.insert(
        "distinctSessionCount".to_string(),
        json!(has_session_ref as i64),
    );
    lifecycle.insert("repeatCount".to_string(), json!(repeat_count));
    lifecycle.insert(
        "confidence".to_string(),
        json!(lifecycle_confidence(repeat_count, promotion_state)),
    );
    lifecycle.insert("lastValidatedAt".to_string(), json!(now));
    lifecycle.insert("supersededBy".to_string(), Value::Null);
    lifecycle.insert("promotionState".to_string(), json!(promotion_state));
    lifecycle.insert("manualOverride".to_string(), json!(false));
    lifecycle.insert("pinned".to_string(), json!(false));
    lifecycle
}

fn build_lifecycle_metadata(
    lifecycle_context: Option<&WorkspaceLifecycleContext>,
    claim_id: &str,
    session_id: Option<&str>,
    source_kind: &str,
    now: &str,
    repeat_count: i64,
    promotion_state: &str,
) -> Value {
    Value::Object(build_lifecycle_metadata_object(
        lifecycle_context,
        claim_id,
        session_id,
        source_kind,
        now,
        repeat_count,
        promotion_state,
    ))
}

fn merge_lifecycle_object(
    existing: Option<&serde_json::Map<String, Value>>,
    incoming: Option<&serde_json::Map<String, Value>>,
    repeat_count: i64,
    now: &str,
) -> serde_json::Map<String, Value> {
    let mut lifecycle = existing.cloned().unwrap_or_default();

    if let Some(incoming) = incoming {
        for (key, value) in incoming {
            match key.as_str() {
                "sourceRefs" => {}
                "manualOverride" | "pinned" => {
                    let existing_bool =
                        lifecycle.get(key).and_then(Value::as_bool).unwrap_or(false);
                    lifecycle.insert(
                        key.clone(),
                        json!(existing_bool || value.as_bool().unwrap_or(false)),
                    );
                }
                "promotionState" => {
                    let merged = preferred_promotion_state(
                        lifecycle.get("promotionState").and_then(Value::as_str),
                        value.as_str(),
                    );
                    lifecycle.insert(key.clone(), json!(merged));
                }
                _ => {
                    if !value.is_null() {
                        lifecycle.insert(key.clone(), value.clone());
                    }
                }
            }
        }
    }

    let source_refs = merge_source_refs(existing, incoming);
    lifecycle.insert("sourceRefs".to_string(), Value::Array(source_refs));
    lifecycle.insert(
        "distinctSessionCount".to_string(),
        json!(count_session_source_refs(&lifecycle) as i64),
    );
    lifecycle.insert("repeatCount".to_string(), json!(repeat_count));

    let promotion_state = lifecycle
        .get("promotionState")
        .and_then(Value::as_str)
        .unwrap_or("candidate")
        .to_string();
    lifecycle.insert(
        "confidence".to_string(),
        json!(lifecycle_confidence(repeat_count, promotion_state.as_str())),
    );
    lifecycle.insert("lastValidatedAt".to_string(), json!(now));
    lifecycle
}

fn merge_source_refs(
    existing: Option<&serde_json::Map<String, Value>>,
    incoming: Option<&serde_json::Map<String, Value>>,
) -> Vec<Value> {
    let mut merged = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    for refs in [
        existing
            .and_then(|value| value.get("sourceRefs"))
            .and_then(Value::as_array),
        incoming
            .and_then(|value| value.get("sourceRefs"))
            .and_then(Value::as_array),
    ] {
        for value in refs.into_iter().flatten() {
            let Some(key) = source_ref_key(value) else {
                continue;
            };
            if seen.insert(key) {
                merged.push(value.clone());
            }
        }
    }

    merged
}

fn source_ref_key(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let source = object
        .get("source")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let relative_path = object
        .get("relativePath")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    Some(format!("{kind}|{id}|{source}|{relative_path}"))
}

fn count_session_source_refs(lifecycle: &serde_json::Map<String, Value>) -> usize {
    lifecycle
        .get("sourceRefs")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|value| value.as_object())
                .filter(|value| {
                    value
                        .get("kind")
                        .and_then(Value::as_str)
                        .map(|kind| kind.eq_ignore_ascii_case("session"))
                        .unwrap_or(false)
                })
                .filter_map(|value| value.get("id").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<std::collections::BTreeSet<_>>()
                .len()
        })
        .unwrap_or(0)
}

fn preferred_promotion_state(existing: Option<&str>, incoming: Option<&str>) -> String {
    let existing = existing.unwrap_or("candidate");
    let incoming = incoming.unwrap_or(existing);
    if promotion_state_rank(existing) >= promotion_state_rank(incoming) {
        existing.to_string()
    } else {
        incoming.to_string()
    }
}

fn promotion_state_rank(value: &str) -> u8 {
    if value.eq_ignore_ascii_case("promoted") {
        2
    } else if value.eq_ignore_ascii_case("candidate") {
        1
    } else {
        0
    }
}

fn should_promote_repeated_conclusion(
    metadata: Option<&serde_json::Map<String, Value>>,
    repeat_count: i64,
) -> bool {
    let lifecycle = metadata
        .and_then(|value| value.get("lifecycle"))
        .and_then(Value::as_object);

    let pinned = lifecycle
        .and_then(|value| value.get("pinned"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let manual_override = lifecycle
        .and_then(|value| value.get("manualOverride"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if pinned || manual_override {
        return true;
    }

    if repeat_count >= MEMORY_PROMOTION_STRONG_REPEAT_THRESHOLD {
        return true;
    }

    if repeat_count < MEMORY_PROMOTION_REPEAT_THRESHOLD {
        return false;
    }

    let confidence = lifecycle
        .and_then(|value| value.get("confidence"))
        .and_then(Value::as_f64)
        .unwrap_or_else(|| lifecycle_confidence(repeat_count, "candidate"));
    let distinct_session_count = lifecycle
        .and_then(|value| value.get("distinctSessionCount"))
        .and_then(Value::as_i64)
        .map(|value| value.max(0) as usize)
        .or_else(|| lifecycle.map(count_session_source_refs))
        .unwrap_or(0);

    confidence >= MEMORY_PROMOTION_MIN_CONFIDENCE
        && distinct_session_count >= MEMORY_PROMOTION_MIN_DISTINCT_SESSION_SOURCES
}

fn lifecycle_confidence(repeat_count: i64, promotion_state: &str) -> f64 {
    let base = if promotion_state.eq_ignore_ascii_case("promoted") {
        0.78
    } else {
        0.52
    };
    let reinforcement = (repeat_count.saturating_sub(1) as f64 * 0.12).min(0.24);
    (base + reinforcement).clamp(0.0, 0.95)
}

fn update_memory_promotion_metadata(
    metadata: &mut Option<Value>,
    now: &str,
    action: &str,
    memory_id: Option<&str>,
    repeat_count: i64,
) {
    let mut object = metadata
        .as_ref()
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    object.insert("memoryPromoted".to_string(), json!(true));
    object.insert("memoryAction".to_string(), json!(action));
    if let Some(lifecycle) = ensure_object_field(&mut object, "lifecycle") {
        lifecycle.insert("promotionState".to_string(), json!("promoted"));
        lifecycle.insert("repeatCount".to_string(), json!(repeat_count));
        lifecycle.insert(
            "confidence".to_string(),
            json!(lifecycle_confidence(repeat_count, "promoted")),
        );
        lifecycle.insert("lastValidatedAt".to_string(), json!(now));
        if let Some(memory_id) = memory_id.filter(|value| !value.trim().is_empty()) {
            lifecycle.insert("promotedMemoryId".to_string(), json!(memory_id));
        }
    }
    *metadata = Some(Value::Object(object));
}

fn build_memory_promotion_request(
    lifecycle_context: Option<&WorkspaceLifecycleContext>,
    content: &str,
    session_id: Option<&str>,
    claim_id: &str,
    suggestion_metadata: Option<&serde_json::Map<String, Value>>,
    suggestion_id: Option<&str>,
    repeat_count: i64,
    now: &str,
) -> CreateLocalMemoryRequest {
    let mut tags = vec!["llm-wiki".to_string(), "stable-conclusion".to_string()];
    if let Some(context) = lifecycle_context {
        tags.push(format!("workspace:{}", context.workspace_id));
    }

    CreateLocalMemoryRequest {
        content: content.to_string(),
        session_id: session_id.map(str::to_string),
        capability_id: Some("llm_wiki".to_string()),
        meta_info: Some(json!({
            "source": "llm_wiki_automation",
            "fingerprint": claim_id,
            "suggestionId": suggestion_id,
            "lifecycle": Value::Object(merge_lifecycle_object(
                suggestion_metadata
                    .and_then(|value| value.get("lifecycle"))
                    .and_then(Value::as_object),
                Some(&build_lifecycle_metadata_object(
                    lifecycle_context,
                    claim_id,
                    session_id,
                    "valuable_answer",
                    now,
                    repeat_count,
                    "promoted",
                )),
                repeat_count,
                now,
            )),
        })),
        category: Some("llm_wiki".to_string()),
        source: Some(
            lifecycle_context
                .map(|value| value.memory_source_scope.clone())
                .unwrap_or_else(|| "llm_wiki_automation".to_string()),
        ),
        tags: Some(tags),
    }
}

fn ensure_object_field<'a>(
    object: &'a mut serde_json::Map<String, Value>,
    key: &str,
) -> Option<&'a mut serde_json::Map<String, Value>> {
    if !object.get(key).map(Value::is_object).unwrap_or(false) {
        object.insert(key.to_string(), Value::Object(serde_json::Map::new()));
    }
    object.get_mut(key).and_then(Value::as_object_mut)
}

fn push_audit(
    state: &mut LocalLlmWikiAutomationState,
    trigger: &str,
    level: &str,
    disposition: &str,
    message: impl Into<String>,
    now: &str,
    metadata: Option<Value>,
) {
    state.audit.insert(
        0,
        LocalLlmWikiAutomationAuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            trigger: trigger.to_string(),
            level: level.to_string(),
            disposition: disposition.to_string(),
            message: message.into(),
            created_at: now.to_string(),
            metadata,
        },
    );
    if state.audit.len() > MAX_AUDIT_ENTRIES {
        state.audit.truncate(MAX_AUDIT_ENTRIES);
    }
}

fn suggestion_fingerprint(prefix: &str, seed: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prefix.as_bytes());
    hasher.update(b"::");
    hasher.update(seed.trim().to_ascii_lowercase().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn trim_preview_text(value: &str, limit: usize) -> String {
    let single_line = value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if single_line.len() <= limit {
        single_line
    } else {
        format!("{}...", &single_line[..limit])
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_lifecycle_metadata, looks_like_summary_candidate, looks_like_valuable_answer,
        merge_metadata, record_valuable_answer_candidate, should_promote_repeated_conclusion,
        suggestion_fingerprint, trim_preview_text, LocalLlmWikiAutomationState,
        WorkspaceLifecycleContext,
    };
    use serde_json::{json, Value};

    #[test]
    fn record_valuable_answer_candidate_reuses_existing_suggestion_and_bumps_repeat_count() {
        let mut state = LocalLlmWikiAutomationState::default();
        let context = WorkspaceLifecycleContext {
            workspace_id: "workspace-1".into(),
            workspace_relative_path: "Deeting Wiki".into(),
            memory_source_scope: "llm_wiki_automation::workspace-1".into(),
        };
        let first = record_valuable_answer_candidate(
            &mut state,
            Some(&context),
            "session-1",
            "Durable summary content for the workspace",
            "2026-04-14T00:00:00Z",
        );
        let second = record_valuable_answer_candidate(
            &mut state,
            Some(&context),
            "session-1",
            "Durable summary content for the workspace",
            "2026-04-14T00:01:00Z",
        );

        assert_eq!(first, 1);
        assert_eq!(second, 2);
        assert_eq!(state.suggestions.len(), 1);
        let repeat_count = state.suggestions[0]
            .metadata
            .as_ref()
            .and_then(|value| value.get("repeatCount"))
            .and_then(|value| value.as_i64());
        assert_eq!(repeat_count, Some(2));
        let lifecycle_repeat_count = state.suggestions[0]
            .metadata
            .as_ref()
            .and_then(|value| value.get("lifecycle"))
            .and_then(|value| value.get("repeatCount"))
            .and_then(|value| value.as_i64());
        assert_eq!(lifecycle_repeat_count, Some(2));
    }

    #[test]
    fn merge_metadata_refreshes_nested_lifecycle_confidence() {
        let context = WorkspaceLifecycleContext {
            workspace_id: "workspace-1".into(),
            workspace_relative_path: "Deeting Wiki".into(),
            memory_source_scope: "llm_wiki_automation::workspace-1".into(),
        };
        let merged = merge_metadata(
            None,
            Some(&json!({
                "lifecycle": build_lifecycle_metadata(
                    Some(&context),
                    "claim-1",
                    Some("session-1"),
                    "valuable_answer",
                    "2026-04-14T00:00:00Z",
                    1,
                    "candidate",
                )
            })),
            3,
            "2026-04-14T01:00:00Z",
        );
        assert_eq!(
            merged
                .get("lifecycle")
                .and_then(|value| value.get("repeatCount"))
                .and_then(|value| value.as_i64()),
            Some(3)
        );
        assert_eq!(
            merged
                .get("lifecycle")
                .and_then(|value| value.get("workspaceId"))
                .and_then(|value| value.as_str()),
            Some("workspace-1")
        );
    }

    #[test]
    fn merge_metadata_preserves_distinct_session_source_refs() {
        let context = WorkspaceLifecycleContext {
            workspace_id: "workspace-1".into(),
            workspace_relative_path: "Deeting Wiki".into(),
            memory_source_scope: "llm_wiki_automation::workspace-1".into(),
        };
        let existing = json!({
            "sessionId": "session-1",
            "lifecycle": build_lifecycle_metadata(
                Some(&context),
                "claim-1",
                Some("session-1"),
                "valuable_answer",
                "2026-04-14T00:00:00Z",
                1,
                "candidate",
            )
        });
        let incoming = json!({
            "sessionId": "session-2",
            "lifecycle": build_lifecycle_metadata(
                Some(&context),
                "claim-1",
                Some("session-2"),
                "valuable_answer",
                "2026-04-14T01:00:00Z",
                1,
                "candidate",
            )
        });

        let merged = merge_metadata(Some(&existing), Some(&incoming), 2, "2026-04-14T01:00:00Z");

        assert_eq!(
            merged
                .get("lifecycle")
                .and_then(|value| value.get("distinctSessionCount"))
                .and_then(Value::as_i64),
            Some(2)
        );
        assert_eq!(
            merged
                .get("lifecycle")
                .and_then(|value| value.get("sourceRefs"))
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(3)
        );
    }

    #[test]
    fn promotion_gate_requires_cross_session_support_at_repeat_two() {
        let metadata = json!({
            "lifecycle": {
                "repeatCount": 2,
                "confidence": 0.76,
                "distinctSessionCount": 2,
                "manualOverride": false,
                "pinned": false
            }
        });
        let single_session = json!({
            "lifecycle": {
                "repeatCount": 2,
                "confidence": 0.76,
                "distinctSessionCount": 1,
                "manualOverride": false,
                "pinned": false
            }
        });

        assert!(should_promote_repeated_conclusion(metadata.as_object(), 2));
        assert!(!should_promote_repeated_conclusion(
            single_session.as_object(),
            2
        ));
        assert!(should_promote_repeated_conclusion(None, 3));
    }

    #[test]
    fn looks_like_valuable_answer_accepts_successful_execution_tree() {
        let meta = json!({
            "execution_tree": {
                "terminal_status": "succeeded"
            }
        });
        assert!(looks_like_valuable_answer(
            "short but successful",
            Some(&meta)
        ));
    }

    #[test]
    fn looks_like_summary_candidate_requires_meaningful_density() {
        assert!(looks_like_summary_candidate(
            "Line one\nLine two\nLine three\nLine four\nLine five with enough detail."
        ));
        assert!(!looks_like_summary_candidate("tiny summary"));
    }

    #[test]
    fn trim_preview_text_compacts_lines() {
        let value = trim_preview_text("A\n\nB\nC", 20);
        assert_eq!(value, "A B C");
    }

    #[test]
    fn suggestion_fingerprint_is_case_insensitive() {
        assert_eq!(
            suggestion_fingerprint("trigger", "Hello"),
            suggestion_fingerprint("trigger", " hello ")
        );
    }
}
