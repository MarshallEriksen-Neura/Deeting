import "@testing-library/jest-dom"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { BrowserModeConfirmationBar } from "@/components/chat/browser-mode/browser-mode-confirmation-bar"
import { useBrowserModeStore } from "@/store/browser-mode-store"
import { useWorkspaceStore } from "@/store/workspace-store"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

describe("BrowserModeConfirmationBar", () => {
  beforeEach(() => {
    useBrowserModeStore.getState().reset()
    useWorkspaceStore.getState().closeAll()
  })

  it("renders when browser mode is pending confirmation and lets the user confirm or reject", () => {
    act(() => {
      useBrowserModeStore.getState().requestBrowserMode({
        prompt: "打开 github 并查看 notifications",
        source: "chat",
      })
    })

    const { rerender } = render(<BrowserModeConfirmationBar />)

    expect(screen.getByText("browserMode.confirmation.title")).toBeInTheDocument()
    expect(
      screen.getByText("打开 github 并查看 notifications")
    ).toBeInTheDocument()

    fireEvent.click(screen.getByText("browserMode.confirmation.confirm"))
    expect(useBrowserModeStore.getState().status).toBe("connecting")
    expect(useWorkspaceStore.getState().views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-mode",
          type: "browser-mode",
        }),
      ])
    )

    act(() => {
      useBrowserModeStore.getState().reset()
      useBrowserModeStore.getState().requestBrowserMode({
        prompt: "打开 github 并查看 notifications",
        source: "chat",
      })
    })

    rerender(<BrowserModeConfirmationBar />)
    fireEvent.click(screen.getByText("browserMode.confirmation.reject"))
    expect(useBrowserModeStore.getState().status).toBe("idle")
  })
})
