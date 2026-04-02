import { render, waitFor } from "@testing-library/react"
import { WorkflowRuntime } from "@/components/workflow/workflow-runtime"

const getWorkflowRunStatus = jest.fn()
const getWorkflowPhaseContext = jest.fn()

const workflowStore = {
  runId: null,
  run: null,
  steps: [],
  events: [],
  view: "landing" as const,
  loading: false,
  error: null,
  compileErrors: [],
  editedProposal: null,
  proposalDirty: false,
  activePhaseId: null,
  expandedPhaseIds: new Set<string>(),
  approvalPending: false,
  contextViewerPhaseId: null,
  reset: jest.fn(),
  setRun: jest.fn(),
  setRunDetail: jest.fn(),
  setView: jest.fn(),
  setLoading: jest.fn(),
  setError: jest.fn(),
  setCompileErrors: jest.fn(),
  setEditedProposal: jest.fn(),
  markProposalClean: jest.fn(),
  applyProgress: jest.fn(),
  setActivePhaseId: jest.fn(),
  togglePhaseExpanded: jest.fn(),
  setApprovalPending: jest.fn(),
  openContextViewer: jest.fn(),
  closeContextViewer: jest.fn(),
  currentPhaseIndex: jest.fn(() => -1),
  totalPhases: jest.fn(() => 0),
  progressPercent: jest.fn(() => 0),
  isRunning: jest.fn(() => false),
  isPaused: jest.fn(() => false),
}

jest.mock("@/store/workflow-store", () => ({
  useWorkflowStore: () => workflowStore,
}))

jest.mock("@/lib/workflow/commands", () => ({
  generateWorkflowProposal: jest.fn(),
  updateWorkflowProposal: jest.fn(),
  compileWorkflowProposal: jest.fn(),
  startWorkflowRun: jest.fn(),
  regenerateWorkflowProposal: jest.fn(),
  getWorkflowRunStatus: (...args: unknown[]) => getWorkflowRunStatus(...args),
  getWorkflowPhaseContext: (...args: unknown[]) => getWorkflowPhaseContext(...args),
  approveWorkflow: jest.fn(),
  rerunPhase: jest.fn(),
}))

jest.mock("@/components/workflow/workflow-landing", () => ({
  WorkflowLanding: () => <div data-testid="workflow-landing" />,
}))

jest.mock("@/components/workflow/plan-editor", () => ({
  PlanEditor: () => <div data-testid="plan-editor" />,
}))

jest.mock("@/components/workflow/workflow-execution", () => ({
  WorkflowExecution: () => <div data-testid="workflow-execution" />,
}))

jest.mock("@/components/workflow/approval-gate", () => ({
  ApprovalGate: () => <div data-testid="approval-gate" />,
}))

jest.mock("@/components/workflow/phase-context-viewer", () => ({
  PhaseContextViewer: () => null,
}))

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}))

describe("WorkflowRuntime", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    workflowStore.runId = null
    workflowStore.run = null
    workflowStore.view = "landing"
    getWorkflowRunStatus.mockResolvedValue({
      run: { id: "run-123", status: "running", error: null },
      steps: [],
      events: [],
    })
    getWorkflowPhaseContext.mockResolvedValue({
      run_id: "run-123",
      phase_id: "phase-1",
      phase_title: "Execute",
      context_md: "context",
      context_json: { worker_ref: "direct_llm:default" },
    })
  })

  it("hydrates an existing run when initialRunId is provided", async () => {
    render(<WorkflowRuntime initialRunId="run-123" />)

    await waitFor(() => {
      expect(getWorkflowRunStatus).toHaveBeenCalledWith("run-123")
    })

    await waitFor(() => {
      expect(workflowStore.setRunDetail).toHaveBeenCalled()
    })
  })

  it("loads phase context when initialContextPhaseId is provided", async () => {
    workflowStore.runId = "run-123"

    render(
      <WorkflowRuntime
        initialRunId="run-123"
        initialContextPhaseId="phase-1"
      />
    )

    await waitFor(() => {
      expect(getWorkflowPhaseContext).toHaveBeenCalledWith("run-123", "phase-1")
    })

    await waitFor(() => {
      expect(workflowStore.openContextViewer).toHaveBeenCalledWith("phase-1")
    })
  })
})
