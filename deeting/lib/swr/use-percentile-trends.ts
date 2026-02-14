import useSWR from "swr"
import { fetchPercentileTrends } from "@/lib/api/monitoring"
import type { PercentileTrends } from "@/lib/api/monitoring"
import type {
  MonitoringQueryFilters,
  MonitoringTimeRange,
} from "@/lib/api/monitoring"

/**
 * SWR hook for fetching percentile trends (P50, P99)
 *
 * @param timeRange - Time range filter
 */
export function usePercentileTrends(
  filters: MonitoringQueryFilters = {},
  options: { autoRefresh?: boolean } = {}
) {
  const queryFilters: MonitoringQueryFilters = {
    timeRange: filters.timeRange ?? "24h",
    model: filters.model,
    apiKey: filters.apiKey,
    errorCode: filters.errorCode,
  }
  const timeRange: MonitoringTimeRange = queryFilters.timeRange as MonitoringTimeRange
  const autoRefresh = options.autoRefresh ?? true
  const { data, error, isLoading, mutate } = useSWR<PercentileTrends>(
    [
      "/api/v1/monitoring/percentile-trends",
      timeRange,
      queryFilters.model,
      queryFilters.apiKey,
      queryFilters.errorCode,
      autoRefresh,
    ],
    () => fetchPercentileTrends(queryFilters),
    {
      refreshInterval: autoRefresh ? 30000 : 0, // Refresh every 30s
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
