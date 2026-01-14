import useSWR from "swr"
import { fetchLatencyHeatmap } from "@/lib/api/monitoring"
import type { LatencyHeatmap } from "@/lib/api/monitoring"

/**
 * SWR hook for fetching latency heatmap data
 *
 * @param timeRange - Time range filter
 * @param model - Model filter
 */
export function useLatencyHeatmap(timeRange: "24h" | "7d" | "30d" = "24h", model?: string) {
  const { data, error, isLoading, mutate } = useSWR<LatencyHeatmap>(
    ["/api/v1/monitoring/latency-heatmap", timeRange, model],
    () => fetchLatencyHeatmap({ timeRange, model }),
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
