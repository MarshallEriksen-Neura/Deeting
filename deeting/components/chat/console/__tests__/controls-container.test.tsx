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
    useChatStore.setState({
      input: "",
      attachments: [],
      isLoading: false,
      models: [{ id: "model-1", provider_model_id: "model-1" }],
    })

    mockUseChatMessaging.mockReturnValue(buildMessagingMock())
  })

  it("should hide assistant selector on web", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    render(<ControlsContainer />)
    expect(screen.queryByLabelText("hud.selectAgent")).toBeNull()
  })

  it("should render auto routing button with new icon gradient style", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    render(<ControlsContainer />)

    const routingButton = screen.getByLabelText("routing.override")
    const autoIconContainer = routingButton.querySelector("span.w-8.h-8")

    expect(autoIconContainer).toBeInTheDocument()
    expect(autoIconContainer?.className).toContain("bg-gradient-to-br")
    expect(autoIconContainer?.className).toContain("from-sky-500")
    expect(autoIconContainer?.className).toContain("to-cyan-500")
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
})
