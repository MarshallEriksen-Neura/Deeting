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
    scroll: _scroll,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...props}>{children}</a>
  ),
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

jest.mock("@/lib/api/custom-task-agents", () => ({
  listCustomTaskAgents: jest.fn().mockResolvedValue([]),
}))

const mockGetDesktopConfig = jest.fn()
const mockSetDesktopConfig = jest.fn()

jest.mock("@/lib/api/desktop-config", () => ({
  DESKTOP_CONFIG_KEYS: {
    workerWorkflowRouting: "workflow.route_worker_through_workflow",
  },
  isTauriRuntime: () => true,
  getDesktopConfig: (...args: unknown[]) => mockGetDesktopConfig(...args),
  setDesktopConfig: (...args: unknown[]) => mockSetDesktopConfig(...args),
}))

const mockUseChatMessaging = useChatMessaging as jest.MockedFunction<
  typeof useChatMessaging
>
const mockGetLocalBrowserAgentPageSnapshot =
  getLocalBrowserAgentPageSnapshot as jest.MockedFunction<
    typeof getLocalBrowserAgentPageSnapshot
  >

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

describe("ControlsContainer (web)", () => {
  let messagingMock: ReturnType<typeof useChatMessaging>

  beforeEach(() => {
    mockUseChatMessaging.mockReset()
    mockGetDesktopConfig.mockReset()
    mockSetDesktopConfig.mockReset()
    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    useChatStore.setState({
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

    mockGetDesktopConfig.mockResolvedValue(null)
    mockSetDesktopConfig.mockResolvedValue(undefined)
    messagingMock = buildMessagingMock()
    mockUseChatMessaging.mockReturnValue(messagingMock)
  })

  it("should hide assistant selector on web", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    render(<ControlsContainer />)
    expect(screen.queryByLabelText("routing.override")).toBeNull()
  })

  it("should not render fixed persona pill on desktop", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: {},
    })
    render(<ControlsContainer />)

    expect(screen.queryByText("routing.persona")).not.toBeInTheDocument()
    expect(screen.queryByText("routing.personaDesc")).not.toBeInTheDocument()
  })

  it("hides the old standalone image shortcut from the chat controls", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    render(<ControlsContainer />)

    expect(screen.queryByLabelText("controls.menu")).not.toBeInTheDocument()
    expect(screen.queryByText("controls.image")).not.toBeInTheDocument()
  })

  it("shows continue button and triggers continue callback after interruption", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    expect(screen.getByText("controls.recovery.description.toolRunningInterrupted")).toBeInTheDocument()
    expect(screen.getByText("exec-recovery-1")).toBeInTheDocument()

    fireEvent.click(screen.getByText("controls.recovery.actions.continue"))
    expect(regenerateMessage).toHaveBeenCalledWith("assistant-recovery")
    expect(continueInterruptedGeneration).not.toHaveBeenCalled()
  })

  it("dismisses the recovery action bar when abandon is pressed", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    useChatStore.setState({
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

    expect(screen.queryByText("controls.recovery.title")).not.toBeInTheDocument()
  })

  it("hides the secondary send-after-step action once the follow-up is already scheduled", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
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

  it("loads the desktop workflow routing switch from persisted config", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockGetDesktopConfig.mockResolvedValueOnce("enabled")
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: {},
    })

    render(<ControlsContainer />)

    const toggle = await screen.findByRole("switch", {
      name: "controls.workflowRouting",
    })
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true")
    })

    expect(mockGetDesktopConfig).toHaveBeenCalledWith(
      "workflow.route_worker_through_workflow"
    )
  })

  it("persists desktop workflow routing changes from the chat controls", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: {},
    })

    render(<ControlsContainer />)

    const toggle = await screen.findByRole("switch", {
      name: "controls.workflowRouting",
    })
    await waitFor(() => {
      expect(toggle).not.toBeDisabled()
    })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(mockSetDesktopConfig).toHaveBeenCalledWith(
        "workflow.route_worker_through_workflow",
        "true"
      )
    })
  })

  it("renders the browser mode confirmation bar when browser mode is pending confirmation", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: {},
    })
    act(() => {
      useBrowserModeStore.getState().requestBrowserMode({
        prompt: "打开 github 并查看 notifications",
        source: "chat",
      })
    })

    render(<ControlsContainer />)

    expect(screen.getByText("browserMode.confirmation.title")).toBeInTheDocument()
    expect(
      screen.getByText("打开 github 并查看 notifications")
    ).toBeInTheDocument()
  })

  it("opens page inspection mode from chat when the input asks to inspect the current page", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: {},
    })
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
    mockGetLocalBrowserAgentPageSnapshot.mockResolvedValueOnce({
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
    } as any)

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
