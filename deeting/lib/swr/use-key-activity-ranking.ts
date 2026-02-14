import useSWR from "swr"
import { fetchKeyActivityRanking } from "@/lib/api/monitoring"
import type { KeyActivityRanking } from "@/lib/api/monitoring"
import type {
  MonitoringQueryFilters,
  MonitoringTimeRange,
} from "@/lib/api/monitoring"

/**
 * SWR hook for fetching key activity ranking
 *
 * @param limit - Number of top keys to fetch (default: 5)
 */
export function useKeyActivityRanking(
  filters: MonitoringQueryFilters = {},
  limit = 5,
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
  const { data, error, isLoading, mutate } = useSWR<KeyActivityRanking>(
    [
      "/api/v1/monitoring/key-activity-ranking",
      timeRange,
      queryFilters.model,
      queryFilters.apiKey,
      queryFilters.errorCode,
      limit,
      autoRefresh,
    ],
    () => fetchKeyActivityRanking({ ...queryFilters, limit }),
    {
      refreshInterval: autoRefresh ? 15000 : 0, // Refresh every 15s for real-time monitoring
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
