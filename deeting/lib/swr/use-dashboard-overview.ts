import useSWR from "swr"
import { fetchDashboardOverview } from "@/lib/api/dashboard"
import type { DashboardDataSource, DashboardOverview } from "@/lib/api/dashboard"

export function useDashboardOverview(options?: {
  source?: DashboardDataSource
  period?: "24h" | "7d" | "30d"
  recentErrorLimit?: number
}) {
  const source = options?.source ?? "auto"
  const period = options?.period ?? "24h"
  const recentErrorLimit = options?.recentErrorLimit ?? 10

  const { data, error, isLoading, mutate } = useSWR<DashboardOverview>(
    ["/api/v1/dashboard/overview", source, period, recentErrorLimit],
    () => fetchDashboardOverview({ source, period, recentErrorLimit }),
    {
      refreshInterval: 15000,
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  )

  return {
    data,
    error,
    isLoading,
    mutate,
  }
}
