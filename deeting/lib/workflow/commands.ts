/**
 * Tauri invoke wrappers for the workflow runtime commands.
 * Each function maps to a #[tauri::command] in workflow/commands.rs.
 */
import { resolveLocalGatewayBaseUrl } from "@/lib/api/chat"
import { openSSE } from "@/lib/http"
import type {
  ApproveWorkflowRequest,
  ApplyPlanDeltaRequest,
  CompileResult,
  EditRemainingPhasesRequest,
  GenerateProposalRequest,
  QuickWorkflowRequest,
  QuickWorkflowResult,
  RegenerateProposalRequest,
  RerunPhaseRequest,
  UpdateProposalRequest,
  ExportWorkflowArtifactResponse,
  WorkflowArtifactContent,
  WorkflowPhaseContext,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowProgress,
} from "./types"

export type WorkflowStreamEvent =
  | { type: "workflow.compile_started"; run_id?: string; trace_id?: string; request_id?: string | null }
  | { type: "workflow.compile_result"; compile_result: CompileResult }
  | { type: "workflow.progress"; progress: WorkflowProgress }
  | {
      type:
        | "workflow.ready"
        | "workflow.final_detail"
        | "workflow.run_started"
        | "workflow.run_finished"
        | "workflow.step_started"
        | "workflow.step_succeeded"
        | "workflow.step_failed"
      detail: WorkflowRunDetail
    }
  | { type: "error" | "workflow.error"; message?: string; error_code?: string }

export interface WorkflowCompileAndStartStreamRequest {
  runId: string
  proposalText?: string | null
  proposalDirty?: boolean
  requestId?: string
  executionModelId?: string | null
  executionProviderModelId?: string | null
}

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

export async function getWorkflowArtifactContent(
  runId: string,
  artifactRef: string,
): Promise<WorkflowArtifactContent> {
  return invoke<WorkflowArtifactContent>("get_workflow_artifact_content", {
    runId,
    artifactRef,
  })
}

export async function openWorkflowArtifact(
  runId: string,
  artifactRef: string,
): Promise<void> {
  return invoke<void>("open_workflow_artifact", {
    runId,
    artifactRef,
  })
}

export async function exportWorkflowArtifact(
  runId: string,
  artifactRef: string,
): Promise<ExportWorkflowArtifactResponse> {
  return invoke<ExportWorkflowArtifactResponse>("export_workflow_artifact", {
    runId,
    artifactRef,
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

export async function streamWorkflowCompileAndStart(
  payload: WorkflowCompileAndStartStreamRequest,
  handlers: {
    onEvent?: (event: WorkflowStreamEvent) => void
  } = {},
): Promise<void> {
  const runId = payload.runId.trim()
  if (!runId) throw new Error("Workflow run id is required")

  const baseUrl = await resolveLocalGatewayBaseUrl()
  const body = JSON.stringify({
    proposalText: payload.proposalText ?? null,
    proposalDirty: payload.proposalDirty ?? false,
    requestId: payload.requestId,
    executionModelId: payload.executionModelId ?? null,
    executionProviderModelId: payload.executionProviderModelId ?? null,
  })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let close: () => void = () => {}
    close = openSSE(`${baseUrl}/v1/workflows/${encodeURIComponent(runId)}/compile-and-start`, {
      method: "POST",
      body,
      credentials: "omit",
      includeAuthHeader: false,
      headers: {
        "Content-Type": "application/json",
      },
      onMessage: (message) => {
        const data = message.data
        if (data === "[DONE]") {
          if (settled) return
          settled = true
          close()
          resolve()
          return
        }

        if (data && typeof data === "object") {
          const event = data as WorkflowStreamEvent
          handlers.onEvent?.(event)
          if (event.type === "error" || event.type === "workflow.error") {
            const message = "message" in event && event.message ? event.message : "Workflow stream failed"
            if (!settled) {
              settled = true
              close()
              reject(new Error(message))
            }
          }
        }
      },
      onError: (error) => {
        if (settled) return
        settled = true
        reject(error)
      },
      onClose: () => {
        if (settled) return
        settled = true
        resolve()
      },
    })
  })
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

export async function applyPlanDelta(req: ApplyPlanDeltaRequest): Promise<WorkflowRun> {
  return invoke<WorkflowRun>("apply_plan_delta", { req })
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
