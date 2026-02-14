import useSWR from "swr"
import { fetchErrorDistribution } from "@/lib/api/monitoring"
import type { ErrorDistribution } from "@/lib/api/monitoring"
import type {
  MonitoringQueryFilters,
  MonitoringTimeRange,
} from "@/lib/api/monitoring"

/**
 * SWR hook for fetching error distribution
 */
export function useErrorDistribution(
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
  const { data, error, isLoading, mutate } = useSWR<ErrorDistribution>(
    [
      "/api/v1/monitoring/error-distribution",
      timeRange,
      queryFilters.model,
      queryFilters.apiKey,
      queryFilters.errorCode,
      autoRefresh,
    ],
    () => fetchErrorDistribution(queryFilters),
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
