import { render, screen } from "@testing-library/react"

import { MonitorsClient } from "@/app/[locale]/dashboard/monitors/components/monitors-client"

const mockUseMonitorTasks = jest.fn()

jest.mock("@/components/ui/container", () => ({
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/lib/swr/use-monitors", () => ({
  useMonitorTasks: (...args: unknown[]) => mockUseMonitorTasks(...args),
}))

jest.mock("@/lib/api/monitors", () => ({
  fetchMonitorLogs: jest.fn(),
  triggerMonitorTask: jest.fn(),
}))

jest.mock(
  "@/app/[locale]/dashboard/monitors/components/monitor-task-card",
  () => ({
    MonitorTaskCard: ({ task }: { task: { title: string } }) => <div>{task.title}</div>,
  })
)

jest.mock(
  "@/app/[locale]/dashboard/monitors/components/monitor-create-modal",
  () => ({
    MonitorCreateModal: () => null,
  })
)

jest.mock(
  "@/app/[locale]/dashboard/monitors/components/monitor-execution-log",
  () => ({
    MonitorExecutionLog: () => null,
  })
)

jest.mock(
  "@/app/[locale]/dashboard/monitors/components/monitor-empty-state",
  () => ({
    MonitorEmptyState: () => <div>empty</div>,
  })
)

describe("MonitorsClient", () => {
  beforeEach(() => {
    mockUseMonitorTasks.mockReset()
    mockUseMonitorTasks.mockReturnValue({
      data: {
        items: [
          {
            id: "task-1",
            title: "任务一",
          },
        ],
        total: 1,
      },
      isLoading: false,
      mutate: jest.fn(),
    })
  })

  it("does not render dashboard stats or request monitor stats data for the task-and-records page", () => {
    render(<MonitorsClient />)

    expect(screen.queryByText("刷新记录")).toBeInTheDocument()
  })
})
