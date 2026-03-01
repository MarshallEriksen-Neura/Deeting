import useSWR from "swr"
import type {
  MonitorTaskList,
  MonitorStats,
  MonitorExecutionLogList,
  MonitorStatus,
} from "@/lib/api/monitors"
import {
  fetchMonitorTasks,
  fetchMonitorStats,
  fetchMonitorLogs,
} from "@/lib/api/monitors"

/**
 * SWR hook for fetching monitor tasks list
 */
export function useMonitorTasks(params?: {
  skip?: number
  limit?: number
  status?: MonitorStatus
}) {
  const key = params
    ? `/api/v1/monitors?${new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()}`
    : "/api/v1/monitors"

  const { data, error, isLoading, mutate } = useSWR<MonitorTaskList>(
    key,
    () => fetchMonitorTasks(params),
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  )

  return { data, error, isLoading, mutate }
}

/**
 * SWR hook for fetching monitor stats
 */
export function useMonitorStats() {
  const { data, error, isLoading, mutate } = useSWR<MonitorStats>(
    "/api/v1/monitors/stats",
    fetchMonitorStats,
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  )

  return { data, error, isLoading, mutate }
}

/**
 * SWR hook for fetching execution logs for a specific task
 */
export function useMonitorLogs(
  taskId: string | null,
  params?: { skip?: number; limit?: number }
) {
  const key = taskId
    ? `/api/v1/monitors/${taskId}/logs?skip=${params?.skip ?? 0}&limit=${params?.limit ?? 20}`
    : null

  const { data, error, isLoading, mutate } = useSWR<MonitorExecutionLogList>(
    key,
    () => (taskId ? fetchMonitorLogs(taskId, params) : Promise.reject()),
    {
      refreshInterval: 15000,
      revalidateOnFocus: true,
    }
  )

  return { data, error, isLoading, mutate }
}
