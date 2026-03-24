import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import ControlsContainer from "@/components/chat/console/controls-container"
import { useChatStore } from "@/store/chat-store"
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
    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    useChatStore.setState({
      input: "",
      attachments: [],
      isLoading: false,
      models: [{ id: "model-1", provider_model_id: "model-1" }],
      selectedAssistant: null,
    })

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
})
