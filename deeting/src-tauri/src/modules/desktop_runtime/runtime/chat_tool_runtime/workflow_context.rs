use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::modules::workflow::service;
use crate::modules::workflow::store;
use crate::modules::workflow::types::{WorkflowRun, WorkflowRunDetail, WorkflowRunStatus};
use crate::state::AppState;

pub(super) const WORKFLOW_PLAN_PEEK_TOOL_NAME: &str = "workflow_plan_peek";
pub(super) const WORKFLOW_PLAN_READ_TOOL_NAME: &str = "workflow_plan_read";
pub(super) const WORKFLOW_PLAN_UPDATE_TOOL_NAME: &str = "workflow_plan_update";
pub(super) const WORKFLOW_PLAN_COMPILE_TOOL_NAME: &str = "workflow_plan_compile";

pub(super) fn is_workflow_plan_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        WORKFLOW_PLAN_PEEK_TOOL_NAME
            | WORKFLOW_PLAN_READ_TOOL_NAME
            | WORKFLOW_PLAN_UPDATE_TOOL_NAME
            | WORKFLOW_PLAN_COMPILE_TOOL_NAME
    )
}

pub(super) async fn execute_workflow_plan_tool(
    app: &AppHandle,
    app_state: &AppState,
    workflow_context: Option<&Value>,
    tool_name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    match tool_name {
        WORKFLOW_PLAN_PEEK_TOOL_NAME => peek(app_state, workflow_context, arguments).await,
        WORKFLOW_PLAN_READ_TOOL_NAME => read(app_state, workflow_context, arguments).await,
        WORKFLOW_PLAN_UPDATE_TOOL_NAME => update(app, app_state, workflow_context, arguments).await,
        WORKFLOW_PLAN_COMPILE_TOOL_NAME => {
            compile(app, app_state, workflow_context, arguments).await
        }
        _ => Err(format!("unsupported workflow plan tool '{tool_name}'")),
    }
}

async fn peek(
    app_state: &AppState,
    workflow_context: Option<&Value>,
    arguments: &Value,
) -> Result<Value, String> {
    let store_ref = app_state.mcp.store.as_ref();
    if let Some(run_id) = resolve_run_id(workflow_context, arguments) {
        let detail = get_detail(app_state, &run_id).await?;
        return Ok(json!({
            "available": true,
            "current_run": summarize_detail(&detail),
        }));
    }

    let runs = store::list_workflow_runs(store_ref)
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .take(8)
        .map(|run| summarize_run(&run))
        .collect::<Vec<_>>();

    Ok(json!({
        "available": !runs.is_empty(),
        "current_run": Value::Null,
        "recent_runs": runs,
        "reason": if runs.is_empty() {
            Some("No workflow run is currently attached to this chat request.")
        } else {
            None
        },
    }))
}

async fn read(
    app_state: &AppState,
    workflow_context: Option<&Value>,
    arguments: &Value,
) -> Result<Value, String> {
    let run_id = require_run_id(workflow_context, arguments)?;
    let detail = get_detail(app_state, &run_id).await?;
    let target = arguments
        .get("target")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("all");

    let mut result = json!({
        "available": true,
        "run": summarize_run(&detail.run),
        "target": target,
    });
    let object = result.as_object_mut().expect("workflow read result object");

    match target {
        "proposal" => {
            object.insert(
                "proposal_text".to_string(),
                json!(detail.run.proposal_text.as_deref().unwrap_or("")),
            );
        }
        "snapshot" => {
            object.insert(
                "snapshot_json".to_string(),
                detail.run.snapshot_json.clone().unwrap_or(Value::Null),
            );
        }
        "steps" => {
            object.insert("steps".to_string(), json!(detail.steps));
        }
        "events" => {
            object.insert("events".to_string(), json!(detail.events));
        }
        "all" => {
            object.insert(
                "proposal_text".to_string(),
                json!(detail.run.proposal_text.as_deref().unwrap_or("")),
            );
            object.insert(
                "snapshot_json".to_string(),
                detail.run.snapshot_json.clone().unwrap_or(Value::Null),
            );
            object.insert("steps".to_string(), json!(detail.steps));
            object.insert("events".to_string(), json!(detail.events));
        }
        other => return Err(format!("unsupported workflow_plan_read target '{other}'")),
    }

    Ok(result)
}

async fn update(
    app: &AppHandle,
    app_state: &AppState,
    workflow_context: Option<&Value>,
    arguments: &Value,
) -> Result<Value, String> {
    let run_id = require_run_id(workflow_context, arguments)?;
    let proposal_text = arguments
        .get("proposal_text")
        .or_else(|| arguments.get("proposalText"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "workflow_plan_update requires non-empty proposal_text".to_string())?
        .to_string();

    let current = store::get_workflow_run(app_state.mcp.store.as_ref(), &run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("workflow run '{run_id}' was not found"))?;
    if matches!(
        current.status,
        WorkflowRunStatus::Running | WorkflowRunStatus::WaitingApproval
    ) {
        return Err(
            "workflow_plan_update only edits plan drafts; pause or finish the running workflow before changing its proposal"
                .to_string(),
        );
    }

    let run = service::update_existing_proposal(
        app_state.mcp.store.as_ref(),
        &run_id,
        app.path().app_data_dir().ok(),
        proposal_text,
    )
    .await?;
    emit_workflow_run_updated(app, &run, "workflow_plan_update");

    Ok(json!({
        "ok": true,
        "run": summarize_run(&run),
        "proposal_version": run.proposal_version,
        "status": run.status.as_str(),
        "compiled": false,
    }))
}

async fn compile(
    app: &AppHandle,
    app_state: &AppState,
    workflow_context: Option<&Value>,
    arguments: &Value,
) -> Result<Value, String> {
    let run_id = require_run_id(workflow_context, arguments)?;
    let result = service::compile_current_proposal(
        app_state.mcp.store.as_ref(),
        app.path().app_data_dir().ok(),
        &run_id,
    )
    .await?;
    let detail = get_detail(app_state, &run_id).await?;
    emit_workflow_run_updated(app, &detail.run, "workflow_plan_compile");

    Ok(json!({
        "ok": result.errors.is_empty(),
        "run": summarize_run(&detail.run),
        "compile_result": result,
    }))
}

async fn get_detail(app_state: &AppState, run_id: &str) -> Result<WorkflowRunDetail, String> {
    service::get_workflow_run_status(app_state, run_id).await
}

fn require_run_id(workflow_context: Option<&Value>, arguments: &Value) -> Result<String, String> {
    resolve_run_id(workflow_context, arguments).ok_or_else(|| {
        "workflow run id is required; call workflow_plan_peek first if no plan is attached"
            .to_string()
    })
}

fn resolve_run_id(workflow_context: Option<&Value>, arguments: &Value) -> Option<String> {
    argument_run_id(arguments).or_else(|| context_run_id(workflow_context?))
}

fn argument_run_id(arguments: &Value) -> Option<String> {
    arguments
        .get("run_id")
        .or_else(|| arguments.get("runId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn context_run_id(context: &Value) -> Option<String> {
    context
        .get("run_id")
        .or_else(|| context.get("runId"))
        .or_else(|| context.get("current_run_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn summarize_detail(detail: &WorkflowRunDetail) -> Value {
    let mut summary = summarize_run(&detail.run);
    if let Some(object) = summary.as_object_mut() {
        object.insert("steps".to_string(), json!(detail.steps));
        object.insert("events_count".to_string(), json!(detail.events.len()));
    }
    summary
}

fn summarize_run(run: &WorkflowRun) -> Value {
    let phases = run
        .snapshot_json
        .as_ref()
        .and_then(|snapshot| snapshot.get("phases"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|phase| {
                    json!({
                        "phase_id": phase.get("phase_id").and_then(Value::as_str),
                        "title": phase.get("title").and_then(Value::as_str),
                        "worker_ref": phase.get("worker_ref").and_then(Value::as_str),
                        "goal": phase.get("goal").and_then(Value::as_str),
                        "depends_on": phase.get("depends_on").cloned().unwrap_or_else(|| json!([])),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    json!({
        "run_id": run.id,
        "title": run.title,
        "goal": run.goal,
        "status": run.status.as_str(),
        "proposal_version": run.proposal_version,
        "snapshot_version": run.snapshot_version,
        "has_proposal": run.proposal_text.as_deref().is_some_and(|value| !value.trim().is_empty()),
        "has_snapshot": run.snapshot_json.is_some(),
        "phase_count": phases.len(),
        "phases": phases,
        "updated_at": run.updated_at,
    })
}

fn emit_workflow_run_updated(app: &AppHandle, run: &WorkflowRun, source: &str) {
    let _ = app.emit(
        "workflow:run-updated",
        json!({
            "run_id": run.id,
            "status": run.status.as_str(),
            "proposal_version": run.proposal_version,
            "snapshot_version": run.snapshot_version,
            "source": source,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_run_id_prefers_explicit_argument() {
        let context = json!({"run_id": "context-run"});
        let args = json!({"run_id": "arg-run"});

        assert_eq!(
            resolve_run_id(Some(&context), &args),
            Some("arg-run".to_string())
        );
    }

    #[test]
    fn resolve_run_id_falls_back_to_context() {
        let context = json!({"run_id": "context-run"});

        assert_eq!(
            resolve_run_id(Some(&context), &json!({})),
            Some("context-run".to_string())
        );
    }
}
