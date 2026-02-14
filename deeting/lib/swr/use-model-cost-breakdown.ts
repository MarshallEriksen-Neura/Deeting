import useSWR from "swr"
import { fetchModelCostBreakdown } from "@/lib/api/monitoring"
import type { ModelCostBreakdown } from "@/lib/api/monitoring"
import type {
  MonitoringQueryFilters,
  MonitoringTimeRange,
} from "@/lib/api/monitoring"

/**
 * SWR hook for fetching model cost breakdown
 */
export function useModelCostBreakdown(
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
  const { data, error, isLoading, mutate } = useSWR<ModelCostBreakdown>(
    [
      "/api/v1/monitoring/model-cost-breakdown",
      timeRange,
      queryFilters.model,
      queryFilters.apiKey,
      queryFilters.errorCode,
      autoRefresh,
    ],
    () => fetchModelCostBreakdown(queryFilters),
    {
      refreshInterval: autoRefresh ? 60000 : 0, // Refresh every 60s
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  )

  return {
    data,
    error,
    isLoading,
    mutate,
  }
}
