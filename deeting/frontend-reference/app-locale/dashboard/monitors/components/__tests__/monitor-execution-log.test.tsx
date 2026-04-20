import { render, screen } from "@testing-library/react"

import { MonitorExecutionLog } from "@/app/[locale]/dashboard/monitors/components/monitor-execution-log"

const mockUseMonitorLogs = jest.fn()
const mockUseMonitorDeliveryStates = jest.fn()

jest.mock("@/lib/swr/use-monitors", () => ({
  useMonitorLogs: (...args: unknown[]) => mockUseMonitorLogs(...args),
  useMonitorDeliveryStates: (...args: unknown[]) => mockUseMonitorDeliveryStates(...args),
}))

jest.mock("@/lib/api/monitors", () => ({
  submitMonitorFeedback: jest.fn(),
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe("MonitorExecutionLog", () => {
  beforeEach(() => {
    mockUseMonitorLogs.mockReset()
    mockUseMonitorDeliveryStates.mockReset()
    mockUseMonitorLogs.mockReturnValue({
      data: {
        total: 1,
        items: [
          {
            id: "log-1",
            task_id: "task-1",
            triggered_at: "2026-03-28T00:00:00Z",
            status: "success",
            input_data: null,
            output_data: {
              change_summary: "summary",
              events: [],
            },
            tokens_used: 10,
            error_message: null,
            created_at: "2026-03-28T00:00:00Z",
          },
        ],
      },
      isLoading: false,
      mutate: jest.fn(),
    })
    mockUseMonitorDeliveryStates.mockReturnValue({
      data: {
        total: 2,
        items: [
          {
            task_id: "task-1",
            channel_id: "channel-feishu",
            channel_kind: "feishu",
            channel_display_name: "飞书战情群",
            status: "anchored",
            target_key: "feishu:oc_123",
            anchor_message_id: "om_456",
            anchor_context: {
              chat_id: "oc_123",
            },
            updated_at: "2026-03-28T00:00:00Z",
          },
          {
            task_id: "task-1",
            channel_id: "channel-wechat",
            channel_kind: "wechat",
            channel_display_name: "微信值班联系人",
            status: "context_ready",
            target_key: "wechat:user-1",
            anchor_message_id: null,
            anchor_context: {
              context_token: "ctx-1",
            },
            updated_at: "2026-03-28T00:00:00Z",
          },
        ],
      },
    })
  })

  it("renders delivery anchors for message-id and wechat context based channels", () => {
    render(<MonitorExecutionLog taskId="task-1" onClose={jest.fn()} />)

    expect(screen.getByText("交付锚点")).toBeTruthy()
    expect(screen.getByText("feishu:oc_123")).toBeTruthy()
    expect(screen.getByText("飞书战情群")).toBeTruthy()
    expect(screen.getByText("线程锚点已建立")).toBeTruthy()
    expect(screen.getByText("消息锚点: om_456")).toBeTruthy()
    expect(screen.getByText("wechat:user-1")).toBeTruthy()
    expect(screen.getByText("微信值班联系人")).toBeTruthy()
    expect(screen.getByText("上下文已建立")).toBeTruthy()
    expect(screen.getByText("上下文锚点: ctx-1")).toBeTruthy()
  })

  it("distinguishes pending thread anchors from waiting-for-contact-message wechat states", () => {
    mockUseMonitorDeliveryStates.mockReturnValue({
      data: {
        total: 2,
        items: [
          {
            task_id: "task-1",
            channel_id: "channel-telegram",
            channel_kind: "telegram",
            channel_display_name: "Telegram 作战频道",
            status: "pending",
            target_key: "telegram:12345",
            anchor_message_id: null,
            anchor_context: {
              chat_id: "12345",
            },
            updated_at: "2026-03-28T00:00:00Z",
          },
          {
            task_id: "task-1",
            channel_id: "channel-wechat",
            channel_kind: "wechat",
            channel_display_name: "微信联络人",
            status: "waiting_for_contact_message",
            target_key: "wechat:user-2",
            anchor_message_id: null,
            anchor_context: {
              contact_id: "user-2",
            },
            updated_at: "2026-03-28T00:00:00Z",
          },
        ],
      },
    })

    render(<MonitorExecutionLog taskId="task-1" onClose={jest.fn()} />)

    expect(screen.getByText("待建立线程锚点")).toBeTruthy()
    expect(screen.getByText("等待联系人先发消息")).toBeTruthy()
  })
})
