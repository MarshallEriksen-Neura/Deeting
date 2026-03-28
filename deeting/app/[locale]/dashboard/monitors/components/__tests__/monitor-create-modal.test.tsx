import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { MonitorCreateModal } from "@/app/[locale]/dashboard/monitors/components/monitor-create-modal"
import type { MonitorTask } from "@/lib/api/monitors"
import {
  createMonitorTask,
} from "@/lib/api/monitors"
import { listCustomTaskAgents } from "@/lib/api/custom-task-agents"

const mockUseNotificationChannels = jest.fn()

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/lib/api/monitors", () => ({
  createMonitorTask: jest.fn(),
  updateMonitorTask: jest.fn(),
}))

jest.mock("@/lib/api/custom-task-agents", () => ({
  listCustomTaskAgents: jest.fn(),
}))

jest.mock("@/lib/swr/use-notification-channels", () => ({
  useNotificationChannels: (...args: unknown[]) => mockUseNotificationChannels(...args),
}))

const mockCreateMonitorTask = createMonitorTask as jest.MockedFunction<
  typeof createMonitorTask
>
const mockListCustomTaskAgents = listCustomTaskAgents as jest.MockedFunction<
  typeof listCustomTaskAgents
>

function makeEditTask(overrides: Partial<MonitorTask> = {}): MonitorTask {
  return {
    id: "task-1",
    user_id: "user-1",
    title: "旧任务",
    objective: "旧目标",
    cron_expr: "0 */6 * * *",
    status: "active",
    last_snapshot: null,
    last_executed_at: null,
    next_run_at: null,
    current_interval_minutes: 360,
    display_status: "active",
    analysis_mode: "concise",
    policy_state: {},
    binding_state: "ok",
    binding_error: null,
    strategy_variants: null,
    assistant_id: "agent-1",
    assistant_name: "研究员",
    model_id: null,
    error_count: 0,
    notify_config: {},
    allowed_tools: [],
    execution_target: "desktop",
    total_tokens: 0,
    is_active: true,
    created_at: "2026-03-25T00:00:00Z",
    updated_at: "2026-03-25T00:00:00Z",
    ...overrides,
  }
}

describe("MonitorCreateModal", () => {
  beforeEach(() => {
    mockCreateMonitorTask.mockReset()
    mockListCustomTaskAgents.mockReset()
    mockUseNotificationChannels.mockReset()
    mockCreateMonitorTask.mockResolvedValue({
      id: "task-1",
      title: "伊朗局势72H监控",
      status: "active",
      message: "ok",
      analysis_mode: "concise",
      assistant_id: "agent-1",
      execution_target: "desktop",
    })
    mockListCustomTaskAgents.mockResolvedValue([
      {
        id: "agent-1",
        name: "地缘研究员",
        description: "chat",
        task_prompt: "watch",
        invocation_kind: "chat",
        preferred_for_image_generation: false,
        model_config: null,
        callable_mcp_tool_ids: [],
        guidance_skill_ids: [],
        callable_skill_action_refs: [],
        tags: [],
        discoverable: true,
        is_enabled: true,
        is_deleted: false,
        created_at: "2026-03-25T00:00:00Z",
        updated_at: "2026-03-25T00:00:00Z",
      },
      {
        id: "agent-2",
        name: "图片助手",
        description: "image",
        task_prompt: "draw",
        invocation_kind: "image_generation",
        preferred_for_image_generation: true,
        model_config: null,
        callable_mcp_tool_ids: [],
        guidance_skill_ids: [],
        callable_skill_action_refs: [],
        tags: [],
        discoverable: true,
        is_enabled: true,
        is_deleted: false,
        created_at: "2026-03-25T00:00:00Z",
        updated_at: "2026-03-25T00:00:00Z",
      },
      {
        id: "agent-3",
        name: "已停用助手",
        description: "chat",
        task_prompt: "watch",
        invocation_kind: "chat",
        preferred_for_image_generation: false,
        model_config: null,
        callable_mcp_tool_ids: [],
        guidance_skill_ids: [],
        callable_skill_action_refs: [],
        tags: [],
        discoverable: true,
        is_enabled: false,
        is_deleted: false,
        created_at: "2026-03-25T00:00:00Z",
        updated_at: "2026-03-25T00:00:00Z",
      },
    ])
    mockUseNotificationChannels.mockReturnValue({
      data: {
        items: [
          {
            id: "channel-feishu",
            channel: "feishu",
            display_name: "飞书战情群",
            is_active: true,
            priority: 100,
            config: {},
            user_id: "user-1",
            last_used_at: null,
            created_at: "2026-03-25T00:00:00Z",
            updated_at: "2026-03-25T00:00:00Z",
          },
          {
            id: "channel-telegram",
            channel: "telegram",
            display_name: "Telegram 频道",
            is_active: true,
            priority: 100,
            config: {},
            user_id: "user-1",
            last_used_at: null,
            created_at: "2026-03-25T00:00:00Z",
            updated_at: "2026-03-25T00:00:00Z",
          },
          {
            id: "channel-wechat",
            channel: "wechat",
            display_name: "微信值班人",
            is_active: true,
            priority: 100,
            config: {},
            user_id: "user-1",
            last_used_at: null,
            created_at: "2026-03-25T00:00:00Z",
            updated_at: "2026-03-25T00:00:00Z",
          },
        ],
      },
    })
  })

  it("requires selecting an enabled chat task agent before create and submits assistant binding", async () => {
    render(
      <MonitorCreateModal
        open
        onOpenChange={jest.fn()}
        editTask={null}
        onSuccess={jest.fn()}
      />
    )

    await waitFor(() => {
      expect(mockListCustomTaskAgents).toHaveBeenCalledTimes(1)
    })

    const submit = screen.getByRole("button", { name: "创建任务" })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    const agentSelect = screen.getByRole("combobox")
    expect(screen.getByRole("option", { name: "地缘研究员" })).toBeTruthy()
    expect(screen.queryByRole("option", { name: "图片助手" })).toBeNull()
    expect(screen.queryByRole("option", { name: "已停用助手" })).toBeNull()

    fireEvent.change(
      screen.getByPlaceholderText("如：伊朗局势72H监控"),
      { target: { value: "伊朗局势72H监控" } }
    )
    fireEvent.change(
      screen.getByPlaceholderText("描述你希望持续监控的目标、关注的实体、以及触发预警的条件..."),
      { target: { value: "持续关注关键风险变化" } }
    )
    fireEvent.change(agentSelect, { target: { value: "agent-1" } })

    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => {
      expect(mockCreateMonitorTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "伊朗局势72H监控",
          objective: "持续关注关键风险变化",
          assistant_id: "agent-1",
          analysis_mode: "concise",
        })
      )
    })
  })

  it("hydrates assistant binding and analysis mode when editing", async () => {
    render(
      <MonitorCreateModal
        open
        onOpenChange={jest.fn()}
        editTask={makeEditTask({
          analysis_mode: "alert_first",
          assistant_id: "agent-1",
          title: "已存在任务",
          objective: "已存在目标",
        })}
        onSuccess={jest.fn()}
      />
    )

    await waitFor(() => {
      expect(mockListCustomTaskAgents).toHaveBeenCalled()
    })

    expect(screen.getByDisplayValue("已存在任务")).toBeTruthy()
    expect(screen.getByDisplayValue("已存在目标")).toBeTruthy()
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("agent-1")
    expect(screen.getByRole("button", { name: /预警优先/ })).toBeTruthy()
  })

  it("shows channel-specific delivery hints before submission", async () => {
    render(
      <MonitorCreateModal
        open
        onOpenChange={jest.fn()}
        editTask={null}
        onSuccess={jest.fn()}
      />
    )

    await waitFor(() => {
      expect(mockListCustomTaskAgents).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByText("飞书战情群"))
    fireEvent.click(screen.getByText("Telegram 频道"))
    fireEvent.click(screen.getByText("微信值班人"))

    expect(screen.getByText("飞书和 Telegram 在首次投递后会自动建立线程锚点")).toBeTruthy()
    expect(screen.getByText("微信联系人需要先发一条消息，系统才能建立上下文")).toBeTruthy()
  })
})
