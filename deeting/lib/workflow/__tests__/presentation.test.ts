import {
  buildWorkflowReceiptBlocks,
  buildWorkflowResultPayload,
  findWorkflowResultStep,
  isWorkflowTerminal,
} from "../presentation"
import type { WorkflowRun, WorkflowStepRun } from "../types"

function makeRun(status: WorkflowRun["status"]): WorkflowRun {
  return {
    id: "run-productized",
    title: "Market report",
    goal: "Create a market report",
    status,
    proposal_text: null,
    snapshot_json: {
      run_id: "run-productized",
      proposal_version: 1,
      snapshot_version: 1,
      compiled_at: "2026-04-26T00:00:00Z",
      goal: "Create a market report",
      phases: [],
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
    id: overrides.id ?? `${overrides.phase_id}-step`,
    run_id: "run-productized",
    phase_id: overrides.phase_id ?? "phase-1",
    phase_index: overrides.phase_index ?? 0,
    step_type: "worker_call",
    title: overrides.title ?? "Phase",
    status: overrides.status ?? "pending",
    worker_ref: "direct_llm:default",
    goal: "Do work",
    input_snapshot: null,
    output_artifact_refs: overrides.output_artifact_refs ?? [],
    worker_trace_summary: overrides.worker_trace_summary ?? null,
    retry_count: 0,
    error: overrides.error ?? null,
    started_at: null,
    completed_at: null,
    created_at: "2026-04-26T00:00:00Z",
    updated_at: "2026-04-26T00:00:00Z",
  }
}

describe("workflow presentation helpers", () => {
  it("treats completed, failed, cancelled, and awaiting edit as terminal UX states", () => {
    expect(isWorkflowTerminal("completed")).toBe(true)
    expect(isWorkflowTerminal("failed")).toBe(true)
    expect(isWorkflowTerminal("cancelled")).toBe(true)
    expect(isWorkflowTerminal("awaiting_plan_edit")).toBe(true)
    expect(isWorkflowTerminal("running")).toBe(false)
  })

  it("builds a result payload from the last successful phase", () => {
    const run = makeRun("completed")
    const steps = [
      makeStep({ phase_id: "phase-1", phase_index: 0, status: "succeeded" }),
      makeStep({
        phase_id: "phase-2",
        phase_index: 1,
        title: "Final report",
        status: "succeeded",
        worker_trace_summary: "The final report is ready.",
        output_artifact_refs: ["phase-2/result.md", "phase-2/result.json", "phase-2/metrics.json"],
      }),
    ]

    expect(findWorkflowResultStep(run, steps)?.phase_id).toBe("phase-2")

    const payload = buildWorkflowResultPayload(run, steps)
    expect(payload.focus_phase_id).toBe("phase-2")
    expect(payload.summary).toBe("The final report is ready.")
    expect(payload.artifacts).toEqual([
      { ref: "phase-2/result.md", kind: "markdown", label: "result.md" },
      { ref: "phase-2/metrics.json", kind: "json", label: "metrics.json" },
    ])
    expect(payload.steps[1].artifacts).toEqual(payload.artifacts)
  })

  it("builds a recovery payload from the failed phase", () => {
    const payload = buildWorkflowResultPayload(makeRun("failed"), [
      makeStep({ phase_id: "phase-1", phase_index: 0, status: "succeeded" }),
      makeStep({
        phase_id: "phase-2",
        phase_index: 1,
        status: "failed",
        error: "Data source unavailable",
      }),
    ])

    expect(payload.focus_phase_id).toBe("phase-2")
    expect(payload.error).toBe("Data source unavailable")
    expect(payload.preserved_success_count).toBe(1)
  })

  it("creates a compact chat receipt without duplicating result text", () => {
    const blocks = buildWorkflowReceiptBlocks(makeRun("completed"), [
      makeStep({
        phase_id: "phase-1",
        phase_index: 0,
        status: "succeeded",
        worker_trace_summary: "Done",
      }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: "ui",
      viewType: "workflow.result",
      payload: expect.objectContaining({
        run_id: "run-productized",
        status: "completed",
        summary: "Done",
      }),
    })
  })
})
