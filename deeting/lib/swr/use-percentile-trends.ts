import useSWR from "swr"
import { fetchPercentileTrends } from "@/lib/api/monitoring"
import type { PercentileTrends } from "@/lib/api/monitoring"

/**
 * SWR hook for fetching percentile trends (P50, P99)
 *
 * @param timeRange - Time range filter
 */
export function usePercentileTrends(timeRange: "24h" | "7d" | "30d" = "24h") {
  const { data, error, isLoading, mutate } = useSWR<PercentileTrends>(
    ["/api/v1/monitoring/percentile-trends", timeRange],
    () => fetchPercentileTrends({ timeRange }),
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
