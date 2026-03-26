import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { NotificationChannelsClient } from "@/app/[locale]/dashboard/notification-channels/components/channels-client"
import { getDesktopImSettings } from "@/lib/api/desktop-im"

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock("@/lib/swr/use-notification-channels", () => ({
  useNotificationChannels: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
    mutate: jest.fn(),
  }),
}))

jest.mock("@/hooks/use-chat-service", () => ({
  useChatService: () => ({
    modelGroups: [],
    isLoadingModels: false,
  }),
}))

jest.mock("@/lib/api/desktop-im", () => ({
  getDesktopImSettings: jest.fn(),
  getPrimaryDesktopImResolution: jest.fn((snapshot, platform) => {
    return (
      snapshot?.resolved_profiles?.find((profile: { platform: string }) => profile.platform === platform) ??
      null
    )
  }),
}))

jest.mock("@/lib/api/notification-channels", () => {
  const actual = jest.requireActual("@/lib/api/notification-channels")
  return {
    ...actual,
    createNotificationChannel: jest.fn(),
    updateNotificationChannel: jest.fn(),
    deleteNotificationChannel: jest.fn(),
    testNotificationChannel: jest.fn(),
    fetchNotificationChannel: jest.fn(),
  }
})

describe("NotificationChannelsClient telegram config", () => {
  const originalIsTauri = process.env.NEXT_PUBLIC_IS_TAURI
  const mockGetDesktopImSettings = getDesktopImSettings as jest.MockedFunction<
    typeof getDesktopImSettings
  >

  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    })
    mockGetDesktopImSettings.mockReset()
    mockGetDesktopImSettings.mockResolvedValue({
      profiles: [],
      resolved_profiles: [],
    })
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = originalIsTauri
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it("keeps telegram im_enabled and explains bot_token versus chat_id usage", async () => {
    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "添加通知渠道" }))
    fireEvent.click(screen.getByRole("button", { name: "Telegram" }))

    expect(screen.getByText("启用桌面 IM", { selector: "label" })).toBeTruthy()
    expect(screen.getByRole("switch")).toBeTruthy()
    expect(screen.getByText("bot_token 同时用于主动推送与桌面私聊 Bot。")).toBeTruthy()
    expect(screen.getByText("chat_id 仅用于主动推送目标，不影响私聊 Bot 收消息。")).toBeTruthy()
  })

  it("shows telegram runtime status from desktop im snapshot", async () => {
    mockGetDesktopImSettings.mockResolvedValue({
      profiles: [],
      resolved_profiles: [
        {
          profile_id: "notification-channel:telegram",
          platform: "telegram",
          display_name: "Telegram",
          enabled: true,
          resolution: {
            effective: "direct",
            reason_code: "direct_supported",
            user_message: "Telegram direct transport is available.",
          },
        },
      ],
    })

    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "添加通知渠道" }))
    fireEvent.click(screen.getByRole("button", { name: "Telegram" }))

    await waitFor(() => {
      expect(screen.getByText("当前桌面 IM: direct")).toBeTruthy()
    })
    expect(screen.getByText("Telegram direct transport is available.")).toBeTruthy()
  })

  it("shows telegram disabled runtime status distinctly from operational state", async () => {
    mockGetDesktopImSettings.mockResolvedValue({
      profiles: [],
      resolved_profiles: [
        {
          profile_id: "notification-channel:telegram",
          platform: "telegram",
          display_name: "Telegram",
          enabled: false,
          resolution: {
            effective: "unavailable",
            reason_code: "direct_missing_credentials",
            user_message: "Telegram desktop IM is disabled.",
          },
        },
      ],
    })

    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "添加通知渠道" }))
    fireEvent.click(screen.getByRole("button", { name: "Telegram" }))

    await waitFor(() => {
      expect(screen.getByText("当前桌面 IM: disabled")).toBeTruthy()
    })
    expect(screen.getByText("Telegram desktop IM is disabled.")).toBeTruthy()
  })
})
