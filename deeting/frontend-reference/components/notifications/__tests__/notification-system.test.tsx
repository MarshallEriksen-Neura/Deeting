import { act, render, waitFor } from "@testing-library/react"

import { NotificationSystem } from "../notification-system"
import { MODEL_CONFIG_REQUIRED_EVENT } from "@/lib/model-config-required"

const mockPush = jest.fn()
const mockAddNotification = jest.fn()
const mockTrimNotifications = jest.fn()
const mockSendMarkRead = jest.fn()
const mockSendMarkAllRead = jest.fn()
const mockSendClear = jest.fn()
const mockUseAuthStore = jest.fn()
const mockListen = jest.fn()

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values && "items" in values) {
      return `${key}:${String(values.items)}`
    }
    return key
  },
}))

jest.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock("@/components/contexts/notification-context", () => ({
  useNotifications: () => ({
    notifications: [],
    trimNotifications: mockTrimNotifications,
    processingState: { isProcessing: false, message: "" },
    addNotification: mockAddNotification,
  }),
}))

jest.mock("@/components/notifications/use-notification-realtime", () => ({
  useNotificationRealtime: () => ({
    sendMarkRead: mockSendMarkRead,
    sendMarkAllRead: mockSendMarkAllRead,
    sendClear: mockSendClear,
  }),
}))

jest.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    mockUseAuthStore(selector),
}))

jest.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}))

jest.mock("@/components/ui/glass-pill-toaster", () => ({
  GlassPillToaster: () => null,
}))

jest.mock("@/components/notifications/notification-center", () => ({
  NotificationCenter: () => null,
}))

jest.mock("@/components/ui/ambient-indicator", () => ({
  AmbientIndicator: () => null,
}))

describe("NotificationSystem", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    mockPush.mockReset()
    mockAddNotification.mockReset()
    mockTrimNotifications.mockReset()
    mockSendMarkRead.mockReset()
    mockSendMarkAllRead.mockReset()
    mockSendClear.mockReset()
    mockListen.mockReset()
    mockListen.mockResolvedValue(jest.fn())
    mockUseAuthStore.mockReset()
    mockUseAuthStore.mockImplementation((selector) =>
      selector({ isAuthenticated: true })
    )
  })

  it("does not force navigation to settings when model config is missing", async () => {
    render(<NotificationSystem />)

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(MODEL_CONFIG_REQUIRED_EVENT, {
          detail: { missing: ["secretary", "embedding"] },
        })
      )
    })

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledTimes(1)
    })

    expect(mockPush).not.toHaveBeenCalled()

    const notification = mockAddNotification.mock.calls[0][0] as {
      action?: { onClick?: () => void }
    }

    expect(notification.action?.onClick).toEqual(expect.any(Function))

    notification.action?.onClick?.()
    expect(mockPush).toHaveBeenCalledWith("/settings")
  })
})
