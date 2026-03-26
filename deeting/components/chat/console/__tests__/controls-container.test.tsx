import "@testing-library/jest-dom"
import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import ControlsContainer from "@/components/chat/console/controls-container"
import { useChatStore } from "@/store/chat-store"
import { useBrowserModeStore } from "@/store/browser-mode-store"
import { useChatMessaging } from "@/hooks/chat/use-chat-messaging"

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

const buildMessagingMock = (
  overrides: Partial<ReturnType<typeof useChatMessaging>> = {}
): ReturnType<typeof useChatMessaging> => ({
  handleSendMessage: jest.fn(),
  hasContent: false,
  isLoading: false,
  errorMessage: null,
  cancelActiveRequest: jest.fn(),
  hasInterruptedGeneration: false,
  continueInterruptedGeneration: jest.fn(),
  ...overrides,
})

describe("ControlsContainer (web)", () => {
  beforeEach(() => {
    mockUseChatMessaging.mockReset()
    mockGetDesktopConfig.mockReset()
    mockSetDesktopConfig.mockReset()
    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    useChatStore.setState({
      input: "",
      attachments: [],
      isLoading: false,
      models: [{ id: "model-1", provider_model_id: "model-1" }],
      selectedAssistant: null,
    })
    useBrowserModeStore.getState().reset()

    mockGetDesktopConfig.mockResolvedValue(null)
    mockSetDesktopConfig.mockResolvedValue(undefined)
    mockUseChatMessaging.mockReturnValue(buildMessagingMock())
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

  it("passes the selected assistant directly into chat messaging on web", () => {
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

    expect(mockUseChatMessaging.mock.calls).toContainEqual([
      expect.objectContaining({
        agent: { id: "assistant-1", name: "Assistant One" },
        isTauriRuntime: false,
      }),
    ])
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
})
