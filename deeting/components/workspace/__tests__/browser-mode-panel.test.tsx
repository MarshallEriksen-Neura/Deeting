import "@testing-library/jest-dom"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { getLocalBrowserAgentPageSnapshot } from "@/lib/api/browser-agent"
import { useBrowserModeStatus } from "@/hooks/chat/use-browser-mode-status"
import { WorkspacePanel } from "@/components/workspace/workspace-panel"
import { useWorkspaceStore } from "@/store/workspace-store"
import { useBrowserModeStore } from "@/store/browser-mode-store"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/hooks/chat/use-browser-mode-status", () => ({
  useBrowserModeStatus: jest.fn(),
}))

jest.mock("@/lib/api/browser-agent", () => ({
  getLocalBrowserAgentPageSnapshot: jest.fn(),
}))

const mockUseBrowserModeStatus = useBrowserModeStatus as jest.MockedFunction<
  typeof useBrowserModeStatus
>
const mockGetLocalBrowserAgentPageSnapshot =
  getLocalBrowserAgentPageSnapshot as jest.MockedFunction<
    typeof getLocalBrowserAgentPageSnapshot
  >

describe("BrowserModePanel", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().closeAll()
    useBrowserModeStore.getState().reset()
    mockGetLocalBrowserAgentPageSnapshot.mockReset()
    mockUseBrowserModeStatus.mockReturnValue({
      bridgeStatus: null,
      isRefreshing: false,
      refresh: jest.fn(),
      connectionState: "connected",
      statusLabel: "connected",
      statusDetail: "browser_agent_extension_connected",
    })
  })

  it("renders the browser mode panel inside workspace with connection state, page context, and controls", () => {
    useBrowserModeStore.getState().requestBrowserMode({
      prompt: "打开 github 并查看 notifications",
      source: "chat",
    })
    useBrowserModeStore.getState().confirm()
    useBrowserModeStore.getState().activate({
      connectionLabel: "Chrome extension connected",
      page: {
        tabId: 42,
        title: "GitHub Notifications",
        url: "https://github.com/notifications",
        host: "github.com",
      },
      lastAction: {
        kind: "open_tab",
        summary: "Opened notifications page",
      },
    })

    useWorkspaceStore.getState().openView({
      id: "browser-mode",
      type: "browser-mode",
      title: "Browser Mode",
      content: { source: "chat-browser-mode" },
    })

    render(<WorkspacePanel />)

    expect(screen.getAllByText("Browser Mode")).toHaveLength(2)
    expect(screen.getByText("Chrome extension connected")).toBeInTheDocument()
    expect(screen.getByText("GitHub Notifications")).toBeInTheDocument()
    expect(screen.getByText("github.com")).toBeInTheDocument()
    expect(screen.getByText("Opened notifications page")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "browserMode.panel.inspect" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "browserMode.panel.pause" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "browserMode.panel.reconnect" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "browserMode.panel.end" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "browserMode.panel.pause" }))
    expect(useBrowserModeStore.getState().status).toBe("paused")

    fireEvent.click(screen.getByRole("button", { name: "browserMode.panel.end" }))
    expect(useBrowserModeStore.getState().status).toBe("ended")
    expect(useWorkspaceStore.getState().views).toHaveLength(0)
  })

  it("shows a recovery banner and reconnect action when the extension session is not connected", () => {
    mockUseBrowserModeStatus.mockReturnValue({
      bridgeStatus: null,
      isRefreshing: false,
      refresh: jest.fn(),
      connectionState: "extension_not_connected",
      statusLabel: "extension_not_connected",
      statusDetail: "browser_agent_bridge_listening",
    })

    useBrowserModeStore.getState().requestBrowserMode({
      prompt: "打开 github 并查看 notifications",
      source: "chat",
    })
    useBrowserModeStore.getState().confirm()
    useBrowserModeStore.getState().markDisconnected("Extension session lost")

    useWorkspaceStore.getState().openView({
      id: "browser-mode",
      type: "browser-mode",
      title: "Browser Mode",
      content: { source: "chat-browser-mode" },
    })

    render(<WorkspacePanel />)

    expect(screen.getByText("browserMode.panel.recoveryTitle")).toBeInTheDocument()
    expect(screen.getByText("browserMode.panel.recoveryDescription")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "browserMode.panel.reconnectContinue" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "browserMode.panel.endTask" })
    ).toBeInTheDocument()
  })

  it("renders execution phase, retry count, and recovery reason when present", () => {
    mockUseBrowserModeStatus.mockReturnValue({
      bridgeStatus: null,
      isRefreshing: false,
      refresh: jest.fn(),
      connectionState: "connected",
      statusLabel: "connected",
      statusDetail: "browser_agent_extension_connected",
    })

    useBrowserModeStore.getState().requestBrowserMode({
      prompt: "打开 github 并查看 notifications",
      source: "chat",
    })
    useBrowserModeStore.getState().confirm()
    useBrowserModeStore.getState().activate({
      connectionLabel: "Chrome extension connected",
      page: {
        tabId: 42,
        title: "GitHub Notifications",
        url: "https://github.com/notifications",
        host: "github.com",
      },
      lastAction: {
        kind: "click",
        summary: "Opened notifications page",
      },
    })
    useBrowserModeStore.getState().setExecutionState("verifying", "Confirming page transition")
    useBrowserModeStore.getState().markRecovery("Target changed after refresh", 2)

    useWorkspaceStore.getState().openView({
      id: "browser-mode",
      type: "browser-mode",
      title: "Browser Mode",
      content: { source: "chat-browser-mode" },
    })

    render(<WorkspacePanel />)

    expect(screen.getByText("browserMode.panel.executionLabel")).toBeInTheDocument()
    expect(screen.getByText("browserMode.panel.execution.recovering")).toBeInTheDocument()
    expect(screen.getAllByText("Target changed after refresh").length).toBeGreaterThan(0)
    expect(screen.getByText("browserMode.panel.retryCount")).toBeInTheDocument()
    expect(useBrowserModeStore.getState().retryCount).toBe(2)
  })

  it("renders a browser execution timeline when timeline events exist", () => {
    mockUseBrowserModeStatus.mockReturnValue({
      bridgeStatus: null,
      isRefreshing: false,
      refresh: jest.fn(),
      connectionState: "connected",
      statusLabel: "connected",
      statusDetail: "browser_agent_extension_connected",
    })

    useBrowserModeStore.getState().requestBrowserMode({
      prompt: "打开 github 并查看 notifications",
      source: "chat",
    })
    useBrowserModeStore.getState().confirm()
    useBrowserModeStore.getState().appendTimelineEvent({
      kind: "tool_call",
      label: "Waiting for target element",
      phase: "waiting",
    })
    useBrowserModeStore.getState().appendTimelineEvent({
      kind: "tool_result",
      label: "Navigation confirmed",
      phase: "verifying",
    })

    useWorkspaceStore.getState().openView({
      id: "browser-mode",
      type: "browser-mode",
      title: "Browser Mode",
      content: { source: "chat-browser-mode" },
    })

    render(<WorkspacePanel />)

    expect(screen.getByText("browserMode.panel.timelineLabel")).toBeInTheDocument()
    expect(screen.getByText("Waiting for target element")).toBeInTheDocument()
    expect(screen.getByText("Navigation confirmed")).toBeInTheDocument()
    expect(screen.getAllByText("browserMode.panel.execution.waiting").length).toBeGreaterThan(0)
    expect(screen.getAllByText("browserMode.panel.execution.verifying").length).toBeGreaterThan(0)
  })

  it("opens a page inspection result view from the current browser page", async () => {
    mockUseBrowserModeStatus.mockReturnValue({
      bridgeStatus: null,
      isRefreshing: false,
      refresh: jest.fn(),
      connectionState: "connected",
      statusLabel: "connected",
      statusDetail: "browser_agent_extension_connected",
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

    useBrowserModeStore.getState().requestBrowserMode({
      prompt: "巡检当前页面",
      source: "chat",
    })
    useBrowserModeStore.getState().confirm()
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

    useWorkspaceStore.getState().openView({
      id: "browser-mode",
      type: "browser-mode",
      title: "Browser Mode",
      content: { source: "chat-browser-mode" },
    })

    render(<WorkspacePanel />)
    fireEvent.click(screen.getByRole("button", { name: "browserMode.panel.inspect" }))

    await waitFor(() => {
      expect(mockGetLocalBrowserAgentPageSnapshot).toHaveBeenCalledWith(42)
    })

    await waitFor(() => {
      expect(screen.getAllByText("inspection.title").length).toBeGreaterThan(0)
    })

    expect(screen.getByText("inspection.pageOverview")).toBeInTheDocument()
    expect(screen.getAllByText("Order Dashboard").length).toBeGreaterThan(0)
    expect(screen.getByText("inspection.keyMetrics")).toBeInTheDocument()
  })
})
