import type { MessageBlock } from "@/lib/chat/message-protocol"
import type { ExecutionLifecyclePayload } from "@/lib/execution-tree/types"
import type { WorkflowRun, WorkflowStepRun, WorkflowRunStatus } from "./types"

export type WorkflowTerminalStatus = "completed" | "failed" | "cancelled" | "awaiting_plan_edit"

export interface WorkflowArtifactSummary {
  ref: string
  kind: "markdown" | "json" | "file" | "unknown"
  label: string
}

export interface WorkflowResultPayload {
  run_id: string
  status: WorkflowRunStatus
  title: string
  goal: string
  summary: string | null
  error: string | null
  focus_phase_id: string | null
  focus_phase_title: string | null
  preserved_success_count: number
  total_phase_count: number
  artifacts: WorkflowArtifactSummary[]
  steps: Array<{
    phase_id: string
    title: string
    status: string
    summary: string | null
    error: string | null
    artifacts: WorkflowArtifactSummary[]
  }>
}

export function isWorkflowTerminal(status: WorkflowRunStatus | undefined): status is WorkflowTerminalStatus {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "awaiting_plan_edit"
  )
}

export interface WorkflowLivePayload {
  run_id: string
  status: string
  title: string
  goal: string
  current_phase_index: number
  total_phases: number
  steps: Array<{
    phase_id: string
    title: string
    status: string
    goal?: string | null
    error?: string | null
  }>
}

export function buildWorkflowLivePayload(run: WorkflowRun, steps: WorkflowStepRun[]): WorkflowLivePayload {
  const sorted = [...steps].sort((a, b) => a.phase_index - b.phase_index)
  const totalPhases = run.snapshot_json?.phases?.length ?? sorted.length
  const runningIndex = sorted.findIndex((s) => s.status === "running")

  return {
    run_id: run.id,
    status: run.status,
    title: run.title || run.goal || "Workflow",
    goal: run.goal,
    current_phase_index: runningIndex >= 0 ? runningIndex : sorted.filter((s) => s.status === "succeeded").length,
    total_phases: totalPhases,
    steps: sorted.map((step) => ({
      phase_id: step.phase_id,
      title: step.title || step.phase_id,
      status: step.status,
      goal: step.goal,
      error: step.error,
    })),
  }
}

export function buildWorkflowLiveBlocks(run: WorkflowRun, steps: WorkflowStepRun[]): MessageBlock[] {
  return [
    {
      id: `workflow-live-ui-${run.id}`,
      type: "ui",
      viewType: "workflow.live",
      title: "执行中",
      payload: buildWorkflowLivePayload(run, steps),
      metadata: { workflow_run_id: run.id },
      streamState: "streaming",
    },
  ]
}

export function buildWorkflowPlanBlocks(run: WorkflowRun): MessageBlock[] {
  const phases = run.snapshot_json?.phases ?? []
  return [
    {
      id: `workflow-plan-ui-${run.id}`,
      type: "ui",
      viewType: "workflow.plan",
      title: "Workflow Plan",
      payload: {
        run_id: run.id,
        title: run.title || run.goal || "Workflow",
        goal: run.goal,
        phases: phases.map((phase: { id?: string; title?: string; goal?: string; worker_ref?: string; depends_on?: string[] }) => ({
          phase_id: phase.id ?? "",
          title: phase.title ?? "",
          goal: phase.goal ?? "",
          worker_ref: phase.worker_ref ?? "direct_llm:default",
          depends_on: phase.depends_on ?? [],
        })),
      },
      metadata: { workflow_run_id: run.id },
      streamState: "completed",
    },
  ]
}
export function findWorkflowResultStep(run: WorkflowRun | null, steps: WorkflowStepRun[]): WorkflowStepRun | null {
  if (!run) return null
  const sorted = [...steps].sort((a, b) => a.phase_index - b.phase_index)
  if (run.status === "failed" || run.status === "cancelled") {
    return [...sorted].reverse().find((step) => step.status === "failed" || Boolean(step.error)) ?? null
  }
  if (run.status === "completed" || run.status === "awaiting_plan_edit") {
    return [...sorted].reverse().find((step) => step.status === "succeeded") ?? null
  }
  return sorted.find((step) => step.status === "running") ?? [...sorted].reverse().find((step) => step.status === "succeeded") ?? null
}

export function isUserVisibleWorkflowArtifactRef(ref: string): boolean {
  const label = ref.split(/[\\/]/).pop()?.toLowerCase() || ref.toLowerCase()
  return label !== "result.json"
}

export function getUserVisibleWorkflowArtifactRefs(refs: string[]): string[] {
  return refs.filter(isUserVisibleWorkflowArtifactRef)
}

export function summarizeWorkflowArtifacts(step: WorkflowStepRun | null | undefined): WorkflowArtifactSummary[] {
  return getUserVisibleWorkflowArtifactRefs(step?.output_artifact_refs ?? []).map((ref) => {
    const label = ref.split(/[\\/]/).pop() || ref
    const lower = label.toLowerCase()
    const kind: WorkflowArtifactSummary["kind"] = lower.endsWith(".md")
      ? "markdown"
      : lower.endsWith(".json")
        ? "json"
        : lower.includes(".")
          ? "file"
          : "unknown"
    return { ref, kind, label }
  })
}

export function buildWorkflowResultPayload(run: WorkflowRun, steps: WorkflowStepRun[]): WorkflowResultPayload {
  const sorted = [...steps].sort((a, b) => a.phase_index - b.phase_index)
  const focusStep = findWorkflowResultStep(run, sorted)
  const artifacts = summarizeWorkflowArtifacts(focusStep)
  const preservedSuccessCount = sorted.filter((step) => step.status === "succeeded").length
  const totalPhaseCount = run.snapshot_json?.phases?.length ?? sorted.length

  return {
    run_id: run.id,
    status: run.status,
    title: run.title || run.goal || "Workflow",
    goal: run.goal,
    summary: focusStep?.worker_trace_summary ?? null,
    error: focusStep?.error ?? run.error ?? null,
    focus_phase_id: focusStep?.phase_id ?? null,
    focus_phase_title: focusStep?.title ?? null,
    preserved_success_count: preservedSuccessCount,
    total_phase_count: totalPhaseCount,
    artifacts,
    steps: sorted.map((step) => ({
      phase_id: step.phase_id,
      title: step.title || step.phase_id,
      status: step.status,
      summary: step.worker_trace_summary,
      error: step.error,
      artifacts: summarizeWorkflowArtifacts(step),
    })),
  }
}

export function buildWorkflowExecutionPayload(run: WorkflowRun, steps: WorkflowStepRun[]): ExecutionLifecyclePayload {
  const resultPayload = buildWorkflowResultPayload(run, steps)
  const terminalStatus =
    run.status === "completed"
      ? "succeeded"
      : run.status === "awaiting_plan_edit"
        ? "needs_review"
        : run.status

  return {
    schema_version: 1,
    root_execution_id: `workflow:${run.id}`,
    execution_id: `workflow:${run.id}`,
    execution_kind: "workflow",
    execution_status: terminalStatus,
    terminal_status: terminalStatus,
    target: {
      id: run.id,
      name: run.title || run.goal || "Workflow",
      invocation_kind: "workflow",
      workflow_run_id: run.id,
    },
    available_actions: [{ kind: "open" }, { kind: "view_result" }],
    summary: resultPayload.summary ?? resultPayload.error ?? run.goal,
    error: resultPayload.error,
    delegated_result: {
      type: "delegated_result",
      schema_version: 1,
      kind: "workflow",
      authoritative: run.status === "completed",
      status: terminalStatus,
      execution_id: `workflow:${run.id}`,
      target: {
        id: run.id,
        name: run.title || run.goal || "Workflow",
        invocation_kind: "workflow",
        workflow_run_id: run.id,
      },
      available_actions: [{ kind: "open" }, { kind: "view_result" }],
      summary: resultPayload.summary ?? resultPayload.error ?? run.goal,
      error: resultPayload.error,
      primary_output: {
        render_blocks: [
          {
            view_type: "workflow.result",
            title: "Workflow Result",
            payload: resultPayload,
            metadata: { workflow_run_id: run.id },
          },
        ],
      },
    },
    children: steps
      .slice()
      .sort((a, b) => a.phase_index - b.phase_index)
      .map((step) => ({
        id: step.id,
        phase_id: step.phase_id,
        step_type: step.step_type,
        title: step.title || step.phase_id,
        status: step.status,
        worker_ref: step.worker_ref,
        summary: step.worker_trace_summary,
        error: step.error,
        available_actions: [
          { kind: "open" },
          { kind: "view_context" },
          ...(step.status === "failed" ? [{ kind: "rerun" }] : []),
          ...(step.status === "succeeded" ? [{ kind: "view_result" }] : []),
        ],
      })),
  }
}

export function buildWorkflowReceiptBlocks(run: WorkflowRun, steps: WorkflowStepRun[]): MessageBlock[] {
  const resultPayload = buildWorkflowResultPayload(run, steps)

  return [
    {
      id: `workflow-receipt-ui-${run.id}`,
      type: "ui",
      viewType: "workflow.result",
      title: "Workflow Result",
      payload: resultPayload,
      metadata: { workflow_run_id: run.id },
      streamState: "completed",
    },
  ]
}
