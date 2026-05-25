use super::delegated_session_resume::resume_delegated_runtime_with_session;
use super::delegated_workflow_session::build_workflow_delegated_execution_session_for_resume;
use super::persistable_inflight_context_from_value;
use crate::modules::desktop_runtime::runtime::execution_plane::DelegatedExecutionSession;
use crate::modules::desktop_runtime::runtime::list_execution_graph_runtime_contexts;
use crate::state::AppState;
use tauri::AppHandle;

pub(crate) async fn resume_delegated_runtime_after_workflow_event(
    app: &AppHandle,
    app_state: &AppState,
    execution_graph_execution_id: &str,
    workflow_run_id: &str,
    event_id: &str,
    task_input_source: Option<serde_json::Value>,
) -> Result<Option<serde_json::Value>, String> {
    let detail =
        crate::modules::workflow::service::get_workflow_run_status(app_state, workflow_run_id)
            .await?;
    let delegated_execution = build_workflow_delegated_execution_session_for_resume(
        execution_graph_execution_id.trim().to_string(),
        detail,
        task_input_source,
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
            context.task_input_source.clone(),
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
