import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { DesktopWindowSettingsCard } from "../desktop-window-settings-card"

const mockGetDesktopWindowCloseAction = jest.fn()
const mockSetDesktopWindowCloseAction = jest.fn()
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("@/lib/api/desktop-config", () => ({
  getDesktopWindowCloseAction: (...args: unknown[]) =>
    mockGetDesktopWindowCloseAction(...args),
  setDesktopWindowCloseAction: (...args: unknown[]) =>
    mockSetDesktopWindowCloseAction(...args),
}))

jest.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

describe("DesktopWindowSettingsCard", () => {
  beforeEach(() => {
    mockGetDesktopWindowCloseAction.mockReset()
    mockSetDesktopWindowCloseAction.mockReset()
    mockToastSuccess.mockReset()
    mockToastError.mockReset()
    mockGetDesktopWindowCloseAction.mockResolvedValue("show_island")
    mockSetDesktopWindowCloseAction.mockResolvedValue(undefined)
  })

  it("loads and saves the desktop close action", async () => {
    render(<DesktopWindowSettingsCard isTauriRuntime />)

    await waitFor(() => {
      expect(mockGetDesktopWindowCloseAction).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(
        screen.getByLabelText("window.closeAction.minimize")
      ).not.toBeDisabled()
    })

    fireEvent.click(screen.getByLabelText("window.closeAction.minimize"))
    fireEvent.click(screen.getByRole("button", { name: "window.save" }))

    await waitFor(() => {
      expect(mockSetDesktopWindowCloseAction).toHaveBeenCalledWith("minimize")
    })

    expect(mockToastSuccess).toHaveBeenCalledWith("window.saveSuccess")
  })
})
