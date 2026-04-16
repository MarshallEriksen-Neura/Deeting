import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { NotificationChannelsClient } from "@/app/[locale]/dashboard/notification-channels/components/channels-client"
import { getDesktopImSettings } from "@/lib/api/desktop-im"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key
    const suffix = Object.entries(values)
      .map(([entryKey, entryValue]) => `${entryKey}:${String(entryValue)}`)
      .join(" ")
    return `${key} ${suffix}`.trim()
  },
}))

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

jest.mock("@/hooks/use-chat-models", () => ({
  useChatModels: () => ({
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
  getPrimaryDesktopImRuntimeProfile: jest.fn((snapshot, platform) => {
    return (
      snapshot?.runtime_profiles?.find((profile: { platform: string }) => profile.platform === platform) ??
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
      runtime_profiles: [],
    })
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = originalIsTauri
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it("shows telegram fields in add form", async () => {
    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "actions.addChannel" }))
    fireEvent.click(screen.getByRole("button", { name: "channelTypes.telegram.label" }))

    expect(screen.getByText("fields.telegram.im_enabled.label", { selector: "label" })).toBeTruthy()
    expect(screen.getByText("fields.telegram.bot_token.label", { selector: "label" })).toBeTruthy()
    expect(screen.getByText("fields.telegram.chat_id.label", { selector: "label" })).toBeTruthy()
  })

  it("does not show a reply model field in the feishu add form", async () => {
    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "actions.addChannel" }))
    fireEvent.click(screen.getByRole("button", { name: "channelTypes.feishu.label" }))

    expect(
      screen.queryByText("fields.feishu.bot_model.label", { selector: "label" })
    ).toBeNull()
    expect(
      screen.getByText("fields.feishu.bot_system_prompt.label", { selector: "label" })
    ).toBeTruthy()
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
      runtime_profiles: [
        {
          profile_id: "notification-channel:telegram",
          platform: "telegram",
          display_name: "Telegram",
          configured: true,
          enabled: true,
          effective_state: "running",
          status_message: "Telegram direct runtime is running.",
          last_error: null,
          restart_count: 0,
          capabilities: {
            inbound: ["text", "image"],
            outbound: ["text"],
            degradations: ["rich_media_as_text_notice"],
          },
        },
      ],
    })

    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "actions.addChannel" }))
    fireEvent.click(screen.getByRole("button", { name: "channelTypes.telegram.label" }))

    await waitFor(() => {
      expect(screen.getByText("runtimeHint.currentDesktopIm mode:running")).toBeTruthy()
    })
    expect(screen.getByText("Telegram direct runtime is running.")).toBeTruthy()
    expect(screen.getByText("in:text,image · out:text")).toBeTruthy()
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
      runtime_profiles: [
        {
          profile_id: "notification-channel:telegram",
          platform: "telegram",
          display_name: "Telegram",
          configured: true,
          enabled: false,
          effective_state: "configured",
          status_message: "Telegram desktop IM is configured but disabled.",
          last_error: null,
          restart_count: 0,
          capabilities: {
            inbound: ["text"],
            outbound: ["text"],
            degradations: [],
          },
        },
      ],
    })

    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "actions.addChannel" }))
    fireEvent.click(screen.getByRole("button", { name: "channelTypes.telegram.label" }))

    await waitFor(() => {
      expect(screen.getByText("runtimeHint.currentDesktopIm mode:configured")).toBeTruthy()
    })
    expect(screen.getByText("Telegram desktop IM is configured but disabled.")).toBeTruthy()
  })

  it("shows wechat runtime state from desktop IM snapshot", async () => {
    mockGetDesktopImSettings.mockResolvedValue({
      profiles: [],
      resolved_profiles: [
        {
          profile_id: "notification-channel:wechat",
          platform: "wechat",
          display_name: "WeChat",
          enabled: true,
          resolution: {
            effective: "direct",
            reason_code: "direct_supported",
            user_message: "WeChat direct transport is available.",
          },
        },
      ],
      runtime_profiles: [
        {
          profile_id: "notification-channel:wechat",
          platform: "wechat",
          display_name: "WeChat",
          configured: true,
          enabled: true,
          effective_state: "running",
          status_message: "WeChat direct runtime is running.",
          last_error: null,
          restart_count: 0,
          capabilities: {
            inbound: ["text", "image", "file"],
            outbound: ["text"],
            degradations: ["rich_media_as_text_notice"],
          },
        },
      ],
    })

    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "actions.addChannel" }))
    fireEvent.click(screen.getByRole("button", { name: "channelTypes.wechat.label" }))

    await waitFor(() => {
      expect(screen.getByText("runtimeHint.currentDesktopIm mode:running")).toBeTruthy()
    })
    expect(screen.getByText("WeChat direct runtime is running.")).toBeTruthy()
    expect(screen.getByText("in:text,image,file · out:text")).toBeTruthy()
  })
})
