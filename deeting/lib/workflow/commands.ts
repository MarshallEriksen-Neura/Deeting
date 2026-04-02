/**
 * Tauri invoke wrappers for the workflow runtime commands.
 * Each function maps to a #[tauri::command] in workflow/commands.rs.
 */
import type {
  ApproveWorkflowRequest,
  CompileResult,
  EditRemainingPhasesRequest,
  GenerateProposalRequest,
  QuickWorkflowRequest,
  QuickWorkflowResult,
  RegenerateProposalRequest,
  RerunPhaseRequest,
  UpdateProposalRequest,
  WorkflowPhaseContext,
  WorkflowRun,
  WorkflowRunDetail,
} from "./types"

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core")
  return tauriInvoke<T>(cmd, args)
}

export async function listWorkflowRuns(): Promise<WorkflowRun[]> {
  return invoke<WorkflowRun[]>("list_workflow_runs")
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("get_workflow_run", { runId })
}

export async function getWorkflowRunDetail(runId: string): Promise<WorkflowRunDetail> {
  return invoke<WorkflowRunDetail>("get_workflow_run_detail", { runId })
}

export async function getWorkflowRunStatus(runId: string): Promise<WorkflowRunDetail> {
  return invoke<WorkflowRunDetail>("get_workflow_run_status", { runId })
}

export async function getWorkflowPhaseContext(
  runId: string,
  phaseId: string,
): Promise<WorkflowPhaseContext> {
  return invoke<WorkflowPhaseContext>("get_workflow_phase_context", {
    runId,
    phaseId,
  })
}

export async function generateWorkflowProposal(
  payload: GenerateProposalRequest,
): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("generate_workflow_proposal", { payload })
}

export async function updateWorkflowProposal(
  payload: UpdateProposalRequest,
): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("update_workflow_proposal", { payload })
}

export async function compileWorkflowProposal(runId: string): Promise<CompileResult> {
  return invoke<CompileResult>("compile_workflow_proposal", { runId })
}

export async function regenerateWorkflowProposal(
  payload: RegenerateProposalRequest,
): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("regenerate_workflow_proposal", { payload })
}

export async function startWorkflowRun(runId: string): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("start_workflow_run", { runId })
}

export async function approveWorkflow(req: ApproveWorkflowRequest): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("approve_workflow", { req })
}

export async function editRemainingPhases(
  req: EditRemainingPhasesRequest,
): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("edit_remaining_phases", { req })
}

export async function resumeWorkflow(runId: string): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("resume_workflow", { runId })
}

export async function rerunPhase(req: RerunPhaseRequest): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("rerun_phase", { req })
}

export async function quickWorkflowRun(req: QuickWorkflowRequest): Promise<QuickWorkflowResult> {
  return invoke<QuickWorkflowResult>("quick_workflow_run", { req })
}
