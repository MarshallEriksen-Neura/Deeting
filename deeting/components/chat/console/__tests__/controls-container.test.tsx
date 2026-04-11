import "@testing-library/jest-dom"
import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import ControlsContainer from "@/components/chat/console/controls-container"
import { useChatStore } from "@/store/chat-store"
import { useChatRuntimeStore } from "@/store/chat-runtime-store"
import { useBrowserModeStore } from "@/store/browser-mode-store"
import { useWorkspaceStore } from "@/store/workspace-store"
import { useChatMessaging } from "@/hooks/chat/use-chat-messaging"
import { getLocalBrowserAgentPageSnapshot } from "@/lib/api/browser-agent"
import { recoverDesktopLocalChatExecution } from "@/lib/api/mcp-desktop"
import { generateWorkflowProposal } from "@/lib/workflow/commands"
import type { WorkflowRun } from "@/lib/workflow/types"
import {
  listCustomTaskAgents,
  type CustomTaskAgentProfile,
} from "@/lib/api/custom-task-agents"
import type { BrowserAgentPageSnapshot } from "@/lib/api/browser-agent"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(""),
}))

jest.mock("@/i18n/routing", () => ({
  Link: ({
    children,
    scroll,
    ...props
  }: React.PropsWithChildren<Record<string, unknown> & { scroll?: unknown }>) => {
    void scroll
    return <a {...props}>{children}</a>
  },
}))

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/hooks/chat/use-chat-messaging", () => ({
  useChatMessaging: jest.fn(),
}))

jest.mock("@/lib/api/browser-agent", () => ({
  getLocalBrowserAgentPageSnapshot: jest.fn(),
}))

jest.mock("@/lib/api/mcp-desktop", () => ({
  recoverDesktopLocalChatExecution: jest.fn(),
}))

jest.mock("@/lib/api/custom-task-agents", () => ({
  listCustomTaskAgents: jest.fn().mockResolvedValue([]),
}))

jest.mock("@/lib/workflow/commands", () => ({
  generateWorkflowProposal: jest.fn(),
}))

jest.mock("@/hooks/use-open-workflow", () => ({
  useOpenWorkflow: () => mockOpenWorkflow,
}))

const mockOpenWorkflow = jest.fn()
const mockGenerateWorkflowProposal =
  generateWorkflowProposal as jest.MockedFunction<typeof generateWorkflowProposal>
const mockListCustomTaskAgents =
  listCustomTaskAgents as jest.MockedFunction<typeof listCustomTaskAgents>
const mockUseChatMessaging = useChatMessaging as jest.MockedFunction<
  typeof useChatMessaging
>
const mockGetLocalBrowserAgentPageSnapshot =
  getLocalBrowserAgentPageSnapshot as jest.MockedFunction<
    typeof getLocalBrowserAgentPageSnapshot
  >
const mockRecoverDesktopLocalChatExecution =
  recoverDesktopLocalChatExecution as jest.MockedFunction<
    typeof recoverDesktopLocalChatExecution
  >

const createPendingTaskAgentsPromise = () =>
  new Promise<CustomTaskAgentProfile[]>(() => {})

const buildMessagingMock = (
  overrides: Partial<ReturnType<typeof useChatMessaging>> = {}
): ReturnType<typeof useChatMessaging> => ({
  handleSendMessage: jest.fn(),
  hasContent: false,
  isLoading: false,
  errorMessage: null,
  pendingTakeover: null,
  pendingTakeoverRequestedAction: null,
  queuePendingTakeoverFromCurrentDraft: jest.fn(),
  stopAndSendPendingTakeover: jest.fn(),
  markPendingTakeoverForDeferredSend: jest.fn(),
  cancelPendingTakeover: jest.fn(),
  cancelActiveRequest: jest.fn(),
  regenerateMessage: jest.fn(),
  hasInterruptedGeneration: false,
  continueInterruptedGeneration: jest.fn(),
  ...overrides,
})

const buildWorkflowRun = (id: string, goal = ""): WorkflowRun => ({
  id,
  title: `Workflow ${id}`,
  goal,
  status: "draft",
  proposal_text: null,
  snapshot_json: null,
  proposal_version: 1,
  snapshot_version: 1,
  run_dir: null,
  error: null,
  created_at: "2026-04-11T00:00:00.000Z",
  updated_at: "2026-04-11T00:00:00.000Z",
})

const buildCustomTaskAgentProfile = (
  overrides: Partial<CustomTaskAgentProfile> = {}
): CustomTaskAgentProfile => ({
  id: "agent-default",
  name: "Default Agent",
  description: null,
  task_prompt: "Handle the assigned task.",
  invocation_kind: "chat",
  preferred_for_image_generation: false,
  model_config: null,
  callable_mcp_tool_ids: [],
  guidance_skill_ids: [],
  callable_skill_action_refs: [],
  bound_asset_id: null,
  tags: [],
  discoverable: true,
  is_enabled: true,
  is_deleted: false,
  source_kind: null,
  source_path: null,
  source_repo: null,
  source_ref: null,
  source_hash: null,
  created_at: "2026-04-11T00:00:00.000Z",
  updated_at: "2026-04-11T00:00:00.000Z",
  ...overrides,
})

const buildBrowserAgentPageSnapshot = (
  overrides: Partial<BrowserAgentPageSnapshot> = {}
): BrowserAgentPageSnapshot => ({
  url: "https://example.com",
  title: "Example",
  documentReadyState: "complete",
  visibleText: "",
  mainText: "",
  headings: [],
  links: [],
  buttons: [],
  inputs: [],
  forms: [],
  ...overrides,
})

const enableTauriRuntime = () => {
  process.env.NEXT_PUBLIC_IS_TAURI = "true"
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: {},
  })
}


describe("ControlsContainer", () => {
  let messagingMock: ReturnType<typeof useChatMessaging>

  beforeEach(() => {
    mockUseChatMessaging.mockReset()
    mockOpenWorkflow.mockReset()
    mockGenerateWorkflowProposal.mockReset()
    mockListCustomTaskAgents.mockReset()
    mockListCustomTaskAgents.mockReturnValue(createPendingTaskAgentsPromise())
    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    useChatStore.setState({
      sessionId: null,
      input: "",
      attachments: [],
      messages: [],
      isLoading: false,
      models: [{ id: "model-1", provider_model_id: "model-1" }],
      selectedAssistant: null,
    })
    useChatRuntimeStore.setState({
      isLoading: false,
      globalLoading: false,
      statusCode: null,
      statusStage: null,
      statusMeta: null,
      activeMessageId: null,
      interruptedMessageId: null,
    })
    useBrowserModeStore.getState().reset()
    useWorkspaceStore.getState().closeAll()
    mockGetLocalBrowserAgentPageSnapshot.mockReset()
    mockRecoverDesktopLocalChatExecution.mockReset()
    mockRecoverDesktopLocalChatExecution.mockResolvedValue({ status: "ok" } as never)

    messagingMock = buildMessagingMock()
    mockUseChatMessaging.mockReturnValue(messagingMock)
  })

  it("should hide assistant selector on web", () => {
    render(<ControlsContainer />)
    expect(screen.queryByLabelText("routing.override")).toBeNull()
  })

  it("does not render orchestration controls on web", () => {
    render(<ControlsContainer />)

    expect(screen.queryByLabelText("controls.modeChat")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("controls.modeWorkflow")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("controls.generatePlan")).not.toBeInTheDocument()
  })

  it("renders desktop mode toggles without the old fixed persona pill", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: {},
    })

    render(<ControlsContainer />)

    expect(screen.getByLabelText("controls.modeChat")).toBeInTheDocument()
    expect(screen.getByLabelText("controls.modeWorkflow")).toBeInTheDocument()
    expect(screen.getByLabelText("controls.generatePlan")).toBeInTheDocument()
    expect(screen.queryByText("routing.persona")).not.toBeInTheDocument()
    expect(screen.queryByText("routing.personaDesc")).not.toBeInTheDocument()
  })

  it("hides the old standalone image shortcut from the chat controls", () => {
    render(<ControlsContainer />)

    expect(screen.queryByLabelText("controls.menu")).not.toBeInTheDocument()
    expect(screen.queryByText("controls.image")).not.toBeInTheDocument()
  })

  it("shows continue button and triggers continue callback after interruption", () => {
    const continueInterruptedGeneration = jest.fn()
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      hasInterruptedGeneration: true,
      continueInterruptedGeneration,
    }))

    render(<ControlsContainer />)

    const continueButton = screen.getByLabelText("controls.continue")
    expect(continueButton).toBeEnabled()
    fireEvent.click(continueButton)

    expect(continueInterruptedGeneration).toHaveBeenCalledTimes(1)
  })

  it("renders the pending takeover bar and dispatches its actions", () => {
    const stopAndSendPendingTakeover = jest.fn()
    const markPendingTakeoverForDeferredSend = jest.fn()
    const cancelPendingTakeover = jest.fn()
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      pendingTakeover: {
        input: "follow-up prompt",
        attachments: [],
        selectedKnowledgeFileIds: ["doc-1"],
        createdAt: 1,
        updatedAt: 1,
      },
      stopAndSendPendingTakeover,
      markPendingTakeoverForDeferredSend,
      cancelPendingTakeover,
    }))

    render(<ControlsContainer />)

    expect(screen.getByText("takeover.title")).toBeInTheDocument()
    expect(screen.getByText("follow-up prompt")).toBeInTheDocument()

    fireEvent.click(screen.getByText("takeover.actions.immediateStop"))
    fireEvent.click(screen.getByText("takeover.actions.sendAfterStep"))
    fireEvent.click(screen.getByLabelText("takeover.actions.cancel"))

    expect(stopAndSendPendingTakeover).toHaveBeenCalledTimes(1)
    expect(markPendingTakeoverForDeferredSend).toHaveBeenCalledTimes(1)
    expect(cancelPendingTakeover).toHaveBeenCalledTimes(1)
  })

  it("renders the recovery action bar above the composer and wires its actions", () => {
    const regenerateMessage = jest.fn()
    const continueInterruptedGeneration = jest.fn()
    useChatStore.setState({
      messages: [
        {
          id: "assistant-recovery",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          metaInfo: {
            recovery: {
              execution_id: "exec-recovery-1",
              stage: "tool_running_interrupted",
              available_actions: ["continue", "retry", "abandon"],
            },
          },
        },
      ],
    })
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      regenerateMessage,
      continueInterruptedGeneration,
    }))

    render(<ControlsContainer />)

    expect(screen.getByText("controls.recovery.title")).toBeInTheDocument()
    expect(
      screen.getByText("controls.recovery.description.toolRunningInterrupted")
    ).toBeInTheDocument()
    expect(screen.getByText("exec-recovery-1")).toBeInTheDocument()

    fireEvent.click(screen.getByText("controls.recovery.actions.continue"))
    expect(regenerateMessage).toHaveBeenCalledWith("assistant-recovery")
    expect(continueInterruptedGeneration).not.toHaveBeenCalled()
  })

  it("routes resume-failed recovery continue through the desktop recovery command", async () => {
    const regenerateMessage = jest.fn()
    const loadHistory = jest.fn().mockResolvedValue(undefined)
    useChatStore.setState({
      sessionId: "session-recovery-1",
      loadHistory,
      messages: [
        {
          id: "assistant-recovery-resume-failed",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          metaInfo: {
            recovery: {
              execution_id: "exec-recovery-continue-1",
              stage: "resume_failed",
              available_actions: ["continue", "retry", "abandon"],
            },
          },
        },
      ],
    })
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      regenerateMessage,
    }))

    render(<ControlsContainer />)

    fireEvent.click(screen.getByText("controls.recovery.actions.continue"))

    await waitFor(() => {
      expect(mockRecoverDesktopLocalChatExecution).toHaveBeenCalledWith({
        executionGraphExecutionId: "exec-recovery-continue-1",
        action: "continue",
      })
    })
    expect(loadHistory).toHaveBeenCalledWith("session-recovery-1")
    expect(regenerateMessage).not.toHaveBeenCalled()
  })

  it("routes resume-failed recovery retry through the desktop recovery command", async () => {
    const regenerateMessage = jest.fn()
    const loadHistory = jest.fn().mockResolvedValue(undefined)
    useChatStore.setState({
      sessionId: "session-recovery-2",
      loadHistory,
      messages: [
        {
          id: "assistant-recovery-retry",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          metaInfo: {
            recovery: {
              execution_id: "exec-recovery-retry-1",
              stage: "resuming_after_approval",
              available_actions: ["continue", "retry", "abandon"],
            },
          },
        },
      ],
    })
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      regenerateMessage,
    }))

    render(<ControlsContainer />)

    fireEvent.click(screen.getByText("controls.recovery.actions.retry"))

    await waitFor(() => {
      expect(mockRecoverDesktopLocalChatExecution).toHaveBeenCalledWith({
        executionGraphExecutionId: "exec-recovery-retry-1",
        action: "retry",
      })
    })
    expect(loadHistory).toHaveBeenCalledWith("session-recovery-2")
    expect(regenerateMessage).not.toHaveBeenCalled()
  })

  it("dismisses the recovery action bar when abandon is pressed", async () => {
    useChatStore.setState({
      sessionId: null,
      messages: [
        {
          id: "assistant-recovery-dismiss",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          metaInfo: {
            recovery: {
              execution_id: "exec-recovery-2",
              stage: "delegated_workflow_running",
              available_actions: ["continue", "retry", "abandon"],
            },
          },
        },
      ],
    })

    render(<ControlsContainer />)

    fireEvent.click(screen.getByText("controls.recovery.actions.abandon"))

    await waitFor(() => {
      expect(screen.queryByText("controls.recovery.title")).not.toBeInTheDocument()
    })
  })

  it("routes abandon through the desktop recovery command when canonical recovery has an execution id", async () => {
    const loadHistory = jest.fn().mockResolvedValue(undefined)
    useChatStore.setState({
      sessionId: "session-recovery-3",
      loadHistory,
      messages: [
        {
          id: "assistant-recovery-abandon",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          metaInfo: {
            recovery: {
              execution_id: "exec-recovery-abandon-1",
              stage: "resume_failed",
              available_actions: ["retry", "abandon"],
            },
          },
        },
      ],
    })

    render(<ControlsContainer />)

    fireEvent.click(screen.getByText("controls.recovery.actions.abandon"))

    await waitFor(() => {
      expect(mockRecoverDesktopLocalChatExecution).toHaveBeenCalledWith({
        executionGraphExecutionId: "exec-recovery-abandon-1",
        action: "abandon",
      })
    })
    expect(loadHistory).toHaveBeenCalledWith("session-recovery-3")
  })

  it("keeps the recovery action bar visible when the desktop recovery command fails", async () => {
    const loadHistory = jest.fn().mockResolvedValue(undefined)
    mockRecoverDesktopLocalChatExecution.mockRejectedValueOnce(new Error("recover failed"))
    useChatStore.setState({
      sessionId: "session-recovery-4",
      loadHistory,
      messages: [
        {
          id: "assistant-recovery-failed-request",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          metaInfo: {
            recovery: {
              execution_id: "exec-recovery-failed-request-1",
              stage: "resume_failed",
              available_actions: ["continue", "retry", "abandon"],
            },
          },
        },
      ],
    })

    render(<ControlsContainer />)

    fireEvent.click(screen.getByText("controls.recovery.actions.continue"))

    await waitFor(() => {
      expect(mockRecoverDesktopLocalChatExecution).toHaveBeenCalledWith({
        executionGraphExecutionId: "exec-recovery-failed-request-1",
        action: "continue",
      })
    })
    expect(loadHistory).not.toHaveBeenCalled()
    expect(screen.getByText("controls.recovery.title")).toBeInTheDocument()
  })

  it("hides the secondary send-after-step action once the follow-up is already scheduled", () => {
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      pendingTakeover: {
        input: "follow-up prompt",
        attachments: [],
        selectedKnowledgeFileIds: ["doc-1"],
        createdAt: 1,
        updatedAt: 1,
      },
      pendingTakeoverRequestedAction: "send_after_step",
    }))

    render(<ControlsContainer />)

    expect(screen.getByText("takeover.title")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "takeover.actions.sendAfterStep" })
    ).not.toBeInTheDocument()
  })

  it("queues a pending takeover instead of cancelling when the run is active and the composer has content", () => {
    const queuePendingTakeoverFromCurrentDraft = jest.fn()
    const cancelActiveRequest = jest.fn()
    useChatStore.setState({
      input: "follow-up prompt",
    })
    useChatRuntimeStore.setState({ isLoading: true })
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      queuePendingTakeoverFromCurrentDraft,
      cancelActiveRequest,
    }))

    render(<ControlsContainer />)
    fireEvent.click(screen.getByLabelText("controls.queueTakeover"))

    expect(queuePendingTakeoverFromCurrentDraft).toHaveBeenCalledWith("send_after_step")
    expect(cancelActiveRequest).not.toHaveBeenCalled()
  })

  it("queues a pending takeover when Enter is pressed during an active run with draft content", () => {
    const queuePendingTakeoverFromCurrentDraft = jest.fn()
    const cancelActiveRequest = jest.fn()
    useChatStore.setState({
      input: "follow-up prompt",
    })
    useChatRuntimeStore.setState({ isLoading: true })
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      queuePendingTakeoverFromCurrentDraft,
      cancelActiveRequest,
    }))

    render(<ControlsContainer />)
    fireEvent.keyDown(screen.getByLabelText("controls.placeholder"), {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
    })

    expect(queuePendingTakeoverFromCurrentDraft).toHaveBeenCalledWith("send_after_step")
    expect(cancelActiveRequest).not.toHaveBeenCalled()
  })

  it("ignores Enter while IME composition is still active", () => {
    const queuePendingTakeoverFromCurrentDraft = jest.fn()
    const handleSendMessage = jest.fn()
    useChatStore.setState({
      input: "follow-up prompt",
      isLoading: true,
    })
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      isLoading: true,
      queuePendingTakeoverFromCurrentDraft,
      handleSendMessage,
    }))

    render(<ControlsContainer />)
    fireEvent.keyDown(screen.getByLabelText("controls.placeholder"), {
      key: "Enter",
      code: "Enter",
      keyCode: 229,
      which: 229,
    })

    expect(queuePendingTakeoverFromCurrentDraft).not.toHaveBeenCalled()
    expect(handleSendMessage).not.toHaveBeenCalled()
  })

  it("keeps the stop action when the run is active and the composer is empty", () => {
    const queuePendingTakeoverFromCurrentDraft = jest.fn()
    const cancelActiveRequest = jest.fn()
    useChatStore.setState({ input: "" })
    useChatRuntimeStore.setState({ isLoading: true })
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      queuePendingTakeoverFromCurrentDraft,
      cancelActiveRequest,
    }))

    render(<ControlsContainer />)
    fireEvent.click(screen.getByLabelText("controls.stop"))

    expect(cancelActiveRequest).toHaveBeenCalledTimes(1)
    expect(queuePendingTakeoverFromCurrentDraft).not.toHaveBeenCalled()
  })

  it("keeps the composer button in an approval-required busy state instead of falling back to send", () => {
    useChatStore.setState({
      isLoading: false,
      messages: [
        {
          id: "assistant-approval",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          blocks: [
            {
              type: "tool_call",
              callId: "call-1",
              toolName: "firecrawl_browser_create",
              status: "requires_approval",
            },
            {
              type: "tool_result",
              callId: "call-1",
              toolName: "firecrawl_browser_create",
              status: "requires_approval",
              result: { status: "REQUIRES_APPROVAL" },
            },
          ],
        },
      ],
    })

    render(<ControlsContainer />)

    expect(screen.getByLabelText("approvalDialog.title")).toBeDisabled()
    expect(screen.queryByLabelText("controls.send")).not.toBeInTheDocument()
  })

  it("keeps the composer button busy after approval resumes execution", () => {
    useChatStore.setState({
      isLoading: false,
      messages: [
        {
          id: "assistant-running-tool",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          blocks: [
            {
              type: "tool_call",
              callId: "call-2",
              toolName: "firecrawl_browser_create",
              status: "running",
            },
          ],
        },
      ],
    })

    render(<ControlsContainer />)

    expect(screen.getByLabelText("approvalDialog.actions.approving")).toBeDisabled()
    expect(screen.queryByLabelText("controls.send")).not.toBeInTheDocument()
  })

  it("queues a follow-up takeover instead of sending immediately while approval execution is still active", () => {
    const queuePendingTakeoverFromCurrentDraft = jest.fn()
    const handleSendMessage = jest.fn()
    useChatStore.setState({
      input: "follow-up prompt",
      isLoading: false,
      messages: [
        {
          id: "assistant-running-tool-with-draft",
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          blocks: [
            {
              type: "tool_call",
              callId: "call-3",
              toolName: "firecrawl_browser_create",
              status: "running",
            },
          ],
        },
      ],
    })
    mockUseChatMessaging.mockReturnValue(buildMessagingMock({
      queuePendingTakeoverFromCurrentDraft,
      handleSendMessage,
    }))

    render(<ControlsContainer />)
    fireEvent.click(screen.getByLabelText("controls.queueTakeover"))

    expect(queuePendingTakeoverFromCurrentDraft).toHaveBeenCalledWith("send_after_step")
    expect(handleSendMessage).not.toHaveBeenCalled()
  })

  it("passes the runtime mode into chat messaging on web", () => {
    useChatStore.setState({
      selectedAssistant: {
        id: "assistant-1",
        name: "Assistant One",
        desc: "",
        color: "from-sky-500 to-cyan-500",
      },
    })

    render(<ControlsContainer />)

    expect(mockUseChatMessaging).toHaveBeenCalledWith(
      expect.objectContaining({
        isTauriRuntime: false,
      })
    )
  })

  it("generates a workflow plan from the desktop secondary action", async () => {
    enableTauriRuntime()
    useChatStore.setState({
      input: "Draft the launch checklist",
    })
    mockGenerateWorkflowProposal.mockResolvedValueOnce(
      buildWorkflowRun("run-1", "Draft the launch checklist")
    )

    render(<ControlsContainer />)
    fireEvent.click(screen.getByLabelText("controls.generatePlan"))

    await waitFor(() => {
      expect(mockGenerateWorkflowProposal).toHaveBeenCalledWith({
        goal: "Draft the launch checklist",
        hints: undefined,
      })
    })
    expect(mockOpenWorkflow).toHaveBeenCalledWith({
      goal: "Draft the launch checklist",
      runId: "run-1",
    })
    expect(useChatStore.getState().input).toBe("")
  })

  it("uses the main send button to generate a plan in workflow mode", async () => {
    enableTauriRuntime()
    useChatStore.setState({
      input: "Plan a release rollback workflow",
    })
    mockGenerateWorkflowProposal.mockResolvedValueOnce(
      buildWorkflowRun("run-2", "Plan a release rollback workflow")
    )

    render(<ControlsContainer />)
    fireEvent.click(screen.getByLabelText("controls.modeWorkflow"))

    const planButtons = screen.getAllByLabelText("controls.generatePlan")
    fireEvent.click(planButtons[planButtons.length - 1])

    await waitFor(() => {
      expect(mockGenerateWorkflowProposal).toHaveBeenCalledWith({
        goal: "Plan a release rollback workflow",
        hints: undefined,
      })
    })
    expect(messagingMock.handleSendMessage).not.toHaveBeenCalled()
    expect(mockOpenWorkflow).toHaveBeenCalledWith({
      goal: "Plan a release rollback workflow",
      runId: "run-2",
    })
  })

  it("uses a resolved @agent mention as the workflow owner hint and strips it from the goal", async () => {
    enableTauriRuntime()
    useChatStore.setState({
      input: "@Planner draft an onboarding sequence",
    })
    mockListCustomTaskAgents.mockResolvedValueOnce([
      buildCustomTaskAgentProfile({
        id: "agent-1",
        name: "Planner",
      }),
    ])
    mockGenerateWorkflowProposal.mockResolvedValueOnce(
      buildWorkflowRun("run-3", "draft an onboarding sequence")
    )

    render(<ControlsContainer />)

    await screen.findByText("input.taskAgentRouted")
    fireEvent.click(screen.getByLabelText("controls.generatePlan"))

    await waitFor(() => {
      expect(mockGenerateWorkflowProposal).toHaveBeenCalledWith({
        goal: "draft an onboarding sequence",
        hints: [
          "Preferred executor / phase owner: @Planner (agent id: agent-1).",
          "Use this agent as the default owner for relevant phases when building the plan.",
        ].join("\n"),
      })
    })
    expect(mockOpenWorkflow).toHaveBeenCalledWith({
      goal: "draft an onboarding sequence",
      runId: "run-3",
    })
  })

  it("suggests switching to orchestration for complex tasks without auto-generating a plan", () => {
    enableTauriRuntime()
    useChatStore.setState({
      input: "Please plan a release rollout with phases for validation, approval, migration, rollback, and owner handoff so we can coordinate the launch safely.",
    })

    render(<ControlsContainer />)

    expect(screen.getByText("controls.workflowSuggestionTitle")).toBeInTheDocument()
    expect(screen.getByText("controls.workflowSuggestionDescription")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "controls.switchToWorkflow" }))

    expect(mockGenerateWorkflowProposal).not.toHaveBeenCalled()
    expect(screen.getAllByLabelText("controls.generatePlan")).toHaveLength(2)
  })

  it("renders the browser mode confirmation bar when browser mode is pending confirmation", () => {
    enableTauriRuntime()
    act(() => {
      useBrowserModeStore.getState().requestBrowserMode({
        prompt: "打开 github 并查看 notifications",
        source: "chat",
      })
    })

    render(<ControlsContainer />)

    expect(screen.getByText("browserMode.confirmation.title")).toBeInTheDocument()
    expect(screen.getByText("打开 github 并查看 notifications")).toBeInTheDocument()
  })

  it("opens page inspection mode from chat when the input asks to inspect the current page", async () => {
    enableTauriRuntime()
    useChatStore.setState({
      input: "帮我巡检这个页面",
      models: [{ id: "model-1", provider_model_id: "model-1" }],
    })
    useBrowserModeStore.getState().activate({
      connectionLabel: "Chrome extension connected",
      page: {
        tabId: 42,
        title: "Order Dashboard",
        url: "https://example.com/admin/orders",
        host: "example.com",
      },
      lastAction: {
        kind: "open_tab",
        summary: "Opened order dashboard",
      },
    })
    mockGetLocalBrowserAgentPageSnapshot.mockResolvedValueOnce(
      buildBrowserAgentPageSnapshot({
        url: "https://example.com/admin/orders",
        title: "Order Dashboard",
        documentReadyState: "complete",
        visibleText: "待处理 12\n失败 3",
        mainText: "待处理 12\n失败 3",
        headings: [{ level: 1, text: "订单面板" }],
        links: [{ text: "详情", href: "https://example.com/admin/orders/1024" }],
        buttons: [{ text: "刷新", disabled: false }],
        inputs: [{ placeholder: "搜索订单" }],
        forms: [],
      })
    )

    render(<ControlsContainer />)
    fireEvent.click(screen.getByLabelText("controls.send"))

    await waitFor(() => {
      expect(mockGetLocalBrowserAgentPageSnapshot).toHaveBeenCalledWith(42)
    })

    expect(messagingMock.handleSendMessage).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "native-canvas",
          title: "inspection.title",
        }),
      ])
    )
  })
})
