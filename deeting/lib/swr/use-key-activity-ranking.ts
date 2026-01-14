import useSWR from "swr"
import { fetchKeyActivityRanking } from "@/lib/api/monitoring"
import type { KeyActivityRanking } from "@/lib/api/monitoring"

/**
 * SWR hook for fetching key activity ranking
 *
 * @param limit - Number of top keys to fetch (default: 5)
 */
export function useKeyActivityRanking(timeRange: "24h" | "7d" | "30d" = "24h", limit = 5) {
  const { data, error, isLoading, mutate } = useSWR<KeyActivityRanking>(
    ["/api/v1/monitoring/key-activity-ranking", timeRange, limit],
    () => fetchKeyActivityRanking({ timeRange, limit }),
    {
      refreshInterval: 15000, // Refresh every 15s for real-time monitoring
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
