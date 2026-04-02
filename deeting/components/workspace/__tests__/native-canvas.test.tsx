import { render, screen } from "@testing-library/react"
import type { NativeCanvasView } from "@/store/workspace-store"
import { NativeCanvasRenderer } from "@/components/workspace/native-canvas"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (_key: string) => "workspace",
}))

jest.mock("@/components/workflow/workflow-runtime", () => ({
  WorkflowRuntime: ({
    initialGoal,
    initialRunId,
    initialPhaseId,
    initialContextPhaseId,
  }: {
    initialGoal?: string
    initialRunId?: string
    initialPhaseId?: string
    initialContextPhaseId?: string
  }) => (
    <div data-testid="workflow-runtime">
      {JSON.stringify({ initialGoal, initialRunId, initialPhaseId, initialContextPhaseId })}
    </div>
  ),
}))

jest.mock("@/components/views/view-block", () => ({
  __esModule: true,
  default: ({
    viewType,
    payload,
    title,
  }: {
    viewType: string
    payload: unknown
    title?: string
  }) => (
    <div data-testid="generic-view-block">
      {JSON.stringify({ viewType, payload, title })}
    </div>
  ),
}))

describe("NativeCanvasRenderer", () => {
  it("passes the workflow goal and run id into WorkflowRuntime", () => {
    const view: NativeCanvasView = {
      id: "workflow-run-1",
      type: "native-canvas",
      title: "Workflow",
      lastActiveAt: Date.now(),
      content: {
        viewType: "workflow",
        goal: "Ship the fix",
        runId: "run-123",
        phaseId: "phase-2",
        contextPhaseId: "phase-2",
      },
    }

    render(<NativeCanvasRenderer view={view} />)

    expect(screen.getByTestId("workflow-runtime")).toHaveTextContent(
      JSON.stringify({
        initialGoal: "Ship the fix",
        initialRunId: "run-123",
        initialPhaseId: "phase-2",
        initialContextPhaseId: "phase-2",
      })
    )
  })

  it("renders a generic native view block for non-workflow content", () => {
    const view: NativeCanvasView = {
      id: "image-result-1",
      type: "native-canvas",
      title: "Image Result",
      lastActiveAt: Date.now(),
      content: {
        viewType: "image.result",
        title: "Preview",
        payload: {
          outputs: [{ source_url: "local-asset://abc" }],
        },
      },
    }

    render(<NativeCanvasRenderer view={view} />)

    expect(screen.getByTestId("generic-view-block")).toHaveTextContent(
      JSON.stringify({
        viewType: "image.result",
        payload: {
          outputs: [{ source_url: "local-asset://abc" }],
        },
        title: "Preview",
      })
    )
  })
})
