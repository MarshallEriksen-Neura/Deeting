use std::path::PathBuf;

use crate::modules::mcp::store::McpStore;
use crate::modules::workflow::compiler;
use crate::modules::workflow::proposal;
use crate::modules::workflow::run_dir;
use crate::modules::workflow::store;
use crate::modules::workflow::types::{
    ApprovalAction, ApproveWorkflowRequest, CompileResult, CreateWorkflowEventRequest,
    CreateWorkflowRunRequest, EditRemainingPhasesRequest, ExecutionSnapshot,
    GenerateProposalRequest, QuickWorkflowRequest, QuickWorkflowResult, RegenerateProposalRequest,
    RerunPhaseRequest, UpdateProposalRequest, WorkflowPhaseContext, WorkflowRun,
    WorkflowRunDetail, WorkflowRunStatus, WorkflowStepStatus,
};
use crate::state::AppState;
use tauri::Manager;

pub(crate) async fn persist_generated_proposal(
    store: &McpStore,
    app_data_dir: Option<PathBuf>,
    title: String,
    goal: String,
    proposal_text: String,
    regenerated: bool,
) -> Result<WorkflowRun, String> {
    let mut run = store::create_workflow_run(
        store,
        CreateWorkflowRunRequest {
            title,
            goal,
            proposal_text: None,
        },
    )
    .await
    .map_err(|err| err.to_string())?;

    let run_dir = run_dir::ensure_run_dir(app_data_dir.clone(), &run.id)?;
    let run_dir_string = run_dir.to_string_lossy().to_string();
    run_dir::write_proposal_file(&run_dir, &proposal_text)?;

    if let Err(error) = async {
        store::update_workflow_run_run_dir(store, &run.id, &run_dir_string)
            .await
            .map_err(|err| err.to_string())?;

        store::update_workflow_run_proposal(store, &run.id, &proposal_text, 1)
            .await
            .map_err(|err| err.to_string())?;

        store::invalidate_workflow_run_compiled_state(store, &run.id, WorkflowRunStatus::Draft)
            .await
            .map_err(|err| err.to_string())?;

        store::create_workflow_event(
            store,
            CreateWorkflowEventRequest {
                run_id: run.id.clone(),
                step_id: None,
                event_type: "run.plan_proposed".to_string(),
                payload: Some(serde_json::json!({
                    "proposal_version": 1,
                    "regenerated": regenerated,
                })),
            },
        )
        .await
        .map_err(|err| err.to_string())?;
        Ok::<(), String>(())
    }
    .await
    {
        let _ = std::fs::remove_file(run_dir.join("proposal.md"));
        let _ = store::delete_workflow_run(store, &run.id).await;
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error);
    }

    run.run_dir = Some(run_dir_string);
    run.proposal_text = Some(proposal_text);
    run.proposal_version = 1;
    Ok(run)
}

pub(crate) async fn update_existing_proposal(
    store: &McpStore,
    run_id: &str,
    app_data_dir: Option<PathBuf>,
    proposal_text: String,
) -> Result<WorkflowRun, String> {
    let run = store::get_workflow_run(store, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "workflow run not found".to_string())?;

    let new_version = run.proposal_version + 1;
    let run_dir_path = if let Some(dir) = run.run_dir.as_deref() {
        PathBuf::from(dir)
    } else {
        let ensured = run_dir::ensure_run_dir(app_data_dir, run_id)?;
        let ensured_string = ensured.to_string_lossy().to_string();
        store::update_workflow_run_run_dir(store, run_id, &ensured_string)
            .await
            .map_err(|err| err.to_string())?;
        ensured
    };

    let previous_proposal = run.proposal_text.clone();
    run_dir::write_proposal_file(&run_dir_path, &proposal_text)?;

    if let Err(error) = async {
        store::update_workflow_run_proposal(store, run_id, &proposal_text, new_version)
            .await
            .map_err(|err| err.to_string())?;

        store::invalidate_workflow_run_compiled_state(store, run_id, WorkflowRunStatus::Draft)
            .await
            .map_err(|err| err.to_string())?;

        store::create_workflow_event(
            store,
            CreateWorkflowEventRequest {
                run_id: run_id.to_string(),
                step_id: None,
                event_type: "run.plan_edited".to_string(),
                payload: Some(serde_json::json!({ "proposal_version": new_version })),
            },
        )
        .await
        .map_err(|err| err.to_string())?;

        Ok::<(), String>(())
    }
    .await
    {
        match previous_proposal.as_deref() {
            Some(previous) => {
                let _ = run_dir::write_proposal_file(&run_dir_path, previous);
            }
            None => {
                let _ = std::fs::remove_file(run_dir_path.join("proposal.md"));
            }
        }
        return Err(error);
    }

    store::get_workflow_run(store, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "workflow run not found after proposal update".to_string())
}

pub(crate) async fn regenerate_existing_proposal(
    store: &McpStore,
    run_id: &str,
    app_data_dir: Option<PathBuf>,
    proposal_text: String,
) -> Result<WorkflowRun, String> {
    let run = store::get_workflow_run(store, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "workflow run not found".to_string())?;

    let new_version = run.proposal_version + 1;
    let run_dir_path = if let Some(dir) = run.run_dir.as_deref() {
        PathBuf::from(dir)
    } else {
        let ensured = run_dir::ensure_run_dir(app_data_dir, run_id)?;
        let ensured_string = ensured.to_string_lossy().to_string();
        store::update_workflow_run_run_dir(store, run_id, &ensured_string)
            .await
            .map_err(|err| err.to_string())?;
        ensured
    };

    let previous_proposal = run.proposal_text.clone();
    run_dir::write_proposal_file(&run_dir_path, &proposal_text)?;

    if let Err(error) = async {
        store::update_workflow_run_proposal(store, run_id, &proposal_text, new_version)
            .await
            .map_err(|err| err.to_string())?;

        store::invalidate_workflow_run_compiled_state(store, run_id, WorkflowRunStatus::Draft)
            .await
            .map_err(|err| err.to_string())?;

        store::create_workflow_event(
            store,
            CreateWorkflowEventRequest {
                run_id: run_id.to_string(),
                step_id: None,
                event_type: "run.plan_proposed".to_string(),
                payload: Some(serde_json::json!({
                    "proposal_version": new_version,
                    "regenerated": true,
                })),
            },
        )
        .await
        .map_err(|err| err.to_string())?;

        Ok::<(), String>(())
    }
    .await
    {
        match previous_proposal.as_deref() {
            Some(previous) => {
                let _ = run_dir::write_proposal_file(&run_dir_path, previous);
            }
            None => {
                let _ = std::fs::remove_file(run_dir_path.join("proposal.md"));
            }
        }
        return Err(error);
    }

    store::get_workflow_run(store, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "workflow run not found after proposal regeneration".to_string())
}

pub(crate) async fn compile_current_proposal(
    store: &McpStore,
    app_data_dir: Option<PathBuf>,
    run_id: &str,
) -> Result<CompileResult, String> {
    let run = store::get_workflow_run(store, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "workflow run not found".to_string())?;

    let proposal_text = run
        .proposal_text
        .clone()
        .ok_or_else(|| "no proposal text to compile".to_string())?;

    let parsed = match compiler::parse_proposal(&proposal_text) {
        Ok(parsed) => parsed,
        Err(errors) => {
            store::invalidate_workflow_run_compiled_state(
                store,
                run_id,
                WorkflowRunStatus::AwaitingPlanEdit,
            )
            .await
            .map_err(|err| err.to_string())?;
            return Ok(CompileResult {
                snapshot: None,
                errors,
            });
        }
    };

    let available_worker_refs = compiler::collect_available_worker_refs(store).await?;
    let snapshot_version = run.snapshot_version + 1;
    let result = compiler::compile_proposal(
        run_id,
        &parsed,
        run.proposal_version,
        snapshot_version,
        &available_worker_refs,
    );

    let Some(snapshot) = result.snapshot.as_ref() else {
        store::invalidate_workflow_run_compiled_state(
            store,
            run_id,
            WorkflowRunStatus::AwaitingPlanEdit,
        )
        .await
        .map_err(|err| err.to_string())?;
        return Ok(result);
    };

    let run_dir_path = if let Some(dir) = run.run_dir.as_deref() {
        PathBuf::from(dir)
    } else {
        let ensured = run_dir::ensure_run_dir(app_data_dir, run_id)?;
        let ensured_string = ensured.to_string_lossy().to_string();
        store::update_workflow_run_run_dir(store, run_id, &ensured_string)
            .await
            .map_err(|err| err.to_string())?;
        ensured
    };

    let previous_snapshot_file = run_dir::read_snapshot_file(&run_dir_path)?;
    run_dir::write_snapshot_file(&run_dir_path, snapshot)?;

    if let Err(error) = async {
        let snapshot_value = serde_json::to_value(snapshot)
            .map_err(|err| format!("Failed to serialize snapshot: {err}"))?;
        store::update_workflow_run_snapshot(store, run_id, &snapshot_value, snapshot_version)
            .await
            .map_err(|err| err.to_string())?;
        store::update_workflow_run_status(store, run_id, WorkflowRunStatus::Ready)
            .await
            .map_err(|err| err.to_string())?;
        store::create_workflow_event(
            store,
            CreateWorkflowEventRequest {
                run_id: run_id.to_string(),
                step_id: None,
                event_type: "run.plan_compiled".to_string(),
                payload: Some(serde_json::json!({
                    "proposal_version": run.proposal_version,
                    "snapshot_version": snapshot_version,
                    "phase_count": snapshot.phases.len(),
                })),
            },
        )
        .await
        .map_err(|err| err.to_string())?;
        Ok::<(), String>(())
    }
    .await
    {
        match previous_snapshot_file.as_deref() {
            Some(previous) => {
                std::fs::write(run_dir_path.join("snapshot.json"), previous).map_err(
                    |restore_err| {
                        format!("{error}; failed to restore snapshot.json: {restore_err}")
                    },
                )?;
            }
            None => {
                let _ = std::fs::remove_file(run_dir_path.join("snapshot.json"));
            }
        }
        return Err(error);
    }

    Ok(result)
}

pub(crate) async fn generate_proposal_workflow(
    app_state: &AppState,
    store: &McpStore,
    app_data_dir: Option<PathBuf>,
    payload: GenerateProposalRequest,
) -> Result<WorkflowRun, String> {
    let title: String = payload.goal.chars().take(80).collect();
    let proposal_text =
        proposal::generate_proposal(app_state, &payload.goal, payload.hints.as_deref()).await?;
    persist_generated_proposal(
        store,
        app_data_dir,
        title,
        payload.goal,
        proposal_text,
        false,
    )
    .await
}

pub(crate) async fn regenerate_proposal_workflow(
    app_state: &AppState,
    store: &McpStore,
    app_data_dir: Option<PathBuf>,
    payload: RegenerateProposalRequest,
) -> Result<WorkflowRun, String> {
    let run = store::get_workflow_run(store, &payload.run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "workflow run not found".to_string())?;
    let proposal_text =
        proposal::generate_proposal(app_state, &run.goal, payload.feedback.as_deref()).await?;
    regenerate_existing_proposal(store, &payload.run_id, app_data_dir, proposal_text).await
}

pub(crate) async fn update_proposal_workflow(
    store: &McpStore,
    app_data_dir: Option<PathBuf>,
    payload: UpdateProposalRequest,
) -> Result<WorkflowRun, String> {
    update_existing_proposal(store, &payload.run_id, app_data_dir, payload.proposal_text).await
}

fn build_quick_workflow_proposal_text(
    goal: &str,
    worker_ref: &str,
    inject_into_chat: bool,
) -> String {
    let goal = goal.trim();
    let worker_ref = worker_ref.trim();
    format!(
        "# Workflow Proposal\n\nTitle: Quick Worker Run\nGoal: {goal}\n\n## Global Constraints\n- Mode: quick_workflow_compatibility\n- Inject into chat: {inject_into_chat}\n\n## Phase 1: Execute\n- Worker: {worker_ref}\n- Goal: {goal}\n- Expected output: delegated_result\n- User Notes:\n",
        inject_into_chat = if inject_into_chat { "true" } else { "false" },
    )
}

fn format_compiler_errors(errors: &[crate::modules::workflow::types::CompilerError]) -> String {
    errors
        .iter()
        .map(|error| match error.phase_id.as_deref() {
            Some(phase_id) => format!("{phase_id}.{}: {}", error.field, error.message),
            None => format!("{}: {}", error.field, error.message),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn extract_primary_content(detail: &WorkflowRunDetail) -> Option<String> {
    let step = detail
        .steps
        .iter()
        .filter(|step| step.status == WorkflowStepStatus::Succeeded)
        .max_by_key(|step| {
            (
                step.phase_index,
                step.completed_at.as_deref().unwrap_or(""),
                step.created_at.as_str(),
            )
        })?;

    if let Some(run_dir_path) = detail.run.run_dir.as_deref().map(PathBuf::from) {
        let phase_dir = run_dir_path.join("phases").join(&step.phase_id);
        if let Ok(Some(content)) = run_dir::read_result_md(&phase_dir) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    step.worker_trace_summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) async fn quick_workflow_run(
    app_handle: &tauri::AppHandle,
    app_state: &AppState,
    req: QuickWorkflowRequest,
) -> Result<QuickWorkflowResult, String> {
    let goal = req.goal.trim();
    if goal.is_empty() {
        return Err("quick workflow goal is required".to_string());
    }

    let worker_ref = req
        .worker_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("direct_llm:default");
    let title = goal.chars().take(80).collect::<String>();
    let proposal_text = build_quick_workflow_proposal_text(goal, worker_ref, req.inject_into_chat);
    let app_data_dir = app_handle.path().app_data_dir().ok();
    let run = persist_generated_proposal(
        app_state.mcp.store.as_ref(),
        app_data_dir.clone(),
        title,
        goal.to_string(),
        proposal_text,
        false,
    )
    .await?;

    let compile_result =
        compile_current_proposal(app_state.mcp.store.as_ref(), app_data_dir, &run.id).await?;
    if !compile_result.errors.is_empty() {
        return Err(format!(
            "Quick workflow compile failed: {}",
            format_compiler_errors(&compile_result.errors)
        ));
    }
    if compile_result.snapshot.is_none() {
        return Err("Quick workflow compile produced no executable snapshot".to_string());
    }

    let run = start_workflow_run(app_handle, app_state, &run.id).await?;
    let detail = get_workflow_run_status(app_state, &run.id).await?;
    let content = extract_primary_content(&detail);
    let succeeded = detail.run.status == WorkflowRunStatus::Completed;

    Ok(QuickWorkflowResult {
        run: detail.run,
        steps: detail.steps,
        content,
        succeeded,
    })
}

pub(crate) async fn start_workflow_run(
    app_handle: &tauri::AppHandle,
    app_state: &AppState,
    run_id: &str,
) -> Result<WorkflowRun, String> {
    let store_ref = app_state.mcp.store.as_ref();
    claim_run_for_start(store_ref, run_id).await?;

    let _final_status =
        crate::modules::workflow::scheduler::run_workflow(app_handle, app_state, run_id).await?;

    store::get_workflow_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "Run disappeared after execution".to_string())
}

pub(crate) async fn get_workflow_run_status(
    app_state: &AppState,
    run_id: &str,
) -> Result<crate::modules::workflow::types::WorkflowRunDetail, String> {
    let store_ref = app_state.mcp.store.as_ref();
    get_workflow_run_status_with_store(store_ref, run_id).await
}

pub(crate) async fn get_workflow_phase_context(
    app_handle: &tauri::AppHandle,
    app_state: &AppState,
    run_id: &str,
    phase_id: &str,
) -> Result<WorkflowPhaseContext, String> {
    let detail = get_workflow_run_status(app_state, run_id).await?;
    let step = detail
        .steps
        .iter()
        .find(|step| step.phase_id == phase_id)
        .ok_or_else(|| format!("Phase not found in workflow run: {phase_id}"))?;
    let run_dir = detail
        .run
        .run_dir
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| run_dir::resolve_run_dir(app_handle.path().app_data_dir().ok(), run_id));
    let phase_dir = run_dir.join("phases").join(phase_id.trim());
    let context_md = run_dir::read_context_md(&phase_dir)?;
    let context_json = run_dir::read_context_json(&phase_dir)?;

    Ok(WorkflowPhaseContext {
        run_id: run_id.to_string(),
        phase_id: phase_id.to_string(),
        phase_title: step.title.clone(),
        context_md,
        context_json,
    })
}

pub(crate) async fn approve_workflow(
    app_handle: &tauri::AppHandle,
    app_state: &AppState,
    req: ApproveWorkflowRequest,
) -> Result<WorkflowRun, String> {
    let store_ref = app_state.mcp.store.as_ref();
    let run_id = req.run_id.trim();
    let run = load_run(store_ref, run_id).await?;
    if run.status != WorkflowRunStatus::WaitingApproval {
        return Err(format!(
            "Run must be in 'waiting_approval' status, currently: {}",
            run.status
        ));
    }

    let checkpoint = store::get_active_checkpoint_for_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No active checkpoint found for this run".to_string())?;

    let next_status = apply_approval_action(
        store_ref,
        &run,
        &checkpoint,
        &req.action,
        req.updated_proposal.as_deref(),
    )
    .await?;

    if next_status == WorkflowRunStatus::Ready && matches!(req.action, ApprovalAction::Approve) {
        return resume_workflow(app_handle, app_state, run_id).await;
    }

    reload_run(store_ref, run_id).await
}

pub(crate) async fn edit_remaining_phases(
    app_state: &AppState,
    req: EditRemainingPhasesRequest,
) -> Result<WorkflowRun, String> {
    let store_ref = app_state.mcp.store.as_ref();
    edit_remaining_phases_with_store(store_ref, req).await
}

async fn edit_remaining_phases_with_store(
    store_ref: &McpStore,
    req: EditRemainingPhasesRequest,
) -> Result<WorkflowRun, String> {
    let run_id = req.run_id.trim();
    let run = load_run(store_ref, run_id).await?;
    if run.status != WorkflowRunStatus::AwaitingPlanEdit {
        return Err(format!(
            "Run must be in 'awaiting_plan_edit' status, currently: {}",
            run.status
        ));
    }

    persist_paused_proposal_edit(store_ref, run_id, &run, &req.updated_proposal).await?;
    reload_run(store_ref, run_id).await
}

pub(crate) async fn resume_workflow(
    app_handle: &tauri::AppHandle,
    app_state: &AppState,
    run_id: &str,
) -> Result<WorkflowRun, String> {
    let store_ref = app_state.mcp.store.as_ref();
    claim_run_for_resume(store_ref, run_id).await?;
    emit_event(store_ref, run_id, None, "run.resumed", None).await;
    let _final_status =
        crate::modules::workflow::scheduler::run_workflow(app_handle, app_state, run_id).await?;
    reload_run(store_ref, run_id).await
}

pub(crate) async fn rerun_phase(
    app_state: &AppState,
    req: RerunPhaseRequest,
) -> Result<WorkflowRun, String> {
    let store_ref = app_state.mcp.store.as_ref();
    rerun_phase_with_store(store_ref, req).await
}

async fn rerun_phase_with_store(
    store_ref: &McpStore,
    req: RerunPhaseRequest,
) -> Result<WorkflowRun, String> {
    let run_id = req.run_id.trim();
    let phase_id = req.phase_id.trim();
    let run = load_run(store_ref, run_id).await?;

    if run.status != WorkflowRunStatus::Failed && run.status != WorkflowRunStatus::AwaitingPlanEdit
    {
        return Err(format!(
            "Run must be in 'failed' or 'awaiting_plan_edit' status, currently: {}",
            run.status
        ));
    }

    let mut snapshot = parse_snapshot(&run)?;
    let phase = snapshot
        .phases
        .iter_mut()
        .find(|phase| phase.phase_id == phase_id)
        .ok_or_else(|| format!("Phase '{}' not found in snapshot", phase_id))?;

    if let Some(updated_goal) = req
        .updated_goal
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        phase.goal = updated_goal.to_string();
        if let Some(proposal_text) = run.proposal_text.as_deref() {
            let updated_proposal =
                update_phase_goal_in_proposal_text(proposal_text, phase_id, updated_goal)?;
            persist_paused_proposal_edit(store_ref, run_id, &run, &updated_proposal).await?;
        }
    }

    let snapshot_version = run.snapshot_version + 1;
    let snapshot_value = serde_json::to_value(&snapshot)
        .map_err(|err| format!("Failed to serialize snapshot: {err}"))?;
    store::update_workflow_run_snapshot(store_ref, run_id, &snapshot_value, snapshot_version)
        .await
        .map_err(|err| err.to_string())?;
    store::update_workflow_run_status(store_ref, run_id, WorkflowRunStatus::Ready)
        .await
        .map_err(|err| err.to_string())?;
    emit_event(
        store_ref,
        run_id,
        Some(phase_id),
        "step.rerun.queued",
        Some(match req.updated_goal {
            Some(updated_goal) => serde_json::json!({
                "phase_id": phase_id,
                "updated_goal": updated_goal,
            }),
            None => serde_json::json!({ "phase_id": phase_id }),
        }),
    )
    .await;

    reload_run(store_ref, run_id).await
}

async fn ensure_run_startable(store_ref: &McpStore, run_id: &str) -> Result<WorkflowRun, String> {
    let run = store::get_workflow_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("Run not found: {run_id}"))?;

    if run.status != WorkflowRunStatus::Ready {
        return Err(format!(
            "Run must be in 'ready' status to start, currently: {}",
            run.status
        ));
    }
    if run.snapshot_json.is_none() {
        return Err("Run has no compiled snapshot. Compile the proposal first.".to_string());
    }
    Ok(run)
}

async fn claim_run_for_start(store_ref: &McpStore, run_id: &str) -> Result<(), String> {
    let run = ensure_run_startable(store_ref, run_id).await?;
    let claimed = store::transition_workflow_run_status_if_current(
        store_ref,
        run_id,
        WorkflowRunStatus::Ready,
        WorkflowRunStatus::Running,
    )
    .await
    .map_err(|err| err.to_string())?;

    if claimed {
        Ok(())
    } else {
        Err(format!(
            "Run is no longer startable because its status changed from '{}'",
            run.status
        ))
    }
}

async fn get_workflow_run_status_with_store(
    store_ref: &McpStore,
    run_id: &str,
) -> Result<crate::modules::workflow::types::WorkflowRunDetail, String> {
    let run = store::get_workflow_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("Run not found: {run_id}"))?;
    let steps = store::list_workflow_step_runs_by_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?;
    let events = store::list_workflow_events_by_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(crate::modules::workflow::types::WorkflowRunDetail { run, steps, events })
}

async fn load_run(store_ref: &McpStore, run_id: &str) -> Result<WorkflowRun, String> {
    store::get_workflow_run(store_ref, run_id)
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("Workflow run not found: {run_id}"))
}

async fn reload_run(store_ref: &McpStore, run_id: &str) -> Result<WorkflowRun, String> {
    load_run(store_ref, run_id).await
}

async fn emit_event(
    store_ref: &McpStore,
    run_id: &str,
    step_id: Option<&str>,
    event_type: &str,
    payload: Option<serde_json::Value>,
) {
    let _ = store::create_workflow_event(
        store_ref,
        CreateWorkflowEventRequest {
            run_id: run_id.to_string(),
            step_id: step_id.map(|value| value.to_string()),
            event_type: event_type.to_string(),
            payload,
        },
    )
    .await;
}

async fn persist_paused_proposal_edit(
    store_ref: &McpStore,
    run_id: &str,
    run: &WorkflowRun,
    new_proposal: &str,
) -> Result<(), String> {
    let new_version = run.proposal_version + 1;
    let run_dir_path = run
        .run_dir
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "workflow run has no run_dir".to_string())?;

    let previous_proposal = run.proposal_text.clone();
    run_dir::write_proposal_file(&run_dir_path, new_proposal)?;

    if let Err(error) = async {
        store::update_workflow_run_proposal(store_ref, run_id, new_proposal, new_version)
            .await
            .map_err(|err| err.to_string())?;
        store::invalidate_workflow_run_compiled_state(
            store_ref,
            run_id,
            WorkflowRunStatus::AwaitingPlanEdit,
        )
        .await
        .map_err(|err| err.to_string())?;
        emit_event(
            store_ref,
            run_id,
            None,
            "run.plan_edited",
            Some(serde_json::json!({ "proposal_version": new_version })),
        )
        .await;
        Ok::<(), String>(())
    }
    .await
    {
        match previous_proposal.as_deref() {
            Some(previous) => {
                let _ = run_dir::write_proposal_file(&run_dir_path, previous);
            }
            None => {
                let _ = std::fs::remove_file(run_dir_path.join("proposal.md"));
            }
        }
        return Err(error);
    }

    Ok(())
}

async fn claim_run_for_resume(store_ref: &McpStore, run_id: &str) -> Result<(), String> {
    let run = load_run(store_ref, run_id).await?;
    if run.snapshot_json.is_none() {
        return Err("Run has no compiled snapshot. Compile the proposal first.".to_string());
    }
    match run.status {
        WorkflowRunStatus::Running => Ok(()),
        WorkflowRunStatus::Ready => {
            let claimed = store::transition_workflow_run_status_if_current(
                store_ref,
                run_id,
                WorkflowRunStatus::Ready,
                WorkflowRunStatus::Running,
            )
            .await
            .map_err(|err| err.to_string())?;
            if claimed {
                Ok(())
            } else {
                Err("Run is no longer resumable because its status changed".to_string())
            }
        }
        other => Err(format!(
            "Run must be in 'ready' or 'running' status to resume, currently: {}",
            other
        )),
    }
}

fn parse_snapshot(run: &WorkflowRun) -> Result<ExecutionSnapshot, String> {
    let snapshot = run
        .snapshot_json
        .clone()
        .ok_or_else(|| "Run has no compiled snapshot".to_string())?;
    serde_json::from_value(snapshot).map_err(|err| format!("Invalid snapshot JSON: {err}"))
}

fn update_phase_goal_in_proposal_text(
    proposal_text: &str,
    phase_id: &str,
    new_goal: &str,
) -> Result<String, String> {
    let mut lines = proposal_text
        .lines()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let phase_number = phase_id
        .strip_prefix("phase-")
        .ok_or_else(|| format!("Invalid phase id: {phase_id}"))?;
    let phase_prefix = format!("## Phase {phase_number}:");
    let mut in_target_phase = false;
    let mut updated = false;

    for line in &mut lines {
        let trimmed = line.trim();
        if trimmed.starts_with("## Phase ") {
            in_target_phase = trimmed.starts_with(&phase_prefix);
            continue;
        }
        if in_target_phase && trimmed.starts_with("- Goal:") {
            *line = format!("- Goal: {}", new_goal.trim());
            updated = true;
            break;
        }
    }

    if updated {
        Ok(lines.join("\n"))
    } else {
        Err(format!("Goal line not found for phase '{phase_id}'"))
    }
}

async fn apply_approval_action(
    store_ref: &McpStore,
    run: &WorkflowRun,
    checkpoint: &crate::modules::workflow::types::WorkflowCheckpoint,
    action: &ApprovalAction,
    updated_proposal: Option<&str>,
) -> Result<WorkflowRunStatus, String> {
    let run_id = run.id.as_str();
    match action {
        ApprovalAction::Approve => {
            store::resolve_checkpoint(store_ref, &checkpoint.id, None)
                .await
                .map_err(|err| err.to_string())?;
            if let Some(step_id) = checkpoint.blocked_step_id.as_deref() {
                store::update_workflow_step_status(
                    store_ref,
                    step_id,
                    WorkflowStepStatus::Succeeded,
                )
                .await
                .map_err(|err| err.to_string())?;
                emit_event(
                    store_ref,
                    run_id,
                    Some(step_id),
                    "step.succeeded",
                    Some(serde_json::json!({ "approval": "approved" })),
                )
                .await;
            }
            store::update_workflow_run_status(store_ref, run_id, WorkflowRunStatus::Ready)
                .await
                .map_err(|err| err.to_string())?;
            Ok(WorkflowRunStatus::Ready)
        }
        ApprovalAction::Reject => {
            store::resolve_checkpoint(
                store_ref,
                &checkpoint.id,
                Some(&serde_json::json!({ "action": "rejected" })),
            )
            .await
            .map_err(|err| err.to_string())?;
            if let Some(step_id) = checkpoint.blocked_step_id.as_deref() {
                store::update_workflow_step_status(
                    store_ref,
                    step_id,
                    WorkflowStepStatus::Cancelled,
                )
                .await
                .map_err(|err| err.to_string())?;
            }
            store::update_workflow_run_status(store_ref, run_id, WorkflowRunStatus::Cancelled)
                .await
                .map_err(|err| err.to_string())?;
            emit_event(
                store_ref,
                run_id,
                None,
                "run.cancelled",
                Some(serde_json::json!({ "reason": "user_rejected_approval" })),
            )
            .await;
            Ok(WorkflowRunStatus::Cancelled)
        }
        ApprovalAction::Modify => {
            store::resolve_checkpoint(
                store_ref,
                &checkpoint.id,
                Some(&serde_json::json!({ "action": "modify" })),
            )
            .await
            .map_err(|err| err.to_string())?;
            if let Some(step_id) = checkpoint.blocked_step_id.as_deref() {
                store::update_workflow_step_status(
                    store_ref,
                    step_id,
                    WorkflowStepStatus::Succeeded,
                )
                .await
                .map_err(|err| err.to_string())?;
            }
            store::update_workflow_run_status(
                store_ref,
                run_id,
                WorkflowRunStatus::AwaitingPlanEdit,
            )
            .await
            .map_err(|err| err.to_string())?;
            emit_event(
                store_ref,
                run_id,
                None,
                "run.awaiting_plan_edit",
                Some(serde_json::json!({ "reason": "user_requested_modify" })),
            )
            .await;
            if let Some(proposal) = updated_proposal {
                persist_paused_proposal_edit(store_ref, run_id, run, proposal).await?;
            }
            Ok(WorkflowRunStatus::AwaitingPlanEdit)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::modules::custom_task_agents::types::CreateCustomTaskAgentRequest;
    use crate::modules::mcp::store::McpStore;
    use crate::modules::workflow::store;
    use crate::modules::workflow::types::{
        CreateWorkflowRunRequest, WorkflowRunStatus, WorkflowStepType,
    };
    use uuid::Uuid;

    use super::*;

    async fn create_test_store(name: &str) -> McpStore {
        let db_path = std::env::temp_dir().join(format!(
            "deeting-workflow-phase2-{name}-{}.db",
            Uuid::new_v4()
        ));
        let database_url = format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = McpStore::new(&database_url)
            .await
            .expect("create phase2 test store");
        store.init().await.expect("init phase2 test store");
        store
    }

    fn temp_app_data_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "deeting-workflow-phase2-appdata-{name}-{}",
            Uuid::new_v4()
        ))
    }

    const SAMPLE_PROPOSAL: &str = r#"# Workflow Proposal

Title: Test Workflow
Goal: Produce a useful output

## Global Constraints
- Language: Chinese

## Phase 1: Research
- Worker: direct_llm:default
- Goal: Gather information
- Expected output: research_notes
- User Notes:

## Phase 2: Analysis
- Worker: direct_llm:default
- Goal: Analyze the findings
- Expected output: analysis_report
- Depends on: Phase 1
- User Notes:
"#;

    #[test]
    fn build_quick_workflow_proposal_text_creates_single_phase_worker_plan() {
        let proposal = build_quick_workflow_proposal_text(
            "Summarize the repo structure",
            "user_worker_profile:research-pro",
            true,
        );

        assert!(proposal.contains("# Workflow Proposal"));
        assert!(proposal.contains("Title: Quick Worker Run"));
        assert!(proposal.contains("Goal: Summarize the repo structure"));
        assert!(proposal.contains("## Global Constraints"));
        assert!(proposal.contains("- Mode: quick_workflow_compatibility"));
        assert!(proposal.contains("- Inject into chat: true"));
        assert!(proposal.contains("## Phase 1: Execute"));
        assert!(proposal.contains("- Worker: user_worker_profile:research-pro"));
        assert!(proposal.contains("- Goal: Summarize the repo structure"));
        assert!(proposal.contains("- Expected output: delegated_result"));
    }

    #[test]
    fn extract_primary_content_reads_latest_succeeded_phase_result() {
        let run_dir =
            std::env::temp_dir().join(format!("deeting-workflow-quick-result-{}", Uuid::new_v4()));
        std::fs::create_dir_all(run_dir.join("phases").join("phase-1"))
            .expect("create phase-1 dir");
        std::fs::create_dir_all(run_dir.join("phases").join("phase-2"))
            .expect("create phase-2 dir");
        std::fs::write(
            run_dir.join("phases").join("phase-1").join("result.md"),
            "phase 1 result",
        )
        .expect("write phase-1 result");
        std::fs::write(
            run_dir.join("phases").join("phase-2").join("result.md"),
            "phase 2 result",
        )
        .expect("write phase-2 result");

        let detail = WorkflowRunDetail {
            run: WorkflowRun {
                id: "run-1".to_string(),
                title: "Quick Run".to_string(),
                goal: "Goal".to_string(),
                status: WorkflowRunStatus::Completed,
                proposal_text: None,
                snapshot_json: None,
                proposal_version: 1,
                snapshot_version: 1,
                run_dir: Some(run_dir.to_string_lossy().to_string()),
                error: None,
                created_at: "2026-03-23T00:00:00Z".to_string(),
                updated_at: "2026-03-23T00:00:00Z".to_string(),
            },
            steps: vec![
                crate::modules::workflow::types::WorkflowStepRun {
                    id: "step-1".to_string(),
                    run_id: "run-1".to_string(),
                    phase_id: "phase-1".to_string(),
                    phase_index: 0,
                    step_type: crate::modules::workflow::types::WorkflowStepType::WorkerCall,
                    title: "Phase 1".to_string(),
                    status: WorkflowStepStatus::Succeeded,
                    worker_ref: Some("direct_llm:default".to_string()),
                    goal: Some("First".to_string()),
                    input_snapshot: None,
                    output_artifact_refs: vec![],
                    worker_trace_summary: Some("fallback one".to_string()),
                    retry_count: 0,
                    error: None,
                    started_at: None,
                    completed_at: Some("2026-03-23T00:00:01Z".to_string()),
                    created_at: "2026-03-23T00:00:00Z".to_string(),
                    updated_at: "2026-03-23T00:00:01Z".to_string(),
                },
                crate::modules::workflow::types::WorkflowStepRun {
                    id: "step-2".to_string(),
                    run_id: "run-1".to_string(),
                    phase_id: "phase-2".to_string(),
                    phase_index: 1,
                    step_type: crate::modules::workflow::types::WorkflowStepType::WorkerCall,
                    title: "Phase 2".to_string(),
                    status: WorkflowStepStatus::Succeeded,
                    worker_ref: Some("direct_llm:default".to_string()),
                    goal: Some("Second".to_string()),
                    input_snapshot: None,
                    output_artifact_refs: vec![],
                    worker_trace_summary: Some("fallback two".to_string()),
                    retry_count: 0,
                    error: None,
                    started_at: None,
                    completed_at: Some("2026-03-23T00:00:02Z".to_string()),
                    created_at: "2026-03-23T00:00:01Z".to_string(),
                    updated_at: "2026-03-23T00:00:02Z".to_string(),
                },
            ],
            events: vec![],
        };

        let content = extract_primary_content(&detail);
        assert_eq!(content.as_deref(), Some("phase 2 result"));

        std::fs::remove_dir_all(run_dir).ok();
    }

    #[tokio::test]
    async fn persist_generated_proposal_creates_run_dir_and_versions() {
        let store = create_test_store("persist-generated").await;
        let app_data_dir = temp_app_data_dir("persist-generated");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist generated proposal");

        assert_eq!(run.proposal_version, 1);
        assert_eq!(run.status, WorkflowRunStatus::Draft);
        assert!(run.run_dir.is_some());
        let proposal_path =
            PathBuf::from(run.run_dir.as_ref().expect("run_dir")).join("proposal.md");
        assert!(proposal_path.exists());
        assert_eq!(
            std::fs::read_to_string(proposal_path).expect("read proposal file"),
            SAMPLE_PROPOSAL
        );

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn update_existing_proposal_bumps_version_and_updates_disk() {
        let store = create_test_store("update-proposal").await;
        let app_data_dir = temp_app_data_dir("update-proposal");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist generated proposal");

        let updated_text = SAMPLE_PROPOSAL.replace("Research", "Discovery");
        let updated = update_existing_proposal(
            &store,
            &run.id,
            Some(app_data_dir.clone()),
            updated_text.clone(),
        )
        .await
        .expect("update proposal");

        assert_eq!(updated.proposal_version, 2);
        assert_eq!(
            updated.proposal_text.as_deref(),
            Some(updated_text.as_str())
        );
        let proposal_path =
            PathBuf::from(updated.run_dir.as_ref().expect("run_dir")).join("proposal.md");
        assert_eq!(
            std::fs::read_to_string(proposal_path).expect("read updated proposal"),
            updated_text
        );
        assert_eq!(updated.status, WorkflowRunStatus::Draft);
        assert!(updated.snapshot_json.is_none());

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn compile_current_proposal_persists_snapshot_and_sets_ready() {
        let store = create_test_store("compile-proposal").await;
        let app_data_dir = temp_app_data_dir("compile-proposal");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist generated proposal");

        let compile_result = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile proposal");
        assert!(compile_result.snapshot.is_some());

        let updated = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(updated.status, WorkflowRunStatus::Ready);
        assert_eq!(updated.snapshot_version, 1);
        assert!(updated.snapshot_json.is_some());
        let snapshot_path =
            PathBuf::from(updated.run_dir.as_ref().expect("run_dir")).join("snapshot.json");
        assert!(snapshot_path.exists());

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn compile_current_proposal_surfaces_compiler_errors_without_readying_run() {
        let store = create_test_store("compile-invalid").await;
        let app_data_dir = temp_app_data_dir("compile-invalid");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.replace("direct_llm:default", "user_worker_profile:missing"),
            false,
        )
        .await
        .expect("persist generated proposal");

        let compile_result = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile invalid proposal");
        assert!(compile_result.snapshot.is_none());
        assert!(!compile_result.errors.is_empty());

        let updated = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(updated.status, WorkflowRunStatus::AwaitingPlanEdit);
        assert!(updated.snapshot_json.is_none());

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn compile_current_proposal_accepts_available_user_worker_refs() {
        let store = create_test_store("compile-user-worker").await;
        let app_data_dir = temp_app_data_dir("compile-user-worker");
        let agent = crate::modules::custom_task_agents::store::create_custom_task_agent(
            &store,
            CreateCustomTaskAgentRequest {
                name: "Research Pro".to_string(),
                description: None,
                task_prompt: "Research".to_string(),
                invocation_kind: None,
                preferred_for_image_generation: None,
                model_config: None,
                callable_mcp_tool_ids: vec![],
                guidance_skill_ids: vec![],
                callable_skill_action_refs: vec![],
                tags: None,
                discoverable: Some(true),
                is_enabled: Some(true),
            },
        )
        .await
        .expect("create test agent");

        let proposal = SAMPLE_PROPOSAL.replace(
            "direct_llm:default",
            &format!("user_worker_profile:{}", agent.id),
        );
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            proposal,
            false,
        )
        .await
        .expect("persist generated proposal");

        let compile_result = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile proposal with valid agent");
        assert!(compile_result.errors.is_empty());
        assert!(compile_result.snapshot.is_some());

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn compile_current_proposal_without_proposal_text_fails() {
        let store = create_test_store("compile-missing-proposal").await;
        let app_data_dir = temp_app_data_dir("compile-missing-proposal");
        let run = store::create_workflow_run(
            &store,
            CreateWorkflowRunRequest {
                title: "Missing Proposal".to_string(),
                goal: "Goal".to_string(),
                proposal_text: None,
            },
        )
        .await
        .expect("create run");

        let error = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect_err("compile without proposal text should fail");
        assert!(error.contains("no proposal text"));

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn regenerate_existing_proposal_replaces_text_and_records_event() {
        let store = create_test_store("regenerate-proposal").await;
        let app_data_dir = temp_app_data_dir("regenerate-proposal");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist initial proposal");

        let regenerated_text = SAMPLE_PROPOSAL.replace("Analysis", "Synthesis");
        let updated = regenerate_existing_proposal(
            &store,
            &run.id,
            Some(app_data_dir.clone()),
            regenerated_text.clone(),
        )
        .await
        .expect("regenerate proposal");

        assert_eq!(updated.proposal_version, 2);
        assert_eq!(
            updated.proposal_text.as_deref(),
            Some(regenerated_text.as_str())
        );

        let events = store::list_workflow_events_by_run(&store, &run.id)
            .await
            .expect("list events");
        let last = events.last().expect("last event");
        assert_eq!(last.event_type, "run.plan_proposed");
        assert_eq!(
            last.payload
                .as_ref()
                .and_then(|value| value.get("regenerated"))
                .and_then(|value| value.as_bool()),
            Some(true)
        );

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn editing_after_successful_compile_invalidates_ready_snapshot() {
        let store = create_test_store("invalidate-after-edit").await;
        let app_data_dir = temp_app_data_dir("invalidate-after-edit");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist initial proposal");
        let _compiled = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile initial proposal");

        let updated = update_existing_proposal(
            &store,
            &run.id,
            Some(app_data_dir.clone()),
            SAMPLE_PROPOSAL.replace("Analysis", "Synthesis"),
        )
        .await
        .expect("update proposal");

        assert_eq!(updated.status, WorkflowRunStatus::Draft);
        assert!(updated.snapshot_json.is_none());
        assert_eq!(updated.snapshot_version, 1);

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn compile_failure_after_stale_snapshot_clears_ready_state() {
        let store = create_test_store("compile-failure-invalidates-ready").await;
        let app_data_dir = temp_app_data_dir("compile-failure-invalidates-ready");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist initial proposal");
        let _compiled = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile initial proposal");

        store::update_workflow_run_proposal(
            &store,
            &run.id,
            &SAMPLE_PROPOSAL.replace("direct_llm:default", "user_worker_profile:missing"),
            2,
        )
        .await
        .expect("inject invalid proposal");

        let result = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile invalid proposal");
        assert!(result.snapshot.is_none());

        let updated = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(updated.status, WorkflowRunStatus::AwaitingPlanEdit);
        assert!(updated.snapshot_json.is_none());

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn proposal_disk_write_failure_does_not_advance_db_version() {
        let store = create_test_store("proposal-disk-failure").await;
        let app_data_dir = temp_app_data_dir("proposal-disk-failure");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist initial proposal");

        let broken_dir = app_data_dir.join("broken-run-dir-file");
        std::fs::write(&broken_dir, "not a directory").expect("write sentinel file");
        store::update_workflow_run_run_dir(&store, &run.id, &broken_dir.to_string_lossy())
            .await
            .expect("update broken run_dir");

        let error = update_existing_proposal(
            &store,
            &run.id,
            Some(app_data_dir.clone()),
            SAMPLE_PROPOSAL.replace("Research", "Broken"),
        )
        .await
        .expect_err("proposal update should fail when proposal.md cannot be written");
        assert!(error.contains("proposal.md"));

        let persisted = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(persisted.proposal_version, 1);
        assert_eq!(persisted.proposal_text.as_deref(), Some(SAMPLE_PROPOSAL));

        std::fs::remove_file(broken_dir).ok();
        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn snapshot_disk_write_failure_does_not_mark_run_ready() {
        let store = create_test_store("snapshot-disk-failure").await;
        let app_data_dir = temp_app_data_dir("snapshot-disk-failure");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 2".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist initial proposal");

        let broken_dir = app_data_dir.join("broken-snapshot-dir-file");
        std::fs::write(&broken_dir, "not a directory").expect("write sentinel file");
        store::update_workflow_run_run_dir(&store, &run.id, &broken_dir.to_string_lossy())
            .await
            .expect("update broken run_dir");

        let error = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect_err("compile should fail when snapshot.json cannot be written");
        assert!(error.contains("snapshot.json"));

        let persisted = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(persisted.status, WorkflowRunStatus::Draft);
        assert!(persisted.snapshot_json.is_none());

        std::fs::remove_file(broken_dir).ok();
        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn start_workflow_run_rejects_non_ready_run() {
        let store = create_test_store("start-non-ready").await;
        let app_data_dir = temp_app_data_dir("start-non-ready");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 4".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist proposal");

        let error = claim_run_for_start(&store, &run.id)
            .await
            .expect_err("draft run should not start");
        assert!(error.contains("ready"));

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn start_workflow_run_rejects_missing_snapshot() {
        let store = create_test_store("start-missing-snapshot").await;
        let app_data_dir = temp_app_data_dir("start-missing-snapshot");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 4".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist proposal");
        store::update_workflow_run_status(&store, &run.id, WorkflowRunStatus::Ready)
            .await
            .expect("force ready");

        let error = claim_run_for_start(&store, &run.id)
            .await
            .expect_err("run without snapshot should fail");
        assert!(error.contains("snapshot"));

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn get_workflow_run_status_returns_steps_and_events() {
        let store = create_test_store("status-detail").await;
        let run = store::create_workflow_run(
            &store,
            CreateWorkflowRunRequest {
                title: "Status".to_string(),
                goal: "Status".to_string(),
                proposal_text: None,
            },
        )
        .await
        .expect("create run");

        let step = store::create_workflow_step_run(
            &store,
            crate::modules::workflow::types::CreateWorkflowStepRunRequest {
                run_id: run.id.clone(),
                phase_id: "phase-1".to_string(),
                phase_index: 1,
                step_type: crate::modules::workflow::types::WorkflowStepType::WorkerCall,
                title: "Phase 1".to_string(),
                worker_ref: Some("direct_llm:default".to_string()),
                goal: Some("Do work".to_string()),
            },
        )
        .await
        .expect("create step");
        store::create_workflow_event(
            &store,
            crate::modules::workflow::types::CreateWorkflowEventRequest {
                run_id: run.id.clone(),
                step_id: Some(step.id.clone()),
                event_type: "step.started".to_string(),
                payload: None,
            },
        )
        .await
        .expect("create event");

        let detail = get_workflow_run_status_with_store(&store, &run.id)
            .await
            .expect("get run status");
        assert_eq!(detail.run.id, run.id);
        assert_eq!(detail.steps.len(), 1);
        assert_eq!(detail.events.len(), 1);
    }

    #[tokio::test]
    async fn claim_run_for_start_is_single_winner_transition() {
        let store = create_test_store("claim-run").await;
        let app_data_dir = temp_app_data_dir("claim-run");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 4".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist proposal");
        let _compiled = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile proposal");

        claim_run_for_start(&store, &run.id)
            .await
            .expect("first claim should succeed");
        let second = claim_run_for_start(&store, &run.id)
            .await
            .expect_err("second claim should fail");
        assert!(
            second.contains("no longer startable") || second.contains("ready"),
            "unexpected second-claim error: {second}"
        );

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    async fn create_waiting_approval_run(
        name: &str,
    ) -> (
        McpStore,
        PathBuf,
        WorkflowRun,
        crate::modules::workflow::types::WorkflowCheckpoint,
    ) {
        let store = create_test_store(name).await;
        let app_data_dir = temp_app_data_dir(name);
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 5".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist proposal");
        let _compiled = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile proposal");
        store::update_workflow_run_status(&store, &run.id, WorkflowRunStatus::WaitingApproval)
            .await
            .expect("set waiting approval");
        let step = store::create_workflow_step_run(
            &store,
            crate::modules::workflow::types::CreateWorkflowStepRunRequest {
                run_id: run.id.clone(),
                phase_id: "phase-approval".to_string(),
                phase_index: 99,
                step_type: WorkflowStepType::ApprovalGate,
                title: "Approval".to_string(),
                worker_ref: None,
                goal: Some("Approve".to_string()),
            },
        )
        .await
        .expect("create gate step");
        store::update_workflow_step_status(&store, &step.id, WorkflowStepStatus::WaitingApproval)
            .await
            .expect("mark gate waiting");
        let checkpoint = store::create_workflow_checkpoint(
            &store,
            crate::modules::workflow::types::CreateWorkflowCheckpointRequest {
                run_id: run.id.clone(),
                blocked_step_id: Some(step.id.clone()),
                reason: "waiting approval".to_string(),
                approval_payload: None,
            },
        )
        .await
        .expect("create checkpoint");
        let run = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        (store, app_data_dir, run, checkpoint)
    }

    #[tokio::test]
    async fn approval_action_helper_approve_marks_ready() {
        let (store, app_data_dir, run, checkpoint) =
            create_waiting_approval_run("approve-ready").await;
        let status =
            apply_approval_action(&store, &run, &checkpoint, &ApprovalAction::Approve, None)
                .await
                .expect("approve action");
        assert_eq!(status, WorkflowRunStatus::Ready);

        let reloaded = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(reloaded.status, WorkflowRunStatus::Ready);

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn approval_action_reject_cancels_run() {
        let (store, app_data_dir, run, checkpoint) =
            create_waiting_approval_run("approve-reject").await;
        let status =
            apply_approval_action(&store, &run, &checkpoint, &ApprovalAction::Reject, None)
                .await
                .expect("reject action");
        assert_eq!(status, WorkflowRunStatus::Cancelled);

        let reloaded = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(reloaded.status, WorkflowRunStatus::Cancelled);

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn approval_action_modify_transitions_to_awaiting_edit() {
        let (store, app_data_dir, run, checkpoint) =
            create_waiting_approval_run("approve-modify").await;
        let status = apply_approval_action(
            &store,
            &run,
            &checkpoint,
            &ApprovalAction::Modify,
            Some(&SAMPLE_PROPOSAL.replace("Analysis", "Edited Analysis")),
        )
        .await
        .expect("modify action");
        assert_eq!(status, WorkflowRunStatus::AwaitingPlanEdit);

        let reloaded = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(reloaded.status, WorkflowRunStatus::AwaitingPlanEdit);
        assert_eq!(reloaded.proposal_version, 2);
        assert!(reloaded.snapshot_json.is_none());

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn edit_remaining_phases_updates_proposal_and_invalidates_snapshot() {
        let store = create_test_store("edit-remaining").await;
        let app_data_dir = temp_app_data_dir("edit-remaining");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 5".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist proposal");
        let _compiled = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile proposal");
        store::update_workflow_run_status(&store, &run.id, WorkflowRunStatus::AwaitingPlanEdit)
            .await
            .expect("set awaiting plan edit");
        let run = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");

        persist_paused_proposal_edit(
            &store,
            &run.id,
            &run,
            &SAMPLE_PROPOSAL.replace("Analysis", "Edited Analysis"),
        )
        .await
        .expect("edit proposal");

        let updated = store::get_workflow_run(&store, &run.id)
            .await
            .expect("reload run")
            .expect("run exists");
        assert_eq!(updated.status, WorkflowRunStatus::AwaitingPlanEdit);
        assert_eq!(updated.proposal_version, 2);
        assert!(updated.snapshot_json.is_none());

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn claim_run_for_resume_rejects_without_snapshot() {
        let store = create_test_store("resume-no-snapshot").await;
        let run = store::create_workflow_run(
            &store,
            CreateWorkflowRunRequest {
                title: "Ready".to_string(),
                goal: "Ready".to_string(),
                proposal_text: None,
            },
        )
        .await
        .expect("create run");
        store::update_workflow_run_status(&store, &run.id, WorkflowRunStatus::Ready)
            .await
            .expect("set ready");
        let error = claim_run_for_resume(&store, &run.id)
            .await
            .expect_err("resume without snapshot should fail");
        assert!(error.contains("snapshot"));
    }

    #[tokio::test]
    async fn rerun_phase_resets_failed_run_to_ready() {
        let store = create_test_store("rerun-phase").await;
        let app_data_dir = temp_app_data_dir("rerun-phase");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 5".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist proposal");
        let _compiled = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile proposal");
        store::update_workflow_run_status(&store, &run.id, WorkflowRunStatus::Failed)
            .await
            .expect("set failed");

        let updated = rerun_phase_with_store(
            &store,
            crate::modules::workflow::types::RerunPhaseRequest {
                run_id: run.id.clone(),
                phase_id: "phase-2".to_string(),
                updated_goal: None,
            },
        )
        .await
        .expect("rerun phase");
        assert_eq!(updated.status, WorkflowRunStatus::Ready);

        std::fs::remove_dir_all(app_data_dir).ok();
    }

    #[tokio::test]
    async fn rerun_phase_rejects_unknown_phase() {
        let store = create_test_store("rerun-unknown").await;
        let app_data_dir = temp_app_data_dir("rerun-unknown");
        let run = persist_generated_proposal(
            &store,
            Some(app_data_dir.clone()),
            "Workflow Runtime V2".to_string(),
            "Ship phase 5".to_string(),
            SAMPLE_PROPOSAL.to_string(),
            false,
        )
        .await
        .expect("persist proposal");
        let _compiled = compile_current_proposal(&store, Some(app_data_dir.clone()), &run.id)
            .await
            .expect("compile proposal");
        store::update_workflow_run_status(&store, &run.id, WorkflowRunStatus::Failed)
            .await
            .expect("set failed");

        let error = rerun_phase_with_store(
            &store,
            crate::modules::workflow::types::RerunPhaseRequest {
                run_id: run.id.clone(),
                phase_id: "phase-999".to_string(),
                updated_goal: None,
            },
        )
        .await
        .expect_err("unknown phase should fail");
        assert!(error.contains("not found in snapshot"));

        std::fs::remove_dir_all(app_data_dir).ok();
    }
}
