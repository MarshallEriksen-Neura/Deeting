import useSWR from "swr"
import { fetchErrorDistribution } from "@/lib/api/monitoring"
import type { ErrorDistribution } from "@/lib/api/monitoring"

/**
 * SWR hook for fetching error distribution
 */
export function useErrorDistribution() {
  const { data, error, isLoading, mutate } = useSWR<ErrorDistribution>(
    "/api/v1/monitoring/error-distribution",
    fetchErrorDistribution,
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
