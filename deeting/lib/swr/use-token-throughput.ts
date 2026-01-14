import useSWR from "swr"
import { fetchTokenThroughput } from "@/lib/api/dashboard"
import type { TokenThroughput } from "@/lib/api/dashboard"

/**
 * SWR hook for fetching token throughput data
 *
 * @param period - Time period: 24h, 7d, or 30d
 */
export function useTokenThroughput(period: "24h" | "7d" | "30d" = "24h") {
  const { data, error, isLoading, mutate } = useSWR<TokenThroughput>(
    ["/api/v1/dashboard/token-throughput", period],
    () => fetchTokenThroughput({ period }),
    {
      refreshInterval: 60000, // Refresh every 60s
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
