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
  }: {
    initialGoal?: string
    initialRunId?: string
  }) => (
    <div data-testid="workflow-runtime">
      {JSON.stringify({ initialGoal, initialRunId })}
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
      },
    }

    render(<NativeCanvasRenderer view={view} />)

    expect(screen.getByTestId("workflow-runtime")).toHaveTextContent(
      JSON.stringify({ initialGoal: "Ship the fix", initialRunId: "run-123" })
    )
  })
})
