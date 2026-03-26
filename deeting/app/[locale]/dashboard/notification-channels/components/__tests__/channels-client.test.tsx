import { fireEvent, render, screen } from "@testing-library/react"

import { NotificationChannelsClient } from "@/app/[locale]/dashboard/notification-channels/components/channels-client"

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
  it("keeps telegram im_enabled and explains bot_token versus chat_id usage", async () => {
    render(<NotificationChannelsClient />)

    fireEvent.click(screen.getByRole("button", { name: "添加通知渠道" }))
    fireEvent.click(screen.getByRole("button", { name: "Telegram" }))

    expect(screen.getByText("启用桌面 IM", { selector: "label" })).toBeTruthy()
    expect(screen.getByRole("switch")).toBeTruthy()
    expect(screen.getByText("bot_token 同时用于主动推送与桌面私聊 Bot。")).toBeTruthy()
    expect(screen.getByText("chat_id 仅用于主动推送目标，不影响私聊 Bot 收消息。")).toBeTruthy()
  })
})
