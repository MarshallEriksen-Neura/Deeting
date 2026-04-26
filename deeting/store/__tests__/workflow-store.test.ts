import { useWorkflowStore } from "../workflow-store"
import type { WorkflowRun, WorkflowRunDetail, WorkflowStepRun } from "@/lib/workflow/types"

function makeRun(status: WorkflowRun["status"]): WorkflowRun {
  return {
    id: "run-1",
    title: "Workflow",
    goal: "Produce a result",
    status,
    proposal_text: null,
    snapshot_json: {
      run_id: "run-1",
      proposal_version: 1,
      snapshot_version: 1,
      compiled_at: "2026-04-26T00:00:00Z",
      goal: "Produce a result",
      phases: [
        {
          phase_id: "phase-1",
          title: "Phase one",
          worker_ref: "direct_llm:default",
          depends_on: [],
          goal: "First phase",
          expected_output: null,
        },
        {
          phase_id: "phase-2",
          title: "Phase two",
          worker_ref: "direct_llm:default",
          depends_on: ["phase-1"],
          goal: "Second phase",
          expected_output: null,
        },
      ],
      policy: {
        allow_auto_suffix_replan: false,
        default_timeout_ms: 30000,
      },
    },
    proposal_version: 1,
    snapshot_version: 1,
    run_dir: null,
    error: status === "failed" ? "Workflow failed" : null,
    created_at: "2026-04-26T00:00:00Z",
    updated_at: "2026-04-26T00:00:00Z",
  }
}

function makeStep(overrides: Partial<WorkflowStepRun>): WorkflowStepRun {
  return {
    id: overrides.id ?? `${overrides.phase_id ?? "phase"}-step`,
    run_id: "run-1",
    phase_id: overrides.phase_id ?? "phase-1",
    phase_index: overrides.phase_index ?? 0,
    step_type: overrides.step_type ?? "worker_call",
    title: overrides.title ?? "Phase",
    status: overrides.status ?? "pending",
    worker_ref: "direct_llm:default",
    goal: overrides.goal ?? "Do work",
    input_snapshot: null,
    output_artifact_refs: overrides.output_artifact_refs ?? [],
    worker_trace_summary: overrides.worker_trace_summary ?? null,
    retry_count: 0,
    error: overrides.error ?? null,
    started_at: overrides.started_at ?? null,
    completed_at: overrides.completed_at ?? null,
    created_at: "2026-04-26T00:00:00Z",
    updated_at: "2026-04-26T00:00:00Z",
  }
}

function makeDetail(status: WorkflowRun["status"], steps: WorkflowStepRun[]): WorkflowRunDetail {
  return {
    run: makeRun(status),
    steps,
    events: [],
  }
}

describe("useWorkflowStore result focus", () => {
  beforeEach(() => {
    sessionStorage.clear()
    useWorkflowStore.getState().reset()
  })

  it("focuses and expands the last succeeded phase when a workflow completes", () => {
    useWorkflowStore.getState().setRunDetail(
      makeDetail("completed", [
        makeStep({ phase_id: "phase-1", phase_index: 0, status: "succeeded" }),
        makeStep({
          phase_id: "phase-2",
          phase_index: 1,
          status: "succeeded",
          worker_trace_summary: "Final answer",
          output_artifact_refs: ["phase-2/result.md"],
        }),
      ]),
    )

    const state = useWorkflowStore.getState()
    expect(state.view).toBe("execution")
    expect(state.resultFocusPhaseId).toBe("phase-2")
    expect(state.failureFocusPhaseId).toBeNull()
    expect(state.expandedPhaseIds.has("phase-2")).toBe(true)
  })

  it("focuses and expands the failed phase when a workflow fails", () => {
    useWorkflowStore.getState().setRunDetail(
      makeDetail("failed", [
        makeStep({ phase_id: "phase-1", phase_index: 0, status: "succeeded" }),
        makeStep({
          phase_id: "phase-2",
          phase_index: 1,
          status: "failed",
          error: "Phase failed",
        }),
      ]),
    )

    const state = useWorkflowStore.getState()
    expect(state.activePhaseId).toBe("phase-2")
    expect(state.resultFocusPhaseId).toBeNull()
    expect(state.failureFocusPhaseId).toBe("phase-2")
    expect(state.expandedPhaseIds.has("phase-2")).toBe(true)
  })

  it("keeps approval phases active without treating them as final results", () => {
    useWorkflowStore.getState().setRunDetail(
      makeDetail("waiting_approval", [
        makeStep({ phase_id: "phase-1", phase_index: 0, status: "succeeded" }),
        makeStep({
          phase_id: "phase-2",
          phase_index: 1,
          status: "waiting_approval",
          step_type: "approval_gate",
        }),
      ]),
    )

    const state = useWorkflowStore.getState()
    expect(state.activePhaseId).toBe("phase-2")
    expect(state.resultFocusPhaseId).toBeNull()
    expect(state.failureFocusPhaseId).toBeNull()
    expect(state.approvalPending).toBe(true)
  })

  it("tracks a failed progress event before the next detail snapshot arrives", () => {
    useWorkflowStore.getState().setRunDetail(
      makeDetail("running", [
        makeStep({ phase_id: "phase-1", phase_index: 0, status: "running" }),
      ]),
    )

    useWorkflowStore.getState().applyProgress({
      run_id: "run-1",
      phase_id: "phase-1",
      phase_title: "Phase one",
      phase_index: 0,
      total_phases: 1,
      status: "failed",
    })

    const state = useWorkflowStore.getState()
    expect(state.activePhaseId).toBe("phase-1")
    expect(state.failureFocusPhaseId).toBe("phase-1")
    expect(state.expandedPhaseIds.has("phase-1")).toBe(true)
  })
})
