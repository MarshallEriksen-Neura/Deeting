import useSWR from "swr"
import { fetchSmartRouterStats } from "@/lib/api/dashboard"
import type { SmartRouterStats } from "@/lib/api/dashboard"

/**
 * SWR hook for fetching smart router statistics
 *
 * Includes cache hit rate, cost savings, and performance metrics
 */
export function useSmartRouterStats() {
  const { data, error, isLoading, mutate } = useSWR<SmartRouterStats>(
    "/api/v1/dashboard/smart-router-stats",
    fetchSmartRouterStats,
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
