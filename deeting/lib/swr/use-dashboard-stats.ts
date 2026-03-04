import useSWR from "swr"
import { fetchDashboardStats } from "@/lib/api/dashboard"
import type { DashboardDataSource, DashboardStats } from "@/lib/api/dashboard"

/**
 * SWR hook for fetching dashboard statistics
 *
 * Auto-refreshes every 30 seconds to keep data fresh
 */
export function useDashboardStats(options?: { source?: DashboardDataSource }) {
  const source = options?.source ?? "auto"
  const { data, error, isLoading, mutate } = useSWR<DashboardStats>(
    ["/api/v1/dashboard/stats", source],
    () => fetchDashboardStats({ source }),
    {
      refreshInterval: 30000, // Refresh every 30s
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
