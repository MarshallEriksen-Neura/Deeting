import { fireEvent, render, screen } from "@testing-library/react"
import ExecutionLifecycleView from "@/components/views/execution-lifecycle-view"

const openView = jest.fn()
const rerunPhase = jest.fn()
const getConversationExecutionTree = jest.fn()
const toastSuccess = jest.fn()
const toastError = jest.fn()

jest.mock("@/store/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: { openView: typeof openView }) => unknown) =>
    selector({ openView }),
}))

jest.mock("@/lib/workflow/commands", () => ({
  rerunPhase: (...args: unknown[]) => rerunPhase(...args),
}))

jest.mock("@/lib/api/conversations", () => ({
  getConversationExecutionTree: (...args: unknown[]) => getConversationExecutionTree(...args),
}))

jest.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

describe("ExecutionLifecycleView", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    openView.mockReset()
    rerunPhase.mockReset()
    getConversationExecutionTree.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
  })

  it("renders delegated execution summary fields", () => {
    render(
      <ExecutionLifecycleView
        data={{
          execution_id: "exec-123",
          execution_kind: "workflow",
          execution_status: "integrated",
          terminal_status: "succeeded",
          target: {
            name: "Research Worker",
            invocation_kind: "chat",
            worker_ref: "user_worker_profile:researcher",
            workflow_run_id: "run-123",
          },
          selection: {
            score: 92,
            reason_text: "tag_match,semantic_rank",
          },
          available_actions: [{ kind: "open" }],
          summary: "Compiled and executed a one-phase workflow.",
          children: [
            {
              id: "step-1",
              phase_id: "phase-1",
              step_type: "worker_call",
              title: "Execute",
              status: "succeeded",
              worker_ref: "user_worker_profile:researcher",
              summary: "Produced the delegated result.",
              available_actions: [{ kind: "open" }, { kind: "view_context" }],
            },
          ],
        }}
      />
    )

    expect(screen.getByText("Research Worker")).toBeInTheDocument()
    expect(screen.getByText("Reason: tag_match,semantic_rank")).toBeInTheDocument()
    expect(screen.getByText("Selection score: 92")).toBeInTheDocument()
    expect(
      screen.getByText("Compiled and executed a one-phase workflow.")
    ).toBeInTheDocument()
    expect(screen.getByText("Child Executions")).toBeInTheDocument()
    expect(screen.getByText("Execute")).toBeInTheDocument()
    expect(screen.getByText("Phase: phase-1")).toBeInTheDocument()
    expect(screen.getByText("Type: worker_call")).toBeInTheDocument()
    expect(
      screen.getByText("Worker: user_worker_profile:researcher")
    ).toBeInTheDocument()
    expect(screen.getByText("Produced the delegated result.")).toBeInTheDocument()
    expect(screen.getByText("Workflow run: run-123")).toBeInTheDocument()
    expect(screen.getByText("Execution id: exec-123")).toBeInTheDocument()
  })

  it("opens the workflow canvas for a child execution", () => {
    render(
      <ExecutionLifecycleView
        data={{
          execution_id: "exec-123",
          execution_kind: "workflow",
          execution_status: "integrated",
          target: {
            name: "Research Worker",
            workflow_run_id: "run-123",
          },
          available_actions: [{ kind: "open" }],
          children: [
            {
              phase_id: "phase-1",
              title: "Execute",
              status: "succeeded",
              available_actions: [{ kind: "open" }],
            },
          ],
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Open" }))

    expect(openView).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "workflow-run-123",
        type: "native-canvas",
        content: expect.objectContaining({
          viewType: "workflow",
          runId: "run-123",
          phaseId: "phase-1",
        }),
      })
    )
  })

  it("opens the workflow canvas in context mode for a succeeded child execution", () => {
    render(
      <ExecutionLifecycleView
        data={{
          execution_id: "exec-123",
          execution_kind: "workflow",
          execution_status: "integrated",
          target: {
            name: "Research Worker",
            workflow_run_id: "run-123",
          },
          available_actions: [{ kind: "open" }],
          children: [
            {
              phase_id: "phase-1",
              title: "Execute",
              status: "succeeded",
              available_actions: [{ kind: "open" }, { kind: "view_context" }],
            },
          ],
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "View context" }))

    expect(openView).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "workflow-run-123",
        type: "native-canvas",
        content: expect.objectContaining({
          viewType: "workflow",
          runId: "run-123",
          phaseId: "phase-1",
          contextPhaseId: "phase-1",
        }),
      })
    )
  })

  it("reruns a failed workflow child and opens the workflow", async () => {
    rerunPhase.mockResolvedValue({ id: "run-123" })

    render(
      <ExecutionLifecycleView
        data={{
          execution_id: "exec-123",
          execution_kind: "workflow",
          execution_status: "integrated",
          target: {
            name: "Research Worker",
            workflow_run_id: "run-123",
          },
          available_actions: [{ kind: "open" }],
          children: [
            {
              phase_id: "phase-2",
              title: "Retry phase",
              status: "failed",
              available_actions: [{ kind: "open" }, { kind: "rerun" }],
            },
          ],
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Rerun" }))

    expect(rerunPhase).toHaveBeenCalledWith({
      run_id: "run-123",
      phase_id: "phase-2",
    })
  })

  it("renders child execution rows for a single delegated worker", () => {
    render(
      <ExecutionLifecycleView
        data={{
          execution_id: "exec-worker-1",
          execution_kind: "custom_task_agent",
          execution_status: "succeeded",
          target: {
            name: "Image Worker",
          },
          result_payload: {
            render_blocks: [
              {
                view_type: "image.result",
                title: "Image Result",
                payload: {
                  outputs: [{ source_url: "local-asset://abc" }],
                },
              },
            ],
          },
          children: [
            {
              id: "exec-worker-1:primary",
              step_type: "worker_call",
              title: "Image Worker",
              status: "succeeded",
              worker_ref: "user_worker_profile:image-worker",
              summary: "Generated the requested image result.",
              available_actions: [{ kind: "view_result" }],
            },
          ],
        }}
      />
    )

    expect(screen.getByText("Child Executions")).toBeInTheDocument()
    expect(screen.getAllByText("Image Worker")).toHaveLength(2)
    expect(screen.getByText("Type: worker_call")).toBeInTheDocument()
    expect(
      screen.getByText("Worker: user_worker_profile:image-worker")
    ).toBeInTheDocument()
    expect(
      screen.getByText("Generated the requested image result.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "View result" })).toBeInTheDocument()
  })

  it("opens a workspace result view for single-worker render output", () => {
    render(
      <ExecutionLifecycleView
        data={{
          execution_id: "exec-worker-1",
          execution_kind: "custom_task_agent",
          execution_status: "succeeded",
          target: {
            name: "Image Worker",
          },
          result_payload: {
            render_blocks: [
              {
                view_type: "image.result",
                title: "Image Result",
                payload: {
                  outputs: [{ source_url: "local-asset://abc" }],
                },
              },
            ],
          },
          children: [
            {
              id: "exec-worker-1:primary",
              step_type: "worker_call",
              title: "Image Worker",
              status: "succeeded",
              available_actions: [{ kind: "view_result" }],
            },
          ],
        }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "View result" }))

    expect(openView).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "execution-result-exec-worker-1",
        type: "native-canvas",
        content: expect.objectContaining({
          viewType: "image.result",
          title: "Image Result",
          payload: {
            outputs: [{ source_url: "local-asset://abc" }],
          },
        }),
      })
    )
  })

  it("does not render workflow action buttons when available_actions are absent", () => {
    render(
      <ExecutionLifecycleView
        data={{
          execution_id: "exec-123",
          execution_kind: "workflow",
          execution_status: "integrated",
          target: {
            name: "Research Worker",
            workflow_run_id: "run-123",
          },
          available_actions: [],
          children: [
            {
              phase_id: "phase-1",
              title: "Execute",
              status: "succeeded",
              available_actions: [],
            },
          ],
        }}
      />
    )

    expect(screen.queryByRole("button", { name: "Open workflow" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull()
    expect(screen.queryByRole("button", { name: "View context" })).toBeNull()
  })

  it("hydrates the latest persisted execution tree in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    ;(globalThis as any).__TAURI_INTERNALS__ = {}
    getConversationExecutionTree.mockResolvedValue({
      root: {
        root_execution_id: "exec-123",
        session_id: "session-1",
        message_id: "msg-1",
        turn_index: 2,
        schema_version: 1,
        execution_id: "exec-123",
        execution_kind: "workflow",
        execution_status: "integrated",
        terminal_status: "succeeded",
        target_id: "worker-1",
        target_name: "Hydrated Worker",
        target_invocation_kind: "chat",
        target_worker_ref: "user_worker_profile:hydrated",
        target_workflow_run_id: "run-999",
        selection: null,
        available_actions: [{ kind: "open" }],
        summary: "Hydrated summary",
        error: null,
        result_payload: null,
        raw_json: null,
        started_at_ms: 1,
        completed_at_ms: 2,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:01Z",
      },
      children: [],
    })

    render(
      <ExecutionLifecycleView
        data={{
          root_execution_id: "exec-123",
          execution_id: "exec-123",
          execution_kind: "workflow",
          execution_status: "running",
          target: {
            name: "Stale Worker",
          },
        }}
      />
    )

    expect(await screen.findByText("Hydrated Worker")).toBeInTheDocument()
    expect(screen.getByText("Hydrated summary")).toBeInTheDocument()
    expect(getConversationExecutionTree).toHaveBeenCalledWith("exec-123")

    delete (globalThis as any).__TAURI_INTERNALS__
  })
})
