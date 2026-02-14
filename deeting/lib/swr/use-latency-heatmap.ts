import useSWR from "swr"
import { fetchLatencyHeatmap } from "@/lib/api/monitoring"
import type { LatencyHeatmap } from "@/lib/api/monitoring"
import type {
  MonitoringQueryFilters,
  MonitoringTimeRange,
} from "@/lib/api/monitoring"

/**
 * SWR hook for fetching latency heatmap data
 *
 * @param timeRange - Time range filter
 * @param model - Model filter
 */
export function useLatencyHeatmap(
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
  const { data, error, isLoading, mutate } = useSWR<LatencyHeatmap>(
    [
      "/api/v1/monitoring/latency-heatmap",
      timeRange,
      queryFilters.model,
      queryFilters.apiKey,
      queryFilters.errorCode,
      autoRefresh,
    ],
    () => fetchLatencyHeatmap(queryFilters),
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
