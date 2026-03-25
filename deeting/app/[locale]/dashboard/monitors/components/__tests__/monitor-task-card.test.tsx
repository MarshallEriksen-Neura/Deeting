import { fireEvent, render, screen } from "@testing-library/react"

import { MonitorTaskCard } from "@/app/[locale]/dashboard/monitors/components/monitor-task-card"
import type { MonitorTask } from "@/lib/api/monitors"

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
}))

jest.mock("@/lib/api/monitors", () => ({
  pauseMonitorTask: jest.fn(),
  resumeMonitorTask: jest.fn(),
  deleteMonitorTask: jest.fn(),
}))

function makeTask(overrides: Partial<MonitorTask> = {}): MonitorTask {
  return {
    id: "task-1",
    user_id: "user-1",
    title: "伊朗局势72H监控",
    objective: "持续追踪关键局势变化",
    cron_expr: "0 */6 * * *",
    status: "active",
    last_snapshot: null,
    last_executed_at: null,
    next_run_at: null,
    current_interval_minutes: 360,
    display_status: "active",
    analysis_mode: "alert_first",
    policy_state: {},
    binding_state: "ok",
    binding_error: null,
    strategy_variants: null,
    assistant_id: "agent-1",
    assistant_name: "地缘研究员",
    model_id: null,
    error_count: 0,
    notify_config: {},
    allowed_tools: [],
    execution_target: "desktop",
    total_tokens: 1200,
    is_active: true,
    created_at: "2026-03-25T00:00:00Z",
    updated_at: "2026-03-25T00:00:00Z",
    ...overrides,
  }
}

describe("MonitorTaskCard", () => {
  it("shows assistant name and binding repair state for invalid bindings", () => {
    const onEdit = jest.fn()
    render(
      <MonitorTaskCard
        task={makeTask({
          display_status: "binding_invalid",
          binding_state: "binding_invalid",
          binding_error: "绑定的任务智能体已停用",
        })}
        onEdit={onEdit}
        onViewLogs={jest.fn()}
        onRefresh={jest.fn()}
        onTrigger={jest.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.getByText("地缘研究员")).toBeTruthy()
    expect(screen.getByText("绑定失效")).toBeTruthy()
    expect(screen.getByText("绑定的任务智能体已停用")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "修复绑定" }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it("disables immediate trigger when binding is not ready", () => {
    render(
      <MonitorTaskCard
        task={makeTask({
          display_status: "binding_required",
          binding_state: "binding_required",
          binding_error: "请先绑定一个聊天任务智能体",
          assistant_id: null,
          assistant_name: null,
        })}
        onEdit={jest.fn()}
        onViewLogs={jest.fn()}
        onRefresh={jest.fn()}
        onTrigger={jest.fn().mockResolvedValue(undefined)}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }))
    expect(
      (screen.getByRole("button", { name: "立即触发" }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})
