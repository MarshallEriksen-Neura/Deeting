const mockUseSWR = jest.fn()

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("@/lib/api/monitors", () => ({
  fetchMonitorTasks: jest.fn(),
  fetchMonitorStats: jest.fn(),
  fetchMonitorLogs: jest.fn(),
}))

import { useMonitorLogs, useMonitorStats, useMonitorTasks } from "@/lib/swr/use-monitors"

describe("use-monitors hooks", () => {
  beforeEach(() => {
    mockUseSWR.mockReset()
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: jest.fn(),
    })
  })

  it("does not auto-poll monitor task and stats queries by default", () => {
    useMonitorTasks()
    useMonitorStats()

    expect(mockUseSWR).toHaveBeenNthCalledWith(
      1,
      "/api/v1/monitors",
      expect.any(Function),
      expect.not.objectContaining({
        refreshInterval: expect.anything(),
      })
    )
    expect(mockUseSWR).toHaveBeenNthCalledWith(
      2,
      "/api/v1/monitors/stats",
      expect.any(Function),
      expect.not.objectContaining({
        refreshInterval: expect.anything(),
      })
    )
  })

  it("does not auto-poll monitor logs by default", () => {
    useMonitorLogs("task-1")

    expect(mockUseSWR).toHaveBeenCalledWith(
      "/api/v1/monitors/task-1/logs?skip=0&limit=20",
      expect.any(Function),
      expect.not.objectContaining({
        refreshInterval: expect.anything(),
      })
    )
  })
})
